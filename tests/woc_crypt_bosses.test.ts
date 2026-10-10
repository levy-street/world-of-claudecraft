// The Hollow Crypt's bosses and hero creatures remade through the art guide (concept, Tripo P2,
// a skeleton and every clip built in Blender): Sexton Marrow, Cantor Ilvane, the Lady of the
// Bonechill, the Chapel Gargoyle, the Ossuary Drake, the Knellwyrm and the rime egg sacs. Each
// mob template draws its own shipped GLB (never the old Blender build, never the spider the egg
// sacs fell back to), every clip its ClipMap names ships in that GLB, each bar-locked clip is at
// least as long as the bar the sim runs, the effects' jaw anchors stay over the breath cone, and
// both dragons stand on four feet with their wings a separate pair.

import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  anchorWorld,
  DRAKE_JAWS_EXHALE,
  KNELLWYRM_JAWS_EXHALE,
} from '../src/render/hollow_crypt/crypt_creature_fx_core';
import { MOBS } from '../src/sim/data';
import { ILVANE_DIRGE, ILVANE_TUNING } from '../src/sim/encounters/hollow_crypt/ilvane_ids';
import {
  MARROW_GRAVEDIGGERS_BLOW,
  MARROW_MEASURE,
  MARROW_SHOVELFUL,
  MARROW_TUNING,
} from '../src/sim/encounters/hollow_crypt/marrow_ids';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../src/sim/mob/trash_kit/cast_ids';
import type { Entity } from '../src/sim/types';

const BODIES: Record<string, string> = {
  sexton_marrow: 'models/creatures/woc_crypt_sexton_marrow.glb',
  cantor_ilvane: 'models/creatures/woc_crypt_cantor_ilvane.glb',
  rimeweb: 'models/creatures/woc_crypt_lady_bonechill.glb',
  crypt_chapel_gargoyle: 'models/creatures/woc_crypt_gargoyle.glb',
  crypt_ossuary_drake: 'models/creatures/woc_crypt_ossuary_drake.glb',
  crypt_knellwyrm: 'models/creatures/woc_crypt_knellwyrm.glb',
  rime_egg_sac: 'models/creatures/woc_crypt_rime_egg_sac.glb',
};

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
}

function clipsOf(url: string): Map<string, number> {
  const json = glbJsonChunk(readFileSync(`public/${url}`)) as GltfJson;
  const out = new Map<string, number>();
  for (const a of json.animations) {
    const end = Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
    out.set(a.name, end);
  }
  return out;
}

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface RestJoint {
  pos: Vector3;
  /** The joint's ancestors, its parent first. */
  chain: string[];
}

/** Each node's rest position in the model's own space (y up, +z forward), by name. */
function restJoints(url: string): Map<string, RestJoint> {
  const { nodes } = glbJsonChunk(readFileSync(`public/${url}`)) as { nodes: GltfNode[] };
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parentOf.set(c, i);
  });
  const out = new Map<string, RestJoint>();
  nodes.forEach((n, i) => {
    const world = new Matrix4();
    const chain: string[] = [];
    for (let at: number | undefined = i; at !== undefined; at = parentOf.get(at)) {
      const a = nodes[at];
      world.premultiply(
        new Matrix4().compose(
          new Vector3().fromArray(a.translation ?? [0, 0, 0]),
          new Quaternion().fromArray(a.rotation ?? [0, 0, 0, 1]),
          new Vector3().fromArray(a.scale ?? [1, 1, 1]),
        ),
      );
      if (at !== i) chain.push(a.name ?? '');
    }
    out.set(n.name ?? '', { pos: new Vector3().setFromMatrixPosition(world), chain });
  });
  return out;
}

const defOf = (templateId: string) => VISUALS[visualKeyFor({ kind: 'mob', templateId } as Entity)];

describe('the Hollow Crypt boss bodies', () => {
  it('draws each boss from its own art-guide GLB, untinted', () => {
    for (const [mob, url] of Object.entries(BODIES)) {
      const def = defOf(mob);
      expect(def.url, mob).toBe(url);
      expect(def.animUrls ?? [], mob).toEqual([]);
      expect(def.authoredAtlas, mob).toBe(true);
      expect(def.tint, mob).toBeUndefined();
    }
  });

  it('draws the rime egg sacs as egg sacs, not the spider their family falls back to', () => {
    const key = visualKeyFor({ kind: 'mob', templateId: 'rime_egg_sac' } as Entity);
    expect(key).toBe('crypt_rime_egg_sac');
    expect(VISUALS[key].url).not.toMatch(/spider/);
    // the shells burst on death, the moment the hatchling springs from them
    expect(VISUALS[key].clips.death).toBe('Death');
    expect(MOBS.rime_egg_sac.broodEgg?.burstSchool).toBe('frost');
  });

  it('ships every clip each ClipMap names', () => {
    for (const [mob, url] of Object.entries(BODIES)) {
      const { clips } = defOf(mob);
      const shipped = clipsOf(url);
      const named = [
        clips.idle,
        clips.combatIdle,
        clips.walk,
        clips.run,
        clips.jump,
        clips.fall,
        clips.land,
        ...clips.attack,
        ...(clips.hit ?? []),
        clips.death,
        clips.flourish,
        clips.cast,
        clips.idleBeat?.clip,
        ...Object.values(clips.attackByAbility ?? {}),
        ...Object.values(clips.castByAbility ?? {}),
        ...(clips.castPlayOut ?? []),
      ].filter((c): c is string => typeof c === 'string');
      for (const clip of named) expect(shipped.has(clip), `${mob}: ${clip}`).toBe(true);
    }
  });

  it('authors each bar-locked strike at rate 1, long enough to land on its bar and play out', () => {
    const cases: [string, string, string, number][] = [
      ['sexton_marrow', MARROW_SHOVELFUL, 'Shovelful', MARROW_TUNING.shovelCast],
      ['sexton_marrow', MARROW_MEASURE, 'Measure', MARROW_TUNING.measureCast],
      ['sexton_marrow', MARROW_GRAVEDIGGERS_BLOW, 'GravediggersBlow', MARROW_TUNING.blowCast],
      ['crypt_ossuary_drake', CRYPT_BARROWFLAME_BREATH, 'Breath', 2],
      ['crypt_ossuary_drake', CRYPT_TAIL_LASH, 'TailSweep', 1],
      ['crypt_ossuary_drake', CRYPT_WING_GUST, 'WingBuffet', 1.5],
    ];
    for (const [mob, ability, clip, bar] of cases) {
      const def = defOf(mob);
      expect(def.clips.castByAbility?.[ability], mob).toBe(clip);
      expect(def.clips.castTimeScaleByAbility?.[ability] ?? 1, `${mob} ${clip}`).toBe(1);
      expect(def.clips.castPlayOut, mob).toContain(clip);
      const length = clipsOf(BODIES[mob]).get(clip) ?? 0;
      expect(length, `${mob} ${clip}`).toBeGreaterThan(bar + 0.3);
    }
    // the drake's bars are the template's own
    const drake = MOBS.crypt_ossuary_drake;
    expect(drake.breathCone?.castTime).toBe(2);
    // the Dirge is sung on its 2.5 s bar: the peak lands inside it and is held to its end
    const ilvane = defOf('cantor_ilvane');
    expect(ilvane.clips.castByAbility?.[ILVANE_DIRGE]).toBe('Sing');
    expect(ilvane.castClipSync).toContain(ILVANE_DIRGE);
    const sing = clipsOf(BODIES.cantor_ilvane).get('Sing') ?? 0;
    expect(Math.abs(sing - ILVANE_TUNING.dirgeCast)).toBeLessThan(1 / 30 + 1e-6);
  });

  it('pours the breath from jaws over each wyrm cone, at its own scale', () => {
    for (const [mob, jawsAnchor] of [
      ['crypt_ossuary_drake', DRAKE_JAWS_EXHALE],
      ['crypt_knellwyrm', KNELLWYRM_JAWS_EXHALE],
    ] as const) {
      const t = MOBS[mob];
      const cone = t.breathCone;
      expect(cone, mob).toBeDefined();
      const jaws = anchorWorld(jawsAnchor, 0, 0, 0, 0, t.scale);
      const reach = Math.hypot(jaws.x, jaws.z);
      // ahead of the body, inside the cone's reach, and thrust low (under half the wyrm's
      // drawn height) to pour onto the floor
      expect(jaws.z, mob).toBeGreaterThan(0);
      expect(reach, mob).toBeLessThan(cone?.range ?? 0);
      expect(jaws.y, mob).toBeLessThan(0.5 * defOf(mob).height * t.scale);
    }
  });

  it('stands each dragon on four feet, its wings a separate pair off the chest', () => {
    for (const mob of ['crypt_ossuary_drake', 'crypt_knellwyrm']) {
      const joints = restJoints(BODIES[mob]);
      const at = (name: string): RestJoint => {
        const joint = joints.get(name);
        expect(joint, `${mob}: ${name}`).toBeDefined();
        return joint as RestJoint;
      };
      const head = at('head').pos.y;
      for (const side of ['l', 'r']) {
        const fore = at(`fingers.${side}`).pos;
        const hind = at(`toes.${side}`).pos;
        // both feet planted on the floor, the forefoot well ahead of the hind
        expect(fore.y, `${mob} forefoot ${side}`).toBeLessThan(0.1 * head);
        expect(hind.y, `${mob} hind foot ${side}`).toBeLessThan(0.1 * head);
        expect(fore.z - hind.z, `${mob} stance ${side}`).toBeGreaterThan(0.25 * head);
        // the wing hangs off the chest, never off a leg
        const wing = at(`wing.1.${side}`).chain;
        expect(wing[0], `${mob} wing ${side}`).toBe('chest');
        expect(
          wing.filter((b) => /arm|hand|leg|foot/.test(b)),
          `${mob} wing ${side}`,
        ).toEqual([]);
      }
    }
  });

  it('keeps the Knellwyrm clearly over the drake as they stand in game', () => {
    const wyrm = defOf('crypt_knellwyrm').height * MOBS.crypt_knellwyrm.scale;
    const drake = defOf('crypt_ossuary_drake').height * MOBS.crypt_ossuary_drake.scale;
    expect(wyrm).toBeGreaterThan(drake * 1.2);
  });
});
