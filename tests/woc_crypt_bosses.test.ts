// The Hollow Crypt's bosses and hero creatures remade through the art guide (concept, Tripo P2,
// a skeleton and every clip built in Blender): Sexton Marrow, Cantor Ilvane, the Lady of the
// Bonechill, the Chapel Gargoyle, the Ossuary Drake, the Knellwyrm and the rime egg sacs. Each
// mob template draws its own shipped GLB (never the old Blender build, never the spider the egg
// sacs fell back to), every clip its ClipMap names ships in that GLB, each bar-locked clip is at
// least as long as the bar the sim runs, the effects' jaw anchors stay over the breath cone,
// both dragons stand on four feet with their wings a separate pair, the Lady's and the Cantor's
// blows land on their frame, and every boss corpse lies on the floor.

import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  anchorWorld,
  DRAKE_JAWS_EXHALE,
  KNELLWYRM_JAWS_STRAFE,
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

  it('pours the breath from the drake jaws over its cone, at its own scale', () => {
    const t = MOBS.crypt_ossuary_drake;
    const cone = t.breathCone;
    expect(cone).toBeDefined();
    const jaws = anchorWorld(DRAKE_JAWS_EXHALE, 0, 0, 0, 0, t.scale);
    const reach = Math.hypot(jaws.x, jaws.z);
    // ahead of the body, inside the cone's reach, and thrust low (under half the drake's
    // drawn height) to pour onto the floor
    expect(jaws.z).toBeGreaterThan(0);
    expect(reach).toBeLessThan(cone?.range ?? 0);
    expect(jaws.y).toBeLessThan(0.5 * defOf('crypt_ossuary_drake').height * t.scale);
  });

  it('pours the Knellwyrm fire on the wing from one pair of strafing jaws', () => {
    const t = MOBS.crypt_knellwyrm;
    const jaws = anchorWorld(KNELLWYRM_JAWS_STRAFE, 0, 0, 0, 0, t.scale);
    // ahead of the body and inside its drawn height, the neck plunged
    expect(jaws.z).toBeGreaterThan(0);
    expect(jaws.y).toBeGreaterThan(0);
    expect(jaws.y).toBeLessThan(defOf('crypt_knellwyrm').height * t.scale);
    // the Pyre Strafe run and the Knell's pour both play Strafe and read the same anchor
    for (const file of ['crypt_finale_fx.ts', 'knell_fx.ts']) {
      const src = readFileSync(`src/render/hollow_crypt/${file}`, 'utf8');
      expect(src, file).toMatch(/anchorWorld\(\s*KNELLWYRM_JAWS_STRAFE,/);
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

  it('lands the Lady and the Cantor blows on their frame, the swing played at 1x', () => {
    for (const mob of ['rimeweb', 'cantor_ilvane']) {
      const def = defOf(mob);
      expect(def.attackTimeScale, mob).toBe(1);
      const shipped = clipsOf(BODIES[mob]);
      for (const clip of def.clips.attack) {
        const contact = def.clips.contacts?.[clip]?.[0] ?? 0;
        // a coiled windup first (over half a second), the blow well inside the clip
        expect(contact, `${mob} ${clip}`).toBeGreaterThan(0.5);
        expect(contact, `${mob} ${clip}`).toBeLessThan((shipped.get(clip) ?? 0) - 0.5);
      }
    }
  });
});

// --- the corpses rest on the floor --------------------------------------------------------------
// Each boss is skinned from its shipped GLB at the idle's measure time and at the Death clip's
// last frame, and placed the way the game places it (assets.ts: `height` over the idle's posed
// bounds, the idle's lowest vertex on the anchor, `hover` added). The old deaths each broke one of
// these: the dragons hung on a wing tip nine yards up (their middle at 0.70 of their height), the
// Lady and the Cantor lay propped on a gown panel and a hymnal (fifth percentile at 0.11 and 0.12
// of their height), the gargoyle ended in a heap (middle 0.38), and the Sexton's back floated over
// a flung hand (middle 0.16).

interface Gltf {
  getRoot(): {
    listNodes(): GNode[];
    listAnimations(): GAnim[];
  };
}
interface GNode {
  getName(): string;
  getTranslation(): number[];
  getRotation(): number[];
  getScale(): number[];
  listChildren(): GNode[];
  getMesh(): { listPrimitives(): GPrim[] } | null;
  getSkin(): { listJoints(): GNode[]; getInverseBindMatrices(): GAcc | null } | null;
}
interface GAcc {
  getCount(): number;
  getElement(i: number, out: number[]): number[];
  getScalar(i: number): number;
  getMax(out: number[]): number[];
}
interface GPrim {
  getAttribute(name: string): GAcc | null;
}
interface GChannel {
  getTargetNode(): GNode | null;
  getTargetPath(): string | null;
  getSampler(): { getInput(): GAcc; getOutput(): GAcc } | null;
}
interface GAnim {
  getName(): string;
  listChannels(): GChannel[];
}

async function readShipped(url: string): Promise<Gltf> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return (await io.read(`public/${url}`)) as unknown as Gltf;
}

function sampleChannel(ch: GChannel, t: number): number[] {
  const s = ch.getSampler();
  if (!s) return [];
  const input = s.getInput();
  const output = s.getOutput();
  const n = input.getCount();
  let i = 0;
  while (i < n - 1 && input.getScalar(i + 1) <= t + 1e-6) i++;
  const v0 = output.getElement(i, []);
  if (i >= n - 1) return v0;
  const u = (t - input.getScalar(i)) / (input.getScalar(i + 1) - input.getScalar(i));
  const v1 = output.getElement(i + 1, []);
  if (ch.getTargetPath() === 'rotation') {
    const q = new Quaternion().fromArray(v0).slerp(new Quaternion().fromArray(v1), u);
    return q.toArray();
  }
  return v0.map((x, k) => x + (v1[k] - x) * u);
}

/** Every vertex's height (glTF y) with the clip sampled at `t`, by linear blend skinning. */
function skinnedHeights(doc: Gltf, anim: GAnim, t: number): number[] {
  const nodes = doc.getRoot().listNodes();
  const parentOf = new Map<GNode, GNode>();
  for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c, n);
  const chans = anim.listChannels();
  const local = new Map<GNode, Matrix4>();
  for (const n of nodes) {
    const get = (path: string, d: number[]) => {
      const ch = chans.find((c) => c.getTargetNode() === n && c.getTargetPath() === path);
      return ch ? sampleChannel(ch, t) : d;
    };
    local.set(
      n,
      new Matrix4().compose(
        new Vector3().fromArray(get('translation', n.getTranslation())),
        new Quaternion().fromArray(get('rotation', n.getRotation())),
        new Vector3().fromArray(get('scale', n.getScale())),
      ),
    );
  }
  const world = new Map<GNode, Matrix4>();
  const worldOf = (n: GNode): Matrix4 => {
    const known = world.get(n);
    if (known) return known;
    const p = parentOf.get(n);
    const m = p
      ? worldOf(p)
          .clone()
          .multiply(local.get(n) as Matrix4)
      : (local.get(n) as Matrix4);
    world.set(n, m);
    return m;
  };
  const skinNode = nodes.find((n) => n.getMesh() && n.getSkin()) as GNode;
  const skin = skinNode.getSkin() as NonNullable<ReturnType<GNode['getSkin']>>;
  const ibm = skin.getInverseBindMatrices() as GAcc;
  const jointMats = skin.listJoints().map((j, i) =>
    worldOf(j)
      .clone()
      .multiply(new Matrix4().fromArray(ibm.getElement(i, []))),
  );
  const out: number[] = [];
  const v = new Vector3();
  const p = new Vector3();
  for (const prim of (
    skinNode.getMesh() as NonNullable<ReturnType<GNode['getMesh']>>
  ).listPrimitives()) {
    const pos = prim.getAttribute('POSITION') as GAcc;
    const js = prim.getAttribute('JOINTS_0') as GAcc;
    const ws = prim.getAttribute('WEIGHTS_0') as GAcc;
    for (let i = 0; i < pos.getCount(); i++) {
      v.fromArray(pos.getElement(i, []));
      const ji = js.getElement(i, []);
      const wi = ws.getElement(i, []);
      let y = 0;
      for (let k = 0; k < 4; k++) {
        if (!wi[k]) continue;
        y += wi[k] * p.copy(v).applyMatrix4(jointMats[ji[k]]).y;
      }
      out.push(y);
    }
  }
  return out;
}

const clipEnd = (anim: GAnim) =>
  Math.max(...anim.listChannels().map((c) => c.getSampler()?.getInput().getMax([])[0] ?? 0));

describe('the Hollow Crypt boss corpses', () => {
  // [mob, fifth-percentile ceiling, middle ceiling], each a fraction of the drawn height
  const CORPSES: [string, number, number][] = [
    ['crypt_ossuary_drake', 0.1, 0.35],
    ['crypt_knellwyrm', 0.1, 0.35],
    ['crypt_chapel_gargoyle', 0.1, 0.3],
    ['rimeweb', 0.05, 0.26],
    ['cantor_ilvane', 0.06, 0.15],
    ['sexton_marrow', 0.015, 0.1],
  ];
  for (const [mob, p5Ceiling, midCeiling] of CORPSES) {
    it(`lays the ${mob} corpse on the floor`, async () => {
      const def = defOf(mob);
      const doc = await readShipped(BODIES[mob]);
      const anims = new Map(
        doc
          .getRoot()
          .listAnimations()
          .map((a) => [a.getName(), a]),
      );
      const idle = anims.get(def.clips.idle) as GAnim;
      const death = anims.get(def.clips.death) as GAnim;
      const idleYs = skinnedHeights(doc, idle, Math.min(0.5, clipEnd(idle) * 0.5));
      const lo = Math.min(...idleYs);
      const scale = def.height / (Math.max(...idleYs) - lo);
      const drawn = skinnedHeights(doc, death, clipEnd(death))
        .map((y) => (def.hover ?? 0) + scale * (y - lo))
        .sort((a, b) => a - b);
      const p5 = drawn[Math.floor(drawn.length * 0.05)];
      const mid = drawn[Math.floor(drawn.length / 2)];
      expect(p5 / def.height, `${mob} fifth percentile`).toBeLessThan(p5Ceiling);
      expect(mid / def.height, `${mob} middle`).toBeLessThan(midCeiling);
    });
  }
});
