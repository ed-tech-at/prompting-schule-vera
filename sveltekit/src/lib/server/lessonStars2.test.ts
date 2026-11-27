import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create a mock before the mocked module is imported.
const { groupBy } = vi.hoisted(() => ({
  groupBy: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    userProgress: {
      groupBy
    }
  }
}));

import { countLessonStars, hasEnoughStars } from './lessonStars';

beforeEach(() => {
  groupBy.mockReset();
});

describe('countLessonStars', () => {
  it('returns the number of distinct starred elements', async () => {
    groupBy.mockResolvedValueOnce([
      { elementId: 1 },
      { elementId: 2 },
      { elementId: 3 }
    ]);

    const result = await countLessonStars('user-123', 10);

    expect(result).toBe(3);
  });

  it('returns zero when the user has no starred elements', async () => {
    groupBy.mockResolvedValueOnce([]);

    const result = await countLessonStars('user-123', 10);

    expect(result).toBe(0);
  });

  it('queries only the specified user and lesson, excluding zero-star records', async () => {
    groupBy.mockResolvedValueOnce([{ elementId: 1 }]);

    await countLessonStars('user-123', 10);

    expect(groupBy).toHaveBeenCalledOnce();
    expect(groupBy).toHaveBeenCalledWith({
      by: ['elementId'],
      where: {
        userId: 'user-123',
        lessonId: 10,
        stars: {
          not: 0
        }
      }
    });
  });

  it('propagates database errors', async () => {
    const error = new Error('Database connection failed');
    groupBy.mockRejectedValueOnce(error);

    await expect(countLessonStars('user-123', 10)).rejects.toThrow(
      'Database connection failed'
    );
  });
});

describe('hasEnoughStars', () => {
  it('returns true when starsNeeded is zero without querying the database', async () => {
    const result = await hasEnoughStars('user-123', {
      id: 10,
      starsNeeded: 0
    });

    expect(result).toBe(true);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('returns true when starsNeeded is negative without querying the database', async () => {
    const result = await hasEnoughStars('user-123', {
      id: 10,
      starsNeeded: -1
    });

    expect(result).toBe(true);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('returns true when the user has exactly the required number of stars', async () => {
    groupBy.mockResolvedValueOnce([
      { elementId: 1 },
      { elementId: 2 },
      { elementId: 3 }
    ]);

    const result = await hasEnoughStars('user-123', {
      id: 10,
      starsNeeded: 3
    });

    expect(result).toBe(true);
    expect(groupBy).toHaveBeenCalledOnce();
  });

  it('returns true when the user has more than the required number of stars', async () => {
    groupBy.mockResolvedValueOnce([
      { elementId: 1 },
      { elementId: 2 },
      { elementId: 3 },
      { elementId: 4 }
    ]);

    const result = await hasEnoughStars('user-123', {
      id: 10,
      starsNeeded: 3
    });

    expect(result).toBe(true);
  });

  it('returns false when the user has fewer stars than required', async () => {
    groupBy.mockResolvedValueOnce([
      { elementId: 1 },
      { elementId: 2 }
    ]);

    const result = await hasEnoughStars('user-123', {
      id: 10,
      starsNeeded: 3
    });

    expect(result).toBe(false);
  });

  it('returns false when the user has no stars and stars are required', async () => {
    groupBy.mockResolvedValueOnce([]);

    const result = await hasEnoughStars('user-123', {
      id: 10,
      starsNeeded: 1
    });

    expect(result).toBe(false);
  });
});