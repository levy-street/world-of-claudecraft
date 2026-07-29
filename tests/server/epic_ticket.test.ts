// Pure Epic link-proof helpers (server/epic/ticket.ts): shape clamp, request
// builders with pinned host/path/grant literals, success verdict parse, and
// non-2xx error classification. No network, no module mocks.
import { describe, expect, it } from 'vitest';

import {
  buildExchangeCodeTokenRequest,
  classifyTokenErrorStatus,
  EPIC_TOKEN_HOST,
  EPIC_TOKEN_PATH,
  EPIC_TOKEN_URL,
  EXCHANGE_CODE_GRANT,
  isProofShape,
  MAX_PROOF_CHARS,
  MIN_PROOF_CHARS,
  parseExchangeCodeTokenResponse,
} from '../../server/epic/ticket';

const EPIC_ACCOUNT_ID = 'a1b2c3d4e5f60718';

describe('isProofShape', () => {
  it('accepts OAuth-safe strings inside the clamp', () => {
    expect(isProofShape('abcdefgh')).toBe(true);
    expect(isProofShape('ExchangeCode.with-plus+and/eq=')).toBe(true);
    expect(isProofShape('a'.repeat(MIN_PROOF_CHARS))).toBe(true);
    expect(isProofShape('a'.repeat(MAX_PROOF_CHARS))).toBe(true);
  });

  it('rejects empty, short, long, non-string, and illegal charset', () => {
    expect(isProofShape('')).toBe(false);
    expect(isProofShape('short')).toBe(false);
    expect(isProofShape('a'.repeat(MAX_PROOF_CHARS + 1))).toBe(false);
    expect(isProofShape(null)).toBe(false);
    expect(isProofShape(12)).toBe(false);
    expect(isProofShape('has space')).toBe(false);
    expect(isProofShape('bad!chars')).toBe(false);
  });

  it('pins the clamp literals so a silent shrink stays red', () => {
    expect(MIN_PROOF_CHARS).toBe(8);
    expect(MAX_PROOF_CHARS).toBe(16_384);
  });
});

describe('buildExchangeCodeTokenRequest', () => {
  it('pins the official token host, path, grant type, and form fields', () => {
    expect(EPIC_TOKEN_HOST).toBe('https://api.epicgames.dev');
    expect(EPIC_TOKEN_PATH).toBe('/epic/oauth/v2/token');
    expect(EPIC_TOKEN_URL).toBe('https://api.epicgames.dev/epic/oauth/v2/token');
    expect(EXCHANGE_CODE_GRANT).toBe('exchange_code');

    const { url, body, headers } = buildExchangeCodeTokenRequest({
      clientId: 'CID',
      clientSecret: 'CSEC',
      deploymentId: 'DEP',
      exchangeCode: 'EXCODE01',
    });
    expect(url).toBe(EPIC_TOKEN_URL);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(body.get('grant_type')).toBe('exchange_code');
    expect(body.get('exchange_code')).toBe('EXCODE01');
    expect(body.get('deployment_id')).toBe('DEP');
    expect(body.get('client_id')).toBe('CID');
    expect(body.get('client_secret')).toBe('CSEC');
  });
});

describe('parseExchangeCodeTokenResponse', () => {
  it('extracts account_id on a well-formed success body', () => {
    expect(
      parseExchangeCodeTokenResponse({
        access_token: 'eg1~token',
        expires_in: 7200,
        token_type: 'bearer',
        account_id: EPIC_ACCOUNT_ID,
        client_id: 'CID',
      }),
    ).toEqual({ kind: 'ok', epicAccountId: EPIC_ACCOUNT_ID });
  });

  it('never trusts a client-supplied field other than account_id', () => {
    // If a hostile body invents steam-style fields, only account_id matters.
    expect(
      parseExchangeCodeTokenResponse({
        steamid: '76561198000000001',
        epicAccountId: 'spoofed',
        account_id: EPIC_ACCOUNT_ID,
      }),
    ).toEqual({ kind: 'ok', epicAccountId: EPIC_ACCOUNT_ID });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['no account_id', { access_token: 'x' }],
    ['numeric account_id', { account_id: 12345678 }],
    ['empty account_id', { account_id: '' }],
    ['too short', { account_id: 'abc' }],
    ['whitespace id', { account_id: 'bad id value' }],
  ])('reads %s as malformed', (_name, body) => {
    expect(parseExchangeCodeTokenResponse(body)).toEqual({ kind: 'malformed' });
  });
});

describe('classifyTokenErrorStatus', () => {
  it('maps grant rejections to invalid', () => {
    expect(classifyTokenErrorStatus(400, { error: 'invalid_grant' })).toBe('invalid');
    expect(classifyTokenErrorStatus(400, { error: 'invalid_request' })).toBe('invalid');
    expect(classifyTokenErrorStatus(401, { error: 'invalid_token' })).toBe('invalid');
    expect(classifyTokenErrorStatus(400, { error: 'unsupported_grant_type' })).toBe('invalid');
  });

  it('maps account block / access denied to banned', () => {
    expect(classifyTokenErrorStatus(403, { error: 'access_denied' })).toBe('banned');
    expect(classifyTokenErrorStatus(403, { error: 'account_restricted' })).toBe('banned');
    expect(classifyTokenErrorStatus(403, {})).toBe('banned');
  });

  it('maps client-credential faults and 5xx to upstream', () => {
    expect(classifyTokenErrorStatus(401, { error: 'invalid_client' })).toBe('upstream');
    expect(classifyTokenErrorStatus(401, { error: 'unauthorized_client' })).toBe('upstream');
    expect(classifyTokenErrorStatus(503, { error: 'server_error' })).toBe('upstream');
    expect(classifyTokenErrorStatus(200, { error: 'ignored' })).toBe('upstream');
  });
});
