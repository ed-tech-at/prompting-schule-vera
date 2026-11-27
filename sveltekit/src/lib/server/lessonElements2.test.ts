
import { describe, expect, it } from 'vitest';
import { redactElementPrompts } from './lessonElements';

type LessonElementFixture = {
  id: string;
  type: string;
  devPromptA: string | null;
  devPromptB: string | null;
  devPromptC: string | null;
  content: string;
};

const createElement = (
  overrides: Partial<LessonElementFixture> = {}
): LessonElementFixture => ({
  id: 'element-1',
  type: 'text',
  devPromptA: 'System prompt A',
  devPromptB: 'System prompt B',
  devPromptC: 'System prompt C',
  content: 'Example lesson content',
  ...overrides
});

describe('redactElementPrompts', () => {
  describe('devPromptA redaction', () => {
    it('always removes devPromptA', () => {
      const elements = [
        createElement({ type: 'ai1' }),
        createElement({ type: 'ai2' }),
        createElement({ type: 'text' })
      ];

      const result = redactElementPrompts(elements);

      expect(result.every((element) => element.devPromptA === null)).toBe(true);
    });
  });

  describe('devPromptB redaction', () => {
    it.each(['ai1', 'ai2', 'ai2only'])(
      'preserves devPromptB for element type "%s"',
      (type) => {
        const elements = [
          createElement({
            type,
            devPromptB: 'Visible client prompt'
          })
        ];

        const result = redactElementPrompts(elements);

        expect(result[0].devPromptB).toBe('Visible client prompt');
      }
    );

    it.each(['text', 'video', 'ai3', 'AI1'])(
      'removes devPromptB for element type "%s"',
      (type) => {
        const elements = [
          createElement({
            type,
            devPromptB: 'Sensitive prompt'
          })
        ];

        const result = redactElementPrompts(elements);

        expect(result[0].devPromptB).toBeNull();
      }
    );

    it('preserves null devPromptB for an allowed element type', () => {
      const elements = [
        createElement({
          type: 'ai1',
          devPromptB: null
        })
      ];

      const result = redactElementPrompts(elements);

      expect(result[0].devPromptB).toBeNull();
    });
  });

  describe('devPromptC redaction', () => {
    it('always removes devPromptC', () => {
      const elements = [
        createElement({ type: 'ai1' }),
        createElement({ type: 'ai2' }),
        createElement({ type: 'ai2only' }),
        createElement({ type: 'text' })
      ];

      const result = redactElementPrompts(elements);

      expect(result.every((element) => element.devPromptC === null)).toBe(true);
    });
  });

  describe('element preservation', () => {
    it('preserves all properties unrelated to prompts', () => {
      const elements = [
        createElement({
          id: 'element-42',
          type: 'ai1',
          content: 'My lesson content'
        })
      ];

      const result = redactElementPrompts(elements);

      expect(result[0]).toMatchObject({
        id: 'element-42',
        type: 'ai1',
        content: 'My lesson content'
      });
    });

    it('preserves the original element order', () => {
      const elements = [
        createElement({ id: 'first', type: 'ai1' }),
        createElement({ id: 'second', type: 'text' }),
        createElement({ id: 'third', type: 'ai2' })
      ];

      const result = redactElementPrompts(elements);

      expect(result.map((element) => element.id)).toEqual([
        'first',
        'second',
        'third'
      ]);
    });

    it('does not mutate the original elements', () => {
      const elements = [
        createElement({
          type: 'ai1',
          devPromptA: 'Original A',
          devPromptB: 'Original B',
          devPromptC: 'Original C'
        })
      ];

      const result = redactElementPrompts(elements);

      expect(elements[0]).toEqual({
        id: 'element-1',
        type: 'ai1',
        devPromptA: 'Original A',
        devPromptB: 'Original B',
        devPromptC: 'Original C',
        content: 'Example lesson content'
      });

      expect(result[0]).not.toBe(elements[0]);
    });

    it('returns a new array', () => {
      const elements = [createElement()];

      const result = redactElementPrompts(elements);

      expect(result).not.toBe(elements);
    });
  });

  describe('edge cases', () => {
    it('returns an empty array when given an empty array', () => {
      const result = redactElementPrompts([]);

      expect(result).toEqual([]);
    });

    it('redacts prompts correctly when processing mixed element types', () => {
      const elements = [
        createElement({ type: 'ai1', devPromptB: 'Prompt for ai1' }),
        createElement({ type: 'text', devPromptB: 'Hidden text prompt' }),
        createElement({ type: 'ai2', devPromptB: 'Prompt for ai2' }),
        createElement({ type: 'ai2only', devPromptB: 'Prompt for ai2only' }),
        createElement({ type: 'video', devPromptB: 'Hidden video prompt' })
      ];

      const result = redactElementPrompts(elements);

      expect(result.map((element) => element.devPromptB)).toEqual([
        'Prompt for ai1',
        null,
        'Prompt for ai2',
        'Prompt for ai2only',
        null
      ]);

      expect(
        result.every(
          (element) =>
            element.devPromptA === null && element.devPromptC === null
        )
      ).toBe(true);
    });
  });
});
