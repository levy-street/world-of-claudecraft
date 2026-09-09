// The tool-effect result chat-line model: maps a text-free toolEffectResult
// event (a charm slotted into a gathering tool, or a recharge paid for) to the
// hudChrome key the HUD renders, the values that key interpolates, and the
// professions log tone it speaks in. Extracted from Hud.handleEvents (the
// Masterwrought Phase 18 sweep, the craft_denial_line_view.ts precedent) so
// every arm is table-tested instead of riding an untestable ternary inside the
// coordinator; hud.ts stays a thin caller that resolves the NAMES (the effect
// and profession names from their ids, the material as a clickable item link,
// the count through formatNumber) and logs the line.
//
// ONE chat line either way (the trainResult single-surface rule: no toast, no
// extra sound cue), so the model is one line, never a list.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { SimEvent } from '../../../sim/types';
import type { TranslationKey } from '../../i18n';
import { PROF_LOG_DENY, PROF_LOG_GRANT } from './profession_log_tones';

type ToolEffectResultEvent = Extract<SimEvent, { type: 'toolEffectResult' }>;
export type ToolEffectDenyReason = NonNullable<ToolEffectResultEvent['reason']>;

/** The resolved names the caller supplies; the model only decides which of
 *  them a line interpolates. `material` is already the clickable item token
 *  (or '' when the event carried no material), `count` already formatted. */
export interface ToolEffectResultNames {
  effect: string;
  profession: string;
  material: string;
  count: string;
}

export interface ToolEffectResultLine {
  key: TranslationKey;
  params: Record<string, string>;
  /** PROF_LOG_GRANT on success, PROF_LOG_DENY on a refusal. */
  tone: string;
}

const SLOT_INVALID: TranslationKey = 'hudChrome.professions.toolEffectSlotInvalid';

/** Every deny reason's key, as an EXHAUSTIVE Record (the craft_denial_line_view
 *  shape): a reason added to the wire union fails tsc HERE until it gets a
 *  line, where the old ternary chain silently rendered the slot-invalid
 *  fall-through. 'throttled' is the old-server wire reason (retired emit): it
 *  renders the busy copy, never the wrong slot-invalid line. */
// Exported for the membership pin in tests/tool_effect_result_view.test.ts,
// which hand-writes every reason's key and asserts the list covers the WHOLE
// union. Runtime callers keep using toolEffectResultLine below.
export const TOOL_EFFECT_DENY_KEY_BY_REASON: Record<ToolEffectDenyReason, TranslationKey> = {
  invalid_request: SLOT_INVALID,
  no_tool: 'hudChrome.professions.toolEffectNoTool',
  no_charm: 'hudChrome.professions.toolEffectNoCharm',
  no_gain: 'hudChrome.professions.toolEffectNoGain',
  no_slot: 'hudChrome.professions.toolEffectRechargeNoSlot',
  already_full: 'hudChrome.professions.toolEffectRechargeFull',
  tool_capped: 'hudChrome.professions.toolEffectRechargeToolCapped',
  insufficient_materials: 'hudChrome.professions.toolEffectRechargeMaterials',
  busy: 'hudChrome.crafting.busy',
  throttled: 'hudChrome.crafting.busy',
};

/** Which of the resolved names each line interpolates, keyed by the line, so
 *  a key's placeholder set is spelled once and the params never carry a value
 *  the copy has no slot for. */
const PARAMS_BY_KEY: Record<string, readonly (keyof ToolEffectResultNames)[]> = {
  'hudChrome.professions.toolEffectSlotted': ['effect', 'profession'],
  'hudChrome.professions.toolEffectRecharged': ['effect', 'material', 'count'],
  'hudChrome.professions.toolEffectNoTool': ['profession'],
  'hudChrome.professions.toolEffectNoCharm': ['effect'],
  'hudChrome.professions.toolEffectNoGain': ['effect'],
  'hudChrome.professions.toolEffectRechargeNoSlot': ['profession'],
  'hudChrome.professions.toolEffectRechargeFull': ['effect'],
  'hudChrome.professions.toolEffectRechargeToolCapped': ['effect', 'profession'],
  'hudChrome.professions.toolEffectRechargeMaterials': ['effect', 'material', 'count'],
  'hudChrome.crafting.busy': [],
  [SLOT_INVALID]: ['effect'],
};

function paramsFor(key: TranslationKey, names: ToolEffectResultNames): Record<string, string> {
  const params: Record<string, string> = {};
  for (const field of PARAMS_BY_KEY[key] ?? []) params[field] = names[field];
  return params;
}

/** The chat-line model for one toolEffectResult. An absent reason on a
 *  refusal, or a reason off the vocabulary (a newer deploy widened the wire;
 *  the R34 enum axis), reads as the slot-invalid line, the historical
 *  fall-through, rather than throwing on an undefined key. */
export function toolEffectResultLine(
  ev: Pick<ToolEffectResultEvent, 'action' | 'ok' | 'reason'>,
  names: ToolEffectResultNames,
): ToolEffectResultLine {
  if (ev.ok) {
    const key: TranslationKey =
      ev.action === 'slot'
        ? 'hudChrome.professions.toolEffectSlotted'
        : 'hudChrome.professions.toolEffectRecharged';
    return { key, params: paramsFor(key, names), tone: PROF_LOG_GRANT };
  }
  const byReason: Partial<Record<string, TranslationKey>> = TOOL_EFFECT_DENY_KEY_BY_REASON;
  const key = (ev.reason !== undefined ? byReason[ev.reason] : undefined) ?? SLOT_INVALID;
  return { key, params: paramsFor(key, names), tone: PROF_LOG_DENY };
}
