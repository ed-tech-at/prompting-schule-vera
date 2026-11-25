import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { loadInfoBlocks, requireInfoBlock } from './infoblocks';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.selectVisibleInfoBlocks.mockReturnValue([]);
});

describe('loadInfoBlocks', () => {
  it('loads active blocks for the placement in display order and passes visibility context', async () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    const records = [{ id: 7, content: 'Hallo', variant: 'info' }];
    const views = [{ id: 7, content: 'Hallo', variant: 'info' as const }];

    mocks.findMany.mockResolvedValue(records);
    mocks.selectVisibleInfoBlocks.mockReturnValue(views);

    await expect(
      loadInfoBlocks({ placement: 'startseite', lang: 'de', email: 'max@tugraz.at', now })
    ).resolves.toEqual(views);

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { active: { gt: 0 }, placements: { has: 'startseite' } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
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
    expect(mocks.selectVisibleInfoBlocks).toHaveBeenCalledWith(records, {
      placement: 'startseite',
      lang: 'de',
      email: 'max@tugraz.at',
      now
    });
  });

  it('uses null for a missing email and supplies the current time by default', async () => {
    const before = Date.now();

    await loadInfoBlocks({ placement: 'kursuebersicht', lang: 'en' });

    const context = mocks.selectVisibleInfoBlocks.mock.calls[0][1];
    expect(context).toMatchObject({
      placement: 'kursuebersicht',
      lang: 'en',
      email: null
    });
    expect(context.now).toBeInstanceOf(Date);
    expect(context.now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('normalizes an explicit null email the same as an omitted email', async () => {
    await loadInfoBlocks({ placement: 'profil', lang: 'de', email: null });

    expect(mocks.selectVisibleInfoBlocks).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ email: null })
    );
  });
});

describe('requireInfoBlock', () => {
  it('rejects non-integer ids without querying the database', async () => {
    await expect(requireInfoBlock(1.5)).rejects.toMatchObject({ status: 400 });
    await expect(requireInfoBlock(NaN)).rejects.toMatchObject({ status: 400 });

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns a 404 for an unknown id', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(requireInfoBlock(42)).rejects.toMatchObject({ status: 404 });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
  });

  it('returns the found infoblock', async () => {
    const block = { id: 42, content: 'Hinweis', active: 1 };
    mocks.findUnique.mockResolvedValue(block);

    await expect(requireInfoBlock(42)).resolves.toBe(block);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
  });
});
