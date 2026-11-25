import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  openAiConstructor: vi.fn(),
  stringify: vi.fn()
}));

vi.mock('openai', () => {
  class MockOpenAI {
    responses = { create: mocks.create };

    constructor(options: unknown) {
      mocks.openAiConstructor(options);
    }
  }

  return { OpenAI: MockOpenAI };
});

vi.mock('openai/internal/qs/stringify.mjs', () => ({
  stringify: mocks.stringify
}));

vi.mock('$env/static/private', () => ({
  OPENAI_API_KEY: 'test-api-key',
  OPENAI_BASE_URL: 'https://openai.example.test/v1',
  OPENAI_MODEL: 'test-model'
}));

import {
  parseBirthDateWithAi,
  streamAiResponse,
  summarizeConversationMemory,
  translateWithAi
} from './openAiResponses';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stringify.mockImplementation((messages) => JSON.stringify(messages));
});

describe('parseBirthDateWithAi', () => {
  it('normalizes a date and returns token usage', async () => {
    mocks.create.mockResolvedValue({
      output_text: '  2/4/2024  ',
      usage: { input_tokens: 11, output_tokens: 3 }
    });

    await expect(parseBirthDateWithAi('Geboren am 2.4.2024')).resolves.toEqual({
      birthDate: '02.04.2024',
      usage: { promptTokens: 11, completionTokens: 3 }
    });

    expect(mocks.openAiConstructor).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      baseURL: 'https://openai.example.test/v1'
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      input: 'Geboren am 2.4.2024',
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 256
    }));
  });

  it('returns null and undefined usage for UNKNOWN or missing usage', async () => {
    mocks.create.mockResolvedValue({ output_text: 'UNKNOWN' });

    await expect(parseBirthDateWithAi('Kein Datum')).resolves.toEqual({
      birthDate: null,
      usage: { promptTokens: undefined, completionTokens: undefined }
    });
  });
});

describe('summarizeConversationMemory', () => {
  it('uses the German prompt and returns a trimmed summary', async () => {
    mocks.create.mockResolvedValue({ output_text: '  Eine große Pizza  ' });

    await expect(summarizeConversationMemory('alt', 'große Pizza', 'In Ordnung')).resolves.toBe('Eine große Pizza');

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      instructions: expect.stringContaining('Pizzabestellung'),
      input: 'Bisherige Zusammenfassung:\nalt\n\nNeue Nachricht:\ngroße Pizza\n\nAntwort des Assistenten:\nIn Ordnung',
      max_output_tokens: 200
    }));
  });

  it('uses the English prompt and no-summary marker', async () => {
    mocks.create.mockResolvedValue({ output_text: 'One large pizza' });

    await expect(summarizeConversationMemory('', 'large pizza', 'Okay', 'en')).resolves.toBe('One large pizza');

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining('pizza order'),
      input: 'Previous summary:\n(none)\n\nNew message:\nlarge pizza\n\nAssistant\'s answer:\nOkay'
    }));
  });

  it('falls back to the previous summary for an empty model response', async () => {
    mocks.create.mockResolvedValue({ output_text: '   ' });

    await expect(summarizeConversationMemory('Vorherige Zusammenfassung', 'neu', 'Antwort')).resolves.toBe('Vorherige Zusammenfassung');
  });
});

describe('streamAiResponse', () => {
  it('streams text, captures usage, sends a footer, and saves the full answer', async () => {
    mocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'response.output_text.delta', delta: 'Hallo ' };
        yield { type: 'response.output_text.delta', delta: 'Welt' };
        yield {
          type: 'response.completed',
          response: { usage: { input_tokens: 12, output_tokens: 7 } }
        };
      }
    });

    const saveToDb = vi.fn().mockResolvedValue(undefined);
    const response = await streamAiResponse({
      messages: [{ role: 'user', content: 'Hallo' }],
      saveToDb,
      maxTokens: 321,
      reasoningEffort: 'minimal'
    });

    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    await expect(response.text()).resolves.toBe(
      'Hallo Welt\n[__FOOTER__]{"__footer":true,"promptTokens":12,"completionTokens":7}'
    );
    expect(saveToDb).toHaveBeenCalledWith('Hallo Welt', {
      promptTokens: 12,
      completionTokens: 7
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      input: [{ role: 'user', content: 'Hallo' }],
      max_output_tokens: 321,
      reasoning: { effort: 'minimal' },
      text: { verbosity: 'low' },
      stream: true
    }));
  });

  it('uses defaults and omits usage fields when usage is unavailable', async () => {
    mocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'response.output_text.delta', delta: 'Antwort' };
      }
    });

    const saveToDb = vi.fn().mockResolvedValue(undefined);
    const response = await streamAiResponse({
      messages: [{ role: 'assistant', content: 'Vorherige Antwort' }],
      saveToDb
    });

    await expect(response.text()).resolves.toBe(
      'Antwort\n[__FOOTER__]{"__footer":true}'
    );
    expect(saveToDb).toHaveBeenCalledWith('Antwort', {});
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      max_output_tokens: 10000,
      reasoning: { effort: 'low' }
    }));
  });

  it('returns status 451 and saves a filtered placeholder', async () => {
    mocks.stringify.mockReturnValue('[serialized messages]');
    mocks.create.mockRejectedValue({ code: 'content_filter' });
    const saveToDb = vi.fn().mockResolvedValue(undefined);

    const response = await streamAiResponse({
      messages: [{ role: 'user', content: 'Gefilterte Eingabe' }],
      saveToDb
    });

    expect(response.status).toBe(451);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    await expect(response.text()).resolves.toBe(
      '⚠️ Ihre Eingabe konnte leider nicht verarbeitet werden, da sie gegen die Inhaltsrichtlinien verstößt.'
    );
    expect(mocks.stringify).toHaveBeenCalledWith([
      { role: 'user', content: 'Gefilterte Eingabe' }
    ]);
    expect(saveToDb).toHaveBeenCalledWith('[Gefiltert][serialized messages]', {
      promptTokens: 0,
      completionTokens: 0
    });
  });

  it('rethrows unexpected API errors', async () => {
    const error = new Error('API unavailable');
    mocks.create.mockRejectedValue(error);

    await expect(streamAiResponse({
      messages: [{ role: 'user', content: 'Hallo' }],
      saveToDb: vi.fn()
    })).rejects.toBe(error);
  });

  it('still sends the footer when saving the answer fails', async () => {
    mocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'response.output_text.delta', delta: 'Gespeicherter Test' };
      }
    });
    const saveError = new Error('database unavailable');
    const saveToDb = vi.fn().mockRejectedValue(saveError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await streamAiResponse({
      messages: [{ role: 'user', content: 'Test' }],
      saveToDb
    });

    await expect(response.text()).resolves.toBe(
      'Gespeicherter Test\n[__FOOTER__]{"__footer":true}'
    );
    expect(saveToDb).toHaveBeenCalledWith('Gespeicherter Test', {});
    expect(consoleError).toHaveBeenCalledWith(
      'Fehler beim Speichern der KI-Antwort:',
      saveError
    );

    consoleError.mockRestore();
  });
});

describe('translateWithAi', () => {
  it('returns the trimmed translated text', async () => {
    mocks.create.mockResolvedValue({ output_text: '  Hello world  ' });

    await expect(translateWithAi('Translate to English', 'Hallo Welt')).resolves.toBe('Hello world');

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      instructions: 'Translate to English',
      input: 'Hallo Welt',
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 16000
    }));
  });
});
