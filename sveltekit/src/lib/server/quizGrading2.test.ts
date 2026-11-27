import { describe, expect, it } from 'vitest';
import { answersToSourceOptions, gradeQuestion } from './quizGrading';

describe('answersToSourceOptions', () => {
  const options = ['Apple', 'Banana', 'Orange', 'Grape'];

  describe('input validation', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'Apple'],
      ['a number', 123],
      ['an object', { answer: 'Apple' }]
    ])('returns an empty array when rawAnswers is %s', (_, rawAnswers) => {
      expect(answersToSourceOptions(options, rawAnswers)).toEqual([]);
    });
  });

  describe('index-based answers', () => {
    it('converts numeric string indices into source option values', () => {
      expect(
        answersToSourceOptions(options, ['0', '2'])
      ).toEqual(['Apple', 'Orange']);
    });

    it('converts numeric indices into source option values', () => {
      expect(
        answersToSourceOptions(options, [1, 3])
      ).toEqual(['Banana', 'Grape']);
    });

    it('supports indices with leading zeros', () => {
      expect(
        answersToSourceOptions(options, ['01', '002'])
      ).toEqual(['Banana', 'Orange']);
    });

    it('ignores indices outside the options array', () => {
      expect(
        answersToSourceOptions(options, ['4', '99'])
      ).toEqual([]);
    });
  });

  describe('legacy text-based answers', () => {
    it('accepts option texts that exist in the source options', () => {
      expect(
        answersToSourceOptions(options, ['Apple', 'Orange'])
      ).toEqual(['Apple', 'Orange']);
    });

    it('ignores option texts that do not exist in the source options', () => {
      expect(
        answersToSourceOptions(options, ['Apple', 'Pineapple'])
      ).toEqual(['Apple']);
    });

    it('matches option texts exactly', () => {
      expect(
        answersToSourceOptions(options, ['apple', ' Apple ', 'Apple'])
      ).toEqual(['Apple']);
    });
  });

  describe('mixed answers', () => {
    it('supports a mixture of indices and option texts', () => {
      expect(
        answersToSourceOptions(options, ['0', 'Banana', '3'])
      ).toEqual(['Apple', 'Banana', 'Grape']);
    });

    it('preserves the original answer order', () => {
      expect(
        answersToSourceOptions(options, ['3', '0', '2'])
      ).toEqual(['Grape', 'Apple', 'Orange']);
    });

    it('preserves duplicate answers', () => {
      expect(
        answersToSourceOptions(options, ['0', '0', 'Apple'])
      ).toEqual(['Apple', 'Apple', 'Apple']);
    });

    it('filters invalid answers without removing valid answers', () => {
      expect(
        answersToSourceOptions(options, [
          '0',
          'invalid',
          '99',
          'Banana',
          '-1'
        ])
      ).toEqual(['Apple', 'Banana']);
    });
  });
});

describe('gradeQuestion', () => {
  const createQuestion = (
    overrides: Partial<{
      id: number;
      type: string;
      options: string[];
      correct: string[];
    }> = {}
  ) => ({
    id: 42,
    type: 's',
    options: ['Apple', 'Banana', 'Orange', 'Grape'],
    correct: ['Banana'],
    ...overrides
  });

  describe('single-choice questions', () => {
    it('awards one point when the answer is correct', () => {
      const question = createQuestion();

      expect(gradeQuestion(question, ['Banana'])).toEqual({
        questionId: 42,
        userCorrectResponse: [1],
        points: 1
      });
    });

    it('awards zero points when the answer is incorrect', () => {
      const question = createQuestion();

      expect(gradeQuestion(question, ['Apple'])).toEqual({
        questionId: 42,
        userCorrectResponse: [],
        points: 0
      });
    });

    it('awards zero points when no answer is provided', () => {
      const question = createQuestion();

      expect(gradeQuestion(question, [])).toEqual({
        questionId: 42,
        userCorrectResponse: [],
        points: 0
      });
    });

    it('only considers the first submitted answer', () => {
      const question = createQuestion();

      expect(
        gradeQuestion(question, ['Banana', 'Apple'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [1],
        points: 1
      });
    });

    it('does not accept a correct answer submitted after an incorrect first answer', () => {
      const question = createQuestion();

      expect(
        gradeQuestion(question, ['Apple', 'Banana'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [],
        points: 0
      });
    });

    it('returns the correct source option index', () => {
      const question = createQuestion({
        options: ['First', 'Second', 'Third'],
        correct: ['Third']
      });

      expect(gradeQuestion(question, ['Third'])).toEqual({
        questionId: 42,
        userCorrectResponse: [2],
        points: 1
      });
    });
  });

  describe('multiple-choice questions', () => {
    const multipleChoiceQuestion = createQuestion({
      type: 'm',
      options: ['Apple', 'Banana', 'Orange', 'Grape'],
      correct: ['Apple', 'Orange']
    });

    it('awards one point when all correct answers are selected', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, ['Apple', 'Orange'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [0, 2],
        points: 1
      });
    });

    it('awards partial points when only some correct answers are selected', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, ['Apple'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [0],
        points: 0.5
      });
    });

    it('awards zero points when all submitted answers are incorrect', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, ['Banana', 'Grape'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [],
        points: 0
      });
    });

    it('penalizes incorrect answers', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, ['Apple', 'Banana'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [0],
        points: 0.25
      });
    });

    it('does not penalize duplicate answers', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, [
          'Apple',
          'Apple',
          'Banana',
          'Banana'
        ])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [0],
        points: 0.25
      });
    });

    it('does not duplicate correctly selected answers in the response', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, [
          'Apple',
          'Apple',
          'Orange',
          'Orange'
        ])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [0, 2],
        points: 1
      });
    });

    it('preserves the order in which correct answers were submitted', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, ['Orange', 'Apple'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [2, 0],
        points: 1
      });
    });

    it('rounds the calculated score to two decimal places', () => {
      const question = createQuestion({
        type: 'm',
        correct: ['Apple', 'Banana', 'Orange']
      });

      expect(
        gradeQuestion(question, ['Apple'])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [0],
        points: 0.33
      });
    });

    it('returns zero points when no answers are submitted and correct answers exist', () => {
      expect(
        gradeQuestion(multipleChoiceQuestion, [])
      ).toEqual({
        questionId: 42,
        userCorrectResponse: [],
        points: 0
      });
    });
  });

  describe('unsupported question types', () => {
    it('returns zero points for an unknown question type', () => {
      const question = createQuestion({
        type: 'unknown'
      });

      expect(gradeQuestion(question, ['Banana'])).toEqual({
        questionId: 42,
        userCorrectResponse: [],
        points: 0
      });
    });
  });

  describe('question metadata', () => {
    it('preserves the question ID in the grading result', () => {
      const question = createQuestion({
        id: 123
      });

      expect(gradeQuestion(question, ['Banana']).questionId).toBe(123);
    });
  });
});