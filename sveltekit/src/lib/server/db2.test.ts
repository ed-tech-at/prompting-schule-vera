
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Access the global Prisma instance used by db.ts.
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: unknown;
};

const originalNodeEnv = process.env.NODE_ENV;

/**
 * Dynamically import db.ts with a mocked PrismaClient.
 *
 * Resetting the module cache ensures db.ts executes again
 * for each test.
 */
async function loadDb() {
  // Use a regular function because PrismaClient is instantiated with `new`.
  const PrismaClient = vi.fn(function PrismaClientMock() {
    return {
      mocked: true,
    };
  });

  vi.doMock('@prisma/client', () => ({
    PrismaClient,
  }));

  const db = await import('./db');

  return {
    ...db,
    PrismaClient,
  };
}

describe('prisma database client', () => {
  beforeEach(() => {
    vi.resetModules();

    // Ensure tests start without a cached Prisma instance.
    delete globalForPrisma.prisma;
  });

  afterEach(() => {
    // Restore the original environment.
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    // Clean up global state and module mocks.
    delete globalForPrisma.prisma;
    vi.doUnmock('@prisma/client');
    vi.resetModules();
  });

  it('creates a new PrismaClient when no global instance exists', async () => {
    process.env.NODE_ENV = 'test';

    const { prisma, PrismaClient } = await loadDb();

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(prisma).toEqual({ mocked: true });
  });

  it('reuses an existing global Prisma instance', async () => {
    process.env.NODE_ENV = 'test';

    const existingPrisma = { existing: true };
    globalForPrisma.prisma = existingPrisma;

    const { prisma, PrismaClient } = await loadDb();

    expect(PrismaClient).not.toHaveBeenCalled();
    expect(prisma).toBe(existingPrisma);
  });

  it('stores the Prisma instance globally when NODE_ENV is debug', async () => {
    process.env.NODE_ENV = 'debug';

    const { prisma, PrismaClient } = await loadDb();

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(globalForPrisma.prisma).toBe(prisma);
  });

  it('does not store a newly created instance globally outside debug mode', async () => {
    process.env.NODE_ENV = 'production';

    const { prisma, PrismaClient } = await loadDb();

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(globalForPrisma.prisma).toBeUndefined();
    expect(prisma).toEqual({ mocked: true });
  });

  it('reuses an existing instance even when NODE_ENV is debug', async () => {
    process.env.NODE_ENV = 'debug';

    const existingPrisma = { existing: true };
    globalForPrisma.prisma = existingPrisma;

    const { prisma, PrismaClient } = await loadDb();

    expect(PrismaClient).not.toHaveBeenCalled();
    expect(prisma).toBe(existingPrisma);
    expect(globalForPrisma.prisma).toBe(existingPrisma);
  });
});
