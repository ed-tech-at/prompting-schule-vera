
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the mocks hoisted because Vitest evaluates vi.mock() before imports.
const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  withBase: vi.fn(),

  hasEnoughStars: vi.fn(),
  redactElementPrompts: vi.fn(),
  loadInfoBlocks: vi.fn(),

  findCourseForLang: vi.fn(),
  findElementsForLang: vi.fn(),
  findLessonForLang: vi.fn(),
  findLessonsForLang: vi.fn(),
  findQuizQuestionsForLang: vi.fn(),
  listCoursesForLang: vi.fn(),
  linkableLanguagesOfCourse: vi.fn(),
  slugsForLangs: vi.fn(),

  prisma: {
    badge: {
      findMany: vi.fn()
    },
    userQuizAttempt: {
      findFirst: vi.fn()
    },
    userProgress: {
      aggregate: vi.fn()
    }
  }
}));

vi.mock('$lib/server/db', () => ({
  prisma: mocks.prisma
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/subfolder', () => ({
  withBase: mocks.withBase
}));

vi.mock('$lib/server/lessonStars', () => ({
  hasEnoughStars: mocks.hasEnoughStars
}));

vi.mock('$lib/server/lessonElements', () => ({
  redactElementPrompts: mocks.redactElementPrompts
}));

vi.mock('$lib/server/infoblocks', () => ({
  loadInfoBlocks: mocks.loadInfoBlocks
}));

vi.mock('$lib/server/courseTranslations', () => ({
  findCourseForLang: mocks.findCourseForLang,
  findElementsForLang: mocks.findElementsForLang,
  findLessonForLang: mocks.findLessonForLang,
  findLessonsForLang: mocks.findLessonsForLang,
  findQuizQuestionsForLang: mocks.findQuizQuestionsForLang,
  listCoursesForLang: mocks.listCoursesForLang,
  linkableLanguagesOfCourse: mocks.linkableLanguagesOfCourse,
  slugsForLangs: mocks.slugsForLangs
}));

vi.mock('$lib/server/editor', () => ({
  EDITOR_LEVEL: 10
}));

import {
  COURSE_LANGS,
  COURSE_TEXTS,
  coursePaths,
  type CourseLang
} from '$lib/courseLang';

import {
  loadBadgePage,
  loadCourseList,
  loadCoursePage,
  loadLessonPage,
  loadQuizPage
} from './coursePages';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const LANG = COURSE_LANGS[0]!;
const OTHER_LANG = COURSE_LANGS.find((lang) => lang !== LANG)!;

const user = {
  id: 7,
  email: 'test@example.com',
  isAdmin: 0
} as any;

const course = {
  id: 41,
  URL: `course-${LANG}`,
  publicActive: false
} as any;

const lesson = {
  id: 81,
  URL: `lesson-${LANG}`,
  starsNeeded: 0
} as any;

const cookies = {} as any;

const makeEvent = (
  params: Record<string, string> = {
    kursUrl: course.URL,
    lessonUrl: lesson.URL
  },
  search = '?preview=true'
) => ({
  params,
  cookies,
  url: new URL(`https://example.test/${search}`)
});

const makeSlugs = (target: CourseLang) => ({
  course: `course-${target}`,
  lesson: `lesson-${target}`
});

// Captures SvelteKit's thrown HttpError or Redirect object.
async function captureThrown(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as {
      status: number;
      location?: string;
      body?: unknown;
    };
  }

  throw new Error('Expected the loader to throw');
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  user.id = 7;
  user.email = 'test@example.com';
  user.isAdmin = 0;

  course.id = 41;
  course.URL = `course-${LANG}`;
  course.publicActive = false;

  lesson.id = 81;
  lesson.URL = `lesson-${LANG}`;
  lesson.starsNeeded = 0;

  mocks.requireLogin.mockReturnValue(user);

  mocks.withBase.mockImplementation((path: string) => `/base${path}`);

  mocks.findCourseForLang.mockResolvedValue(course);
  mocks.findLessonForLang.mockResolvedValue(lesson);
  mocks.findLessonsForLang.mockResolvedValue([]);
  mocks.findElementsForLang.mockResolvedValue([]);
  mocks.findQuizQuestionsForLang.mockResolvedValue([]);

  mocks.listCoursesForLang.mockResolvedValue([]);
  mocks.loadInfoBlocks.mockResolvedValue([]);

  mocks.hasEnoughStars.mockResolvedValue(true);
  mocks.redactElementPrompts.mockImplementation((elements) => elements);

  mocks.linkableLanguagesOfCourse.mockResolvedValue([OTHER_LANG]);
  mocks.slugsForLangs.mockResolvedValue(makeSlugs);

  mocks.prisma.badge.findMany.mockResolvedValue([]);
  mocks.prisma.userQuizAttempt.findFirst.mockResolvedValue({
    percentReached: 90
  });
  mocks.prisma.userProgress.aggregate.mockResolvedValue({
    _sum: {
      promptsTried: 10
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// loadCourseList
// -----------------------------------------------------------------------------

describe('loadCourseList', () => {
  it('loads courses, info blocks and language links', async () => {
    const courses = [{ id: 1 }, { id: 2 }];
    const infoBlocks = [{ id: 10 }];

    mocks.listCoursesForLang.mockResolvedValue(courses);
    mocks.loadInfoBlocks.mockResolvedValue(infoBlocks);

    const result = await loadCourseList({ cookies }, LANG);

    expect(mocks.requireLogin).toHaveBeenCalledWith(cookies);

    expect(mocks.listCoursesForLang).toHaveBeenCalledWith(LANG);

    expect(mocks.loadInfoBlocks).toHaveBeenCalledWith({
      placement: 'kursuebersicht',
      lang: LANG,
      email: user.email
    });

    expect(result).toEqual({
      courses,
      user,
      infoBlocks,
      lang: LANG,
      langLinks: Object.fromEntries(
        COURSE_LANGS.map((lang) => [
          lang,
          coursePaths(lang).courses
        ])
      )
    });
  });

  it('does not load courses when login validation fails', async () => {
    mocks.requireLogin.mockImplementation(() => {
      throw new Error('Not authenticated');
    });

    await expect(loadCourseList({ cookies }, LANG)).rejects.toThrow(
      'Not authenticated'
    );

    expect(mocks.listCoursesForLang).not.toHaveBeenCalled();
    expect(mocks.loadInfoBlocks).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// loadCoursePage
// -----------------------------------------------------------------------------

describe('loadCoursePage', () => {
  it('loads an existing course, its lessons and the latest badge per lesson', async () => {
    const lessons = [
      { id: 101 },
      { id: 102 }
    ];

    const newestBadge = {
      id: 1,
      lessonId: 101
    };

    const olderBadge = {
      id: 2,
      lessonId: 101
    };

    const secondLessonBadge = {
      id: 3,
      lessonId: 102
    };

    const badgeWithoutLesson = {
      id: 4,
      lessonId: null
    };

    mocks.findLessonsForLang.mockResolvedValue(lessons);

    mocks.prisma.badge.findMany.mockResolvedValue([
      newestBadge,
      olderBadge,
      secondLessonBadge,
      badgeWithoutLesson
    ]);

    // Admin users are allowed to see additional language links.
    user.isAdmin = 10;

    const result = await loadCoursePage(makeEvent(), LANG);

    expect(mocks.findCourseForLang).toHaveBeenCalledWith(
      course.URL,
      LANG
    );

    expect(mocks.findLessonsForLang).toHaveBeenCalledWith(
      course.id,
      LANG
    );

    expect(mocks.prisma.badge.findMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        lessonId: {
          in: [101, 102]
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    expect(result.latestBadge).toEqual({
      101: newestBadge,
      102: secondLessonBadge
    });

    expect(mocks.linkableLanguagesOfCourse).toHaveBeenCalledWith(
      course.id,
      true
    );

    expect(result.langLinks).toEqual(
      Object.fromEntries(
        COURSE_LANGS.map((lang) => [
          lang,
          coursePaths(lang).course(`course-${lang}`)
        ])
      )
    );

    expect(result.course).toBe(course);
    expect(result.lessons).toBe(lessons);
    expect(result.user).toBe(user);
    expect(result.lang).toBe(LANG);
  });

  it('allows directly accessing a course that is not publicly active', async () => {
    course.publicActive = false;

    const result = await loadCoursePage(makeEvent(), LANG);

    expect(result.course).toBe(course);
    expect(mocks.findLessonsForLang).toHaveBeenCalled();
  });

  it('throws a localized 404 when the course does not exist', async () => {
    mocks.findCourseForLang.mockResolvedValue(null);

    const thrown = await captureThrown(
      loadCoursePage(makeEvent(), LANG)
    );

    expect(thrown.status).toBe(404);

    expect(mocks.findLessonsForLang).not.toHaveBeenCalled();
    expect(mocks.prisma.badge.findMany).not.toHaveBeenCalled();
  });

  it('redirects an outdated course slug to the canonical URL', async () => {
    const search = '?source=old-link';

    const thrown = await captureThrown(
      loadCoursePage(
        makeEvent(
          { kursUrl: 'old-course-slug' },
          search
        ),
        LANG
      )
    );

    expect(thrown).toMatchObject({
      status: 301,
      location:
        `/base${coursePaths(LANG).course(course.URL)}${search}`
    });

    expect(mocks.findLessonsForLang).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// loadLessonPage
// -----------------------------------------------------------------------------

describe('loadLessonPage', () => {
  it('loads a lesson and redacts its element prompts', async () => {
    const elements = [
      { id: 1, prompt: 'secret prompt' },
      { id: 2, prompt: 'another secret prompt' }
    ];

    const redactedElements = [
      { id: 1 },
      { id: 2 }
    ];

    mocks.findElementsForLang.mockResolvedValue(elements);
    mocks.redactElementPrompts.mockReturnValue(redactedElements);

    // No other language is linkable. The current language must still appear.
    mocks.linkableLanguagesOfCourse.mockResolvedValue([]);

    const result = await loadLessonPage(makeEvent(), LANG);

    expect(mocks.findLessonForLang).toHaveBeenCalledWith(
      course.id,
      lesson.URL,
      LANG
    );

    expect(mocks.findElementsForLang).toHaveBeenCalledWith(
      lesson.id,
      LANG
    );

    expect(mocks.redactElementPrompts).toHaveBeenCalledWith(elements);

    expect(result.elements).toBe(redactedElements);
    expect(result.course).toBe(course);
    expect(result.lesson).toBe(lesson);

    expect(result.langLinks).toEqual({
      [LANG]: coursePaths(LANG).lesson(
        course.URL,
        lesson.URL
      )
    });
  });

  it('throws a localized 404 when the lesson does not exist in the course', async () => {
    mocks.findLessonForLang.mockResolvedValue(null);

    const thrown = await captureThrown(
      loadLessonPage(makeEvent(), LANG)
    );

    expect(thrown.status).toBe(404);

    expect(mocks.findElementsForLang).not.toHaveBeenCalled();
    expect(mocks.redactElementPrompts).not.toHaveBeenCalled();
  });

  it('redirects an outdated lesson slug to the canonical lesson URL', async () => {
    const search = '?from=legacy';

    const thrown = await captureThrown(
      loadLessonPage(
        makeEvent(
          {
            kursUrl: course.URL,
            lessonUrl: 'old-lesson-slug'
          },
          search
        ),
        LANG
      )
    );

    expect(thrown).toMatchObject({
      status: 301,
      location:
        `/base${coursePaths(LANG).lesson(
          course.URL,
          lesson.URL
        )}${search}`
    });

    expect(mocks.findElementsForLang).not.toHaveBeenCalled();
  });

  it('passes non-admin status to the language-link lookup', async () => {
    user.isAdmin = 0;

    await loadLessonPage(makeEvent(), LANG);

    expect(mocks.linkableLanguagesOfCourse).toHaveBeenCalledWith(
      course.id,
      false
    );
  });
});

// -----------------------------------------------------------------------------
// loadQuizPage
// -----------------------------------------------------------------------------

describe('loadQuizPage', () => {
  it('redirects to the lesson when the user has insufficient stars', async () => {
    mocks.hasEnoughStars.mockResolvedValue(false);

    const thrown = await captureThrown(
      loadQuizPage(makeEvent(), LANG)
    );

    expect(mocks.hasEnoughStars).toHaveBeenCalledWith(
      user.id,
      lesson
    );

    expect(thrown).toMatchObject({
      status: 302,
      location:
        `/base${coursePaths(LANG).lesson(
          course.URL,
          lesson.URL
        )}`
    });

    expect(mocks.findQuizQuestionsForLang).not.toHaveBeenCalled();
    expect(mocks.linkableLanguagesOfCourse).not.toHaveBeenCalled();
  });

  it('loads quiz questions and shuffles their options', async () => {
    const questions = [
      {
        id: 1,
        options: ['A', 'B', 'C']
      },
      {
        id: 2,
        options: ['D', 'E']
      }
    ];

    mocks.findQuizQuestionsForLang.mockResolvedValue(questions);

    // A deterministic random value makes the shuffle test repeatable.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = await loadQuizPage(makeEvent(), LANG);

    expect(mocks.findQuizQuestionsForLang).toHaveBeenCalledWith(
      lesson.id,
      LANG
    );

    expect(result.quizQuestions).toEqual([
      {
        id: 1,
        options: ['B', 'C', 'A']
      },
      {
        id: 2,
        options: ['E', 'D']
      }
    ]);

    expect(result.langLinks).toEqual(
      Object.fromEntries(
        COURSE_LANGS.map((lang) => [
          lang,
          coursePaths(lang).quiz(
            `course-${lang}`,
            `lesson-${lang}`
          )
        ])
      )
    );

    expect(result.course).toBe(course);
    expect(result.lesson).toBe(lesson);
    expect(result.user).toBe(user);
  });

  it('redirects an outdated lesson slug to the canonical quiz URL', async () => {
    const search = '?question=1';

    const thrown = await captureThrown(
      loadQuizPage(
        makeEvent(
          {
            kursUrl: course.URL,
            lessonUrl: 'old-lesson-slug'
          },
          search
        ),
        LANG
      )
    );

    expect(thrown).toMatchObject({
      status: 301,
      location:
        `/base${coursePaths(LANG).quiz(
          course.URL,
          lesson.URL
        )}${search}`
    });

    expect(mocks.hasEnoughStars).not.toHaveBeenCalled();
    expect(mocks.findQuizQuestionsForLang).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// loadBadgePage
// -----------------------------------------------------------------------------

describe('loadBadgePage', () => {
  it('redirects to the course list when the user has insufficient stars', async () => {
    lesson.starsNeeded = 3;
    mocks.hasEnoughStars.mockResolvedValue(false);

    const thrown = await captureThrown(
      loadBadgePage(makeEvent(), LANG)
    );

    expect(mocks.prisma.userQuizAttempt.findFirst).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        lessonId: lesson.id
      },
      orderBy: {
        percentReached: 'desc'
      }
    });

    expect(mocks.prisma.badge.findMany).toHaveBeenCalledWith({
      where: {
        lessonId: lesson.id,
        userId: user.id
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    expect(mocks.hasEnoughStars).toHaveBeenCalledWith(
      user.id,
      lesson
    );

    expect(thrown).toMatchObject({
      status: 302,
      location: `/base${coursePaths(LANG).courses}`
    });

    expect(mocks.prisma.userProgress.aggregate).not.toHaveBeenCalled();
  });

  it('redirects when the user has not completed a quiz', async () => {
    lesson.starsNeeded = 1;
    mocks.hasEnoughStars.mockResolvedValue(true);
    mocks.prisma.userQuizAttempt.findFirst.mockResolvedValue(null);

    const thrown = await captureThrown(
      loadBadgePage(makeEvent(), LANG)
    );

    expect(thrown).toMatchObject({
      status: 302,
      location: `/base${coursePaths(LANG).courses}`
    });

    expect(mocks.prisma.userProgress.aggregate).not.toHaveBeenCalled();
  });

  it('redirects when the best quiz score is below 75 percent', async () => {
    lesson.starsNeeded = 1;
    mocks.hasEnoughStars.mockResolvedValue(true);

    mocks.prisma.userQuizAttempt.findFirst.mockResolvedValue({
      percentReached: 74
    });

    const thrown = await captureThrown(
      loadBadgePage(makeEvent(), LANG)
    );

    expect(thrown).toMatchObject({
      status: 302,
      location: `/base${coursePaths(LANG).courses}`
    });

    expect(mocks.prisma.userProgress.aggregate).not.toHaveBeenCalled();
  });

  it('redirects when the user has not tried any prompts', async () => {
    // No stars or quiz threshold is required for this lesson.
    lesson.starsNeeded = 0;

    mocks.prisma.userProgress.aggregate.mockResolvedValue({
      _sum: {
        promptsTried: null
      }
    });

    const thrown = await captureThrown(
      loadBadgePage(makeEvent(), LANG)
    );

    expect(thrown).toMatchObject({
      status: 302,
      location: `/base${coursePaths(LANG).courses}`
    });

    expect(mocks.hasEnoughStars).not.toHaveBeenCalled();
    expect(mocks.prisma.userProgress.aggregate).toHaveBeenCalled();
    expect(mocks.linkableLanguagesOfCourse).not.toHaveBeenCalled();
  });

  it('returns badge page data when all requirements are fulfilled', async () => {
    lesson.starsNeeded = 3;

    const bestQuiz = {
      percentReached: 75
    };

    const badges = [
      { id: 1, lessonId: lesson.id },
      { id: 2, lessonId: lesson.id }
    ];

    mocks.hasEnoughStars.mockResolvedValue(true);

    mocks.prisma.userQuizAttempt.findFirst.mockResolvedValue(bestQuiz);
    mocks.prisma.badge.findMany.mockResolvedValue(badges);

    mocks.prisma.userProgress.aggregate.mockResolvedValue({
      _sum: {
        promptsTried: 12
      }
    });

    const result = await loadBadgePage(makeEvent(), LANG);

    expect(mocks.hasEnoughStars).toHaveBeenCalledWith(
      user.id,
      lesson
    );

    expect(mocks.prisma.userProgress.aggregate).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        lessonId: lesson.id
      },
      _sum: {
        promptsTried: true
      }
    });

    expect(result).toEqual({
      course,
      lesson,
      bestQuiz,
      badges,
      user,
      maxPrompts: 12,
      lang: LANG,
      langLinks: Object.fromEntries(
        COURSE_LANGS.map((lang) => [
          lang,
          coursePaths(lang).badge(
            `course-${lang}`,
            `lesson-${lang}`
          )
        ])
      )
    });
  });

  it('does not require stars or a passing quiz when starsNeeded is zero', async () => {
    lesson.starsNeeded = 0;

    mocks.prisma.userQuizAttempt.findFirst.mockResolvedValue(null);

    mocks.prisma.userProgress.aggregate.mockResolvedValue({
      _sum: {
        promptsTried: 5
      }
    });

    const result = await loadBadgePage(makeEvent(), LANG);

    expect(mocks.hasEnoughStars).not.toHaveBeenCalled();

    expect(result.maxPrompts).toBe(5);
    expect(result.bestQuiz).toBeNull();
  });

  it('redirects an outdated lesson slug to the canonical badge URL', async () => {
    const search = '?source=old-badge-link';

    const thrown = await captureThrown(
      loadBadgePage(
        makeEvent(
          {
            kursUrl: course.URL,
            lessonUrl: 'old-lesson-slug'
          },
          search
        ),
        LANG
      )
    );

    expect(thrown).toMatchObject({
      status: 301,
      location:
        `/base${coursePaths(LANG).badge(
          course.URL,
          lesson.URL
        )}${search}`
    });

    expect(mocks.prisma.userQuizAttempt.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.badge.findMany).not.toHaveBeenCalled();
  });
});
