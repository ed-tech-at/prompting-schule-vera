
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBasePath,
  getCookiePath,
  withBase,
  absoluteUrl
} from './subfolder';

// Keep the environment mocks mutable so individual tests can
// configure them without re-importing the module.
const envMocks = vi.hoisted(() => ({
  privateEnv: {} as Record<string, string | undefined>,
  publicEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({
  env: envMocks.privateEnv
}));

vi.mock('$env/dynamic/public', () => ({
  env: envMocks.publicEnv
}));

beforeEach(() => {
  // Reset environment variables before every test.
  delete envMocks.privateEnv.SUBFOLDER;
  delete envMocks.publicEnv.PUBLIC_APP_URL;
});

// -----------------------------------------------------------------------------
// getBasePath
// -----------------------------------------------------------------------------

describe('getBasePath', () => {
  it('returns an empty string when SUBFOLDER is undefined', () => {
    expect(getBasePath()).toBe('');
  });

  it('returns an empty string when SUBFOLDER is empty', () => {
    envMocks.privateEnv.SUBFOLDER = '';

    expect(getBasePath()).toBe('');
  });

  it('returns an empty string when SUBFOLDER contains only whitespace', () => {
    envMocks.privateEnv.SUBFOLDER = '   ';

    expect(getBasePath()).toBe('');
  });

  it('removes leading and trailing slashes', () => {
    envMocks.privateEnv.SUBFOLDER = '/prompting-schule/';

    expect(getBasePath()).toBe('/prompting-schule');
  });

  it('removes multiple leading and trailing slashes', () => {
    envMocks.privateEnv.SUBFOLDER = '///prompting-schule///';

    expect(getBasePath()).toBe('/prompting-schule');
  });

  it('trims whitespace before normalizing slashes', () => {
    envMocks.privateEnv.SUBFOLDER = '  /prompting-schule/  ';

    expect(getBasePath()).toBe('/prompting-schule');
  });

  it('preserves nested paths inside SUBFOLDER', () => {
    envMocks.privateEnv.SUBFOLDER = '/tenant/app/';

    expect(getBasePath()).toBe('/tenant/app');
  });
});

// -----------------------------------------------------------------------------
// getCookiePath
// -----------------------------------------------------------------------------

describe('getCookiePath', () => {
  it('returns "/" when no subfolder is configured', () => {
    expect(getCookiePath()).toBe('/');
  });

  it('returns the normalized subfolder when configured', () => {
    envMocks.privateEnv.SUBFOLDER = '/prompting-schule/';

    expect(getCookiePath()).toBe('/prompting-schule');
  });
});

// -----------------------------------------------------------------------------
// withBase
// -----------------------------------------------------------------------------

describe('withBase', () => {
  it('prefixes a path with the configured subfolder', () => {
    envMocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(withBase('/profil')).toBe('/prompting-schule/profil');
  });

  it('adds a leading slash when the path does not start with one', () => {
    envMocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(withBase('profil')).toBe('/prompting-schule/profil');
  });

  it('returns the path unchanged apart from its leading slash when no subfolder exists', () => {
    expect(withBase('/profil')).toBe('/profil');
    expect(withBase('profil')).toBe('/profil');
  });

  it('returns the base path followed by "/" for an empty path', () => {
    envMocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(withBase('')).toBe('/prompting-schule/');
  });

  it('returns "/" for an empty path when no subfolder exists', () => {
    expect(withBase('')).toBe('/');
  });
});

// -----------------------------------------------------------------------------
// absoluteUrl
// -----------------------------------------------------------------------------

describe('absoluteUrl', () => {
  const requestUrl = new URL('http://internal.example:3000/current-page');

  it('uses the request origin when PUBLIC_APP_URL is not configured', () => {
    envMocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(absoluteUrl('/auth/callback', requestUrl)).toBe(
      'http://internal.example:3000/prompting-schule/auth/callback'
    );
  });

  it('uses the request origin when PUBLIC_APP_URL is empty', () => {
    envMocks.publicEnv.PUBLIC_APP_URL = '';
    
    expect(absoluteUrl('/auth/callback', requestUrl)).toBe(
      'http://internal.example:3000/auth/callback'
    );
  });

  it('uses PUBLIC_APP_URL origin instead of the request origin', () => {
    envMocks.publicEnv.PUBLIC_APP_URL = 'https://public.example.com';

    expect(absoluteUrl('/auth/callback', requestUrl)).toBe(
      'https://public.example.com/auth/callback'
    );
  });

  it('ignores the path, query and fragment of PUBLIC_APP_URL', () => {
    envMocks.publicEnv.PUBLIC_APP_URL =
      'https://public.example.com/app/config?foo=bar#section';
    envMocks.privateEnv.SUBFOLDER = 'prompting-schule';

    expect(absoluteUrl('/auth/callback', requestUrl)).toBe(
      'https://public.example.com/prompting-schule/auth/callback'
    );
  });

  it('preserves the port from PUBLIC_APP_URL', () => {
    envMocks.publicEnv.PUBLIC_APP_URL = 'https://public.example.com:8443';

    expect(absoluteUrl('/auth/callback', requestUrl)).toBe(
      'https://public.example.com:8443/auth/callback'
    );
  });

  it('falls back to the request origin when PUBLIC_APP_URL is invalid', () => {
    envMocks.publicEnv.PUBLIC_APP_URL = 'not-a-valid-absolute-url';

    expect(absoluteUrl('/auth/callback', requestUrl)).toBe(
      'http://internal.example:3000/auth/callback'
    );
  });

  it('adds the configured subfolder when using PUBLIC_APP_URL', () => {
    envMocks.privateEnv.SUBFOLDER = '/prompting-schule/';
    envMocks.publicEnv.PUBLIC_APP_URL = 'https://public.example.com/ignored-path';

    expect(absoluteUrl('auth/callback', requestUrl)).toBe(
      'https://public.example.com/prompting-schule/auth/callback'
    );
  });
});
