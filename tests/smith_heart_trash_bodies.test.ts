// The Smith's Heart's own trash and add bodies (src/render/characters/smith_heart_trash_looks.ts,
// scripts/assets/specs/heart_<name>.json): each of the fourteen templates that borrowed a body
// now draws its own shipped GLB; every clip its ClipMap names ships; each blow lands inside the
// longest contact hold; each bar-locked cast puts its key pose on the bar's end; its gait plays
// at the template's speed inside the gait caps with its feet planted; it is one welded skin of
// rigid plates with a glow map that goes out as it dies; it rises out of the floor on its fight's
// cue; it streams on arrival at the raid on a phone; and it came through the compression steps
// at its budget. Looks only: every template keeps its scale, reach, speed and abilities.

import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import {
  type AnimState,
  DEFAULT_RUN_TIME_SCALE_MAX,
  DEFAULT_WALK_TIME_SCALE_MAX,
  desiredBaseState,
  locomotionTimeScale,
} from '../src/render/characters/anim_state';
import { clipNamesOf } from '../src/render/characters/clip_names';
import { VISUALS, type VisualDef, visualKeyFor } from '../src/render/characters/manifest';
import {
  characterStreamPlan,
  dungeonCharacterBodyUrls,
} from '../src/render/characters/rift_body_stream_core';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { SMITH_HEART_TRASH_LOOKS } from '../src/render/characters/smith_heart_trash_looks';
import { CONTACT_HOLD_MAX_SEC } from '../src/render/contact_queue';
import { newLocoState, newLocoTrack, updateLocomotionInto } from '../src/render/locomotion';
import { ARC_CLEAVE_ABILITY } from '../src/render/smith_heart_fx/hammer_fx_core';
import {
  SMITH_HEART_TRASH_RISE,
  TRASH_RISE_CUES,
  TRASH_SOURCE_GESTURES,
} from '../src/render/smith_heart_fx/trash_gestures_core';
import { MOBS } from '../src/sim/data';
import { ISLE_CASTS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { FINAL_PHASE_CASTS, FINAL_PHASES } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_CUES } from '../src/sim/encounters/smith_heart/heat_ids';
import { DT, type Entity } from '../src/sim/types';
import { weldedSkinReport } from './helpers/welded_skin';

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  images: { mimeType: string; bufferView: number }[];
  materials: {
    emissiveTexture?: { index: number };
    pbrMetallicRoughness: { baseColorTexture?: { index: number } };
  }[];
  meshes: { primitives: { indices: number }[] }[];
  extensionsUsed: string[];
}

/** Each body: its template, its look's key, its file, its rig's measured gait (planted-foot
 *  speeds in units/s on the 2.2 tall rig; a floater has none) and its triangle count. */
const BODIES = [
  {
    mob: 'heart_ring_warder',
    key: 'smith_heart_ring_warder',
    file: 'heart_ring_warder',
    walk: 0.587,
    run: 1.564,
    tris: 5227,
  },
  {
    mob: 'heart_breath_warder',
    key: 'smith_heart_breath_warder',
    file: 'heart_breath_warder',
    walk: 0.617,
    run: 1.569,
    tris: 5321,
  },
  {
    mob: 'heart_breath_caller',
    key: 'smith_heart_breath_caller',
    file: 'heart_breath_caller',
    walk: null,
    run: null,
    tris: 5126,
  },
  {
    mob: 'heart_gale_sentinel',
    key: 'smith_heart_gale_sentinel',
    file: 'heart_gale_sentinel',
    walk: 0.65,
    run: 1.63,
    tris: 5152,
  },
  {
    mob: 'heart_gale_mender',
    key: 'smith_heart_gale_mender',
    file: 'heart_gale_mender',
    walk: null,
    run: null,
    tris: 5503,
  },
  {
    mob: 'heart_heat_warder',
    key: 'smith_heart_heat_warder',
    file: 'heart_heat_warder',
    walk: 0.587,
    run: 1.564,
    tris: 5394,
  },
  {
    mob: 'heart_heat_caller',
    key: 'smith_heart_heat_caller',
    file: 'heart_heat_caller',
    walk: null,
    run: null,
    tris: 5298,
  },
  {
    mob: 'heart_heat_wellspawn',
    key: 'smith_heart_wellspawn',
    file: 'heart_wellspawn',
    walk: 0.66,
    run: 1.5,
    tris: 4402,
  },
  {
    mob: 'heart_heat_wellkeeper',
    key: 'smith_heart_wellkeeper',
    file: 'heart_wellkeeper',
    walk: 0.52,
    run: 1.29,
    tris: 5516,
  },
  {
    mob: 'heart_heat_seedflame',
    key: 'smith_heart_seedflame',
    file: 'heart_seedflame',
    walk: 2.0,
    run: 5.5,
    tris: 2930,
  },
  {
    mob: 'heart_final_splinter_hammer',
    key: 'smith_heart_splinter_hammer',
    file: 'heart_splinter_hammer',
    walk: 0.62,
    run: 3.0,
    tris: 5066,
  },
  {
    mob: 'heart_final_splinter_breath',
    key: 'smith_heart_splinter_breath',
    file: 'heart_splinter_breath',
    walk: 0.62,
    run: 3.0,
    tris: 5256,
  },
  {
    mob: 'heart_final_splinter_quench',
    key: 'smith_heart_splinter_quench',
    file: 'heart_splinter_quench',
    walk: 0.62,
    run: 3.0,
    tris: 5262,
  },
  {
    mob: 'heart_final_splinter_heat',
    key: 'smith_heart_splinter_heat',
    file: 'heart_splinter_heat',
    walk: 0.62,
    run: 3.0,
    tris: 5264,
  },
] as const;

/** The bar-locked casts: the cast, its bar's seconds, the second of its clip where its key pose
 *  falls (the bolt flung, the blade landing, the leap landing, the fist on the core). */
const BAR_POSES: Record<string, { bar: number; pose: number }> = {
  heart_gale_bolt: { bar: 2, pose: 2.0 },
  heart_ember_bolt: { bar: 2, pose: 2.0 },
  [FINAL_PHASE_CASTS.shear]: { bar: FINAL_PHASES.shearCast, pose: 2.0 },
  [FINAL_PHASE_CASTS.pounce]: { bar: FINAL_PHASES.pounceCast, pose: 2.1 },
  [FINAL_PHASE_CASTS.toll]: { bar: FINAL_PHASES.tollCast, pose: 0.62 },
};

const PLAYER_HEIGHT = VISUALS.player_warrior.height;

/** The adds their fight walks or sets on a player the moment they spawn: their rise never holds
 *  off a swing. */
const ENGAGED_AT_SPAWN = [...TRASH_RISE_CUES[HEAT_CUES.spawn], ...TRASH_RISE_CUES[HEAT_CUES.hatch]];

/** How far the Entrance clip carries the body up (the largest vertical travel of any bone's
 *  translation in it, rig units on the 2.2 tall rig), read from the shipped (meshopt) GLB. */
async function entranceClimb(file: string): Promise<number> {
  await MeshoptDecoder.ready;
  const doc = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .read(`public/models/creatures/${file}.glb`);
  const anim = doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === 'Entrance');
  let climb = 0;
  const v = [0, 0, 0];
  for (const ch of anim?.listChannels() ?? []) {
    const out = ch.getSampler()?.getOutput();
    if (ch.getTargetPath() !== 'translation' || !out) continue;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < out.getCount(); i++) {
      out.getElement(i, v);
      lo = Math.min(lo, v[1]);
      hi = Math.max(hi, v[1]);
    }
    climb = Math.max(climb, hi - lo);
  }
  return climb;
}

function read(file: string): { file: Buffer; json: GltfJson; clips: Map<string, number> } {
  const buf = readFileSync(`public/models/creatures/${file}.glb`);
  const json = glbJsonChunk(buf) as GltfJson;
  const clips = new Map<string, number>();
  for (const a of json.animations) {
    clips.set(a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)));
  }
  return { file: buf, json, clips };
}

/** The gait rate the body plays at `speed` yd/s, and the base state it picks. */
function gaitAt(def: VisualDef, speed: number): { base: string; rate: number } {
  const track = newLocoTrack();
  const loco = newLocoState();
  for (let i = 0; i < 80; i++) updateLocomotionInto(loco, track, 0, speed * DT, 0, DT, def.gait);
  const state: AnimState = {
    ...loco,
    airborne: false,
    dead: false,
    casting: false,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
  };
  const base = desiredBaseState(state, false);
  const rate =
    locomotionTimeScale(
      base,
      state,
      def.walkRef,
      def.runRef,
      undefined,
      undefined,
      undefined,
      def.walkTimeScaleMax,
      def.runTimeScaleMax,
    ) ?? 0;
  return { base, rate };
}

describe("the Smith's Heart's own trash and add bodies", () => {
  it('replaces every borrowed body but the bodiless cinder, one look each', () => {
    expect(Object.keys(SMITH_HEART_TRASH_LOOKS).sort()).toEqual(BODIES.map((b) => b.key).sort());
    for (const b of BODIES) expect(SMITH_HEART_PLACEHOLDER_LOOKS[b.mob], b.mob).toBe(b.key);
    // No row of the raid borrows a stock body any more.
    for (const [mob, key] of Object.entries(SMITH_HEART_PLACEHOLDER_LOOKS)) {
      expect(key.startsWith('smith_heart_'), mob).toBe(true);
    }
  });

  describe.each(BODIES)('$mob', (b) => {
    const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: b.mob } as Entity)];
    const { file, json, clips } = read(b.file);
    const tpl = MOBS[b.mob];

    it('draws its own painted GLB in its own colours', () => {
      expect(def).toBe(VISUALS[b.key]);
      expect(def.url).toBe(`models/creatures/${b.file}.glb`);
      expect(def.animUrls ?? []).toEqual([]);
      expect(def.bodyless).toBeUndefined();
      expect(def.authoredAtlas).toBe(true);
      expect(def.tint).toBeUndefined();
    });

    it('ships every clip its ClipMap names, and nothing the game never plays', () => {
      const named = new Set(clipNamesOf(def));
      for (const clip of named) expect(clips.has(clip), clip).toBe(true);
      for (const clip of clips.keys()) expect(named.has(clip), clip).toBe(true);
    });

    it('lands every blow inside the longest contact hold, before the next swing, with a recovery', () => {
      expect(def.attackTimeScale).toBe(1);
      expect(def.deathTimeScale).toBe(1);
      const contacts = def.clips.contacts ?? {};
      for (const clip of def.clips.attack) {
        const contact = contacts[clip]?.[0] ?? 0;
        expect(contact, clip).toBeGreaterThan(0);
        expect(contact, clip).toBeLessThanOrEqual(CONTACT_HOLD_MAX_SEC);
        expect(contact, clip).toBeLessThan(tpl.attackSpeed);
        expect(clips.get(clip) ?? 0, clip).toBeGreaterThan(contact + 0.5);
      }
    });

    it('answers its template cleave with its own sweep, its cracks flaring as it lands', () => {
      if (!tpl.arcCleave) {
        expect(def.clips.attackByAbility?.[ARC_CLEAVE_ABILITY]).toBeUndefined();
        return;
      }
      expect(def.clips.attackByAbility?.[ARC_CLEAVE_ABILITY]).toBe('Cleave');
      const contact = def.clips.contacts?.Cleave?.[0] ?? 0;
      const pulse = def.glowPulses?.pulses.find((p) => p.gesture === ARC_CLEAVE_ABILITY);
      expect(Math.abs((pulse?.delay ?? 0) + (pulse?.rise ?? 0) - contact)).toBeLessThan(0.1);
    });

    it("puts every bar-locked cast's key pose on the bar's end, and plays out all but a kick", () => {
      const synced = Array.isArray(def.castClipSync) ? def.castClipSync : [];
      for (const cast of synced) {
        const clip = def.clips.castByAbility?.[cast] ?? '';
        expect(clips.has(clip), cast).toBe(true);
        // Rime Toll can be kicked: a play-out would still ring the fist on the core.
        if (cast === FINAL_PHASE_CASTS.toll)
          expect(def.clips.castPlayOut, cast).not.toContain(clip);
        else expect(def.clips.castPlayOut, cast).toContain(clip);
        const pose = BAR_POSES[cast];
        expect(pose, cast).toBeDefined();
        const rate = def.clips.castTimeScaleByAbility?.[cast] ?? 1;
        expect(Math.abs(rate * pose.bar - pose.pose), cast).toBeLessThan(0.02);
        expect(clips.get(clip) ?? 0, cast).toBeGreaterThan(pose.pose);
      }
      // A caster's bolt is its template's own cast, on its 2 s bar.
      const bolt = tpl.trashKit?.bolt;
      if (bolt) {
        expect(bolt.castTime).toBe(BAR_POSES[bolt.castId].bar);
        expect(synced).toContain(bolt.castId);
      }
    });

    it('towers over a player at its drawn size (the template untouched)', () => {
      const drawn = def.height * tpl.scale;
      const melee = def.clips.attackByAbility?.[ARC_CLEAVE_ABILITY] || b.mob.includes('splinter');
      if (melee) expect(drawn).toBeGreaterThanOrEqual(2.2 * PLAYER_HEIGHT);
      else expect(drawn).toBeGreaterThan(0.5 * PLAYER_HEIGHT);
    });

    it('chases at its template speed with its feet planted, inside the gait caps', () => {
      const size = (def.height / 2.2) * tpl.scale;
      if (b.walk !== null && b.run !== null) {
        expect(def.walkRef).toBeCloseTo(b.walk * size, 1);
        expect(def.runRef).toBeCloseTo(b.run * size, 1);
      } else {
        // A floater: no foot can slide, its run plays at 1x at the template's chase speed.
        expect(def.runRef).toBe(tpl.moveSpeed);
      }
      // The Wellspawn is walked by its encounter at its spawn speed, never the AI's.
      const speed = b.mob === 'heart_heat_wellspawn' ? 3 : tpl.moveSpeed;
      const { base, rate } = gaitAt(def, speed);
      expect(base).toBe('run');
      expect(rate).toBeLessThanOrEqual(def.runTimeScaleMax ?? DEFAULT_RUN_TIME_SCALE_MAX);
      expect(rate).toBeGreaterThanOrEqual(0.6);
      expect(Math.abs(rate * (def.runRef ?? 0) - speed)).toBeLessThan(0.1);
      // Its walk covers a slow step inside its cap too.
      expect((def.walkRef ?? 0) * DEFAULT_WALK_TIME_SCALE_MAX).toBeGreaterThan(
        def.gait?.runExit ?? 1.5,
      );
    });

    it('rises out of the floor on its fight cue, cut short only by a blow that lands', async () => {
      const rises = Object.entries(TRASH_RISE_CUES).some(([, templates]) =>
        templates.includes(b.mob),
      );
      if (!rises) {
        expect(def.clips.entrance).toBeUndefined();
        return;
      }
      expect(def.entranceGesture).toBe(SMITH_HEART_TRASH_RISE);
      expect(def.clips.entrance).toBe('Entrance');
      expect(def.clips.castSnapIn).toContain('Entrance');
      if (ENGAGED_AT_SPAWN.includes(b.mob))
        expect(def.oneShotsHoldAttacks ?? []).not.toContain('Entrance');
      else expect(def.oneShotsHoldAttacks).toContain('Entrance');
      expect(clips.get('Entrance') ?? 0).toBeGreaterThan(1.4);
      // It climbs out of the floor (the Seedflame cracks out of the seed it lies in): the travel
      // survived the build, whichever bone carries it.
      const climb = await entranceClimb(b.file);
      if (b.mob === 'heart_heat_seedflame') expect(climb).toBeLessThan(1);
      else expect(climb).toBeGreaterThan(1.5);
    });

    it('answers every claimed cue it sends with a gesture it maps, never a plain swing', () => {
      for (const row of Object.values(TRASH_SOURCE_GESTURES)) {
        if (!row.templates.includes(b.mob)) continue;
        const clip = def.clips.attackByAbility?.[row.gesture];
        const flare = def.glowPulses?.pulses.some((p) => p.gesture === row.gesture);
        expect(Boolean(clip) || Boolean(flare), row.gesture).toBe(true);
        if (clip) expect(clips.has(clip), row.gesture).toBe(true);
      }
    });

    it('is one welded skin of rigid plates: no seam can open into a see-through gap', async () => {
      const skin = await weldedSkinReport(`public/models/creatures/${b.file}.glb`);
      expect(skin.count).toBeGreaterThan(1000);
      expect(skin.parted).toBe(0);
      expect(skin.singleShare).toBeGreaterThan(0.6);
    });

    it('ships its glow map, and its light goes out as it dies', () => {
      const mat = json.materials[0];
      expect(mat.emissiveTexture).toBeDefined();
      expect(mat.emissiveTexture?.index).not.toBe(mat.pbrMetallicRoughness.baseColorTexture?.index);
      expect(def.glowPulses?.deathFade).toBeGreaterThan(0);
    });

    it('loads on arrival at the raid on a phone, never in the entry stream', () => {
      const plan = characterStreamPlan([def.url], new Set<string>(), true);
      expect(plan.onDemand).toEqual([def.url]);
      expect(plan.postEntry).toEqual([]);
      expect(dungeonCharacterBodyUrls('smith_heart')).toContain(def.url);
    });

    it('came through the compression steps at its budget, as low as its build', () => {
      expect(file.length).toBeLessThanOrEqual(600 * 1024);
      expect(json.extensionsUsed).toEqual(
        expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
      );
      expect(json.accessors[json.meshes[0].primitives[0].indices].count / 3).toBe(b.tris);
      // Two maps, the albedo and the glow, each a 1024 KTX2 in ETC1S (BasisLZ, 1).
      expect(json.images.map((i) => i.mimeType)).toEqual(['image/ktx2', 'image/ktx2']);
      const binStart = 20 + file.readUInt32LE(12) + 8;
      for (const image of json.images) {
        const ktx = binStart + (json.bufferViews[image.bufferView].byteOffset ?? 0);
        expect(file.readUInt32LE(ktx + 20)).toBe(1024);
        expect(file.readUInt32LE(ktx + 24)).toBe(1024);
        expect(file.readUInt32LE(ktx + 44)).toBe(1);
      }
    });
  });

  it("never cuts a Splinter's bar or its play-out with a plain swing", () => {
    for (const b of BODIES.filter((x) => x.mob.includes('splinter'))) {
      expect(VISUALS[b.key].castPlayOutHoldsAttacks, b.mob).toBe(true);
    }
  });

  it("holds the Gale Mender's Mending Gale in its own loop through the channel", () => {
    const def = VISUALS.smith_heart_gale_mender;
    expect(def.clips.castByAbility?.[ISLE_CASTS.mending]).toBe('CastMend');
    expect(def.castClipSync).not.toContain(ISLE_CASTS.mending);
  });
});
