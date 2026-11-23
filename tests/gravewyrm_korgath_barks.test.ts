// Korgath's shouts down at the wings before his pull
// (src/sim/encounters/gravewyrm_sanctum/korgath_barks.ts): one line per wing
// pack that falls (SANCTUM_WING_PACKS, the five the Chain Stairs wait on),
// escalating, each ONCE per claim, on the yell channel, only while a claim
// player is within earshot; a line earned out of earshot waits, and only the
// newest of several waiting is said. Silent in his fight. Every line is a
// known client line (the sim_i18n EXACT keys). Driven through
// tickSanctumEncounters inside a real claimed Sanctum.

import { describe, expect, it } from 'vitest';
import { SANCTUM_WING_PACKS } from '../src/sim/content/gravewyrm_sanctum';
import {
  GRAVEWYRM_SANCTUM_ANCHORS,
  KORGATH_SPOT,
} from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  KORGATH_BARK_RANGE,
  KORGATH_BARKS,
  KORGATH_ID,
  tickSanctumEncounters,
  wingPacksDown,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { claimBoss } from '../src/sim/encounters/gravewyrm_sanctum/claim';
import { KORGATH_LINES } from '../src/sim/encounters/gravewyrm_sanctum/korgath';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity, type SimEvent } from '../src/sim/types';
import { DICT, localizeSimText } from '../src/ui/sim_i18n';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  boss: Entity;
  o: { x: number; z: number };
}

function room(): Room {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev sanctum enter normal', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const o = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, inst.slot);
  const boss = claimBoss(sim.ctx, inst, KORGATH_ID) as Entity;
  sim.drainEvents();
  return { sim, inst, me: sim.player, boss, o };
}

function put(r: Room, lx: number, lz: number): void {
  r.me.pos = r.sim.ctx.groundPos(r.o.x + lx, r.o.z + lz);
  r.me.prevPos = { ...r.me.pos };
  r.sim.ctx.rebucket(r.me);
}

/** Tick the encounters and return Korgath's yells this tick. */
function yells(r: Room, seconds = DT): string[] {
  const out: string[] = [];
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    tickSanctumEncounters(r.sim.ctx);
    for (const e of r.sim.drainEvents() as SimEvent[]) {
      if (e.type !== 'chat') continue;
      const c = e as { channel: string; entityId?: number; text: string; pid?: number };
      if (c.channel === 'yell' && c.entityId === r.boss.id && c.pid === r.me.id) out.push(c.text);
    }
  }
  return out;
}

function kill(r: Room, pack: string): void {
  r.sim.chat(`/dev sanctum kill ${pack}`, r.me.id);
  r.sim.drainEvents();
}

describe('Korgath shouts down at the wings', () => {
  it('has one original line per wing pack, each a known client line', () => {
    expect(SANCTUM_WING_PACKS).toEqual(['g4', 'g5', 'pb', 'g6', 'g7']);
    expect(KORGATH_BARKS).toHaveLength(SANCTUM_WING_PACKS.length);
    expect(new Set(KORGATH_BARKS).size).toBe(KORGATH_BARKS.length);
    KORGATH_BARKS.forEach((line, i) => {
      expect((DICT.en as Record<string, string>)[`log.sanctumKorgathBark${i + 1}`]).toBe(line);
      expect(localizeSimText(line)).not.toBeNull();
      // No dash punctuation, no line he already says in his fight.
      expect(line).not.toMatch(/[–—]/);
      expect(Object.values(KORGATH_LINES)).not.toContain(line);
    });
  });

  it('escalates one line per fallen wing pack, each said once, in order', () => {
    const r = room();
    // On the Fork, between both wings: within earshot of the terrace.
    put(r, GRAVEWYRM_SANCTUM_ANCHORS.fork.x, GRAVEWYRM_SANCTUM_ANCHORS.fork.z);
    expect(dist2d(r.me.pos, r.boss.pos)).toBeLessThan(KORGATH_BARK_RANGE);
    expect(yells(r, 1)).toEqual([]);
    const said: string[] = [];
    for (const [i, pack] of SANCTUM_WING_PACKS.entries()) {
      kill(r, pack);
      expect(wingPacksDown(r.sim.ctx, r.inst)).toBe(i + 1);
      const now = yells(r, 1);
      expect(now).toEqual([KORGATH_BARKS[i]]);
      said.push(...now);
      // Never again, however long they linger.
      expect(yells(r, 2)).toEqual([]);
    }
    expect(said).toEqual([...KORGATH_BARKS]);
  });

  it('a line earned out of earshot waits; several waiting, only the newest is said', () => {
    const r = room();
    // Up on the Keystone Court, far above the terrace: he cannot be heard.
    put(r, GRAVEWYRM_SANCTUM_ANCHORS.court.x, GRAVEWYRM_SANCTUM_ANCHORS.court.z);
    expect(dist2d(r.me.pos, r.boss.pos)).toBeGreaterThan(KORGATH_BARK_RANGE);
    kill(r, 'g4');
    kill(r, 'g5');
    expect(yells(r, 1)).toEqual([]);
    // Down on the Fork: the newest line, once; the older one is spent.
    put(r, GRAVEWYRM_SANCTUM_ANCHORS.fork.x, GRAVEWYRM_SANCTUM_ANCHORS.fork.z);
    expect(yells(r, 1)).toEqual([KORGATH_BARKS[1]]);
    expect(yells(r, 1)).toEqual([]);
    kill(r, 'pb');
    expect(yells(r, 1)).toEqual([KORGATH_BARKS[2]]);
  });

  it('is silent once his fight has begun, and once he is dead', () => {
    const r = room();
    put(r, KORGATH_SPOT.x, KORGATH_SPOT.z - 6);
    tickSanctumEncounters(r.sim.ctx);
    r.boss.inCombat = true;
    r.boss.aiState = 'attack';
    r.boss.aggroTargetId = r.me.id;
    kill(r, 'g4');
    expect(yells(r, DT).filter((l) => KORGATH_BARKS.includes(l))).toEqual([]);
    const dead = room();
    put(dead, KORGATH_SPOT.x, KORGATH_SPOT.z - 6);
    dead.sim.chat('/dev sanctum kill korgath', dead.me.id);
    dead.sim.drainEvents();
    kill(dead, 'g4');
    expect(yells(dead, 1)).toEqual([]);
  });

  it('a freed and re-claimed slot hears him afresh', () => {
    const r = room();
    put(r, GRAVEWYRM_SANCTUM_ANCHORS.fork.x, GRAVEWYRM_SANCTUM_ANCHORS.fork.z);
    kill(r, 'g4');
    expect(yells(r, 1)).toEqual([KORGATH_BARKS[0]]);
    r.inst.exitId = (r.inst.exitId ?? 0) + 100000;
    expect(yells(r, 1)).toEqual([KORGATH_BARKS[0]]);
  });
});
