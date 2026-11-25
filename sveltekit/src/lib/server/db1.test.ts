import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prismaConstructor: vi.fn()
}));

const globalWithPrisma = globalThis as unknown as { prisma?: unknown };

vi.mock('@prisma/client', () => {
  class MockPrismaClient {
    constructor() {
      mocks.prismaConstructor();
    }
  }

  return { PrismaClient: MockPrismaClient };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubGlobal('prisma', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Prisma database client', () => {
  it('creates a new Prisma client when none is cached', async () => {
    const { prisma } = await import('./db');

    expect(prisma).toBeDefined();
    expect(mocks.prismaConstructor).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing Prisma client from global state', async () => {
    const existing = { user: { findUnique: vi.fn() } };
    vi.stubGlobal('prisma', existing);

    const { prisma } = await import('./db');

    expect(prisma).toBe(existing);
    expect(mocks.prismaConstructor).not.toHaveBeenCalled();
  });

  it('stores the client in global state in debug mode', async () => {
    vi.stubEnv('NODE_ENV', 'debug');

    const { prisma } = await import('./db');

    expect(globalWithPrisma.prisma).toBe(prisma);
    expect(mocks.prismaConstructor).toHaveBeenCalledTimes(1);
  });

  it('does not replace the cached client outside debug mode', async () => {
    const existing = { existing: true };
    vi.stubGlobal('prisma', existing);

    const { prisma } = await import('./db');

    expect(prisma).toBe(existing);
    expect(globalWithPrisma.prisma).toBe(existing);
  });

  it('reuses the debug-mode cache across module reloads', async () => {
    vi.stubEnv('NODE_ENV', 'debug');

    const first = await import('./db');
    vi.resetModules();
    const second = await import('./db');

    expect(second.prisma).toBe(first.prisma);
    expect(mocks.prismaConstructor).toHaveBeenCalledTimes(1);
  });
});
