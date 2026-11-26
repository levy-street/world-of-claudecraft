// The Hammer Council's readability pass (the team's playtest of 2026-11-25):
// the shared soak / avoid tell (src/render/floor_telegraph/floor_tell*.ts) and
// its adoption by the council's marks, the rock's sound told from the Wake's,
// the arena-wide Wrath's own floor (the generic sight field off), the toned-
// down Rush arrow, the fury's floor dimmed under warnings, and the pull beat.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CouncilAudio, type CouncilAudioSink } from '../src/game/smith_heart_council_audio';
import {
  COUNCIL_BAR_SOUNDS,
  COUNCIL_MARK_SOUNDS,
  ROCK_MARK_SOUND,
  rockMarkRate,
} from '../src/game/smith_heart_council_audio_core';
import { FloorTellPool } from '../src/render/floor_telegraph/floor_tell';
import { countInside, soakPips } from '../src/render/floor_telegraph/floor_tell_core';
import { COUNCIL_AWAKEN_CLIP } from '../src/render/smith_heart_fx/council_entrance_core';
import { COUNCIL_MARK_SPECS } from '../src/render/smith_heart_fx/council_fx_core';
import {
  FURY_FLOOR,
  furyFloorDim,
  RUSH_ARROW,
} from '../src/render/smith_heart_fx/council_mechanic_look_core';
import {
  COUNCIL_PULL_BEAT,
  PULL_BEAT_SECONDS,
  pullCrossed,
} from '../src/render/smith_heart_fx/council_pull_fx_core';
import {
  WRATH_FIELD,
  wrathFieldLook,
  wrathFieldPoint,
} from '../src/render/smith_heart_fx/council_wrath_field_core';
import { novaCastLook } from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity } from '../src/sim/types';

describe('the shared soak tell', () => {
  it('counts the soakers inside and lights a pip for each, never past the need', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 5.9, z: 0 },
      { x: 0, z: 6 },
      { x: 6.1, z: 0 },
      { x: 30, z: 30 },
    ];
    expect(countInside(0, 0, 6, pts)).toBe(3);
    expect(countInside(0, 0, 6, pts, 2)).toBe(2);
    expect(soakPips(3, 1)).toEqual({ need: 3, lit: 1 });
    expect(soakPips(3, 7)).toEqual({ need: 3, lit: 3 });
    expect(soakPips(0, 4)).toEqual({ need: 0, lit: 0 });
  });

  it('the pool draws the soak marker whole with no tier knob: the count', () => {
    const root = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const pool = new FloorTellPool(root, 2, geos, mats);
    expect(pool.size).toBe(2);
    // Per slot: the marker's disc and its wisps, nothing else (the avoid
    // disc of 2026-11-25 is gone).
    expect(mats.length).toBe(4);
    expect(mats.every((m) => m.name.startsWith('soakMarker'))).toBe(true);
    pool.paint(0, {
      x: 1,
      y: 0,
      z: 2,
      radius: 6,
      fill: 0.5,
      clock: 1,
      reduced: false,
      need: 3,
      have: 2,
      rim: false,
    });
    const a = pool.uniformsOf(0);
    expect(a?.uNeed.value).toBe(3);
    expect(a?.uLit.value).toBe(2);
    expect(a?.uRimOn.value).toBe(0);
    expect(pool.shown(0)).toBe(true);
    expect(pool.shown(1)).toBe(false);
    // It decays back into the middle before it hides.
    pool.hide(0);
    expect(pool.shown(0)).toBe(true);
    pool.settle(5);
    expect(pool.shown(0)).toBe(false);
  });
});

describe('the council adopts the tell', () => {
  it('only Falling Rock wears the soak marker; the keep-out marks keep their painted look', () => {
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark]?.tell).toBe('share');
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark]?.tell).toBeUndefined();
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.resonance]?.tell).toBeUndefined();
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rushMark]?.tell).toBeUndefined();
    // The rock and the Wake never wear one colour.
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark]?.color).not.toBe(
      COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark]?.color,
    );
  });
});

describe('the rock and the Wake sound apart', () => {
  function sink() {
    const plays: { key: string; rate?: number }[] = [];
    const s: CouncilAudioSink = {
      playAt: (key, _x, _y, _z, o) => {
        plays.push({ key, rate: o?.rate });
        return true;
      },
      loop: () => {},
      unloop: () => {},
      preload: () => {},
    };
    return { s, plays };
  }
  const player = (mark: { id: string; remaining: number; duration: number }) =>
    ({
      id: 9,
      kind: 'player',
      dead: false,
      pos: { x: 0, y: 0, z: 0 },
      auras: [mark],
      castingAbility: null,
      castTotal: 0,
    }) as unknown as Entity;

  it('a fresh rock mark sounds the gather call once, a late one never', () => {
    const { s, plays } = sink();
    const a = new CouncilAudio(s);
    const mark = { id: COUNCIL_AURAS.rockMark, remaining: 4.9, duration: 5 };
    const p = player(mark);
    a.beginScan();
    a.see(p, 'rock');
    a.endScan();
    a.update(0.05, () => p);
    a.update(0.05, () => p);
    expect(plays.filter((q) => q.key === ROCK_MARK_SOUND.key).length).toBe(1);
    const late = sink();
    const b = new CouncilAudio(late.s);
    const m2 = { id: COUNCIL_AURAS.rockMark, remaining: 3, duration: 5 };
    const q = player(m2);
    b.beginScan();
    b.see(q, 'rock');
    b.endScan();
    b.update(0.05, () => q);
    expect(late.plays.filter((x) => x.key === ROCK_MARK_SOUND.key).length).toBe(0);
    expect(rockMarkRate(T.rockMarkSeconds)).toBe(1);
  });

  it('the Wake has its own bar sound and the rock no stone sting', () => {
    const wake = COUNCIL_BAR_SOUNDS[COUNCIL_CASTS.wake];
    expect(wake).toBeDefined();
    expect(wake?.key).not.toBe(ROCK_MARK_SOUND.key);
    expect(COUNCIL_MARK_SOUNDS[COUNCIL_AURAS.rockMark]).toBeUndefined();
    expect(COUNCIL_MARK_SOUNDS[COUNCIL_AURAS.wakeMark]).toBeDefined();
  });
});

describe("Mountain's Wrath draws its own arena-wide floor", () => {
  it('the trash engine sight field is off for the council (ownFloor)', () => {
    for (const id of ['heart_hammer_guardian', 'heart_seam_singer']) {
      const kit = SMITH_HEART_MOBS[id]?.trashKit;
      expect(kit?.nova?.ownFloor, id).toBe(true);
      expect(novaCastLook(kit, COUNCIL_CASTS.wrath), id).toBeNull();
    }
  });

  it('covers the whole pit, sweeps with the bar and stays faint under the marks', () => {
    expect(WRATH_FIELD.rx).toBeGreaterThan(HAMMER_PIT.rx);
    expect(WRATH_FIELD.rz).toBeGreaterThan(HAMMER_PIT.rz);
    const out = { front: 0, tint: 0, edge: 0, drift: 0 };
    expect(wrathFieldLook(0, false, out).front).toBe(0);
    expect(wrathFieldLook(0.8, false, out).front).toBe(1);
    expect(wrathFieldLook(1, false, out).tint).toBeLessThanOrEqual(0.2);
    expect(wrathFieldLook(1, true, out).drift).toBe(0);
    const p = wrathFieldPoint(10, 20, 1, 0.25, { x: 0, z: 0 });
    expect(p.x).toBeCloseTo(10 + WRATH_FIELD.rx, 6);
    expect(p.z).toBeCloseTo(20, 6);
  });
});

describe('toned down: the Rush arrow and the fury floor', () => {
  it('the arrow is about two thirds its old size and a little see-through', () => {
    expect(RUSH_ARROW.length).toBeLessThanOrEqual(3.2 * 0.75);
    expect(RUSH_ARROW.width).toBeLessThanOrEqual(2.6 * 0.75);
    expect(RUSH_ARROW.opacity).toBeLessThan(1);
    expect(RUSH_ARROW.glowFloor).toBeGreaterThanOrEqual(0.5);
  });

  it('the fury floor is pulled in and dims under any warning', () => {
    expect(FURY_FLOOR.reach).toBeLessThan(2.3);
    expect(furyFloorDim(false)).toBe(1);
    expect(furyFloorDim(true)).toBeLessThan(0.5);
  });
});

describe('the pull beat', () => {
  it('lands on each clip contact and ends within its seconds', () => {
    expect(COUNCIL_PULL_BEAT.guardian.impactAt).toBe(COUNCIL_AWAKEN_CLIP.punchContact);
    expect(COUNCIL_PULL_BEAT.singer.impactAt).toBe(
      COUNCIL_AWAKEN_CLIP.noteContact / COUNCIL_AWAKEN_CLIP.noteRate,
    );
    for (const b of Object.values(COUNCIL_PULL_BEAT)) {
      expect(b.impactAt).toBeLessThan(PULL_BEAT_SECONDS);
      for (const s of b.sounds) expect(s.at).toBeLessThan(PULL_BEAT_SECONDS);
    }
    expect(pullCrossed(0.9, 0.95, 0.94)).toBe(true);
    expect(pullCrossed(0.95, 1, 0.94)).toBe(false);
  });
});
