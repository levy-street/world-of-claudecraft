// A blade's slash mark reads over the marked player's head and in their ear
// (the owner's heroic run of 2026-11-17): the Hammer Council's Rush arrow,
// reused whole on the Quench's mark aura, and the Rush's war horn as its alarm.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RUSH_MARK_ALARM } from '../src/game/smith_heart_council_audio_core';
import {
  QUENCH_MARK_ALARM,
  QUENCH_MARK_SOUNDS,
  QUENCH_SFX_KEYS,
} from '../src/game/smith_heart_quench_audio_core';
import { CouncilRushArrow } from '../src/render/smith_heart_fx/council_rush_arrow';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity } from '../src/sim/types';

function player(id: number, auras: Entity['auras']): Entity {
  return {
    id,
    kind: 'player',
    dead: false,
    pos: { x: 10 * id, y: 0, z: 0 },
    prevPos: { x: 10 * id, y: 0, z: 0 },
    auras,
  } as unknown as Entity;
}

const mark = (remaining: number) =>
  ({
    id: QUENCH_AURAS.marked,
    name: 'x',
    kind: 'internal_cd',
    remaining,
    duration: 4,
    value: 1,
    value2: 3,
    sourceId: 99,
  }) as Entity['auras'][number];

describe("the Quench's slash mark: an arrow and a horn", () => {
  it("the Rush's arrow rides any mark aura, one per marked player, gone with the mark", () => {
    const root = new THREE.Group();
    const arrows = new CouncilRushArrow(root, { value: 0 }, [], [], QUENCH_AURAS.marked, 4);
    const cards = () => root.children.filter((c) => c.name === 'smithHeartRushArrow');
    expect(cards().length).toBe(4);
    const a = player(1, [mark(3)]);
    const b = player(2, [mark(2)]);
    const plain = player(3, []);
    const ents = new Map([a, b, plain].map((e) => [e.id, e]));
    arrows.beginScan();
    for (const e of ents.values())
      if (e.auras.some((x) => x.id === QUENCH_AURAS.marked)) arrows.see(e.id);
    arrows.endScan();
    arrows.update(ents, 1, false);
    const shown = cards().filter((c) => c.visible);
    expect(shown.length).toBe(2);
    // Over the marked players' heads, never the unmarked one's.
    const xs = shown.map((c) => c.position.x).sort((p, q) => p - q);
    expect(xs).toEqual([10, 20]);
    for (const c of shown) expect(c.position.y).toBeGreaterThan(1.5);
    // The mark gone: its arrow goes the same frame.
    a.auras = [];
    arrows.update(ents, 1.1, false);
    expect(cards().filter((c) => c.visible).length).toBe(1);
  });

  it('the Rush mark is still the default (the council unchanged)', () => {
    const root = new THREE.Group();
    const arrows = new CouncilRushArrow(root, { value: 0 }, [], []);
    expect(root.children.length).toBe(2);
    const p = player(1, [mark(3)]);
    arrows.beginScan();
    arrows.see(1);
    arrows.endScan();
    arrows.update(new Map([[1, p]]), 1, false);
    // A Quench mark is not the Rush's: no arrow.
    expect(root.children.filter((c) => c.visible).length).toBe(0);
  });

  it("sounds the Rush's war horn in the marked player's ear over the frost's sting, preloaded", () => {
    expect(QUENCH_MARK_ALARM[QUENCH_AURAS.marked]).toEqual(Object.values(RUSH_MARK_ALARM)[0]);
    expect(QUENCH_MARK_SOUNDS[QUENCH_AURAS.marked]).toBeDefined();
    expect(QUENCH_SFX_KEYS).toContain(QUENCH_MARK_ALARM[QUENCH_AURAS.marked].key);
  });

  it('the fight draws the arrows for every player wearing the mark', () => {
    const src = readFileSync('src/render/smith_heart_fx/quench_fight_fx.ts', 'utf8');
    expect(src).toMatch(/new CouncilRushArrow\([\s\S]*QUENCH_AURAS\.marked/);
    expect(src).toContain('this.markArrows.see(e.id)');
    expect(readFileSync('src/game/smith_heart_quench_audio.ts', 'utf8')).toContain(
      'new HeartMarkEar(QUENCH_MARK_ALARM)',
    );
  });
});
