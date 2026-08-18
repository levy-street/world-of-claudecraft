// Balgath, the Buried Foreman: the Mirefen world boss's shipped asset contract.
//
// The failure this exists to catch is silent in every other layer: a rebake that
// renames or drops a clip, or a manifest edit that points at a clip the donor GLB
// does not carry, produces no error at build time and no error at load time. The
// rig simply falls back to a generic pose (or, worse, to bind pose) the first time
// the mechanic fires, in a raid, in production. So both halves are pinned here:
// the clip names actually inside the GLB, and the manifest source that names them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const HERO = resolve(ROOT, 'public/models/creatures/balgath_foreman.glb');
const ABILITIES = resolve(ROOT, 'public/models/creatures/balgath_ability_anims.glb');
const CYCLOPS = resolve(ROOT, 'public/models/creatures/balgath_cyclops.glb');
const MANIFEST = resolve(ROOT, 'src/render/characters/manifest.ts');

/** Clip names out of a GLB's JSON chunk, without pulling three.js into a node test. */
function clipNames(path: string): string[] {
  const buf = readFileSync(path);
  // glTF binary: 12-byte header, then chunks of [length u32][type u32][data].
  // The JSON chunk is always first per the spec.
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  return (json.animations ?? []).map((a: { name?: string }) => a.name ?? '');
}

/** Skin joint names, in order, straight out of the GLB JSON chunk. */
function jointNames(path: string): string[] {
  const buf = readFileSync(path);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const skin = (json.skins ?? [])[0];
  return (skin?.joints ?? []).map((i: number) => json.nodes[i].name as string);
}

/** The shared BALGATH ClipMap literal, as source text. */
function clipMapSource(): string {
  const src = readFileSync(MANIFEST, 'utf8');
  const start = src.indexOf('const BALGATH: ClipMap = {');
  expect(start, 'the shared BALGATH ClipMap is missing').toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n};', start));
}

/** A named VisualDef object literal, as source text. */
function defBlock(key: string): string {
  const src = readFileSync(MANIFEST, 'utf8');
  const start = src.indexOf(`${key}: {`);
  expect(start, `${key} is missing from VISUALS`).toBeGreaterThan(-1);
  const end = src.indexOf('\n  },', start);
  return src.slice(start, end);
}
const balgathBlock = () => defBlock('mob_balgath_foreman');

// The bespoke set, and what each one is FOR. A clip dropped from this list is a
// mechanic with no animation, so the list is exhaustive on purpose.
const ABILITY_CLIPS = [
  'Balgath_Smash', // the telegraphed circle-smash payoff
  'Balgath_Stomp', // the shockwave stomp
  'Balgath_EyeFlare', // the scry channel under the cast bar
  'Balgath_Blinded', // the low-level counterplay, loops for the debuff's duration
  'Balgath_Roar', // the enrage flourish
  'Balgath_Wake', // the spawn rise out of the barrow
];

// What the Tripo creature lane retargeted onto the rig. `Cast`, `Jump` and
// `Attack` are also the DONORS build_balgath_anims.mjs samples, so losing one
// breaks the rebake as well as the runtime.
const RETARGETED_CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Cast', 'Jump'];

describe('balgath world boss assets', () => {
  it('ships every retargeted clip on the hero rig', () => {
    const names = clipNames(HERO);
    for (const clip of RETARGETED_CLIPS) expect(names).toContain(clip);
  });

  it('ships every bespoke ability clip in the donor GLB', () => {
    const names = clipNames(ABILITIES);
    for (const clip of ABILITY_CLIPS) expect(names).toContain(clip);
  });

  it('keeps the ability donor mesh-free so it composes instead of shadowing', () => {
    // A donor that carried its own mesh and skin would be a second, complete copy
    // of the boss loaded alongside the hero rig, and its inherited Idle/Walk would
    // shadow the hero's. `stripToAnimationsOnly` is what prevents that; this pins it.
    const buf = readFileSync(ABILITIES);
    const jsonLength = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
    expect(json.meshes ?? []).toHaveLength(0);
    expect(json.skins ?? []).toHaveLength(0);
    expect(json.animations).toHaveLength(ABILITY_CLIPS.length);
  });

  it('wires the ability donor through animUrls, not as a second visual', () => {
    const block = balgathBlock();
    expect(block).toContain('balgath_ability_anims.glb');
    expect(block).toContain('animUrls');
  });

  it('names only clips BOTH shipped rigs actually carry', () => {
    // One ClipMap drives two bodies, so a name has to resolve on each of them
    // independently. Intersecting rather than unioning is the point: a clip present
    // on only one rig would leave the other at bind pose, and a union would pass.
    const foreman = new Set([...clipNames(HERO), ...clipNames(ABILITIES)]);
    const cyclops = new Set([...clipNames(CYCLOPS), ...clipNames(ABILITIES)]);
    const named = [...clipMapSource().matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const clip of named) {
      expect(foreman, `clip '${clip}' is not on the foreman`).toContain(clip);
      expect(cyclops, `clip '${clip}' is not on the cyclops`).toContain(clip);
    }
  });

  it('holds the encounter-only clips out of the generic ClipMap slots', () => {
    // Blinded must hold for a debuff's duration and Wake fires once at spawn.
    // If either ever lands in `attack`/`hit`/`flourish` the state machine will
    // pick it at random mid-fight, which reads as the boss bugging out.
    const map = clipMapSource();
    expect(map).not.toContain('Balgath_Blinded');
    expect(map).not.toContain('Balgath_Wake');
  });

  it('gives both bodies the same ClipMap object, so they cannot drift', () => {
    for (const key of ['mob_balgath_foreman', 'mob_balgath_cyclops']) {
      expect(defBlock(key), `${key} should share the BALGATH ClipMap`).toContain(
        'clips: BALGATH,',
      );
    }
  });

  // --- the cyclops silhouette -----------------------------------------------
  // Second body for the same encounter. It carries the FOREMAN's ability donor, which
  // is only sound because the two Tripo auto-rigs came back with the same joints under
  // the same names. That is not a safe assumption to leave implicit: a re-generated
  // cyclops could come back with a renamed or reordered skeleton, the clips would bind
  // to nothing, and the rig would sit in BIND POSE the first time a mechanic fired,
  // silently, in a raid. So the equality itself is the pin.
  it('shares the foreman skeleton exactly, which is what lets the clips bind', () => {
    const a = jointNames(HERO);
    const b = jointNames(CYCLOPS);
    expect(a.length).toBe(41);
    expect(b).toEqual(a);
  });

  it('points the cyclops at the foreman donor, not one of its own', () => {
    const block = defBlock('mob_balgath_cyclops');
    expect(block).toContain('balgath_ability_anims.glb');
    expect(block).not.toContain('balgath_cyclops_ability_anims');
  });

  it('never names the cyclops folded Attack clip', () => {
    // Its slash preset collapsed that body. The clip is still IN the rig GLB (it came
    // with the retarget), so the only thing between it and a raid seeing it is that
    // the shared ClipMap uses the authored slams for `attack` instead.
    const map = clipMapSource();
    expect(map).not.toContain("'Attack'");
    expect(map).toContain('Balgath_Smash');
  });

  it('is spawnable, and therefore in the boot preload sweep', () => {
    // The inverse of what this test asserted while the encounter was missing. Both
    // halves matter now: a MOB_KEYS entry is what stops him rendering as the generic
    // `elemental` family fallback, and `lazyPreload` would keep his GLB out of the
    // tier-independent preload union that world entry reads synchronously.
    const src = readFileSync(MANIFEST, 'utf8');
    const keysStart = src.indexOf('MOB_KEYS: Record');
    expect(keysStart, 'MOB_KEYS moved or was renamed').toBeGreaterThan(-1);
    const keys = src.slice(keysStart, src.indexOf('\n};', keysStart));
    expect(keys).toContain("balgath_foreman: 'mob_balgath_foreman'");
    for (const key of ['mob_balgath_foreman', 'mob_balgath_cyclops']) {
      expect(defBlock(key), `${key} must not be lazy once spawnable`).not.toContain('lazyPreload');
    }
  });

  it('keeps the sim scale and the measured gait references in agreement', () => {
    // The refs are only correct AT the scale they were measured at, and the sim owns
    // that scale while render owns the refs. `src/sim/` may never import from
    // `src/render/`, so the two numbers cannot share a constant; this is the weld that
    // replaces the import. Drift here is silent and shows up only as skating feet.
    const manifest = readFileSync(MANIFEST, 'utf8');
    const declared = manifest.match(/export const BALGATH_SCALE = ([\d.]+);/);
    expect(declared, 'BALGATH_SCALE is missing from the manifest').toBeTruthy();
    const zone = readFileSync(resolve(ROOT, 'src/sim/content/zone2.ts'), 'utf8');
    const tpl = zone.slice(zone.indexOf('balgath_foreman: {'));
    const simScale = tpl.slice(0, tpl.indexOf('\n  },')).match(/scale: ([\d.]+),/);
    expect(simScale, "the mob template's scale is missing").toBeTruthy();
    expect(Number(simScale![1])).toBe(Number(declared![1]));
  });

});
