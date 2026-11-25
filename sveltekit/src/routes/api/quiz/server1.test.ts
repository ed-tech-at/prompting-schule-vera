import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  findQuizQuestions: vi.fn(),
  createAttempt: vi.fn(),
  findAttempt: vi.fn(),
  aggregateProgress: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    quizQuestion: {
      findMany: mocks.findQuizQuestions
    },
    userQuizAttempt: {
      create: mocks.createAttempt,
      findFirst: mocks.findAttempt
    },
    userProgress: {
      aggregate: mocks.aggregateProgress
    }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

import { POST } from './+server';

const cookies = {} as Cookies;

function requestBody(body: unknown) {
  return {
    request: {
      json: vi.fn().mockResolvedValue(body)
    },
    cookies
  } as Parameters<typeof POST>[0];
}

async function post(body: unknown): Promise<Response> {
  const response = await POST(requestBody(body));
  if (!response) throw new Error('POST returned no response');
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireLogin.mockReturnValue({ id: 'user-1' });
});

describe('POST submitQuiz', () => {
  it('grades source options, saves the attempt, and returns the score', async () => {
    mocks.findQuizQuestions.mockResolvedValue([
      { id: 1, type: 's', options: ['Paris', 'Berlin'], correct: ['Berlin'] },
      { id: 2, type: 'm', options: ['Rot', 'Grün', 'Blau'], correct: ['Rot', 'Blau'] }
    ]);
    mocks.createAttempt.mockResolvedValue({ id: 'attempt-1' });

    const innerAnswerData = {
      courseId: 'course-1',
      lessonId: 'lesson-1',
      userId: 'user-1',
      answers: JSON.stringify({ '1': ['1'], '2': ['0', '2'] })
    };

    const response = await post({
      action: 'submitQuiz',
      answerData: JSON.stringify({ answerData: innerAnswerData })
    });

    expect(mocks.findQuizQuestions).toHaveBeenCalledWith({
      where: { lessonId: 'lesson-1' }
    });
    expect(mocks.createAttempt).toHaveBeenCalledWith({
      data: {
        user: { connect: { id: 'user-1' } },
        lesson: { connect: { id: 'lesson-1' } },
        course: { connect: { id: 'course-1' } },
        answers: JSON.stringify({ '1': ['Berlin'], '2': ['Rot', 'Blau'] }),
        percentReached: 100
      }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      results: [
        { questionId: 1, userCorrectResponse: [1], points: 1 },
        { questionId: 2, userCorrectResponse: [0, 2], points: 1 }
      ],
      totalPoints: 2,
      maxPoints: 2,
      percent: 100
    });
  });

  it('rejects a submission for another authenticated user', async () => {
    mocks.findQuizQuestions.mockResolvedValue([
      { id: 1, type: 's', options: ['Ja', 'Nein'], correct: ['Ja'] }
    ]);

    const innerAnswerData = {
      courseId: 'course-1',
      lessonId: 'lesson-1',
      userId: 'user-2',
      answers: JSON.stringify({ '1': ['0'] })
    };

    const response = await post({
      action: 'submitQuiz',
      answerData: JSON.stringify({ answerData: innerAnswerData })
    });

    expect(mocks.createAttempt).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'User ID passen nicht zusammen.'
    });
  });
});

describe('POST getQuizResults', () => {
  it('returns the highest stored percentage for the lesson', async () => {
    mocks.findAttempt.mockResolvedValue({ percentReached: 75 });

    const response = await post({
      action: 'getQuizResults',
      answerData: { userId: 'user-1', lessonId: 'lesson-1' }
    });

    expect(mocks.findAttempt).toHaveBeenCalledWith({
      where: { userId: 'user-1', lessonId: 'lesson-1' },
      orderBy: { percentReached: 'desc' }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      percentReached: 75
    });
  });

  it('reports when no attempt exists', async () => {
    mocks.findAttempt.mockResolvedValue(null);

    const response = await post({
      action: 'getQuizResults',
      answerData: { userId: 'user-1', lessonId: 'lesson-1' }
    });

    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'No quiz results found.'
    });
  });

  it('rejects another authenticated user', async () => {
    const response = await post({
      action: 'getQuizResults',
      answerData: { userId: 'user-2', lessonId: 'lesson-1' }
    });

    expect(mocks.findAttempt).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'User ID passen nicht zusammen.'
    });
  });
});

describe('POST getPromptsTried', () => {
  it('returns the aggregate prompt count', async () => {
    mocks.aggregateProgress.mockResolvedValue({
      _count: { promptsTried: 4 }
    });

    const response = await post({
      action: 'getPromptsTried',
      answerData: { userId: 'user-1', lessonId: 'lesson-1' }
    });

    expect(mocks.aggregateProgress).toHaveBeenCalledWith({
      where: { userId: 'user-1', lessonId: 'lesson-1' },
      _count: { promptsTried: true }
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      promptsTried: 4
    });
  });

  it('rejects another authenticated user', async () => {
    const response = await post({
      action: 'getPromptsTried',
      answerData: { userId: 'user-2', lessonId: 'lesson-1' }
    });

    expect(mocks.aggregateProgress).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'User ID passen nicht zusammen.'
    });
  });
});
