// The Moonlit Siren's Call of the Shallows, drawn (src/render/drowned_temple/
// temple_lure_fx_core.ts and its painter temple_lure_fx.ts): the tether reads
// off the siren's own cast and cast target, brightens as the bar fills, the
// victim's ring chevrons point at her at the drag's own pace, the halo rides
// the Song-Struck aura, and the painter claims both of the song's cues.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TempleLureFx } from '../src/render/drowned_temple/temple_lure_fx';
import {
  LURE_SIREN,
  LURE_SNAP_SECONDS,
  lureChevronYaw,
  lureFill,
  lureIntensity,
  lureLandRing,
  lureMouthUp,
  lureNoteFlight,
  lureNoteRate,
  lurePullPace,
  lureSnapLook,
  lureVictimOf,
  songStruckHalo,
} from '../src/render/drowned_temple/temple_lure_fx_core';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { MOBS } from '../src/sim/data';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_CALL_THE_TIDE,
  TEMPLE_SHALLOWS_BROKEN,
  TEMPLE_SONG_STRUCK,
} from '../src/sim/mob/trash_kit/temple_cast_ids';
import type { IWorld } from '../src/world_api';

const siren = (over: Partial<Parameters<typeof lureVictimOf>[0]> = {}) => ({
  templateId: LURE_SIREN,
  dead: false,
  castingAbility: TEMPLE_CALL_OF_THE_SHALLOWS,
  castTargetId: 7,
  castRemaining: 1.5,
  castTotal: 3,
  ...over,
});

describe('the plan', () => {
  it('the tether shows only while a living siren sings this song, at its own target', () => {
    expect(lureVictimOf(siren())).toBe(7);
    expect(lureVictimOf(siren({ castingAbility: TEMPLE_CALL_THE_TIDE }))).toBeNull();
    expect(lureVictimOf(siren({ castingAbility: null }))).toBeNull();
    expect(lureVictimOf(siren({ dead: true }))).toBeNull();
    expect(lureVictimOf(siren({ templateId: 'pale_choir_acolyte' }))).toBeNull();
    expect(lureVictimOf(siren({ castTargetId: 12 }))).toBe(12);
  });

  it('the bar fill and the tether strength: never faint, rising to full', () => {
    expect(lureFill(3, 3)).toBe(0);
    expect(lureFill(1.5, 3)).toBeCloseTo(0.5, 6);
    expect(lureFill(0, 3)).toBe(1);
    expect(lureFill(0, 0)).toBe(1);
    expect(lureIntensity(0)).toBe(0.5);
    expect(lureIntensity(1)).toBe(1);
    let last = 0;
    for (let f = 0; f <= 1.0001; f += 0.1) {
      const v = lureIntensity(f);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(lureNoteRate(1, 1)).toBeGreaterThan(lureNoteRate(0, 1));
    expect(lureNoteRate(1, 0.35)).toBeLessThan(lureNoteRate(1, 1));
  });

  it('the chevrons point from the victim toward her (the sim facing convention)', () => {
    // She stands due +z of the victim: yaw 0; due +x: a quarter turn.
    expect(lureChevronYaw({ x: 0, z: 0 }, { x: 0, z: 10 })).toBeCloseTo(0, 6);
    expect(lureChevronYaw({ x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.abs(lureChevronYaw({ x: 0, z: 0 }, { x: 0, z: -10 }))).toBeCloseTo(Math.PI, 6);
  });

  it('the drag pace and the mouth height come from the sim and the drawn body', () => {
    const def = MOBS.moonlit_siren.trashKit?.temple?.lure;
    expect(lurePullPace()).toBe(def?.pull);
    expect(lurePullPace(true)).toBe(def?.heroicPull);
    expect(lureMouthUp()).toBeCloseTo(6.0 * 0.8, 6);
    // A note crosses any tether in the same beat.
    expect(lureNoteFlight(12).life).toBe(lureNoteFlight(4).life);
    expect(lureNoteFlight(12).speed).toBeGreaterThan(lureNoteFlight(4).speed);
  });

  it('the halo rides the Song-Struck aura and nothing else', () => {
    expect(songStruckHalo([], 0)).toBeNull();
    expect(songStruckHalo([{ id: 'other', remaining: 2, duration: 2 }], 0)).toBeNull();
    const full = songStruckHalo([{ id: TEMPLE_SONG_STRUCK, remaining: 1.5, duration: 1.5 }], 2);
    expect(full?.alpha).toBe(1);
    expect(full?.turn).toBeCloseTo(3.2, 6);
    const ebbing = songStruckHalo([{ id: TEMPLE_SONG_STRUCK, remaining: 0.1, duration: 1.5 }], 0);
    expect(ebbing?.alpha).toBeLessThan(1);
    expect(ebbing?.alpha).toBeGreaterThan(0);
  });

  it('the snap springs the halves apart and fades; the landing ring races out', () => {
    expect(lureSnapLook(0)).toEqual({ alpha: 1, spring: 0 });
    const end = lureSnapLook(LURE_SNAP_SECONDS);
    expect(end.alpha).toBe(0);
    expect(end.spring).toBe(1);
    expect(lureLandRing(0.6).radius).toBeGreaterThan(lureLandRing(0.1).radius);
    expect(lureLandRing(0.6).alpha).toBeLessThan(lureLandRing(0.1).alpha);
  });
});

// ---- the painter, on a stub world ----------------------------------------------

interface StubEntity {
  id: number;
  kind: 'mob' | 'player';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  dead: boolean;
  auras: { id: string; value: number; sourceId: number; remaining: number; duration: number }[];
  castingAbility: string | null;
  castTargetId: number | null;
  castRemaining: number;
  castTotal: number;
}

function painter() {
  const entities = new Map<number, StubEntity>();
  const world = { entities, playerId: 1, entityRosterVersion: 1 } as unknown as IWorld;
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }) => {
    const full: StubEntity = {
      kind: 'mob',
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      dead: false,
      auras: [],
      castingAbility: null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
      ...e,
    };
    entities.set(full.id, full);
    return full;
  };
  const root = new THREE.Group();
  const kit = new TelegraphKit(root, true);
  const fx = new TempleLureFx(root, world, () => 0, true, kit);
  fx.markGated();
  return { fx, add, root };
}

/** Pieces drawn at a real size (idle slots sit collapsed to a speck; the
 *  particle pools are left out). */
function shown(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.geometry instanceof THREE.InstancedBufferGeometry) return;
    if (o.scale.x > 0.01) n++;
  });
  return n;
}

const spell = (ability: string, sourceId: number, targetId: number) =>
  ({ type: 'spellfx', ability, fx: 'heavyBolt', sourceId, targetId, school: 'arcane' }) as never;

describe('the painter', () => {
  it('draws the tether and the drag ring while she sings, and goes dark after', () => {
    const { fx, add, root } = painter();
    add({ id: 1, kind: 'player', templateId: 'player', pos: { x: 10, y: 0, z: 0 } });
    const s = add({
      id: 30,
      templateId: LURE_SIREN,
      castingAbility: TEMPLE_CALL_OF_THE_SHALLOWS,
      castTargetId: 1,
      castRemaining: 2,
      castTotal: 3,
    });
    const layer = root.getObjectByName('drowned-temple-lure-fx');
    for (let i = 0; i < 10; i++) fx.update(0.05, i * 0.05);
    expect(layer?.visible).toBe(true);
    expect(shown(root)).toBeGreaterThanOrEqual(2);
    // The song lands: claimed, the tether goes, the burst flashes.
    s.castingAbility = null;
    expect(fx.handleEvent(spell(TEMPLE_CALL_OF_THE_SHALLOWS, 30, 1))).toBe(true);
    for (let i = 0; i < 80; i++) fx.update(0.05, 0.5 + i * 0.05);
    expect(layer?.visible).toBe(false);
  });

  it('a break snaps the tether, then it is gone', () => {
    const { fx, add, root } = painter();
    add({ id: 1, kind: 'player', templateId: 'player', pos: { x: 10, y: 0, z: 0 } });
    const s = add({
      id: 30,
      templateId: LURE_SIREN,
      castingAbility: TEMPLE_CALL_OF_THE_SHALLOWS,
      castTargetId: 1,
      castRemaining: 2,
      castTotal: 3,
    });
    for (let i = 0; i < 4; i++) fx.update(0.05, i * 0.05);
    s.castingAbility = null;
    expect(fx.handleEvent(spell(TEMPLE_SHALLOWS_BROKEN, 30, 1))).toBe(true);
    fx.update(0.05, 0.25);
    expect(shown(root)).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 60; i++) fx.update(0.05, 0.3 + i * 0.05);
    expect(shown(root)).toBe(0);
  });

  it('a Song-Struck player wears the halo until the stun lifts', () => {
    const { fx, add, root } = painter();
    const me = add({ id: 1, kind: 'player', templateId: 'player' });
    me.auras.push({
      id: TEMPLE_SONG_STRUCK,
      value: 0,
      sourceId: 30,
      remaining: 1.5,
      duration: 1.5,
    });
    for (let i = 0; i < 4; i++) fx.update(0.05, i * 0.05);
    expect(shown(root)).toBe(1);
    me.auras.length = 0;
    for (let i = 0; i < 30; i++) fx.update(0.05, 0.2 + i * 0.05);
    expect(shown(root)).toBe(0);
  });

  it('leaves every other cue to the renderer', () => {
    const { fx, add } = painter();
    add({ id: 30, templateId: LURE_SIREN });
    add({ id: 31, templateId: 'pale_choir_acolyte' });
    expect(fx.handleEvent(spell(TEMPLE_CALL_THE_TIDE, 30, 30))).toBe(false);
    expect(fx.handleEvent(spell(TEMPLE_SHALLOWS_BROKEN, 31, 1))).toBe(false);
    expect(fx.handleEvent(spell(TEMPLE_SHALLOWS_BROKEN, 99, 1))).toBe(false);
  });
});
