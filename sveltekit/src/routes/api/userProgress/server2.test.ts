
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mocks before Vitest evaluates the mocked modules.
const mocks = vi.hoisted(() => ({
	prisma: {
		element: {
			findUnique: vi.fn()
		},
		userProgress: {
			create: vi.fn(),
			findFirst: vi.fn()
		}
	},
	requireLogin: vi.fn(),
	countLessonStars: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	prisma: mocks.prisma
}));

vi.mock('$lib/server/jwt', () => ({
	requireLogin: mocks.requireLogin
}));

vi.mock('$lib/server/lessonStars', () => ({
	countLessonStars: mocks.countLessonStars
}));

import { POST } from './+server';

const USER_ID = 'user-123';
const OTHER_USER_ID = 'user-456';
const ELEMENT_ID = 'element-123';
const COURSE_ID = 'course-123';
const LESSON_ID = 'lesson-123';

// Creates a lightweight SvelteKit request event.
function makeEvent(body: unknown): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/userProgress', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		}),
		cookies: {}
	} as Parameters<typeof POST>[0];
}

// Calls the actual route handler.
async function callPost(body: unknown): Promise<Response> {
	return POST(makeEvent(body));
}

describe('POST /api/userProgress', () => {
	beforeEach(() => {
		vi.resetAllMocks();

		// Default authenticated user.
		mocks.requireLogin.mockReturnValue({
			id: USER_ID
		});

		// Default Prisma responses.
		mocks.prisma.element.findUnique.mockResolvedValue({
			id: ELEMENT_ID
		});

		mocks.prisma.userProgress.create.mockResolvedValue({
			id: 'progress-123'
		});

		mocks.prisma.userProgress.findFirst.mockResolvedValue(null);

		mocks.countLessonStars.mockResolvedValue(0);
	});

	// -------------------------------------------------------
	// Authentication
	// -------------------------------------------------------

	describe('authentication', () => {
		it('should return Unauthorized user when user IDs do not match', async () => {
			const response = await callPost({
				action: 'note',
				data: {
					userId: OTHER_USER_ID
				}
			});

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				success: false,
				error: 'Unauthorized user'
			});

			expect(mocks.requireLogin).toHaveBeenCalledOnce();

			// No database operations should happen for an unauthorized user.
			expect(mocks.prisma.element.findUnique).not.toHaveBeenCalled();
			expect(mocks.prisma.userProgress.create).not.toHaveBeenCalled();
			expect(mocks.prisma.userProgress.findFirst).not.toHaveBeenCalled();
			expect(mocks.countLessonStars).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------
	// Action: note
	// -------------------------------------------------------

	describe('action: note', () => {
		const noteData = {
			userId: USER_ID,
			elementId: ELEMENT_ID,
			courseId: COURSE_ID,
			lessonId: LESSON_ID
		};

		it('should save a note successfully', async () => {
			const ai1 = 'This is a test note.';

			const response = await callPost({
				action: 'note',
				data: {
					...noteData,
					ai1
				}
			});

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				success: true,
				ai1Result: 'Notiz gespeichert',
				promptTokens: ai1.length
			});

			expect(mocks.prisma.element.findUnique).toHaveBeenCalledWith({
				where: {
					id: ELEMENT_ID
				}
			});

			expect(mocks.prisma.userProgress.create).toHaveBeenCalledWith({
				data: {
					userId: USER_ID,
					elementId: ELEMENT_ID,
					courseId: COURSE_ID,
					lessonId: LESSON_ID,
					ai1,
					ai1Result: 'Gespeicherte Notiz',
					promptTokens: ai1.length,
					promptsTried: 0
				}
			});
		});

		it('should accept a note with exactly 50,000 characters', async () => {
			const ai1 = 'a'.repeat(50_000);

			const response = await callPost({
				action: 'note',
				data: {
					...noteData,
					ai1
				}
			});

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				success: true,
				ai1Result: 'Notiz gespeichert',
				promptTokens: 50_000
			});

			expect(mocks.prisma.userProgress.create).toHaveBeenCalledOnce();
		});

		it('should reject a note longer than 50,000 characters', async () => {
			const ai1 = 'a'.repeat(50_001);

			const response = await callPost({
				action: 'note',
				data: {
					...noteData,
					ai1
				}
			});

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				success: false,
				error: 'Anfrage zu lange'
			});

			expect(mocks.prisma.userProgress.create).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------
	// Action: getUserProgressElementAi1
	// -------------------------------------------------------

	describe('action: getUserProgressElementAi1', () => {
		const data = {
			userId: USER_ID,
			elementId: ELEMENT_ID
		};

		it('should return success false when no progress record exists', async () => {
			mocks.prisma.userProgress.findFirst.mockResolvedValue(null);

			const response = await callPost({
				action: 'getUserProgressElementAi1',
				data
			});

			expect(await response.json()).toEqual({
				success: false
			});

			expect(mocks.prisma.userProgress.findFirst).toHaveBeenCalledWith({
				where: {
					userId: USER_ID,
					elementId: ELEMENT_ID,
					ai1Result: {
						not: null
					}
				},
				orderBy: {
					createdAt: 'desc'
				}
			});
		});

		it.each(['\n', '<br>'])(
			'should normalize ai1 value "%s" to an empty string',
			async (ai1) => {
				const progress = {
					id: 'progress-123',
					userId: USER_ID,
					elementId: ELEMENT_ID,
					ai1
				};

				mocks.prisma.userProgress.findFirst.mockResolvedValue(progress);

				const response = await callPost({
					action: 'getUserProgressElementAi1',
					data
				});

				expect(await response.json()).toEqual({
					success: true,
					userProgress: {
						...progress,
						ai1: ''
					}
				});
			}
		);

		it('should return the progress record when ai1 contains normal text', async () => {
			const progress = {
				id: 'progress-123',
				userId: USER_ID,
				elementId: ELEMENT_ID,
				ai1: 'My saved note'
			};

			mocks.prisma.userProgress.findFirst.mockResolvedValue(progress);

			const response = await callPost({
				action: 'getUserProgressElementAi1',
				data
			});

			expect(await response.json()).toEqual({
				success: true,
				userProgress: progress
			});
		});
	});

	// -------------------------------------------------------
	// Action: getUserProgressElementAi2
	// -------------------------------------------------------

	describe('action: getUserProgressElementAi2', () => {
		const data = {
			userId: USER_ID,
			elementId: ELEMENT_ID
		};

		it('should return success false when no progress record exists', async () => {
			mocks.prisma.userProgress.findFirst.mockResolvedValue(null);

			const response = await callPost({
				action: 'getUserProgressElementAi2',
				data
			});

			expect(await response.json()).toEqual({
				success: false
			});

			expect(mocks.prisma.userProgress.findFirst).toHaveBeenCalledWith({
				where: {
					userId: USER_ID,
					elementId: ELEMENT_ID,
					ai2Result: {
						not: null
					}
				},
				orderBy: {
					createdAt: 'desc'
				}
			});
		});

		it.each(['\n', '<br>'])(
			'should normalize ai2 value "%s" to an empty string',
			async (ai2) => {
				const progress = {
					id: 'progress-123',
					userId: USER_ID,
					elementId: ELEMENT_ID,
					ai2
				};

				mocks.prisma.userProgress.findFirst.mockResolvedValue(progress);

				const response = await callPost({
					action: 'getUserProgressElementAi2',
					data
				});

				expect(await response.json()).toEqual({
					success: true,
					userProgress: {
						...progress,
						ai2: ''
					}
				});
			}
		);

		it('should return the progress record when ai2 contains normal text', async () => {
			const progress = {
				id: 'progress-123',
				userId: USER_ID,
				elementId: ELEMENT_ID,
				ai2: 'AI response text'
			};

			mocks.prisma.userProgress.findFirst.mockResolvedValue(progress);

			const response = await callPost({
				action: 'getUserProgressElementAi2',
				data
			});

			expect(await response.json()).toEqual({
				success: true,
				userProgress: progress
			});
		});
	});

	// -------------------------------------------------------
	// Action: getUserProgressElementStar
	// -------------------------------------------------------

	describe('action: getUserProgressElementStar', () => {
		const data = {
			userId: USER_ID,
			elementId: ELEMENT_ID
		};

		it('should return success false when no progress record exists', async () => {
			mocks.prisma.userProgress.findFirst.mockResolvedValue(null);

			const response = await callPost({
				action: 'getUserProgressElementStar',
				data
			});

			expect(await response.json()).toEqual({
				success: false
			});

			expect(mocks.prisma.userProgress.findFirst).toHaveBeenCalledWith({
				where: {
					userId: USER_ID,
					elementId: ELEMENT_ID,
					ai1Result: {
						not: null
					}
				},
				orderBy: [
					{
						stars: 'desc'
					},
					{
						createdAt: 'desc'
					}
				]
			});
		});

		it.each(['\n', '<br>'])(
			'should normalize ai1 value "%s" to an empty string',
			async (ai1) => {
				const progress = {
					id: 'progress-123',
					userId: USER_ID,
					elementId: ELEMENT_ID,
					ai1
				};

				mocks.prisma.userProgress.findFirst.mockResolvedValue(progress);

				const response = await callPost({
					action: 'getUserProgressElementStar',
					data
				});

				expect(await response.json()).toEqual({
					success: true,
					userProgress: {
						...progress,
						ai1: ''
					}
				});
			}
		);

		it('should return the progress record with its original ai1 value', async () => {
			const progress = {
				id: 'progress-123',
				userId: USER_ID,
				elementId: ELEMENT_ID,
				ai1: 'Saved answer',
				stars: 5
			};

			mocks.prisma.userProgress.findFirst.mockResolvedValue(progress);

			const response = await callPost({
				action: 'getUserProgressElementStar',
				data
			});

			expect(await response.json()).toEqual({
				success: true,
				userProgress: progress
			});
		});
	});

	// -------------------------------------------------------
	// Action: getLessonStars
	// -------------------------------------------------------

	describe('action: getLessonStars', () => {
		it('should return the number of stars for a lesson', async () => {
			const expectedStars = 8;

			mocks.countLessonStars.mockResolvedValue(expectedStars);

			const response = await callPost({
				action: 'getLessonStars',
				data: {
					userId: USER_ID,
					lessonId: LESSON_ID
				}
			});

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				success: true,
				stars: expectedStars
			});

			expect(mocks.countLessonStars).toHaveBeenCalledWith(
				USER_ID,
				LESSON_ID
			);

			expect(mocks.prisma.userProgress.findFirst).not.toHaveBeenCalled();
			expect(mocks.prisma.userProgress.create).not.toHaveBeenCalled();
		});

		it('should return zero stars when the lesson has no stars', async () => {
			mocks.countLessonStars.mockResolvedValue(0);

			const response = await callPost({
				action: 'getLessonStars',
				data: {
					userId: USER_ID,
					lessonId: LESSON_ID
				}
			});

			expect(await response.json()).toEqual({
				success: true,
				stars: 0
			});
		});
	});
});
