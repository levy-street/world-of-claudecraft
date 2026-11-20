// A Breath fight taken to its Islands of the Wind over a real Sim, for the
// isles' tests: pulled with the air held still, the phase begun, a body
// ridden along a chain, an isle's adds felled (through a Squall Ward), and
// the east chain's Stillstone woken.

import { expect } from 'vitest';
import {
  cornicePads,
  isleAt,
  isleSpots,
} from '../../src/sim/encounters/smith_heart/breath_isle_geometry';
import { ISLE_MOBS, ISLE_TUNING as IT } from '../../src/sim/encounters/smith_heart/breath_isle_ids';
import { DT, type Entity } from '../../src/sim/types';
import { type BreathFight, breathFight } from './breath_fight';

export const ticks = (s: number) => Math.round(s / DT);

/** Pulled, the air held still, every player on the threat table, the phase
 *  begun (`tier` '' Normal). */
export function islesFight(n = 6, tier: '' | 'heroic' = ''): BreathFight {
  const f = breathFight(n, 23);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  if (tier) f.dev(`/dev heart breath ${tier}`);
  f.tick(2);
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.wind.remaining = 9999;
  st.inhaleTimer = 9999;
  st.circleTimer = 9999;
  st.skyTimer = 9999;
  st.blowTimer = 9999;
  st.heartTimer = 9999;
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  b.hp = Math.floor(b.maxHp * IT.at) - 5;
  for (let i = 0; i < ticks(2) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
  expect(f.state()?.isles.stage).toBe('nova');
  return f;
}

/** Fell every living add of `isle` (through a Squall Ward). */
export function killIsle(f: BreathFight, isle: number): void {
  for (const a of f.state()?.isles.adds ?? []) {
    if (a.isle !== isle) continue;
    const e = f.sim.ctx.entities.get(a.id);
    if (e && !e.dead)
      f.sim.ctx.dealDamage(f.boss(), e, e.hp * 20 + 1, false, 'nature', 'Test', 'hit', true);
  }
  f.tick(2);
}

/** Ride `p` from `from` (-1 the Cornice) to isle `to`. */
export function ride(f: BreathFight, p: Entity, from: number, to: number): void {
  const at = from < 0 ? cornicePads()[isleSpots()[to].side] : isleSpots()[from].pad;
  if (!at) throw new Error('no pad');
  f.tick(ticks(IT.rideGrace + 0.1));
  f.put(p, at.x, at.z);
  f.tick(ticks(IT.rideSeconds + 0.6));
  expect(isleAt(f.local(p).x, f.local(p).z)).toBe(to);
}

/** `p` rides the east chain to its last isle, felling each isle's adds but
 *  the last's (`clearLast` false leaves them standing); returns the stone's
 *  body once it has risen (null while it waits). */
export function eastChain(f: BreathFight, p: Entity, clearLast = true): Entity | null {
  ride(f, p, -1, 0);
  killIsle(f, 0);
  ride(f, p, 0, 1);
  killIsle(f, 1);
  killIsle(f, 1);
  ride(f, p, 1, 2);
  if (clearLast) killIsle(f, 2);
  const id = f.state()?.isles.isles[2].stoneId ?? null;
  const stone = id !== null ? (f.sim.ctx.entities.get(id) ?? null) : null;
  if (stone) expect(stone.templateId).toBe(ISLE_MOBS.stillstone);
  return stone;
}

/** Put `p` on the east chain's last isle by its Stillstone (`k` fans them
 *  round it, all within reach). */
export function byStone(f: BreathFight, p: Entity, k: number): void {
  const sp = isleSpots()[2].stone;
  if (!sp) throw new Error('no stone spot');
  const a = (k / 6) * Math.PI * 2;
  f.put(p, sp.x + Math.sin(a) * 2.5, sp.z + Math.cos(a) * 2.5);
}
