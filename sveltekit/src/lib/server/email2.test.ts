
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mocks before module mocking because vi.mock is hoisted.
const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn()
}));

// Mock Nodemailer.
vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock
  }
}));

// Mock SvelteKit private environment variables.
vi.mock('$env/dynamic/private', () => ({
  env: {
    MAIL_HOST: 'smtp.example.test',
    MAIL_PORT: '587',
    MAIL_USER: 'mailer@example.test',
    MAIL_PW: 'test-password',
    MAIL_FROM: 'noreply@example.test'
  }
}));

import { isSingleEmailAddress, sendMail } from './email';


describe('isSingleEmailAddress', () => {

  describe('valid email addresses', () => {
    it.each([
      'alice@example.com',
      'first.last@example.com',
      'alice+newsletter@example.com',
      'alice@example.co.uk',
      'user123@sub.example.com',
      'a@b.co'
    ])('accepts valid email address: %s', (email) => {
      expect(isSingleEmailAddress(email)).toBe(true);
    });

    it('accepts an email address with a 64-character local part', () => {
      const email = `${'a'.repeat(64)}@example.com`;

      expect(isSingleEmailAddress(email)).toBe(true);
    });

    it('accepts an email address with exactly 254 characters', () => {
      const email =
        `${'a'.repeat(64)}@` +
        `${'b'.repeat(63)}.` +
        `${'c'.repeat(63)}.` +
        `${'d'.repeat(57)}.com`;

      expect(email.length).toBe(254);
      expect(isSingleEmailAddress(email)).toBe(true);
    });
  });


  describe('invalid email addresses', () => {
    it.each([
      '',
      'alice',
      'alice@',
      '@example.com',
      'alice@example',
      'alice@example.c',
      'alice smith@example.com',
      ' alice@example.com',
      'alice@example.com ',
      'Alice <alice@example.com>',
      'alice@example.com,bob@example.com',
      'alice@example.com;bob@example.com',
      '"alice"@example.com',
      'alice(comment)@example.com',
      'alice@example.com\n'
    ])('rejects invalid email address: %s', (email) => {
      expect(isSingleEmailAddress(email)).toBe(false);
    });

    it('rejects a local part longer than 64 characters', () => {
      const email = `${'a'.repeat(65)}@example.com`;

      expect(isSingleEmailAddress(email)).toBe(false);
    });

    it('rejects an email address longer than 254 characters', () => {
      const email =
        `${'a'.repeat(64)}@` +
        `${'b'.repeat(63)}.` +
        `${'c'.repeat(63)}.` +
        `${'d'.repeat(58)}.com`;

      expect(email.length).toBe(255);
      expect(isSingleEmailAddress(email)).toBe(false);
    });
  });


  describe('input type validation', () => {
    it.each([
      null,
      undefined,
      123,
      {},
      [],
      true
    ])('rejects non-string input: %s', (value) => {
      expect(isSingleEmailAddress(value)).toBe(false);
    });
  });

});


describe('sendMail', () => {

  beforeEach(() => {
    vi.resetAllMocks();

    // Configure the mocked Nodemailer transporter.
    createTransportMock.mockReturnValue({
      sendMail: sendMailMock
    });

    sendMailMock.mockResolvedValue(undefined);
  });


  it('creates a Nodemailer transporter with the correct configuration', async () => {
    await sendMail(
      'alice@example.com',
      'Test subject',
      'Test message'
    );

    expect(createTransportMock).toHaveBeenCalledOnce();

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: {
        user: 'mailer@example.test',
        pass: 'test-password'
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  });


  it('sends an email with the correct message configuration', async () => {
    await sendMail(
      'alice@example.com',
      'Welcome!',
      'Hello Alice!'
    );

    expect(sendMailMock).toHaveBeenCalledOnce();

    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@example.test',
      to: {
        name: '',
        address: 'alice@example.com'
      },
      envelope: {
        from: 'noreply@example.test',
        to: ['alice@example.com']
      },
      subject: 'Welcome!',
      text: 'Hello Alice!'
    });
  });


  it('rejects an invalid recipient address', async () => {
    await expect(
      sendMail(
        'invalid-email',
        'Test subject',
        'Test message'
      )
    ).rejects.toThrow('Ungültiger Mail-Empfänger.');

    // Nodemailer must not be initialized for an invalid recipient.
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });


  it('does not send an email when the recipient is an address list', async () => {
    await expect(
      sendMail(
        'alice@example.com,bob@example.com',
        'Test subject',
        'Test message'
      )
    ).rejects.toThrow('Ungültiger Mail-Empfänger.');

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });


  it('propagates SMTP errors to the caller', async () => {
    const smtpError = new Error('SMTP connection failed');

    sendMailMock.mockRejectedValueOnce(smtpError);

    await expect(
      sendMail(
        'alice@example.com',
        'Test subject',
        'Test message'
      )
    ).rejects.toBe(smtpError);

    expect(sendMailMock).toHaveBeenCalledOnce();
  });


  it('resolves successfully when Nodemailer sends the email', async () => {
    await expect(
      sendMail(
        'alice@example.com',
        'Test subject',
        'Test message'
      )
    ).resolves.toBeUndefined();
  });

});
