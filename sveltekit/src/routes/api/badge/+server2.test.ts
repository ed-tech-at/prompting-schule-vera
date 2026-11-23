import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { POST } from './+server';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

// vi.hoisted allows these mocks to be accessed inside vi.mock factories.
const mocks = vi.hoisted(() => ({
  // Prisma
  lessonFindUnique: vi.fn(),
  courseFindUnique: vi.fn(),
  quizFindFirst: vi.fn(),
  progressAggregate: vi.fn(),
  badgeCreate: vi.fn(),
  badgeFindFirst: vi.fn(),

  // Application services
  requireLogin: vi.fn(),
  hasEnoughStars: vi.fn(),
  newBadgeHash: vi.fn(),

  // External dependencies
  qrToBuffer: vi.fn(),
  sharp: vi.fn(),
  sharpComposite: vi.fn(),
  sharpPng: vi.fn(),
  sharpToBuffer: vi.fn(),
  bake: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    lesson: {
      findUnique: mocks.lessonFindUnique
    },
    course: {
      findUnique: mocks.courseFindUnique
    },
    userQuizAttempt: {
      findFirst: mocks.quizFindFirst
    },
    userProgress: {
      aggregate: mocks.progressAggregate
    },
    badge: {
      create: mocks.badgeCreate,
      findFirst: mocks.badgeFindFirst
    }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/lessonStars', () => ({
  hasEnoughStars: mocks.hasEnoughStars
}));

vi.mock('$lib/server/dbUtils', () => ({
  newBadgeHash: mocks.newBadgeHash
}));

vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_APP_URL: 'https://app.example.test'
  }
}));

vi.mock('qrcode', () => ({
  default: {
    toBuffer: mocks.qrToBuffer
  }
}));

vi.mock('sharp', () => ({
  default: mocks.sharp
}));

vi.mock('openbadges-bakery-v3', () => ({
  default: {
    bake: mocks.bake
  }
}));

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const testUser = {
  id: 'user-123',
  email: 'learner@example.com'
};

const lesson = {
  id: 'lesson-123',
  lessonName: 'Introduction to Testing',
  courseId: 'course-123',
  starsNeeded: 0,
  URL: 'introduction-to-testing'
};

const course = {
  id: 'course-123',
  name: 'SvelteKit Course',
  URL: 'sveltekit-course'
};

const badge = {
  id: 'badge-123',
  userId: testUser.id,
  type: 'lesson',
  lessonId: lesson.id,
  promptsTried: 5,
  promptTokens: 100,
  completionTokens: 200,
  hash: 'badge-hash-123'
};

const sharpChain = {
  composite: mocks.sharpComposite,
  png: mocks.sharpPng,
  toBuffer: mocks.sharpToBuffer
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function callPost(
  action: string,
  formData: Record<string, unknown> = {}
): Promise<Response> {
  const request = new Request('http://localhost/api/badge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action,
      formData
    })
  });

  return POST({
    request,
    cookies: {}
  } as any);
}

async function responseJson(response: Response) {
  return response.json();
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();

  // Auth
  mocks.requireLogin.mockReturnValue(testUser);

  // Badge creation
  mocks.newBadgeHash.mockResolvedValue('badge-hash-123');

  // QR code
  mocks.qrToBuffer.mockResolvedValue(Buffer.from('qr-image'));

  // Sharp image pipeline
  mocks.sharp.mockReturnValue(sharpChain);
  mocks.sharpComposite.mockReturnValue(sharpChain);
  mocks.sharpPng.mockReturnValue(sharpChain);
  mocks.sharpToBuffer.mockResolvedValue(Buffer.from('rendered-image'));

  // Open Badges bakery callback
  mocks.bake.mockImplementation(
    (_options: unknown, callback: (err: Error | null, image: Buffer) => void) => {
      callback(null, Buffer.from('baked-image'));
    }
  );
});

// ============================================================================
// createLessonBadge
// ============================================================================

describe('POST /api/badge - createLessonBadge', () => {
  it('should return an error if the lesson does not exist', async () => {
    mocks.lessonFindUnique.mockResolvedValue(null);

    const response = await callPost('createLessonBadge', {
      lessonId: 'unknown-lesson'
    });

    expect(response.status).toBe(200);

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Lesson not found'
    });

    expect(mocks.progressAggregate).not.toHaveBeenCalled();
    expect(mocks.badgeCreate).not.toHaveBeenCalled();
  });

  it('should return an error if the user does not have enough stars', async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      ...lesson,
      starsNeeded: 5
    });

    mocks.hasEnoughStars.mockResolvedValue(false);

    const response = await callPost('createLessonBadge', {
      lessonId: lesson.id
    });

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Not enough stars'
    });

    expect(mocks.hasEnoughStars).toHaveBeenCalledWith(
      testUser.id,
      expect.objectContaining({ starsNeeded: 5 })
    );

    expect(mocks.quizFindFirst).not.toHaveBeenCalled();
    expect(mocks.progressAggregate).not.toHaveBeenCalled();
    expect(mocks.badgeCreate).not.toHaveBeenCalled();
  });

  it('should return an error if no quiz attempt exists', async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      ...lesson,
      starsNeeded: 5
    });

    mocks.hasEnoughStars.mockResolvedValue(true);
    mocks.quizFindFirst.mockResolvedValue(null);

    const response = await callPost('createLessonBadge', {
      lessonId: lesson.id
    });

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'No quiz attempt found'
    });

    expect(mocks.quizFindFirst).toHaveBeenCalledWith({
      where: {
        userId: testUser.id,
        lessonId: lesson.id
      },
      orderBy: {
        percentReached: 'desc'
      }
    });

    expect(mocks.progressAggregate).not.toHaveBeenCalled();
  });

  it('should return an error if the best quiz result is below 75 percent', async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      ...lesson,
      starsNeeded: 5
    });

    mocks.hasEnoughStars.mockResolvedValue(true);

    mocks.quizFindFirst.mockResolvedValue({
      percentReached: 74
    });

    const response = await callPost('createLessonBadge', {
      lessonId: lesson.id
    });

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Not enough points'
    });

    expect(mocks.progressAggregate).not.toHaveBeenCalled();
    expect(mocks.badgeCreate).not.toHaveBeenCalled();
  });

  it('should return an error if the user has not tried any prompts', async () => {
    mocks.lessonFindUnique.mockResolvedValue(lesson);

    mocks.progressAggregate.mockResolvedValue({
      _sum: {
        promptsTried: 0,
        promptTokens: 0,
        completionTokens: 0
      }
    });

    const response = await callPost('createLessonBadge', {
      lessonId: lesson.id
    });

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'No prompts tried'
    });

    expect(mocks.newBadgeHash).not.toHaveBeenCalled();
    expect(mocks.badgeCreate).not.toHaveBeenCalled();
  });

  it('should create a badge successfully without quiz requirements', async () => {
    mocks.lessonFindUnique.mockResolvedValue(lesson);

    mocks.progressAggregate.mockResolvedValue({
      _sum: {
        promptsTried: 5,
        promptTokens: 100,
        completionTokens: 200
      }
    });

    mocks.badgeCreate.mockResolvedValue(badge);

    const response = await callPost('createLessonBadge', {
      lessonId: lesson.id
    });

    expect(response.status).toBe(200);

    expect(await responseJson(response)).toEqual({
      success: true,
      badge
    });

    expect(mocks.requireLogin).toHaveBeenCalled();
    expect(mocks.newBadgeHash).toHaveBeenCalledWith(
      testUser.id,
      lesson.id
    );

    expect(mocks.badgeCreate).toHaveBeenCalledWith({
      data: {
        userId: testUser.id,
        type: 'lesson',
        lessonId: lesson.id,
        promptsTried: 5,
        promptTokens: 100,
        completionTokens: 200,
        hash: 'badge-hash-123'
      }
    });

    // Lessons without a star requirement should not require a quiz.
    expect(mocks.hasEnoughStars).not.toHaveBeenCalled();
    expect(mocks.quizFindFirst).not.toHaveBeenCalled();
  });

  it('should create a badge when the quiz result is exactly 75 percent', async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      ...lesson,
      starsNeeded: 5
    });

    mocks.hasEnoughStars.mockResolvedValue(true);

    mocks.quizFindFirst.mockResolvedValue({
      percentReached: 75
    });

    mocks.progressAggregate.mockResolvedValue({
      _sum: {
        promptsTried: 3,
        promptTokens: 50,
        completionTokens: 75
      }
    });

    mocks.badgeCreate.mockResolvedValue(badge);

    const response = await callPost('createLessonBadge', {
      lessonId: lesson.id
    });

    expect(await responseJson(response)).toEqual({
      success: true,
      badge
    });

    expect(mocks.quizFindFirst).toHaveBeenCalled();
    expect(mocks.badgeCreate).toHaveBeenCalled();
  });
});

// ============================================================================
// getBadgeImg
// ============================================================================

describe('POST /api/badge - getBadgeImg', () => {
  it('should return 404 if the badge does not exist', async () => {
    mocks.badgeFindFirst.mockResolvedValue(null);

    const response = await callPost('getBadgeImg', {
      hash: 'unknown-hash'
    });

    expect(response.status).toBe(404);

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Badge not found'
    });

    expect(mocks.qrToBuffer).not.toHaveBeenCalled();
    expect(mocks.sharp).not.toHaveBeenCalled();
    expect(mocks.bake).not.toHaveBeenCalled();
  });

  it('should generate a badge image and Open Badges assertion successfully', async () => {
    const createdAt = new Date('2025-05-15T10:30:00.000Z');

    const badgeDb = {
      ...badge,
      createdAt
    };

    const qrBuffer = Buffer.from('qr-image');
    const renderedBuffer = Buffer.from('rendered-image');
    const bakedBuffer = Buffer.from('baked-image');

    const email = 'learner&<"\'@example.com';

    mocks.requireLogin.mockReturnValue({
      ...testUser,
      email
    });

    mocks.badgeFindFirst.mockResolvedValue(badgeDb);

    mocks.lessonFindUnique.mockResolvedValue({
      ...lesson,
      lessonName: '<Lesson & "One">',
      starsNeeded: 2
    });

    mocks.courseFindUnique.mockResolvedValue({
      ...course,
      name: 'Course > Two & Co'
    });

    mocks.qrToBuffer.mockResolvedValue(qrBuffer);
    mocks.sharpToBuffer.mockResolvedValue(renderedBuffer);

    mocks.bake.mockImplementation(
      (_options: unknown, callback: (err: Error | null, image: Buffer) => void) => {
        callback(null, bakedBuffer);
      }
    );

    const response = await callPost('getBadgeImg', {
      hash: badge.hash
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const result = await responseJson(response);

    expect(result).toEqual({
      image: `data:image/png;base64,${bakedBuffer.toString('base64')}`
    });

    // The badge must belong to the authenticated user.
    expect(mocks.badgeFindFirst).toHaveBeenCalledWith({
      where: {
        userId: testUser.id,
        hash: badge.hash
      }
    });

    // Verify QR generation.
    expect(mocks.qrToBuffer).toHaveBeenCalledWith(
      `https://app.example.test/badge/${badge.hash}/${email}`,
      {
        color: {
          dark: '#009CB1',
          light: '#E4F3F5'
        },
        margin: 0,
        width: 180
      }
    );

    // Verify Sharp image processing.
    expect(mocks.sharp).toHaveBeenCalledWith(
      path.resolve('static/badge/badge_v2_1.png')
    );

    expect(mocks.sharpComposite).toHaveBeenCalledTimes(1);

    const composites = mocks.sharpComposite.mock.calls[0][0];

    expect(composites[0]).toEqual({
      input: qrBuffer,
      top: 170,
      left: 800
    });

    expect(composites[1].input).toBeInstanceOf(Buffer);

    const svg = composites[1].input.toString();

    // Check XML escaping to prevent malformed SVG content.
    expect(svg).toContain('learner&amp;&lt;&quot;&apos;@example.com');
    expect(svg).toContain('&lt;Lesson &amp; &quot;One&quot;&gt;');
    expect(svg).toContain('Course &gt; Two &amp; Co');

    // Check the star-dependent certificate text.
    expect(svg).toContain(
      'absolviert und die Selbstüberprüfung bestanden.'
    );

    // Check date output.
    expect(svg).toContain(
      `Zertifikat ${badge.hash} vom ${createdAt.toLocaleDateString('de-DE')}`
    );

    expect(mocks.sharpPng).toHaveBeenCalled();
    expect(mocks.sharpToBuffer).toHaveBeenCalled();

    // Verify Open Badges bakery invocation.
    expect(mocks.bake).toHaveBeenCalledTimes(1);

    const [bakeOptions] = mocks.bake.mock.calls[0];

    expect(bakeOptions.image).toBe(renderedBuffer);

    expect(bakeOptions.assertion).toEqual({
      '@context': 'https://w3id.org/openbadges/v2',
      type: 'Assertion',
      id: `https://app.example.test/badge/${badge.hash}/${email}/json.json`,
      recipient: {
        type: 'email',
        hashed: false,
        identity: email
      },
      badge: 'https://app.example.test/badge/class/sveltekit-course/introduction-to-testing/json.json',
      issuedOn: createdAt.toISOString(),
      verification: {
        type: 'HostedBadge',
        url: `https://app.example.test/badge/${badge.hash}/${email}/json.json`
      },
      image: 'https://app.example.test/badge/class/sveltekit-course/introduction-to-testing/image.png',
      evidence: `https://app.example.test/badge/${badge.hash}/${email}`
    });
  });
});
