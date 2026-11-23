import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { prisma } from '$lib/server/db';
import { v4 as uuidv4 } from 'uuid';

import {
  newUserUUID,
  newBadgeHash,
  newPwResetToken
} from './dbUtils';

// Mock Prisma
vi.mock('$lib/server/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    },
    badge: {
      findFirst: vi.fn()
    },
    userPasswordReset: {
      findUnique: vi.fn()
    }
  }
}));

// Mock UUID generator
vi.mock('uuid', () => ({
  v4: vi.fn()
}));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newUserUUID', () => {
  it('should return a UUID when it does not already exist', async () => {
    vi.mocked(uuidv4).mockReturnValueOnce('uuid-123' as never);

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    const result = await newUserUUID();

    expect(result).toBe('uuid-123');

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'uuid-123'
      }
    });
  });

  it('should generate another UUID when the first UUID already exists', async () => {
    vi.mocked(uuidv4)
      .mockReturnValueOnce('uuid-existing' as never)
      .mockReturnValueOnce('uuid-new' as never);

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ id: 'uuid-existing' } as never)
      .mockResolvedValueOnce(null);

    const result = await newUserUUID();

    expect(result).toBe('uuid-new');

    expect(uuidv4).toHaveBeenCalledTimes(2);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'uuid-existing'
      }
    });

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'uuid-new'
      }
    });
  });
});

describe('newBadgeHash', () => {
  it('should return a badge hash with the supplied prefix and six-digit suffix', async () => {
    // Math.floor(0.000042 * 1000000) = 42
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.000042);

    vi.mocked(prisma.badge.findFirst).mockResolvedValueOnce(null);

    const result = await newBadgeHash('user-123', 7);

    expect(result).toBe('7000042');

    expect(prisma.badge.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.badge.findFirst).toHaveBeenCalledWith({
      where: {
        hash: '7000042',
        userId: 'user-123'
      }
    });
  });

  it('should generate another badge hash when the first hash already exists', async () => {
    // First random number: 123456
    // Second random number: 000007
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.123456)
      .mockReturnValueOnce(0.000007);

    vi.mocked(prisma.badge.findFirst)
      .mockResolvedValueOnce({ hash: '3123456' } as never)
      .mockResolvedValueOnce(null);

    const result = await newBadgeHash('user-456', 3);

    expect(result).toBe('3000007');

    expect(prisma.badge.findFirst).toHaveBeenCalledTimes(2);

    expect(prisma.badge.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        hash: '3123456',
        userId: 'user-456'
      }
    });

    expect(prisma.badge.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        hash: '3000007',
        userId: 'user-456'
      }
    });
  });
});

describe('newPwResetToken', () => {
  it('should return a token when it does not already exist', async () => {
    vi.mocked(uuidv4).mockReturnValueOnce('token-123' as never);

    vi.mocked(prisma.userPasswordReset.findUnique)
      .mockResolvedValueOnce(null);

    const result = await newPwResetToken();

    expect(result).toBe('token-123');

    expect(prisma.userPasswordReset.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.userPasswordReset.findUnique).toHaveBeenCalledWith({
      where: {
        token: 'token-123'
      }
    });
  });

  it('should generate another token when the first token already exists', async () => {
    vi.mocked(uuidv4)
      .mockReturnValueOnce('token-existing' as never)
      .mockReturnValueOnce('token-new' as never);

    vi.mocked(prisma.userPasswordReset.findUnique)
      .mockResolvedValueOnce({ token: 'token-existing' } as never)
      .mockResolvedValueOnce(null);

    const result = await newPwResetToken();

    expect(result).toBe('token-new');

    expect(uuidv4).toHaveBeenCalledTimes(2);
    expect(prisma.userPasswordReset.findUnique).toHaveBeenCalledTimes(2);

    expect(prisma.userPasswordReset.findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        token: 'token-existing'
      }
    });

    expect(prisma.userPasswordReset.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        token: 'token-new'
      }
    });
  });
});
