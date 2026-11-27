
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, type Cookies } from '@sveltejs/kit';
import type { AdminActor } from '$lib/server/admin';
import {
  requireAdminManager,
  writeAdminAuditLog
} from '$lib/server/admin';

import {
  EDITOR_LEVEL,
  ELEMENT_TYPES,
  QUIZ_QUESTION_TYPES,
  SLUG_PATTERN,
  EDITOR_AUDIT_ACTIONS,
  requireEditor,
  writeEditorAuditLog,
  editorAuditFailure,
  readString,
  readInt,
  editorErrorMessage,
  reorderSwap
} from './editor';

// Mock admin dependencies to keep these tests isolated.
vi.mock('$lib/server/admin', () => ({
  requireAdminManager: vi.fn(),
  writeAdminAuditLog: vi.fn()
}));

const mockedRequireAdminManager = vi.mocked(requireAdminManager);
const mockedWriteAdminAuditLog = vi.mocked(writeAdminAuditLog);

function createHttpError(status: number, message: string): unknown {
  try {
    error(status, { message });
  } catch (caught) {
    return caught;
  }

  throw new Error('Expected SvelteKit error() to throw');
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

describe('editor constants', () => {
  it('exports the correct editor permission level', () => {
    expect(EDITOR_LEVEL).toBe(5);
  });

  it('exports all supported element types', () => {
    expect(ELEMENT_TYPES).toEqual([
      'text',
      'text-negativeMarginTop',
      'note',
      'aiSide',
      'aiSideTool',
      'aiSideMemory',
      'ai1',
      'ai1only',
      'ai2',
      'ai2only',
      'ai12',
      'directDevUser',
      'directDevUserUser',
      'labor',
      'star'
    ]);
  });

  it('exports the supported quiz question types', () => {
    expect(QUIZ_QUESTION_TYPES).toEqual(['s', 'm']);
  });

  it('exports the expected slug pattern', () => {
    expect(SLUG_PATTERN).toBeInstanceOf(RegExp);

    expect(SLUG_PATTERN.test('course')).toBe(true);
    expect(SLUG_PATTERN.test('my-course-123')).toBe(true);
    expect(SLUG_PATTERN.test('abc123')).toBe(true);

    expect(SLUG_PATTERN.test('')).toBe(false);
    expect(SLUG_PATTERN.test('MyCourse')).toBe(false);
    expect(SLUG_PATTERN.test('my_course')).toBe(false);
    expect(SLUG_PATTERN.test('my course')).toBe(false);
    expect(SLUG_PATTERN.test('course!')).toBe(false);
  });

  it('exports all editor audit actions', () => {
    expect(Object.values(EDITOR_AUDIT_ACTIONS)).toEqual([
      'COURSE_CREATED',
      'COURSE_UPDATED',
      'COURSE_DELETED',
      'COURSE_EXPORTED',
      'COURSE_IMPORT_UPDATED',
      'COURSE_IMPORT_COPIED',
      'LESSON_CREATED',
      'LESSON_UPDATED',
      'LESSON_DELETED',
      'ELEMENT_CREATED',
      'ELEMENT_UPDATED',
      'ELEMENT_DELETED',
      'QUIZ_QUESTION_CREATED',
      'QUIZ_QUESTION_UPDATED',
      'QUIZ_QUESTION_DELETED',
      'TRANSLATION_CREATED',
      'TRANSLATION_UPDATED',
      'TRANSLATION_DELETED',
      'INFOBLOCK_CREATED',
      'INFOBLOCK_UPDATED',
      'INFOBLOCK_DELETED'
    ]);
  });
});

// -----------------------------------------------------------------------------
// requireEditor
// -----------------------------------------------------------------------------

describe('requireEditor', () => {
  it('delegates to requireAdminManager using EDITOR_LEVEL', async () => {
    const cookies = {} as unknown as Cookies;
    const actor = { userId: 'admin-123' } as unknown as AdminActor;

    mockedRequireAdminManager.mockResolvedValue(actor);

    const result = await requireEditor(cookies);

    expect(mockedRequireAdminManager).toHaveBeenCalledOnce();
    expect(mockedRequireAdminManager).toHaveBeenCalledWith(
      cookies,
      EDITOR_LEVEL
    );
    expect(result).toBe(actor);
  });

  it('propagates errors from requireAdminManager', async () => {
    const cookies = {} as unknown as Cookies;
    const expectedError = new Error('Access denied');

    mockedRequireAdminManager.mockRejectedValue(expectedError);

    await expect(requireEditor(cookies)).rejects.toBe(expectedError);
  });
});

// -----------------------------------------------------------------------------
// writeEditorAuditLog
// -----------------------------------------------------------------------------

describe('writeEditorAuditLog', () => {
  it('writes an audit log with an empty targetUserId', async () => {
    const input = {
      actorUserId: 'admin-123',
      action: EDITOR_AUDIT_ACTIONS.COURSE_CREATED,
      outcome: 'SUCCESS' as const,
      metadata: {
        courseId: 'course-123',
        title: 'Test course',
        published: true
      }
    };

    await writeEditorAuditLog(input);

    expect(mockedWriteAdminAuditLog).toHaveBeenCalledOnce();
    expect(mockedWriteAdminAuditLog).toHaveBeenCalledWith({
      ...input,
      targetUserId: ''
    });
  });

  it('preserves the input metadata', async () => {
    const metadata = {
      courseId: 'course-123',
      lessonCount: 5,
      published: false,
      optionalValue: null
    };

    await writeEditorAuditLog({
      actorUserId: 'admin-123',
      action: 'COURSE_UPDATED',
      outcome: 'SUCCESS',
      metadata
    });

    expect(mockedWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata })
    );
  });

  it('propagates errors from writeAdminAuditLog', async () => {
    const expectedError = new Error('Database unavailable');

    mockedWriteAdminAuditLog.mockRejectedValue(expectedError);

    await expect(
      writeEditorAuditLog({
        actorUserId: 'admin-123',
        action: 'COURSE_CREATED',
        outcome: 'SUCCESS'
      })
    ).rejects.toBe(expectedError);
  });
});

// -----------------------------------------------------------------------------
// editorAuditFailure
// -----------------------------------------------------------------------------

describe('editorAuditFailure', () => {
  it('writes a failed audit log with the HTTP status as the reason', async () => {
    const httpError = createHttpError(403, 'Forbidden');

    await editorAuditFailure(
      'admin-123',
      'COURSE_UPDATED',
      httpError,
      {
        courseId: 'course-123'
      }
    );

    expect(mockedWriteAdminAuditLog).toHaveBeenCalledOnce();
    expect(mockedWriteAdminAuditLog).toHaveBeenCalledWith({
      actorUserId: 'admin-123',
      action: 'COURSE_UPDATED',
      outcome: 'FAILED',
      targetUserId: '',
      metadata: {
        courseId: 'course-123',
        reason: 'HTTP_403'
      }
    });
  });

  it('uses ACTION_FAILED for non-HTTP errors', async () => {
    await editorAuditFailure(
      'admin-123',
      'LESSON_DELETED',
      new Error('Something went wrong')
    );

    expect(mockedWriteAdminAuditLog).toHaveBeenCalledWith({
      actorUserId: 'admin-123',
      action: 'LESSON_DELETED',
      outcome: 'FAILED',
      targetUserId: '',
      metadata: {
        reason: 'ACTION_FAILED'
      }
    });
  });

  it('uses ACTION_FAILED when the caught value is not an Error', async () => {
    await editorAuditFailure(
      'admin-123',
      'ELEMENT_DELETED',
      'unexpected failure'
    );

    expect(mockedWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          reason: 'ACTION_FAILED'
        }
      })
    );
  });

  it('overwrites a supplied reason with the calculated reason', async () => {
    await editorAuditFailure(
      'admin-123',
      'COURSE_UPDATED',
      new Error('Update failed'),
      {
        courseId: 'course-123',
        reason: 'CUSTOM_REASON'
      }
    );

    expect(mockedWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          courseId: 'course-123',
          reason: 'ACTION_FAILED'
        }
      })
    );
  });

  it('does not throw when writing the failure audit log also fails', async () => {
    const auditError = new Error('Audit database unavailable');
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockedWriteAdminAuditLog.mockRejectedValue(auditError);

    await expect(
      editorAuditFailure(
        'admin-123',
        'COURSE_CREATED',
        new Error('Creation failed')
      )
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to write editor audit log:',
      auditError
    );
  });
});

// -----------------------------------------------------------------------------
// readString
// -----------------------------------------------------------------------------

describe('readString', () => {
  it('returns a trimmed string value', () => {
    const formData = new FormData();
    formData.set('title', '  My course  ');

    expect(readString(formData, 'title')).toBe('My course');
  });

  it('returns an empty string when the key does not exist', () => {
    const formData = new FormData();

    expect(readString(formData, 'missing')).toBe('');
  });

  it('returns an empty string for an empty value', () => {
    const formData = new FormData();
    formData.set('title', '   ');

    expect(readString(formData, 'title')).toBe('');
  });

  it('returns an empty string when the value is a File', () => {
    const formData = new FormData();
    formData.append(
      'attachment',
      new Blob(['file contents']),
      'attachment.txt'
    );

    expect(readString(formData, 'attachment')).toBe('');
  });
});

// -----------------------------------------------------------------------------
// readInt
// -----------------------------------------------------------------------------

describe('readInt', () => {
  it('parses a positive integer', () => {
    const formData = new FormData();
    formData.set('count', '42');

    expect(readInt(formData, 'count')).toBe(42);
  });

  it('parses a negative integer', () => {
    const formData = new FormData();
    formData.set('count', '-42');

    expect(readInt(formData, 'count')).toBe(-42);
  });

  it('trims whitespace before parsing', () => {
    const formData = new FormData();
    formData.set('count', '  123  ');

    expect(readInt(formData, 'count')).toBe(123);
  });

  it('uses parseInt semantics for values containing decimal places', () => {
    const formData = new FormData();
    formData.set('count', '12.75');

    expect(readInt(formData, 'count')).toBe(12);
  });

  it('returns NaN when the key does not exist', () => {
    const formData = new FormData();

    expect(Number.isNaN(readInt(formData, 'missing'))).toBe(true);
  });

  it('returns NaN for non-numeric values', () => {
    const formData = new FormData();
    formData.set('count', 'not-a-number');

    expect(Number.isNaN(readInt(formData, 'count'))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// editorErrorMessage
// -----------------------------------------------------------------------------

describe('editorErrorMessage', () => {
  it('returns the message from a SvelteKit HTTP error', () => {
    const httpError = createHttpError(404, 'Course not found');

    expect(editorErrorMessage(httpError)).toBe('Course not found');
  });

  it('returns the message from a standard Error', () => {
    const caught = new Error('Database connection failed');

    expect(editorErrorMessage(caught)).toBe(
      'Database connection failed'
    );
  });

  it('returns the fallback message when an Error has an empty message', () => {
    const caught = new Error('');

    expect(editorErrorMessage(caught)).toBe(
      'Die Aktion konnte nicht ausgeführt werden.'
    );
  });

  it('returns the fallback message for a string', () => {
    expect(editorErrorMessage('Something failed')).toBe(
      'Die Aktion konnte nicht ausgeführt werden.'
    );
  });

  it('returns the fallback message for null', () => {
    expect(editorErrorMessage(null)).toBe(
      'Die Aktion konnte nicht ausgeführt werden.'
    );
  });

  it('returns the fallback message for undefined', () => {
    expect(editorErrorMessage(undefined)).toBe(
      'Die Aktion konnte nicht ausgeführt werden.'
    );
  });
});

// -----------------------------------------------------------------------------
// reorderSwap
// -----------------------------------------------------------------------------

describe('reorderSwap', () => {
  const items = [
    { id: 10 },
    { id: 20 },
    { id: 30 },
    { id: 40 }
  ];

  it('moves an item up by one position', () => {
    const result = reorderSwap(items, 30, 'up');

    expect(result).toEqual([
      { id: 10, position: 1 },
      { id: 30, position: 2 },
      { id: 20, position: 3 },
      { id: 40, position: 4 }
    ]);
  });

  it('moves an item down by one position', () => {
    const result = reorderSwap(items, 20, 'down');

    expect(result).toEqual([
      { id: 10, position: 1 },
      { id: 30, position: 2 },
      { id: 20, position: 3 },
      { id: 40, position: 4 }
    ]);
  });

  it('renumbers all items starting from position 1', () => {
    const result = reorderSwap(items, 10, 'down');

    expect(result).toEqual([
      { id: 20, position: 1 },
      { id: 10, position: 2 },
      { id: 30, position: 3 },
      { id: 40, position: 4 }
    ]);
  });

  it('returns null when moving the first item up', () => {
    expect(reorderSwap(items, 10, 'up')).toBeNull();
  });

  it('returns null when moving the last item down', () => {
    expect(reorderSwap(items, 40, 'down')).toBeNull();
  });

  it('returns null when the target ID does not exist', () => {
    expect(reorderSwap(items, 999, 'up')).toBeNull();
    expect(reorderSwap(items, 999, 'down')).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(reorderSwap([], 10, 'up')).toBeNull();
    expect(reorderSwap([], 10, 'down')).toBeNull();
  });

  it('returns null when moving the only item in an array', () => {
    const singleItem = [{ id: 10 }];

    expect(reorderSwap(singleItem, 10, 'up')).toBeNull();
    expect(reorderSwap(singleItem, 10, 'down')).toBeNull();
  });

  it('does not mutate the original items array', () => {
    const originalItems = structuredClone(items);

    reorderSwap(items, 20, 'up');

    expect(items).toEqual(originalItems);
  });

  it('returns a new array rather than modifying the original array', () => {
    const result = reorderSwap(items, 20, 'up');

    expect(result).not.toBe(items);
  });
});
