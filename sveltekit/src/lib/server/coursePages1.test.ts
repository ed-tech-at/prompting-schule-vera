import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  findCourseForLang: vi.fn(),
  findElementsForLang: vi.fn(),
  findLessonForLang: vi.fn(),
  findLessonsForLang: vi.fn(),
  findQuizQuestionsForLang: vi.fn(),
  listCoursesForLang: vi.fn(),
  linkableLanguagesOfCourse: vi.fn(),
  slugsForLangs: vi.fn(),
  loadInfoBlocks: vi.fn(),
  hasEnoughStars: vi.fn(),
  redactElementPrompts: vi.fn(),
  badgeFindMany: vi.fn(),
  quizAttemptFindFirst: vi.fn(),
  progressAggregate: vi.fn()
}));

vi.mock('$lib/server/jwt', () => ({ requireLogin: mocks.requireLogin }));
vi.mock('$lib/server/subfolder', () => ({ withBase: (path: string) => path }));
vi.mock('$lib/server/lessonStars', () => ({ hasEnoughStars: mocks.hasEnoughStars }));
vi.mock('$lib/server/lessonElements', () => ({ redactElementPrompts: mocks.redactElementPrompts }));
vi.mock('$lib/server/infoblocks', () => ({ loadInfoBlocks: mocks.loadInfoBlocks }));
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
vi.mock('$lib/server/db', () => ({
  prisma: {
    badge: { findMany: mocks.badgeFindMany },
    userQuizAttempt: { findFirst: mocks.quizAttemptFindFirst },
    userProgress: { aggregate: mocks.progressAggregate }
  }
}));

import {
  loadCourseList,
  loadCoursePage,
  loadLessonPage,
  loadQuizPage,
  loadBadgePage
} from './coursePages';

const user = { id: 'learner-1', email: 'learner@example.test', isAdmin: 0 };
const course = { id: 1, URL: 'prompt-course', name: 'Prompt Course' };
const lesson = { id: 10, URL: 'first-lesson', courseId: 1, starsNeeded: 2 };

const event = (params: Record<string, string>) =>
  ({
    params,
    cookies: {} as Cookies,
    url: new URL('http://localhost/current-page?tab=1')
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireLogin.mockReturnValue(user);
  mocks.findCourseForLang.mockResolvedValue(course);
  mocks.findLessonForLang.mockResolvedValue(lesson);
  mocks.findLessonsForLang.mockResolvedValue([lesson]);
  mocks.findElementsForLang.mockResolvedValue([]);
  mocks.findQuizQuestionsForLang.mockResolvedValue([]);
  mocks.listCoursesForLang.mockResolvedValue([]);
  mocks.loadInfoBlocks.mockResolvedValue([]);
  mocks.linkableLanguagesOfCourse.mockResolvedValue(['de']);
  mocks.slugsForLangs.mockResolvedValue((lang: string) =>
    lang === 'en'
      ? { course: 'prompt-course-en', lesson: 'first-lesson-en' }
      : { course: 'prompt-course', lesson: 'first-lesson' }
  );
  mocks.hasEnoughStars.mockResolvedValue(true);
  mocks.redactElementPrompts.mockImplementation((elements: unknown) => elements);
  mocks.badgeFindMany.mockResolvedValue([]);
  mocks.quizAttemptFindFirst.mockResolvedValue({ percentReached: 90 });
  mocks.progressAggregate.mockResolvedValue({ _sum: { promptsTried: 4 } });
});

describe('loadCourseList', () => {
  it('loads courses and info blocks with the logged-in user', async () => {
    const courses = [{ id: 1, name: 'Kurs' }];
    mocks.listCoursesForLang.mockResolvedValue(courses);
    mocks.loadInfoBlocks.mockResolvedValue([{ id: 5 }]);

    const data = await loadCourseList({ cookies: {} as Cookies }, 'de');

    expect(data).toEqual(expect.objectContaining({
      courses,
      user,
      lang: 'de',
      infoBlocks: [{ id: 5 }],
      langLinks: { de: '/kurse', en: '/en/courses' }
    }));
    expect(mocks.loadInfoBlocks).toHaveBeenCalledWith({
      placement: 'kursuebersicht',
      lang: 'de',
      email: user.email
    });
  });
});

describe('loadCoursePage', () => {
  it('returns lessons and keeps only the latest badge per lesson', async () => {
    const lessons = [{ id: 10 }, { id: 11 }];
    const oldBadge = { id: 'old', lessonId: 10, createdAt: new Date('2024-01-01') };
    const latestBadge = { id: 'new', lessonId: 10, createdAt: new Date('2025-01-01') };
    mocks.findLessonsForLang.mockResolvedValue(lessons);
    mocks.badgeFindMany.mockResolvedValue([latestBadge, oldBadge]);

    const data = await loadCoursePage(event({ kursUrl: 'prompt-course' }), 'de');

    expect(data.latestBadge).toEqual({ 10: latestBadge });
    expect(mocks.badgeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: user.id, lessonId: { in: [10, 11] } }
    }));
  });

  it('throws 404 when the course does not exist', async () => {
    mocks.findCourseForLang.mockResolvedValue(null);

    await expect(loadCoursePage(event({ kursUrl: 'missing' }), 'de'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('redirects an old course slug to the canonical URL', async () => {
    await expect(loadCoursePage(event({ kursUrl: 'old-course' }), 'de'))
      .rejects.toMatchObject({ status: 301, location: '/kurs/prompt-course?tab=1' });
  });
});

describe('loadLessonPage', () => {
  it('redacts prompts and returns lesson elements', async () => {
    const elements = [{ id: 100, devPromptA: 'secret' }];
    mocks.findElementsForLang.mockResolvedValue(elements);
    mocks.redactElementPrompts.mockReturnValue([{ id: 100, devPromptA: null }]);

    const data = await loadLessonPage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de');

    expect(mocks.redactElementPrompts).toHaveBeenCalledWith(elements);
    expect(data.elements).toEqual([{ id: 100, devPromptA: null }]);
  });

  it('throws 404 when the lesson is outside the resolved course', async () => {
    mocks.findLessonForLang.mockResolvedValue(null);

    await expect(loadLessonPage(event({ kursUrl: 'prompt-course', lessonUrl: 'missing' }), 'de'))
      .rejects.toMatchObject({ status: 404 });
    expect(mocks.findElementsForLang).not.toHaveBeenCalled();
  });

  it('redirects old lesson slugs with the query string preserved', async () => {
    await expect(loadLessonPage(event({ kursUrl: 'prompt-course', lessonUrl: 'old-lesson' }), 'de'))
      .rejects.toMatchObject({ status: 301, location: '/kurs/prompt-course/first-lesson?tab=1' });
  });
});

describe('loadQuizPage', () => {
  it('redirects to the lesson when stars are insufficient', async () => {
    mocks.hasEnoughStars.mockResolvedValue(false);

    await expect(loadQuizPage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de'))
      .rejects.toMatchObject({ status: 302, location: '/kurs/prompt-course/first-lesson' });
    expect(mocks.findQuizQuestionsForLang).not.toHaveBeenCalled();
  });

  it('returns shuffled quiz options and language links', async () => {
    const questions = [{ id: 1, options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }];
    mocks.findQuizQuestionsForLang.mockResolvedValue(questions);
    mocks.linkableLanguagesOfCourse.mockResolvedValue(['de', 'en']);

    const data = await loadQuizPage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de');

    expect(data.quizQuestions).toHaveLength(1);
    expect(data.quizQuestions[0].options).toHaveLength(3);
    expect(data.langLinks).toEqual({
      de: '/kurs/prompt-course/first-lesson/quiz',
      en: '/en/course/prompt-course-en/first-lesson-en/quiz'
    });
  });
});

describe('loadBadgePage', () => {
  it('returns badge data when all badge requirements are met', async () => {
    mocks.badgeFindMany.mockResolvedValue([{ id: 'badge-1', lessonId: 10 }]);

    const data = await loadBadgePage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de');

    expect(data).toEqual(expect.objectContaining({
      bestQuiz: { percentReached: 90 },
      badges: [{ id: 'badge-1', lessonId: 10 }],
      maxPrompts: 4
    }));
  });

  it('redirects to courses when stars are insufficient', async () => {
    mocks.hasEnoughStars.mockResolvedValue(false);

    await expect(loadBadgePage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de'))
      .rejects.toMatchObject({ status: 302, location: '/kurse' });
  });

  it('redirects to courses when the best quiz is below 75 percent', async () => {
    mocks.quizAttemptFindFirst.mockResolvedValue({ percentReached: 74 });

    await expect(loadBadgePage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de'))
      .rejects.toMatchObject({ status: 302, location: '/kurse' });
  });

  it('redirects to courses when no prompts were tried', async () => {
    mocks.progressAggregate.mockResolvedValue({ _sum: { promptsTried: 0 } });

    await expect(loadBadgePage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de'))
      .rejects.toMatchObject({ status: 302, location: '/kurse' });
  });

  it('does not enforce stars or quiz score for a lesson with starsNeeded zero', async () => {
    mocks.findLessonForLang.mockResolvedValue({ ...lesson, starsNeeded: 0 });
    mocks.progressAggregate.mockResolvedValue({ _sum: { promptsTried: 2 } });

    await expect(loadBadgePage(event({ kursUrl: 'prompt-course', lessonUrl: 'first-lesson' }), 'de'))
      .resolves.toEqual(expect.objectContaining({ maxPrompts: 2 }));
    expect(mocks.hasEnoughStars).not.toHaveBeenCalled();
  });
});
