import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '$lib/server/db';
import { COURSE_LANGS, type CourseLang } from '$lib/courseLang';
import {
  courseAvailability,
  overlayOptions,
  overlayTranslation
} from '$lib/server/courseTranslations/core';
import {
  findCourseForLang,
  findElementForLang,
  findElementsForLang,
  findLessonForLang,
  findLessonsForLang,
  findQuizQuestionsForLang,
  linkableLanguagesOfCourse,
  listCoursesForLang,
  slugsForLangs
} from './courseTranslations';

vi.mock('$lib/server/db', () => ({
  prisma: {
    course: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn()
    },
    lesson: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn()
    },
    element: {
      findUnique: vi.fn(),
      findMany: vi.fn()
    },
    quizQuestion: {
      findMany: vi.fn()
    }
  }
}));

// Keep these tests focused on the orchestration in courseTranslations.ts.
// The core translation helpers should have their own unit tests.
vi.mock('$lib/server/courseTranslations/core', () => ({
  COURSE_TRANSLATABLE_FIELDS: ['title', 'description'],
  ELEMENT_TRANSLATABLE_FIELDS: ['content'],
  LESSON_TRANSLATABLE_FIELDS: ['title'],
  QUIZ_TRANSLATABLE_FIELDS: ['question'],
  courseAvailability: vi.fn(),
  overlayOptions: vi.fn(),
  overlayTranslation: vi.fn()
}));

const LANG_A = COURSE_LANGS[0] as CourseLang;
const LANG_B = COURSE_LANGS[1] as CourseLang;

const makeCourse = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  URL: 'source-course',
  lang: LANG_A,
  active: 1,
  position: 1,
  title: 'Source course title',
  description: 'Source course description',
  translations: [],
  ...overrides
});

const makeLesson = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  courseId: 1,
  URL: 'source-lesson',
  active: 1,
  position: 1,
  title: 'Source lesson title',
  translations: [],
  ...overrides
});

const makeElement = (overrides: Record<string, unknown> = {}) => ({
  id: 20,
  lessonId: 10,
  position: 1,
  content: 'Source element content',
  translations: [],
  ...overrides
});

const makeQuizQuestion = (overrides: Record<string, unknown> = {}) => ({
  id: 30,
  lessonId: 10,
  position: 1,
  question: 'Source question',
  type: 'single-choice',
  options: ['Source option 1', 'Source option 2'],
  translations: [],
  ...overrides
});

function applyTranslation(
  row: Record<string, unknown>,
  translation: Record<string, unknown> | undefined,
  fields: readonly string[]
) {
  const localized = { ...row };
  for (const field of fields) {
    if (translation?.[field] !== undefined) localized[field] = translation[field];
  }
  return localized;
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(courseAvailability).mockReturnValue({ available: true, active: 1 } as never);
  vi.mocked(overlayTranslation).mockImplementation(
    ((row: Record<string, unknown>, translation: Record<string, unknown> | undefined, fields: string[]) =>
      applyTranslation(row, translation, fields)) as typeof overlayTranslation
  );
  vi.mocked(overlayOptions).mockImplementation(
    ((sourceOptions: unknown[], translatedOptions?: unknown[]) =>
      translatedOptions ?? sourceOptions) as typeof overlayOptions
  );
});

describe('findCourseForLang', () => {
  it('finds a translated slug first and returns the localized course', async () => {
    const course = makeCourse({
      translations: [
        { lang: LANG_B, URL: 'translated-course', title: 'Localized title', active: 0 }
      ]
    });
    vi.mocked(prisma.course.findFirst).mockResolvedValue(course as never);
    vi.mocked(courseAvailability).mockReturnValue({ available: true, active: 0 } as never);

    const result = await findCourseForLang('translated-course', LANG_B);

    expect(prisma.course.findFirst).toHaveBeenCalledWith({
      where: { translations: { some: { lang: LANG_B, URL: 'translated-course' } } },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 1,
      title: 'Localized title',
      URL: 'translated-course',
      sourceURL: 'source-course',
      active: 0
    });
    expect(result).not.toHaveProperty('translations');
  });

  it('falls back to the source slug and uses the translated slug as canonical URL', async () => {
    const course = makeCourse({
      translations: [{ lang: LANG_B, URL: 'canonical-translated-course', title: 'Localized title' }]
    });
    vi.mocked(prisma.course.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(course as never);

    const result = await findCourseForLang('source-course', LANG_B);

    expect(prisma.course.findUnique).toHaveBeenCalledWith({
      where: { URL: 'source-course' },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result?.URL).toBe('canonical-translated-course');
    expect(result?.sourceURL).toBe('source-course');
  });

  it('returns null when no course matches either slug', async () => {
    vi.mocked(prisma.course.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(null as never);

    await expect(findCourseForLang('missing-course', LANG_B)).resolves.toBeNull();
  });

  it('returns null when the course is unavailable in the requested language', async () => {
    vi.mocked(prisma.course.findFirst).mockResolvedValue(makeCourse() as never);
    vi.mocked(courseAvailability).mockReturnValue({ available: false, active: 0 } as never);

    await expect(findCourseForLang('source-course', LANG_A)).resolves.toBeNull();
  });
});

describe('slugsForLangs', () => {
  it('returns translated slugs and falls back to source slugs when a translation is missing or empty', async () => {
    vi.mocked(prisma.course.findUniqueOrThrow).mockResolvedValue(
      {
        URL: 'source-course',
        translations: [{ lang: LANG_B, URL: '' }]
      } as never
    );
    vi.mocked(prisma.lesson.findUniqueOrThrow).mockResolvedValue(
      {
        URL: 'source-lesson',
        translations: [{ lang: LANG_B, URL: 'translated-lesson' }]
      } as never
    );

    const getSlugs = await slugsForLangs(1, 10);

    expect(getSlugs(LANG_A)).toEqual({ course: 'source-course', lesson: 'source-lesson' });
    expect(getSlugs(LANG_B)).toEqual({ course: 'source-course', lesson: 'translated-lesson' });
    expect(prisma.course.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { URL: true, translations: { select: { lang: true, URL: true } } }
    });
    expect(prisma.lesson.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { URL: true, translations: { select: { lang: true, URL: true } } }
    });
  });

  it('does not query a lesson when no lesson id is supplied', async () => {
    vi.mocked(prisma.course.findUniqueOrThrow).mockResolvedValue(
      { URL: 'source-course', translations: [] } as never
    );

    const getSlugs = await slugsForLangs(1);

    expect(getSlugs(LANG_A)).toEqual({ course: 'source-course', lesson: null });
    expect(prisma.lesson.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('linkableLanguagesOfCourse', () => {
  it('includes only active language versions for learners and all versions for editors', async () => {
    vi.mocked(prisma.course.findUnique).mockResolvedValue(
      makeCourse({
        lang: LANG_A,
        active: 1,
        translations: [
          { lang: LANG_B, active: 0 },
          { lang: LANG_B, active: 0 }
        ]
      }) as never
    );

    await expect(linkableLanguagesOfCourse(1, false)).resolves.toEqual([LANG_A]);
    await expect(linkableLanguagesOfCourse(1, true)).resolves.toEqual(
      COURSE_LANGS.filter((lang) => lang === LANG_A || lang === LANG_B)
    );
  });

  it('returns an empty list when the course does not exist', async () => {
    vi.mocked(prisma.course.findUnique).mockResolvedValue(null as never);

    await expect(linkableLanguagesOfCourse(999, true)).resolves.toEqual([]);
  });
});

describe('listCoursesForLang', () => {
  it('localizes results and excludes unavailable or inactive language versions', async () => {
    const rows = [
      makeCourse({
        id: 1,
        translations: [{ lang: LANG_B, URL: 'course-one-de', title: 'Course one DE' }]
      }),
      makeCourse({
        id: 2,
        translations: [{ lang: LANG_B, URL: 'course-two-de', title: 'Course two DE' }]
      }),
      makeCourse({
        id: 3,
        translations: [{ lang: LANG_B, URL: 'course-three-de', title: 'Course three DE' }]
      })
    ];
    vi.mocked(prisma.course.findMany).mockResolvedValue(rows as never);
    vi.mocked(courseAvailability)
      .mockReturnValueOnce({ available: true, active: 1 } as never)
      .mockReturnValueOnce({ available: true, active: 0 } as never)
      .mockReturnValueOnce({ available: false, active: 0 } as never);

    const result = await listCoursesForLang(LANG_B);

    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { lang: LANG_B, active: { gt: 0 } },
          { translations: { some: { lang: LANG_B, active: { gt: 0 } } } }
        ]
      },
      include: { translations: { where: { lang: LANG_B } } },
      orderBy: { position: 'asc' }
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      title: 'Course one DE',
      URL: 'course-one-de',
      sourceURL: 'source-course',
      active: 1
    });
    expect(result[0]).not.toHaveProperty('translations');
  });
});

describe('findLessonsForLang', () => {
  it('queries active lessons in position order and localizes each lesson', async () => {
    vi.mocked(prisma.lesson.findMany).mockResolvedValue(
      [
        makeLesson({
          URL: 'lesson-source',
          translations: [{ lang: LANG_B, URL: 'lesson-de', title: 'Localized lesson' }]
        })
      ] as never
    );

    const result = await findLessonsForLang(1, LANG_B);

    expect(prisma.lesson.findMany).toHaveBeenCalledWith({
      where: { courseId: 1, active: 1 },
      orderBy: { position: 'asc' },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result[0]).toMatchObject({
      title: 'Localized lesson',
      URL: 'lesson-de',
      sourceURL: 'lesson-source'
    });
    expect(result[0]).not.toHaveProperty('translations');
  });
});

describe('findLessonForLang', () => {
  it('resolves a translated lesson slug without trying the source slug', async () => {
    const lesson = makeLesson({
      translations: [{ lang: LANG_B, URL: 'lesson-de', title: 'Localized lesson' }]
    });
    vi.mocked(prisma.lesson.findFirst).mockResolvedValue(lesson as never);

    const result = await findLessonForLang(1, 'lesson-de', LANG_B);

    expect(prisma.lesson.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.lesson.findFirst).toHaveBeenCalledWith({
      where: { courseId: 1, translations: { some: { lang: LANG_B, URL: 'lesson-de' } } },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result?.URL).toBe('lesson-de');
    expect(result?.sourceURL).toBe('source-lesson');
  });

  it('falls back to the source lesson slug', async () => {
    const lesson = makeLesson({
      translations: [{ lang: LANG_B, URL: 'canonical-lesson-de', title: 'Localized lesson' }]
    });
    vi.mocked(prisma.lesson.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(lesson as never);

    const result = await findLessonForLang(1, 'source-lesson', LANG_B);

    expect(prisma.lesson.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.lesson.findFirst).toHaveBeenNthCalledWith(2, {
      where: { URL: 'source-lesson', courseId: 1 },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result?.URL).toBe('canonical-lesson-de');
  });

  it('returns null when neither slug resolves', async () => {
    vi.mocked(prisma.lesson.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    await expect(findLessonForLang(1, 'missing-lesson', LANG_B)).resolves.toBeNull();
  });
});

describe('findElementsForLang', () => {
  it('returns elements in position order with translated content', async () => {
    vi.mocked(prisma.element.findMany).mockResolvedValue(
      [
        makeElement({
          translations: [{ lang: LANG_B, content: 'Localized element content' }]
        })
      ] as never
    );

    const result = await findElementsForLang(10, LANG_B);

    expect(prisma.element.findMany).toHaveBeenCalledWith({
      where: { lessonId: 10 },
      orderBy: { position: 'asc' },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result[0]).toMatchObject({ content: 'Localized element content' });
    expect(result[0]).not.toHaveProperty('translations');
  });
});

describe('findElementForLang', () => {
  it('localizes an element by id', async () => {
    vi.mocked(prisma.element.findUnique).mockResolvedValue(
      makeElement({ translations: [{ lang: LANG_B, content: 'Localized content' }] }) as never
    );

    const result = await findElementForLang(20, LANG_B);

    expect(prisma.element.findUnique).toHaveBeenCalledWith({
      where: { id: 20 },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result).toMatchObject({ id: 20, content: 'Localized content' });
    expect(result).not.toHaveProperty('translations');
  });

  it('returns null when the element does not exist', async () => {
    vi.mocked(prisma.element.findUnique).mockResolvedValue(null as never);

    await expect(findElementForLang(999, LANG_B)).resolves.toBeNull();
  });
});

describe('findQuizQuestionsForLang', () => {
  it('localizes question text and options while preserving source option indexes', async () => {
    const questions = [
      makeQuizQuestion({
        translations: [
          {
            lang: LANG_B,
            question: 'Localized question',
            options: ['Localized option 1', 'Localized option 2']
          }
        ]
      }),
      makeQuizQuestion({
        id: 31,
        position: 2,
        question: 'Question without translation',
        options: ['Yes', 'No'],
        translations: []
      })
    ];
    vi.mocked(prisma.quizQuestion.findMany).mockResolvedValue(questions as never);

    const result = await findQuizQuestionsForLang(10, LANG_B);

    expect(prisma.quizQuestion.findMany).toHaveBeenCalledWith({
      where: { lessonId: 10 },
      orderBy: { position: 'asc' },
      include: { translations: { where: { lang: LANG_B } } }
    });
    expect(result).toEqual([
      {
        id: 30,
        question: 'Localized question',
        type: 'single-choice',
        position: 1,
        options: [
          { index: 0, text: 'Localized option 1' },
          { index: 1, text: 'Localized option 2' }
        ]
      },
      {
        id: 31,
        question: 'Question without translation',
        type: 'single-choice',
        position: 2,
        options: [
          { index: 0, text: 'Yes' },
          { index: 1, text: 'No' }
        ]
      }
    ]);
    expect(overlayOptions).toHaveBeenNthCalledWith(
      1,
      ['Source option 1', 'Source option 2'],
      ['Localized option 1', 'Localized option 2']
    );
    expect(overlayOptions).toHaveBeenNthCalledWith(2, ['Yes', 'No'], undefined);
  });
});
