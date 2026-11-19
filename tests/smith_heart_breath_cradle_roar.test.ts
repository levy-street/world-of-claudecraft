// The Guardian of the Breath's channeled Thunder's Cradle and its Summit Roar
// over a REAL Sim claim (src/sim/encounters/smith_heart/breath_cradle.ts,
// breath_roar.ts): the cradle channeled (nothing else cast, heroic's three
// lifted), the roar that throws a raid tanked by the edge off the Cornice.
// (Split out of the old isles test when the Islands of the Wind became the
// 50 percent phase, 2026-11-18: tests/smith_heart_breath_isles.test.ts.)

import { describe, expect, it } from 'vitest';
import { BREATH } from '../src/sim/content/smith_heart_layout';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  inBreathArena,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { dischargeCradles } from '../src/sim/encounters/smith_heart/breath_cradle';
import { cornicePads, isleSpots } from '../src/sim/encounters/smith_heart/breath_isle_geometry';
import { DT, type Entity } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type BreathFight, breathFight } from './helpers/breath_fight';
import { hitsOf } from './helpers/council_fight';

const ticks = (s: number) => Math.round(s / DT);
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

/** Hold the wind calm: on the open rim an idle raid is carried off the edge. */
function stillAir(f: BreathFight): void {
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (st) {
    st.wind.remaining = 9999;
    st.inhaleTimer = 9999;
    st.circleTimer = 9999;
  }
}

function pulled(n = 6, tier: '' | 'heroic' | 'mythic' = '', seed = 23): BreathFight {
  const f = breathFight(n, seed);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  if (tier) f.dev(`/dev heart breath ${tier}`);
  f.tick(2);
  stillAir(f);
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  return f;
}

describe("Thunder's Cradle, channeled", () => {
  function storm(n: number, tier: '' | 'heroic' = ''): BreathFight {
    const f = pulled(n, tier);
    f.dev('/dev heart breath phase2');
    f.tick(ticks(T.stormCast + T.barrageSeconds + 1));
    const st = f.state();
    if (st) {
      st.forkTimer = 999;
      st.drawnTimer = 999;
      st.cradleTimer = 999;
      st.gustTimer = 999;
    }
    return f;
  }

  it('the guardian channels it: planted, no other bar while the lifted hang', () => {
    const f = storm(6);
    const b = f.boss();
    f.dev('/dev heart breath eye');
    f.tick(ticks(T.cradleCast) + 1);
    expect(b.castingAbility).toBe(BREATH_CASTS.cradleHold);
    expect(b.channeling).toBe(true);
    const st = f.state();
    if (!st) throw new Error('no fight');
    // Everything else comes due: none begins.
    st.forkTimer = 0;
    st.drawnTimer = 0;
    const seen = new Set<string>();
    for (let i = 0; i < ticks(T.cradleHold - 0.5); i++) {
      f.tick();
      if (b.castingAbility) seen.add(b.castingAbility);
    }
    expect([...seen]).toEqual([BREATH_CASTS.cradleHold]);
    f.tick(ticks(1));
    expect(st.cradles).toHaveLength(0);
  });

  it('normal lifts one; heroic three, each its own circle and its own split', () => {
    for (const tier of ['', 'heroic'] as const) {
      const f = storm(9, tier);
      // Spread wide, so each lifted player's circle stands alone.
      f.players.forEach((p, k) => {
        f.put(p, -24 + (k % 3) * 18, 178 + Math.floor(k / 3) * 14);
      });
      f.dev('/dev heart breath eye');
      f.tick(ticks(T.cradleCast) + 2);
      const st = f.state();
      if (!st) throw new Error('no fight');
      const want = BREATH_DIFFICULTY[tier || 'normal'].cradleCount;
      expect(st.cradles).toHaveLength(want);
      expect(new Set(st.cradles.map((c) => c.playerId)).size).toBe(want);
      for (const c of st.cradles) {
        const p = f.sim.ctx.entities.get(c.playerId) as Entity;
        expect(has(p, BREATH_AURAS.cradled)).toBe(true);
        expect(p.carriedBy).toBeDefined();
      }
      if (tier === 'heroic') {
        // Two under each circle (three with its lifted): every split even.
        const free = f.players.filter((p) => !st.cradles.some((c) => c.playerId === p.id));
        st.cradles.forEach((c, k) => {
          for (const p of free.slice(k * 2, k * 2 + 2)) f.put(p, c.x + 0.5, c.z);
        });
        const scope = {
          ctx: f.sim.ctx,
          inst: f.inst,
          st,
          boss: f.boss(),
          players: f.players.filter((p) => !p.dead),
          rules: BREATH_DIFFICULTY.heroic,
        };
        const under = dischargeCradles(scope);
        expect(under.map((u) => u.length)).toEqual([3, 3, 3]);
      }
    }
  });
});

describe('the Summit Roar', () => {
  it('a raid drawn to a guardian tanked by the edge is thrown off the Cornice', () => {
    const f = pulled(4);
    const b = f.boss();
    // The guardian at the east rim, the raid gathered at its mouth.
    const edge = cornicePads()[0];
    const isle = isleSpots()[0];
    const ox = (isle.x - edge.x) / Math.hypot(isle.x - edge.x, isle.z - edge.z);
    const oz = (isle.z - edge.z) / Math.hypot(isle.x - edge.x, isle.z - edge.z);
    const bw = f.world(edge.x - ox * 3, edge.z - oz * 3);
    b.pos.x = bw.x;
    b.pos.z = bw.z;
    b.pos.y = f.sim.ctx.groundPos(bw.x, bw.z).y;
    f.sim.ctx.rebucket(b);
    const victims = f.players.slice(1);
    // On its outer side, between it and the rim.
    victims.forEach((p, k) => {
      f.put(p, edge.x + ox * 1.5 - oz * (k - 1) * 2, edge.z + oz * 1.5 + ox * (k - 1) * 2);
    });
    f.dev('/dev heart breath roar');
    for (let i = 0; i < ticks(T.inhaleCast + T.gustCast + 6); i++) f.tick(1, false);
    expect(victims.some((p) => p.dead)).toBe(true);
  });

  it('its wave races out of the maw: the near struck first, each body blasted, never a blink', () => {
    const f = pulled(4);
    const b = f.boss();
    // The guardian in the Cornice's middle, one raider at its feet and one
    // across the floor (both on the Cornice).
    const C = BREATH.cornice;
    const bw = f.world(C.x, C.z);
    b.pos.x = bw.x;
    b.pos.z = bw.z;
    b.pos.y = f.sim.ctx.groundPos(bw.x, bw.z).y;
    f.sim.ctx.rebucket(b);
    const [, near, far] = f.players;
    f.put(near, C.x + 4, C.z);
    f.put(far, C.x - 27, C.z + 4);
    expect(inBreathArena(C.x - 27, C.z + 4)).toBe(true);
    f.dev('/dev heart breath roar');
    // Through the indrawn breath and the Roar's bar, keeping them in place
    // (the pull would drag them in).
    let landed = -1;
    let nearHit = -1;
    let farHit = -1;
    const nearStart = { x: 0, z: 0 };
    const roarName = BREATH_NAMES.gust;
    for (let i = 0; i < ticks(T.inhaleCast + T.gustCast + 4); i++) {
      if (landed < 0) {
        f.put(near, C.x + 4, C.z);
        f.put(far, C.x - 27, C.z + 4);
      }
      const ev = f.tick(1, true);
      if (landed < 0 && ev.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.gust))
        landed = i;
      if (nearHit < 0 && hitsOf(ev, roarName, near.id).length) {
        nearHit = i;
        Object.assign(nearStart, f.local(near));
        // The blast has only begun: a tick or so of it, not the whole way.
        expect(Math.hypot(nearStart.x - C.x - 4, nearStart.z - C.z)).toBeLessThan(
          BREATH_DIFFICULTY.normal.blastSpeed * DT * 2 + 0.1,
        );
      }
      if (farHit < 0 && hitsOf(ev, roarName, far.id).length) farHit = i;
    }
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(nearHit).toBeGreaterThanOrEqual(landed);
    // The far raider is struck as the front reaches them (27 yd at its pace).
    expect(farHit).toBeGreaterThan(nearHit);
    expect((farHit - landed) * DT).toBeGreaterThan(27 / T.roarSpeed - 0.15);
    expect((farHit - landed) * DT).toBeLessThan(27 / T.roarSpeed + 0.2);
    // And the near one is carried out by its blast (or off the lip) by now.
    const end = f.local(near);
    expect(Math.hypot(end.x - nearStart.x, end.z - nearStart.z)).toBeGreaterThan(8);
    expect(f.state()?.roar ?? null).toBeNull();
  });

  it('its wave starts at the maw, ends with the storm, and drops a body that leaves', () => {
    const f = pulled(4);
    f.dev('/dev heart breath roar');
    let landedAt = -1;
    for (let i = 0; i < ticks(T.inhaleCast + T.gustCast + 1) && landedAt < 0; i++) {
      const ev = f.tick(1, true);
      if (ev.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.gust)) landedAt = i;
    }
    expect(landedAt).toBeGreaterThanOrEqual(0);
    // One tick's travel on the landing tick (never two).
    expect(f.state()?.roar?.r ?? 0).toBeLessThanOrEqual(T.roarSpeed * DT + 1e-6);
    // The storm breaking takes the wave in flight with it.
    f.dev('/dev heart breath phase2');
    expect(f.state()?.roar ?? null).toBeNull();
  });

  it('is named Summit Roar everywhere the player reads it', () => {
    expect(BREATH_NAMES.gust).toBe('Summit Roar');
    expect(localizeSimAuraName('Summit Roar')).toBe('Summit Roar');
    expect(t(`abilityUi.cast.${BREATH_CASTS.gust}` as never)).toBe('Summit Roar');
  });
});
