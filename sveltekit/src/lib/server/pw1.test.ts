import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    SERVER_PW_SALT: 'test-salt',
    SERVER_PW_PEPPER: 'test-pepper',
    KEYCLOAK_CLIENT_SECRET: ''
  } as Record<string, string | undefined>,
  hash: vi.fn(),
  compare: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createJWT: vi.fn(() => 'signed-token'),
  newUserUUID: vi.fn(),
  isSingleEmailAddress: vi.fn(),
  getCookiePath: vi.fn(() => '/'),
  withBase: vi.fn((path: string) => `/base${path}`)
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));

vi.mock('bcrypt', () => ({
  default: {
    hash: mocks.hash,
    compare: mocks.compare
  }
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update
    }
  }
}));

vi.mock('./jwt', () => ({ createJWT: mocks.createJWT }));
vi.mock('$lib/server/dbUtils.js', () => ({ newUserUUID: mocks.newUserUUID }));
vi.mock('$lib/server/email', () => ({ isSingleEmailAddress: mocks.isSingleEmailAddress }));
vi.mock('$lib/server/subfolder', () => ({
  getCookiePath: mocks.getCookiePath,
  withBase: mocks.withBase
}));

vi.mock('@sveltejs/kit', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) }
    })
}));

import {
  comparePassword,
  comparePasswordV2,
  createJWTResponse,
  createJWTResponseSSO,
  hashPassword,
  hashPasswordV2,
  login,
  loginSso,
  passwordAuthDisabled,
  register
} from './pw';

async function body(response: Response) {
  return response.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SERVER_PW_SALT = 'test-salt';
  mocks.env.SERVER_PW_PEPPER = 'test-pepper';
  mocks.env.KEYCLOAK_CLIENT_SECRET = '';
  mocks.createJWT.mockReturnValue('signed-token');
  mocks.getCookiePath.mockReturnValue('/');
  mocks.withBase.mockImplementation((path: string) => `/base${path}`);
  mocks.isSingleEmailAddress.mockReturnValue(true);
  mocks.hash.mockResolvedValue('hashed-value');
  mocks.compare.mockResolvedValue(true);
});

describe('password hashing helpers', () => {
  it('hashes version 1 passwords with the configured salt', async () => {
    await expect(hashPassword('secret')).resolves.toBe('hashed-value');
    expect(mocks.hash).toHaveBeenCalledWith('secrettest-salt', 10);
  });

  it('compares version 1 passwords with the configured salt', async () => {
    await expect(comparePassword('secret', 'stored')).resolves.toBe(true);
    expect(mocks.compare).toHaveBeenCalledWith('secrettest-salt', 'stored');
  });

  it('hashes version 2 passwords with pepper and user id', async () => {
    await expect(hashPasswordV2('secret', 'user-1')).resolves.toBe('hashed-value');
    expect(mocks.hash).toHaveBeenCalledWith('secrettest-pepperuser-1', 10);
  });

  it('compares version 2 passwords with pepper and user id', async () => {
    await expect(comparePasswordV2('secret', 'stored', 'user-1')).resolves.toBe(true);
    expect(mocks.compare).toHaveBeenCalledWith('secrettest-pepperuser-1', 'stored');
  });
});

describe('passwordAuthDisabled', () => {
  it('is disabled when a Keycloak client secret is configured', () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = 'sso-secret';
    expect(passwordAuthDisabled()).toBe(true);
  });

  it('is enabled for local passwords without a client secret', () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = '';
    expect(passwordAuthDisabled()).toBe(false);
  });
});

describe('login', () => {
  it('rejects login when password authentication is disabled', async () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = 'sso-secret';

    const response = await login('user@example.test', 'secret');

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      success: false,
      error: 'Die Anmeldung mit Passwort ist deaktiviert.'
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid credentials for an unknown user', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await login('missing@example.test', 'secret');

    expect(await body(response)).toEqual({
      success: false,
      error: 'Ungültige Anmeldedaten. Bitte versuchen Sie es erneut.'
    });
  });

  it('rejects deleted users', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@example.test', isAdmin: 0, isDeleted: 1, blockedAt: null, cryptVersion: 2, password: 'stored' });

    const response = await login('u1@example.test', 'secret');

    expect(await body(response)).toEqual({ success: false, error: 'Benutzer existiert nicht.' });
  });

  it('rejects blocked users', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@example.test', isAdmin: 0, isDeleted: 0, blockedAt: new Date(), cryptVersion: 2, password: 'stored' });

    const response = await login('u1@example.test', 'secret');

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ success: false, error: 'Dieses Benutzerkonto ist gesperrt.' });
  });

  it('logs in a version 2 user and sets the JWT cookie', async () => {
    const user = { id: 'u1', email: 'u1@example.test', isAdmin: 2, isDeleted: 0, blockedAt: null, cryptVersion: 2, password: 'stored' };
    mocks.findUnique.mockResolvedValue(user);
    mocks.compare.mockResolvedValue(true);

    const response = await login(user.email, 'secret');

    expect(mocks.compare).toHaveBeenCalledWith('secrettest-pepperu1', 'stored');
    expect(mocks.createJWT).toHaveBeenCalledWith({ id: 'u1', email: user.email, isAdmin: 2 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('jwt=signed-token');
  });

  it('migrates a matching version 1 password to version 2', async () => {
    const user = { id: 'u1', email: 'u1@example.test', isAdmin: 0, isDeleted: 0, blockedAt: null, cryptVersion: 1, password: 'old-stored' };
    mocks.findUnique.mockResolvedValue(user);
    mocks.compare.mockResolvedValue(true);
    mocks.hash.mockResolvedValue('new-stored');

    await login(user.email, 'secret');

    expect(mocks.hash).toHaveBeenCalledWith('secrettest-pepperu1', 10);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { password: 'new-stored', cryptVersion: 2 }
    });
  });

  it('rejects a wrong password', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@example.test', isAdmin: 0, isDeleted: 0, blockedAt: null, cryptVersion: 2, password: 'stored' });
    mocks.compare.mockResolvedValue(false);

    const response = await login('u1@example.test', 'wrong');

    expect(await body(response)).toEqual({
      success: false,
      error: 'Ungültige Anmeldedaten. Bitte versuchen Sie es erneut.'
    });
  });

  it('rejects unknown password crypt versions', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@example.test', isAdmin: 0, isDeleted: 0, blockedAt: null, cryptVersion: 99, password: 'stored' });

    const response = await login('u1@example.test', 'secret');

    expect(await body(response)).toEqual({ success: false, error: 'Unbekannte Passwort-Verschlüsselung.' });
  });
});

describe('register', () => {
  it('rejects registration when password authentication is disabled', async () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = 'sso-secret';

    const response = await register('new@example.test', 'secret');

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      success: false,
      error: 'Die Registrierung mit Passwort ist deaktiviert.'
    });
  });

  it('rejects an invalid email address', async () => {
    mocks.isSingleEmailAddress.mockReturnValue(false);

    const response = await register('invalid-address', 'secret');

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ success: false, error: 'Ungültige E-Mail-Adresse.' });
  });

  it('creates a version 2 local user', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.newUserUUID.mockResolvedValue('new-user-id');
    mocks.hash.mockResolvedValue('new-password-hash');
    mocks.create.mockResolvedValue({ id: 'new-user-id', email: 'new@example.test', isAdmin: 0 });

    const response = await register('new@example.test', 'secret');

    expect(mocks.hash).toHaveBeenCalledWith('secrettest-peppernew-user-id', 10);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: 'new-user-id',
        email: 'new@example.test',
        password: 'new-password-hash',
        cryptVersion: 2
      }
    });
    expect(response.status).toBe(200);
  });
});

describe('loginSso', () => {
  const ssoUser = {
    preferred_username: 'sso-user',
    given_name: 'SSO',
    family_name: 'User',
    email: 'sso@example.test'
  };

  it('logs in an existing SSO user', async () => {
    const existing = { id: 's1', email: 'old@example.test', isAdmin: 1, isDeleted: 0, blockedAt: null };
    mocks.findFirst.mockResolvedValue(existing);

    const response = await loginSso(ssoUser);

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { cryptVersion: { in: [3, 4] }, password: 'sso-user' }
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/base/profil');
  });

  it('rejects a deleted existing SSO user', async () => {
    mocks.findFirst.mockResolvedValue({ id: 's1', isDeleted: 1, blockedAt: null });

    const response = await loginSso(ssoUser);

    expect(response.status).toBe(403);
  });

  it('rejects a blocked existing SSO user', async () => {
    mocks.findFirst.mockResolvedValue({ id: 's1', isDeleted: 0, blockedAt: new Date() });

    const response = await loginSso(ssoUser);

    expect(response.status).toBe(403);
  });

  it('does not reuse a local account with the same email', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue({ id: 'local-1' });

    const response = await loginSso(ssoUser);

    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a crypt-version 3 SSO account', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);
    mocks.newUserUUID.mockResolvedValue('new-sso-id');
    mocks.create.mockResolvedValue({ id: 'new-sso-id', email: ssoUser.email, isAdmin: 0 });

    const response = await loginSso(ssoUser);

    expect(mocks.create).toHaveBeenCalledWith({
      data: { id: 'new-sso-id', email: ssoUser.email, password: 'sso-user', cryptVersion: 3 }
    });
    expect(response.status).toBe(302);
  });

  it('creates a crypt-version 4 account for obfuscated SSO data', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);
    mocks.newUserUUID.mockResolvedValue('obfuscated-id');
    mocks.create.mockResolvedValue({ id: 'obfuscated-id', email: ssoUser.email, isAdmin: 0 });

    const response = await loginSso({ ...ssoUser, 'CO-OBFUSCATED-C-BD': 'yes' } as typeof ssoUser);

    expect(mocks.create).toHaveBeenCalledWith({
      data: { id: 'obfuscated-id', email: ssoUser.email, password: 'sso-user', cryptVersion: 4 }
    });
    expect(response.status).toBe(302);
  });
});

describe('JWT responses', () => {
  it('creates a local JWT response with a cookie', () => {
    mocks.getCookiePath.mockReturnValue('/prompting-schule');

    const response = createJWTResponse({ id: 'u1', email: 'u1@example.test', isAdmin: 3 });

    expect(mocks.createJWT).toHaveBeenCalledWith({ id: 'u1', email: 'u1@example.test', isAdmin: 3 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toBe(
      'jwt=signed-token; Path=/prompting-schule; HttpOnly; Secure; SameSite=Lax; Max-Age=604800'
    );
  });

  it('creates an SSO redirect response', () => {
    mocks.getCookiePath.mockReturnValue('/prompting-schule');

    const response = createJWTResponseSSO({ id: 'u1', email: 'u1@example.test', isAdmin: 1 });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/base/profil');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=86400');
  });
});
