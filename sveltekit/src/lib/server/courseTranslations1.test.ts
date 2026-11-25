import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  courseFindFirst: vi.fn(),
  courseFindUnique: vi.fn(),
  courseFindUniqueOrThrow: vi.fn(),
  courseFindMany: vi.fn(),
  lessonFindMany: vi.fn(),
  lessonFindFirst: vi.fn(),
  lessonFindUniqueOrThrow: vi.fn(),
  elementFindMany: vi.fn(),
  elementFindUnique: vi.fn(),
  quizFindMany: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    course: {
      findFirst: mocks.courseFindFirst,
      findUnique: mocks.courseFindUnique,
      findUniqueOrThrow: mocks.courseFindUniqueOrThrow,
      findMany: mocks.courseFindMany
    },
    lesson: {
      findMany: mocks.lessonFindMany,
      findFirst: mocks.lessonFindFirst,
      findUniqueOrThrow: mocks.lessonFindUniqueOrThrow
    },
    element: {
      findMany: mocks.elementFindMany,
      findUnique: mocks.elementFindUnique
    },
    quizQuestion: {
      findMany: mocks.quizFindMany
    }
  }
}));

import {
  findCourseForLang,
  findElementForLang,
  findElementsForLang,
  findLessonForLang,
  findLessonsForLang,
  findQuizQuestionsForLang,
  linkableLanguagesOfCourse,
  listCoursesForLang,
  localizeLesson,
  slugsForLangs
} from './courseTranslations';

beforeEach(() => {
  vi.clearAllMocks();
});

const sourceCourse = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  URL: 'prompting',
  name: 'Prompts',
  description: 'Source description',
  introDescription: 'Intro',
  introDescriptionSuffix: 'Suffix',
  lang: 'de',
  active: 1,
  position: 1,
  translations: [],
  ...overrides
});

describe('findCourseForLang', () => {
  it('localizes a translated course and keeps source and canonical slugs', async () => {
    mocks.courseFindFirst.mockResolvedValue(sourceCourse({
      translations: [{
        lang: 'en',
        URL: 'prompts',
        name: 'Prompts EN',
        description: '',
        active: 1
      }]
    }));

    const course = await findCourseForLang('prompts', 'en');

    expect(course).toMatchObject({
      URL: 'prompts',
      sourceURL: 'prompting',
      name: 'Prompts EN',
      description: 'Source description',
      active: 1
    });
    expect(course).not.toHaveProperty('translations');
  });

  it('falls back to the source slug lookup and uses source-language activity', async () => {
    mocks.courseFindFirst.mockResolvedValue(null);
    mocks.courseFindUnique.mockResolvedValue(sourceCourse({ active: 0 }));

    await expect(findCourseForLang('prompting', 'de')).resolves.toMatchObject({
      URL: 'prompting',
      sourceURL: 'prompting',
      active: 0
    });
  });

  it('returns null when the course has no translation in the requested language', async () => {
    mocks.courseFindFirst.mockResolvedValue(sourceCourse({ lang: 'de', translations: [] }));

    await expect(findCourseForLang('prompting', 'en')).resolves.toBeNull();
  });

  it('returns null when neither slug lookup finds a course', async () => {
    mocks.courseFindFirst.mockResolvedValue(null);
    mocks.courseFindUnique.mockResolvedValue(null);

    await expect(findCourseForLang('missing', 'de')).resolves.toBeNull();
  });
});

describe('course and language lists', () => {
  it('lists only active localized versions and applies course overlays', async () => {
    mocks.courseFindMany.mockResolvedValue([
      sourceCourse({
        translations: [{ active: 1, URL: 'prompts', name: 'Übersetzter Kurs' }]
      }),
      sourceCourse({
        id: 2,
        URL: 'hidden',
        lang: 'de',
        active: 1,
        translations: [{ active: 0, URL: 'hidden-en', name: 'Hidden' }]
      })
    ]);

    const courses = await listCoursesForLang('en');

    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ id: 1, URL: 'prompts', name: 'Übersetzter Kurs', active: 1 });
  });

  it('returns source slugs and translated slugs for all language flags', async () => {
    mocks.courseFindUniqueOrThrow.mockResolvedValue({
      URL: 'prompting',
      translations: [{ lang: 'en', URL: 'prompts' }]
    });
    mocks.lessonFindUniqueOrThrow.mockResolvedValue({
      URL: 'lektion',
      translations: [{ lang: 'en', URL: 'lesson' }]
    });

    const slugs = await slugsForLangs(1, 2);

    expect(slugs('de')).toEqual({ course: 'prompting', lesson: 'lektion' });
    expect(slugs('en')).toEqual({ course: 'prompts', lesson: 'lesson' });
  });

  it('offers hidden languages only when includeHidden is true', async () => {
    mocks.courseFindUnique.mockResolvedValue({
      lang: 'de',
      active: 1,
      translations: [{ lang: 'en', active: 0 }]
    });

    await expect(linkableLanguagesOfCourse(1, false)).resolves.toEqual(['de']);
    await expect(linkableLanguagesOfCourse(1, true)).resolves.toEqual(['de', 'en']);
  });

  it('returns no language flags for a missing course', async () => {
    mocks.courseFindUnique.mockResolvedValue(null);

    await expect(linkableLanguagesOfCourse(999, true)).resolves.toEqual([]);
  });
});

describe('lesson localization', () => {
  it('uses a translated lesson slug and falls back for missing text', () => {
    const lesson = {
      id: 3,
      URL: 'lektion',
      lessonName: 'Source lesson',
      translations: [{ URL: 'lesson', lessonName: '' }]
    };

    expect(localizeLesson(lesson as never)).toEqual(expect.objectContaining({
      URL: 'lesson',
      sourceURL: 'lektion',
      lessonName: 'Source lesson'
    }));
  });

  it('resolves translated and source lesson slugs', async () => {
    mocks.lessonFindFirst
      .mockResolvedValueOnce({
        id: 3,
        URL: 'lektion',
        lessonName: 'Source lesson',
        translations: [{ URL: 'lesson', lessonName: 'English lesson' }]
      })
      .mockResolvedValueOnce({
        id: 3,
        URL: 'lektion',
        lessonName: 'Lektion',
        translations: []
      });

    await expect(findLessonForLang(1, 'lesson', 'en')).resolves.toMatchObject({
      URL: 'lesson', lessonName: 'English lesson'
    });
    await expect(findLessonForLang(1, 'lektion', 'de')).resolves.toMatchObject({
      URL: 'lektion', lessonName: 'Lektion'
    });
  });

  it('maps active lessons in display order and localizes their names', async () => {
    mocks.lessonFindMany.mockResolvedValue([
      { id: 1, URL: 'eins', lessonName: 'One', position: 1, translations: [{ lessonName: 'Eins' }] },
      { id: 2, URL: 'zwei', lessonName: 'Two', position: 2, translations: [] }
    ]);

    const lessons = await findLessonsForLang(1, 'de');

    expect(lessons.map((lesson) => lesson.lessonName)).toEqual(['Eins', 'Two']);
  });
});

describe('element and quiz localization', () => {
  it('localizes elements and removes the translations property', async () => {
    mocks.elementFindMany.mockResolvedValue([
      {
        id: 10,
        position: 1,
        title: 'Source title',
        description: 'Source description',
        translations: [{ title: 'Translated title', description: '  ' }]
      }
    ]);

    const elements = await findElementsForLang(3, 'en');

    expect(elements[0]).toMatchObject({
      title: 'Translated title',
      description: 'Source description'
    });
    expect(elements[0]).not.toHaveProperty('translations');
  });

  it('returns null for a missing element', async () => {
    mocks.elementFindUnique.mockResolvedValue(null);

    await expect(findElementForLang(999, 'en')).resolves.toBeNull();
  });

  it('localizes quiz questions while preserving source option indices', async () => {
    mocks.quizFindMany.mockResolvedValue([
      {
        id: 7,
        question: 'Choose a color',
        type: 'm',
        position: 2,
        options: ['Red', 'Blue', 'Green'],
        translations: [{
          question: 'Wähle eine Farbe',
          options: ['Rot', '', 'Grün']
        }]
      }
    ]);

    const questions = await findQuizQuestionsForLang(3, 'de');

    expect(questions).toEqual([{
      id: 7,
      question: 'Wähle eine Farbe',
      type: 'm',
      position: 2,
      options: [
        { index: 0, text: 'Rot' },
        { index: 1, text: 'Blue' },
        { index: 2, text: 'Grün' }
      ]
    }]);
  });
});
