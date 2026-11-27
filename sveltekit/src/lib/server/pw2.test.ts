import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * These mocks are hoisted by Vitest before the module under test is imported.
 * Keep the SvelteKit json() helper real so the tests exercise actual Response
 * objects and their status/body/headers.
 */
const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  bcryptHash: vi.fn(),
  bcryptCompare: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  createJWT: vi.fn(),
  newUserUUID: vi.fn(),
  isSingleEmailAddress: vi.fn(),
  getCookiePath: vi.fn(),
  withBase: vi.fn()
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: mocks.bcryptHash,
    compare: mocks.bcryptCompare
  }
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));

vi.mock('$lib/server/db', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      update: mocks.update,
      create: mocks.create
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

// Assumes this test lives next to src/lib/server/pw.ts.
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

type TestUser = {
  id: string;
  email: string;
  password: string;
  cryptVersion: number;
  isAdmin: number;
  isDeleted: boolean;
  blockedAt: Date | null;
};

function makeUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 'user-123',
    email: 'person@example.com',
    password: 'stored-hash',
    cryptVersion: 2,
    isAdmin: 0,
    isDeleted: false,
    blockedAt: null,
    ...overrides
  };
}

async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function makeSsoUser(extra: Record<string, unknown> = {}) {
  return {
    preferred_username: 'keycloak-user-42',
    given_name: 'Ada',
    family_name: 'Lovelace',
    email: 'ada@example.com',
    ...extra
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  Object.assign(mocks.env, {
    SERVER_PW_SALT: 'legacy-salt',
    SERVER_PW_PEPPER: 'v2-pepper',
    KEYCLOAK_CLIENT_SECRET: ''
  });

  mocks.bcryptHash.mockResolvedValue('bcrypt-hash');
  mocks.bcryptCompare.mockResolvedValue(true);
  mocks.findUnique.mockResolvedValue(null);
  mocks.findFirst.mockResolvedValue(null);
  mocks.update.mockResolvedValue({});
  mocks.create.mockResolvedValue(makeUser());
  mocks.createJWT.mockReturnValue('signed.jwt.token');
  mocks.newUserUUID.mockResolvedValue('new-user-uuid');
  mocks.isSingleEmailAddress.mockReturnValue(true);
  mocks.getCookiePath.mockReturnValue('/app');
  mocks.withBase.mockImplementation((path: string) => `/app${path}`);
});

describe('password hashing helpers', () => {
  it('hashes legacy passwords with SERVER_PW_SALT and bcrypt cost 10', async () => {
    await expect(hashPassword('my-password')).resolves.toBe('bcrypt-hash');

    expect(mocks.bcryptHash).toHaveBeenCalledOnce();
    expect(mocks.bcryptHash).toHaveBeenCalledWith('my-passwordlegacy-salt', 10);
  });

  it('compares legacy passwords with SERVER_PW_SALT', async () => {
    await expect(comparePassword('my-password', 'stored-hash')).resolves.toBe(true);

    expect(mocks.bcryptCompare).toHaveBeenCalledWith('my-passwordlegacy-salt', 'stored-hash');
  });

  it('hashes v2 passwords with pepper and user ID', async () => {
    await expect(hashPasswordV2('my-password', 'user-123')).resolves.toBe('bcrypt-hash');

    expect(mocks.bcryptHash).toHaveBeenCalledWith('my-passwordv2-pepperuser-123', 10);
  });

  it('compares v2 passwords with pepper and user ID', async () => {
    await expect(comparePasswordV2('my-password', 'stored-hash', 'user-123')).resolves.toBe(true);

    expect(mocks.bcryptCompare).toHaveBeenCalledWith(
      'my-passwordv2-pepperuser-123',
      'stored-hash'
    );
  });
});

describe('passwordAuthDisabled', () => {
  it('returns false when no Keycloak client secret is configured', () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = '';

    expect(passwordAuthDisabled()).toBe(false);
  });

  it('returns true when a Keycloak client secret is configured', () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = 'configured-secret';

    expect(passwordAuthDisabled()).toBe(true);
  });
});

describe('login', () => {
  it('rejects password login with 403 in SSO-only mode without querying the database', async () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = 'configured-secret';

    const response = await login('person@example.com', 'password');

    expect(response.status).toBe(403);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Die Anmeldung mit Passwort ist deaktiviert.'
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns a generic login error when the user does not exist', async () => {
    const response = await login('missing@example.com', 'password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Ungültige Anmeldedaten. Bitte versuchen Sie es erneut.'
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: 'missing@example.com' }
    });
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
  });

  it('rejects a deleted user', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ isDeleted: true }));

    const response = await login('person@example.com', 'password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Benutzer existiert nicht.'
    });
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
  });

  it('rejects a blocked user with 403', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ blockedAt: new Date('2025-01-01T00:00:00Z') }));

    const response = await login('person@example.com', 'password');

    expect(response.status).toBe(403);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Dieses Benutzerkonto ist gesperrt.'
    });
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
  });

  it('rejects an unsupported password cryptVersion', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ cryptVersion: 99 }));

    const response = await login('person@example.com', 'password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Unbekannte Passwort-Verschlüsselung.'
    });
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('upgrades a valid v1 password hash to v2 and returns a JWT response', async () => {
    const legacyUser = makeUser({ cryptVersion: 1, password: 'legacy-hash' });
    mocks.findUnique.mockResolvedValue(legacyUser);
    mocks.bcryptCompare.mockResolvedValue(true);
    mocks.bcryptHash.mockResolvedValue('upgraded-v2-hash');

    const response = await login('person@example.com', 'correct-password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ success: true });
    expect(mocks.bcryptCompare).toHaveBeenCalledWith(
      'correct-passwordlegacy-salt',
      'legacy-hash'
    );
    expect(mocks.bcryptHash).toHaveBeenCalledWith(
      'correct-passwordv2-pepperuser-123',
      10
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: {
        password: 'upgraded-v2-hash',
        cryptVersion: 2
      }
    });
    expect(mocks.createJWT).toHaveBeenCalledWith({
      id: 'user-123',
      email: 'person@example.com',
      isAdmin: 0
    });
    expect(response.headers.get('set-cookie')).toContain('jwt=signed.jwt.token');
  });

  it('does not upgrade a v1 hash when the password is incorrect', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ cryptVersion: 1 }));
    mocks.bcryptCompare.mockResolvedValue(false);

    const response = await login('person@example.com', 'wrong-password');

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Ungültige Anmeldedaten. Bitte versuchen Sie es erneut.'
    });
    expect(mocks.bcryptHash).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createJWT).not.toHaveBeenCalled();
  });

  it('authenticates a v2 user without re-hashing the password', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ cryptVersion: 2, password: 'v2-hash' }));
    mocks.bcryptCompare.mockResolvedValue(true);

    const response = await login('person@example.com', 'correct-password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ success: true });
    expect(mocks.bcryptCompare).toHaveBeenCalledWith(
      'correct-passwordv2-pepperuser-123',
      'v2-hash'
    );
    expect(mocks.bcryptHash).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns a generic error when a v2 password does not match', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ cryptVersion: 2 }));
    mocks.bcryptCompare.mockResolvedValue(false);

    const response = await login('person@example.com', 'wrong-password');

    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Ungültige Anmeldedaten. Bitte versuchen Sie es erneut.'
    });
    expect(mocks.createJWT).not.toHaveBeenCalled();
  });
});

describe('register', () => {
  it('rejects registration with 403 in SSO-only mode', async () => {
    mocks.env.KEYCLOAK_CLIENT_SECRET = 'configured-secret';

    const response = await register('person@example.com', 'password');

    expect(response.status).toBe(403);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Die Registrierung mit Passwort ist deaktiviert.'
    });
    expect(mocks.isSingleEmailAddress).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid email address with 400', async () => {
    mocks.isSingleEmailAddress.mockReturnValue(false);

    const response = await register('not-an-email', 'password');

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Ungültige E-Mail-Adresse.'
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('creates a new user with a v2 password hash', async () => {
    const createdUser = makeUser({
      id: 'new-user-uuid',
      email: 'new@example.com',
      password: 'new-v2-hash',
      cryptVersion: 2
    });
    mocks.findUnique.mockResolvedValue(null);
    mocks.newUserUUID.mockResolvedValue('new-user-uuid');
    mocks.bcryptHash.mockResolvedValue('new-v2-hash');
    mocks.create.mockResolvedValue(createdUser);

    const response = await register('new@example.com', 'new-password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ success: true });
    expect(mocks.isSingleEmailAddress).toHaveBeenCalledWith('new@example.com');
    expect(mocks.newUserUUID).toHaveBeenCalledOnce();
    expect(mocks.bcryptHash).toHaveBeenCalledWith(
      'new-passwordv2-peppernew-user-uuid',
      10
    );
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: 'new-user-uuid',
        email: 'new@example.com',
        password: 'new-v2-hash',
        cryptVersion: 2
      }
    });
    expect(mocks.createJWT).toHaveBeenCalledWith({
      id: 'new-user-uuid',
      email: 'new@example.com',
      isAdmin: 0
    });
  });

  it('logs in an existing user when the supplied password is valid', async () => {
    const existingUser = makeUser({ cryptVersion: 2 });
    mocks.findUnique
      .mockResolvedValueOnce(existingUser) // register() existence check
      .mockResolvedValueOnce(existingUser); // login() lookup
    mocks.bcryptCompare.mockResolvedValue(true);

    const response = await register('person@example.com', 'correct-password');

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ success: true });
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createJWT).toHaveBeenCalledWith({
      id: 'user-123',
      email: 'person@example.com',
      isAdmin: 0
    });
  });

  it('currently passes through the login error for an existing user with a wrong password', async () => {
    const existingUser = makeUser({ cryptVersion: 2 });
    mocks.findUnique
      .mockResolvedValueOnce(existingUser) // register() existence check
      .mockResolvedValueOnce(existingUser); // login() lookup
    mocks.bcryptCompare.mockResolvedValue(false);

    const response = await register('person@example.com', 'wrong-password');

    // Characterizes the current implementation. See the note below: the intended
    // registration-specific error is not returned because Response is not a
    // JSON body object and does not have a `success` property.
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Ungültige Anmeldedaten. Bitte versuchen Sie es erneut.'
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('loginSso', () => {
  it('logs in an existing SSO account', async () => {
    const existingSsoUser = makeUser({ cryptVersion: 3 });
    mocks.findFirst.mockResolvedValue(existingSsoUser);

    const response = await loginSso(makeSsoUser());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app/profil');
    expect(response.headers.get('set-cookie')).toContain('jwt=signed.jwt.token');
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        cryptVersion: { in: [3, 4] },
        password: 'keycloak-user-42'
      }
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an existing deleted SSO account with 403', async () => {
    mocks.findFirst.mockResolvedValue(makeUser({ isDeleted: true, cryptVersion: 3 }));

    const response = await loginSso(makeSsoUser());

    expect(response.status).toBe(403);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Benutzer existiert nicht.'
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an existing blocked SSO account with 403', async () => {
    mocks.findFirst.mockResolvedValue(
      makeUser({ blockedAt: new Date('2025-01-01T00:00:00Z'), cryptVersion: 3 })
    );

    const response = await loginSso(makeSsoUser());

    expect(response.status).toBe(403);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Dieses Benutzerkonto ist gesperrt.'
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns 409 when the SSO email belongs to an existing local account', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(makeUser({ cryptVersion: 2 }));

    const response = await loginSso(makeSsoUser());

    expect(response.status).toBe(409);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: 'Für diese E-Mail-Adresse existiert bereits ein lokales Konto. Bitte wenden Sie sich an die Betreuung.'
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createJWT).not.toHaveBeenCalled();
  });

  it('creates a cryptVersion 3 SSO user when no obfuscated BD value is supplied', async () => {
    const createdUser = makeUser({
      id: 'new-user-uuid',
      email: 'ada@example.com',
      password: 'keycloak-user-42',
      cryptVersion: 3
    });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue(createdUser);

    const response = await loginSso(makeSsoUser());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app/profil');
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: 'new-user-uuid',
        email: 'ada@example.com',
        password: 'keycloak-user-42',
        cryptVersion: 3
      }
    });
  });

  it('creates a cryptVersion 4 SSO user when the obfuscated BD value is truthy', async () => {
    const createdUser = makeUser({
      id: 'new-user-uuid',
      email: 'ada@example.com',
      password: 'keycloak-user-42',
      cryptVersion: 4
    });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue(createdUser);

    const ssoUserWithBd = makeSsoUser({ 'CO-OBFUSCATED-C-BD': 'obfuscated-value' });
    const response = await loginSso(ssoUserWithBd as Parameters<typeof loginSso>[0]);

    expect(response.status).toBe(302);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: 'new-user-uuid',
        email: 'ada@example.com',
        password: 'keycloak-user-42',
        cryptVersion: 4
      }
    });
  });
});

describe('JWT response helpers', () => {
  it('creates a JSON success response and a seven-day secure JWT cookie', async () => {
    const response = createJWTResponse({
      id: 'user-123',
      email: 'person@example.com',
      isAdmin: 1
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await responseJson(response)).toEqual({ success: true });
    expect(mocks.createJWT).toHaveBeenCalledWith({
      id: 'user-123',
      email: 'person@example.com',
      isAdmin: 1
    });
    expect(response.headers.get('set-cookie')).toBe(
      'jwt=signed.jwt.token; Path=/app; HttpOnly; Secure; SameSite=Lax; Max-Age=604800'
    );
  });

  it('creates an SSO redirect response and a one-day secure JWT cookie', () => {
    const response = createJWTResponseSSO({
      id: 'user-123',
      email: 'person@example.com',
      isAdmin: 1
    });

    expect(response.status).toBe(302);
    expect(response.body).toBeNull();
    expect(response.headers.get('location')).toBe('/app/profil');
    expect(response.headers.get('set-cookie')).toBe(
      'jwt=signed.jwt.token; Path=/app; HttpOnly; Secure; SameSite=Lax; Max-Age=86400'
    );
    expect(mocks.withBase).toHaveBeenCalledWith('/profil');
    expect(mocks.createJWT).toHaveBeenCalledWith({
      id: 'user-123',
      email: 'person@example.com',
      isAdmin: 1
    });
  });
});
