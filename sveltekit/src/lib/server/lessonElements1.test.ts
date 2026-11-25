import { describe, expect, it } from 'vitest';

import { redactElementPrompts } from './lessonElements';

type TestElement = {
  id: number;
  type: string;
  devPromptA: string | null;
  devPromptB: string | null;
  devPromptC: string | null;
};

describe('redactElementPrompts', () => {
  it.each(['ai1', 'ai2', 'ai2only'])('preserves devPromptB for %s elements', (type) => {
    const element: TestElement = {
      id: 1,
      type,
      devPromptA: 'system-a',
      devPromptB: 'system-b',
      devPromptC: 'system-c'
    };

    expect(redactElementPrompts([element])).toEqual([
      {
        id: 1,
        type,
        devPromptA: null,
        devPromptB: 'system-b',
        devPromptC: null
      }
    ]);
  });

  it('removes every prompt from element types that do not show devPromptB', () => {
    const element: TestElement = {
      id: 2,
      type: 'text',
      devPromptA: 'system-a',
      devPromptB: 'system-b',
      devPromptC: 'system-c'
    };

    expect(redactElementPrompts([element])).toEqual([
      {
        id: 2,
        type: 'text',
        devPromptA: null,
        devPromptB: null,
        devPromptC: null
      }
    ]);
  });

  it('preserves extra element properties', () => {
    const element = {
      id: 3,
      type: 'ai1',
      devPromptA: 'system-a',
      devPromptB: 'system-b',
      devPromptC: 'system-c',
      title: 'Example'
    };

    expect(redactElementPrompts([element])[0]).toEqual({
      id: 3,
      type: 'ai1',
      devPromptA: null,
      devPromptB: 'system-b',
      devPromptC: null,
      title: 'Example'
    });
  });

  it('does not mutate the original elements', () => {
    const element: TestElement = {
      id: 4,
      type: 'ai2',
      devPromptA: 'system-a',
      devPromptB: 'system-b',
      devPromptC: 'system-c'
    };

    redactElementPrompts([element]);

    expect(element).toEqual({
      id: 4,
      type: 'ai2',
      devPromptA: 'system-a',
      devPromptB: 'system-b',
      devPromptC: 'system-c'
    });
  });

  it('returns an empty array for an empty input', () => {
    expect(redactElementPrompts([])).toEqual([]);
  });
});
