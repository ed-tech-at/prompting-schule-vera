import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  hasEnoughStars: vi.fn(),
  newBadgeHash: vi.fn(),
  findLesson: vi.fn(),
  findCourse: vi.fn(),
  findAttempt: vi.fn(),
  aggregateProgress: vi.fn(),
  createBadge: vi.fn(),
  findBadge: vi.fn(),
  qrToBuffer: vi.fn(),
  sharpComposite: vi.fn(),
  sharpPng: vi.fn(),
  sharpToBuffer: vi.fn(),
  bakeryBake: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    lesson: { findUnique: mocks.findLesson },
    course: { findUnique: mocks.findCourse },
    userQuizAttempt: { findFirst: mocks.findAttempt },
    userProgress: { aggregate: mocks.aggregateProgress },
    badge: { create: mocks.createBadge, findFirst: mocks.findBadge }
  }
}));

vi.mock('$lib/server/jwt', () => ({ requireLogin: mocks.requireLogin }));
vi.mock('$lib/server/lessonStars', () => ({ hasEnoughStars: mocks.hasEnoughStars }));
vi.mock('$lib/server/dbUtils', () => ({ newBadgeHash: mocks.newBadgeHash }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://example.test' } }));

vi.mock('qrcode', () => ({
  default: { toBuffer: mocks.qrToBuffer }
}));

vi.mock('openbadges-bakery-v3', () => ({
  default: { bake: mocks.bakeryBake }
}));

vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn(() => Buffer.from('font')) }
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    composite: mocks.sharpComposite,
    png: mocks.sharpPng
  }))
}));

import { POST } from './+server';

const cookies = {} as Cookies;

function requestBody(body: unknown) {
  return {
    request: { json: vi.fn().mockResolvedValue(body) },
    cookies
  } as Parameters<typeof POST>[0];
}

async function post(body: unknown): Promise<Response> {
  const response = await POST(requestBody(body));
  if (!response) throw new Error('POST returned no response');
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireLogin.mockReturnValue({ id: 'user-1', email: 'user@example.test' });
  mocks.hasEnoughStars.mockResolvedValue(true);
  mocks.qrToBuffer.mockResolvedValue(Buffer.from('qr'));
  mocks.sharpComposite.mockReturnValue({
    png: mocks.sharpPng
  });
  mocks.sharpPng.mockReturnValue({ toBuffer: mocks.sharpToBuffer });
  mocks.sharpToBuffer.mockResolvedValue(Buffer.from('badge-image'));
  mocks.bakeryBake.mockImplementation((_input, callback) => {
    callback(null, Buffer.from('baked-badge'));
  });
});

describe('POST createLessonBadge', () => {
  it('returns Lesson not found for an unknown lesson', async () => {
    mocks.findLesson.mockResolvedValue(null);

    const response = await post({ action: 'createLessonBadge', formData: { lessonId: 99 } });

    await expect(response.json()).resolves.toEqual({ success: false, error: 'Lesson not found' });
  });

  it('requires enough stars and a passing quiz for a quiz lesson', async () => {
    mocks.findLesson.mockResolvedValue({ id: 7, starsNeeded: 3 });
    mocks.hasEnoughStars.mockResolvedValue(false);

    const response = await post({ action: 'createLessonBadge', formData: { lessonId: 7 } });

    expect(mocks.hasEnoughStars).toHaveBeenCalledWith('user-1', { id: 7, starsNeeded: 3 });
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Not enough stars' });
  });

  it('rejects a quiz lesson without a passing attempt', async () => {
    mocks.findLesson.mockResolvedValue({ id: 7, starsNeeded: 3 });
    mocks.findAttempt.mockResolvedValue({ percentReached: 74 });

    const response = await post({ action: 'createLessonBadge', formData: { lessonId: 7 } });

    await expect(response.json()).resolves.toEqual({ success: false, error: 'Not enough points' });
  });

  it('rejects badge creation when no prompts were tried', async () => {
    mocks.findLesson.mockResolvedValue({ id: 7, starsNeeded: 0 });
    mocks.aggregateProgress.mockResolvedValue({
      _sum: { promptsTried: 0, promptTokens: 0, completionTokens: 0 }
    });

    const response = await post({ action: 'createLessonBadge', formData: { lessonId: 7 } });

    await expect(response.json()).resolves.toEqual({ success: false, error: 'No prompts tried' });
  });

  it('creates and returns a lesson badge', async () => {
    mocks.findLesson.mockResolvedValue({ id: 7, starsNeeded: 0 });
    mocks.aggregateProgress.mockResolvedValue({
      _sum: { promptsTried: 4, promptTokens: 120, completionTokens: 80 }
    });
    mocks.newBadgeHash.mockResolvedValue('7000123');
    mocks.createBadge.mockResolvedValue({ id: 'badge-1', hash: '7000123' });

    const response = await post({ action: 'createLessonBadge', formData: { lessonId: 7 } });

    expect(mocks.createBadge).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'lesson',
        lessonId: 7,
        promptsTried: 4,
        promptTokens: 120,
        completionTokens: 80,
        hash: '7000123'
      }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      badge: { id: 'badge-1', hash: '7000123' }
    });
  });
});

describe('POST getBadgeImg', () => {
  it('returns 404 when the badge cannot be found', async () => {
    mocks.findBadge.mockResolvedValue(null);

    const response = await post({ action: 'getBadgeImg', formData: { hash: 'missing' } });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Badge not found' });
  });

  it('generates a QR code, escaped certificate text, and baked PNG', async () => {
    mocks.findBadge.mockResolvedValue({
      hash: '7000123',
      lessonId: 7,
      promptsTried: 4,
      promptTokens: 120,
      completionTokens: 80,
      createdAt: new Date('2026-11-23T12:00:00.000Z')
    });
    mocks.findLesson.mockResolvedValue({
      id: 7,
      courseId: 'course-1',
      lessonName: 'A&B <Lektion>',
      starsNeeded: 2,
      URL: 'lektion'
    });
    mocks.findCourse.mockResolvedValue({
      id: 'course-1',
      name: 'Kurs "One"',
      URL: 'kurs'
    });

    const response = await post({ action: 'getBadgeImg', formData: { hash: '7000123' } });

    expect(mocks.qrToBuffer).toHaveBeenCalledWith(
      'https://example.test/badge/7000123/user@example.test',
      expect.objectContaining({ margin: 0, width: 180 })
    );

    const compositeInput = mocks.sharpComposite.mock.calls[0][0];
    const svg = compositeInput[1].input.toString();
    expect(svg).toContain('A&amp;B &lt;Lektion&gt;');
    expect(svg).toContain('Kurs &quot;One&quot;');
    expect(svg).toContain('und die Selbstüberprüfung bestanden');

    await expect(response.json()).resolves.toEqual({
      image: `data:image/png;base64,${Buffer.from('baked-badge').toString('base64')}`
    });
  });
});
