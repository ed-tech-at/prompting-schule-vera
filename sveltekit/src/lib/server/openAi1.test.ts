import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  openAiConstructor: vi.fn(),
  stringify: vi.fn()
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };

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

vi.mock('marked', () => ({ marked: { parse: vi.fn() } }));
vi.mock('@sveltejs/kit', () => ({ json: vi.fn() }));

import {
  parseBirthDateWithAi,
  streamAiResponse,
  summarizeConversationMemory
} from './openAi';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stringify.mockImplementation((messages) => JSON.stringify(messages));
});

async function collectStream(chunks: Array<{ choices: Array<{ delta?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>) {
  mocks.create.mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  });

  const saveToDb = vi.fn().mockResolvedValue(undefined);
  const response = await streamAiResponse({
    messages: [{ role: 'user', content: 'Hallo' }],
    saveToDb,
    maxTokens: 321,
    reasoningEffort: 'minimal'
  });

  return { response, saveToDb };
}

describe('parseBirthDateWithAi', () => {
  it('parses and normalizes a date and returns token usage', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: '  2/4/2024  ' } }],
      usage: { prompt_tokens: 11, completion_tokens: 3 }
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
      verbosity: 'low',
      reasoning_effort: 'minimal',
      max_completion_tokens: 256,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Geboren am 2.4.2024' })
      ])
    }));
  });

  it('returns null for missing or ambiguous dates', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: 'UNKNOWN' } }],
      usage: {}
    });

    await expect(parseBirthDateWithAi('Kein Datum')).resolves.toEqual({
      birthDate: null,
      usage: { promptTokens: undefined, completionTokens: undefined }
    });
  });
});

describe('summarizeConversationMemory', () => {
  it('returns the trimmed model summary', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: '  Eine große Pizza  ' } }]
    });

    await expect(summarizeConversationMemory('alt', 'große Pizza', 'In Ordnung')).resolves.toBe('Eine große Pizza');

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      max_completion_tokens: 200,
      messages: [
        expect.objectContaining({ role: 'developer' }),
        expect.objectContaining({
          role: 'user',
          content: 'Bisherige Zusammenfassung:\nalt\n\nNeue Nachricht:\ngroße Pizza\n\nAntwort des Assistenten:\nIn Ordnung'
        })
      ]
    }));
  });

  it('falls back to the previous summary for an empty response', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: '   ' } }]
    });

    await expect(summarizeConversationMemory('Vorherige Zusammenfassung', 'neu', 'Antwort')).resolves.toBe('Vorherige Zusammenfassung');
  });
});

describe('streamAiResponse', () => {
  it('streams text, sends usage in the footer, and saves the full answer', async () => {
    const { response, saveToDb } = await collectStream([
      { choices: [{ delta: { content: 'Hallo ' } }] },
      {
        choices: [{ delta: { content: 'Welt' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 }
      }
    ]);

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
      verbosity: 'low',
      messages: [{ role: 'user', content: 'Hallo' }],
      max_completion_tokens: 321,
      reasoning_effort: 'minimal',
      stream: true,
      stream_options: { include_usage: true }
    }));
  });

  it('uses default token count and undefined usage when no usage chunk arrives', async () => {
    mocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Antwort' } }] };
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
    expect(saveToDb).toHaveBeenCalledWith('Antwort', {
      promptTokens: undefined,
      completionTokens: undefined
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      max_completion_tokens: 1000
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
});
