// Choirmother Selthe's Score on the render side: the pure plan
// (src/render/drowned_temple/temple_score_fx_core.ts) and its painter
// (temple_score_fx.ts) on a stub world. The painter mints every mesh and
// material once in its constructor and nothing after; every ACTIONABLE read (a
// tile's disc, its pips, its numeral, the call-out and the pillars) draws on
// every density and motion setting; and each state has a SHAPE, so the order
// never rests on colour alone.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TempleScoreFx } from '../src/render/drowned_temple/temple_score_fx';
import {
  DISCORD_REACH,
  DISCORD_SECONDS,
  discordWave,
  moonTileLook,
  NUMERAL_HEIGHT,
  numeralStrokes,
  PIP_RADIUS,
  PIP_RING,
  pipSpot,
  scoreSinging,
  scoreVeilLevel,
} from '../src/render/drowned_temple/temple_score_fx_core';
import {
  COURT,
  MOON_TILE_STATES,
  type MoonTileState,
  moonTileSpots,
  moonTileTemplate,
  SELTHE_BROKEN_VOICE,
  SELTHE_DISCORD,
  SELTHE_FALSE_NOTE,
  SELTHE_ID,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
  SELTHE_TILE_NOTE,
  SELTHE_TILE_SOUNDED,
  SELTHE_TUNING,
  SELTHE_VOICE_BREAKS,
} from '../src/sim/encounters/drowned_temple';
import type { SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const T = SELTHE_TUNING;

describe('the moon tile’s looks: a shape for every state', () => {
  const look = (state: MoonTileState, place = 0) => ({ ...moonTileLook(state, place) });

  it('a dormant tile is a thin rim and shows no place (heroic hides the order this way)', () => {
    const dark = look('dark', 3);
    expect(dark.pips).toBe(0);
    expect(dark.numeral).toBe(0);
    expect(dark.fill).toBe(0);
    expect(dark.call).toBe(0);
    expect(dark.pillar).toBe(0);
    // Still drawn: the tile is where the group will have to step.
    expect(dark.rim).toBeGreaterThan(0.2);
  });

  it('every tile of the melody carries its place twice: pips on the floor, a numeral in the air', () => {
    for (const state of ['note', 'lit', 'next', 'done'] as const)
      for (let place = 1; place <= 4; place++) {
        const l = look(state, place);
        expect(l.pips, `${state} ${place}`).toBe(place);
        expect(l.numeral, `${state} ${place}`).toBe(place);
      }
  });

  it('tells the six states apart without colour', () => {
    // The features that are shape or motion, never hue.
    const shape = (s: MoonTileState) => {
      const l = look(s, 2);
      return [
        l.pips > 0 ? 'placed' : 'bare',
        l.fill >= 0.85 ? 'full' : l.fill > 0 ? 'soft' : 'empty',
        l.call > 0 ? 'called' : '',
        l.pillar >= 1 ? 'column' : l.pillar > 0 ? 'beacon' : '',
        l.sour > 0 ? 'crossed' : '',
      ].join('|');
    };
    const shapes = MOON_TILE_STATES.map(shape);
    expect(new Set(shapes).size).toBe(MOON_TILE_STATES.length);
    // Note and done are both full moons: the note stands under a column, and
    // only the sounded tile is warm.
    expect(look('note', 1).pillar).toBe(1);
    expect(look('done', 1).pillar).toBe(0);
    expect(look('done', 1).warm).toBe(1);
    // Only the wanted tile is called out, and only a false step is crossed.
    expect(MOON_TILE_STATES.filter((s) => look(s, 1).call > 0)).toEqual(['next']);
    expect(MOON_TILE_STATES.filter((s) => look(s, 1).sour > 0)).toEqual(['sour']);
  });

  it('writes into the look it is handed (no allocation on the frame path)', () => {
    const out = moonTileLook('dark', 0);
    expect(moonTileLook('next', 4, out)).toBe(out);
    expect(out.numeral).toBe(4);
  });

  it('draws 1 to 4 as four different sets of strokes', () => {
    const drawn = [1, 2, 3, 4].map((d) => numeralStrokes(d).join(''));
    expect(new Set(drawn).size).toBe(4);
    expect(numeralStrokes(0).every((s) => s === 0)).toBe(true);
    // A 1 is the centred upright; a 4 has no top and no bottom bar.
    expect(numeralStrokes(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(numeralStrokes(4)[0]).toBe(0);
    expect(numeralStrokes(4)[3]).toBe(0);
    for (const d of [1, 2, 3, 4]) expect(numeralStrokes(d)).toHaveLength(8);
  });

  it('lays the pips out apart from one another and inside the rim', () => {
    for (let count = 1; count <= 4; count++) {
      const spots: { x: number; y: number }[] = [];
      for (let i = 0; i < count; i++) {
        const at = { x: 0, y: 0 };
        pipSpot(i, count, at);
        spots.push(at);
        expect(Math.hypot(at.x, at.y) + PIP_RADIUS).toBeLessThan(0.8);
      }
      for (let a = 0; a < count; a++)
        for (let b = a + 1; b < count; b++)
          expect(
            Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y),
            `${count}: ${a}-${b}`,
          ).toBeGreaterThan(PIP_RADIUS * 3);
    }
    expect(PIP_RING).toBeGreaterThan(PIP_RADIUS * 2);
    // Big enough to count from a zoomed-out camera: a pip is over a foot wide.
    expect(PIP_RADIUS * T.scoreTileRadius * 2).toBeGreaterThan(0.7);
    // The numeral stands over a player's head, so a body on the tile never hides it.
    expect(NUMERAL_HEIGHT).toBeGreaterThan(3);
  });

  it('her ward’s water stands through the melody and sinks with the verse’s own clock', () => {
    expect(scoreSinging(SELTHE_SCORE)).toBe(true);
    expect(scoreSinging(SELTHE_SCORE_ANSWER)).toBe(true);
    expect(scoreSinging('temple_mere_surge')).toBe(false);
    expect(scoreSinging(null)).toBe(false);
    expect(scoreVeilLevel(SELTHE_SCORE, 2, 5)).toBe(1);
    expect(scoreVeilLevel(SELTHE_SCORE_ANSWER, 14, 14)).toBe(1);
    expect(scoreVeilLevel(SELTHE_SCORE_ANSWER, 7, 14)).toBeCloseTo(0.65, 6);
    expect(scoreVeilLevel(SELTHE_SCORE_ANSWER, 0, 14)).toBeCloseTo(0.3, 6);
    expect(scoreVeilLevel(null, 0, 0)).toBe(0);
  });

  it('Discord rolls from her to past the court’s rim, then is gone', () => {
    const out = { radius: 0, height: 0, alpha: 0 };
    expect(discordWave(-0.1, out)).toBeNull();
    const first = { ...(discordWave(0.05, out) as typeof out) };
    const late = { ...(discordWave(DISCORD_SECONDS - 0.05, out) as typeof out) };
    expect(late.radius).toBeGreaterThan(first.radius);
    expect(late.radius).toBeGreaterThan(COURT.r);
    expect(late.radius).toBeLessThanOrEqual(DISCORD_REACH);
    expect(late.alpha).toBeLessThan(first.alpha);
    expect(discordWave(DISCORD_SECONDS, out)).toBeNull();
    // The sim hits the court and a margin round it: the wave covers the same reach.
    expect(DISCORD_REACH).toBe(COURT.r + 12);
  });
});

// ---- the painter on a stub world ------------------------------------------------

interface StubEntity {
  id: number;
  kind: 'mob' | 'player' | 'object';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  scale: number;
  dead: boolean;
  auras: { id: string }[];
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
}

function rig(detail: boolean, calm = false) {
  const entities = new Map<number, StubEntity>();
  const world = { entities, playerId: 1, entityRosterVersion: 1 };
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }) => {
    const full: StubEntity = {
      kind: 'object',
      pos: { x: 0, y: 4, z: 0 },
      facing: 0,
      scale: 1,
      dead: false,
      auras: [],
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      ...e,
    };
    entities.set(full.id, full);
    world.entityRosterVersion++;
    return full;
  };
  add({ id: 1, kind: 'player', templateId: 'warrior', pos: { x: 0, y: 4, z: 2 } });
  const boss = add({ id: 2, kind: 'mob', templateId: SELTHE_ID, pos: { x: 0, y: 4, z: 10 } });
  const tiles = moonTileSpots(0, 10).map((spot, i) =>
    add({
      id: 10 + i,
      templateId: moonTileTemplate('dark'),
      pos: { x: spot.x, y: 4, z: spot.z },
      scale: T.scoreTileRadius,
    }),
  );
  const parent = new THREE.Group();
  const shakes: number[] = [];
  const gestures: string[] = [];
  const fx = new TempleScoreFx(
    parent,
    world as unknown as IWorld,
    () => 4,
    detail,
    (amount) => shakes.push(amount),
    () => calm,
    (_id, gesture) => gestures.push(gesture),
  );
  const root = parent.children[0] as THREE.Group;
  let clock = 0;
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock += 1 / 30;
      fx.update(1 / 30, clock);
    }
  };
  const cue = (ability: string, targetId: number): boolean =>
    fx.handleEvent({
      type: 'spellfx',
      sourceId: boss.id,
      targetId,
      school: 'frost',
      fx: 'nova',
      ability,
    } as SimEvent);
  const meshes = () => root.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
  /** The uniforms of every disc material, in slot order. */
  const discs = () =>
    meshes()
      .map((m) => (m.material as THREE.ShaderMaterial).uniforms)
      .filter((u) => u.uPips !== undefined);
  const numerals = () =>
    meshes()
      .map((m) => ({ mesh: m, u: (m.material as THREE.ShaderMaterial).uniforms }))
      .filter((n) => n.u.uStrokeA !== undefined);
  const pillars = () =>
    meshes().filter((m) => {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      return (
        u.uWarm !== undefined &&
        u.uPips === undefined &&
        u.uStrokeA === undefined &&
        u.uSour === undefined
      );
    });
  return {
    fx,
    root,
    world,
    boss,
    tiles,
    step,
    cue,
    discs,
    numerals,
    pillars,
    meshes,
    shakes,
    gestures,
  };
}

describe('the Score painter', () => {
  it('mints everything once in its constructor and nothing while it plays', () => {
    const r = rig(true);
    const count = () => {
      let n = 0;
      r.root.traverse(() => n++);
      return n;
    };
    const before = count();
    const materials = new Set(r.meshes().map((m) => m.material));
    r.fx.markGated();
    r.step(0.5);
    r.boss.castingAbility = SELTHE_SCORE;
    r.boss.castTotal = 5.1;
    r.boss.castRemaining = 4;
    r.tiles[1].templateId = moonTileTemplate('note', 1);
    r.cue(SELTHE_TILE_NOTE, r.tiles[1].id);
    r.step(1);
    r.tiles[1].templateId = moonTileTemplate('done', 1);
    r.cue(SELTHE_TILE_SOUNDED, r.tiles[1].id);
    r.cue(SELTHE_FALSE_NOTE, r.tiles[3].id);
    r.cue(SELTHE_VOICE_BREAKS, r.boss.id);
    r.cue(SELTHE_DISCORD, r.boss.id);
    r.step(2);
    expect(count()).toBe(before);
    expect(new Set(r.meshes().map((m) => m.material))).toEqual(materials);
    r.fx.dispose();
  });

  it('claims its own cues and no other', () => {
    const r = rig(true);
    r.step(0.3);
    for (const ability of [SELTHE_TILE_NOTE, SELTHE_TILE_SOUNDED, SELTHE_FALSE_NOTE])
      expect(r.cue(ability, r.tiles[0].id), ability).toBe(true);
    expect(r.cue(SELTHE_VOICE_BREAKS, r.boss.id)).toBe(true);
    expect(r.cue(SELTHE_DISCORD, r.boss.id)).toBe(true);
    // The melody's opening cue is left to the renderer (her gesture).
    expect(r.cue(SELTHE_SCORE, r.boss.id)).toBe(false);
    expect(r.cue('temple_mere_surge', r.boss.id)).toBe(false);
    // Her broken voice asks her rig for its recoil.
    expect(r.gestures).toEqual([SELTHE_VOICE_BREAKS]);
    r.fx.dispose();
  });

  for (const detail of [true, false])
    for (const calm of [false, true])
      it(`draws the order on every setting (detail ${detail}, reduced motion ${calm})`, () => {
        const r = rig(detail, calm);
        r.fx.markGated();
        r.tiles[0].templateId = moonTileTemplate('done', 1);
        r.tiles[1].templateId = moonTileTemplate('next', 2);
        r.tiles[2].templateId = moonTileTemplate('lit', 3);
        r.tiles[3].templateId = moonTileTemplate('sour');
        r.boss.castingAbility = SELTHE_SCORE_ANSWER;
        r.boss.castTotal = 14;
        r.boss.castRemaining = 9;
        r.step(1.5);
        expect(r.root.visible).toBe(true);
        const d = r.discs();
        expect(d).toHaveLength(5);
        // The pips are the place, exactly, on every tier.
        expect(d.map((u) => u.uPips.value)).toEqual([1, 2, 3, 0, 0]);
        for (const u of d) expect(u.uFade.value).toBeGreaterThan(0.9);
        expect(d[1].uCall.value).toBeGreaterThan(0.9);
        expect(d[0].uCall.value).toBeLessThan(0.05);
        expect(d[3].uSour.value).toBeGreaterThan(0.9);
        expect(d[0].uFill.value).toBeGreaterThan(0.9);
        expect(d[4].uRim.value).toBeGreaterThan(0.2);
        // Reduced motion stills the call-out (the rings hold), it never hides it.
        expect(d[1].uCalm.value).toBe(calm ? 1 : 0);
        // The numerals stand over the three placed tiles, full size.
        const shown = r.numerals().filter((n) => n.u.uAlpha.value > 0.5);
        expect(shown).toHaveLength(3);
        for (const n of shown) {
          expect(n.u.uSize.value).toBeGreaterThan(2);
          expect(n.mesh.position.y).toBeGreaterThan(4 + 3);
        }
        // The wanted tile's beacon stands on every tier.
        const beacons = r.pillars().filter((m) => m.scale.y > 1);
        expect(beacons).toHaveLength(1);
        expect(beacons[0].position.x).toBeCloseTo(r.tiles[1].pos.x, 4);
        r.fx.dispose();
      });

  it('a ringing note stands a full column over its tile', () => {
    const r = rig(false);
    r.boss.castingAbility = SELTHE_SCORE;
    r.boss.castTotal = 5.1;
    r.boss.castRemaining = 3;
    r.tiles[2].templateId = moonTileTemplate('note', 1);
    r.cue(SELTHE_TILE_NOTE, r.tiles[2].id);
    r.step(0.8);
    const columns = r.pillars().filter((m) => m.scale.y > 8);
    expect(columns).toHaveLength(1);
    expect(columns[0].position.x).toBeCloseTo(r.tiles[2].pos.x, 4);
    expect(columns[0].position.z).toBeCloseTo(r.tiles[2].pos.z, 4);
    expect(r.discs()[2].uPips.value).toBe(1);
    r.fx.dispose();
  });

  it('kicks the camera for Discord and for a false step under the player’s own feet', () => {
    const r = rig(true);
    r.step(0.3);
    r.cue(SELTHE_DISCORD, r.boss.id);
    expect(r.shakes).toEqual([0.45]);
    // A false note three tiles away: no kick. Under the player: a small one.
    r.cue(SELTHE_FALSE_NOTE, r.tiles[0].id);
    expect(r.shakes).toHaveLength(1);
    const me = r.world.entities.get(1) as StubEntity;
    me.pos.x = r.tiles[0].pos.x;
    me.pos.z = r.tiles[0].pos.z;
    r.cue(SELTHE_FALSE_NOTE, r.tiles[0].id);
    expect(r.shakes).toEqual([0.45, 0.12]);
    r.fx.dispose();
  });

  it('sleeps once the gate has linked it and no tile stands, and wakes with the tiles', () => {
    const r = rig(true);
    r.step(0.5);
    // Before the gate: drawn (collapsed) so its programs link.
    expect(r.root.visible).toBe(true);
    r.fx.markGated();
    r.step(0.5);
    expect(r.root.visible).toBe(true);
    // The fight ends: the tiles leave the world.
    for (const tile of r.tiles) r.world.entities.delete(tile.id);
    r.world.entityRosterVersion++;
    r.step(2);
    expect(r.root.visible).toBe(false);
    // Her stun's drizzle keeps it awake for as long as it lasts.
    r.boss.auras = [{ id: SELTHE_BROKEN_VOICE }];
    r.step(0.3);
    expect(r.root.visible).toBe(true);
    r.fx.dispose();
  });

  it('dispose releases every geometry and material and leaves the parent', () => {
    const r = rig(true);
    const disposed = { geo: 0, mat: 0 };
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    r.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      geos.add(m.geometry);
      mats.add(m.material as THREE.Material);
    });
    for (const g of geos) g.addEventListener('dispose', () => disposed.geo++);
    for (const m of mats) m.addEventListener('dispose', () => disposed.mat++);
    const parent = r.root.parent;
    r.fx.dispose();
    expect(disposed.geo).toBe(geos.size);
    expect(disposed.mat).toBe(mats.size);
    expect(parent?.children).toHaveLength(0);
  });
});
