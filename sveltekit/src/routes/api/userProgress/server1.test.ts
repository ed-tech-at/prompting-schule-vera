import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  findElement: vi.fn(),
  createProgress: vi.fn(),
  findProgress: vi.fn(),
  countLessonStars: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    element: { findUnique: mocks.findElement },
    userProgress: { create: mocks.createProgress, findFirst: mocks.findProgress }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/lessonStars', () => ({
  countLessonStars: mocks.countLessonStars
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
  mocks.requireLogin.mockReturnValue({ id: 'user-1' });
});

describe('POST userProgress authorization', () => {
  it('rejects progress operations for another authenticated user', async () => {
    const response = await post({
      action: 'getLessonStars',
      data: { userId: 'user-2', lessonId: 7 }
    });

    expect(mocks.countLessonStars).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unauthorized user'
    });
  });
});

describe('POST note', () => {
  it('stores a note and returns its token length', async () => {
    mocks.findElement.mockResolvedValue({ id: 11 });
    mocks.createProgress.mockResolvedValue({ id: 'progress-1' });

    const response = await post({
      action: 'note',
      data: {
        userId: 'user-1',
        elementId: 11,
        courseId: 'course-1',
        lessonId: 7,
        ai1: 'Meine Notiz'
      }
    });

    expect(mocks.findElement).toHaveBeenCalledWith({ where: { id: 11 } });
    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        elementId: 11,
        courseId: 'course-1',
        lessonId: 7,
        ai1: 'Meine Notiz',
        ai1Result: 'Gespeicherte Notiz',
        promptTokens: 11,
        promptsTried: 0
      }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      ai1Result: 'Notiz gespeichert',
      promptTokens: 11
    });
  });

  it('rejects notes longer than 50000 characters', async () => {
    const response = await post({
      action: 'note',
      data: {
        userId: 'user-1',
        elementId: 11,
        courseId: 'course-1',
        lessonId: 7,
        ai1: 'x'.repeat(50001)
      }
    });

    expect(mocks.createProgress).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Anfrage zu lange'
    });
  });
});

describe('POST get user progress', () => {
  it('returns the latest AI1 progress', async () => {
    mocks.findProgress.mockResolvedValue({ id: 'p-1', ai1: 'Antwort', ai1Result: 'Ergebnis' });

    const response = await post({
      action: 'getUserProgressElementAi1',
      data: { userId: 'user-1', elementId: 11 }
    });

    expect(mocks.findProgress).toHaveBeenCalledWith({
      where: { userId: 'user-1', elementId: 11, ai1Result: { not: null } },
      orderBy: { createdAt: 'desc' }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      userProgress: { id: 'p-1', ai1: 'Antwort', ai1Result: 'Ergebnis' }
    });
  });

  it.each(['\n', '<br>'])('normalizes an AI1 newline placeholder %s', async (ai1) => {
    mocks.findProgress.mockResolvedValue({ id: 'p-1', ai1, ai1Result: 'Ergebnis' });

    const response = await post({
      action: 'getUserProgressElementAi1',
      data: { userId: 'user-1', elementId: 11 }
    });

    await expect(response.json()).resolves.toEqual({
      success: true,
      userProgress: { id: 'p-1', ai1: '', ai1Result: 'Ergebnis' }
    });
  });

  it('returns false when no AI1 progress exists', async () => {
    mocks.findProgress.mockResolvedValue(null);

    const response = await post({
      action: 'getUserProgressElementAi1',
      data: { userId: 'user-1', elementId: 11 }
    });

    await expect(response.json()).resolves.toEqual({ success: false });
  });

  it('returns the latest AI2 progress', async () => {
    mocks.findProgress.mockResolvedValue({ id: 'p-2', ai2: 'Antwort 2', ai2Result: 'Ergebnis 2' });

    const response = await post({
      action: 'getUserProgressElementAi2',
      data: { userId: 'user-1', elementId: 12 }
    });

    expect(mocks.findProgress).toHaveBeenCalledWith({
      where: { userId: 'user-1', elementId: 12, ai2Result: { not: null } },
      orderBy: { createdAt: 'desc' }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      userProgress: { id: 'p-2', ai2: 'Antwort 2', ai2Result: 'Ergebnis 2' }
    });
  });

  it.each(['\n', '<br>'])('normalizes an AI2 newline placeholder %s', async (ai2) => {
    mocks.findProgress.mockResolvedValue({ id: 'p-2', ai2, ai2Result: 'Ergebnis 2' });

    const response = await post({
      action: 'getUserProgressElementAi2',
      data: { userId: 'user-1', elementId: 12 }
    });

    await expect(response.json()).resolves.toEqual({
      success: true,
      userProgress: { id: 'p-2', ai2: '', ai2Result: 'Ergebnis 2' }
    });
  });

  it('returns false when no AI2 progress exists', async () => {
    mocks.findProgress.mockResolvedValue(null);

    const response = await post({
      action: 'getUserProgressElementAi2',
      data: { userId: 'user-1', elementId: 12 }
    });

    await expect(response.json()).resolves.toEqual({ success: false });
  });

  it('returns starred progress ordered by stars', async () => {
    mocks.findProgress.mockResolvedValue({ id: 'p-3', ai1: 'Text', stars: 3 });

    const response = await post({
      action: 'getUserProgressElementStar',
      data: { userId: 'user-1', elementId: 13 }
    });

    expect(mocks.findProgress).toHaveBeenCalledWith({
      where: { userId: 'user-1', elementId: 13, ai1Result: { not: null } },
      orderBy: [{ stars: 'desc' }, { createdAt: 'desc' }]
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      userProgress: { id: 'p-3', ai1: 'Text', stars: 3 }
    });
  });

  it('normalizes starred progress newline placeholders', async () => {
    mocks.findProgress.mockResolvedValue({ id: 'p-3', ai1: '\n', stars: 1 });

    const response = await post({
      action: 'getUserProgressElementStar',
      data: { userId: 'user-1', elementId: 13 }
    });

    await expect(response.json()).resolves.toEqual({
      success: true,
      userProgress: { id: 'p-3', ai1: '', stars: 1 }
    });
  });

  it('returns false when no starred progress exists', async () => {
    mocks.findProgress.mockResolvedValue(null);

    const response = await post({
      action: 'getUserProgressElementStar',
      data: { userId: 'user-1', elementId: 13 }
    });

    await expect(response.json()).resolves.toEqual({ success: false });
  });
});

describe('POST getLessonStars', () => {
  it('returns the lesson star count', async () => {
    mocks.countLessonStars.mockResolvedValue(3);

    const response = await post({
      action: 'getLessonStars',
      data: { userId: 'user-1', lessonId: 7 }
    });

    expect(mocks.countLessonStars).toHaveBeenCalledWith('user-1', 7);
    await expect(response.json()).resolves.toEqual({ success: true, stars: 3 });
  });
});
