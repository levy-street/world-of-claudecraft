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
const CYCLOPS_ABILITIES = resolve(
  ROOT,
  'public/models/creatures/balgath_cyclops_ability_anims.glb',
);
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

  it('names only clips the shipped GLBs actually carry', () => {
    const available = new Set([...clipNames(HERO), ...clipNames(ABILITIES)]);
    const block = balgathBlock();
    // Every quoted clip-ish string in the ClipMap has to resolve. This is the
    // check that catches a typo'd rename, which is otherwise invisible until the
    // mixer silently finds no action and leaves the rig at bind pose.
    const clipsStart = block.indexOf('clips: {');
    const named = [...block.slice(clipsStart).matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const clip of named)
      expect(available, `clip '${clip}' is not in a shipped GLB`).toContain(clip);
  });

  it('holds the encounter-only clips out of the generic ClipMap slots', () => {
    // Blinded must hold for a debuff's duration and Wake fires once at spawn.
    // If either ever lands in `attack`/`hit`/`flourish` the state machine will
    // pick it at random mid-fight, which reads as the boss bugging out.
    const block = balgathBlock();
    const clips = block.slice(block.indexOf('clips: {'));
    expect(clips).not.toContain('Balgath_Blinded');
    expect(clips).not.toContain('Balgath_Wake');
  });

  // --- the cyclops silhouette -----------------------------------------------
  // Second model for the same boss concept, kept so the two can be compared in
  // engine. It earns its own assertions because its constraints are different:
  // its slash retarget FOLDED, so the one clip it must never name is its own.
  it('ships the cyclops rig with its two authored clips', () => {
    const rig = clipNames(CYCLOPS);
    for (const clip of RETARGETED_CLIPS) expect(rig).toContain(clip);
    expect(clipNames(CYCLOPS_ABILITIES).sort()).toEqual(['Balgath_Blinded', 'Balgath_Stomp']);
  });

  it('never names the cyclops folded Attack clip', () => {
    // The slash preset collapsed this body. The clip is still IN the GLB (it came
    // with the retarget and removing it would desync the file from the job), so
    // the only thing standing between it and a raid seeing it is this: the
    // ClipMap must not mention it. `attack` uses the authored Stomp instead.
    const clips = defBlock('mob_balgath_cyclops');
    const map = clips.slice(clips.indexOf('clips: {'), clips.indexOf('tint:'));
    expect(map).not.toContain("'Attack'");
    expect(map).toContain('Balgath_Stomp');
  });

  it('names only clips the cyclops GLBs actually carry', () => {
    const available = new Set([...clipNames(CYCLOPS), ...clipNames(CYCLOPS_ABILITIES)]);
    const block = defBlock('mob_balgath_cyclops');
    const map = block.slice(block.indexOf('clips: {'), block.indexOf('tint:'));
    const named = [...map.matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const clip of named)
      expect(available, `clip '${clip}' is not in a shipped GLB`).toContain(clip);
  });

  it('stays out of the boot preload sweep while nothing can spawn him', () => {
    // No MOB_KEYS entry exists yet, so preloading 1.8 MB of boss buys nothing.
    // When the encounter lands, both this flag and this assertion go away together.
    const src = readFileSync(MANIFEST, 'utf8');
    // Scope to the MOB_KEYS literal itself. A whole-file search matches the word
    // in this def's own comment and reports every state as spawnable.
    const keysStart = src.indexOf('MOB_KEYS: Record');
    expect(keysStart, 'MOB_KEYS moved or was renamed').toBeGreaterThan(-1);
    const spawnable = src.slice(keysStart, src.indexOf('\n};', keysStart)).includes('balgath');
    expect(balgathBlock()).toContain('lazyPreload: true');
    expect(defBlock('mob_balgath_cyclops')).toContain('lazyPreload: true');
    expect(spawnable, 'balgath is spawnable now: drop lazyPreload and this test').toBe(false);
  });
});
