
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep all external dependencies mocked.
const mocks = vi.hoisted(() => ({
  prisma: {
    userPasswordReset: {
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn()
  },
  newPwResetToken: vi.fn(),
  sendMail: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_APP_URL: 'https://app.example.test'
  }
}));

vi.mock('$lib/server/db', () => ({
  prisma: mocks.prisma
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
  passwordResetExpiry,
  isPasswordResetExpired,
  passwordResetLimitReached,
  sendPasswordResetLink,
  sendManagerPasswordChangedNotice
} from './passwordReset';

const FIXED_NOW = new Date('2025-04-10T12:00:00.000Z');

const TEST_USER = {
  id: 'user-123',
  email: 'anna+test@example.com'
};

beforeEach(() => {
  vi.resetAllMocks();

  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  // Default successful mock implementations.
  mocks.prisma.userPasswordReset.count.mockResolvedValue(0);
  mocks.prisma.userPasswordReset.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.userPasswordReset.create.mockResolvedValue({});
  mocks.prisma.userPasswordReset.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockResolvedValue([]);

  mocks.newPwResetToken.mockResolvedValue('test-reset-token');
  mocks.sendMail.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

describe('password reset constants', () => {
  it('defines a password reset lifetime of 60 minutes', () => {
    expect(PASSWORD_RESET_LIFETIME_MS).toBe(60 * 60 * 1000);
  });

  it('allows at most five password reset requests per hour', () => {
    expect(PASSWORD_RESET_MAX_PER_HOUR).toBe(5);
  });
});

// -----------------------------------------------------------------------------
// passwordResetLimitReached
// -----------------------------------------------------------------------------

describe('passwordResetLimitReached', () => {
  it('returns false when fewer than five reset requests exist', async () => {
    mocks.prisma.userPasswordReset.count.mockResolvedValue(4);

    const result = await passwordResetLimitReached(
      TEST_USER.id,
      FIXED_NOW
    );

    expect(result).toBe(false);
  });

  it('returns true when exactly five reset requests exist', async () => {
    mocks.prisma.userPasswordReset.count.mockResolvedValue(5);

    const result = await passwordResetLimitReached(
      TEST_USER.id,
      FIXED_NOW
    );

    expect(result).toBe(true);
  });

  it('returns true when more than five reset requests exist', async () => {
    mocks.prisma.userPasswordReset.count.mockResolvedValue(6);

    const result = await passwordResetLimitReached(
      TEST_USER.id,
      FIXED_NOW
    );

    expect(result).toBe(true);
  });

  it('queries only reset requests belonging to the specified user within the last hour', async () => {
    await passwordResetLimitReached(TEST_USER.id, FIXED_NOW);

    expect(mocks.prisma.userPasswordReset.count).toHaveBeenCalledWith({
      where: {
        userId: TEST_USER.id,
        createdAt: {
          gt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000)
        }
      }
    });
  });
});

// -----------------------------------------------------------------------------
// passwordResetExpiry
// -----------------------------------------------------------------------------

describe('passwordResetExpiry', () => {
  it('returns a date exactly 60 minutes after the supplied date', () => {
    const start = new Date('2025-04-10T10:00:00.000Z');

    const result = passwordResetExpiry(start);

    expect(result).toEqual(
      new Date('2025-04-10T11:00:00.000Z')
    );
  });

  it('uses the current date when no argument is supplied', () => {
    const result = passwordResetExpiry();

    expect(result).toEqual(
      new Date(FIXED_NOW.getTime() + PASSWORD_RESET_LIFETIME_MS)
    );
  });
});

// -----------------------------------------------------------------------------
// isPasswordResetExpired
// -----------------------------------------------------------------------------

describe('isPasswordResetExpired', () => {
  it('returns true when expiresAt is equal to the current time', () => {
    const result = isPasswordResetExpired(
      {
        createdAt: new Date('2025-04-10T11:00:00.000Z'),
        expiresAt: FIXED_NOW
      },
      FIXED_NOW
    );

    expect(result).toBe(true);
  });

  it('returns true when expiresAt is in the past', () => {
    const result = isPasswordResetExpired(
      {
        createdAt: FIXED_NOW,
        expiresAt: new Date(FIXED_NOW.getTime() - 1000)
      },
      FIXED_NOW
    );

    expect(result).toBe(true);
  });

  it('returns false when expiresAt is in the future', () => {
    const result = isPasswordResetExpired(
      {
        createdAt: FIXED_NOW,
        expiresAt: new Date(FIXED_NOW.getTime() + 1000)
      },
      FIXED_NOW
    );

    expect(result).toBe(false);
  });

  it('calculates the expiry from createdAt when expiresAt is null', () => {
    const createdAt = new Date('2025-04-10T11:00:00.000Z');

    const result = isPasswordResetExpired(
      {
        createdAt,
        expiresAt: null
      },
      FIXED_NOW
    );

    // Created at 11:00, expires at 12:00.
    expect(result).toBe(true);
  });

  it('returns false when the fallback expiry is still in the future', () => {
    const createdAt = new Date('2025-04-10T11:00:01.000Z');

    const result = isPasswordResetExpired(
      {
        createdAt,
        expiresAt: null
      },
      FIXED_NOW
    );

    expect(result).toBe(false);
  });

  it('treats a reset without createdAt and expiresAt as expired', () => {
    const result = isPasswordResetExpired(
      {
        createdAt: null,
        expiresAt: null
      },
      FIXED_NOW
    );

    expect(result).toBe(true);
  });

  it('prefers expiresAt over the calculated fallback expiry', () => {
    const result = isPasswordResetExpired(
      {
        createdAt: new Date('2025-04-10T10:00:00.000Z'),
        expiresAt: new Date('2025-04-10T13:00:00.000Z')
      },
      FIXED_NOW
    );

    expect(result).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// sendPasswordResetLink
// -----------------------------------------------------------------------------

describe('sendPasswordResetLink', () => {
  it('generates a token, finishes previous resets, creates a new reset and sends an email', async () => {
    await sendPasswordResetLink(TEST_USER);

    // Token generation.
    expect(mocks.newPwResetToken).toHaveBeenCalledOnce();

    // Existing unfinished reset requests must be marked as finished.
    expect(
      mocks.prisma.userPasswordReset.updateMany
    ).toHaveBeenCalledWith({
      where: {
        userId: TEST_USER.id,
        finishedAt: null
      },
      data: {
        finishedAt: FIXED_NOW
      }
    });

    // A new reset request must be created.
    expect(
      mocks.prisma.userPasswordReset.create
    ).toHaveBeenCalledWith({
      data: {
        token: 'test-reset-token',
        userId: TEST_USER.id,
        expiresAt: new Date(
          FIXED_NOW.getTime() + PASSWORD_RESET_LIFETIME_MS
        )
      }
    });

    // Both database operations must be passed to a transaction.
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();

    const transactionOperations =
      mocks.prisma.$transaction.mock.calls[0]?.[0];

    expect(transactionOperations).toHaveLength(2);

    // The reset email must be sent to the user's email address.
    expect(mocks.sendMail).toHaveBeenCalledOnce();

    expect(mocks.sendMail).toHaveBeenCalledWith(
      TEST_USER.email,
      'Passwort zurücksetzen',
      expect.stringContaining(
        `https://app.example.test/passwort/${encodeURIComponent(TEST_USER.email)}/test-reset-token`
      )
    );
  });

  it('includes the expiration information in the reset email', async () => {
    await sendPasswordResetLink(TEST_USER);

    const emailBody = mocks.sendMail.mock.calls[0]?.[2];

    expect(emailBody).toContain(TEST_USER.email);
    expect(emailBody).toContain('innerhalb von 60 Minuten');
    expect(emailBody).toContain('https://app.example.test/passwort/');
  });

  it('does not access the database when token generation fails', async () => {
    const error = new Error('Token generation failed');

    mocks.newPwResetToken.mockRejectedValueOnce(error);

    await expect(
      sendPasswordResetLink(TEST_USER)
    ).rejects.toBe(error);

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('does not send an email when the database transaction fails', async () => {
    const error = new Error('Database transaction failed');

    mocks.prisma.$transaction.mockRejectedValueOnce(error);

    await expect(
      sendPasswordResetLink(TEST_USER)
    ).rejects.toBe(error);

    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('marks the newly created reset token as finished when sending the email fails', async () => {
    const mailError = new Error('SMTP server unavailable');

    mocks.sendMail.mockRejectedValueOnce(mailError);

    await expect(
      sendPasswordResetLink(TEST_USER)
    ).rejects.toBe(mailError);

    expect(mocks.prisma.userPasswordReset.update).toHaveBeenCalledWith({
      where: {
        token: 'test-reset-token'
      },
      data: {
        finishedAt: FIXED_NOW
      }
    });
  });

  it('propagates the original email error after successfully invalidating the token', async () => {
    const mailError = new Error('Email delivery failed');

    mocks.sendMail.mockRejectedValueOnce(mailError);
    mocks.prisma.userPasswordReset.update.mockResolvedValueOnce({});

    await expect(
      sendPasswordResetLink(TEST_USER)
    ).rejects.toBe(mailError);
  });
});

// -----------------------------------------------------------------------------
// sendManagerPasswordChangedNotice
// -----------------------------------------------------------------------------

describe('sendManagerPasswordChangedNotice', () => {
  it('sends a password-changed notification to the specified email address', async () => {
    const email = 'anna@example.com';

    await sendManagerPasswordChangedNotice(email);

    expect(mocks.sendMail).toHaveBeenCalledOnce();

    expect(mocks.sendMail).toHaveBeenCalledWith(
      email,
      'Ihr Passwort wurde geändert',
      expect.stringContaining(
        'von einem Manager geändert'
      )
    );
  });

  it('includes instructions to contact the responsible support person', async () => {
    const email = 'anna@example.com';

    await sendManagerPasswordChangedNotice(email);

    const emailBody = mocks.sendMail.mock.calls[0]?.[2];

    expect(emailBody).toContain(
      'wenden Sie sich bitte umgehend'
    );
    expect(emailBody).toContain('prompting.schule');
  });

  it('propagates email delivery errors', async () => {
    const error = new Error('SMTP server unavailable');

    mocks.sendMail.mockRejectedValueOnce(error);

    await expect(
      sendManagerPasswordChangedNotice('anna@example.com')
    ).rejects.toBe(error);
  });
});
