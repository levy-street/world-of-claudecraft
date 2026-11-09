// The render guards behind the dormant Hammer Vein Warder (src/sim/mob/dormant.ts: Entity.asleep
// until the raid pulls it, then the rise):
//  1. CharacterVisual (src/render/characters/visual.ts): a body in the 'sleep' base state does not
//     flinch (playHit starts no one-shot), and the asleep-to-awake edge plays the ClipMap's `wake`
//     clip (the Warder's Awaken) once. Driven through the production factory and a real
//     AnimationMixer, with only asset IO stubbed (the character_tpose_repair.test.ts harness): the
//     Warder's own VisualDef on a small skinned stand-in that binds the SHIPPED GLB's clip list at
//     the shipped lengths (read off its JSON chunk, as druid_cat_animation.test.ts does).
//  2. The renderer (src/render/renderer.ts): a dead body is never drawn asleep, and a body killed
//     in its sleep keeps its heap until the killing blade lands (contact_queue.ts
//     heldUntilCollapse over the rig's own `sleeping`). The per-entity frame loop cannot be driven
//     in Node, so that half is a comment-stripped source pin.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

const WARDER_GLB = 'models/creatures/heart_hammer_warder.glb';
const FRAME = 1 / 60;
const HITS = ['Hit', 'Hit2'];

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
}

/** The shipped GLB's clips by name and length (the JSON chunk alone, nothing decoded). */
function shippedClipLengths(): Map<string, number> {
  const file = readFileSync(new URL(`../public/${WARDER_GLB}`, import.meta.url));
  const json = glbJsonChunk(file) as GltfJson;
  const out = new Map<string, number>();
  for (const a of json.animations) {
    out.set(a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)));
  }
  return out;
}

const CLIPS = shippedClipLengths();

/** A minimally real skinned rig carrying every shipped clip at its shipped length. The bones are
 *  stand-ins (the pose is not under test); the clip set and timing are the file's own. */
function warderStandIn() {
  const scene = new THREE.Group();
  const rootBone = new THREE.Bone();
  rootBone.name = 'RigRoot';
  const childBone = new THREE.Bone();
  childBone.name = 'RigChild';
  childBone.position.y = 1;
  rootBone.add(childBone);
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const vertexCount = geometry.getAttribute('position').count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 1;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, childBone]));
  scene.add(mesh);
  const animations = [...CLIPS].map(
    ([name, length]) =>
      new THREE.AnimationClip(name, length, [
        new THREE.NumberKeyframeTrack('RigChild.position[x]', [0, length], [0, 1]),
      ]),
  );
  return { scene, animations };
}

const warder = {
  kind: 'mob',
  id: 1,
  templateId: 'heart_hammer_warder',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
  offhandItemId: null,
} as unknown as Entity;

const anim = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});

/** The mixer state the visual keeps private. */
type MixerPeek = {
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  baseState: string;
};
const peek = (visual: CharacterVisual) => visual as unknown as MixerPeek;
const playing = (visual: CharacterVisual) => peek(visual).current?.getClip().name;

describe('the Hammer Vein Warder asleep and waking (CharacterVisual)', () => {
  let create: typeof import('../src/render/characters/index').createCharacterVisual;
  let visual: CharacterVisual;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn((url: string) =>
        Promise.resolve(
          url === WARDER_GLB ? warderStandIn() : { scene: new THREE.Group(), animations: [] },
        ),
      ),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    // A raid-only body streams on arrival, never at boot: land it the way the arrival does.
    const assets = await import('../src/render/characters/assets');
    await assets.prepareDungeonCharacterBodies('smith_heart');
    create = (await import('../src/render/characters/index')).createCharacterVisual;
  });

  beforeEach(() => {
    const built = create(warder);
    if (!built) throw new Error('test harness failed to build the Warder');
    visual = built;
  });

  afterEach(() => visual?.dispose());

  const tick = (over: Partial<AnimState>, frames = 1) => {
    for (let i = 0; i < frames; i++) visual.update(FRAME, anim(over), true);
  };
  const hitRunning = () => HITS.some((hit) => peek(visual).actions.get(hit)?.isRunning());

  it('binds the sleep and wake clips its ClipMap names, and flinches when awake (the control)', () => {
    for (const clip of ['Sleep', 'Awaken', ...HITS]) {
      expect(peek(visual).actions.has(clip), clip).toBe(true);
    }
    tick({ combat: true }, 60);
    expect(peek(visual).baseState).toBe('combatIdle');
    visual.playHit();
    expect(visual.isMidOneShot).toBe(true);
    expect(HITS).toContain(playing(visual));
    expect(hitRunning()).toBe(true);
  });

  it('sleeps through a blow: playHit starts no one-shot while the sleep loop holds the rig', () => {
    tick({ asleep: true }, 60);
    expect(peek(visual).baseState).toBe('sleep');
    expect(playing(visual)).toBe('Sleep');
    // A blow can reach the rig before the bit that ends its sleep (the sim wakes it on its next
    // dormant pass), so the flinch may be asked for while it still lies asleep, already engaged.
    tick({ asleep: true, combat: true });
    expect(peek(visual).baseState).toBe('sleep');
    visual.playHit();
    expect(visual.isMidOneShot).toBe(false);
    expect(hitRunning()).toBe(false);
    expect(playing(visual)).toBe('Sleep');
    tick({ asleep: true, combat: true }, 30);
    expect(playing(visual)).toBe('Sleep');
    expect(peek(visual).current?.getEffectiveWeight()).toBe(1);
  });

  it('says when it lies asleep, which the renderer holds through a death the blade has not landed', () => {
    expect(visual.sleeping).toBe(false);
    tick({ asleep: true }, 60);
    expect(visual.sleeping).toBe(true);
    tick({ combat: true });
    expect(visual.sleeping).toBe(false);
  });

  it('wakes nobody else: a body parked asleep starts again from its idle when the pool reuses it', () => {
    tick({ asleep: true }, 60);
    expect(playing(visual)).toBe('Sleep');
    visual.resetForReuse();
    expect(peek(visual).baseState).toBe('idle');
    // Handed to a Warder already in its fight: its stance at once, never the whole rise.
    tick({ combat: true }, 30);
    expect(playing(visual)).toBe('CombatIdle');
    expect(visual.isMidOneShot).toBe(false);
    expect(peek(visual).actions.get('Awaken')?.isRunning() ?? false).toBe(false);
  });

  it('stands up once on the asleep-to-awake edge: Awaken at 1x, uncut by a blow, then its stance', () => {
    tick({ asleep: true }, 60);
    tick({ asleep: true, combat: true });
    expect(playing(visual)).toBe('Sleep');

    // The wake: the asleep bit drops with the pull already on it.
    tick({ combat: true });
    const awaken = peek(visual).actions.get('Awaken');
    expect(playing(visual)).toBe('Awaken');
    expect(visual.isMidOneShot).toBe(true);
    expect(awaken?.loop).toBe(THREE.LoopOnce);
    expect(awaken?.clampWhenFinished).toBe(true);
    expect(awaken?.timeScale).toBe(1);
    expect(peek(visual).baseState).toBe('combatIdle');

    // A blow landing on or after the wake's frame finds the rise playing, which holds it off.
    visual.playHit();
    expect(playing(visual)).toBe('Awaken');
    expect(hitRunning()).toBe(false);

    // The whole clip at 1x from its first frame, never restarted...
    const length = CLIPS.get('Awaken') ?? 0;
    expect(length).toBeGreaterThan(1);
    const frames = Math.floor(length / FRAME) - 3;
    tick({ combat: true }, frames);
    expect(playing(visual)).toBe('Awaken');
    expect(Math.abs((awaken?.time ?? 0) - (frames + 1) * FRAME)).toBeLessThan(1.5 * FRAME);
    // ...then the rig goes to its stance, and the rise does not come back while it stays awake.
    tick({ combat: true }, 30);
    expect(playing(visual)).toBe('CombatIdle');
    expect(visual.isMidOneShot).toBe(false);
    const after = new Set<string>();
    for (let i = 0; i < Math.ceil(length / FRAME); i++) {
      tick({ combat: true });
      after.add(playing(visual) ?? '');
    }
    expect([...after]).toEqual(['CombatIdle']);

    // Standing, the next blow flinches it: nothing the sleep or the rise turned away lingers on.
    visual.playHit();
    expect(HITS).toContain(playing(visual));
  });
});

describe('the renderer never draws a dead body asleep, nor wakes one it is killing', () => {
  // Comment-stripped, so a commented-out guard or the prose beside it cannot satisfy the pin.
  const renderer = stripComments(
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
  );

  it('masks the asleep bit with visuallyDead and holds it through a held death, before the rig reads it', () => {
    // The ONE write of the bit in the frame, so nothing later hands the rig an unmasked copy.
    expect(renderer.match(/\bst\.asleep\s*=(?!=)/g) ?? []).toHaveLength(1);
    const dead = renderer.indexOf('st.dead = visuallyDead;');
    // While the collapse waits for the blade the rig keeps showing what it showed (its heap): the
    // sim clears a corpse's sleep on the death tick, which would otherwise read as the wake edge.
    const asleep = renderer.indexOf(
      'st.asleep = heldUntilCollapse(deathHeld, e.asleep === true && !visuallyDead, active.sleeping);',
    );
    const read = renderer.indexOf('active.update(dt, st, animate, this.reducedMotion());');
    expect(dead).toBeGreaterThan(-1);
    expect(asleep).toBeGreaterThan(dead);
    expect(read).toBeGreaterThan(asleep);
  });
});
