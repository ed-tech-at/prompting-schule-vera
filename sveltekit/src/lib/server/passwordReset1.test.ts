import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resetCount: vi.fn(),
  updateMany: vi.fn(),
  resetCreate: vi.fn(),
  resetUpdate: vi.fn(),
  transaction: vi.fn(),
  newPwResetToken: vi.fn(),
  sendMail: vi.fn(),
  env: { PUBLIC_APP_URL: 'https://prompting.schule' }
}));

vi.mock('$env/dynamic/public', () => ({ env: mocks.env }));

vi.mock('$lib/server/db', () => ({
  prisma: {
    userPasswordReset: {
      count: mocks.resetCount,
      updateMany: mocks.updateMany,
      create: mocks.resetCreate,
      update: mocks.resetUpdate
    },
    $transaction: mocks.transaction
  }
}));

vi.mock('$lib/server/dbUtils', () => ({
  newPwResetToken: mocks.newPwResetToken
}));

vi.mock('$lib/server/email', () => ({
  sendMail: mocks.sendMail
}));

import {
  PASSWORD_RESET_LIFETIME_MS,
  PASSWORD_RESET_MAX_PER_HOUR,
  isPasswordResetExpired,
  passwordResetExpiry,
  passwordResetLimitReached,
  sendManagerPasswordChangedNotice,
  sendPasswordResetLink
} from './passwordReset';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.updateMany.mockReturnValue({ kind: 'updateMany' });
  mocks.resetCreate.mockReturnValue({ kind: 'create' });
  mocks.transaction.mockResolvedValue([]);
  mocks.resetUpdate.mockResolvedValue({});
  mocks.newPwResetToken.mockResolvedValue('reset-token');
  mocks.sendMail.mockResolvedValue(undefined);
});

describe('passwordResetLimitReached', () => {
  it('counts recent resets for the user within the last hour', async () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    mocks.resetCount.mockResolvedValue(2);

    await expect(passwordResetLimitReached('user-1', now)).resolves.toBe(false);

    expect(mocks.resetCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        createdAt: { gt: new Date('2026-11-25T11:00:00.000Z') }
      }
    });
  });

  it('allows exactly fewer than the configured maximum', async () => {
    mocks.resetCount.mockResolvedValue(PASSWORD_RESET_MAX_PER_HOUR - 1);

    await expect(passwordResetLimitReached('user-1')).resolves.toBe(false);
  });

  it('rejects a reset when the maximum has been reached', async () => {
    mocks.resetCount.mockResolvedValue(PASSWORD_RESET_MAX_PER_HOUR);

    await expect(passwordResetLimitReached('user-1')).resolves.toBe(true);
  });

  it('rejects a reset when the count exceeds the maximum', async () => {
    mocks.resetCount.mockResolvedValue(PASSWORD_RESET_MAX_PER_HOUR + 3);

    await expect(passwordResetLimitReached('user-1')).resolves.toBe(true);
  });
});

describe('passwordResetExpiry', () => {
  it('adds one hour to the supplied date', () => {
    const from = new Date('2026-11-25T12:00:00.000Z');

    expect(passwordResetExpiry(from)).toEqual(
      new Date(from.getTime() + PASSWORD_RESET_LIFETIME_MS)
    );
  });
});

describe('isPasswordResetExpired', () => {
  const now = new Date('2026-11-25T12:00:00.000Z');

  it('uses expiresAt when present', () => {
    expect(isPasswordResetExpired({
      createdAt: new Date('2026-11-25T10:00:00.000Z'),
      expiresAt: new Date('2026-11-25T12:00:00.000Z')
    }, now)).toBe(true);

    expect(isPasswordResetExpired({
      createdAt: new Date('2026-11-25T10:00:00.000Z'),
      expiresAt: new Date('2026-11-25T12:00:00.001Z')
    }, now)).toBe(false);
  });

  it('falls back to createdAt plus one hour', () => {
    expect(isPasswordResetExpired({
      createdAt: new Date('2026-11-25T11:00:00.000Z'),
      expiresAt: null
    }, now)).toBe(true);

    expect(isPasswordResetExpired({
      createdAt: new Date('2026-11-25T11:00:00.001Z'),
      expiresAt: null
    }, now)).toBe(false);
  });

  it('treats a reset without either timestamp as expired', () => {
    expect(isPasswordResetExpired({ createdAt: null, expiresAt: null }, now)).toBe(true);
  });
});

describe('sendPasswordResetLink', () => {
  it('invalidates previous resets and creates and mails a new reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));

    await sendPasswordResetLink({ id: 'user-1', email: 'user+tag@example.test' });

    expect(mocks.newPwResetToken).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', finishedAt: null },
      data: { finishedAt: new Date('2026-11-25T12:00:00.000Z') }
    });
    expect(mocks.resetCreate).toHaveBeenCalledWith({
      data: {
        token: 'reset-token',
        userId: 'user-1',
        expiresAt: new Date('2026-11-25T13:00:00.000Z')
      }
    });
    expect(mocks.transaction).toHaveBeenCalledWith([
      { kind: 'updateMany' },
      { kind: 'create' }
    ]);

    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    const [email, subject, text] = mocks.sendMail.mock.calls[0];
    expect(email).toBe('user+tag@example.test');
    expect(subject).toBe('Passwort zurücksetzen');
    expect(text).toContain(
      'https://prompting.schule/passwort/user%2Btag%40example.test/reset-token'
    );
  });

  it('marks the reset as finished and rethrows when mail sending fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    const mailError = new Error('SMTP unavailable');
    mocks.sendMail.mockRejectedValue(mailError);

    await expect(
      sendPasswordResetLink({ id: 'user-1', email: 'person@example.test' })
    ).rejects.toBe(mailError);

    expect(mocks.resetUpdate).toHaveBeenCalledWith({
      where: { token: 'reset-token' },
      data: { finishedAt: new Date('2026-11-25T12:00:00.000Z') }
    });
  });
});

describe('sendManagerPasswordChangedNotice', () => {
  it('sends the manager password-change notice', async () => {
    await sendManagerPasswordChangedNotice('person@example.test');

    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    const [email, subject, text] = mocks.sendMail.mock.calls[0];
    expect(email).toBe('person@example.test');
    expect(subject).toBe('Ihr Passwort wurde geändert');
    expect(text).toContain('das Passwort Ihres Kontos');
  });
});
