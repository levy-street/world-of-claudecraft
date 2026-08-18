// Balgath, the Mirefen world boss: the shipped asset and wiring contract.
//
// The failure this exists to catch is silent in every other layer. A rebake that renames
// or drops a clip, or a manifest edit naming a clip the GLB does not carry, produces no
// build error and no load error: the mixer simply finds no action and the rig sits in
// BIND POSE the first time the mechanic fires, in a raid, in production. So both halves
// are pinned here, the clip names actually inside the GLBs and the manifest source that
// names them, plus the cross-layer welds nothing else can see.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const RIG = resolve(ROOT, 'public/models/creatures/balgath_cyclops.glb');
const ABILITIES = resolve(ROOT, 'public/models/creatures/balgath_ability_anims.glb');
const DONOR = resolve(ROOT, 'public/models/creatures/balgath_clip_donor.glb');
const MANIFEST = resolve(ROOT, 'src/render/characters/manifest.ts');
const ZONE = resolve(ROOT, 'src/sim/content/zone2.ts');

function glbJson(path: string): {
  animations?: Array<{ name?: string; channels?: Array<{ target: { node?: number } }> }>;
  meshes?: unknown[];
  skins?: Array<{ joints: number[] }>;
  nodes: Array<{ name?: string }>;
} {
  const buf = readFileSync(path);
  // glTF binary: 12-byte header, then chunks of [length u32][type u32][data]. The JSON
  // chunk is always first per the spec.
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
}
const clipNames = (path: string): string[] =>
  (glbJson(path).animations ?? []).map((a) => a.name ?? '');
function jointNames(path: string): string[] {
  const json = glbJson(path);
  return (json.skins?.[0]?.joints ?? []).map((i) => json.nodes[i].name as string);
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
  return src.slice(start, src.indexOf('\n  },', start));
}

/** The mob template literal, as source text. */
function templateSource(): string {
  const zone = readFileSync(ZONE, 'utf8');
  const start = zone.indexOf('balgath_cyclops: {');
  expect(start, 'the balgath_cyclops template is missing').toBeGreaterThan(-1);
  return zone.slice(start, zone.indexOf('\n  },', start));
}

// The authored set, and what each is FOR. A clip dropped from this list is a mechanic
// with no animation, so the list is exhaustive on purpose.
const AUTHORED = [
  'Balgath_Smash', // the telegraphed circle-smash payoff
  'Balgath_Stomp', // the telegraphed shockwave stomp
  'Balgath_EyeFlare', // the scry channel under the cast bar
  'Balgath_Blinded', // the low-level counterplay, loops for the debuff
  'Balgath_Roar', // the enrage flourish
  'Balgath_Wake', // the spawn rise
  'Balgath_Swipe', // the ORDINARY auto-attack, kept small so the slams stay rare
];

/** What the Tripo creature lane retargeted onto the rig. */
const RETARGETED = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Cast', 'Jump'];

describe('balgath world boss assets', () => {
  it('ships every retargeted clip on the rig', () => {
    const names = clipNames(RIG);
    for (const clip of RETARGETED) expect(names).toContain(clip);
  });

  it('ships every authored clip in the donor GLB', () => {
    expect(clipNames(ABILITIES).sort()).toEqual([...AUTHORED].sort());
  });

  it('keeps the ability donor mesh-free so it composes instead of shadowing', () => {
    // A donor carrying its own mesh and skin would be a second complete body loaded
    // beside the rig, and its inherited Idle/Walk would shadow the rig's own.
    const json = glbJson(ABILITIES);
    expect(json.meshes ?? []).toHaveLength(0);
    expect(json.skins ?? []).toHaveLength(0);
  });

  it('keeps the clip-authoring donor rig, mesh-free, so the clips stay reproducible', () => {
    // The authored clips were sampled from the FOREMAN candidate's retargeted poses. That
    // body lost the design bake-off and its mesh is deleted; this stripped rig is what is
    // left of it, and without it scripts/build_balgath_anims.mjs cannot run at all.
    const names = clipNames(DONOR);
    for (const clip of RETARGETED) expect(names).toContain(clip);
    expect(glbJson(DONOR).meshes ?? [], 'the donor must stay mesh-free').toHaveLength(0);
    expect(readFileSync(resolve(ROOT, 'scripts/build_balgath_anims.mjs'), 'utf8')).toContain(
      'balgath_clip_donor.glb',
    );
  });

  it('targets only bones the rig actually has, which is what lets the clips bind', () => {
    // The authored poses play on the cyclops only because three.js binds a clip to a
    // skeleton BY NODE NAME, and the two Tripo auto-rigs came back with the same joints
    // under the same names. This is that assumption made explicit: every node the shipped
    // clips drive must be a joint on the rig they are composed onto. A re-generated rig
    // with one renamed joint would bind that channel to nothing and the boss would sit in
    // bind pose the first time the mechanic fired, with no error anywhere.
    // Compared against the rig's whole NODE graph, not just its skin joints: three binds
    // a track by name against the object it is mounted on, and the clips legitimately
    // drive the armature root as well as the 41 skinned bones.
    expect(jointNames(RIG)).toHaveLength(41);
    const rig = new Set((glbJson(RIG).nodes ?? []).map((n) => n.name).filter(Boolean) as string[]);
    const json = glbJson(ABILITIES);
    const targeted = new Set<string>();
    for (const anim of json.animations ?? [])
      for (const ch of anim.channels ?? []) {
        const name = ch.target.node === undefined ? undefined : json.nodes[ch.target.node]?.name;
        if (name) targeted.add(name);
      }
    expect(targeted.size, 'the donor drives no bones at all').toBeGreaterThan(20);
    for (const bone of targeted)
      expect(rig, `clip bone '${bone}' is not on the rig`).toContain(bone);
  });

  it('names only clips the shipped GLBs actually carry', () => {
    const available = new Set([...clipNames(RIG), ...clipNames(ABILITIES)]);
    const named = [...clipMapSource().matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const clip of named) expect(available, `clip '${clip}' is not shipped`).toContain(clip);
  });

  it('never names the folded Attack clip', () => {
    // The slash retarget collapsed this body. The clip is still in the rig GLB because it
    // came with the retarget, so the only thing between it and a raid seeing it is that
    // the ClipMap does not mention it.
    expect(clipMapSource()).not.toContain("'Attack'");
  });

  it('keeps the big slams OUT of the ordinary attack rotation', () => {
    // A boss who plays his telegraphed circle-smash on every auto-attack teaches the raid
    // that the animation means nothing, which is the opposite of what a telegraph is for.
    const map = clipMapSource();
    const start = map.indexOf('attack: [');
    const attackLine = map.slice(start, map.indexOf(']', start));
    expect(attackLine).toContain('Balgath_Swipe');
    expect(attackLine).not.toContain('Balgath_Smash');
    expect(attackLine).not.toContain('Balgath_Stomp');
  });

  it('routes each telegraphed slam off the windup cue the sim actually emits', () => {
    // These ability ids are not player abilities: they are the cue the sim fires when it
    // draws a ground ring (mob/locomotion.ts). If the two sides ever disagree, the ring
    // still draws and the boss just stands in it doing nothing.
    const map = clipMapSource();
    const loco = readFileSync(resolve(ROOT, 'src/sim/mob/locomotion.ts'), 'utf8');
    for (const [ability, clip] of [
      ['mob_pulse_windup', 'Balgath_Smash'],
      ['mob_stomp_windup', 'Balgath_Stomp'],
    ]) {
      expect(map, `${ability} is not mapped`).toContain(`${ability}: '${clip}'`);
      expect(loco, `${ability} is never emitted`).toContain(`'${ability}'`);
    }
  });

  it('holds the encounter-only clips out of the generic slots', () => {
    // Blinded holds for as long as a debuff lasts and Wake fires once at spawn; either one
    // landing in attack/hit/flourish would be picked at random mid-fight.
    const map = clipMapSource();
    expect(map).not.toContain('Balgath_Blinded');
    expect(map).not.toContain('Balgath_Wake');
  });

  it('is reachable through MOB_KEYS, and therefore NOT lazily preloaded', () => {
    // These move together or world entry crashes: preload sets are tier-independent and
    // read synchronously at entry, so a reachable-but-lazy def fails with "asset not
    // preloaded". Without the MOB_KEYS row he silently renders as the generic elemental
    // family fallback instead, which is the quieter half of the same bug.
    const src = readFileSync(MANIFEST, 'utf8');
    const keysStart = src.indexOf('MOB_KEYS: Record');
    expect(keysStart, 'MOB_KEYS moved or was renamed').toBeGreaterThan(-1);
    const keys = src.slice(keysStart, src.indexOf('\n};', keysStart));
    expect(keys).toContain("balgath_cyclops: 'mob_balgath_cyclops'");
    expect(defBlock('mob_balgath_cyclops')).not.toContain('lazyPreload');
  });

  it('keeps the sim scale and the measured gait references in agreement', () => {
    // The refs are only correct AT the scale they were measured at, and the sim owns the
    // scale while render owns the refs. `src/sim/` may never import from `src/render/`, so
    // this weld replaces the import it cannot have. Drift is silent, and shows up only as
    // feet that skate.
    const manifest = readFileSync(MANIFEST, 'utf8');
    const declared = manifest.match(/export const BALGATH_SCALE = ([\d.]+);/)?.[1];
    expect(declared, 'BALGATH_SCALE is missing').toBeTruthy();
    const simScale = templateSource().match(/scale: ([\d.]+),/)?.[1];
    expect(simScale, 'the mob template has no scale').toBeTruthy();
    expect(Number(simScale)).toBe(Number(declared));
  });

  it('keeps his move speed under the gait threshold that would break his stride', () => {
    // 5.2 is the renderer's GAIT_RUN_ENTER. Above it he crosses into the run clip and
    // flip-flops across that boundary mid-chase. walkRef is what his cycle is timed
    // against, and exceeding walkRef * 1.8 pins the clip at its clamp and skates: that
    // exact combination is what made him read as jogging in place at the previous tuning.
    const speed = Number(templateSource().match(/moveSpeed: ([\d.]+),/)?.[1]);
    expect(speed).toBeGreaterThan(0);
    expect(speed, 'would cross into the run gait').toBeLessThan(5.2);
    const walkRef = Number(
      readFileSync(MANIFEST, 'utf8').match(/const BALGATH_WALK_REF = ([\d.]+);/)?.[1],
    );
    expect(walkRef).toBeGreaterThan(0);
    expect(speed / walkRef, 'walk clip would be pinned at its clamp').toBeLessThan(1.8);
  });

  it('telegraphs its mechanics, which is the whole counterplay', () => {
    // Without this his AoEs fire instantly with no ring, and "walk out of the circle"
    // stops being something a player can do.
    expect(templateSource()).toMatch(/telegraphedMechanics: [\d.]+,/);
  });
});
