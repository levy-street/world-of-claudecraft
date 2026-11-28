// @vitest-environment happy-dom
// The Masterless Strength's player text and raid HUD:
//   - every raid warning resolves its key to the very English the sim sent;
//   - every aura's tooltip says its rule with the live numbers (no token left
//     unfilled), the stars' marks (Sky Strike, Crossing Blade) included;
//   - every damage and aura name re-localizes;
//   - the Overload bars' view (heart_overload_view.ts) reads the boss's
//     mirrored auras the same off a Sim-shaped and a ClientWorld-shaped body,
//     highlights the quarter it drinks, flags a bar near bursting, says the
//     root, the switch mark and Heart Unbound, hides out of the fight;
//   - no personal alert panel (Jose's playtest of 2026-11-19): the marks read in
//     the world and in the marked player's own arrow;
//   - the painter writes nothing on a still frame.

import { describe, expect, it } from 'vitest';
import { FINAL_ARROW_AURAS, finalArrowMark } from '../src/render/smith_heart_fx/final_arrow_core';
import {
  newOverloadRingState,
  OVERLOAD_RING,
  overloadRingState,
} from '../src/render/smith_heart_fx/final_overload_ring_core';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_DIFFICULTY,
  FINAL_NAMES,
  FINAL_ZONE_CODES,
  FINAL_OVERLOAD as O,
  overloadAuraId,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Aura, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName } from '../src/ui/cast_display_name';
import { HeartFinalPhasePanel } from '../src/ui/hud/dungeon/heart_final_phase_painter';
import {
  buildFinalPhaseView,
  type FinalPhaseBoss,
  HeartFinalScan,
  makeFinalPhaseView,
} from '../src/ui/hud/dungeon/heart_final_phase_view';
import { setLanguage, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { finalFight } from './helpers/final_fight';

setLanguage('en');

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('The Masterless Strength: what the raid reads', () => {
  it('calls no raid warning banner through every mechanic and burst; the boss still speaks', () => {
    const f = finalFight(5);
    const events: SimEvent[] = [];
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    // Two ranged players for the Ember Marks.
    const b = f.local(f.boss());
    f.put(f.players[2], b.x + 20, b.z);
    f.put(f.players[3], b.x - 20, b.z);
    events.push(...f.tick(2));
    for (const verb of ['embers', 'drawn', 'orbs', 'ice', 'anvil', 'sky', 'blades', 'pillars 2']) {
      f.dev(`/dev heart final ${verb}`);
      events.push(...f.tick(2));
    }
    f.dev('/dev heart final fill heat 99');
    events.push(...f.tick(20));
    for (const q of ['quench', 'breath', 'hammer', 'heat', 'ring']) {
      f.dev(`/dev heart final quarter ${q}`);
      if (q === 'ring') f.gather(188, 172, 4);
      events.push(...f.tick(30));
    }
    // The owner's rule (2026-11-03, whole raid 2026-11-09): the quarters,
    // the marks, the near-full bar, the burst and Heart Unbound read on the
    // Overload panel, in the world or on a mark's own alert, never a banner.
    expect(events.filter((e) => e.type === 'chat' && e.channel === 'raidWarning')).toEqual([]);
    // The run did reach what used to call one: a bar burst, the ring unbound.
    expect(f.state()?.bursts ?? 0).toBeGreaterThan(0);
    const yells = events.filter(
      (e): e is Chat =>
        e.type === 'chat' &&
        e.pid === f.pids[0] &&
        (e.textKey ?? '').startsWith('hudChrome.finalBoss.say.'),
    );
    expect(yells.length).toBeGreaterThan(0);
  });

  it("its bars' cast labels read their names, never a raw id", () => {
    // Jose's playtest: the Anvil's bar read heart_final_anvil on the target
    // frame and the nameplate.
    expect(castDisplayName(FINAL_CASTS.anvil)).toBe('Weight of the Anvil');
    expect(castDisplayName(FINAL_CASTS.bolt)).toBe('Leaping Bolt');
    expect(castDisplayName(FINAL_CASTS.fist)).toBe('Basalt Fist');
  });

  it('every damage and aura name re-localizes', () => {
    // Groaning Ice and the Pillar name only objects (never a hit or an aura).
    for (const [k, name] of Object.entries(FINAL_NAMES))
      if (k !== 'crack' && k !== 'pillar') expect(localizeSimAuraName(name), name).not.toBeNull();
  });
});

describe('The Masterless Strength: tooltips', () => {
  const say = (a: Partial<Aura> & { id: string; kind: Aura['kind'] }) => {
    const d = auraEffectDescriptor({ value: 0, ...a });
    expect(d, a.id).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text, a.id).not.toMatch(/\{\w+\}/);
    return text;
  };

  it('the state says the quarter it drinks', () => {
    const st = (zone: keyof typeof FINAL_ZONE_CODES) =>
      say({ id: FINAL_AURAS.state, kind: 'internal_cd', value: FINAL_ZONE_CODES[zone] });
    expect(st('heat')).toContain('Basalt Fist');
    expect(st('heat')).toContain('Fire Whirl');
    expect(st('quench')).toContain('Crossing Blade');
    expect(st('quench')).toContain(`${Math.round((1 - T.numbingSlow) * 100)}%`);
    expect(st('breath')).toContain(`within ${T.boltJump} yd`);
    expect(st('breath')).toContain('Sky Strike');
    expect(st('hammer')).toContain('Wake the Stone');
    expect(st('ring')).toContain('15%');
    expect(st('ring')).toContain(`${Math.round(T.reducedPace * 100)}% pace`);
  });

  it('each bar, mark and the root say their rule with the live numbers', () => {
    const bar = say({ id: overloadAuraId('quench'), kind: 'internal_cd', value: 40 });
    expect(bar).toContain('40% full');
    expect(bar).toContain(`${O.fillSeconds} sec`);
    // A full Normal bar's top roll: 40 x (1 + 45 / 35), the live rise
    // (2026-11-12), at Normal's x1.15 (2026-11-16): 91 x 1.15.
    expect(bar).toContain('up to 105 when full');
    // The burst per difficulty: survivable, heavy, lethal.
    const n = (v: number) => String(v);
    expect(bar).toContain(`${n(O.burst.normal.min)} to ${n(O.burst.normal.max)} damage on Normal`);
    expect(bar).toContain(`${n(O.burst.heroic.min)} to ${n(O.burst.heroic.max)} on Heroic (heavy`);
    expect(bar).toContain(`${n(O.burst.mythic.min)} to ${n(O.burst.mythic.max)} on Mythic (lethal`);
    expect(say({ id: FINAL_AURAS.unbound, kind: 'internal_cd', stacks: 3 })).toContain(
      `(${Math.round(T.unboundPerStack * 1.15) * 3} now)`,
    );
    expect(say({ id: FINAL_AURAS.shaken, kind: 'internal_cd' })).toContain(`${T.shakenMult} times`);
    const sky = say({ id: FINAL_AURAS.skyMark, kind: 'internal_cd' });
    expect(sky).toContain(`${T.skyR} yd`);
    expect(sky).toContain(`${T.arcReach} yd of a pillar`);
    expect(sky).toContain(`${Math.round(T.skyMin * 1.15)} to ${Math.round(T.skyMax * 1.15)}`);
    const blade = say({ id: FINAL_AURAS.bladeMark, kind: 'internal_cd' });
    expect(blade).toContain(`${T.bladeLock} sec`);
    expect(blade).toContain('pillars');
    expect(say({ id: FINAL_AURAS.underIce, kind: 'stun' })).toContain('breaking ice');
    expect(say({ id: FINAL_AURAS.numbing, kind: 'slow', value: T.numbingSlow })).toContain(
      `${Math.round((1 - T.numbingSlow) * 100)}%`,
    );
    const ember = say({ id: FINAL_AURAS.ember, kind: 'internal_cd' });
    expect(ember).toContain(`In ${T.emberSeconds} sec`);
    expect(ember).toContain(`${T.emberMin} to ${T.emberMax} Fire`);
    expect(say({ id: FINAL_AURAS.drawn, kind: 'internal_cd' })).toContain(`${T.drawnReach} yd`);
    expect(say({ id: FINAL_AURAS.shell, kind: 'heal_absorb', value: 600 })).toContain('600');
    // Weight of the Anvil's mark (Jose's playtest of 2026-11-19): it follows you, plants, splits.
    const anvil = say({ id: FINAL_AURAS.anvilMark, kind: 'internal_cd' });
    expect(anvil).toContain('follows you');
    expect(anvil).toContain(`${T.anvilR} yd`);
    expect(anvil).toContain(`plants ${T.anvilLock} sec`);
    expect(anvil).toContain(String(FINAL_DIFFICULTY.normal.anvilTotal));
    expect(anvil).not.toMatch(/\{\w+\}/);
  });
});

describe("The Masterless Strength: the marked player's own arrow", () => {
  it('every mark that singles one player out raises it; a tank debuff never does', () => {
    for (const id of [
      FINAL_AURAS.anvilMark,
      FINAL_AURAS.bladeMark,
      FINAL_AURAS.skyMark,
      FINAL_AURAS.ember,
      FINAL_AURAS.drawn,
    ])
      expect(FINAL_ARROW_AURAS, id).toContain(id);
    expect(finalArrowMark({ auras: [] })).toBeNull();
    const a = { id: FINAL_AURAS.anvilMark, remaining: 4, duration: 6 } as Aura;
    expect(finalArrowMark({ auras: [a] })).toBe(a);
  });
});

// ---- the Overload bars ---------------------------------------------------------------------

function bossOf(
  over: Partial<Record<string, number>>,
  extra: FinalPhaseBoss['auras'] = [],
): FinalPhaseBoss {
  return {
    id: 7,
    templateId: FINAL_BOSS,
    auras: [
      { id: FINAL_AURAS.state, value: FINAL_ZONE_CODES.heat, value2: 3, value3: 12 },
      { id: overloadAuraId('heat'), value: over.heat ?? 0, value2: 1 },
      { id: overloadAuraId('quench'), value: over.quench ?? 0, value2: -1 },
      { id: overloadAuraId('breath'), value: over.breath ?? 0, value2: 0 },
      { id: overloadAuraId('hammer'), value: over.hammer ?? 0, value2: 0 },
      ...extra,
    ],
  };
}

describe('The Masterless Strength: the Overload bars moved into the room', () => {
  it('the ring reads the quarter it drinks, its own bar and its warning', () => {
    const r = overloadRingState(bossOf({ heat: 80, quench: 30 }), true, newOverloadRingState());
    expect(r.mode).toBe('fill');
    expect(r.vein).toBe('heat');
    expect(r.pct).toBe(80);
    expect(r.warn).toBe(true);
  });

  it('the HUD keeps no bars: only the switch mark through part 1', () => {
    const v = buildFinalPhaseView(bossOf({ heat: 80, quench: 30 }), makeFinalPhaseView());
    expect(v.visible).toBe(true);
    expect(v.shaken).toBe(t('hudChrome.finalOverload.shaken', { seconds: '12' }));
    expect(v.title).toBe('');
    expect(v.phase).toBe('');
    expect(Object.keys(v)).not.toContain('rows');
    // No switch mark, nothing poured: nothing on the screen at all.
    const quiet = bossOf({ heat: 80 });
    quiet.auras = quiet.auras.map((a) => (a.id === FINAL_AURAS.state ? { ...a, value3: 0 } : a));
    expect(buildFinalPhaseView(quiet, makeFinalPhaseView()).visible).toBe(false);
  });

  it('reads the same off a Sim-shaped and a ClientWorld-shaped body', () => {
    const sim = bossOf({ heat: 50 });
    // The online mirror: the same auras off the wire, extra fields and all.
    const client = {
      ...sim,
      kind: 'mob',
      auras: sim.auras.map((a) => ({ ...a, name: 'x', kind: 'internal_cd', duration: 3600 })),
    };
    const a = JSON.stringify(buildFinalPhaseView(sim, makeFinalPhaseView()));
    const b = JSON.stringify(buildFinalPhaseView(client, makeFinalPhaseView()));
    expect(b).toBe(a);
    expect(overloadRingState(client, true, newOverloadRingState())).toEqual(
      overloadRingState(sim, true, newOverloadRingState()),
    );
  });

  it('hides out of the fight and when it falls; the scan finds the boss once a roster', () => {
    expect(buildFinalPhaseView(null, makeFinalPhaseView()).visible).toBe(false);
    expect(buildFinalPhaseView({ ...bossOf({}), auras: [] }, makeFinalPhaseView()).visible).toBe(
      false,
    );
    expect(buildFinalPhaseView({ ...bossOf({}), dead: true }, makeFinalPhaseView()).visible).toBe(
      false,
    );
    const boss = { ...bossOf({}), kind: 'mob' };
    const world = { entities: new Map([[7, boss]]), entityRosterVersion: 1 };
    const scan = new HeartFinalScan();
    expect(scan.frame(world)).toBe(boss);
    world.entities.delete(7);
    expect(scan.frame(world)).toBeNull();
  });

  it('Heart Unbound in the ring reads in the room (the ring red, no text), not the HUD', () => {
    const boss = {
      ...bossOf({}),
      auras: [
        { id: FINAL_AURAS.state, value: FINAL_ZONE_CODES.ring },
        { id: FINAL_AURAS.unbound, stacks: 4 },
      ],
    };
    const r = overloadRingState(boss, true, newOverloadRingState());
    expect(r.mode).toBe('centre');
    expect(r.color).toBe(OVERLOAD_RING.centreColor);
    expect(buildFinalPhaseView(boss, makeFinalPhaseView()).visible).toBe(false);
  });

  it('the painter writes nothing on a still frame', () => {
    const layer = document.createElement('div');
    document.body.append(layer);
    let writes = 0;
    const facet = makeWriterFacet(
      new WeakMap() as never,
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {
        writes++;
      },
      () => {},
    );
    const panel = new HeartFinalPhasePanel({ layer: () => layer, writers: facet });
    const view = buildFinalPhaseView(bossOf({ heat: 42 }), makeFinalPhaseView());
    panel.paint(view);
    const el = layer.querySelector('#heart-final-phase');
    expect(el).not.toBeNull();
    expect(layer.querySelector('#heart-overload')).toBeNull();
    expect(el?.querySelector('.hfp-shaken')?.textContent).toBe(view.shaken);
    const before = el?.innerHTML;
    const firstWrites = writes;
    expect(firstWrites).toBeGreaterThan(0);
    let mutations = 0;
    const obs = new MutationObserver((m) => {
      mutations += m.length;
    });
    if (el)
      obs.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    panel.paint(buildFinalPhaseView(bossOf({ heat: 42 }), view));
    obs.takeRecords();
    expect(mutations).toBe(0);
    expect(writes).toBe(firstWrites);
    expect(el?.innerHTML).toBe(before);
    panel.paint(buildFinalPhaseView(null, view));
    expect((el as HTMLElement).style.display).toBe('none');
    panel.dispose();
  });
});

describe('The Masterless Strength: no personal alert panel (playtest 2026-11-19)', () => {
  it('mounts no final alert: every mark reads in the world and the own arrow', async () => {
    const policy = await import('../src/ui/hud/dungeon/dungeon_prompt_policy_core');
    expect(Object.keys(policy.DUNGEON_PROMPT_ADVISORY)).not.toContain('final');
    const fs = await import('node:fs');
    expect(fs.existsSync('src/ui/hud/dungeon/final_alert_view.ts')).toBe(false);
    const prompts = fs.readFileSync('src/ui/hud/dungeon/dungeon_prompts.ts', 'utf8');
    expect(prompts).not.toContain('heart-final-alert');
    expect(fs.readFileSync('src/styles/components.css', 'utf8')).not.toContain(
      '#heart-final-alert',
    );
  });
});
