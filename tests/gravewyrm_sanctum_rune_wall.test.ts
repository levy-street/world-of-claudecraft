// The Gravewyrm Sanctum's rune wall on the Anchor Ledge (design section 3, "a
// readable lore object"): the wall's art carries the Smith's runes, never
// letters (docs/design/dungeon-rework/kit: no language baked into the world),
// and its meaning reaches each player once per claim as a localized chat line
// when they walk up in front of it (src/sim/encounters/gravewyrm_sanctum/
// rune_wall.ts, re-localized by src/ui/sim_i18n.ts `log.sanctumRuneWall`).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUNE_WALL } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  inRuneWallReadZone,
  RUNE_WALL_LORE_LOG,
  tickSanctumEncounters,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { DICT, localizeSimText } from '../src/ui/sim_i18n';

const DUNGEON = 'gravewyrm_sanctum';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  o: { x: number; z: number };
}

function room(): Room {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev sanctum enter normal', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  sim.drainEvents();
  return { sim, inst, me: sim.player, o };
}

function place(r: Room, e: Entity, lx: number, lz: number): void {
  e.pos = r.sim.ctx.groundPos(r.o.x + lx, r.o.z + lz);
  e.prevPos = { ...e.pos };
  r.sim.ctx.rebucket(e);
}

/** One encounter pass; the rune wall lines it emitted. */
function step(r: Room): SimEvent[] {
  tickSanctumEncounters(r.sim.ctx);
  return r.sim
    .drainEvents()
    .filter((e) => e.type === 'log' && 'text' in e && e.text === RUNE_WALL_LORE_LOG);
}

const pidOf = (e: SimEvent): number | undefined => ('pid' in e ? e.pid : undefined);

describe('Gravewyrm Sanctum rune wall: the read zone', () => {
  it('reads only in front of the wall face, along its length', () => {
    const face = RUNE_WALL.x - RUNE_WALL.hw;
    // The evidence shot's spot and the ledge right before the face.
    expect(inRuneWallReadZone(96, -94)).toBe(true);
    expect(inRuneWallReadZone(face - 1, RUNE_WALL.z - RUNE_WALL.hd)).toBe(true);
    // Behind the face, too far west on the ledge, past either end.
    expect(inRuneWallReadZone(face + 0.5, RUNE_WALL.z)).toBe(false);
    expect(inRuneWallReadZone(face - 30, RUNE_WALL.z)).toBe(false);
    expect(inRuneWallReadZone(96, RUNE_WALL.z + RUNE_WALL.hd + 6)).toBe(false);
    expect(inRuneWallReadZone(96, RUNE_WALL.z - RUNE_WALL.hd - 6)).toBe(false);
    // The lower ledge below it never reads it.
    expect(inRuneWallReadZone(96, -40)).toBe(false);
  });
});

describe('Gravewyrm Sanctum rune wall: the lore line', () => {
  it('speaks once per player per claim, to that player only, on approach', () => {
    const r = room();
    // Far from the wall: nothing.
    place(r, r.me, 70, -94);
    expect(step(r)).toEqual([]);
    // Walking up: one line, to me.
    place(r, r.me, 96, -94);
    const first = step(r);
    expect(first).toHaveLength(1);
    expect(pidOf(first[0])).toBe(r.me.id);
    // Standing there, leaving and coming back: no repeat this claim.
    expect(step(r)).toEqual([]);
    place(r, r.me, 70, -94);
    expect(step(r)).toEqual([]);
    place(r, r.me, 98, -100);
    expect(step(r)).toEqual([]);
    // A second player reads it for themselves when they walk up, not before.
    const pid = r.sim.addPlayer('mage', 'Runereader');
    const other = r.sim.ctx.entities.get(pid) as Entity;
    place(r, other, 60, -90);
    expect(step(r)).toEqual([]);
    place(r, other, 100, -88);
    const second = step(r);
    expect(second.map(pidOf)).toEqual([pid]);
  });

  it('reads afresh in a new claim of the slot', () => {
    const r = room();
    place(r, r.me, 96, -94);
    expect(step(r)).toHaveLength(1);
    expect(step(r)).toEqual([]);
    // A freed and re-claimed slot has a new exit entity: the memory is the claim's.
    r.inst.exitId = (r.inst.exitId ?? 0) + 100000;
    expect(step(r)).toHaveLength(1);
  });

  it('is a known client line: the sim_i18n EXACT key carries the same English', () => {
    expect(DICT.en['log.sanctumRuneWall']).toBe(RUNE_WALL_LORE_LOG);
    expect(localizeSimText(RUNE_WALL_LORE_LOG)).not.toBeNull();
  });
});

describe('Gravewyrm Sanctum rune wall: no language in the art', () => {
  const kitDir = 'docs/design/dungeon-rework/kit';
  const gwkit = readFileSync(`${kitDir}/gwkit.py`, 'utf8');
  const builder = readFileSync(`${kitDir}/build_gravewyrm_sanctum_kit.py`, 'utf8');

  it("carves only the Smith's picture runes, never a letter or a stop", () => {
    const table = gwkit.slice(gwkit.indexOf('GLYPHS = {'), gwkit.indexOf('\n}\n'));
    const keys = [...table.matchAll(/^ {4}'([^']+)':/gm)].map((m) => m[1]);
    for (const rune of ['heat', 'hammer', 'quench', 'tongs', 'anvil', 'bellows', 'cartouche'])
      expect(keys, rune).toContain(rune);
    // A one-character key is an alphabet letter or punctuation.
    expect(keys.filter((k) => k.length < 2)).toEqual([]);
  });

  it('cuts the three acts as runes on the wall, no English words', () => {
    const start = builder.indexOf('def rune_wall():');
    const body = builder.slice(start, builder.indexOf('\ndef ', start + 1));
    expect(body).toMatch(/\('heat', \(/);
    expect(body).toMatch(/\('hammer', \(/);
    expect(body).toMatch(/\('quench', \(/);
    expect(body).not.toMatch(/'[A-Z]{2,}\.?'/);
    expect(body).not.toMatch(/word_width/);
  });
});
