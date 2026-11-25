import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  privateEnv: {
    SUBFOLDER: undefined as string | undefined
  },
  publicEnv: {
    PUBLIC_APP_URL: undefined as string | undefined
  }
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: mocks.publicEnv }));

import { absoluteUrl, getBasePath, getCookiePath, withBase } from './subfolder';

beforeEach(() => {
  mocks.privateEnv.SUBFOLDER = undefined;
  mocks.publicEnv.PUBLIC_APP_URL = undefined;
});

describe('getBasePath', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['   ', ''],
    ['prompting-schule', '/prompting-schule'],
    ['/prompting-schule', '/prompting-schule'],
    ['prompting-schule/', '/prompting-schule'],
    ['///prompting-schule///', '/prompting-schule'],
    ['  /prompting-schule/  ', '/prompting-schule']
  ])('normalizes SUBFOLDER %j to %s', (subfolder, expected) => {
    mocks.privateEnv.SUBFOLDER = subfolder;

    expect(getBasePath()).toBe(expected);
  });
});

describe('getCookiePath', () => {
  it('returns / when no subfolder is configured', () => {
    expect(getCookiePath()).toBe('/');
  });

  it('returns the subfolder path as the cookie path', () => {
    mocks.privateEnv.SUBFOLDER = '/prompting-schule/';

    expect(getCookiePath()).toBe('/prompting-schule');
  });
});

describe('withBase', () => {
  it('returns an unmodified root-relative path without a subfolder', () => {
    expect(withBase('/profil')).toBe('/profil');
  });

  it('adds a slash when the path has no leading slash', () => {
    mocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(withBase('profil')).toBe('/prompting-schule/profil');
  });

  it('prefixes a subfolder to paths with a leading slash', () => {
    mocks.privateEnv.SUBFOLDER = '/prompting-schule/';

    expect(withBase('/login-sso/callback')).toBe('/prompting-schule/login-sso/callback');
  });
});

describe('absoluteUrl', () => {
  it('uses the request origin and subfolder without an app URL', () => {
    mocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(absoluteUrl('/profil', new URL('http://localhost:3000/prompting-schule/profil')))
      .toBe('http://localhost:3000/prompting-schule/profil');
  });

  it('uses only the origin of PUBLIC_APP_URL and ignores its path', () => {
    mocks.privateEnv.SUBFOLDER = 'prompting-schule';
    mocks.publicEnv.PUBLIC_APP_URL = 'https://public.example.test/some/ignored/path';

    expect(absoluteUrl('/login-sso/callback', new URL('http://localhost:3000')))
      .toBe('https://public.example.test/prompting-schule/login-sso/callback');
  });

  it('falls back to the request origin for an invalid PUBLIC_APP_URL', () => {
    mocks.privateEnv.SUBFOLDER = 'prompting-schule';
    mocks.publicEnv.PUBLIC_APP_URL = 'not a valid URL';

    expect(absoluteUrl('/profil', new URL('http://request.example.test:8080/anything')))
      .toBe('http://request.example.test:8080/prompting-schule/profil');
  });

  it('does not add a subfolder when none is configured', () => {
    mocks.publicEnv.PUBLIC_APP_URL = 'https://public.example.test/base';

    expect(absoluteUrl('logout', new URL('http://localhost:3000')))
      .toBe('https://public.example.test/logout');
  });
});
