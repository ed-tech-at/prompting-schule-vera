import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    userProgress: {
      groupBy: mocks.groupBy
    }
  }
}));

import { countLessonStars, hasEnoughStars } from './lessonStars';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countLessonStars', () => {
  it('groups starred progress for the user and lesson', async () => {
    mocks.groupBy.mockResolvedValue([
      { elementId: 10 },
      { elementId: 11 },
      { elementId: 12 }
    ]);

    await expect(countLessonStars('user-1', 7)).resolves.toBe(3);
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ['elementId'],
      where: { userId: 'user-1', lessonId: 7, stars: { not: 0 } }
    });
  });

  it('returns zero when no elements have stars', async () => {
    mocks.groupBy.mockResolvedValue([]);

    await expect(countLessonStars('user-1', 7)).resolves.toBe(0);
  });

  it('returns the number of distinct grouped elements', async () => {
    mocks.groupBy.mockResolvedValue([{ elementId: 10 }, { elementId: 11 }]);

    await expect(countLessonStars('user-1', 7)).resolves.toBe(2);
  });
});

describe('hasEnoughStars', () => {
  it('returns true without querying progress when starsNeeded is zero', async () => {
    await expect(hasEnoughStars('user-1', { id: 7, starsNeeded: 0 })).resolves.toBe(true);
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });

  it('returns true without querying progress when starsNeeded is negative', async () => {
    await expect(hasEnoughStars('user-1', { id: 7, starsNeeded: -2 })).resolves.toBe(true);
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });

  it('returns true when the earned star count reaches the threshold', async () => {
    mocks.groupBy.mockResolvedValue([{ elementId: 10 }, { elementId: 11 }]);

    await expect(hasEnoughStars('user-1', { id: 7, starsNeeded: 2 })).resolves.toBe(true);
  });

  it('returns false when the earned star count is below the threshold', async () => {
    mocks.groupBy.mockResolvedValue([{ elementId: 10 }]);

    await expect(hasEnoughStars('user-1', { id: 7, starsNeeded: 2 })).resolves.toBe(false);
  });
});
