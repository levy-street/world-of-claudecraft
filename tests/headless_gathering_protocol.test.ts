// Intentional Gathering (PR3), headless supplement: the PURE parsing half of
// the optional `gathering` wire protocol (docs/prd/intentional-gathering/
// headless-gathering-contract.md). This file pins ONLY
// `headless/gathering_protocol.ts`'s two exports:
//
//   GATHERING_CAPABILITY: the exact { version, verbs } shape the `info` reply
//   advertises.
//   parseGatheringRequest(raw): a STRICT, CLOSED-SHAPE parse of one raw
//   incoming line into exactly one of the four contract requests. Success is
//   frozen as `{ ok: true, request }` where `request` is the exact original
//   request shape (no reshaping, renaming or added defaults); failure is
//   frozen as `{ ok: false, reason: 'invalid_request' }`.
//
// Deliberately NOT covered here: dispatch, Sim state, reset gating, or the
// real-vendor / real-corpse refusal reasons (`purchase_refused`,
// `harvest_refused`) - those live in tests/headless_gathering_commands.test.ts
// against the real Sim. `parseGatheringRequest` never sees a Sim, but it is
// NOT a bare syntax gate over `set_preference`: it runs the preference token
// through the canonical `parseHarvestPreferenceCommand`
// (src/sim/professions/harvest_preference.ts), the same parser the sim's own
// load path uses, which checks the token against the real supported-material
// set. A lowercase snake_case token naming no real material is therefore
// `invalid_request` at PARSE time, never a well-formed request the dispatcher
// later refuses (see the "unsupported preference token" case below).

import { describe, expect, it } from 'vitest';
import { GATHERING_CAPABILITY, parseGatheringRequest } from '../headless/gathering_protocol';

const VALID_INSPECT = { cmd: 'gathering', verb: 'inspect' } as const;
const VALID_BUY = { cmd: 'gathering', verb: 'buy_field_kit', npcId: 42 } as const;
const VALID_SET_PREF = {
  cmd: 'gathering',
  verb: 'set_preference',
  preference: 'rough_hide',
} as const;
const VALID_HARVEST = { cmd: 'gathering', verb: 'harvest', corpseId: 7 } as const;

describe('GATHERING_CAPABILITY: the exact info-reply advertisement', () => {
  it('advertises version 1 and exactly the four contract verbs, in the contract order', () => {
    expect(GATHERING_CAPABILITY).toEqual({
      version: 1,
      verbs: ['inspect', 'buy_field_kit', 'set_preference', 'harvest'],
    });
  });
});

describe('parseGatheringRequest: the four exact valid shapes', () => {
  it('accepts { cmd, verb: inspect } verbatim, with no extra keys added', () => {
    const result = parseGatheringRequest(VALID_INSPECT);
    expect(result).toEqual({ ok: true, request: VALID_INSPECT });
  });

  it('accepts { cmd, verb: buy_field_kit, npcId } verbatim', () => {
    const result = parseGatheringRequest(VALID_BUY);
    expect(result).toEqual({ ok: true, request: VALID_BUY });
  });

  it('accepts { cmd, verb: set_preference, preference } verbatim, material token', () => {
    const result = parseGatheringRequest(VALID_SET_PREF);
    expect(result).toEqual({ ok: true, request: VALID_SET_PREF });
  });

  it('accepts { cmd, verb: set_preference, preference: "all" } verbatim, the All token', () => {
    const raw = { cmd: 'gathering', verb: 'set_preference', preference: 'all' };
    expect(parseGatheringRequest(raw)).toEqual({ ok: true, request: raw });
  });

  it('accepts { cmd, verb: harvest, corpseId } verbatim', () => {
    const result = parseGatheringRequest(VALID_HARVEST);
    expect(result).toEqual({ ok: true, request: VALID_HARVEST });
  });

  it('does not alias the caller-supplied object: mutating the input after parsing never changes the frozen result', () => {
    const raw = { cmd: 'gathering', verb: 'buy_field_kit', npcId: 5 };
    const result = parseGatheringRequest(raw);
    expect(result.ok).toBe(true);
    const before = result.ok ? { ...result.request } : null;
    (raw as { npcId: number }).npcId = 999;
    expect(result.ok ? result.request : null).toEqual(before);
  });
});

describe('parseGatheringRequest: closed-shape rejection (unknown/extra keys)', () => {
  it('rejects an inspect request carrying any extra key', () => {
    expect(parseGatheringRequest({ ...VALID_INSPECT, extra: 1 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects buy_field_kit missing npcId', () => {
    expect(parseGatheringRequest({ cmd: 'gathering', verb: 'buy_field_kit' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects buy_field_kit carrying an item or count override (no arbitrary grant/purchase)', () => {
    for (const extra of [{ itemId: 'field_kit' }, { count: 2 }, { quantity: 5 }, { pid: 1 }]) {
      expect(parseGatheringRequest({ ...VALID_BUY, ...extra })).toEqual({
        ok: false,
        reason: 'invalid_request',
      });
    }
  });

  it('rejects set_preference missing preference', () => {
    expect(parseGatheringRequest({ cmd: 'gathering', verb: 'set_preference' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects set_preference carrying an extra key', () => {
    expect(parseGatheringRequest({ ...VALID_SET_PREF, actorId: 1 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects harvest missing corpseId', () => {
    expect(parseGatheringRequest({ cmd: 'gathering', verb: 'harvest' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects harvest carrying an extra key (no actor override)', () => {
    expect(parseGatheringRequest({ ...VALID_HARVEST, pid: 1 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });
});

describe('parseGatheringRequest: structural rejection', () => {
  // Every case list below is wrapped one level (`.map((v) => [v])`) before
  // reaching it.each: vitest/jest spread a table row that is ITSELF an array
  // into positional arguments, which would silently swallow the `[]` and
  // `['gathering', 'inspect']` cases (and the `[]`/`{}` entries inside
  // badIds/malformedPreferences further below) instead of passing them
  // through as the single `raw` argument.
  const nonObjectRaws = [null, undefined, 5, 'gathering', true, Number.NaN];
  it.each(nonObjectRaws.map((v) => [v]))('rejects a non-object raw value: %p', (raw) => {
    expect(parseGatheringRequest(raw)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  const arrayRaws = [[], ['gathering', 'inspect'], [{ cmd: 'gathering', verb: 'inspect' }]];
  it.each(arrayRaws.map((v) => [v]))('rejects an array raw value: %p', (raw) => {
    expect(parseGatheringRequest(raw)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('rejects a non-plain-record raw value (a Date instance)', () => {
    expect(parseGatheringRequest(new Date())).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('rejects the wrong cmd', () => {
    expect(parseGatheringRequest({ cmd: 'step', verb: 'inspect' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects a missing verb', () => {
    expect(parseGatheringRequest({ cmd: 'gathering' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects an unknown verb', () => {
    expect(parseGatheringRequest({ cmd: 'gathering', verb: 'sell_field_kit' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });
});

describe('parseGatheringRequest: unsafe npcId / corpseId', () => {
  const badIds = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '5',
    true,
    null,
    undefined,
    [],
    {},
  ];

  it.each(badIds.map((v) => [v]))('rejects buy_field_kit with an unsafe npcId: %p', (npcId) => {
    expect(parseGatheringRequest({ cmd: 'gathering', verb: 'buy_field_kit', npcId })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it.each(badIds.map((v) => [v]))('rejects harvest with an unsafe corpseId: %p', (corpseId) => {
    expect(parseGatheringRequest({ cmd: 'gathering', verb: 'harvest', corpseId })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('accepts the largest safe positive integer id', () => {
    const raw = { cmd: 'gathering', verb: 'harvest', corpseId: Number.MAX_SAFE_INTEGER };
    expect(parseGatheringRequest(raw)).toEqual({ ok: true, request: raw });
  });
});

describe('parseGatheringRequest: malformed preference tokens (parser-level rejection)', () => {
  const malformedPreferences = [
    5,
    true,
    null,
    undefined,
    {},
    [],
    '', // empty
    'Rough_Hide', // uppercase: not the canonical lowercase item-id shape
    'rough hide', // embedded space
    'rough\nhide', // control character
    'x'.repeat(200), // absurdly long, well past any real item id
  ];

  it.each(malformedPreferences.map((v) => [v]))(
    'rejects verb set_preference with a malformed token: %p',
    (preference) => {
      expect(
        parseGatheringRequest({ cmd: 'gathering', verb: 'set_preference', preference }),
      ).toEqual({ ok: false, reason: 'invalid_request' });
    },
  );
});

describe('parseGatheringRequest: an unsupported preference token rejects at parse time', () => {
  // The token is syntactically fine (lowercase snake_case, bounded length)
  // but names no real material in HARVEST_COMPONENT_ITEMS, so the canonical
  // parseHarvestPreferenceCommand returns `unsupported`, and
  // parseGatheringRequest folds that into invalid_request exactly like a
  // malformed token: it never reaches the dispatcher as a well-formed
  // request.
  it('rejects a lowercase snake_case token naming no real material as invalid_request', () => {
    const raw = { cmd: 'gathering', verb: 'set_preference', preference: 'not_a_real_material' };
    expect(parseGatheringRequest(raw)).toEqual({ ok: false, reason: 'invalid_request' });
  });
});
