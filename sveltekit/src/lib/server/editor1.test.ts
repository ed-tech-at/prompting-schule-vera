import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminManager: vi.fn(),
  writeAdminAuditLog: vi.fn()
}));

vi.mock('@sveltejs/kit', () => ({
  isHttpError: (value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'body' in value
}));

vi.mock('$lib/server/admin', () => ({
  requireAdminManager: mocks.requireAdminManager,
  writeAdminAuditLog: mocks.writeAdminAuditLog
}));

import {
  EDITOR_AUDIT_ACTIONS,
  EDITOR_LEVEL,
  ELEMENT_TYPES,
  QUIZ_QUESTION_TYPES,
  SLUG_PATTERN,
  editorAuditFailure,
  editorErrorMessage,
  readInt,
  readString,
  reorderSwap,
  requireEditor,
  writeEditorAuditLog
} from './editor';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('editor constants', () => {
  it('uses the expected editor role level and slug pattern', () => {
    expect(EDITOR_LEVEL).toBe(5);
    expect(SLUG_PATTERN.test('mein-kurs-2026')).toBe(true);
    expect(SLUG_PATTERN.test('Mein Kurs')).toBe(false);
  });

  it('defines the supported element and quiz question types', () => {
    expect(ELEMENT_TYPES).toContain('text');
    expect(ELEMENT_TYPES).toContain('star');
    expect(QUIZ_QUESTION_TYPES).toEqual(['s', 'm']);
  });

  it('contains stable audit action names', () => {
    expect(EDITOR_AUDIT_ACTIONS.COURSE_CREATED).toBe('COURSE_CREATED');
    expect(EDITOR_AUDIT_ACTIONS.QUIZ_QUESTION_DELETED).toBe('QUIZ_QUESTION_DELETED');
  });
});

describe('requireEditor', () => {
  it('delegates authorization to requireAdminManager with the editor level', async () => {
    const cookies = {} as Cookies;
    const actor = { id: 'editor', email: 'editor@example.at', isAdmin: EDITOR_LEVEL };
    mocks.requireAdminManager.mockResolvedValue(actor);

    await expect(requireEditor(cookies)).resolves.toEqual(actor);
    expect(mocks.requireAdminManager).toHaveBeenCalledWith(cookies, EDITOR_LEVEL);
  });
});

describe('editor audit logging', () => {
  it('writes content audit entries with an empty target user', async () => {
    await writeEditorAuditLog({
      actorUserId: 'actor',
      action: 'COURSE_UPDATED',
      outcome: 'SUCCESS',
      metadata: { courseId: 12, active: true }
    });

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      actorUserId: 'actor',
      targetUserId: '',
      action: 'COURSE_UPDATED',
      outcome: 'SUCCESS',
      metadata: { courseId: 12, active: true }
    });
  });

  it('writes an HTTP failure audit entry with a status reason', async () => {
    const httpError = { status: 403, body: { message: 'Forbidden' } };

    await editorAuditFailure('actor', 'COURSE_DELETED', httpError, { courseId: 12 });

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'actor',
      targetUserId: '',
      action: 'COURSE_DELETED',
      outcome: 'FAILED',
      metadata: { courseId: 12, reason: 'HTTP_403' }
    }));
  });

  it('writes a generic failure reason for non-HTTP errors', async () => {
    await editorAuditFailure('actor', 'LESSON_UPDATED', new Error('Database unavailable'));

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'FAILED',
      metadata: { reason: 'ACTION_FAILED' }
    }));
  });

  it('does not throw when writing the failure audit entry itself fails', async () => {
    mocks.writeAdminAuditLog.mockRejectedValueOnce(new Error('Audit unavailable'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      editorAuditFailure('actor', 'ELEMENT_DELETED', new Error('Delete failed'))
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to write editor audit log:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});

describe('form data helpers', () => {
  it('reads and trims string values', () => {
    const formData = new FormData();
    formData.set('name', '  Mein Kurs  ');

    expect(readString(formData, 'name')).toBe('Mein Kurs');
  });

  it('returns an empty string for missing or non-string values', () => {
    const formData = new FormData();

    expect(readString(formData, 'missing')).toBe('');
  });

  it('parses integer form values', () => {
    const formData = new FormData();
    formData.set('position', '42');

    expect(readInt(formData, 'position')).toBe(42);
  });

  it('returns NaN for missing or invalid integer values', () => {
    const formData = new FormData();
    formData.set('position', 'not-a-number');

    expect(readInt(formData, 'position')).toBeNaN();
  });
});

describe('editorErrorMessage', () => {
  it('uses the message from an HTTP error', () => {
    expect(editorErrorMessage({
      status: 400,
      body: { message: 'Ungültige Eingabe' }
    })).toBe('Ungültige Eingabe');
  });

  it('uses a regular Error message', () => {
    expect(editorErrorMessage(new Error('Database unavailable'))).toBe('Database unavailable');
  });

  it('uses the fallback message for unknown errors', () => {
    expect(editorErrorMessage('failure')).toBe('Die Aktion konnte nicht ausgeführt werden.');
  });
});

describe('reorderSwap', () => {
  const items = [{ id: 10 }, { id: 20 }, { id: 30 }];

  it('moves an item up and returns full 1-based positions', () => {
    expect(reorderSwap(items, 20, 'up')).toEqual([
      { id: 20, position: 1 },
      { id: 10, position: 2 },
      { id: 30, position: 3 }
    ]);
  });

  it('moves an item down and returns full 1-based positions', () => {
    expect(reorderSwap(items, 20, 'down')).toEqual([
      { id: 10, position: 1 },
      { id: 30, position: 2 },
      { id: 20, position: 3 }
    ]);
  });

  it('returns null for an unknown item', () => {
    expect(reorderSwap(items, 999, 'up')).toBeNull();
  });

  it('returns null when the item is already at the requested edge', () => {
    expect(reorderSwap(items, 10, 'up')).toBeNull();
    expect(reorderSwap(items, 30, 'down')).toBeNull();
  });
});
