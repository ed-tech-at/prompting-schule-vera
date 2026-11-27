import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { prisma } from '$lib/server/db';
import { requireLogin } from '$lib/server/jwt';

import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_MANAGER_LEVEL,
  MAX_MANAGED_PASSWORD_LENGTH,
  MIN_MANAGED_PASSWORD_LENGTH,
  generateManagedPassword,
  requireAdminManager,
  requireManageableTarget,
  validateManagedPassword,
  writeAdminAuditLog,
  type AdminActor
} from './admin';

// Mock external dependencies
vi.mock('$lib/server/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    },
    adminAuditLog: {
      create: vi.fn()
    }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: vi.fn()
}));

const cookies = {} as Cookies;

const managerRecord = {
  id: 'manager-1',
  email: 'manager@example.test',
  isAdmin: ADMIN_MANAGER_LEVEL,
  isDeleted: false,
  blockedAt: null
};

const manager: AdminActor = {
  id: 'manager-1',
  email: 'manager@example.test',
  isAdmin: ADMIN_MANAGER_LEVEL
};

function mockFindUnique(result: unknown) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(result as never);
}

/**
 * Assert a SvelteKit HttpError without depending on whether
 * the error body is represented as a string or an object.
 */
async function expectHttpError(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedMessage: string
) {
  let thrown: unknown;

  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeDefined();

  const httpError = thrown as {
    status?: number;
    body?: string | { message?: string };
  };

  expect(httpError.status).toBe(expectedStatus);

  const actualMessage =
    typeof httpError.body === 'string'
      ? httpError.body
      : httpError.body?.message;

  expect(actualMessage).toBe(expectedMessage);
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(requireLogin).mockReturnValue({
    id: manager.id
  } as never);

  mockFindUnique(managerRecord);

  vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as never);
});

// -----------------------------------------------------------------------------
// requireAdminManager
// -----------------------------------------------------------------------------

describe('requireAdminManager', () => {
  it('returns the authenticated admin actor', async () => {
    const result = await requireAdminManager(cookies);

    expect(result).toEqual(manager);

    expect(requireLogin).toHaveBeenCalledWith(cookies);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        id: manager.id
      },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        isDeleted: true,
        blockedAt: true
      }
    });
  });

  it('does not expose internal user properties in the returned actor', async () => {
    const result = await requireAdminManager(cookies);

    expect(result).not.toHaveProperty('isDeleted');
    expect(result).not.toHaveProperty('blockedAt');
  });

  it('throws 403 when the user does not exist', async () => {
    mockFindUnique(null);

    await expectHttpError(
      requireAdminManager(cookies),
      403,
      `Für diesen Bereich ist mindestens Rollenstufe ${ADMIN_MANAGER_LEVEL} erforderlich.`
    );
  });

  it('throws 403 when the user is deleted', async () => {
    mockFindUnique({
      ...managerRecord,
      isDeleted: true
    });

    await expectHttpError(
      requireAdminManager(cookies),
      403,
      `Für diesen Bereich ist mindestens Rollenstufe ${ADMIN_MANAGER_LEVEL} erforderlich.`
    );
  });

  it('throws 403 when the user is blocked', async () => {
    mockFindUnique({
      ...managerRecord,
      blockedAt: new Date()
    });

    await expectHttpError(
      requireAdminManager(cookies),
      403,
      `Für diesen Bereich ist mindestens Rollenstufe ${ADMIN_MANAGER_LEVEL} erforderlich.`
    );
  });

  it('throws 403 when the user has insufficient admin privileges', async () => {
    mockFindUnique({
      ...managerRecord,
      isAdmin: ADMIN_MANAGER_LEVEL - 1
    });

    await expectHttpError(
      requireAdminManager(cookies),
      403,
      `Für diesen Bereich ist mindestens Rollenstufe ${ADMIN_MANAGER_LEVEL} erforderlich.`
    );
  });

  it('uses a custom minimum admin level when provided', async () => {
    mockFindUnique({
      ...managerRecord,
      isAdmin: 3
    });

    const result = await requireAdminManager(cookies, 3);

    expect(result.isAdmin).toBe(3);
  });

  it('rejects an admin below a custom minimum level', async () => {
    mockFindUnique({
      ...managerRecord,
      isAdmin: 5
    });

    await expectHttpError(
      requireAdminManager(cookies, 7),
      403,
      'Für diesen Bereich ist mindestens Rollenstufe 7 erforderlich.'
    );
  });

  it('propagates authentication errors', async () => {
    vi.mocked(requireLogin).mockImplementation(() => {
      throw new Error('Not authenticated');
    });

    await expect(requireAdminManager(cookies)).rejects.toThrow(
      'Not authenticated'
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// requireManageableTarget
// -----------------------------------------------------------------------------

describe('requireManageableTarget', () => {
  const targetUserId = 'target-1';

  const targetRecord = {
    id: targetUserId,
    email: 'target@example.test',
    isAdmin: 2,
    isDeleted: false
  };

  it('returns a manageable target user', async () => {
    mockFindUnique(targetRecord);

    const result = await requireManageableTarget(manager, targetUserId);

    expect(result).toBe(targetRecord);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        id: targetUserId
      }
    });
  });

  it('throws 404 when the target user does not exist', async () => {
    mockFindUnique(null);

    await expectHttpError(
      requireManageableTarget(manager, targetUserId),
      404,
      'Benutzer wurde nicht gefunden.'
    );
  });

  it('throws 404 when the target user is deleted', async () => {
    mockFindUnique({
      ...targetRecord,
      isDeleted: true
    });

    await expectHttpError(
      requireManageableTarget(manager, targetUserId),
      404,
      'Benutzer wurde nicht gefunden.'
    );
  });

  it('throws 403 when an admin tries to manage their own account', async () => {
    mockFindUnique({
      ...targetRecord,
      id: manager.id,
      isAdmin: manager.isAdmin
    });

    await expectHttpError(
      requireManageableTarget(manager, manager.id),
      403,
      'Das eigene Konto kann hier nicht verwaltet werden.'
    );
  });

  it.each([ADMIN_MANAGER_LEVEL, ADMIN_MANAGER_LEVEL + 1])(
    'throws 403 when the target has admin level %i',
    async (targetAdminLevel) => {
      mockFindUnique({
        ...targetRecord,
        isAdmin: targetAdminLevel
      });

      await expectHttpError(
        requireManageableTarget(manager, targetUserId),
        403,
        'Benutzer mit gleicher oder höherer Rollenstufe können nicht verwaltet werden.'
      );
    }
  );

  it('allows managing users with a lower admin level', async () => {
    const lowerLevelUser = {
      ...targetRecord,
      isAdmin: ADMIN_MANAGER_LEVEL - 1
    };

    mockFindUnique(lowerLevelUser);

    const result = await requireManageableTarget(manager, targetUserId);

    expect(result).toBe(lowerLevelUser);
  });
});

// -----------------------------------------------------------------------------
// validateManagedPassword
// -----------------------------------------------------------------------------

describe('validateManagedPassword', () => {
  it('rejects an empty password', () => {
    expect(validateManagedPassword('')).toBe(
      `Das Passwort muss mindestens ${MIN_MANAGED_PASSWORD_LENGTH} Zeichen lang sein.`
    );
  });

  it('rejects passwords shorter than the minimum length', () => {
    expect(validateManagedPassword('abc')).toBe(
      `Das Passwort muss mindestens ${MIN_MANAGED_PASSWORD_LENGTH} Zeichen lang sein.`
    );
  });

  it('accepts a password with exactly the minimum length', () => {
    expect(
      validateManagedPassword('a'.repeat(MIN_MANAGED_PASSWORD_LENGTH))
    ).toBeNull();
  });

  it('accepts a password with exactly the maximum length', () => {
    expect(
      validateManagedPassword('a'.repeat(MAX_MANAGED_PASSWORD_LENGTH))
    ).toBeNull();
  });

  it('rejects passwords longer than the maximum length', () => {
    expect(
      validateManagedPassword('a'.repeat(MAX_MANAGED_PASSWORD_LENGTH + 1))
    ).toBe(
      `Das Passwort darf höchstens ${MAX_MANAGED_PASSWORD_LENGTH} Zeichen lang sein.`
    );
  });
});

// -----------------------------------------------------------------------------
// generateManagedPassword
// -----------------------------------------------------------------------------

describe('generateManagedPassword', () => {
  const characterGroups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&*+-=?'
  ];

  const allAllowedCharacters = characterGroups.join('');

  function expectValidGeneratedPassword(
    password: string,
    expectedLength: number
  ) {
    expect(password).toHaveLength(expectedLength);

    // Every character must belong to an allowed character group.
    for (const character of password) {
      expect(allAllowedCharacters).toContain(character);
    }

    // Every generated password must contain at least one character
    // from each required group.
    for (const group of characterGroups) {
      expect([...password].some((character) => group.includes(character))).toBe(
        true
      );
    }

    // Ambiguous characters are intentionally excluded.
    expect(password).not.toMatch(/[IO01l]/);
  }

  it('generates a password with the default length of 20', () => {
    const password = generateManagedPassword();

    expectValidGeneratedPassword(password, 20);
  });

  it.each([4, 5, 10, 50, 128])(
    'generates a valid password with length %i',
    (length) => {
      const password = generateManagedPassword(length);

      expectValidGeneratedPassword(password, length);
    }
  );

  it('generates a password with exactly the minimum supported length', () => {
    const password = generateManagedPassword(4);

    expect(password).toHaveLength(4);

    for (const group of characterGroups) {
      expect([...password].some((character) => group.includes(character))).toBe(
        true
      );
    }
  });

  it('throws when the requested length is less than four', () => {
    expect(() => generateManagedPassword(3)).toThrow(
      'Das zufällige Passwort muss mindestens vier Zeichen lang sein.'
    );
  });

  it('throws when the requested length is zero', () => {
    expect(() => generateManagedPassword(0)).toThrow(
      'Das zufällige Passwort muss mindestens vier Zeichen lang sein.'
    );
  });

  it('throws when the requested length is negative', () => {
    expect(() => generateManagedPassword(-1)).toThrow(
      'Das zufällige Passwort muss mindestens vier Zeichen lang sein.'
    );
  });
});

// -----------------------------------------------------------------------------
// writeAdminAuditLog
// -----------------------------------------------------------------------------

describe('writeAdminAuditLog', () => {
  it('writes an audit log with all provided fields', async () => {
    const input = {
      actorUserId: manager.id,
      targetUserId: 'target-1',
      action: ADMIN_AUDIT_ACTIONS.PASSWORD_SET_MANUAL,
      outcome: 'SUCCESS' as const,
      metadata: {
        source: 'admin-panel',
        passwordLength: 12,
        forced: true,
        previousValue: null
      }
    };

    await writeAdminAuditLog(input);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledOnce();

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        action: input.action,
        outcome: input.outcome,
        metadata: input.metadata
      }
    });
  });

  it('supports FAILED audit log outcomes', async () => {
    const input = {
      actorUserId: manager.id,
      targetUserId: 'target-1',
      action: ADMIN_AUDIT_ACTIONS.USER_BLOCKED,
      outcome: 'FAILED' as const
    };

    await writeAdminAuditLog(input);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        action: input.action,
        outcome: input.outcome,
        metadata: undefined
      }
    });
  });

  it('propagates Prisma errors', async () => {
    vi.mocked(prisma.adminAuditLog.create).mockRejectedValue(
      new Error('Database connection failed')
    );

    await expect(
      writeAdminAuditLog({
        actorUserId: manager.id,
        targetUserId: 'target-1',
        action: ADMIN_AUDIT_ACTIONS.USER_DELETED,
        outcome: 'FAILED'
      })
    ).rejects.toThrow('Database connection failed');
  });
});
