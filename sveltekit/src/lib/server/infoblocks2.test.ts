
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  InfoBlockPlacement,
  InfoBlockView
} from '$lib/server/infoblocks/filter';

// vi.hoisted makes these mocks available inside the vi.mock factories.
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  selectVisibleInfoBlocks: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    infoBlock: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique
    }
  }
}));

vi.mock('$lib/server/infoblocks/filter', () => ({
  selectVisibleInfoBlocks: mocks.selectVisibleInfoBlocks
}));

import { loadInfoBlocks, requireInfoBlock } from '$lib/server/infoblocks';

describe('loadInfoBlocks', () => {
  const placement = 'header' as InfoBlockPlacement;

  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findUnique.mockReset();
    mocks.selectVisibleInfoBlocks.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches blocks using the expected query and returns visible blocks', async () => {
    const databaseRows = [
      { id: 1, content: 'First block' },
      { id: 2, content: 'Second block' }
    ];

    const visibleBlocks = [
      { id: 2, content: 'Second block' }
    ] as unknown as InfoBlockView[];

    const now = new Date('2026-11-27T10:00:00.000Z');

    mocks.findMany.mockResolvedValue(databaseRows);
    mocks.selectVisibleInfoBlocks.mockReturnValue(visibleBlocks);

    const result = await loadInfoBlocks({
      placement,
      lang: 'de',
      email: 'user@example.com',
      now
    });

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        active: { gt: 0 },
        placements: { has: placement }
      },
      orderBy: [
        { position: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        content: true,
        variant: true,
        lang: true,
        placements: true,
        emailPattern: true,
        validFrom: true,
        validUntil: true,
        active: true
      }
    });

    expect(mocks.selectVisibleInfoBlocks).toHaveBeenCalledTimes(1);
    expect(mocks.selectVisibleInfoBlocks).toHaveBeenCalledWith(
      databaseRows,
      {
        placement,
        lang: 'de',
        email: 'user@example.com',
        now
      }
    );

    // The result from the visibility filter is returned unchanged.
    expect(result).toBe(visibleBlocks);
  });

  it('uses null for an undefined email and the current date when now is omitted', async () => {
    const fixedNow = new Date('2026-11-27T12:00:00.000Z');

    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    mocks.findMany.mockResolvedValue([]);
    mocks.selectVisibleInfoBlocks.mockReturnValue([]);

    await loadInfoBlocks({
      placement,
      lang: 'en'
    });

    expect(mocks.selectVisibleInfoBlocks).toHaveBeenCalledWith(
      [],
      {
        placement,
        lang: 'en',
        email: null,
        now: fixedNow
      }
    );
  });

  it('preserves an explicitly supplied null email', async () => {
    const now = new Date('2026-11-27T12:00:00.000Z');

    mocks.findMany.mockResolvedValue([]);
    mocks.selectVisibleInfoBlocks.mockReturnValue([]);

    await loadInfoBlocks({
      placement,
      lang: 'en',
      email: null,
      now
    });

    expect(mocks.selectVisibleInfoBlocks).toHaveBeenCalledWith(
      [],
      {
        placement,
        lang: 'en',
        email: null,
        now
      }
    );
  });

  it('propagates database errors', async () => {
    const databaseError = new Error('Database connection failed');

    mocks.findMany.mockRejectedValue(databaseError);

    await expect(
      loadInfoBlocks({
        placement,
        lang: 'de'
      })
    ).rejects.toBe(databaseError);

    expect(mocks.selectVisibleInfoBlocks).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by the visibility filter', async () => {
    const filterError = new Error('Visibility filtering failed');

    mocks.findMany.mockResolvedValue([]);
    mocks.selectVisibleInfoBlocks.mockImplementation(() => {
      throw filterError;
    });

    await expect(
      loadInfoBlocks({
        placement,
        lang: 'de'
      })
    ).rejects.toBe(filterError);
  });
});

describe('requireInfoBlock', () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findUnique.mockReset();
    mocks.selectVisibleInfoBlocks.mockReset();
  });

  it.each([
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])('throws HTTP 400 for an invalid ID: %s', async (invalidId) => {
    await expect(
      requireInfoBlock(invalidId)
    ).rejects.toMatchObject({
      status: 400,
      body: {
        message: 'Ungültige Infoblock-ID.'
      }
    });

    // Invalid IDs must be rejected before accessing the database.
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('fetches an info block by its ID', async () => {
    const infoBlock = {
      id: 42,
      content: 'Test info block'
    };

    mocks.findUnique.mockResolvedValue(infoBlock);

    const result = await requireInfoBlock(42);

    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        id: 42
      }
    });

    expect(result).toBe(infoBlock);
  });

  it('throws HTTP 404 when the info block does not exist', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(
      requireInfoBlock(999)
    ).rejects.toMatchObject({
      status: 404,
      body: {
        message: 'Infoblock wurde nicht gefunden.'
      }
    });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        id: 999
      }
    });
  });

  it('propagates database errors', async () => {
    const databaseError = new Error('Database connection failed');

    mocks.findUnique.mockRejectedValue(databaseError);

    await expect(
      requireInfoBlock(42)
    ).rejects.toBe(databaseError);
  });
});
