import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requireLogin: vi.fn(),
  auditCreate: vi.fn(),
  randomInt: vi.fn((maximum: number) => 0)
}));

vi.mock('node:crypto', () => ({
  randomInt: mocks.randomInt
}));

vi.mock('@sveltejs/kit', () => ({
  error: (status: number, message: string) =>
    Object.assign(new Error(message), { status, body: message })
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique
    },
    adminAuditLog: {
      create: mocks.auditCreate
    }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_MANAGER_LEVEL,
  MAX_MANAGED_PASSWORD_LENGTH,
  MIN_MANAGED_PASSWORD_LENGTH,
  generateManagedPassword,
  requireAdminManager,
  requireManageableTarget,
  validateManagedPassword,
  writeAdminAuditLog
} from './admin';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.randomInt.mockImplementation((maximum: number) => 0);
});

describe('requireAdminManager', () => {
  const cookies = {} as Cookies;

  function mockActor(overrides: Record<string, unknown> = {}) {
    mocks.requireLogin.mockReturnValue({ id: 'actor' });
    mocks.findUnique.mockResolvedValue({
      id: 'actor',
      email: 'actor@example.at',
      isAdmin: ADMIN_MANAGER_LEVEL,
      isDeleted: 0,
      blockedAt: null,
      ...overrides
    });
  }

  it('returns the authorized actor', async () => {
    mockActor();

    await expect(requireAdminManager(cookies)).resolves.toEqual({
      id: 'actor',
      email: 'actor@example.at',
      isAdmin: ADMIN_MANAGER_LEVEL
    });
  });

  it('allows higher role levels', async () => {
    mockActor({ isAdmin: 7 });

    await expect(requireAdminManager(cookies)).resolves.toMatchObject({ isAdmin: 7 });
  });

  it('rejects insufficient role levels', async () => {
    mockActor({ isAdmin: ADMIN_MANAGER_LEVEL - 1 });

    await expect(requireAdminManager(cookies)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects deleted actors', async () => {
    mockActor({ isDeleted: 1 });

    await expect(requireAdminManager(cookies)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects blocked actors', async () => {
    mockActor({ blockedAt: new Date() });

    await expect(requireAdminManager(cookies)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects when the database has no matching actor', async () => {
    mocks.requireLogin.mockReturnValue({ id: 'missing' });
    mocks.findUnique.mockResolvedValue(null);

    await expect(requireAdminManager(cookies)).rejects.toMatchObject({ status: 403 });
  });

  it('supports a custom minimum role level', async () => {
    mockActor({ isAdmin: 8 });

    await expect(requireAdminManager(cookies, 9)).rejects.toMatchObject({ status: 403 });
  });
});

describe('requireManageableTarget', () => {
  const actor = { id: 'actor', email: 'actor@example.at', isAdmin: 6 };

  it('returns a manageable target', async () => {
    const target = { id: 'target', email: 'target@example.at', isAdmin: 5, isDeleted: 0 };
    mocks.findUnique.mockResolvedValue(target);

    await expect(requireManageableTarget(actor, 'target')).resolves.toBe(target);
  });

  it('rejects a missing target', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(requireManageableTarget(actor, 'missing')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a deleted target', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'target', isAdmin: 5, isDeleted: 1 });

    await expect(requireManageableTarget(actor, 'target')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects the actor own account', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'actor', isAdmin: 6, isDeleted: 0 });

    await expect(requireManageableTarget(actor, 'actor')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects targets with equal or higher role levels', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'target', isAdmin: 6, isDeleted: 0 });

    await expect(requireManageableTarget(actor, 'target')).rejects.toMatchObject({ status: 403 });
  });
});

describe('validateManagedPassword', () => {
  it('accepts passwords within the allowed length', () => {
    expect(validateManagedPassword('test')).toBeNull();
    expect(validateManagedPassword('a'.repeat(MAX_MANAGED_PASSWORD_LENGTH))).toBeNull();
  });

  it('rejects passwords shorter than the minimum', () => {
    expect(validateManagedPassword('a'.repeat(MIN_MANAGED_PASSWORD_LENGTH - 1))).toContain(
      `${MIN_MANAGED_PASSWORD_LENGTH}`
    );
  });

  it('rejects passwords longer than the maximum', () => {
    expect(validateManagedPassword('a'.repeat(MAX_MANAGED_PASSWORD_LENGTH + 1))).toContain(
      `${MAX_MANAGED_PASSWORD_LENGTH}`
    );
  });
});

describe('generateManagedPassword', () => {
  it('creates a password of the requested length', () => {
    expect(generateManagedPassword(32)).toHaveLength(32);
  });

  it('uses the default length when omitted', () => {
    expect(generateManagedPassword()).toHaveLength(20);
  });

  it('includes one character from each required character group', () => {
    const password = generateManagedPassword(4);

    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[2-9]/);
    expect(password).toMatch(/[!@#$%&*+\-=?]/);
  });

  it('rejects lengths below four', () => {
    expect(() => generateManagedPassword(3)).toThrow(/mindestens vier Zeichen/i);
  });
});

describe('writeAdminAuditLog', () => {
  it('stores a complete audit entry', async () => {
    await writeAdminAuditLog({
      actorUserId: 'actor',
      targetUserId: 'target',
      action: ADMIN_AUDIT_ACTIONS.ROLE_CHANGED,
      outcome: 'SUCCESS',
      metadata: { oldRole: 5, newRole: 6, reason: null }
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'actor',
        targetUserId: 'target',
        action: 'ROLE_CHANGED',
        outcome: 'SUCCESS',
        metadata: { oldRole: 5, newRole: 6, reason: null }
      }
    });
  });

  it('stores an entry without optional metadata', async () => {
    await writeAdminAuditLog({
      actorUserId: 'actor',
      targetUserId: 'target',
      action: ADMIN_AUDIT_ACTIONS.USER_BLOCKED,
      outcome: 'FAILED'
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'actor',
        targetUserId: 'target',
        action: 'USER_BLOCKED',
        outcome: 'FAILED',
        metadata: undefined
      }
    });
  });
});
