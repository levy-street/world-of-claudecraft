// The tool-effect result chat-line model (src/ui/hud/professions/
// tool_effect_result_view.ts): every reason's key and value set is a hand-written
// expectation here (the craft_denial_line_view suite's shape), plus the
// membership pin that the hand-written list covers the WHOLE deny-reason union,
// so a reason added with a copy-pasted wrong key cannot pass tsc-exhaustiveness
// while dodging the table.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROF_LOG_DENY, PROF_LOG_GRANT } from '../src/ui/hud/professions/profession_log_tones';
import {
  TOOL_EFFECT_DENY_KEY_BY_REASON,
  type ToolEffectDenyReason,
  toolEffectResultLine,
} from '../src/ui/hud/professions/tool_effect_result_view';
import { hasTranslation } from '../src/ui/i18n';

const NAMES = {
  effect: 'Keen Edge',
  profession: 'Mining',
  material: '[Shard]',
  count: '3',
};

describe('toolEffectResultLine', () => {
  it('a slot success names the effect and the profession in the grant tone', () => {
    expect(toolEffectResultLine({ action: 'slot', ok: true }, NAMES)).toEqual({
      key: 'hudChrome.professions.toolEffectSlotted',
      params: { effect: 'Keen Edge', profession: 'Mining' },
      tone: PROF_LOG_GRANT,
    });
  });

  it('a recharge success names the effect, the material link and the count', () => {
    expect(toolEffectResultLine({ action: 'recharge', ok: true }, NAMES)).toEqual({
      key: 'hudChrome.professions.toolEffectRecharged',
      params: { effect: 'Keen Edge', material: '[Shard]', count: '3' },
      tone: PROF_LOG_GRANT,
    });
  });

  // Every reason's line, hand-written (independent of the exported table).
  const DENIALS: [ToolEffectDenyReason, string, Record<string, string>][] = [
    ['no_tool', 'hudChrome.professions.toolEffectNoTool', { profession: 'Mining' }],
    ['no_charm', 'hudChrome.professions.toolEffectNoCharm', { effect: 'Keen Edge' }],
    ['no_gain', 'hudChrome.professions.toolEffectNoGain', { effect: 'Keen Edge' }],
    ['no_slot', 'hudChrome.professions.toolEffectRechargeNoSlot', { profession: 'Mining' }],
    ['already_full', 'hudChrome.professions.toolEffectRechargeFull', { effect: 'Keen Edge' }],
    [
      'tool_capped',
      'hudChrome.professions.toolEffectRechargeToolCapped',
      { effect: 'Keen Edge', profession: 'Mining' },
    ],
    [
      'insufficient_materials',
      'hudChrome.professions.toolEffectRechargeMaterials',
      { effect: 'Keen Edge', material: '[Shard]', count: '3' },
    ],
    ['busy', 'hudChrome.crafting.busy', {}],
    // The old-server wire reason (retired emit) renders the busy copy, never
    // the wrong slot-invalid line.
    ['throttled', 'hudChrome.crafting.busy', {}],
    ['invalid_request', 'hudChrome.professions.toolEffectSlotInvalid', { effect: 'Keen Edge' }],
  ];

  it.each(DENIALS)('denial %s renders %s with exactly its own values', (reason, key, params) => {
    expect(toolEffectResultLine({ action: 'slot', ok: false, reason }, NAMES)).toEqual({
      key,
      params,
      tone: PROF_LOG_DENY,
    });
    expect(hasTranslation(key)).toBe(true);
  });

  it('the hand-written denial list covers the WHOLE reason union', () => {
    const listed = DENIALS.map(([reason]) => reason).sort();
    expect(listed).toEqual(Object.keys(TOOL_EFFECT_DENY_KEY_BY_REASON).sort());
    // And the table agrees with the hand-written keys row for row.
    for (const [reason, key] of DENIALS) expect(TOOL_EFFECT_DENY_KEY_BY_REASON[reason]).toBe(key);
  });

  it('an absent or off-vocabulary reason reads as the slot-invalid line, the historical fall-through', () => {
    expect(toolEffectResultLine({ action: 'recharge', ok: false }, NAMES)).toEqual({
      key: 'hudChrome.professions.toolEffectSlotInvalid',
      params: { effect: 'Keen Edge' },
      tone: PROF_LOG_DENY,
    });
    // A newer deploy widening the wire (the R34 enum axis) must not throw on
    // an undefined key; the cast is the wire's own shape reaching this code.
    const widened = { action: 'slot', ok: false, reason: 'lunar_eclipse' } as unknown as Parameters<
      typeof toolEffectResultLine
    >[0];
    expect(toolEffectResultLine(widened, NAMES).key).toBe(
      'hudChrome.professions.toolEffectSlotInvalid',
    );
  });

  it('a denial never carries the prototype-key trap: params are a fresh plain record', () => {
    const line = toolEffectResultLine({ action: 'slot', ok: false, reason: 'busy' }, NAMES);
    expect(Object.keys(line.params)).toEqual([]);
    expect(Object.getPrototypeOf(line.params)).toBe(Object.prototype);
  });

  it('hud.ts is the thin consumer: it resolves the names and logs the model once', () => {
    // Source pin (the coordinator cannot be unit-driven): the arm calls the
    // model with the four resolved names and renders key + params + tone, and
    // the old inline reason ternary is gone.
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const start = hud.indexOf("case 'toolEffectResult': {");
    expect(start).toBeGreaterThan(-1);
    const arm = hud.slice(start, hud.indexOf('break;', start));
    expect(arm).toContain('const line = toolEffectResultLine(ev, {');
    expect(arm).toContain('this.log(t(line.key, line.params), line.tone);');
    expect(arm).not.toContain("ev.reason === 'no_tool'");
    expect(arm).not.toContain('toolEffectRechargeNoSlot');
  });
});
