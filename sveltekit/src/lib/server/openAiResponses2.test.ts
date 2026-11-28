import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseBirthDateWithAi,
  streamAiResponse,
  summarizeConversationMemory,
  translateWithAi
} from './openAiResponses';

const { mockResponsesCreate, mockStringify, mockOpenAIConstructor } = vi.hoisted(() => ({
  mockResponsesCreate: vi.fn(),
  mockStringify: vi.fn((value: unknown) => JSON.stringify(value)),
  mockOpenAIConstructor: vi.fn()
}));

vi.mock('openai', () => ({
  // The production module calls `new OpenAI(...)`, so the mock must be
  // constructable. A class avoids arrow-function constructor errors.
  OpenAI: class MockOpenAI {
    responses = {
      create: mockResponsesCreate
    };

    constructor(options: unknown) {
      mockOpenAIConstructor(options);
    }
  }
}));

vi.mock('$env/static/private', () => ({
  OPENAI_API_KEY: 'test-api-key',
  OPENAI_BASE_URL: 'https://openai.example.test/v1',
  OPENAI_MODEL: 'test-model'
}));

vi.mock('openai/internal/qs/stringify.mjs', () => ({
  stringify: mockStringify
}));

type TestEvent = {
  type: string;
  [key: string]: unknown;
};

function asAsyncIterable(events: TestEvent[]): AsyncIterable<TestEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

function textDelta(delta: string): TestEvent {
  return { type: 'response.output_text.delta', delta };
}

function completedEvent(inputTokens?: number, outputTokens?: number): TestEvent {
  return {
    type: 'response.completed',
    response: {
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens
      }
    }
  };
}

function decode(chunk: ReadableStreamReadResult<Uint8Array>): string {
  return chunk.value ? new TextDecoder().decode(chunk.value) : '';
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseBirthDateWithAi', () => {
  it('extracts and normalizes a date and maps token usage', async () => {
    mockResponsesCreate.mockResolvedValueOnce({
      output_text: '  Das erkannte Geburtsdatum ist 1.2.1990.  ',
      usage: { input_tokens: 18, output_tokens: 6 }
    });

    const result = await parseBirthDateWithAi('Geboren am 1. Februar 1990');

    expect(result).toEqual({
      birthDate: '01.02.1990',
      usage: { promptTokens: 18, completionTokens: 6 }
    });
    expect(mockOpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      baseURL: 'https://openai.example.test/v1'
    });
    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        input: 'Geboren am 1. Februar 1990',
        reasoning: { effort: 'low' },
        max_output_tokens: 256
      })
    );
  });

  it('accepts slash-separated dates', async () => {
    mockResponsesCreate.mockResolvedValueOnce({
      output_text: '1/2/1990',
      usage: { input_tokens: 3, output_tokens: 2 }
    });

    await expect(parseBirthDateWithAi('01.02.1990')).resolves.toMatchObject({
      birthDate: '01.02.1990'
    });
  });

  it.each(['UNKNOWN', 'Kein eindeutiges Geburtsdatum erkennbar', ''])
    ('returns null when the response contains no parseable date (%j)', async (outputText) => {
      mockResponsesCreate.mockResolvedValueOnce({ output_text: outputText });

      const result = await parseBirthDateWithAi('Eine Eingabe ohne Datum');

      expect(result).toEqual({
        birthDate: null,
        usage: { promptTokens: undefined, completionTokens: undefined }
      });
    });
});

describe('summarizeConversationMemory', () => {
  it('uses the German prompt by default and returns trimmed output', async () => {
    mockResponsesCreate.mockResolvedValueOnce({ output_text: '  Eine Pizza Margherita.  ' });

    const result = await summarizeConversationMemory('', 'Eine Margherita bitte.', 'Gerne.');

    expect(result).toBe('Eine Pizza Margherita.');
    expect(mockResponsesCreate).toHaveBeenCalledWith({
      model: 'test-model',
      instructions:
        'Erstelle ein kurzes, sachliches Kurzzeitgedächtnis für eine Pizzabestellung. Behalte nur bestätigte Bestelldetails, Ergänzungen, Änderungen. Fasse frühere Angaben zusammen statt sie zu zitieren. Füge keine Informationen hinzu, es muss eine reine Zusammenfassung sein. Höchstens 80 Wörter.',
      input:
        'Bisherige Zusammenfassung:\n(keine)\n\nNeue Nachricht:\nEine Margherita bitte.\n\nAntwort des Assistenten:\nGerne.',
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 200
    });
  });

  it('uses English labels when lang is en', async () => {
    mockResponsesCreate.mockResolvedValueOnce({ output_text: 'Order: two Margheritas' });

    await summarizeConversationMemory(
      'one pizza',
      'Add another Margherita',
      'Added',
      'en'
    );

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions:
          'Write a short, factual short-term memory for a pizza order. Keep only confirmed order details, additions and changes. Summarise earlier information instead of quoting it. Do not add any information; it must be a pure summary. At most 80 words.',
        input:
          "Previous summary:\none pizza\n\nNew message:\nAdd another Margherita\n\nAssistant's answer:\nAdded"
      })
    );
  });

  it('falls back to the previous summary when the model returns blank text', async () => {
    mockResponsesCreate.mockResolvedValueOnce({ output_text: '   \n  ' });

    await expect(
      summarizeConversationMemory('Existing summary', 'New detail', 'Acknowledged')
    ).resolves.toBe('Existing summary');
  });

  it('returns an empty string when both the previous summary and model output are empty', async () => {
    mockResponsesCreate.mockResolvedValueOnce({ output_text: ' ' });

    await expect(summarizeConversationMemory('', 'Hello', 'Hi')).resolves.toBe('');
  });
});

describe('streamAiResponse', () => {
  const messages = [{ role: 'user' as const, content: 'Hello' }];

  it('streams text deltas, saves the complete response, and appends the usage footer', async () => {
    mockResponsesCreate.mockResolvedValueOnce(
      asAsyncIterable([
        textDelta('Hello '),
        textDelta('world'),
        textDelta(''),
        { type: 'response.some_other_event' },
        completedEvent(21, 8)
      ])
    );
    const saveToDb = vi.fn().mockResolvedValue(undefined);

    const response = await streamAiResponse({ messages, saveToDb });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(body).toBe(
      'Hello world\n[__FOOTER__]' +
        JSON.stringify({ __footer: true, promptTokens: 21, completionTokens: 8 })
    );
    expect(saveToDb).toHaveBeenCalledOnce();
    expect(saveToDb).toHaveBeenCalledWith('Hello world', {
      promptTokens: 21,
      completionTokens: 8
    });
    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        input: messages,
        max_output_tokens: 10000,
        reasoning: { effort: 'low' },
        stream: true
      })
    );
  });

  it('uses caller-supplied token and reasoning settings', async () => {
    mockResponsesCreate.mockResolvedValueOnce(asAsyncIterable([]));
    const saveToDb = vi.fn().mockResolvedValue(undefined);

    const response = await streamAiResponse({
      messages,
      saveToDb,
      maxTokens: 512,
      reasoningEffort: 'minimal'
    });
    const body = await response.text();

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_output_tokens: 512,
        reasoning: { effort: 'minimal' },
        stream: true
      })
    );
    expect(saveToDb).toHaveBeenCalledWith('', {});
    expect(body).toBe('\n[__FOOTER__]{"__footer":true}');
  });

  it('waits for persistence to finish before sending the footer', async () => {
    mockResponsesCreate.mockResolvedValueOnce(
      asAsyncIterable([textDelta('Answer'), completedEvent(4, 2)])
    );

    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });

    let notifySaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      notifySaveStarted = resolve;
    });

    const saveToDb = vi.fn(async () => {
      notifySaveStarted();
      await saveGate;
    });

    const response = await streamAiResponse({ messages, saveToDb });
    const reader = response.body!.getReader();

    const firstChunk = await reader.read();
    expect(decode(firstChunk)).toBe('Answer');

    let footerReadSettled = false;
    const footerReadPromise = reader.read().then((result) => {
      footerReadSettled = true;
      return result;
    });

    await saveStarted;
    expect(footerReadSettled).toBe(false);

    releaseSave();
    const footerChunk = await footerReadPromise;
    expect(decode(footerChunk)).toBe(
      '\n[__FOOTER__]' +
        JSON.stringify({ __footer: true, promptTokens: 4, completionTokens: 2 })
    );

    await reader.read();
  });

  it('returns 451 and records a filtered input when OpenAI rejects with content_filter', async () => {
    mockResponsesCreate.mockRejectedValueOnce({ code: 'content_filter' });
    mockStringify.mockReturnValueOnce('serialized-messages');
    const saveToDb = vi.fn().mockResolvedValue(undefined);

    const response = await streamAiResponse({ messages, saveToDb });

    expect(response.status).toBe(451);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(
      '⚠️ Ihre Eingabe konnte leider nicht verarbeitet werden, da sie gegen die Inhaltsrichtlinien verstößt.'
    );
    expect(mockStringify).toHaveBeenCalledWith(messages);
    expect(saveToDb).toHaveBeenCalledWith('[Gefiltert]serialized-messages', {
      promptTokens: 0,
      completionTokens: 0
    });
  });

  it('rethrows unexpected errors from the OpenAI request', async () => {
    const error = new Error('OpenAI unavailable');
    mockResponsesCreate.mockRejectedValueOnce(error);
    const saveToDb = vi.fn();

    await expect(streamAiResponse({ messages, saveToDb })).rejects.toBe(error);
    expect(saveToDb).not.toHaveBeenCalled();
  });

  it('still sends the footer when saving a streamed answer fails', async () => {
    const dbError = new Error('Database unavailable');
    mockResponsesCreate.mockResolvedValueOnce(
      asAsyncIterable([textDelta('Generated text'), completedEvent(9, 3)])
    );
    const saveToDb = vi.fn().mockRejectedValueOnce(dbError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await streamAiResponse({ messages, saveToDb });
    const body = await response.text();

    expect(body).toContain('Generated text');
    expect(body).toContain('[__FOOTER__]');
    expect(consoleError).toHaveBeenCalledWith(
      'Fehler beim Speichern der KI-Antwort:',
      dbError
    );
  });
});

describe('translateWithAi', () => {
  it('passes instructions and text to OpenAI and returns trimmed output', async () => {
    mockResponsesCreate.mockResolvedValueOnce({ output_text: '  Translated text\n' });

    const result = await translateWithAi('Translate to English', 'Hallo Welt');

    expect(result).toBe('Translated text');
    expect(mockResponsesCreate).toHaveBeenCalledWith({
      model: 'test-model',
      instructions: 'Translate to English',
      input: 'Hallo Welt',
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 16000
    });
  });

  it('propagates errors from OpenAI', async () => {
    const error = new Error('Translation failed');
    mockResponsesCreate.mockRejectedValueOnce(error);

    await expect(translateWithAi('Translate', 'Text')).rejects.toBe(error);
  });
});
