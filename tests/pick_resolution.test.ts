import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  CANDLE_TALLOW_RADIUS,
  CANDLE_WICK_Y,
} from '../src/render/hollow_crypt/morthen_rite_fx_core';
import {
  type PickRay,
  rayAimsAtCore,
  rayDistanceToVerticalSegment,
} from '../src/render/pick_aim_core';
import { resolveDirectPickEntityId } from '../src/render/pick_resolution';
import { isAimedAt, isUseOnlyBody, resolveWorldDirectPick } from '../src/render/world_direct_pick';
import { HOLLOW_CRYPT_RING } from '../src/sim/content/hollow_crypt_layout';
import { MOBS } from '../src/sim/data';
import {
  cryptDevTrigger,
  MORTHEN_ID,
  MORTHEN_SPOT,
  RITE_CANDLE_RADIUS,
  RITE_CANDLE_SPOTS,
} from '../src/sim/encounters/hollow_crypt';
import { createMob, createPlayer } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';
import { boss, cryptFight, put, run } from './helpers/crypt_boss_fight';

type TestPickEntity = {
  id: number;
  kind: 'mob' | 'object' | 'player' | 'npc';
  dead: boolean;
  lootable: boolean;
  /** A body the local player can only use (the resolver's fourth argument reads it). */
  useOnly?: boolean;
};

function entities(
  list: Array<{
    id: number;
    kind: TestPickEntity['kind'];
    dead?: boolean;
    lootable?: boolean;
    useOnly?: boolean;
  }>,
): Map<number, TestPickEntity> {
  return new Map(
    list.map((e) => [
      e.id,
      {
        dead: false,
        lootable: false,
        ...e,
      },
    ]),
  );
}

describe('resolveDirectPickEntityId', () => {
  it('keeps a normal single lootable corpse pick unchanged', () => {
    const map = entities([{ id: 10, kind: 'mob', dead: true, lootable: true }]);
    expect(resolveDirectPickEntityId([10], map, 10)).toBe(10);
  });

  it('treats a dead player holding World PvP spoils as a lootable corpse', () => {
    // Stacked with a mob corpse: the pair cycles like two corpses do.
    const map = entities([
      { id: 10, kind: 'player', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 11], map, 10)).toBe(11);
    // And a live fighter behind the body still wins the click.
    const withLive = entities([
      { id: 10, kind: 'player', dead: true, lootable: true },
      { id: 12, kind: 'player' },
    ]);
    expect(resolveDirectPickEntityId([10, 12], withLive)).toBe(12);
  });

  it('skips an already-unlootable corpse to reach a stacked lootable corpse', () => {
    const map = entities([
      { id: 10, kind: 'mob', dead: true, lootable: false },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 11], map)).toBe(11);
  });

  it('cycles to the next lootable corpse in a stacked direct-hit set', () => {
    const map = entities([
      { id: 10, kind: 'mob', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
      { id: 12, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 11, 12], map, 10)).toBe(11);
    expect(resolveDirectPickEntityId([10, 11, 12], map, 11)).toBe(12);
    expect(resolveDirectPickEntityId([10, 11, 12], map, 12)).toBe(10);
  });

  it('dedupes repeated child hits before cycling stacked corpses', () => {
    const map = entities([
      { id: 10, kind: 'mob', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 10, 11], map, 10)).toBe(11);
  });

  it('does not bypass a non-corpse first hit while cycling corpses', () => {
    const map = entities([
      { id: 9, kind: 'mob', dead: false },
      { id: 10, kind: 'mob', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([9, 10, 11], map, 10)).toBe(9);
  });

  it('preserves unlootable object blocking behavior', () => {
    const map = entities([
      { id: 20, kind: 'object', lootable: false },
      { id: 10, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([20, 10], map)).toBeNull();
  });

  it('selects the ward spike first in a spike-over-raider stack, then cycles to the raider', () => {
    // A Nythraxis Bone Spike (click capsule 2.6, v0.42.2) always contains the
    // raider it pins. The first click takes the nearest live hit, the spike;
    // a second click on the same stack advances to the impaled raider, so a
    // world click can still reach them (the raid frames reach them at once).
    const map = entities([
      { id: 30, kind: 'mob', dead: false, lootable: false },
      { id: 31, kind: 'player', dead: false, lootable: false },
    ]);
    expect(resolveDirectPickEntityId([30, 31], map, null)).toBe(30);
    expect(resolveDirectPickEntityId([30, 31], map, 30)).toBe(31);
    // A shattered spike no longer stands in the way.
    const shattered = entities([
      { id: 30, kind: 'mob', dead: true, lootable: false },
      { id: 31, kind: 'player', dead: false, lootable: false },
    ]);
    expect(resolveDirectPickEntityId([30, 31], shattered, null)).toBe(31);
  });

  it('keeps a dead player directly pickable for combat resurrection targeting', () => {
    const map = entities([{ id: 30, kind: 'player', dead: true, lootable: false }]);
    expect(resolveDirectPickEntityId([30], map)).toBe(30);
  });

  describe('overlapping live targets', () => {
    it('cycles through live targets on repeated direct clicks', () => {
      const map = entities([
        { id: 10, kind: 'mob' },
        { id: 11, kind: 'mob' },
        { id: 12, kind: 'mob' },
      ]);

      expect(resolveDirectPickEntityId([10, 11, 12], map)).toBe(10);
      expect(resolveDirectPickEntityId([10, 11, 12], map, 10)).toBe(11);
      expect(resolveDirectPickEntityId([10, 11, 12], map, 11)).toBe(12);
      expect(resolveDirectPickEntityId([10, 11, 12], map, 12)).toBe(10);
    });

    it('dedupes repeated child hits before cycling live targets', () => {
      const map = entities([
        { id: 10, kind: 'mob' },
        { id: 11, kind: 'mob' },
      ]);

      expect(resolveDirectPickEntityId([10, 10, 11], map, 10)).toBe(11);
    });

    it('keeps the nearest live target when the current target is outside the hit set', () => {
      const map = entities([
        { id: 10, kind: 'mob' },
        { id: 11, kind: 'mob' },
      ]);

      expect(resolveDirectPickEntityId([10, 11], map, 99)).toBe(10);
    });

    it('cycles live targets even when a lootable corpse is the frontmost hit', () => {
      const map = entities([
        { id: 9, kind: 'mob', dead: true, lootable: true },
        { id: 10, kind: 'mob' },
        { id: 11, kind: 'mob' },
      ]);

      expect(resolveDirectPickEntityId([9, 10, 11], map)).toBe(10);
      expect(resolveDirectPickEntityId([9, 10, 11], map, 10)).toBe(11);
      expect(resolveDirectPickEntityId([9, 10, 11], map, 11)).toBe(10);
    });
  });

  describe('issue #2787: live mob wins over an overlapping corpse', () => {
    it('prefers a live mob behind the frontmost corpse instead of opening loot', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true }, // ray hits this first
        { id: 11, kind: 'mob', dead: false }, // the last living mob, farther along the ray
      ]);
      expect(resolveDirectPickEntityId([10, 11], map)).toBe(11);
    });

    it('prefers a live PLAYER over a leading corpse too', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 12, kind: 'player', dead: false },
      ]);
      expect(resolveDirectPickEntityId([10, 12], map)).toBe(12);
    });

    it('picks the NEAREST live mob when several are behind the leading corpse', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 11, kind: 'mob', dead: false },
        { id: 13, kind: 'mob', dead: false },
      ]);
      expect(resolveDirectPickEntityId([10, 11, 13], map)).toBe(11);
    });

    it('still cycles among corpses when no live entity is in the hit set', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 11, kind: 'mob', dead: true, lootable: true },
      ]);
      expect(resolveDirectPickEntityId([10, 11], map, 10)).toBe(11); // unchanged
    });

    it('ignores a live-but-unselectable object hit behind the corpse', () => {
      // A lootable ground object is never target-selectable (kind 'object'), so
      // it must not steal the pick away from the ordinary corpse-loot branch.
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 14, kind: 'object', lootable: true },
      ]);
      expect(resolveDirectPickEntityId([10, 14], map)).toBe(10); // unchanged
    });

    it('still opens loot when the corpse is genuinely alone (lone-corpse looting preserved)', () => {
      const map = entities([{ id: 10, kind: 'mob', dead: true, lootable: true }]);
      expect(resolveDirectPickEntityId([10], map)).toBe(10);
    });

    it('ignores a live NPC behind the corpse: loot the corpse, not the NPC (OSSBrain review)', () => {
      // A non-hostile NPC is never a valid direct-pick target (npc dialog is
      // opened through interact/proximity, not click-pick priority), so it
      // must not steal the pick away from the ordinary corpse-loot branch,
      // same as the 'object' case above.
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 15, kind: 'npc', dead: false },
      ]);
      expect(resolveDirectPickEntityId([10, 15], map)).toBe(10); // unchanged
    });
  });

  // The Hollow Crypt's Rite of the Unquiet: Morthen stands at the altar with a
  // click capsule far wider than his body, on the line a player walks up to the
  // north Remembrance Candle from, so the ray reached him first and every click
  // on that candle selected the boss. A body the local player can only USE, and
  // AIMED this click at, is what the click selects, whatever stands in front
  // of it and whatever is targeted. (`useOnly` on a test entity stands for the
  // caller's whole predicate: use-only and aimed at.)
  describe('use-only encounter bodies', () => {
    const useOnly = (e: TestPickEntity): boolean => e.useOnly === true;
    const BOSS = 40;
    const ADD = 41;
    const CANDLE = 42;

    it('selects the usable body on the first click when a boss capsule is in front', () => {
      const map = entities([
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map, null, useOnly)).toBe(CANDLE);
      // A target held somewhere else changes nothing: the body still wins.
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map, 99, useOnly)).toBe(CANDLE);
    });

    it('wins over every live mob in front of it, adds included', () => {
      const map = entities([
        { id: ADD, kind: 'mob' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([ADD, BOSS, CANDLE], map, null, useOnly)).toBe(CANDLE);
    });

    it('is selected before any cycling, whatever the player holds as target', () => {
      const map = entities([
        { id: ADD, kind: 'mob' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      // Holding the boss is the normal state when the Rite begins. With a third
      // live hit in the stack, overlap cycling used to step past the candle.
      expect(resolveDirectPickEntityId([BOSS, CANDLE, ADD], map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, ADD, CANDLE], map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([ADD, BOSS, CANDLE], map, ADD, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([ADD, BOSS, CANDLE], map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map, BOSS, useOnly)).toBe(CANDLE);
      // The same clicks without the rule walk the ray from the held target.
      expect(resolveDirectPickEntityId([BOSS, CANDLE, ADD], map, BOSS)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, ADD, CANDLE], map, BOSS)).toBe(ADD);
      expect(resolveDirectPickEntityId([ADD, BOSS, CANDLE], map, ADD)).toBe(BOSS);
    });

    it('a repeat click on the body keeps the body: no step to the next hit', () => {
      const map = entities([
        { id: ADD, kind: 'mob' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      // A double click, or a spammed right click, must not alternate between
      // the candle and the boss in front of it.
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map, CANDLE, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([CANDLE, BOSS], map, CANDLE, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([ADD, BOSS, CANDLE], map, CANDLE, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, CANDLE, ADD], map, CANDLE, useOnly)).toBe(CANDLE);
      // Without the rule the repeat click steps on.
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map, CANDLE)).toBe(BOSS);
    });

    it('a click that is not aimed at the body cycles the live hits exactly as before', () => {
      // The body is in the stack (its wide capsule was crossed) but the caller's
      // predicate says no: plain ray order, first pick and ring alike.
      const map = entities([
        { id: ADD, kind: 'mob' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: false },
      ]);
      const stack = [ADD, BOSS, CANDLE];
      expect(resolveDirectPickEntityId(stack, map, null, useOnly)).toBe(ADD);
      expect(resolveDirectPickEntityId(stack, map, ADD, useOnly)).toBe(BOSS);
      expect(resolveDirectPickEntityId(stack, map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId(stack, map, CANDLE, useOnly)).toBe(ADD);
      expect(resolveDirectPickEntityId(stack, map, 99, useOnly)).toBe(ADD);
    });

    it('wins over a leading lootable corpse and over the live mob behind that corpse', () => {
      const map = entities([
        { id: 9, kind: 'mob', dead: true, lootable: true },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([9, CANDLE], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([CANDLE, 9], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([9, BOSS, CANDLE], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([9, BOSS, CANDLE], map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([9, BOSS, CANDLE], map, CANDLE, useOnly)).toBe(CANDLE);
      // A stack of corpses alone has no live hit to ask about: loot as ever.
      expect(resolveDirectPickEntityId([9], map, null, useOnly)).toBe(9);
      expect(resolveDirectPickEntityId([9], map, CANDLE, useOnly)).toBe(9);
      // With the body the only live hit it keeps the click (the #2787 rule):
      // a repeat click does not fall through to the corpse.
      expect(resolveDirectPickEntityId([9, CANDLE], map, CANDLE, useOnly)).toBe(CANDLE);
    });

    it('selects a usable body standing alone, and keeps it on a repeat click', () => {
      const map = entities([{ id: CANDLE, kind: 'mob', useOnly: true }]);
      expect(resolveDirectPickEntityId([CANDLE], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([CANDLE], map, CANDLE, useOnly)).toBe(CANDLE);
    });

    it('two aimed bodies in one stack: nearest first, a repeat click alternates those two', () => {
      const map = entities([
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
        { id: 43, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([BOSS, CANDLE, 43], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, CANDLE, 43], map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, CANDLE, 43], map, CANDLE, useOnly)).toBe(43);
      // Back to the first body, never on to the boss.
      expect(resolveDirectPickEntityId([BOSS, CANDLE, 43], map, 43, useOnly)).toBe(CANDLE);
      // A mob between the two bodies on the ray changes nothing.
      expect(resolveDirectPickEntityId([CANDLE, BOSS, 43], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([CANDLE, BOSS, 43], map, CANDLE, useOnly)).toBe(43);
      expect(resolveDirectPickEntityId([CANDLE, BOSS, 43], map, 43, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([CANDLE, BOSS, 43], map, BOSS, useOnly)).toBe(CANDLE);
      // Ray order decides which of the two is "nearest".
      expect(resolveDirectPickEntityId([43, BOSS, CANDLE], map, null, useOnly)).toBe(43);
    });

    it('leaves the click with a live player who is the nearest hit', () => {
      // A healer clicking the party member who stands at the candle lighting it
      // must reach that player, not the body behind them.
      const map = entities([
        { id: 50, kind: 'player' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([50, CANDLE], map, null, useOnly)).toBe(50);
      expect(resolveDirectPickEntityId([50, BOSS, CANDLE], map, null, useOnly)).toBe(50);
      // Ray order stands for the whole ring too, not only for the first pick.
      expect(resolveDirectPickEntityId([50, BOSS, CANDLE], map, CANDLE, useOnly)).toBe(50);
      expect(resolveDirectPickEntityId([50, BOSS, CANDLE], map, 50, useOnly)).toBe(BOSS);
      // A corpse in front of that player changes nothing: the player is still
      // the nearest LIVE hit.
      const withCorpse = entities([
        { id: 9, kind: 'mob', dead: true, lootable: true },
        { id: 50, kind: 'player' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([9, 50, CANDLE], withCorpse, null, useOnly)).toBe(50);
      // A player BEHIND the boss is not what the click landed on: the body wins,
      // and keeps winning.
      expect(resolveDirectPickEntityId([BOSS, 50, CANDLE], map, null, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, 50, CANDLE], map, CANDLE, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, 50, CANDLE], map, BOSS, useOnly)).toBe(CANDLE);
      expect(resolveDirectPickEntityId([BOSS, 50, CANDLE], map, 50, useOnly)).toBe(CANDLE);
    });

    it('a dead body no longer wins anything, lootable or not', () => {
      const spent = entities([
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', dead: true, useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([BOSS, CANDLE], spent, null, useOnly)).toBe(BOSS);
      expect(resolveDirectPickEntityId([CANDLE, BOSS], spent, null, useOnly)).toBe(BOSS);
      // A body that left a lootable corpse is a corpse like any other: it is
      // never asked about, and it does not pull the click off the live mobs.
      const corpse = entities([
        { id: ADD, kind: 'mob' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', dead: true, lootable: true, useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([ADD, BOSS, CANDLE], corpse, null, useOnly)).toBe(ADD);
      expect(resolveDirectPickEntityId([CANDLE, ADD, BOSS], corpse, null, useOnly)).toBe(ADD);
    });

    it('only ever asks a live mob whether it is a usable body', () => {
      const asked: number[] = [];
      const map = entities([
        { id: 9, kind: 'mob', dead: true, lootable: true },
        { id: BOSS, kind: 'mob' },
        { id: 50, kind: 'player' },
      ]);
      const spy = (e: TestPickEntity): boolean => {
        asked.push(e.id);
        return true;
      };
      expect(resolveDirectPickEntityId([9, BOSS, 50], map, null, spy)).toBe(BOSS);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((id) => id === BOSS)).toBe(true);
    });

    it('keeps every older rule: an unlootable object still blocks, an npc still leads', () => {
      const map = entities([
        { id: 20, kind: 'object', lootable: false },
        { id: 15, kind: 'npc' },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([20, BOSS, CANDLE], map, null, useOnly)).toBeNull();
      expect(resolveDirectPickEntityId([15, BOSS, CANDLE], map, null, useOnly)).toBe(15);
      // A fallen party member lying nearest stays pickable for a resurrection.
      const fallen = entities([
        { id: 51, kind: 'player', dead: true },
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([51, BOSS, CANDLE], fallen, null, useOnly)).toBe(51);
    });

    it('without the predicate the nearest live mob still wins', () => {
      const map = entities([
        { id: BOSS, kind: 'mob' },
        { id: CANDLE, kind: 'mob', useOnly: true },
      ]);
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map)).toBe(BOSS);
      expect(resolveDirectPickEntityId([BOSS, CANDLE], map, BOSS)).toBe(CANDLE);
    });
  });
});

const rayFrom = (
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): PickRay => ({
  origin: from,
  direction: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
});

// The geometry under "was the click aimed at it" (pick_aim_core.ts): the
// distance from a pick ray to the vertical segment of what the player sees.
describe('rayDistanceToVerticalSegment', () => {
  // A segment at the origin, 4 yd tall.
  const dist = (ray: PickRay): number => rayDistanceToVerticalSegment(ray, 0, 0, 0, 4);
  const level = (x: number, y: number): PickRay => ({
    origin: { x, y, z: 10 },
    direction: { x: 0, y: 0, z: -1 },
  });

  it('measures a level ray beside the segment in plan', () => {
    expect(dist(level(0, 2))).toBe(0);
    expect(dist(level(1.5, 2))).toBe(1.5);
    expect(dist(level(-2.25, 0.5))).toBe(2.25);
    // The direction's length is not part of the answer.
    expect(dist({ origin: { x: 1.5, y: 2, z: 10 }, direction: { x: 0, y: 0, z: -7 } })).toBe(1.5);
  });

  it('measures to the top when the ray passes over the segment', () => {
    // Straight over the axis, 2 yd above the top: an endless axis would call
    // that a direct hit.
    expect(dist(level(0, 6))).toBe(2);
    expect(dist(level(1.5, 6))).toBeCloseTo(2.5, 12);
    // A rising ray that crosses the axis 2 yd over the top.
    const rising = rayFrom({ x: 0, y: 1, z: 10 }, { x: 0, y: 6, z: 0 });
    expect(dist(rising)).toBeCloseTo(20 / Math.sqrt(125), 12);
  });

  it('holds for a camera looking steeply down', () => {
    const down = (x: number, z: number): PickRay => ({
      origin: { x, y: 30, z },
      direction: { x: 0, y: -1, z: 0 },
    });
    // Straight down the axis, and straight down beside it.
    expect(dist(down(0, 0))).toBe(0);
    expect(dist(down(2, 0))).toBe(2);
    expect(dist(down(0, -3))).toBe(3);
    // A steep click on the floor 3 yd in front of the foot. Carried on under
    // the floor that ray crosses the axis itself, 90 yd down.
    expect(dist(rayFrom({ x: 0, y: 30, z: -4 }, { x: 0, y: 0, z: -3 }))).toBeCloseTo(3, 9);
  });

  it('stops at the floor: the ground in front of the foot is not the foot', () => {
    // A shallow camera, a click on the floor 5 yd short of the segment. Under
    // the floor the same ray would pass 0.9 yd below the foot.
    const short = rayFrom({ x: 0, y: 3, z: 20 }, { x: 0, y: 0, z: 5 });
    expect(dist(short)).toBeCloseTo(5, 9);
    // A click on the floor 1 yd in front of the foot is 1 yd from it.
    expect(dist(rayFrom({ x: 0, y: 3, z: 20 }, { x: 0, y: 0, z: 1 }))).toBeCloseTo(1, 9);
    // A ray that starts under the floor and runs down never reaches it.
    expect(dist({ origin: { x: 0, y: -2, z: 3 }, direction: { x: 0, y: -1, z: -1 } })).toBeCloseTo(
      Math.hypot(2, 3),
      12,
    );
  });

  it('does not look behind the camera', () => {
    expect(dist({ origin: { x: 0, y: 2, z: -5 }, direction: { x: 0, y: 0, z: -1 } })).toBe(5);
  });
});

describe('rayAimsAtCore', () => {
  const core = { back: 2, radius: 1.25, height: 4 };

  it('stands the core behind the body along its facing', () => {
    const down = (x: number, z: number): PickRay => ({
      origin: { x, y: 50, z },
      direction: { x: 0, y: -1, z: 0 },
    });
    const pos = { x: 10, y: 5, z: 20 };
    // Facing +z: the core is 2 yd toward -z. Facing +x: 2 yd toward -x.
    expect(rayAimsAtCore(down(10, 18), { pos, facing: 0 }, core)).toBe(true);
    expect(rayAimsAtCore(down(10, 22), { pos, facing: 0 }, core)).toBe(false);
    expect(rayAimsAtCore(down(8, 20), { pos, facing: Math.PI / 2 }, core)).toBe(true);
    expect(rayAimsAtCore(down(12, 20), { pos, facing: Math.PI / 2 }, core)).toBe(false);
    // The body's own axis is 2 yd from the core: outside a 1.25 yd radius.
    expect(rayAimsAtCore(down(10, 20), { pos, facing: 0 }, core)).toBe(false);
    expect(rayAimsAtCore(down(10, 20), { pos, facing: 0 }, { ...core, back: 0 })).toBe(true);
  });

  it('counts the radius itself and nothing past it', () => {
    const body = { pos: { x: 0, y: 0, z: 0 }, facing: 0 };
    const onAxis = { ...core, back: 0 };
    const level = (x: number, y: number): PickRay => ({
      origin: { x, y, z: 10 },
      direction: { x: 0, y: 0, z: -1 },
    });
    expect(rayAimsAtCore(level(1.25, 2), body, onAxis)).toBe(true);
    expect(rayAimsAtCore(level(1.2500001, 2), body, onAxis)).toBe(false);
    expect(rayAimsAtCore(level(-1.25, 2), body, onAxis)).toBe(true);
    // Over the top the core is rounded: the radius counts from the top end.
    expect(rayAimsAtCore(level(0, 5.25), body, onAxis)).toBe(true);
    expect(rayAimsAtCore(level(0, 5.2500001), body, onAxis)).toBe(false);
    // The core starts at the body's feet, wherever the body stands.
    const raised = { pos: { x: 0, y: 100, z: 0 }, facing: 0 };
    expect(rayAimsAtCore(level(0, 102), raised, onAxis)).toBe(true);
    expect(rayAimsAtCore(level(0, 2), raised, onAxis)).toBe(false);
  });
});

// The renderer's entry (world_direct_pick.ts): the same resolver fed from the
// live world, the real content tables and the pick ray.
describe('resolveWorldDirectPick', () => {
  const at = { x: 0, y: 0, z: 0 };
  // The candle body stands at the origin facing +z (toward the ring's centre),
  // so its pillar, what the player sees, is 1.9 yd behind it at z = -1.9.
  const PILLAR = { x: 0, z: -1.9 };
  const CAMERA = { x: 0.5, y: 7, z: 14 };
  /** A click on the pillar's tallow, chest high. */
  const AT_PILLAR = rayFrom(CAMERA, { x: PILLAR.x, y: 1.8, z: PILLAR.z });
  /** A click a yard and a half to the side of the pillar: still inside the
   *  body's 2.2 yd click capsule, but on whatever stands beside the candle. */
  const BESIDE_PILLAR = rayFrom(CAMERA, { x: PILLAR.x + 1.5, y: 1.2, z: PILLAR.z });

  function mob(id: number, templateId: string): Entity {
    const template = MOBS[templateId];
    if (!template) throw new Error(`no mob template ${templateId}`);
    return createMob(id, template, template.minLevel, at);
  }

  /** The Remembrance Candle's body as the Rite stands it (morthen_candles.ts). */
  function candleBody(id: number): Entity {
    const body = mob(id, 'crypt_remembrance_candle');
    body.hostile = false;
    body.facing = 0;
    return body;
  }

  function candleCore() {
    const core = VISUALS.crypt_rite_candle_body?.aimCore;
    if (!core) throw new Error('the candle body declares no aim core');
    return core;
  }

  function world(list: Entity[], targetId: number | null = null) {
    const player = createPlayer(1, 'warrior', at, 'Tester');
    player.targetId = targetId;
    return { player: player as Entity | null, entities: new Map(list.map((e) => [e.id, e])) };
  }

  it('the Remembrance Candle wins a click aimed at its pillar through Morthen', () => {
    const morthen = mob(40, 'morthen');
    const bones = mob(41, 'marrow_restless_bones');
    const candle = candleBody(42);
    expect(morthen.hostile).toBe(true);
    expect(isUseOnlyBody(candle)).toBe(true);
    expect(isUseOnlyBody(morthen)).toBe(false);
    expect(isAimedAt(candle, AT_PILLAR)).toBe(true);
    expect(resolveWorldDirectPick([40, 42], world([morthen, candle]), AT_PILLAR)).toBe(42);
    expect(resolveWorldDirectPick([41, 40, 42], world([morthen, bones, candle]), AT_PILLAR)).toBe(
      42,
    );
  });

  it('holding Morthen (or an add) as target does not cost the aimed candle its click', () => {
    const morthen = mob(40, 'morthen');
    const bones = mob(41, 'marrow_restless_bones');
    const candle = candleBody(42);
    const all = [morthen, bones, candle];
    // The reviewer's three probes of the old ring: each returned the add or the boss.
    expect(resolveWorldDirectPick([40, 42, 41], world(all, 40), AT_PILLAR)).toBe(42);
    expect(resolveWorldDirectPick([40, 41, 42], world(all, 40), AT_PILLAR)).toBe(42);
    expect(resolveWorldDirectPick([41, 40, 42], world(all, 41), AT_PILLAR)).toBe(42);
    // The same spot again, and again: still the candle.
    expect(resolveWorldDirectPick([40, 42], world(all, 42), AT_PILLAR)).toBe(42);
    expect(resolveWorldDirectPick([41, 40, 42], world(all, 42), AT_PILLAR)).toBe(42);
    // Off the pillar the held candle steps on to the mob under the cursor, and
    // the ring among the live hits is the old one.
    expect(resolveWorldDirectPick([40, 42], world(all, 42), BESIDE_PILLAR)).toBe(40);
    expect(resolveWorldDirectPick([41, 40, 42], world(all, 42), BESIDE_PILLAR)).toBe(41);
    expect(resolveWorldDirectPick([41, 40, 42], world(all, 41), BESIDE_PILLAR)).toBe(40);
  });

  it('a click beside the pillar keeps ray order though it crosses the candle capsule', () => {
    const morthen = mob(40, 'morthen');
    const bones = mob(41, 'marrow_restless_bones');
    const candle = candleBody(42);
    // The ray really is inside the body's click capsule (radius 2.2, height
    // 3.6 at the body's own axis) and really is off the candle.
    expect(rayDistanceToVerticalSegment(BESIDE_PILLAR, 0, 0, 0, 3.6)).toBeLessThan(2.2);
    expect(
      rayDistanceToVerticalSegment(BESIDE_PILLAR, PILLAR.x, PILLAR.z, 0, candleCore().height),
    ).toBeGreaterThan(candleCore().radius);
    expect(isAimedAt(candle, BESIDE_PILLAR)).toBe(false);
    // The skeleton or the boss under the cursor is what the click selects.
    expect(resolveWorldDirectPick([41, 42], world([bones, candle]), BESIDE_PILLAR)).toBe(41);
    expect(resolveWorldDirectPick([40, 42], world([morthen, candle]), BESIDE_PILLAR)).toBe(40);
    expect(
      resolveWorldDirectPick([41, 40, 42], world([morthen, bones, candle]), BESIDE_PILLAR),
    ).toBe(41);
    // And the ring there is plain ray order: add, boss, candle, add.
    const stack = [41, 40, 42];
    const all = [morthen, bones, candle];
    expect(resolveWorldDirectPick(stack, world(all, 41), BESIDE_PILLAR)).toBe(40);
    expect(resolveWorldDirectPick(stack, world(all, 40), BESIDE_PILLAR)).toBe(42);
    expect(resolveWorldDirectPick(stack, world(all, 42), BESIDE_PILLAR)).toBe(41);
  });

  it('with nothing nearer under the cursor the whole capsule still selects the candle', () => {
    const morthen = mob(40, 'morthen');
    const candle = candleBody(42);
    expect(resolveWorldDirectPick([42], world([candle]), BESIDE_PILLAR)).toBe(42);
    // The boss BEHIND the candle on the ray does not change that.
    expect(resolveWorldDirectPick([42, 40], world([morthen, candle]), BESIDE_PILLAR)).toBe(42);
  });

  it('promotes at the core radius and not a hair past it', () => {
    const morthen = mob(40, 'morthen');
    const candle = candleBody(42);
    const { radius, height } = candleCore();
    const pick = (ray: PickRay) => resolveWorldDirectPick([40, 42], world([morthen, candle]), ray);
    // A level ray down the -z axis, passing the pillar's axis at `x`, `y` up.
    const level = (x: number, y: number): PickRay => ({
      origin: { x: PILLAR.x + x, y, z: 14 },
      direction: { x: 0, y: 0, z: -1 },
    });
    expect(pick(level(radius, 1.8))).toBe(42);
    expect(pick(level(radius + 1e-6, 1.8))).toBe(40);
    expect(pick(level(-radius, 1.8))).toBe(42);
    expect(pick(level(-radius - 1e-6, 1.8))).toBe(40);
    // Over the wick: the core's rounded top.
    expect(pick(level(0, height + radius - 1e-6))).toBe(42);
    expect(pick(level(0, height + radius + 1e-6))).toBe(40);
  });

  it('follows the pillar, not the body, from any side', () => {
    const morthen = mob(40, 'morthen');
    const candle = candleBody(42);
    const pick = (ray: PickRay) => resolveWorldDirectPick([40, 42], world([morthen, candle]), ray);
    // A camera off to the side, looking along -x.
    const fromSide = (z: number): PickRay => ({
      origin: { x: 14, y: 1.8, z },
      direction: { x: -1, y: 0, z: 0 },
    });
    expect(pick(fromSide(PILLAR.z))).toBe(42);
    // Through the BODY's own axis, 1.9 yd in front of the pillar: not the candle.
    expect(pick(fromSide(0))).toBe(40);
    // The body turned to face +x: its pillar is now 1.9 yd toward -x.
    candle.facing = Math.PI / 2;
    const down = (x: number, z: number): PickRay => ({
      origin: { x, y: 40, z },
      direction: { x: 0, y: -1, z: 0 },
    });
    expect(pick(down(-1.9, 0))).toBe(42);
    expect(pick(down(0, -1.9))).toBe(40);
  });

  it('holds for a camera looking steeply down, and for clicks on the floor', () => {
    const morthen = mob(40, 'morthen');
    const candle = candleBody(42);
    const pick = (ray: PickRay) => resolveWorldDirectPick([40, 42], world([morthen, candle]), ray);
    const steep = { x: 0.3, y: 30, z: 2 };
    // Down onto the wick, and down onto the pillar's foot.
    expect(pick(rayFrom(steep, { x: PILLAR.x, y: 3.55, z: PILLAR.z }))).toBe(42);
    expect(pick(rayFrom(steep, { x: PILLAR.x, y: 0, z: PILLAR.z }))).toBe(42);
    // Down onto the floor at the body's feet, 1.9 yd in front of the pillar.
    expect(pick(rayFrom(steep, { x: 0, y: 0, z: 0 }))).toBe(40);
    // A shallow camera, a click on the floor 5 yd short of the pillar: the ray
    // would pass under the pillar's foot if the floor were not there.
    const shallow = { x: 0, y: 3, z: 20 };
    expect(pick(rayFrom(shallow, { x: 0, y: 0, z: PILLAR.z + 5 }))).toBe(40);
    expect(pick(rayFrom(shallow, { x: 0, y: 0, z: PILLAR.z + 1 }))).toBe(42);
  });

  it('the candle body declares a core the size of its pillar', () => {
    const core = candleCore();
    // As tall as the wick; wider than the tallow column, narrower than the
    // pillar's collider (no mob can stand inside the core).
    expect(core.height).toBe(CANDLE_WICK_Y);
    expect(core.radius).toBeGreaterThan(CANDLE_TALLOW_RADIUS);
    expect(core.radius).toBeLessThan(RITE_CANDLE_RADIUS);
    // The dark candle's glow, measured in the running game: 0.75 yd either
    // side of the wick, up to 4.4 yd. The core's rounded top covers it.
    expect(Math.hypot(0.75, 4.4 - core.height)).toBeLessThanOrEqual(core.radius);
  });

  it('the core lands on the pillar of every body the Rite really spawns', () => {
    // A real claimed Hollow Crypt with Morthen brought to his Rite: the four
    // bodies are the ones morthen_candles.ts stands, where it stands them and
    // facing the way it turns them. A change to either fails here.
    const f = cryptFight('normal', 0, new Set([MORTHEN_ID]));
    cryptDevTrigger(f.sim.ctx, f.inst, 'skip');
    const morthen = boss(f, MORTHEN_ID);
    put(f, morthen, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
    put(f, f.tank, MORTHEN_SPOT.x, MORTHEN_SPOT.z - 4);
    morthen.maxHp = 1e6;
    morthen.hp = Math.floor(morthen.maxHp * 0.64);
    f.sim.ctx.aggroMob(morthen, f.tank, false);
    // Into the Rite, and a few seconds on: a held body must not turn.
    run(f, 3);
    const st = morthen.cryptBossFight;
    if (st?.kind !== 'morthen') throw new Error('no morthen fight');
    expect(st.candles.length).toBe(RITE_CANDLE_SPOTS.length);
    const down = (x: number, z: number): PickRay => ({
      origin: { x, y: 500, z },
      direction: { x: 0, y: -1, z: 0 },
    });
    const picks = { entities: f.sim.ctx.entities, player: f.tank };
    st.candles.forEach((candle, i) => {
      const body = f.sim.ctx.entities.get(candle.bodyId ?? -1);
      if (!body) throw new Error(`no body at candle ${i}`);
      expect(isUseOnlyBody(body)).toBe(true);
      const pillar = { x: f.ox + RITE_CANDLE_SPOTS[i].x, z: f.oz + RITE_CANDLE_SPOTS[i].z };
      // Straight down the pillar: aimed. Straight down the body's own spot, a
      // yard and nine tenths in front of the pillar: not.
      expect(isAimedAt(body, down(pillar.x, pillar.z))).toBe(true);
      expect(isAimedAt(body, down(body.pos.x, body.pos.z))).toBe(false);
      // A level click from the ring's centre onto the tallow, chest high.
      const fromRing: PickRay = rayFrom(
        { x: f.ox + HOLLOW_CRYPT_RING.x, y: body.pos.y + 1.8, z: f.oz + HOLLOW_CRYPT_RING.z },
        { x: pillar.x, y: body.pos.y + 1.8, z: pillar.z },
      );
      expect(isAimedAt(body, fromRing)).toBe(true);
      // And through Morthen, held as target, that click is the candle's.
      f.tank.targetId = morthen.id;
      expect(resolveWorldDirectPick([morthen.id, body.id], picks, fromRing)).toBe(body.id);
      // Off the pillar, with nothing held, it is Morthen's.
      f.tank.targetId = null;
      const offPillar = down(body.pos.x, body.pos.z);
      expect(resolveWorldDirectPick([morthen.id, body.id], picks, offPillar)).toBe(morthen.id);
    });
  }, 90_000);

  it('a candle that cannot be used right now does not win', () => {
    const morthen = mob(40, 'morthen');
    const spent = candleBody(42);
    spent.hp = 0;
    expect(isUseOnlyBody(spent)).toBe(false);
    expect(resolveWorldDirectPick([40, 42], world([morthen, spent]), AT_PILLAR)).toBe(40);
    // A dead local player can use nothing: the nearest live hit stands.
    const dead = world([morthen, candleBody(43)]);
    if (dead.player) dead.player.dead = true;
    expect(resolveWorldDirectPick([40, 43], dead, AT_PILLAR)).toBe(40);
    // No local player yet (a world still booting): plain ray order, no throw.
    const booting = world([morthen, candleBody(43)]);
    booting.player = null;
    expect(resolveWorldDirectPick([40, 43], booting, AT_PILLAR)).toBe(40);
  });

  it('being non-hostile is not enough: the body must carry a use', () => {
    // A friendly mob with no usable kit (a pet, an escortee, a held prop) must
    // never jump ahead of the boss in front of it.
    const morthen = mob(40, 'morthen');
    const friendly = mob(44, 'marrow_restless_bones');
    friendly.hostile = false;
    expect(MOBS.marrow_restless_bones?.trashKit?.usable).toBeUndefined();
    expect(isUseOnlyBody(friendly)).toBe(false);
    // Even wearing the candle's look (so an aim core is declared and aimed at).
    friendly.templateId = 'crypt_remembrance_candle';
    friendly.devTrashKit = {};
    expect(isAimedAt(friendly, AT_PILLAR)).toBe(true);
    expect(isUseOnlyBody(friendly)).toBe(false);
    expect(resolveWorldDirectPick([40, 44], world([morthen, friendly]), AT_PILLAR)).toBe(40);
  });

  it('a use-only body whose visual declares no aim core is never promoted', () => {
    const morthen = mob(40, 'morthen');
    const lent = mob(44, 'marrow_restless_bones');
    lent.hostile = false;
    lent.devTrashKit = { usable: MOBS.crypt_remembrance_candle?.trashKit?.usable };
    expect(isUseOnlyBody(lent)).toBe(true);
    const throughIt: PickRay = { origin: { x: 0, y: 1, z: 14 }, direction: { x: 0, y: 0, z: -1 } };
    expect(isAimedAt(lent, throughIt)).toBe(false);
    expect(resolveWorldDirectPick([40, 44], world([morthen, lent]), throughIt)).toBe(40);
  });

  it('a usable body the player can also attack (the Soul Brazier) competes nearest first', () => {
    // The Gravewyrm Sanctum's brazier is a hostile mob planted beside the
    // Pyre-Tender whose death snuffs it: a click on her must not be pulled onto
    // the brazier behind her. The interact press and its HUD prompt reach the
    // brazier without a click (src/game/nearby_interaction_core.ts).
    const tender = mob(40, 'broodsworn_pyre_tender');
    const brazier = mob(42, 'soul_brazier');
    expect(brazier.hostile).toBe(true);
    expect(MOBS.soul_brazier?.trashKit?.usable).toBeDefined();
    expect(isUseOnlyBody(brazier)).toBe(false);
    expect(resolveWorldDirectPick([40, 42], world([tender, brazier]), AT_PILLAR)).toBe(40);
    expect(resolveWorldDirectPick([40, 42], world([tender, brazier], 40), AT_PILLAR)).toBe(42);
  });

  it('a pick made to attack keeps plain ray order (the Attack Move key)', () => {
    const morthen = mob(40, 'morthen');
    const candle = candleBody(42);
    expect(resolveWorldDirectPick([40, 42], world([morthen, candle]), AT_PILLAR, true)).toBe(40);
    expect(resolveWorldDirectPick([40, 42], world([morthen, candle]), AT_PILLAR, false)).toBe(42);
  });

  it('Attack Move is the one caller that asks with attack intent', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const attackMove = main.indexOf('function handleAttackMove(x: number, y: number): void {');
    expect(attackMove).toBeGreaterThanOrEqual(0);
    const pick = main.indexOf('renderer.picking.pick(x, y, true)', attackMove);
    expect(pick).toBeGreaterThan(attackMove);
    expect(pick - attackMove).toBeLessThan(200);
    expect(main.split('renderer.picking.pick(x, y, true)').length).toBe(2);
    // The click, the hover cursor and the gather tooltip's entity probe ask without it.
    expect(main).toContain('let id = renderer.picking.pickDirect(x, y);');
    // The hover cursor lives in src/game/hover_cursor.ts, handed renderer.picking.
    const hover = readFileSync(new URL('../src/game/hover_cursor.ts', import.meta.url), 'utf8');
    expect(hover).toContain('hoverPickedId = picking.pick(input.hoverX, input.hoverY);');
    expect(main).toContain('picking: renderer.picking,');
    expect(main).toContain('(x, y) => renderer.picking.pick(x, y),');
  });

  it('the picking module carries the intent, the ray and no hit on the local player', () => {
    // renderer.picking (src/render/world_picking.ts) owns the raycast since the
    // picking code moved out of renderer.ts.
    const renderer = readFileSync(
      new URL('../src/render/world_picking.ts', import.meta.url),
      'utf8',
    );
    // pick() forwards the caller's intent to its direct half: without this
    // Attack Move would be promoted onto the candle with every other test green.
    const pick = renderer.indexOf(
      'pick(clientX: number, clientY: number, attackIntent = false): number | null {',
    );
    const forward = renderer.indexOf(
      'const direct = this.pickDirect(clientX, clientY, attackIntent);',
      pick,
    );
    expect(pick).toBeGreaterThanOrEqual(0);
    expect(forward).toBeGreaterThan(pick);
    expect(forward - pick).toBeLessThan(120);
    const pickDirect = renderer.indexOf('pickDirect(clientX: number, clientY: number,');
    const cast = renderer.indexOf(
      'this.raycaster.intersectObjects(this.host.clickTargets(), true, this.raycastHits);',
      pickDirect,
    );
    // The local player's own capsule is raycast like any other and dropped
    // here, so the "nearest live hit is a player" exception only ever sees
    // OTHER players: standing between the camera and the candle, your own body
    // does not take the candle's click.
    const dropSelf = renderer.indexOf('o.userData.entityId !== sim.playerId', cast);
    const push = renderer.indexOf('directHitIds.push(id);', dropSelf);
    // The very ray that produced the hits goes to the resolver with them.
    const resolve = renderer.indexOf(
      'resolveWorldDirectPick(directHitIds, sim, this.raycaster.ray, attackIntent)',
      push,
    );
    expect(pickDirect).toBeGreaterThanOrEqual(0);
    expect(cast).toBeGreaterThan(pickDirect);
    expect(dropSelf).toBeGreaterThan(cast);
    expect(push).toBeGreaterThan(dropSelf);
    expect(resolve).toBeGreaterThan(push);
    expect(resolve - pickDirect).toBeLessThan(2500);
  });
});
