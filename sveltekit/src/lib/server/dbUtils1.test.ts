import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uuidv4: vi.fn(),
  userFindUnique: vi.fn(),
  badgeFindFirst: vi.fn(),
  resetFindUnique: vi.fn()
}));

vi.mock('uuid', () => ({ v4: mocks.uuidv4 }));

vi.mock('$lib/server/db', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    badge: { findFirst: mocks.badgeFindFirst },
    userPasswordReset: { findUnique: mocks.resetFindUnique }
  }
}));

import { newBadgeHash, newPwResetToken, newUserUUID } from './dbUtils';

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('newUserUUID', () => {
  it('returns a UUID that is not already in use', async () => {
    mocks.uuidv4
      .mockReturnValueOnce('existing-user-id')
      .mockReturnValueOnce('available-user-id');
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'existing-user-id' })
      .mockResolvedValueOnce(null);

    await expect(newUserUUID()).resolves.toBe('available-user-id');

    expect(mocks.userFindUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'existing-user-id' }
    });
    expect(mocks.userFindUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'available-user-id' }
    });
  });

  it('returns immediately when the generated UUID is available', async () => {
    mocks.uuidv4.mockReturnValue('free-user-id');
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(newUserUUID()).resolves.toBe('free-user-id');
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1);
  });
});

describe('newBadgeHash', () => {
  it('returns a hash that is not used by the same user', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.123456);
    mocks.badgeFindFirst
      .mockResolvedValueOnce({ hash: '3100000' })
      .mockResolvedValueOnce(null);

    await expect(newBadgeHash('user-1', 3)).resolves.toBe('3123456');

    expect(mocks.badgeFindFirst).toHaveBeenNthCalledWith(1, {
      where: { hash: '3100000', userId: 'user-1' }
    });
    expect(mocks.badgeFindFirst).toHaveBeenNthCalledWith(2, {
      where: { hash: '3123456', userId: 'user-1' }
    });
  });

  it('pads the random number to six digits', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mocks.badgeFindFirst.mockResolvedValue(null);

    await expect(newBadgeHash('user-1', 7)).resolves.toBe('7000000');
    expect(mocks.badgeFindFirst).toHaveBeenCalledWith({
      where: { hash: '7000000', userId: 'user-1' }
    });
  });
});

describe('newPwResetToken', () => {
  it('returns a password reset token that is not already in use', async () => {
    mocks.uuidv4
      .mockReturnValueOnce('existing-reset-token')
      .mockReturnValueOnce('available-reset-token');
    mocks.resetFindUnique
      .mockResolvedValueOnce({ token: 'existing-reset-token' })
      .mockResolvedValueOnce(null);

    await expect(newPwResetToken()).resolves.toBe('available-reset-token');

    expect(mocks.resetFindUnique).toHaveBeenNthCalledWith(1, {
      where: { token: 'existing-reset-token' }
    });
    expect(mocks.resetFindUnique).toHaveBeenNthCalledWith(2, {
      where: { token: 'available-reset-token' }
    });
  });

  it('returns immediately when the generated token is available', async () => {
    mocks.uuidv4.mockReturnValue('free-reset-token');
    mocks.resetFindUnique.mockResolvedValue(null);

    await expect(newPwResetToken()).resolves.toBe('free-reset-token');
    expect(mocks.resetFindUnique).toHaveBeenCalledTimes(1);
  });
});
