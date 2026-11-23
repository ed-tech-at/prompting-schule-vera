
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

// Define mocks before vi.mock because Vitest hoists module mocks.
const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),

  findMany: vi.fn(),
  createAttempt: vi.fn(),
  findFirst: vi.fn(),
  aggregate: vi.fn(),

  answersToSourceOptions: vi.fn(),
  gradeQuestion: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    quizQuestion: {
      findMany: mocks.findMany
    },
    userQuizAttempt: {
      create: mocks.createAttempt,
      findFirst: mocks.findFirst
    },
    userProgress: {
      aggregate: mocks.aggregate
    }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/quizGrading', () => ({
  answersToSourceOptions: mocks.answersToSourceOptions,
  gradeQuestion: mocks.gradeQuestion
}));

// Helper to invoke the endpoint with a real Request object.
async function callPost(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/quizz', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return POST({
    request,
    cookies: {}
  } as Parameters<typeof POST>[0]);
}

// The submitQuiz action expects answerData to be a JSON string
// containing another answerData object. Its answers property
// must also be a JSON string.
function createSubmitBody(
  overrides: Record<string, unknown> = {}
) {
  const answerData = {
    userId: 'user-1',
    lessonId: 'lesson-1',
    courseId: 'course-1',
    answers: JSON.stringify({
      'q-1': ['A'],
      'q-2': ['B'],
      'q-3': ['C']
    }),
    ...overrides
  };

  return {
    action: 'submitQuiz',
    answerData: JSON.stringify({
      answerData
    })
  };
}

describe('POST /api/quizz', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default authenticated user.
    mocks.requireLogin.mockReturnValue({
      id: 'user-1'
    });
  });

  // -------------------------------------------------------
  // submitQuiz
  // -------------------------------------------------------

  describe('submitQuiz', () => {
    it('should grade questions, save the quiz attempt and return the score', async () => {
      const questions = [
        { id: 'q-1', options: ['A', 'B', 'C'] },
        { id: 'q-2', options: ['A', 'B', 'C'] },
        { id: 'q-3', options: ['A', 'B', 'C'] }
      ];

      const gradedResults = [
        { questionId: 'q-1', points: 1 },
        { questionId: 'q-2', points: 0.01 },
        { questionId: 'q-3', points: 0 }
      ];

      mocks.findMany.mockResolvedValue(questions);

      mocks.answersToSourceOptions
        .mockReturnValueOnce(['source-A'])
        .mockReturnValueOnce(['source-B'])
        .mockReturnValueOnce(['source-C']);

      mocks.gradeQuestion
        .mockReturnValueOnce(gradedResults[0])
        .mockReturnValueOnce(gradedResults[1])
        .mockReturnValueOnce(gradedResults[2]);

      mocks.createAttempt.mockResolvedValue({
        id: 'attempt-1'
      });

      const response = await callPost(createSubmitBody());
      const data = await response.json();

      // HTTP response
      expect(response.status).toBe(200);

      // The questions should be loaded for the requested lesson.
      expect(mocks.findMany).toHaveBeenCalledWith({
        where: {
          lessonId: 'lesson-1'
        }
      });

      // Answers should be converted into source options.
      expect(mocks.answersToSourceOptions).toHaveBeenNthCalledWith(
        1,
        questions[0].options,
        ['A']
      );

      expect(mocks.answersToSourceOptions).toHaveBeenNthCalledWith(
        2,
        questions[1].options,
        ['B']
      );

      expect(mocks.answersToSourceOptions).toHaveBeenNthCalledWith(
        3,
        questions[2].options,
        ['C']
      );

      // Each question should be graded.
      expect(mocks.gradeQuestion).toHaveBeenCalledTimes(3);

      // The quiz attempt should be persisted.
      expect(mocks.createAttempt).toHaveBeenCalledWith({
        data: {
          user: {
            connect: {
              id: 'user-1'
            }
          },
          lesson: {
            connect: {
              id: 'lesson-1'
            }
          },
          course: {
            connect: {
              id: 'course-1'
            }
          },
          answers: JSON.stringify({
            'q-1': ['source-A'],
            'q-2': ['source-B'],
            'q-3': ['source-C']
          }),
          percentReached: 34
        }
      });

      // 1.01 / 3 * 100 = 33.67, rounded up to 34.
      expect(data).toEqual({
        success: true,
        results: gradedResults,
        totalPoints: 1.01,
        maxPoints: 3,
        percent: 34
      });
    });

    it('should reject quiz submission when user IDs do not match', async () => {
      mocks.findMany.mockResolvedValue([]);

      const response = await callPost(
        createSubmitBody({
          userId: 'another-user'
        })
      );

      const data = await response.json();

      expect(response.status).toBe(200);

      expect(data).toEqual({
        success: false,
        message: 'User ID passen nicht zusammen.'
      });

      // An unauthorized attempt must not be persisted.
      expect(mocks.createAttempt).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // getQuizResults
  // -------------------------------------------------------

  describe('getQuizResults', () => {
    it('should return the best quiz result for a user and lesson', async () => {
      mocks.findFirst.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        lessonId: 'lesson-1',
        percentReached: 85
      });

      const response = await callPost({
        action: 'getQuizResults',
        answerData: {
          userId: 'user-1',
          lessonId: 'lesson-1'
        }
      });

      const data = await response.json();

      expect(response.status).toBe(200);

      expect(mocks.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          lessonId: 'lesson-1'
        },
        orderBy: {
          percentReached: 'desc'
        }
      });

      expect(data).toEqual({
        success: true,
        percentReached: 85
      });
    });

    it('should return an error when no quiz results exist', async () => {
      mocks.findFirst.mockResolvedValue(null);

      const response = await callPost({
        action: 'getQuizResults',
        answerData: {
          userId: 'user-1',
          lessonId: 'lesson-1'
        }
      });

      const data = await response.json();

      expect(data).toEqual({
        success: false,
        message: 'No quiz results found.'
      });

      expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should reject requests when user IDs do not match', async () => {
      const response = await callPost({
        action: 'getQuizResults',
        answerData: {
          userId: 'another-user',
          lessonId: 'lesson-1'
        }
      });

      const data = await response.json();

      expect(data).toEqual({
        success: false,
        message: 'User ID passen nicht zusammen.'
      });

      // No database query should be made for another user.
      expect(mocks.findFirst).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // getPromptsTried
  // -------------------------------------------------------

  describe('getPromptsTried', () => {
    it('should return the number of prompts tried by a user', async () => {
      mocks.aggregate.mockResolvedValue({
        _count: {
          promptsTried: 7
        }
      });

      const response = await callPost({
        action: 'getPromptsTried',
        answerData: {
          userId: 'user-1',
          lessonId: 'lesson-1'
        }
      });

      const data = await response.json();

      expect(response.status).toBe(200);

      expect(mocks.aggregate).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          lessonId: 'lesson-1'
        },
        _count: {
          promptsTried: true
        }
      });

      expect(data).toEqual({
        success: true,
        promptsTried: 7
      });
    });

    it('should reject requests when user IDs do not match', async () => {
      const response = await callPost({
        action: 'getPromptsTried',
        answerData: {
          userId: 'another-user',
          lessonId: 'lesson-1'
        }
      });

      const data = await response.json();

      expect(data).toEqual({
        success: false,
        message: 'User ID passen nicht zusammen.'
      });

      expect(mocks.aggregate).not.toHaveBeenCalled();
    });
  });
});
