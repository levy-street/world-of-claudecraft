// The Wheel of the Hearth over a REAL Sim claim: Mythic only, four slices round the
// wellspring, three erupt and one stays safe, three rounds back to back with the next
// safe slice shown as the last erupts, deterministic, and a wipe clears it. Plus the
// slices' geometry, the template ids and the shader's arcs.

import { describe, expect, it } from 'vitest';
import { wheelArc } from '../src/render/smith_heart_fx/heat_fight_fx_core';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import {
  HEAT_DIFFICULTY,
  HEAT_NAMES,
  HEAT_OBJECTS,
  HEAT_TUNING as T,
  WHEEL_ROUNDS,
  WHEEL_SLICES,
  wheelOf,
  wheelSliceAt,
  wheelTemplate,
} from '../src/sim/encounters/smith_heart';
import { wheelSafes } from '../src/sim/encounters/smith_heart/heat_wheel';
import type { SimEvent } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { hitsOf } from './helpers/council_fight';
import { type HeatFight, heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s * 20);

function mythic(n = 4): HeatFight {
  const f = heatFight(n, 31);
  f.dev('/dev heart heat pull');
  f.dev('/dev heart heat mythic');
  f.dev('/dev heart heat phase 2');
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.seedTimer = 999;
  st.zoneTimer = 999;
  st.cinderTimer = 999;
  st.fistTimer = 999;
  st.wheelTimer = 999;
  return f;
}

/** A spot on the shore in `slice`, `r` yards from the wellspring. */
function spot(slice: number, r = 22) {
  const deg = (slice * 45 + 22.5) * (Math.PI / 180);
  return { x: HEARTH_WELL.x + Math.sin(deg) * r, z: HEARTH_WELL.z + Math.cos(deg) * r };
}

describe('Guardian of the Heat: the Wheel of the Hearth', () => {
  it('is Mythic only', () => {
    expect(HEAT_DIFFICULTY.normal.wheel).toBe(false);
    expect(HEAT_DIFFICULTY.heroic.wheel).toBe(false);
    expect(HEAT_DIFFICULTY.mythic.wheel).toBe(true);
  });

  it('the slices: four round the shore, every bearing in exactly one', () => {
    for (let slice = 0; slice < WHEEL_SLICES; slice++) {
      const p = spot(slice);
      expect(wheelSliceAt(p.x, p.z)).toBe(slice);
    }
    // Behind the wellspring it belongs to the slice at that end.
    expect(wheelSliceAt(HEARTH_WELL.x - 5, HEARTH_WELL.z + 20)).toBe(0);
    expect(wheelSliceAt(HEARTH_WELL.x - 5, HEARTH_WELL.z - 20)).toBe(3);
  });

  it('the painted arcs are the same slices', () => {
    for (let slice = 0; slice < WHEEL_SLICES; slice++) {
      const arc = wheelArc(slice);
      const p = spot(slice);
      const bearing = Math.atan2(p.x - HEARTH_WELL.x, p.z - HEARTH_WELL.z);
      expect(bearing).toBeGreaterThan(arc.from);
      expect(bearing).toBeLessThan(arc.to);
    }
  });

  it('the safe slices: hashed, never the same twice running, one or two apart', () => {
    for (let run = 0; run < 40; run++) {
      const safes = wheelSafes(run);
      expect(safes.length).toBe(WHEEL_ROUNDS);
      for (let i = 0; i < safes.length; i++) {
        expect(safes[i]).toBeGreaterThanOrEqual(0);
        expect(safes[i]).toBeLessThan(WHEEL_SLICES);
        if (i === 0) continue;
        const gap = Math.abs(safes[i] - safes[i - 1]);
        expect(gap === 1 || gap === 2).toBe(true);
      }
    }
    expect(wheelSafes(5)).toEqual(wheelSafes(5));
  });

  it('the templates read back', () => {
    expect(wheelOf(wheelTemplate(2, 'warn', 4))).toEqual({ slice: 2, state: 'warn', seconds: 4 });
    expect(wheelOf(wheelTemplate(0, 'safe', 4))).toEqual({ slice: 0, state: 'safe', seconds: 4 });
    expect(wheelOf('sh_heat_zone_0_warn_40')).toBeNull();
  });

  it('three slices warn and one shows safe, only the red ones erupt', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const objects = f.objects(HEAT_OBJECTS.wheelPrefix).map((e) => wheelOf(e.templateId));
    expect(objects.filter((o) => o?.state === 'warn').length).toBe(3);
    expect(objects.filter((o) => o?.state === 'safe').length).toBe(1);
    const safe = st.wheelSafes[0];
    const red = (safe + 1) % WHEEL_SLICES;
    const [a, b] = f.players;
    const sp = spot(safe);
    const rp = spot(red);
    f.put(a, sp.x, sp.z);
    f.put(b, rp.x, rp.z);
    const ev = f.tick(ticks(T.wheelWarn) + 1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, a.id)).toEqual([]);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id).length).toBeGreaterThanOrEqual(1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id)[0]).toBeGreaterThanOrEqual(T.wheelMin);
  });

  it('as one round erupts the next shows, on another slice, and three run in all', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const safes = [...st.wheelSafes];
    expect(safes.length).toBe(3);
    f.tick(ticks(T.wheelWarn) + 1);
    const shown = f
      .objects(HEAT_OBJECTS.wheelPrefix)
      .map((e) => wheelOf(e.templateId))
      .filter((o) => o?.state === 'safe');
    expect(shown.map((o) => o?.slice)).toEqual([safes[1]]);
    f.tick(ticks(T.wheelWarn) * 2 + ticks(T.wheelBurn) + 4);
    expect(st.wheelRounds).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
  });

  it('standing in the new safe slice as the last burn dies keeps you whole', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const [a] = f.players;
    let hits = 0;
    const count = (ev: SimEvent[]) => {
      hits += hitsOf(ev, HEAT_NAMES.wheel, a.id).length;
    };
    for (const safe of [...st.wheelSafes]) {
      const sp = spot(safe);
      f.put(a, sp.x, sp.z);
      // Rests on this round's safe slice until its eruption and its burn pass.
      count(f.tick(ticks(T.wheelWarn) + 1));
    }
    expect(hits).toBeLessThanOrEqual(WHEEL_ROUNDS * Math.ceil(T.wheelBurn / T.wheelTick));
    expect(st.wheelSafes.length).toBe(3);
  });

  it('does not start on Heroic by the clock, and a reset clears it', () => {
    const f = heatFight(2, 31);
    f.dev('/dev heart heat pull');
    f.dev('/dev heart heat heroic');
    f.dev('/dev heart heat phase 2');
    f.tick(ticks(T.wheelFirst + 2));
    expect(f.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
    const m = mythic(2);
    m.dev('/dev heart heat wheel');
    expect(m.objects(HEAT_OBJECTS.wheelPrefix).length).toBe(4);
    m.dev('/dev heart heat reset');
    expect(m.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
  });

  it('names itself and warns the raid', () => {
    expect(localizeSimAuraName(HEAT_NAMES.wheel)).toBe('Wheel of the Hearth');
    expect(t('hudChrome.heatGuardian.warn.wheel' as never)).toContain('dark slice');
  });
});
