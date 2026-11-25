import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireLogin: vi.fn(),
  createProgress: vi.fn(),
  findElementForLang: vi.fn(),
  summarizeConversationMemory: vi.fn(),
  parseBirthDateWithAi: vi.fn(),
  streamAiResponse: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
  prisma: {
    userProgress: { create: mocks.createProgress }
  }
}));

vi.mock('$lib/server/jwt', () => ({
  requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/courseTranslations', () => ({
  findElementForLang: mocks.findElementForLang
}));

vi.mock('$lib/server/openAiResponses', () => ({
  summarizeConversationMemory: mocks.summarizeConversationMemory,
  parseBirthDateWithAi: mocks.parseBirthDateWithAi,
  streamAiResponse: mocks.streamAiResponse
}));

vi.mock('marked', () => ({
  marked: { parse: (text: string) => `<p>${text}</p>` }
}));

import { POST } from './+server';

const cookies = {} as Cookies;

function requestBody(body: unknown) {
  return {
    request: { json: vi.fn().mockResolvedValue(body) },
    cookies
  } as Parameters<typeof POST>[0];
}

async function post(body: unknown): Promise<Response> {
  const response = await POST(requestBody(body));
  if (!response) throw new Error('POST returned no response');
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireLogin.mockReturnValue({ id: 'user-1' });
  mocks.createProgress.mockResolvedValue({ id: 'progress-1' });
  mocks.streamAiResponse.mockImplementation(async (options) => {
    await options.saveToDb('AI answer', {
      promptTokens: 12,
      completionTokens: 7
    });
    return new Response('AI answer');
  });
});

describe('POST aiAnswer authorization and validation', () => {
  it('rejects a request for another authenticated user', async () => {
    const response = await post({
      action: 'ai1',
      data: { userId: 'user-2', elementId: 11, ai1: 'Hallo' }
    });

    expect(mocks.requireLogin).toHaveBeenCalledWith(cookies);
    expect(mocks.findElementForLang).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unauthorized user'
    });
  });

  it('stores and rejects an excessively long prompt', async () => {
    const response = await post({
      lang: 'de',
      action: 'ai1',
      data: {
        userId: 'user-1',
        elementId: 11,
        courseId: 'course-1',
        lessonId: 7,
        ai1: 'x'.repeat(3001)
      }
    });

    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        elementId: 11,
        courseId: 'course-1',
        lessonId: 7,
        ai1: '!Anfrage zu lang! 3001',
        ai2: '!Anfrage zu lang! undefined',
        promptsTried: 0
      }
    });
    expect(await response.text()).toBe('<i>Anfrage zu lang</i>');
  });

  it('falls back to German for an invalid language', async () => {
    mocks.findElementForLang.mockResolvedValue(null);

    const response = await post({
      lang: 'fr',
      action: 'ai1',
      data: { userId: 'user-1', elementId: 404, ai1: 'Hallo' }
    });

    expect(mocks.findElementForLang).toHaveBeenCalledWith(404, 'de');
    expect(response.status).toBe(404);
  });
});

describe('POST aiAnswer memory actions', () => {
  it('summarizes conversation memory and slices input to 3000 characters', async () => {
    mocks.summarizeConversationMemory.mockResolvedValue('Zusammenfassung');

    const response = await post({
      lang: 'de',
      action: 'memorySummarize',
      data: {
        userId: 'user-1',
        summary: 'alt',
        message: 'Ich möchte eine Pizza.',
        assistantResponse: 'Welche Größe?'
      }
    });

    expect(mocks.summarizeConversationMemory).toHaveBeenCalledWith(
      'alt',
      'Ich möchte eine Pizza.',
      'Welche Größe?',
      'de'
    );
    await expect(response.json()).resolves.toEqual({
      success: true,
      summary: 'Zusammenfassung'
    });
  });

  it('rejects incomplete conversation summary data', async () => {
    const response = await post({
      action: 'memorySummarize',
      data: { userId: 'user-1', message: '', assistantResponse: 'Antwort' }
    });

    expect(mocks.summarizeConversationMemory).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('builds a memory exercise with history and saves the result', async () => {
    mocks.findElementForLang.mockResolvedValue({
      devPromptA: 'Bestell-Assistent'
    });

    await post({
      lang: 'en',
      action: 'memoryWithHistory',
      data: {
        userId: 'user-1',
        elementId: 20,
        courseId: 'course-1',
        lessonId: 7,
        message: 'Large, please.',
        summary: 'The user wants a pizza.'
      }
    });

    expect(mocks.streamAiResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'developer', content: 'Bestell-Assistent' },
        { role: 'developer', content: 'Short-term memory (summary):\nThe user wants a pizza.' },
        { role: 'user', content: 'Large, please.' }
      ]
    }));
    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        elementId: 20,
        ai1: 'Large, please.',
        ai1Result: '<p>AI answer</p>',
        promptTokens: 12,
        completionTokens: 7,
        promptsTried: 1
      })
    });
  });

  it('reports a missing memory exercise', async () => {
    mocks.findElementForLang.mockResolvedValue(null);

    const response = await post({
      action: 'memoryNoHistory',
      data: { userId: 'user-1', elementId: 404, message: 'Hallo' }
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Memory exercise not found.'
    });
  });
});

describe('POST aiAnswer standard actions', () => {
  it('runs ai1 with translated prompts and saves Markdown as HTML', async () => {
    mocks.findElementForLang.mockResolvedValue({
      devPromptA: 'Developer prompt',
      devPromptB: 'Second prompt',
      type: 'ai1'
    });

    await post({
      action: 'ai1',
      data: {
        userId: 'user-1',
        elementId: 12,
        courseId: 'course-1',
        lessonId: 7,
        ai1: 'My prompt'
      }
    });

    expect(mocks.streamAiResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'developer', content: 'Developer prompt' },
        { role: 'user', content: 'My prompt' },
        { role: 'user', content: 'Second prompt' }
      ]
    }));
    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ai1: 'My prompt',
        ai1Result: '<p>AI answer</p>',
        promptsTried: 1
      })
    });
  });

  it('returns 404 when aiSide1 cannot find the element', async () => {
    mocks.findElementForLang.mockResolvedValue(null);

    const response = await post({
      action: 'aiSide1',
      data: { userId: 'user-1', elementId: 404, ai1: 'Hallo' }
    });

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Element not found.'
    });
  });

  it('uses ai2only message shape when the element type requires it', async () => {
    mocks.findElementForLang.mockResolvedValue({
      devPromptA: 'Developer A',
      devPromptB: 'Developer B',
      type: 'ai2only'
    });

    await post({
      action: 'ai2',
      data: {
        userId: 'user-1',
        elementId: 13,
        ai2: 'My second answer'
      }
    });

    expect(mocks.streamAiResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'developer', content: 'Developer A' },
        { role: 'user', content: 'My second answer' }
      ]
    }));
  });
});

describe('POST aiAnswer tool and star actions', () => {
  it('rejects an invalid birth date and still saves progress', async () => {
    mocks.findElementForLang.mockResolvedValue({
      devPromptA: 'Tool prompt',
      type: 'aiSideTool'
    });
    mocks.parseBirthDateWithAi.mockResolvedValue({
      birthDate: null,
      usage: { promptTokens: 9, completionTokens: 2 }
    });

    const response = await post({
      lang: 'de',
      action: 'aiSide2',
      data: {
        userId: 'user-1',
        elementId: 30,
        courseId: 'course-1',
        lessonId: 7,
        ai2: 'Ich weiß es nicht'
      }
    });

    expect(mocks.parseBirthDateWithAi).toHaveBeenCalledWith('Ich weiß es nicht');
    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ai2: 'Ich weiß es nicht',
        ai2Result: '<p>Ich konnte kein eindeutiges, gültiges Geburtsdatum erkennen. Bitte nenne es noch einmal, zum Beispiel „Ich wurde am 3. Mai 2008 geboren.“</p>',
        promptTokens: 9,
        completionTokens: 2,
        promptsTried: 1
      })
    });
    expect(await response.text()).toContain('Ich konnte kein eindeutiges');
  });

  it('uses an English invalid-date message', async () => {
    mocks.findElementForLang.mockResolvedValue({ type: 'aiSideTool' });
    mocks.parseBirthDateWithAi.mockResolvedValue({
      birthDate: '31.02.2000',
      usage: { promptTokens: 3, completionTokens: 1 }
    });

    const response = await post({
      lang: 'en',
      action: 'aiSide2',
      data: { userId: 'user-1', elementId: 31, ai2: '31 February 2000' }
    });

    expect(await response.text()).toContain('I could not recognise a clear, valid date of birth');
  });

  it('parses star JSON and saves a positive star', async () => {
    mocks.findElementForLang.mockResolvedValue({
      devPromptA: 'Evaluate this task'
    });
    mocks.streamAiResponse.mockImplementation(async (options) => {
      await options.saveToDb('{"star":true,"feedback":"Gut gemacht!"}', {
        promptTokens: 20,
        completionTokens: 4
      });
      return new Response('star response');
    });

    await post({
      lang: 'de',
      action: 'star',
      data: {
        userId: 'user-1',
        elementId: 40,
        courseId: 'course-1',
        lessonId: 7,
        ai1: 'My solution'
      }
    });

    expect(mocks.streamAiResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'My solution' })
      ])
    }));
    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stars: 1,
        ai1: 'My solution',
        ai1Result: '{"star":true,"feedback":"Gut gemacht!"}',
        promptTokens: 20,
        completionTokens: 4,
        promptsTried: 1
      })
    });
  });

  it('falls back to no-answer data when star JSON is malformed', async () => {
    mocks.findElementForLang.mockResolvedValue({ devPromptA: 'Evaluate' });
    mocks.streamAiResponse.mockImplementation(async (options) => {
      await options.saveToDb('not json', { promptTokens: 1 });
      return new Response('star response');
    });

    await post({
      action: 'star',
      data: { userId: 'user-1', elementId: 41, ai1: 'Antwort' }
    });

    expect(mocks.createProgress).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stars: 0,
        ai1Result: '{"star":false,"feedback":"Keine Antwort."}'
      })
    });
  });
});
