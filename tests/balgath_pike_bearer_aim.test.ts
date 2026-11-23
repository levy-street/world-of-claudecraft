// Boulder Toss and Foreman's Glare (mob/boss_ranged_mechanics.ts) exist to reach the caster
// parked far out. A Shardpike bearer holding still at range with the pike braced or
// steadied (lance_trial.ts) is doing what the fight asks, so neither aimed cast picks
// them: they choose among the other far players, and with nobody else far enough they do
// not fire. The meteors, geysers and pools still land anywhere.
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 180_000 });

import { MOBS } from '../src/sim/data';
import type { LancePhase } from '../src/sim/lance_trial';
import {
  BOULDER_ABILITY,
  GLARE_ABILITY,
  resetBossRangedMechanics,
  tickBossRangedMechanics,
} from '../src/sim/mob/boss_ranged_mechanics';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';

const kit = () => {
  const d = MOBS[BALGATH]?.rangedMechanics;
  if (!d) throw new Error('balgath_cyclops declares no rangedMechanics');
  return d;
};

function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}

interface Arena {
  sim: Sim;
  ctx: SimContext;
  boss: Entity;
  players: Entity[];
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.onGround = true;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
}

/** A boss held planted in melee with `extra` more players beside the default one. */
function arena(extra: number, seed = 7, at = lair()): Arena {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const id = (
    sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
  ).spawnDevBoss(BALGATH, at.x, at.z);
  const boss = sim.entities.get(id);
  if (!boss) throw new Error('no boss');
  place(sim, boss, at.x, at.z);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const players = [sim.player];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('priest', `Raider${i}`);
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
    if (!p) throw new Error('no raider');
    players.push(p);
  }
  for (const p of players) place(sim, p, at.x + 3, at.z);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  boss.swingTimer = Number.POSITIVE_INFINITY;
  resetBossRangedMechanics(ctx, boss);
  sim.drainEvents();
  return { sim, ctx, boss, players };
}

/** Park every other mechanic far in the future so only `kind` can come due. */
function only(a: Arena, kind: 'boulder' | 'glare' | 'burden'): void {
  a.boss.boulderTimer = kind === 'boulder' ? DT : 999;
  a.boss.glareTimer = kind === 'glare' ? DT : 999;
  a.boss.burdenTimer = kind === 'burden' ? DT : 999;
  a.boss.mechanicLockTimer = 0;
}

function tick(a: Arena, n = 1): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    tickBossRangedMechanics(a.ctx, a.boss);
    out.push(...a.sim.drainEvents());
  }
  return out;
}

function topUp(a: Arena): void {
  for (const p of a.players) p.hp = p.maxHp;
}

/** Put `p` into a live Shardpike brace in `phase` (the session's presence is the rule). */
function brace(a: Arena, p: Entity, phase: LancePhase): void {
  const meta = a.sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  meta.lance = { phase } as NonNullable<typeof meta.lance>;
}

const circles = (evs: SimEvent[], ability: string) =>
  evs.filter(
    (e) =>
      e.type === 'spellfxAt' &&
      (e as { ability?: string }).ability === ability &&
      (e as { fx: string }).fx === 'runeCircle',
  ) as Extract<SimEvent, { type: 'spellfxAt' }>[];

/** The boss plus two far players: `pike` at 32 yards (the farthest) and `caster` at 24. */
function farPair(seed: number, phase: LancePhase) {
  const a = arena(2, seed);
  const at = { x: a.boss.pos.x, z: a.boss.pos.z };
  const [, pike, caster] = a.players;
  place(a.sim, pike, at.x + 32, at.z);
  place(a.sim, caster, at.x, at.z + 24);
  brace(a, pike, phase);
  return { a, pike, caster };
}

describe('the aimed ranged casts leave the braced pike bearer alone', () => {
  for (const phase of ['bracing', 'steadied'] as const) {
    it(`Boulder Toss skips a ${phase} pike and lands on the other far player`, () => {
      const { a, pike, caster } = farPair(7, phase);
      only(a, 'boulder');
      const marks = circles(tick(a, 2), BOULDER_ABILITY);
      expect(marks.map((m) => m.targetId)).toEqual([caster.id]);
      expect(marks.some((m) => m.targetId === pike.id)).toBe(false);
    });

    it(`Foreman's Glare never locks onto a ${phase} pike`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const { a, pike, caster } = farPair(seed, phase);
        only(a, 'glare');
        tick(a, 2);
        expect(a.boss.rangedKind, `seed ${seed}`).toBe('glare');
        // The line is snapshot through the victim: it points at the caster, not the pike.
        const [ox, oz, dx, dz] = a.boss.rangedAim ?? [];
        const toCaster = Math.atan2(caster.pos.x - ox, caster.pos.z - oz);
        expect(Math.atan2(dx, dz)).toBeCloseTo(toCaster, 6);
        expect(Math.atan2(pike.pos.x - ox, pike.pos.z - oz)).not.toBeCloseTo(toCaster, 2);
      }
    });
  }

  it('with only the braced pike far out, neither fires', () => {
    for (const kind of ['boulder', 'glare'] as const) {
      const { a, caster } = farPair(3, 'steadied');
      place(a.sim, caster, a.boss.pos.x + 3, a.boss.pos.z);
      only(a, kind);
      const evs = tick(a, 20);
      expect(circles(evs, BOULDER_ABILITY)).toHaveLength(0);
      expect(circles(evs, GLARE_ABILITY)).toHaveLength(0);
      expect(a.boss.rangedKind ?? null).toBeNull();
    }
  });

  it('the moment the pike comes down, the bearer is fair game again', () => {
    const { a, pike, caster } = farPair(7, 'steadied');
    place(a.sim, caster, a.boss.pos.x + 3, a.boss.pos.z);
    const meta = a.sim.players.get(pike.id);
    if (meta) meta.lance = undefined;
    only(a, 'boulder');
    expect(circles(tick(a, 2), BOULDER_ABILITY).map((m) => m.targetId)).toEqual([pike.id]);
  });
});
