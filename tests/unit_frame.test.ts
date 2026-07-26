// Tests for the pure unit_frame FAMILY core (unit_frame.ts). The load-bearing
// assertion is the TWO-DESCRIPTOR test: the core is driven with a
// PLAYER-shaped descriptor AND a TARGET / PARTY-shaped descriptor exercising the
// FULL field set (resClass `none`, a hidden level, a dead/absent target, an
// out-of-range party member, the absorb input), proving the player, target, and
// party instances reuse the seam with NO core change. It also pins the
// resourceKind -> resClass discriminator
// (the old inline `rage : energy : mana` ternary + the `none` case), the
// present/hidden gate, the absorbBarView resolution, same-input-same-output
// determinism, the ClientWorld-vs-Sim parity assertion, and that the
// core carries NO hardcoded element id / single-instance assumption and is
// DOM-free + i18n-free (the painter owns the DOM and t()).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Aura } from '../src/sim/types';
import {
  UNIT_FRAME_DANGER_FRAC,
  UNIT_FRAME_HEAVY_HIT_FRAC,
  type UnitFrameDescriptor,
  unitFrameHealthText,
  unitFrameView,
  unitHealthImpact,
  unitHealthTrend,
  unitResourceClass,
  unitTargetPresentation,
  unitThreatState,
} from '../src/ui/unit_frame';

function shield(value: number): Aura {
  return {
    id: 'power_word_shield',
    name: 'Power Word: Shield',
    kind: 'absorb',
    remaining: 30,
    duration: 30,
    value,
    sourceId: 1,
    school: 'holy',
  };
}

// A player-shaped descriptor: always present, a live power bar, a numeric level, a
// shield over half health. Overrides let each test vary one field.
function playerDescriptor(over: Partial<UnitFrameDescriptor> = {}): UnitFrameDescriptor {
  return {
    present: true,
    hpFrac: 300 / 600,
    hpText: '300 / 600',
    resourceKind: 'mana',
    resFrac: 80 / 100,
    resText: '80 / 100',
    levelText: '60',
    name: 'Aerwynn',
    portraitKey: 'player',
    absorb: { hp: 300, maxHp: 600, auras: [shield(60)] },
    dead: false,
    outOfRange: false,
    ...over,
  };
}

describe('unitResourceClass: the power-type discriminator (folds the inline ternary)', () => {
  it('maps each power type to its class', () => {
    expect(unitResourceClass('rage')).toBe('rage');
    expect(unitResourceClass('energy')).toBe('energy');
    expect(unitResourceClass('mana')).toBe('mana');
  });

  it('maps null to mana (the player ternary default branch) and none to none', () => {
    expect(unitResourceClass(null)).toBe('mana');
    expect(unitResourceClass('none')).toBe('none');
  });
});

describe('unitFrameView: the present / hidden gate', () => {
  it('returns a fully blanked view when the unit is absent (target gone, party empty)', () => {
    const v = unitFrameView(playerDescriptor({ present: false }));
    expect(v.present).toBe(false);
    expect(v).toEqual({
      present: false,
      hpFrac: 0,
      hpPercent: 0,
      hpPercentText: '',
      hpDanger: false,
      hpFull: false,
      hpState: 'empty',
      healPredictionStartFrac: 0,
      healPredictionSizeFrac: 0,
      hpText: '',
      resClass: 'none',
      resFrac: 0,
      resText: '',
      levelText: null,
      name: '',
      titlePre: '',
      titlePost: '',
      portraitKey: '',
      portraitState: 'normal',
      absorbFrac: 0,
      absorbStartFrac: 0,
      absorbSizeFrac: 0,
      absorbOvershield: false,
      dead: false,
      outOfRange: false,
    });
  });
});

describe('unit health feedback derivation', () => {
  it('classifies damage, healing, and unchanged samples', () => {
    expect(unitHealthTrend(null, 0.8)).toBe('stable');
    expect(unitHealthTrend(0.8, 0.6)).toBe('damage');
    expect(unitHealthTrend(0.6, 0.75)).toBe('heal');
    expect(unitHealthTrend(0.75, 0.75)).toBe('stable');
  });

  it('gives large losses one stronger capped impact tier', () => {
    expect(unitHealthImpact(null, 0.4)).toBe('stable');
    expect(unitHealthImpact(0.8, 0.7)).toBe('damage');
    expect(unitHealthImpact(0.8, 0.8 - UNIT_FRAME_HEAVY_HIT_FRAC)).toBe('damage-heavy');
    expect(unitHealthImpact(0.4, 0.75)).toBe('heal');
  });

  it('clamps progress semantics and marks only living critical health as danger', () => {
    expect(unitFrameView(playerDescriptor({ hpFrac: 1.4 })).hpPercent).toBe(100);
    expect(unitFrameView(playerDescriptor({ hpFrac: -0.2 })).hpPercent).toBe(0);
    expect(unitFrameView(playerDescriptor({ hpFrac: UNIT_FRAME_DANGER_FRAC })).hpDanger).toBe(true);
    expect(unitFrameView(playerDescriptor({ hpFrac: 0 })).hpDanger).toBe(false);
  });

  it('derives readable full, healthy, wounded, critical, and dead states', () => {
    expect(unitFrameView(playerDescriptor({ hpFrac: 1 })).hpFull).toBe(true);
    expect(unitFrameView(playerDescriptor({ hpFrac: 0.8 })).hpState).toBe('healthy');
    expect(unitFrameView(playerDescriptor({ hpFrac: 0.5 })).hpState).toBe('wounded');
    expect(unitFrameView(playerDescriptor({ hpFrac: 0.25 })).hpState).toBe('critical');
    expect(unitFrameView(playerDescriptor({ hpFrac: 0, dead: true })).hpState).toBe('dead');
  });

  it('clamps incoming healing to the missing-health segment and preserves localized percent text', () => {
    const v = unitFrameView(
      playerDescriptor({
        hpFrac: 0.72,
        hpPercentText: '72 %',
        incomingHealFrac: 0.4,
      }),
    );
    expect(v.hpPercentText).toBe('72 %');
    expect(v.healPredictionStartFrac).toBe(0.72);
    expect(v.healPredictionSizeFrac).toBeCloseTo(0.28);

    const dead = unitFrameView(playerDescriptor({ hpFrac: 0, dead: true, incomingHealFrac: 0.5 }));
    expect(dead.healPredictionSizeFrac).toBe(0);
  });
});

describe('unitFrameHealthText: main-frame numeric modes', () => {
  const text = (mode: 0 | 1 | 2 | 3) => unitFrameHealthText('750', '1,000', '75%', null, mode);

  it('supports hidden, percent, current, and current/max without duplicate percentages', () => {
    expect(text(0)).toEqual({ primary: '', secondaryPercent: '' });
    expect(text(1)).toEqual({ primary: '75%', secondaryPercent: '' });
    expect(text(2)).toEqual({ primary: '750', secondaryPercent: '' });
    expect(text(3)).toEqual({ primary: '750 / 1,000', secondaryPercent: '75%' });
  });

  it('keeps the dead state readable even when numbers are hidden', () => {
    expect(unitFrameHealthText('0', '1,000', '0%', 'Dead', 0)).toEqual({
      primary: 'Dead',
      secondaryPercent: '',
    });
  });
});

describe('unitThreatState: target-frame threat hierarchy', () => {
  const target = (over: Partial<Parameters<typeof unitThreatState>[0]> = {}) => ({
    kind: 'mob',
    hostile: true,
    dead: false,
    aggroTargetId: 2,
    threat: new Map<number, number>([
      [1, 50],
      [2, 100],
    ]),
    ...over,
  });

  it('distinguishes building, high, and active aggro from the authoritative table', () => {
    expect(unitThreatState(target(), 1)).toBe('building');
    expect(
      unitThreatState(
        target({
          threat: new Map([
            [1, 90],
            [2, 100],
          ]),
        }),
        1,
      ),
    ).toBe('high');
    expect(unitThreatState(target({ aggroTargetId: 1 }), 1)).toBe('aggro');
  });

  it('stays quiet for friendly, dead, non-mob, or absent player threat', () => {
    expect(unitThreatState(target({ hostile: false }), 1)).toBe('none');
    expect(unitThreatState(target({ dead: true }), 1)).toBe('none');
    expect(unitThreatState(target({ kind: 'player' }), 1)).toBe('none');
    expect(unitThreatState(target({ threat: new Map([[2, 100]]) }), 1)).toBe('none');
  });
});

describe('unitTargetPresentation: self-target deduplication', () => {
  it('preserves self-target semantics without rendering a duplicate target frame', () => {
    expect(unitTargetPresentation({ id: 7, kind: 'player' }, 7)).toBe('self');
  });

  it('shows other units and hides missing or world-object targets', () => {
    expect(unitTargetPresentation({ id: 8, kind: 'player' }, 7)).toBe('unit');
    expect(unitTargetPresentation({ id: 9, kind: 'mob' }, 7)).toBe('unit');
    expect(unitTargetPresentation({ id: 10, kind: 'object' }, 7)).toBe('none');
    expect(unitTargetPresentation(null, 7)).toBe('none');
  });
});

describe('unitFrameView: absorb resolution via the shared absorbBarView core', () => {
  it('resolves the shield overlay fraction + overshield from the entity-shaped input', () => {
    const v = unitFrameView(
      playerDescriptor({ absorb: { hp: 300, maxHp: 600, auras: [shield(60)] } }),
    );
    expect(v.absorbFrac).toBeCloseTo((300 + 60) / 600); // 0.6
    expect(v.absorbOvershield).toBe(false);
  });

  it('flags an overshield when the shield covers the bar', () => {
    const v = unitFrameView(
      playerDescriptor({ absorb: { hp: 590, maxHp: 600, auras: [shield(50)] } }),
    );
    expect(v.absorbFrac).toBe(1);
    expect(v.absorbOvershield).toBe(true);
  });

  it('treats a null absorb input as no shield (the dead-target case)', () => {
    const v = unitFrameView(playerDescriptor({ absorb: null }));
    expect(v.absorbFrac).toBe(0);
    expect(v.absorbOvershield).toBe(false);
  });
});

describe('unitFrameView: TWO-DESCRIPTOR contract (the FULL field set)', () => {
  it('drives a PLAYER-shaped descriptor: live mana bar, numeric level, shield', () => {
    const v = unitFrameView(playerDescriptor());
    expect(v.present).toBe(true);
    expect(v.resClass).toBe('mana');
    expect(v.hpFrac).toBe(0.5);
    expect(v.hpText).toBe('300 / 600');
    expect(v.resFrac).toBe(0.8);
    expect(v.resText).toBe('80 / 100');
    expect(v.levelText).toBe('60');
    expect(v.name).toBe('Aerwynn');
    expect(v.dead).toBe(false);
    expect(v.outOfRange).toBe(false);
  });

  it('drives a TARGET-shaped descriptor: no resource bar, numeric boss level, dead, no shield', () => {
    // A dead boss target: present and shown, but with no resource bar, a numeric
    // level over the CSS emblem, "Dead" hp text, and a null absorb input. The player instance
    // never sees these values; the target instance fills them in with no core
    // change.
    const v = unitFrameView({
      present: true,
      hpFrac: 0,
      hpText: 'Dead',
      resourceKind: 'none',
      resFrac: 0,
      resText: '',
      levelText: '62',
      name: 'Nythraxis',
      portraitKey: 'mob:nythraxis',
      absorb: null,
      dead: true,
      outOfRange: false,
    });
    expect(v.present).toBe(true);
    expect(v.resClass).toBe('none');
    expect(v.hpText).toBe('Dead');
    expect(v.levelText).toBe('62');
    expect(v.dead).toBe(true);
    expect(v.absorbFrac).toBe(0);
  });

  it('drives an ABSENT target descriptor: hidden (present false)', () => {
    const v = unitFrameView({ ...playerDescriptor(), present: false });
    expect(v.present).toBe(false);
  });

  it('drives a PARTY-shaped descriptor: out-of-range flag, no level shown, alive', () => {
    const v = unitFrameView({
      present: true,
      hpFrac: 0.42,
      hpText: '',
      resourceKind: 'mana',
      resFrac: 0.7,
      resText: '',
      levelText: null, // a party member may hide the level
      name: 'Goradil',
      portraitKey: 'player:warrior:2',
      absorb: null,
      dead: false,
      outOfRange: true,
    });
    expect(v.present).toBe(true);
    expect(v.outOfRange).toBe(true);
    expect(v.levelText).toBeNull();
    expect(v.resClass).toBe('mana');
  });
});

describe('unitFrameView: determinism + ClientWorld-vs-Sim parity', () => {
  it('is deterministic: identical descriptors produce a deep-equal view', () => {
    const a = unitFrameView(playerDescriptor());
    const b = unitFrameView(playerDescriptor());
    expect(a).toEqual(b);
  });

  it('Sim-shaped and ClientWorld-mirror-shaped descriptors render identically', () => {
    // The only entity-shaped input is the absorb { hp, maxHp, auras }, which BOTH
    // the offline Sim entity and the online ClientWorld mirror expose. Each stub
    // carries host-specific extras the core must ignore; if absorbBarView (or the
    // core) ever reached for a Sim-only field, these would diverge.
    const simAbsorb = {
      hp: 420,
      maxHp: 600,
      auras: [shield(90)],
      // Sim-only extras the core must not read:
      pos: { x: 1, z: 2 },
      threat: 17,
    };
    const clientAbsorb = {
      hp: 420,
      maxHp: 600,
      auras: [shield(90)],
      // ClientWorld mirror extras:
      netUpdatedAt: 1234,
      netInterval: 50,
    };
    const fromSim = unitFrameView(playerDescriptor({ absorb: simAbsorb }));
    const fromClient = unitFrameView(playerDescriptor({ absorb: clientAbsorb }));
    expect(fromSim).toEqual(fromClient);
    expect(fromSim.absorbFrac).toBeCloseTo((420 + 90) / 600); // 0.85
  });
});

describe('unit_frame core stays DOM-free, i18n-free, and id-free (no single-instance assumption)', () => {
  const src = readFileSync(new URL('../src/ui/unit_frame.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports no i18n runtime and calls no t()/tEntity/formatNumber', () => {
    expect(code).not.toContain("from './i18n'");
    expect(code).not.toMatch(/\bt\(/);
    expect(code).not.toMatch(/\btEntity\(/);
    expect(code).not.toMatch(/\bformatNumber\(/);
  });

  it('references no element id selector or #player-frame (no hardcoded instance)', () => {
    expect(code).not.toMatch(/#pf-/);
    expect(code).not.toMatch(/player-frame/);
    expect(code).not.toMatch(/querySelector|getElementById/);
  });
});

describe('unitFrameView: the title decoration pass-through (Book of Deeds)', () => {
  it('passes titlePre/titlePost through pre-localized, verbatim', () => {
    const v = unitFrameView(playerDescriptor({ titlePre: '', titlePost: ' [Veteran]' }));
    expect(v.titlePre).toBe('');
    expect(v.titlePost).toBe(' [Veteran]');
    // A prefix-placing locale flows the same way (the core knows no layout).
    const pre = unitFrameView(playerDescriptor({ titlePre: '[Veterano] ', titlePost: '' }));
    expect(pre.titlePre).toBe('[Veterano] ');
    expect(pre.titlePost).toBe('');
  });

  it('defaults both to empty when the instance passes no title fields (player, party)', () => {
    const v = unitFrameView(playerDescriptor());
    expect(v.titlePre).toBe('');
    expect(v.titlePost).toBe('');
  });
});
