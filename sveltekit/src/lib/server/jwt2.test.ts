import { describe, expect, it, vi } from 'vitest';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Cookies } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({
  env: {
    JWT_SECRET: 'unit-test-secret',
  },
}));

import {
  createJWT,
  verifyJWT,
  requireLogin,
  requireLoginAdmin,
  checkLogin,
  type JwtUserPayload,
} from './jwt';

const JWT_SECRET = 'unit-test-secret';

const testUser: JwtUserPayload = {
  id: 'user-123',
  email: 'user@example.com',
  isAdmin: 0,
};

const adminUser: JwtUserPayload = {
  id: 'admin-123',
  email: 'admin@example.com',
  isAdmin: 1,
};

function createCookies(token?: string): Cookies {
  return {
    get: vi.fn(() => token),
  } as unknown as Cookies;
}

function expectLoginRedirect(callback: () => unknown) {
  let thrown: unknown;

  try {
    callback();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toMatchObject({
    status: 302,
    location: '/login',
  });
}

// --------------------------------------------------
// createJWT
// --------------------------------------------------

describe('createJWT', () => {
  it('creates a valid JWT containing the user payload', () => {
    const token = createJWT(testUser);

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    expect(decoded).toMatchObject(testUser);
  });

  it('uses a default expiration of 7 days', () => {
    const token = createJWT(testUser);

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp! - decoded.iat!).toBe(7 * 24 * 60 * 60);
  });

  it('supports a custom expiration time', () => {
    const token = createJWT(testUser, '30m');

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    expect(decoded.exp! - decoded.iat!).toBe(30 * 60);
  });
});

// --------------------------------------------------
// verifyJWT
// --------------------------------------------------

describe('verifyJWT', () => {
  it('returns the user payload for a valid token', () => {
    const token = createJWT(testUser);

    const result = verifyJWT(token);

    expect(result).toMatchObject(testUser);
  });

  it('returns null for a malformed token', () => {
    const result = verifyJWT('not-a-valid-jwt');

    expect(result).toBeNull();
  });

  it('returns null for a token signed with another secret', () => {
    const token = jwt.sign(testUser, 'another-secret');

    const result = verifyJWT(token);

    expect(result).toBeNull();
  });

  it('returns null for an expired token', () => {
    const token = jwt.sign(testUser, JWT_SECRET, {
      expiresIn: -1,
    });

    const result = verifyJWT(token);

    expect(result).toBeNull();
  });
});

// --------------------------------------------------
// requireLogin
// --------------------------------------------------

describe('requireLogin', () => {
  it('redirects to login when the JWT cookie is missing', () => {
    const cookies = createCookies();

    expectLoginRedirect(() => requireLogin(cookies));
  });

  it('redirects to login when the JWT is invalid', () => {
    const cookies = createCookies('invalid-token');

    expectLoginRedirect(() => requireLogin(cookies));
  });

  it('returns the user when the JWT is valid', () => {
    const token = createJWT(testUser);
    const cookies = createCookies(token);

    const result = requireLogin(cookies);

    expect(result).toMatchObject(testUser);
  });

  it('reads the JWT from the jwt cookie', () => {
    const token = createJWT(testUser);
    const cookies = createCookies(token);

    requireLogin(cookies);

    expect(cookies.get).toHaveBeenCalledWith('jwt');
  });
});

// --------------------------------------------------
// requireLoginAdmin
// --------------------------------------------------

describe('requireLoginAdmin', () => {
  it('redirects to login when the JWT cookie is missing', () => {
    const cookies = createCookies();

    expectLoginRedirect(() => requireLoginAdmin(cookies));
  });

  it('redirects to login when the JWT is invalid', () => {
    const cookies = createCookies('invalid-token');

    expectLoginRedirect(() => requireLoginAdmin(cookies));
  });

  it('redirects to login when the user is not an admin', () => {
    const token = createJWT(testUser);
    const cookies = createCookies(token);

    expectLoginRedirect(() => requireLoginAdmin(cookies));
  });

  it('returns the user when the user is an admin', () => {
    const token = createJWT(adminUser);
    const cookies = createCookies(token);

    const result = requireLoginAdmin(cookies);

    expect(result).toMatchObject(adminUser);
  });
});

// --------------------------------------------------
// checkLogin
// --------------------------------------------------

describe('checkLogin', () => {
  it('returns null when the JWT cookie is missing', () => {
    const cookies = createCookies();

    const result = checkLogin(cookies);

    expect(result).toBeNull();
  });

  it('returns null when the JWT is invalid', () => {
    const cookies = createCookies('invalid-token');

    const result = checkLogin(cookies);

    expect(result).toBeNull();
  });

  it('returns the user when the JWT is valid', () => {
    const token = createJWT(testUser);
    const cookies = createCookies(token);

    const result = checkLogin(cookies);

    expect(result).toMatchObject(testUser);
  });
});

// --------------------------------------------------
// Security regression test
// --------------------------------------------------

describe('JWT payload validation', () => {
  it('rejects a correctly signed token with missing required claims', () => {
    const malformedPayload = {
      id: 'user-123',
      email: 'user@example.com',
      // isAdmin is missing
    };

    const token = jwt.sign(malformedPayload, JWT_SECRET);

    expect(verifyJWT(token)).toBeNull();
  });

  it('rejects a token with an incorrectly typed isAdmin claim', () => {
    const malformedPayload = {
      id: 'user-123',
      email: 'user@example.com',
      isAdmin: 'yes',
    };

    const token = jwt.sign(malformedPayload, JWT_SECRET);

    expect(verifyJWT(token)).toBeNull();
  });
});
