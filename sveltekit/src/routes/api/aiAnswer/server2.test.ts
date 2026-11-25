import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  createProgress: vi.fn(),
  summarizeConversationMemory: vi.fn(),
  streamAiResponse: vi.fn(),
  findElementForLang: vi.fn(),
  parseBirthDateWithAi: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    userProgress: {
      create: mocks.createProgress
    }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/openAiResponses', () => ({
  parseBirthDateWithAi: mocks.parseBirthDateWithAi,
  summarizeConversationMemory: mocks.summarizeConversationMemory,
  streamAiResponse: mocks.streamAiResponse
}));

vi.mock('$lib/server/courseTranslations', () => ({
  findElementForLang: mocks.findElementForLang
}));

const user = { id: 'user-1' };
const element = {
  devPromptA: 'Developer prompt A',
  devPromptB: 'Developer prompt B',
  devPromptC: 'Developer prompt C',
  type: 'standard'
};

const baseData = {
  userId: user.id,
  elementId: 'element-1',
  courseId: 'course-1',
  lessonId: 'lesson-1',
  ai1: 'First answer',
  ai2: 'Second answer',
  developer: 'Custom developer prompt'
};

type Action =
  | 'memorySummarize'
  | 'memoryNoHistory'
  | 'memoryWithHistory'
  | 'aiSide1'
  | 'aiSide2'
  | 'ai1'
  | 'ai2'
  | 'ai12'
  | 'directDevUser'
  | 'directDevUserUser'
  | 'labor1'
  | 'labor2'
  | 'labor3'
  | 'star';

function post(action: Action, data: Record<string, unknown> = {}, lang = 'de') {
  return POST({
    request: new Request('http://localhost/api/aiAnswer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: { ...baseData, ...data },
        action,
        lang
      })
    }),
    cookies: {} as never
  } as never);
}

async function responseJson(response: Response) {
  return response.json();
}

function streamedOptions() {
  expect(mocks.streamAiResponse).toHaveBeenCalledTimes(1);
  return mocks.streamAiResponse.mock.calls[0]![0] as {
    messages: Array<{ role: string; content: string }>;
    reasoningEffort?: string;
    maxTokens?: number;
    saveToDb: (text: string, usage: Record<string, number>) => Promise<void>;
  };
}

async function runSaveCallback(
  text = '**Generated answer**',
  usage = { promptTokens: 12, completionTokens: 34 }
) {
  const options = streamedOptions();
  await options.saveToDb(text, usage);
}

describe('POST /api/aiAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireLogin.mockReturnValue(user);
    mocks.createProgress.mockResolvedValue({ id: 'progress-1' });
    mocks.summarizeConversationMemory.mockResolvedValue('Condensed memory');
    mocks.findElementForLang.mockResolvedValue(element);
    mocks.parseBirthDateWithAi.mockResolvedValue({
      birthDate: null,
      usage: { promptTokens: 3, completionTokens: 4 }
    });
    mocks.streamAiResponse.mockImplementation(() => new Response('streamed response'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('request guards', () => {
    it('rejects a request whose userId does not match the logged-in user', async () => {
      const response = await post('ai1', { userId: 'another-user' });

      expect(await responseJson(response)).toEqual({
        success: false,
        error: 'Unauthorized user'
      });
      expect(mocks.findElementForLang).not.toHaveBeenCalled();
      expect(mocks.streamAiResponse).not.toHaveBeenCalled();
      expect(mocks.createProgress).not.toHaveBeenCalled();
    });

    it('records an overlong prompt and returns the localized error response', async () => {
      const response = await post('ai1', { ai1: 'x'.repeat(3001) }, 'en');

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<i>Request too long</i>');
      expect(mocks.createProgress).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: user.id,
          ai1: '!Request too long! 3001',
          promptsTried: 0
        })
      });
      expect(mocks.streamAiResponse).not.toHaveBeenCalled();
    });

    it('does not reject a prompt at the 3000-character limit', async () => {
      const response = await post('directDevUser', { ai1: 'x'.repeat(3000) });

      expect(response.status).toBe(200);
      expect(mocks.streamAiResponse).toHaveBeenCalledTimes(1);
      expect(mocks.createProgress).not.toHaveBeenCalled();
    });
  });

  describe('memory actions', () => {
    it('returns 400 when memory summarization is missing either conversation message', async () => {
      const response = await post('memorySummarize', {
        message: 'A user message',
        assistantResponse: ''
      });

      expect(response.status).toBe(400);
      expect(await responseJson(response)).toEqual({
        success: false,
        error: 'Conversation data is missing.'
      });
      expect(mocks.summarizeConversationMemory).not.toHaveBeenCalled();
    });

    it('summarizes conversation data and passes the selected language', async () => {
      const longSummary = 's'.repeat(3100);
      const longMessage = 'm'.repeat(3100);
      const longAssistantResponse = 'a'.repeat(3100);
      const response = await post(
        'memorySummarize',
        {
          summary: longSummary,
          message: longMessage,
          assistantResponse: longAssistantResponse
        },
        'en'
      );

      expect(await responseJson(response)).toEqual({
        success: true,
        summary: 'Condensed memory'
      });
      expect(mocks.summarizeConversationMemory).toHaveBeenCalledWith(
        longSummary.slice(0, 3000),
        longMessage.slice(0, 3000),
        longAssistantResponse.slice(0, 3000),
        'en'
      );
    });

    it('returns 404 when the memory exercise has no developer prompt', async () => {
      mocks.findElementForLang.mockResolvedValue({ devPromptA: '' });

      const response = await post('memoryNoHistory');

      expect(response.status).toBe(404);
      expect(await responseJson(response)).toEqual({
        success: false,
        error: 'Memory exercise not found.'
      });
      expect(mocks.streamAiResponse).not.toHaveBeenCalled();
    });

    it('builds a no-history memory prompt and persists the generated answer', async () => {
      const response = await post('memoryNoHistory', { message: 'Remember this' });

      expect(await response.text()).toBe('streamed response');
      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: 'Remember this' }
      ]);

      await runSaveCallback('A remembered **fact**');
      expect(mocks.createProgress).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: user.id,
          ai1: 'Remember this',
          ai1Result: expect.stringContaining('<strong>fact</strong>'),
          promptTokens: 12,
          completionTokens: 34,
          promptsTried: 1
        })
      });
    });

    it('adds a bounded memory summary for memoryWithHistory', async () => {
      const summary = 'Important context';
      await post('memoryWithHistory', { summary, message: 'Continue' }, 'en');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'developer', content: `Short-term memory (summary):\n${summary}` },
        { role: 'user', content: 'Continue' }
      ]);
    });

    it('omits a non-string summary for memoryWithHistory', async () => {
      await post('memoryWithHistory', { summary: 123, message: 'Continue' });

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: 'Continue' }
      ]);
    });
  });

  describe('AI side actions', () => {
    it('adds today’s date and uses minimal reasoning for an aiSideTool aiSide1 request', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 2, 5, 12, 0, 0));
      mocks.findElementForLang.mockResolvedValue({ ...element, type: 'aiSideTool' });

      await post('aiSide1', { ai1: 'I was born yesterday' }, 'en');

      const options = streamedOptions();
      expect(options.messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        {
          role: 'user',
          content: expect.stringMatching(/^Date of birth: I was born yesterday\nToday's date: 2024-03-05$/)
        }
      ]);
      expect(options.reasoningEffort).toBe('minimal');
    });

    it('uses the raw ai1 input and low reasoning for a regular aiSide1 request', async () => {
      await post('aiSide1');

      const options = streamedOptions();
      expect(options.messages[1]).toEqual({ role: 'user', content: baseData.ai1 });
      expect(options.reasoningEffort).toBe('low');
    });

    it('returns 404 when an aiSide1 element cannot be found', async () => {
      mocks.findElementForLang.mockResolvedValue(null);

      const response = await post('aiSide1');

      expect(response.status).toBe(404);
      expect(await responseJson(response)).toEqual({
        success: false,
        error: 'Element not found.'
      });
    });

    it('uses the element’s second-side prompt for a regular aiSide2 request', async () => {
      await post('aiSide2');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptB },
        { role: 'user', content: baseData.ai2 }
      ]);
    });

    it('returns a localized invalid-date message when the birth date cannot be parsed', async () => {
      mocks.findElementForLang.mockResolvedValue({ ...element, type: 'aiSideTool' });
      mocks.parseBirthDateWithAi.mockResolvedValue({
        birthDate: '31.02.2020',
        usage: { promptTokens: 7, completionTokens: 2 }
      });

      const response = await post('aiSide2', { ai2: 'not a real date' });
      const body = await response.text();

      expect(body).toContain('Ich konnte kein eindeutiges, gültiges Geburtsdatum erkennen.');
      expect(body).toContain('[__FOOTER__]');
      expect(body).toContain('"promptTokens":7');
      expect(mocks.createProgress).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ai2: 'not a real date',
          promptsTried: 1,
          promptTokens: 7,
          completionTokens: 2
        })
      });
    });

    it('calculates the age in days for a valid aiSideTool birth date', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 0, 10, 12, 0, 0));
      mocks.findElementForLang.mockResolvedValue({ ...element, type: 'aiSideTool' });
      mocks.parseBirthDateWithAi.mockResolvedValue({
        birthDate: '01.01.2024',
        usage: { promptTokens: 5, completionTokens: 6 }
      });

      const response = await post('aiSide2', { ai2: 'I was born on 1 January 2024' }, 'en');
      const bodyPromise = response.text();
      await vi.runAllTimersAsync();
      const body = await bodyPromise;

      expect(body).toContain('calculate_days_between(2024-01-01, 2024-01-10)');
      expect(body).toContain('You are 9 days old today.');
      expect(body).toContain('[__FOOTER__]');
      expect(mocks.parseBirthDateWithAi).toHaveBeenCalledWith('I was born on 1 January 2024');
      expect(mocks.createProgress).toHaveBeenCalledTimes(1);
    });

    it('rejects a future birth date', async () => {
      mocks.findElementForLang.mockResolvedValue({ ...element, type: 'aiSideTool' });
      mocks.parseBirthDateWithAi.mockResolvedValue({
        birthDate: '01.01.2099',
        usage: { promptTokens: 1, completionTokens: 1 }
      });

      const response = await post('aiSide2');

      expect(await response.text()).toContain('Ich konnte kein eindeutiges, gültiges Geburtsdatum erkennen.');
    });
  });

  describe('standard AI actions', () => {
    it('builds the ai1 messages and persists a Markdown-rendered result', async () => {
      await post('ai1');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: baseData.ai1 },
        { role: 'user', content: element.devPromptB }
      ]);

      await runSaveCallback('**Answer**');
      const saved = mocks.createProgress.mock.calls[0]![0].data;
      expect(saved.ai1).toBe(baseData.ai1);
      expect(saved.ai1Result).toContain('<strong>Answer</strong>');
      expect(saved.promptsTried).toBe(1);
    });

    it('uses both developer prompts for a regular ai2 element', async () => {
      await post('ai2');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: element.devPromptB },
        { role: 'user', content: baseData.ai2 }
      ]);
    });

    it('omits developer prompt B for an ai2only element', async () => {
      mocks.findElementForLang.mockResolvedValue({ ...element, type: 'ai2only' });

      await post('ai2');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: baseData.ai2 }
      ]);
    });

    it('builds the ai12 prompt with both user answers', async () => {
      await post('ai12');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: baseData.ai1 },
        { role: 'user', content: baseData.ai2 }
      ]);

      await runSaveCallback('Combined result');
      expect(mocks.createProgress.mock.calls[0]![0].data).toEqual(
        expect.objectContaining({
          ai1: baseData.ai1,
          ai2: baseData.ai2,
          promptsTried: 1
        })
      );
    });

    it.each([
      {
        action: 'directDevUser' as const,
        expectedMessages: [
          { role: 'developer', content: baseData.developer },
          { role: 'user', content: baseData.ai1 }
        ]
      },
      {
        action: 'directDevUserUser' as const,
        expectedMessages: [
          { role: 'developer', content: baseData.developer },
          { role: 'user', content: baseData.ai1 },
          { role: 'user', content: baseData.ai2 }
        ]
      }
    ])('$action builds direct developer/user messages and saves line breaks as HTML', async ({ action, expectedMessages }) => {
      await post(action);

      expect(streamedOptions().messages).toEqual(expectedMessages);
      await runSaveCallback('line one\nline two');

      const saved = mocks.createProgress.mock.calls[0]![0].data;
      expect(saved.ai1Result).toBe('line one<br>\nline two');
      expect(saved.promptsTried).toBe(1);
    });
  });

  describe('prompt-laboratory actions', () => {
    it('creates a better prompt and saves attempt 1', async () => {
      await post('labor1');

      const options = streamedOptions();
      expect(options.messages).toEqual([
        {
          role: 'developer',
          content: expect.stringContaining('Make the prompt BETTER. Developer prompt B')
        },
        { role: 'user', content: baseData.ai1 }
      ]);
      expect(options.maxTokens).toBe(2000);

      await runSaveCallback('line one\nline two');
      expect(mocks.createProgress.mock.calls[0]![0].data).toEqual(
        expect.objectContaining({
          ai1Result: 'line one<br>line two',
          attempts: 1,
          promptsTried: 1
        })
      );
    });

    it('creates a worse prompt and saves attempt 2', async () => {
      await post('labor2');

      expect(streamedOptions().messages[0].content).toContain('Make the prompt WORSE. Developer prompt C');
      await runSaveCallback('revised prompt');

      expect(mocks.createProgress.mock.calls[0]![0].data).toEqual(
        expect.objectContaining({ attempts: 2, promptsTried: 1 })
      );
    });

    it('uses the original two-answer prompt and saves attempt 3', async () => {
      await post('labor3');

      expect(streamedOptions().messages).toEqual([
        { role: 'developer', content: element.devPromptA },
        { role: 'user', content: baseData.ai1 },
        { role: 'user', content: baseData.ai2 }
      ]);
      await runSaveCallback('Final attempt');

      expect(mocks.createProgress.mock.calls[0]![0].data).toEqual(
        expect.objectContaining({
          ai1: baseData.ai1,
          ai2: baseData.ai2,
          attempts: 3,
          promptsTried: 1
        })
      );
    });
  });

  describe('star action', () => {
    it('parses a JSON star response and stores the feedback', async () => {
      await post('star');

      expect(streamedOptions().messages[0].content).toContain('Wenn die Aufgabe vom User erfüllt ist');
      await runSaveCallback('```json\n{"star":true,"feedback":"Well done!"}\n```');

      expect(mocks.createProgress.mock.calls[0]![0].data).toEqual(
        expect.objectContaining({
          stars: 1,
          ai1: baseData.ai1,
          ai1Result: JSON.stringify({ star: true, feedback: 'Well done!' }),
          promptsTried: 1
        })
      );
    });

    it('stores a safe fallback when the model response is not valid JSON', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await post('star');

      await runSaveCallback('not json');

      expect(mocks.createProgress.mock.calls[0]![0].data).toEqual(
        expect.objectContaining({
          stars: 0,
          ai1Result: JSON.stringify({ star: false, feedback: 'Keine Antwort.' })
        })
      );
      expect(consoleError).toHaveBeenCalledOnce();
      consoleError.mockRestore();
    });
  });
});
