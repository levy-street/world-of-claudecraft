import { describe, expect, it } from 'vitest';
import {
  buildGeneralChatRateLimitRemoval,
  buildGeneralChatRateLimitUpdate,
} from '../../src/admin/general_chat_rate_limit';
import { localizeAdminError, setAdminLanguage, t } from '../../src/admin/i18n';

describe('General chat rate limit request builders', () => {
  it('builds a scoped update with trimmed values and moderation reason', () => {
    const built = buildGeneralChatRateLimitUpdate(42, ' 5 ', ' 2 ', '  repeated spam  ');

    expect(built).toEqual({
      pending: expect.objectContaining({
        endpoint: '/admin/api/accounts/42/general-chat-rate-limit',
        body: {
          rateLimit: { messages: 5, windowMinutes: 2 },
          reason: 'repeated spam',
        },
      }),
    });
  });

  it.each([
    ['0', '1', 'messages'],
    ['-1', '1', 'messages'],
    ['1.5', '1', 'messages'],
    ['1001', '1', 'messages'],
    ['1', '0', 'windowMinutes'],
    ['1', '2.5', 'windowMinutes'],
    ['1', '1441', 'windowMinutes'],
  ])(
    'rejects values outside the server integer bounds (%s, %s)',
    (messages, windowMinutes, field) => {
      const built = buildGeneralChatRateLimitUpdate(42, messages, windowMinutes, 'reviewed');

      expect(built).toEqual({
        errors: expect.objectContaining({
          [field]:
            field === 'messages'
              ? 'generalChatRateLimit.messagesError'
              : 'generalChatRateLimit.windowMinutesError',
        }),
      });
    },
  );

  it('requires a reason for updates and removals', () => {
    expect(buildGeneralChatRateLimitUpdate(42, '5', '2', '   ')).toEqual({
      errors: { reason: 'generalChatRateLimit.reasonRequired' },
    });
    expect(buildGeneralChatRateLimitRemoval(42, '')).toEqual({
      errors: { reason: 'generalChatRateLimit.reasonRequired' },
    });
  });

  it('rejects a reason longer than the server cap', () => {
    const tooLong = 'x'.repeat(501);
    expect(buildGeneralChatRateLimitUpdate(42, '5', '2', tooLong)).toEqual({
      errors: { reason: 'generalChatRateLimit.reasonTooLong' },
    });
    expect(buildGeneralChatRateLimitRemoval(42, tooLong)).toEqual({
      errors: { reason: 'generalChatRateLimit.reasonTooLong' },
    });
  });

  it('builds removal as an explicit null override', () => {
    const built = buildGeneralChatRateLimitRemoval(42, '  no longer needed  ');

    expect(built).toEqual({
      pending: expect.objectContaining({
        endpoint: '/admin/api/accounts/42/general-chat-rate-limit',
        body: { rateLimit: null, reason: 'no longer needed' },
      }),
    });
  });

  it('formats client and server bounds with the operator locale', () => {
    setAdminLanguage('de_DE');
    expect(localizeAdminError('messages must be an integer from 1 to 1000')).toContain('1.000');
    expect(localizeAdminError('windowMinutes must be an integer from 1 to 1440')).toContain(
      '1.440',
    );
    expect(localizeAdminError('a moderation reason is required (500 chars max)')).toContain('500');
    expect(t('error.generalChatRateLimitReasonInvalid', { max: 'formatted-limit' })).toContain(
      'formatted-limit',
    );
    setAdminLanguage('en');
  });
});
