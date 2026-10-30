// The Hammer Council's Narrow Shelter over a REAL Sim claim: from Heroic up a pillar
// shields only so many from Mountain's Wrath; one too many and everyone behind it
// takes part of the blast. Normal keeps no limit. Plus the rule's aura on the
// caster's bar (what the client reads) and the pure runes.

import { describe, expect, it } from 'vitest';
import { pillarShelterCounts, shelterRunes } from '../src/render/smith_heart_fx/council_fx_core';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

const MID = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };

function pulled(n: number, tier?: 'heroic' | 'mythic'): CouncilFight {
  const f = councilFight(n, 17);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier) expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.songDue = null;
  return f;
}

/** Hide `hiding` players behind column 0 from a Guardian at the pit's middle. */
function hide(f: CouncilFight, hiding: number): Entity[] {
  const g = f.bodies().guardian as Entity;
  const w = f.world(MID.x, MID.z);
  g.pos.x = w.x;
  g.pos.z = w.z;
  g.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  g.prevPos = { ...g.pos };
  f.sim.ctx.rebucket(g);
  const col = QUARRY_PILLAR_SPOTS[0];
  const dx = (col.x - MID.x) / 24;
  const dz = (col.z - MID.z) / 24;
  const behind = f.players.slice(0, hiding);
  for (const p of behind) f.put(p, MID.x + dx * 30, MID.z + dz * 30);
  return behind;
}

const wrathOn = (ev: SimEvent[], p: Entity) =>
  ev.filter(
    (e) =>
      e.type === 'damage' &&
      e.targetId === p.id &&
      (e as { ability?: string }).ability === COUNCIL_NAMES.wrath,
  ) as (SimEvent & { amount: number })[];

function land(f: CouncilFight): SimEvent[] {
  expect(f.dev('/dev heart council wrath')).toBe(true);
  return f.tick(Math.ceil(T.wrathCast * 20) + 2);
}

describe('Hammer Council: Narrow Shelter', () => {
  it('the limits: Normal none, Heroic 4, Mythic 3', () => {
    expect(COUNCIL_DIFFICULTY.normal.pillarLimit).toBeNull();
    expect(COUNCIL_DIFFICULTY.heroic.pillarLimit).toBe(4);
    expect(COUNCIL_DIFFICULTY.mythic.pillarLimit).toBe(3);
  });

  it('normal: any number hide behind one pillar', () => {
    const f = pulled(6);
    const behind = hide(f, 6);
    const ev = land(f);
    for (const p of behind) expect(wrathOn(ev, p)).toEqual([]);
  });

  it('heroic: four are safe', () => {
    const f = pulled(4, 'heroic');
    const behind = hide(f, 4);
    const ev = land(f);
    for (const p of behind) expect(wrathOn(ev, p)).toEqual([]);
  });

  it('heroic: a fifth and all five take part of the blast, the raid is told', () => {
    const f = pulled(5, 'heroic');
    const behind = hide(f, 5);
    const ev = land(f);
    const mult = COUNCIL_DIFFICULTY.heroic.damageMult;
    for (const p of behind) {
      const hits = wrathOn(ev, p);
      expect(hits.length).toBe(1);
      expect(hits[0].amount).toBeLessThanOrEqual(Math.ceil(T.wrathMax * mult * T.crowdShare));
      expect(hits[0].amount).toBeGreaterThan(0);
    }
    expect(
      ev.filter((e) => e.type === 'chat' && e.textKey === 'hudChrome.council.warn.crowded').length,
    ).toBeGreaterThan(0);
  });

  it('mythic: three are safe, a fourth is not', () => {
    const safe = pulled(3, 'mythic');
    const three = hide(safe, 3);
    const evSafe = land(safe);
    for (const p of three) expect(wrathOn(evSafe, p)).toEqual([]);
    const f = pulled(4, 'mythic');
    const four = hide(f, 4);
    const ev = land(f);
    for (const p of four) expect(wrathOn(ev, p).length).toBe(1);
  });

  it('the caster wears the limit through the bar, and only then', () => {
    const f = pulled(2, 'heroic');
    const g = f.bodies().guardian as Entity;
    const limit = () => g.auras.find((a) => a.id === COUNCIL_AURAS.pillarLimit);
    expect(limit()).toBeUndefined();
    expect(f.dev('/dev heart council wrath')).toBe(true);
    expect(g.castingAbility).toBe(COUNCIL_CASTS.wrath);
    expect(limit()?.value2).toBe(4);
    f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(limit()).toBeUndefined();
    const n = pulled(2);
    expect(n.dev('/dev heart council wrath')).toBe(true);
    const ng = n.bodies().guardian as Entity;
    expect(ng.auras.some((a) => a.id === COUNCIL_AURAS.pillarLimit)).toBe(false);
  });

  it('a reset takes the limit off the caster', () => {
    const f = pulled(2, 'heroic');
    const g = f.bodies().guardian as Entity;
    f.dev('/dev heart council wrath');
    f.dev('/dev heart council reset');
    expect(g.auras.some((a) => a.id === COUNCIL_AURAS.pillarLimit)).toBe(false);
  });

  it('the runes: lit one by one, all red past the limit', () => {
    expect(shelterRunes(0, 4)).toEqual({ lit: 0, over: false });
    expect(shelterRunes(4, 4)).toEqual({ lit: 4, over: false });
    expect(shelterRunes(5, 4)).toEqual({ lit: 4, over: true });
  });

  it('the client counts who hides behind which pillar, nearest first', () => {
    const pillars = [
      { x: 10, z: 0, r: 2 },
      { x: 20, z: 0, r: 2 },
      { x: 0, z: 10, r: 2 },
    ];
    const players = [
      { x: 30, z: 0 },
      { x: 15, z: 0 },
      { x: 0, z: 20 },
      { x: -20, z: -20 },
    ];
    const out: number[] = [];
    pillarShelterCounts(0, 0, players, 4, pillars, 3, out);
    expect(out.slice(0, 3)).toEqual([2, 0, 1]);
  });

  it('says what it does in its tooltip and has a localized name', () => {
    const d = auraEffectDescriptor({
      id: COUNCIL_AURAS.pillarLimit,
      kind: 'vulnerability',
      value: 0,
      value2: 4,
    });
    const text = t(d?.key as never, d?.nums as never);
    expect(text).toContain('4');
    expect(text).toContain(`${Math.round(T.crowdShare * 100)}%`);
    expect(localizeSimAuraName('Narrow Shelter')).toBe('Narrow Shelter');
    expect(t('hudChrome.council.warn.crowded' as never)).toContain('pillar');
  });
});
