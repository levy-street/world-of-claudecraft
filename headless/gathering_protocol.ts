// Pure parsing for the optional headless `{cmd:'gathering', verb:...}` request
// family (Intentional Gathering PR3). Frozen contract:
// docs/prd/intentional-gathering/headless-gathering-contract.md
//
// Strict plain-record, exact-key validation: arrays, non-plain records,
// unknown/extra keys, unsafe ids and unsupported preference tokens all refuse.
// The `set_preference` token runs through the canonical
// `parseHarvestPreferenceCommand` (the same parser the sim's own load path
// uses), never a bespoke regex or syntax.

import { parseHarvestPreferenceCommand } from '../src/sim/professions/harvest_preference';

export type GatheringVerb = 'inspect' | 'buy_field_kit' | 'set_preference' | 'harvest';

const GATHERING_VERBS: readonly GatheringVerb[] = [
  'inspect',
  'buy_field_kit',
  'set_preference',
  'harvest',
];

/** Advertised in the `info` reply so a client can discover the family without
 *  hardcoding it. */
export const GATHERING_CAPABILITY = Object.freeze({
  version: 1 as const,
  verbs: GATHERING_VERBS,
});

export type GatheringRequest =
  | { readonly cmd: 'gathering'; readonly verb: 'inspect' }
  | { readonly cmd: 'gathering'; readonly verb: 'buy_field_kit'; readonly npcId: number }
  | { readonly cmd: 'gathering'; readonly verb: 'set_preference'; readonly preference: string }
  | { readonly cmd: 'gathering'; readonly verb: 'harvest'; readonly corpseId: number };

export type GatheringParseResult =
  | { readonly ok: true; readonly request: GatheringRequest }
  | { readonly ok: false; readonly reason: 'invalid_request' };

const INVALID: GatheringParseResult = { ok: false, reason: 'invalid_request' };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const recordKeys = Object.keys(record);
  return recordKeys.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

export function parseGatheringRequest(raw: unknown): GatheringParseResult {
  if (!isPlainRecord(raw)) return INVALID;
  if (raw.cmd !== 'gathering' || typeof raw.verb !== 'string') return INVALID;

  switch (raw.verb) {
    case 'inspect':
      if (!hasExactKeys(raw, ['cmd', 'verb'])) return INVALID;
      return { ok: true, request: { cmd: 'gathering', verb: 'inspect' } };

    case 'buy_field_kit':
      if (!hasExactKeys(raw, ['cmd', 'verb', 'npcId'])) return INVALID;
      if (!isPositiveSafeInteger(raw.npcId)) return INVALID;
      return { ok: true, request: { cmd: 'gathering', verb: 'buy_field_kit', npcId: raw.npcId } };

    case 'set_preference': {
      if (!hasExactKeys(raw, ['cmd', 'verb', 'preference'])) return INVALID;
      const command = parseHarvestPreferenceCommand(raw.preference);
      if (!command.ok || typeof raw.preference !== 'string') return INVALID;
      return {
        ok: true,
        request: { cmd: 'gathering', verb: 'set_preference', preference: raw.preference },
      };
    }

    case 'harvest':
      if (!hasExactKeys(raw, ['cmd', 'verb', 'corpseId'])) return INVALID;
      if (!isPositiveSafeInteger(raw.corpseId)) return INVALID;
      return { ok: true, request: { cmd: 'gathering', verb: 'harvest', corpseId: raw.corpseId } };

    default:
      return INVALID;
  }
}
