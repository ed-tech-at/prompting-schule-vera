import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  passwordAuthDisabled: vi.fn(),
  hashPasswordV2: vi.fn(),
  login: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
  isPasswordResetExpired: vi.fn()
}));

vi.mock('$lib/server/pw.js', () => ({
  passwordAuthDisabled: mocks.passwordAuthDisabled,
  hashPasswordV2: mocks.hashPasswordV2,
  login: mocks.login
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    userPasswordReset: { findUnique: mocks.findUnique },
    user: { update: mocks.userUpdate },
    $transaction: mocks.transaction
  }
}));

vi.mock('$lib/server/passwordReset', () => ({
  isPasswordResetExpired: mocks.isPasswordResetExpired
}));

import { POST } from './+server';

function requestBody(body: unknown) {
  return {
    request: {
      json: vi.fn().mockResolvedValue(body)
    }
  } as Parameters<typeof POST>[0];
}

async function post(body: unknown): Promise<Response> {
  const response = await POST(requestBody(body));
  if (!response) throw new Error('POST returned no response');
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.passwordAuthDisabled.mockReturnValue(false);
  mocks.isPasswordResetExpired.mockReturnValue(false);
  mocks.hashPasswordV2.mockResolvedValue('hashed-new-password');
  mocks.login.mockResolvedValue(new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
    callback({
      userPasswordReset: { updateMany: mocks.updateMany },
      user: { update: mocks.userUpdate }
    })
  );
});

describe('POST passwortReset', () => {
  it('rejects password reset in SSO-only mode', async () => {
    mocks.passwordAuthDisabled.mockReturnValue(true);

    const response = await post({});

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Passwort-Zurücksetzen ist deaktiviert.'
    });
  });

  it('requires token, password and userId', async () => {
    const response = await post({
      action: 'passwortReset',
      formData: { token: 'token-1', password: '' }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Token und neues Passwort sind erforderlich.'
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired reset token', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await post({
      action: 'passwortReset',
      formData: { token: 'bad-token', password: 'new-secret', userId: 'user-1' }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Ungültiger oder abgelaufener Token.'
    });
  });

  it('rejects reset entries for deleted, blocked or unsupported users', async () => {
    mocks.findUnique.mockResolvedValue({
      token: 'token-1',
      userId: 'user-1',
      finishedAt: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-1',
        email: 'user@example.test',
        isDeleted: true,
        blockedAt: null,
        cryptVersion: 2
      }
    });

    const response = await post({
      action: 'passwortReset',
      formData: { token: 'token-1', password: 'new-secret', userId: 'user-1' }
    });

    expect(response.status).toBe(400);
    expect(mocks.hashPasswordV2).not.toHaveBeenCalled();
  });

  it('claims the token, updates the password and logs the user in', async () => {
    mocks.findUnique.mockResolvedValue({
      token: 'token-1',
      userId: 'user-1',
      finishedAt: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-1',
        email: 'user@example.test',
        isDeleted: false,
        blockedAt: null,
        cryptVersion: 1
      }
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const response = await post({
      action: 'passwortReset',
      formData: { token: 'token-1', password: 'new-secret', userId: 'user-1' }
    });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { token: 'token-1', userId: 'user-1' },
      include: { user: true }
    });
    expect(mocks.hashPasswordV2).toHaveBeenCalledWith('new-secret', 'user-1');
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        token: 'token-1',
        userId: 'user-1',
        finishedAt: null
      }),
      data: { finishedAt: expect.any(Date) }
    }));
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password: 'hashed-new-password', cryptVersion: 2 }
    });
    expect(mocks.login).toHaveBeenCalledWith('user@example.test', 'new-secret');
    expect(response.status).toBe(200);
  });

  it('returns an invalid-token response when the token claim loses a race', async () => {
    mocks.findUnique.mockResolvedValue({
      token: 'token-1',
      userId: 'user-1',
      finishedAt: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-1',
        email: 'user@example.test',
        isDeleted: false,
        blockedAt: null,
        cryptVersion: 2
      }
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await post({
      action: 'passwortReset',
      formData: { token: 'token-1', password: 'new-secret', userId: 'user-1' }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Ungültiger oder abgelaufener Token.'
    });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });
});
