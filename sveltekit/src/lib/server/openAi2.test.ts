
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAI } from 'openai';

import {
  parseBirthDateWithAi,
  summarizeConversationMemory,
  streamAiResponse
} from './openAi';

// Shared mock for OpenAI chat.completions.create
const mocks = vi.hoisted(() => ({
  create: vi.fn()
}));

// Mock OpenAI client
vi.mock('openai', () => ({
  OpenAI: vi.fn(
    class MockOpenAI {
      chat = {
        completions: {
          create: mocks.create
        }
      };
    }
  )
}));

// Mock SvelteKit private environment variables
vi.mock('$env/static/private', () => ({
  OPENAI_API_KEY: 'test-api-key',
  OPENAI_BASE_URL: 'https://test-openai.example.com',
  OPENAI_MODEL: 'test-model'
}));

type Usage = {
  promptTokens?: number;
  completionTokens?: number;
};

type SaveToDb = (text: string, usage: Usage) => Promise<void>;

const createSaveToDb = () =>
  vi.fn<SaveToDb>(async () => undefined);

// Helper to simulate an OpenAI async stream
function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReset();
});

// =====================================================
// parseBirthDateWithAi
// =====================================================

describe('parseBirthDateWithAi', () => {
  it.each([
    ['1.2.1990', '01.02.1990'],
    ['1/2/1990', '01.02.1990'],
    ['1-2-1990', '01.02.1990'],
    ['15.12.1985', '15.12.1985']
  ])(
    'should parse and normalize date %s',
    async (aiResponse, expectedDate) => {
      mocks.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: aiResponse
            }
          }
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 5
        }
      });

      const result = await parseBirthDateWithAi(
        'Ich bin am 1.2.1990 geboren.'
      );

      expect(result).toEqual({
        birthDate: expectedDate,
        usage: {
          promptTokens: 20,
          completionTokens: 5
        }
      });

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://test-openai.example.com'
      });

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          verbosity: 'low',
          reasoning_effort: 'minimal',
          max_completion_tokens: 256
        })
      );
    }
  );

  it('should return null when AI responds with UNKNOWN', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'UNKNOWN'
          }
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2
      }
    });

    const result = await parseBirthDateWithAi(
      'Ich wurde irgendwann im Sommer geboren.'
    );

    expect(result).toEqual({
      birthDate: null,
      usage: {
        promptTokens: 10,
        completionTokens: 2
      }
    });
  });

  it('should return null when AI response contains no date', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'Kein eindeutiges Geburtsdatum gefunden.'
          }
        }
      ]
    });

    const result = await parseBirthDateWithAi('Keine Datumsangabe');

    expect(result.birthDate).toBeNull();
  });

  it('should handle null AI response content', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null
          }
        }
      ]
    });

    const result = await parseBirthDateWithAi('Some input');

    expect(result.birthDate).toBeNull();
    expect(result.usage.promptTokens).toBeUndefined();
    expect(result.usage.completionTokens).toBeUndefined();
  });

  it('should handle missing choices', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: []
    });

    const result = await parseBirthDateWithAi('Some input');

    expect(result.birthDate).toBeNull();
  });

  it('should propagate OpenAI API errors', async () => {
    const error = new Error('OpenAI API unavailable');

    mocks.create.mockRejectedValueOnce(error);

    await expect(
      parseBirthDateWithAi('01.01.1990')
    ).rejects.toBe(error);
  });
});

// =====================================================
// summarizeConversationMemory
// =====================================================

describe('summarizeConversationMemory', () => {
  it('should return the generated summary', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '  Pizza Margherita, groß, extra Käse.  '
          }
        }
      ]
    });

    const result = await summarizeConversationMemory(
      'Pizza Margherita',
      'Bitte mit extra Käse.',
      'Natürlich, ich habe extra Käse hinzugefügt.'
    );

    expect(result).toBe('Pizza Margherita, groß, extra Käse.');

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        verbosity: 'low',
        reasoning_effort: 'minimal',
        max_completion_tokens: 200
      })
    );

    // Verify that all conversation inputs are passed to OpenAI
    const request = mocks.create.mock.calls[0][0];

    expect(request.messages[1].content).toBe(
      'Bisherige Zusammenfassung:\n' +
        'Pizza Margherita\n\n' +
        'Neue Nachricht:\n' +
        'Bitte mit extra Käse.\n\n' +
        'Antwort des Assistenten:\n' +
        'Natürlich, ich habe extra Käse hinzugefügt.'
    );
  });

  it('should use "(keine)" when previous summary is empty', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'Neue Bestellung: Pizza Salami.'
          }
        }
      ]
    });

    await summarizeConversationMemory(
      '',
      'Ich möchte eine Pizza Salami.',
      'Gerne!'
    );

    const request = mocks.create.mock.calls[0][0];

    expect(request.messages[1].content).toContain(
      'Bisherige Zusammenfassung:\n(keine)'
    );
  });

  it('should fall back to previous summary when AI returns empty content', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '   '
          }
        }
      ]
    });

    const previousSummary = 'Pizza Margherita mit extra Käse';

    const result = await summarizeConversationMemory(
      previousSummary,
      'Danke!',
      'Gerne!'
    );

    expect(result).toBe(previousSummary);
  });

  it('should fall back to previous summary when choices are missing', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: []
    });

    const previousSummary = 'Pizza Salami, mittel';

    const result = await summarizeConversationMemory(
      previousSummary,
      'Bitte bestätigen.',
      'Bestätigt.'
    );

    expect(result).toBe(previousSummary);
  });

  it('should propagate OpenAI API errors', async () => {
    const error = new Error('API error');

    mocks.create.mockRejectedValueOnce(error);

    await expect(
      summarizeConversationMemory('Previous', 'New', 'Response')
    ).rejects.toBe(error);
  });
});

// =====================================================
// streamAiResponse
// =====================================================

describe('streamAiResponse', () => {
  const messages = [
    {
      role: 'user' as const,
      content: 'Hallo, ich möchte eine Pizza bestellen.'
    }
  ];

  it('should stream AI response and save complete text to database', async () => {
    const saveToDb = createSaveToDb();

    const usage = {
      promptTokens: 15,
      completionTokens: 8
    };

    // Simulate multiple OpenAI streaming chunks.
    // The final chunk contains usage information.
    const chunks = [
      {
        choices: [
          {
            delta: {
              content: 'Hallo! '
            }
          }
        ]
      },
      {
        choices: [
          {
            delta: {
              content: 'Wie kann ich helfen?'
            }
          }
        ]
      },
      {
        choices: [],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 8
        }
      }
    ];

    mocks.create.mockResolvedValueOnce(
      createAsyncIterable(chunks)
    );

    const response = await streamAiResponse({
      messages,
      saveToDb,
      maxTokens: 512,
      reasoningEffort: 'minimal'
    });

    expect(response.status).toBe(200);

    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    );

    const body = await response.text();

    // Verify streamed content
    expect(body).toBe(
      'Hallo! Wie kann ich helfen?\n[__FOOTER__]' +
        JSON.stringify({
          __footer: true,
          ...usage
        })
    );

    // Verify OpenAI request configuration
    expect(mocks.create).toHaveBeenCalledWith({
      model: 'test-model',
      verbosity: 'low',
      messages,
      max_completion_tokens: 512,
      reasoning_effort: 'minimal',
      stream: true,
      stream_options: {
        include_usage: true
      }
    });

    // Verify database persistence
    await vi.waitFor(() => {
      expect(saveToDb).toHaveBeenCalledWith(
        'Hallo! Wie kann ich helfen?',
        usage
      );
    });

    expect(saveToDb).toHaveBeenCalledTimes(1);
  });

  it('should use default maxTokens of 1000', async () => {
    const saveToDb = createSaveToDb();

    mocks.create.mockResolvedValueOnce(
      createAsyncIterable([])
    );

    const response = await streamAiResponse({
      messages,
      saveToDb
    });

    await response.text();

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_completion_tokens: 1000,
        stream: true,
        stream_options: {
          include_usage: true
        }
      })
    );

    const request = mocks.create.mock.calls[0][0];

    expect(request).not.toHaveProperty('reasoning_effort');
  });

  it('should return a footer even when the stream contains no text', async () => {
    const saveToDb = createSaveToDb();

    mocks.create.mockResolvedValueOnce(
      createAsyncIterable([
        {
          choices: [],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 0
          }
        }
      ])
    );

    const response = await streamAiResponse({
      messages,
      saveToDb
    });

    const body = await response.text();

    expect(body).toContain('[__FOOTER__]');

    expect(body).toContain(
      JSON.stringify({
        __footer: true,
        promptTokens: 5,
        completionTokens: 0
      })
    );

    await vi.waitFor(() => {
      expect(saveToDb).toHaveBeenCalledWith('', {
        promptTokens: 5,
        completionTokens: 0
      });
    });
  });

  it('should return HTTP 451 when OpenAI rejects content', async () => {
    const saveToDb = createSaveToDb();

    const contentFilterError = Object.assign(
      new Error('Content filtered'),
      {
        code: 'content_filter'
      }
    );

    mocks.create.mockRejectedValueOnce(contentFilterError);

    const response = await streamAiResponse({
      messages,
      saveToDb
    });

    expect(response.status).toBe(451);

    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    );

    const body = await response.text();

    expect(body).toBe(
      '⚠️ Ihre Eingabe konnte leider nicht verarbeitet werden, ' +
        'da sie gegen die Inhaltsrichtlinien verstößt.'
    );

    // Filtered messages must also be stored in the database
    expect(saveToDb).toHaveBeenCalledTimes(1);

    expect(saveToDb).toHaveBeenCalledWith(
      expect.stringMatching(/^\[Gefiltert\]/),
      {
        promptTokens: 0,
        completionTokens: 0
      }
    );
  });

  it('should rethrow unexpected OpenAI errors', async () => {
    const saveToDb = createSaveToDb();

    const error = new Error('Internal server error');

    mocks.create.mockRejectedValueOnce(error);

    await expect(
      streamAiResponse({
        messages,
        saveToDb
      })
    ).rejects.toBe(error);

    expect(saveToDb).not.toHaveBeenCalled();
  });
});
