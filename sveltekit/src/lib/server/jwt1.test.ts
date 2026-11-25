import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  env: { JWT_SECRET: 'test-jwt-secret' as string },
  redirect: vi.fn((status: number, location: string) => {
    const error = Object.assign(new Error('Redirect'), { status, location });
    throw error;
  }),
  withBase: vi.fn((path: string) => `/base${path}`)
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('@sveltejs/kit', () => ({ redirect: mocks.redirect }));
vi.mock('$lib/server/subfolder', () => ({ withBase: mocks.withBase }));

import type { Cookies } from '@sveltejs/kit';
import {
  checkLogin,
  createJWT,
  requireLogin,
  requireLoginAdmin,
  verifyJWT,
  type JwtUserPayload
} from './jwt';

const user: JwtUserPayload = {
  id: 'user-123',
  email: 'test@example.com',
  isAdmin: 0
};

function cookiesWith(token?: string): Cookies {
  return {
    get: vi.fn(() => token)
  } as unknown as Cookies;
}

beforeEach(() => {
  mocks.env.JWT_SECRET = 'test-jwt-secret';
  mocks.redirect.mockClear();
  mocks.withBase.mockClear();
});

describe('JWT helpers', () => {
  it('creates and verifies a JWT payload', () => {
    const token = createJWT(user);

    expect(typeof token).toBe('string');
    expect(verifyJWT(token)).toEqual(expect.objectContaining(user));
  });

  it('uses a custom expiry when provided', () => {
    const token = createJWT(user, '1h');

    expect(verifyJWT(token)).toEqual(expect.objectContaining(user));
  });

  it('returns null for malformed or invalid tokens', () => {
    expect(verifyJWT('not-a-jwt')).toBeNull();
  });

  it('returns null when verification uses the wrong secret', () => {
    const token = jwt.sign(user, 'different-secret');

    expect(verifyJWT(token)).toBeNull();
  });

  it('returns null for an expired token', () => {
    const token = createJWT(user, -1);

    expect(verifyJWT(token)).toBeNull();
  });
});

describe('requireLogin', () => {
  it('redirects to based login URL when the cookie is missing', () => {
    expect(() => requireLogin(cookiesWith())).toThrow(
      expect.objectContaining({ status: 302, location: '/base/login' })
    );
  });

  it('redirects when the token is invalid', () => {
    expect(() => requireLogin(cookiesWith('invalid-token'))).toThrow(
      expect.objectContaining({ status: 302, location: '/base/login' })
    );
  });

  it('returns the user for a valid token', () => {
    const cookies = cookiesWith(createJWT(user));

    expect(requireLogin(cookies)).toEqual(expect.objectContaining(user));
  });
});

describe('requireLoginAdmin', () => {
  it('returns the user for an admin token', () => {
    const admin = { ...user, isAdmin: 1 };

    expect(requireLoginAdmin(cookiesWith(createJWT(admin)))).toEqual(
      expect.objectContaining(admin)
    );
  });

  it('redirects non-admin users', () => {
    expect(() => requireLoginAdmin(cookiesWith(createJWT(user)))).toThrow(
      expect.objectContaining({ status: 302, location: '/base/login' })
    );
  });

  it('redirects when the cookie is missing', () => {
    expect(() => requireLoginAdmin(cookiesWith())).toThrow(
      expect.objectContaining({ status: 302, location: '/base/login' })
    );
  });

  it('redirects when the token is invalid', () => {
    expect(() => requireLoginAdmin(cookiesWith('invalid-token'))).toThrow(
      expect.objectContaining({ status: 302, location: '/base/login' })
    );
  });
});

describe('checkLogin', () => {
  it('returns null when the cookie is missing', () => {
    expect(checkLogin(cookiesWith())).toBeNull();
  });

  it('returns null for an invalid token', () => {
    expect(checkLogin(cookiesWith('invalid-token'))).toBeNull();
  });

  it('returns the user for a valid token', () => {
    expect(checkLogin(cookiesWith(createJWT(user)))).toEqual(expect.objectContaining(user));
  });
});
