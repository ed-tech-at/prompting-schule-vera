import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

// Define mocks before the modules are imported.
const mocks = vi.hoisted(() => {
    const transaction = {
        userPasswordReset: {
            updateMany: vi.fn()
        },
        user: {
            update: vi.fn()
        }
    };

    return {
        passwordAuthDisabled: vi.fn(),
        hashPasswordV2: vi.fn(),
        login: vi.fn(),
        isPasswordResetExpired: vi.fn(),

        prisma: {
            userPasswordReset: {
                findUnique: vi.fn()
            },
            $transaction: vi.fn()
        },

        transaction
    };
});

// Mock authentication functions.
vi.mock('$lib/server/pw.js', () => ({
    passwordAuthDisabled: mocks.passwordAuthDisabled,
    hashPasswordV2: mocks.hashPasswordV2,
    login: mocks.login
}));

// Mock Prisma.
vi.mock('$lib/server/db', () => ({
    prisma: mocks.prisma
}));

// Mock password reset validation.
vi.mock('$lib/server/passwordReset', () => ({
    isPasswordResetExpired: mocks.isPasswordResetExpired
}));

type ResetEntry = {
    token: string;
    userId: string;
    finishedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    user: {
        id: string;
        email: string;
        isDeleted: boolean;
        blockedAt: Date | null;
        cryptVersion: number;
    };
};

function makeResetEntry(
    overrides: Partial<Omit<ResetEntry, 'user'>> & {
        user?: Partial<ResetEntry['user']>;
    } = {}
): ResetEntry {
    const defaultEntry: ResetEntry = {
        token: 'reset-token',
        userId: 'user-1',
        finishedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
        user: {
            id: 'user-1',
            email: 'user@example.com',
            isDeleted: false,
            blockedAt: null,
            cryptVersion: 2
        }
    };

    return {
        ...defaultEntry,
        ...overrides,
        user: {
            ...defaultEntry.user,
            ...overrides.user
        }
    };
}

function makePayload() {
    return {
        action: 'passwortReset',
        formData: {
            token: 'reset-token',
            password: 'NewPassword123!',
            userId: 'user-1'
        }
    };
}

function post(body: unknown) {
    const request = new Request(
        'http://localhost/api/passwort',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }
    );

    return POST({
        request
    } as Parameters<typeof POST>[0]);
}

describe('POST /api/passwort', () => {
    let loginResponse: Response;

    beforeEach(() => {
        vi.resetAllMocks();

        // Default authentication configuration.
        mocks.passwordAuthDisabled.mockReturnValue(false);

        // Default password hashing.
        mocks.hashPasswordV2.mockResolvedValue('hashed-password');

        // Default login response.
        loginResponse = new Response(
            JSON.stringify({ success: true }),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        mocks.login.mockResolvedValue(loginResponse);

        // Default reset token validation.
        mocks.isPasswordResetExpired.mockReturnValue(false);

        // Default valid reset entry.
        mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(
            makeResetEntry()
        );

        // Default successful token claim.
        mocks.transaction.userPasswordReset.updateMany.mockResolvedValue({
            count: 1
        });

        mocks.transaction.user.update.mockResolvedValue({
            id: 'user-1'
        });

        // Execute the supplied transaction callback.
        mocks.prisma.$transaction.mockImplementation(
            async (
                callback: (tx: typeof mocks.transaction) => Promise<unknown>
            ) => callback(mocks.transaction)
        );
    });

    // -------------------------------------------------------
    // Password authentication disabled
    // -------------------------------------------------------

    it('returns 403 when password authentication is disabled', async () => {
        mocks.passwordAuthDisabled.mockReturnValue(true);

        const response = await post(makePayload());

        expect(response?.status).toBe(403);

        expect(await response!.json()).toEqual({
            success: false,
            error: 'Passwort-Zurücksetzen ist deaktiviert.'
        });

        expect(
            mocks.prisma.userPasswordReset.findUnique
        ).not.toHaveBeenCalled();

        expect(mocks.hashPasswordV2).not.toHaveBeenCalled();
        expect(mocks.login).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------
    // Input validation
    // -------------------------------------------------------

    it.each([
        [
            'token',
            {
                password: 'NewPassword123!',
                userId: 'user-1'
            }
        ],
        [
            'password',
            {
                token: 'reset-token',
                userId: 'user-1'
            }
        ],
        [
            'userId',
            {
                token: 'reset-token',
                password: 'NewPassword123!'
            }
        ]
    ])(
        'returns 400 when %s is missing',
        async (_field, formData) => {
            const response = await post({
                action: 'passwortReset',
                formData
            });

            expect(response?.status).toBe(400);

            expect(await response!.json()).toEqual({
                success: false,
                error: 'Token und neues Passwort sind erforderlich.'
            });

            expect(
                mocks.prisma.userPasswordReset.findUnique
            ).not.toHaveBeenCalled();

            expect(mocks.hashPasswordV2).not.toHaveBeenCalled();
        }
    );

    // -------------------------------------------------------
    // Reset token validation
    // -------------------------------------------------------

    async function expectInvalidTokenResponse() {
        const response = await post(makePayload());

        expect(response?.status).toBe(400);

        expect(await response!.json()).toEqual({
            success: false,
            error: 'Ungültiger oder abgelaufener Token.'
        });

        expect(mocks.hashPasswordV2).not.toHaveBeenCalled();
        expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
        expect(mocks.login).not.toHaveBeenCalled();
    }

    it('rejects an unknown reset token', async () => {
        mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(null);

        await expectInvalidTokenResponse();
    });

    it('rejects an already used reset token', async () => {
        mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(
            makeResetEntry({
                finishedAt: new Date()
            })
        );

        await expectInvalidTokenResponse();
    });

    it('rejects an expired reset token', async () => {
        mocks.isPasswordResetExpired.mockReturnValue(true);

        await expectInvalidTokenResponse();

        expect(mocks.isPasswordResetExpired).toHaveBeenCalled();
    });

    it('rejects a reset request belonging to a deleted user', async () => {
        mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(
            makeResetEntry({
                user: {
                    isDeleted: true
                }
            })
        );

        await expectInvalidTokenResponse();
    });

    it('rejects a reset request belonging to a blocked user', async () => {
        mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(
            makeResetEntry({
                user: {
                    blockedAt: new Date()
                }
            })
        );

        await expectInvalidTokenResponse();
    });

    it.each([0, 3, 4, -1])(
        'rejects an unsupported crypt version: %s',
        async (cryptVersion) => {
            mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(
                makeResetEntry({
                    user: {
                        cryptVersion
                    }
                })
            );

            await expectInvalidTokenResponse();
        }
    );

    // -------------------------------------------------------
    // Successful password reset
    // -------------------------------------------------------

    it.each([1, 2])(
        'successfully resets the password for crypt version %s',
        async (cryptVersion) => {
            const resetEntry = makeResetEntry({
                user: {
                    cryptVersion
                }
            });

            mocks.prisma.userPasswordReset.findUnique.mockResolvedValue(
                resetEntry
            );

            const payload = makePayload();

            const response = await post(payload);

            // The route returns the response produced by login().
            expect(response).toBe(loginResponse);

            // Verify reset entry lookup.
            expect(
                mocks.prisma.userPasswordReset.findUnique
            ).toHaveBeenCalledWith({
                where: {
                    token: 'reset-token',
                    userId: 'user-1'
                },
                include: {
                    user: true
                }
            });

            // Verify password hashing.
            expect(mocks.hashPasswordV2).toHaveBeenCalledWith(
                'NewPassword123!',
                'user-1'
            );

            // Verify transaction execution.
            expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);

            // Verify token is claimed atomically.
            expect(
                mocks.transaction.userPasswordReset.updateMany
            ).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    token: 'reset-token',
                    userId: 'user-1',
                    finishedAt: null,
                    OR: [
                        {
                            expiresAt: {
                                gt: expect.any(Date)
                            }
                        },
                        {
                            expiresAt: null,
                            createdAt: {
                                gt: expect.any(Date)
                            }
                        }
                    ]
                }),
                data: {
                    finishedAt: expect.any(Date)
                }
            });

            // Verify the user's password is updated.
            expect(
                mocks.transaction.user.update
            ).toHaveBeenCalledWith({
                where: {
                    id: 'user-1'
                },
                data: {
                    password: 'hashed-password',
                    cryptVersion: 2
                }
            });

            // Verify login is called after the password update.
            expect(mocks.login).toHaveBeenCalledWith(
                'user@example.com',
                'NewPassword123!'
            );
        }
    );

    // -------------------------------------------------------
    // Concurrent reset / token claim failure
    // -------------------------------------------------------

    it('rejects the request if the reset token cannot be claimed', async () => {
        mocks.transaction.userPasswordReset.updateMany.mockResolvedValue({
            count: 0
        });

        const response = await post(makePayload());

        expect(response?.status).toBe(400);

        expect(await response!.json()).toEqual({
            success: false,
            error: 'Ungültiger oder abgelaufener Token.'
        });

        // The password must not be updated.
        expect(
            mocks.transaction.user.update
        ).not.toHaveBeenCalled();

        // Login must not be triggered.
        expect(mocks.login).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------
    // Unexpected errors
    // -------------------------------------------------------

    it('returns 500 when password hashing fails', async () => {
        mocks.hashPasswordV2.mockRejectedValue(
            new Error('Password hashing failed')
        );

        const consoleErrorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            const response = await post(makePayload());

            expect(response?.status).toBe(500);

            expect(await response!.json()).toEqual({
                success: false,
                error: 'Ein Fehler ist aufgetreten.'
            });

            expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
            expect(mocks.login).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('returns 500 when the database lookup fails', async () => {
        mocks.prisma.userPasswordReset.findUnique.mockRejectedValue(
            new Error('Database connection failed')
        );

        const consoleErrorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            const response = await post(makePayload());

            expect(response?.status).toBe(500);

            expect(await response!.json()).toEqual({
                success: false,
                error: 'Ein Fehler ist aufgetreten.'
            });

            expect(mocks.hashPasswordV2).not.toHaveBeenCalled();
            expect(mocks.login).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    // -------------------------------------------------------
    // Unsupported action
    // -------------------------------------------------------

    it('returns 400 when an unsupported action is provided', async () => {
        const response = await post({
            action: 'unknownAction',
            formData: {}
        });

        expect(response?.status).toBe(400);
    });
});
