import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  env: {
    MAIL_HOST: 'mail.example.test',
    MAIL_PORT: '587',
    MAIL_USER: 'mailer@example.test',
    MAIL_PW: 'test-password',
    MAIL_FROM: 'noreply@example.test'
  } as Record<string, string | undefined>
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport }
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));

import { isSingleEmailAddress, sendMail } from './email';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ accepted: ['recipient@example.test'] });
});

describe('isSingleEmailAddress', () => {
  it.each([
    'person@example.test',
    'first.last+tag@sub.example.at',
    "o'hara@example.com"
  ])('accepts a valid single address: %s', (address) => {
    expect(isSingleEmailAddress(address)).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    '',
    'person @example.test',
    '"Person" <person@example.test>',
    'person@example.test, other@example.test',
    'person@example',
    'a'.repeat(255)
  ])('rejects an invalid or unsafe value: %j', (address) => {
    expect(isSingleEmailAddress(address)).toBe(false);
  });
});

describe('sendMail', () => {
  it('rejects an invalid recipient before creating a transporter', async () => {
    await expect(sendMail('Person <person@example.test>', 'Subject', 'Text')).rejects.toThrow(
      'Ungültiger Mail-Empfänger.'
    );

    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('creates the SMTP transporter with the configured credentials', async () => {
    await sendMail('person@example.test', 'Subject', 'Mail text');

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: 'mail.example.test',
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

  it('sends the plain-text mail with one recipient and the configured sender', async () => {
    await sendMail('person@example.test', 'Password reset', 'Your reset link');

    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.test',
      to: { name: '', address: 'person@example.test' },
      envelope: { from: 'noreply@example.test', to: ['person@example.test'] },
      subject: 'Password reset',
      text: 'Your reset link'
    });
  });

  it('propagates transporter send failures', async () => {
    const sendError = new Error('SMTP unavailable');
    mocks.sendMail.mockRejectedValue(sendError);

    await expect(sendMail('person@example.test', 'Subject', 'Text')).rejects.toBe(sendError);
  });
});
