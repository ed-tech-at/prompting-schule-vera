import { describe, expect, it } from 'vitest';
import { answersToSourceOptions, gradeQuestion } from './quizGrading';

describe('answersToSourceOptions', () => {
  it('returns no answers when rawAnswers is not an array', () => {
    expect(answersToSourceOptions(['A', 'B'], null)).toEqual([]);
    expect(answersToSourceOptions(['A', 'B'], '0')).toEqual([]);
  });

  it('converts numeric indices into source option texts', () => {
    expect(answersToSourceOptions(['Rot', 'Grün', 'Blau'], ['0', '2', 1])).toEqual([
      'Rot',
      'Blau',
      'Grün'
    ]);
  });

  it('accepts plain option texts for existing clients', () => {
    expect(answersToSourceOptions(['Rot', 'Grün'], ['Grün', 'Rot'])).toEqual([
      'Grün',
      'Rot'
    ]);
  });

  it('ignores out-of-range indices and unknown plain texts', () => {
    expect(answersToSourceOptions(['A', 'B'], ['3', '-1', 'C', 'abc'])).toEqual([]);
  });

  it('ignores numeric indices outside the option list', () => {
    expect(answersToSourceOptions(['A', 'B'], ['2', '0'])).toEqual(['A']);
  });

  it('filters undefined values from mixed answers', () => {
    expect(answersToSourceOptions(['A', 'B'], ['0', null, 'missing', '1'])).toEqual([
      'A',
      'B'
    ]);
  });
});

describe('gradeQuestion', () => {
  it('awards one point for a correct single-choice answer', () => {
    expect(
      gradeQuestion(
        { id: 11, type: 's', options: ['A', 'B', 'C'], correct: ['B'] },
        ['B']
      )
    ).toEqual({ questionId: 11, userCorrectResponse: [1], points: 1 });
  });

  it('awards no point for an incorrect single-choice answer', () => {
    expect(
      gradeQuestion(
        { id: 12, type: 's', options: ['A', 'B', 'C'], correct: ['B'] },
        ['A']
      )
    ).toEqual({ questionId: 12, userCorrectResponse: [], points: 0 });
  });

  it('awards no point for a missing single-choice answer', () => {
    expect(
      gradeQuestion(
        { id: 13, type: 's', options: ['A', 'B'], correct: ['A'] },
        []
      )
    ).toEqual({ questionId: 13, userCorrectResponse: [], points: 0 });
  });

  it('calculates fractional points for multiple-choice answers', () => {
    expect(
      gradeQuestion(
        { id: 20, type: 'm', options: ['A', 'B', 'C', 'D'], correct: ['A', 'C'] },
        ['A', 'C']
      )
    ).toEqual({ questionId: 20, userCorrectResponse: [0, 2], points: 1 });
  });

  it('penalizes wrong multiple-choice answers', () => {
    expect(
      gradeQuestion(
        { id: 21, type: 'm', options: ['A', 'B', 'C', 'D'], correct: ['A', 'C'] },
        ['A', 'B']
      )
    ).toEqual({ questionId: 21, userCorrectResponse: [0], points: 0.25 });
  });

  it('deduplicates repeated answers for multiple-choice grading', () => {
    expect(
      gradeQuestion(
        { id: 22, type: 'm', options: ['A', 'B', 'C'], correct: ['A', 'B'] },
        ['A', 'A', 'C']
      )
    ).toEqual({ questionId: 22, userCorrectResponse: [0], points: 0.25 });
  });

  it('returns zero points for an entirely wrong multiple-choice answer', () => {
    expect(
      gradeQuestion(
        { id: 23, type: 'm', options: ['A', 'B'], correct: ['A'] },
        ['B']
      )
    ).toEqual({ questionId: 23, userCorrectResponse: [], points: 0 });
  });

  it('returns zero points for an unsupported question type', () => {
    expect(
      gradeQuestion(
        { id: 30, type: 'text', options: ['A'], correct: ['A'] },
        ['A']
      )
    ).toEqual({ questionId: 30, userCorrectResponse: [], points: 0 });
  });
});
