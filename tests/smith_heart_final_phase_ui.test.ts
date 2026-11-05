// @vitest-environment happy-dom
// The Masterless Strength's part 2 player text and raid HUD:
//   - every part-2 raid warning resolves its key to the very English the sim
//     sent;
//   - every part-2 aura's tooltip says its rule with the live numbers (no
//     token left unfilled), every damage, aura, cast and Splinter name
//     re-localizes;
//   - the Overload HUD holds its bars through a call (the awake quarters lit,
//     the shield's seconds, the Splinters), turns them off in the final phase
//     (the enrage's seconds, then the fury), and lists the poured elements;
//   - the personal alert puts Bursting Coal and Wind-Tethered first and warns
//     a tank of Mounting Weight near the swap.

import { describe, expect, it } from 'vitest';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_ZONE_CODES,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  ALL_QUARTERS_MASK,
  FINAL_PHASE_CASTS as C,
  FINAL_ADD_MOBS,
  FINAL_STAGE_CODES,
  MOUNTING_WEIGHT_AURA,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  pouredAuraId,
  quarterBit,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { QUIET_WARNINGS } from '../src/sim/encounters/smith_heart/final_scope';
import type { Aura, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName } from '../src/ui/cast_display_name';
import { buildFinalAlertView } from '../src/ui/hud/dungeon/final_alert_view';
import {
  buildOverloadView,
  makeOverloadView,
  type OverloadBoss,
} from '../src/ui/hud/dungeon/heart_overload_view';
import { setLanguage, t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { finalFight } from './helpers/final_fight';

setLanguage('en');

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('part 2: what the raid reads', () => {
  it('every warning resolves its key to the English the sim sent', () => {
    const f = finalFight(6);
    const events: SimEvent[] = [];
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    const say = (line: string, s = 1) => {
      f.dev(line);
      events.push(...f.tick(Math.round(s * 20)));
    };
    say('/dev heart final inter70', 7);
    say('/dev heart final coal');
    say('/dev heart final toll');
    say('/dev heart final pounce');
    say('/dev heart final endcall');
    say('/dev heart final last', 4);
    say('/dev heart final enrage');
    const warns = events.filter(
      (e): e is Chat => e.type === 'chat' && e.channel === 'raidWarning' && e.pid === f.pids[0],
    );
    const keys = new Set(warns.map((w) => w.textKey));
    for (const k of QUIET_WARNINGS) expect(keys, k).not.toContain(`hudChrome.finalBoss.warn.${k}`);
    for (const k of ['intermission', 'poured', 'release', 'final', 'awaken', 'fury'])
      expect(keys, k).toContain(`hudChrome.finalBoss.warn.${k}`);
    for (const w of warns) expect(t(w.textKey as never)).toBe(w.text);
    // The soon-warning's key exists too (its own test times it).
    expect(t('hudChrome.finalBoss.warn.furySoon' as never)).toContain('restraint');
  });

  it('its bars, its Splinters and every name read in words, never a raw id', () => {
    expect(castDisplayName(C.call)).toBe('Call of the Quarters');
    expect(castDisplayName(C.shear)).toBe('Shearing Blow');
    expect(castDisplayName(C.toll)).toBe('Rime Toll');
    expect(castDisplayName(C.pounce)).toBe('Gale Pounce');
    for (const v of ['heat', 'quench', 'breath', 'hammer'] as const)
      expect(t(`entities.mobs.${FINAL_ADD_MOBS[v]}.name` as never)).toBe(N[v]);
    for (const name of [
      N.phase,
      N.shield,
      N.splinter,
      N.shear,
      N.coal,
      N.trail,
      N.toll,
      N.ring,
      N.weight,
      N.pounce,
      N.tether,
      N.buffet,
      N.fury,
      ...Object.values(N.poured),
    ])
      expect(localizeSimAuraName(name), name).not.toBeNull();
  });
});

describe('part 2: tooltips', () => {
  const say = (a: Partial<Aura> & { id: string; kind: Aura['kind'] }) => {
    const d = auraEffectDescriptor({ value: 0, ...a });
    expect(d, a.id).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text, a.id).not.toMatch(/\{\w+\}/);
    return text;
  };

  it('the call, the final phase, the shield, the fury', () => {
    const call = say({ id: A.phase, kind: 'internal_cd', value: FINAL_STAGE_CODES.call });
    expect(call).toContain(`${P.callSeconds} sec`);
    expect(call).toContain(`${P.splinterMin} to ${P.splinterMax}`);
    const fin = say({ id: A.phase, kind: 'internal_cd', value: FINAL_STAGE_CODES.final });
    expect(fin).toContain(`one every ${P.mixEvery} sec`);
    expect(fin).toContain(`After ${P.enrageAfter} sec`);
    expect(say({ id: A.shield, kind: 'internal_cd' })).toContain('immune');
    expect(say({ id: A.fury, kind: 'internal_cd', value: 1 })).toContain(
      `${P.furyMin} to ${P.furyMax}`,
    );
    // The quarter fight's stage says when the next stages come.
    const fight = say({ id: A.phase, kind: 'internal_cd', value: FINAL_STAGE_CODES.fight });
    expect(fight).toContain('At 70% and 40% health');
    expect(fight).toContain('At 15%');
  });

  it('each poured element says its cadence, faster for each pour', () => {
    expect(say({ id: pouredAuraId('heat'), kind: 'internal_cd', value: 1 })).toContain(
      `every ${P.pouredHeatEvery} sec`,
    );
    expect(say({ id: pouredAuraId('heat'), kind: 'internal_cd', value: 2 })).toContain(
      `every ${P.pouredHeatEvery / 2} sec`,
    );
    expect(say({ id: pouredAuraId('quench'), kind: 'internal_cd', value: 1 })).toContain(
      `${P.pouredColdShare * 100}%`,
    );
    expect(say({ id: pouredAuraId('breath'), kind: 'internal_cd', value: 1 })).toContain(
      'Leaping Bolt',
    );
    expect(say({ id: pouredAuraId('hammer'), kind: 'internal_cd', value: 1 })).toContain(
      'Tremor Cracks',
    );
  });

  it('the marks on players', () => {
    const coal = say({ id: A.coal, kind: 'internal_cd' });
    expect(coal).toContain(`within ${P.coalReach} yd`);
    expect(coal).toContain(`${P.coalMin} to ${P.coalMax} Fire`);
    expect(say({ id: A.tether, kind: 'internal_cd' })).toContain(`${P.buffetReach} yd`);
    expect(say({ id: A.chill, kind: 'slow', value: P.chillSlow })).toContain(
      `${Math.round((1 - P.chillSlow) * 100)}%`,
    );
    const weight = say({ id: MOUNTING_WEIGHT_AURA, kind: 'dot', stacks: 4 });
    expect(weight).toContain(`${P.weightPerTick * 4} Physical`);
    expect(weight).toContain(`${P.weightSwap} stacks`);
  });
});

// ---- the HUD ----------------------------------------------------------------------------

function bossAt(stage: keyof typeof FINAL_STAGE_CODES, extra: OverloadBoss['auras'] = []) {
  return {
    id: 7,
    templateId: FINAL_BOSS,
    auras: [
      { id: FINAL_AURAS.state, value: FINAL_ZONE_CODES.ring, value2: 3, value3: 0 },
      { id: overloadAuraId('heat'), value: 40, value2: 0 },
      { id: overloadAuraId('quench'), value: 20, value2: 0 },
      { id: overloadAuraId('breath'), value: 0, value2: 0 },
      { id: overloadAuraId('hammer'), value: 85, value2: 0 },
      ...extra,
    ],
  } satisfies OverloadBoss;
}

describe('part 2: the Overload HUD', () => {
  it('a call: the bars held, the Splinters lit, the shield and their count', () => {
    const mask = quarterBit('heat') | quarterBit('hammer');
    const v = buildOverloadView(
      bossAt('call', [
        { id: A.phase, value: FINAL_STAGE_CODES.call, value2: mask, value3: 31 },
        { id: A.shield, value: 0 },
      ]),
      makeOverloadView(),
    );
    expect(v.frozen).toBe(true);
    expect(v.barsOff).toBe(false);
    expect(v.title).toBe('Call of the Quarters');
    expect(v.phase).toBe('Shield 31');
    expect(v.splinters).toBe('Splinters 2');
    expect(v.root).toBe('');
    expect(v.rows.filter((r) => r.awake).map((r) => r.vein)).toEqual(['hammer', 'heat']);
    // A held bar never throbs as if it were about to burst.
    expect(v.rows.some((r) => r.danger || r.active)).toBe(false);
  });

  it('the final phase: the bars off, the enrage counting down, then the fury', () => {
    const v = buildOverloadView(
      bossAt('final', [
        { id: A.phase, value: FINAL_STAGE_CODES.final, value2: ALL_QUARTERS_MASK, value3: 90 },
      ]),
      makeOverloadView(),
    );
    expect(v.barsOff).toBe(true);
    expect(v.title).toBe('All quarters awake');
    expect(v.phase).toBe('Enrage in 90');
    expect(v.phaseUrgent).toBe(false);
    const w = buildOverloadView(
      bossAt('final', [
        { id: A.phase, value: FINAL_STAGE_CODES.final, value2: ALL_QUARTERS_MASK, value3: 0 },
        { id: A.fury, value: 3 },
      ]),
      makeOverloadView(),
    );
    expect(w.phase).toBe('Masterless Fury x3');
    expect(w.phaseUrgent).toBe(true);
  });

  it('the poured elements read all fight long, twice poured counted', () => {
    const v = buildOverloadView(
      bossAt('fight', [
        { id: A.phase, value: FINAL_STAGE_CODES.fight, value2: 0, value3: 0 },
        { id: pouredAuraId('heat'), value: 1 },
        { id: pouredAuraId('quench'), value: 2 },
      ]),
      makeOverloadView(),
    );
    expect(v.frozen).toBe(false);
    expect(v.poured).toContain('Heat');
    expect(v.poured).toContain('Quench x2');
    expect(v.phase).toBe('');
  });
});

describe('part 2: the personal alert', () => {
  it('Bursting Coal first, then Wind-Tethered, then the rest', () => {
    const coal = { id: A.coal, remaining: 4, duration: 6 };
    const tether = { id: A.tether, remaining: 6, duration: 9.5 };
    const frozen = { id: FINAL_AURAS.frozen, remaining: 2, duration: 4 };
    const v = buildFinalAlertView({ auras: [frozen, tether, coal] });
    expect(v.visible && v.kind).toBe('coal');
    const w = buildFinalAlertView({ auras: [frozen, tether] });
    expect(w.visible && w.kind).toBe('tether');
  });

  it('a tank near the swap is told to swap', () => {
    const low = buildFinalAlertView({
      auras: [{ id: MOUNTING_WEIGHT_AURA, remaining: 20, duration: 25, stacks: 2 }],
    });
    expect(low.visible).toBe(false);
    const near = buildFinalAlertView({
      auras: [{ id: MOUNTING_WEIGHT_AURA, remaining: 20, duration: 25, stacks: P.weightSwap }],
    });
    expect(near.visible && near.kind).toBe('weight');
    if (near.visible) expect(near.line).toContain(`swap tanks at ${P.weightSwap}`);
  });
});
