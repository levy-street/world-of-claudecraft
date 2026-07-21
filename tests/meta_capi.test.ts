import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  buildCapiPayload,
  hashedMetaValue,
  metaCookieData,
  metaEventSourceUrl,
} from '../server/meta_capi';

const req = (headers: Record<string, string | string[]>): IncomingMessage =>
  ({ headers }) as IncomingMessage;

describe('Meta Conversions API helpers', () => {
  it('normalizes and hashes PII fields', () => {
    expect(hashedMetaValue('  Player@Example.COM ')).toBe(
      '46b06dcd1ce7d8bdf29ce2677575bd21fd7b3879416d5b810dcc78b77e932b02',
    );
  });

  it('extracts Meta browser cookies without hashing them', () => {
    expect(metaCookieData('_fbp=fb.1.123.abc; theme=dark; _fbc=fb.1.456.def')).toEqual({
      fbp: 'fb.1.123.abc',
      fbc: 'fb.1.456.def',
    });
  });

  it('prefers referer, then origin, then forwarded host for source URL', () => {
    expect(
      metaEventSourceUrl(
        req({
          referer: 'https://worldofclaudecraft.com/play',
          origin: 'https://worldofclaudecraft.com',
        }),
      ),
    ).toBe('https://worldofclaudecraft.com/play');
    expect(metaEventSourceUrl(req({ origin: 'https://worldofclaudecraft.com' }))).toBe(
      'https://worldofclaudecraft.com',
    );
    expect(
      metaEventSourceUrl(
        req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'play.example.com' }),
      ),
    ).toBe('https://play.example.com/');
  });

  it('builds the event payload with event id and hashed identifiers', () => {
    const payload = buildCapiPayload({
      eventName: 'AccountCreated',
      eventId: 'acct_42',
      eventTime: 123,
      eventSourceUrl: 'https://worldofclaudecraft.com/',
      userData: {
        email: 'Player@Example.COM',
        externalId: '42',
        clientIp: '203.0.113.10',
        clientUserAgent: 'TestAgent',
        fbp: 'fb.1.123.abc',
      },
    });

    expect(payload).toEqual({
      data: [
        {
          event_name: 'AccountCreated',
          event_time: 123,
          event_id: 'acct_42',
          action_source: 'website',
          event_source_url: 'https://worldofclaudecraft.com/',
          user_data: {
            em: ['46b06dcd1ce7d8bdf29ce2677575bd21fd7b3879416d5b810dcc78b77e932b02'],
            external_id: ['73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049'],
            client_ip_address: '203.0.113.10',
            client_user_agent: 'TestAgent',
            fbp: 'fb.1.123.abc',
          },
        },
      ],
    });
  });
});
