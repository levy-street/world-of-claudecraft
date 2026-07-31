// The hunter's bow-cycle clips must exist inside the shipped GLBs the manifest
// binds them from (a body rebuild that drops Bow_Release would otherwise fail
// silently: visual.ts gates the cycle on action presence and falls back to the
// plain attack one-shot). Reads the GLB JSON chunk directly, no decoder needed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';

interface GlbGltf {
  animations?: {
    name?: string;
    channels: { sampler: number; target: { node?: number } }[];
    samplers?: { input: number }[];
  }[];
  accessors?: { min?: number[]; max?: number[] }[];
  nodes?: { name?: string }[];
}

function readGlbJson(path: string): GlbGltf {
  const glb = readFileSync(path);
  expect(glb.readUInt32LE(0), `${path} magic`).toBe(0x46546c67);
  const jsonLen = glb.readUInt32LE(12);
  expect(glb.readUInt32LE(16), `${path} first chunk must be JSON`).toBe(0x4e4f534a);
  return JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
}

describe('hunter bow-cycle assets', () => {
  const def = VISUALS.player_hunter;
  const rb = def.clips.rangedBow;

  it('declares the full cycle on the hunter def', () => {
    expect(rb).toBeTruthy();
    expect(rb?.draw).toBe('Spellcasting');
    expect(rb?.hold).toBe('2H_Ranged_Shoot');
    expect(rb?.release).toBe('Bow_Release');
    // the release's snap sits between the 0.133s and 0.167s authored keys;
    // arming later than the snap would play it before the launch event
    expect(rb?.releaseArmAt).toBeGreaterThan(0);
    expect(rb?.releaseArmAt).toBeLessThan(0.17);
  });

  it('ships every cycle clip inside the base body GLB, bound to live nodes', () => {
    const gltf = readGlbJson(join(__dirname, '..', 'public', def.url));
    const clipNames = new Set((gltf.animations ?? []).map((a) => a.name));
    for (const name of [rb!.draw, rb!.hold, rb!.release]) {
      expect(clipNames, `clip ${name} missing from ${def.url}`).toContain(name);
    }
    // every release channel must target a real node (the retarget contract:
    // the clip was authored on this rig's own mixamorig bone names)
    const release = (gltf.animations ?? []).find((a) => a.name === rb!.release);
    const nodeCount = gltf.nodes?.length ?? 0;
    expect(release?.channels.length ?? 0).toBeGreaterThan(0);
    for (const ch of release?.channels ?? []) {
      expect(ch.target.node, 'release channel with no node target').toBeTypeOf('number');
      expect(ch.target.node!).toBeLessThan(nodeCount);
    }
    // releaseArmAt is calibrated against THIS clip's authored keyframes (the
    // string-snap sits between the 0.133s and 0.167s keys of the 0.70s track):
    // a rebake that keeps the name but retimes the clip would silently desync
    // the snap from the launch, so pin the duration the samplers actually span.
    let releaseDuration = 0;
    for (const ch of release?.channels ?? []) {
      const sampler = release?.samplers?.[ch.sampler];
      const input = sampler ? gltf.accessors?.[sampler.input] : undefined;
      releaseDuration = Math.max(releaseDuration, input?.max?.[0] ?? 0);
    }
    expect(releaseDuration).toBeGreaterThan(0.69);
    expect(releaseDuration).toBeLessThan(0.71);
    expect(rb!.releaseArmAt).toBeLessThan(releaseDuration);
  });

  it('keeps the armored variant on the clip-borrowing chain to the base body', () => {
    // hunter_lvl20.glb ships armor meshes only; its def must borrow clips from
    // the base body GLB (where Bow_Release lives) via animUrls
    const armored = VISUALS.player_hunter_armored;
    expect(armored.clips.rangedBow).toEqual(rb);
    expect(armored.animUrls ?? []).toContain(def.url);
  });

  it('keeps the mech suit OFF the cycle (its KayKit rig cannot bind these clips)', () => {
    const mech = VISUALS.player_hunter_mech;
    expect(mech.clips.rangedBow).toBeUndefined();
    expect(mech.clips.attack).toEqual(['2H_Ranged_Shoot']);
    // and ON its crossbow: the suit plays the shoulder-aim clip, so the base
    // body's default bow (inherited via the armoredVariant spread) would read
    // backwards in its hands
    expect(mech.attach?.map((a) => a.url)).toEqual(['models/weapons/crossbow_1handed.glb']);
    expect(mech.attach?.[0].bone).toBe('handslot.l');
  });
});
