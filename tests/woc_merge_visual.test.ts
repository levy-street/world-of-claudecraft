// @vitest-environment happy-dom
// The merged WOC draws on a REAL CharacterVisual, with only asset IO stubbed
// (tests/helpers/woc_visual_harness.ts): the visual.ts host itself, wired to the head
// dressing (woc_head_dressing.ts, woc_head_merge.ts, the merged layer of
// woc_head_tint.ts) and the armor dressing (woc_armor_dressing.ts, woc_armor_merge.ts)
// the way the world view wires it (index.ts createCharacterVisual, then renderer.ts
// createCharacterVisualWithRetry). The unit suites drive each module against a fake
// host; every case here is a bug the real host had, each named where it is pinned:
// the stand-in's mount rides the renderer's work queue, which only arrives with the
// compile gate; a body whose rig is not drawn asks for nothing; the hit response's
// shader reaches a merged head; a reveal the gate could not prove costs one more try,
// never the head (or the kit) for life, and an effect edge while a stand-in links is no
// miss at all; a head of a program already linked shows with no gate of its own; a
// translucent effect puts the head back into its pieces in the call that mounts it; the
// worn kit folds into one draw per file material and a re-dress drops it at once; a
// settle a replaced gate still delivers shows no stand-in that is not standing; and a
// seeded run of the whole lifecycle never draws a piece twice, never leaves a hole and
// gives every geometry back.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { Rng } from '../src/sim/rng';
import {
  BASE,
  FULL_KIT_EQUIPPED,
  FULL_KIT_PARTS,
  IDLE,
  player,
  releaseWocVisualHarness,
  type WocHarnessVisual,
  type WocVisualHarness,
  type WocVisualHarnessOptions,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocHarnessVisual;
type Appearance = Record<string, unknown>;
type Gate = (target: THREE.Object3D, settle: (ready?: () => boolean) => void) => void;

/** The work-queue labels a stand-in's mount rides (`kind:instance`): a head or a kit
 *  whose geometry is still to build, and one somebody already built. */
const HEAD_MERGE_UNIT = 'woc-head-merge:a';
const HEAD_MOUNT_UNIT = 'woc-head-mount:a';
const ARMOR_MERGE_UNIT = 'woc-armor-merge:male';
const ARMOR_MOUNT_UNIT = 'woc-armor-mount:male';
/** The compile-gate targets: a merged head's wrapper, a merged kit's, and the hidden
 *  scratch group an effect's unlinked clones link on. */
const HEAD_GATE = 'woc_head_merged';
const ARMOR_GATE = 'woc_armor_merged';
const EFFECT_GATE = 'character_effect_compile_scratch';

/** A gate's proof that what it was asked to link is linked, and its opposite (a
 *  timeout, a lane that gave up). */
const PROVEN = (): boolean => true;
const UNPROVEN = (): boolean => false;

/** One unit of work a body handed the renderer's queue. */
interface Unit {
  readonly run: () => void;
  readonly priority: number | undefined;
  readonly label: string | undefined;
}

/** The renderer's background work queue as a body sees it (background_gpu_queue.ts),
 *  holding every unit until the case runs it: what the real one's frame budget does to
 *  a crowd arriving at once. */
function heldQueue() {
  const units: Unit[] = [];
  return {
    units,
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
      return new Promise<T>((resolve) => {
        units.push({ run: () => resolve(work() as T), priority, label });
      });
    },
    /** Run every unit queued so far, in the order it was asked for. */
    drain(): void {
      for (const unit of units.splice(0)) unit.run();
    },
  };
}

/**
 * A harness whose bodies are built the way the world view builds them: the real factory
 * (index.ts createCharacterVisual: the merge opt-in and the look, on a body just
 * constructed), THEN the compile gate with the work queue riding in beside it
 * (renderer.ts createCharacterVisualWithRetry), then the first worn-set diff.
 */
async function world(opts: WocVisualHarnessOptions = {}) {
  const h = await wocVisualHarness(opts);
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const gate: Gate = (target, settle) => h.gates.push({ target, settle });
  /** `equipped`: the worn items (bare by default). */
  const body = (
    app: Appearance,
    wiring: {
      queue?: ReturnType<typeof heldQueue>;
      equipped?: Record<string, string>;
      gate?: Gate;
    } = {},
  ): Visual => {
    const v = createCharacterVisual(player(app));
    if (!v) throw new Error('the fixture body did not build');
    v.setFarBakeGate(wiring.gate ?? gate, wiring.queue);
    v.setWocEquipment(wiring.equipped ?? {}, false);
    return v;
  };
  /** One frame of every body given: the clock moves, each body updates, then every gate
   *  request in flight settles with `ready` (null: none settles). Returns the targets
   *  the frame asked the gate to link. */
  const frame = (bodies: Visual | readonly Visual[], ready: (() => boolean) | null = PROVEN) => {
    h.nextFrame(16);
    for (const v of Array.isArray(bodies) ? bodies : [bodies as Visual])
      v.update(0.016, IDLE, true);
    const asked = h.gates.map((g) => g.target.name);
    if (ready) for (const g of h.gates.splice(0)) g.settle(ready);
    return asked;
  };
  /** The default look with its chin at `chin`: a face (and so a merged head) of its own. */
  const face = (chin: number): Appearance => ({
    ...h.DEFAULT_APPEARANCE,
    headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth: chin },
  });
  return { h, body, frame, face, gate };
}

// ---------------------------------------------------------------------------
// What a body draws, read off the scene alone
// ---------------------------------------------------------------------------

/** The articulated rig of a body (hidden while its far mesh stands in). */
function rigOf(v: Visual): THREE.Object3D {
  const rig = v.root.getObjectByName('character_model_wrap');
  if (!rig) throw new Error('the body has no rig');
  return rig;
}

/** Whether a node is shown within its rig: it and everything above it is visible. */
function shownInRig(o: THREE.Object3D, rig: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = o; at && at !== rig; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

const vertices = (mesh: THREE.Mesh): number => mesh.geometry.getAttribute('position').count;
const worn = (mesh: THREE.Mesh): THREE.Material =>
  (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
const names = (meshes: readonly THREE.Object3D[]): string[] => meshes.map((m) => m.name).sort();

/** The meshes of a body's head and armor, by what they are (the tags the packs and the
 *  merges stamp), and of each whether it draws: shown within the rig and in the render
 *  lists (a piece a stand-in folds is taken out of them with `layers.mask = 0`). */
function sceneOf(v: Visual) {
  const rig = rigOf(v);
  const mergedHeads: THREE.Mesh[] = [];
  const pieces: THREE.Mesh[] = [];
  const mergedArmor: THREE.Mesh[] = [];
  const parts: THREE.Mesh[] = [];
  rig.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (o.userData.wocHeadMerged) mergedHeads.push(mesh);
    else if (o.userData.wocHeadPart) pieces.push(mesh);
    else if (o.userData.wocArmorMerged) mergedArmor.push(mesh);
    else if (o.userData.wocArmorPart) parts.push(mesh);
  });
  const shown = (mesh: THREE.Mesh): boolean => shownInRig(mesh, rig);
  const draws = (mesh: THREE.Mesh): boolean => shown(mesh) && mesh.layers.mask !== 0;
  return { mergedHeads, pieces, mergedArmor, parts, shown, draws };
}

/** The merged head mesh mounted on a body (drawn or still linking), or null. */
const mergedHeadOf = (v: Visual): THREE.Mesh | null => sceneOf(v).mergedHeads[0] ?? null;

/** Every armor mesh a body draws, parts and stand-ins alike, by name. */
function drawnArmor(v: Visual): string[] {
  const s = sceneOf(v);
  return names([...s.parts, ...s.mergedArmor].filter(s.draws));
}

/** The host's own records of its meshes (private on CharacterVisual): what its
 *  material sweeps restore from, what its shadow switch walks, and that switch. */
interface HostRecords {
  readonly originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  readonly casters: THREE.Mesh[];
  readonly shadowOn: boolean;
}

/**
 * Everything wrong with how a body draws its head and its armor right now (empty: all
 * is well). The rule, for the head and the armor alike: each piece the dressing shows
 * is drawn EXACTLY once, by itself (in the render lists) or folded into a stand-in that
 * draws, never both and never neither; a stand-in that draws is opaque and is THE
 * stand-in for the pieces out of the render lists (their vertices are its vertices), a
 * merged head through the merged tint layer whatever effect it wears; and the host's
 * records hold every mounted stand-in (its shadow flag the body's) and none it dropped.
 *
 * Which pieces fold is the fixture's: every head piece but a gold piercing (its
 * material's name earns the worn metal layer, which the merged material does not
 * carry), and the armor parts that share a file material with another drawn part.
 */
function drawProblems(h: WocVisualHarness, v: Visual): string[] {
  const out: string[] = [];
  const s = sceneOf(v);
  const total = (meshes: readonly THREE.Mesh[]): number =>
    meshes.reduce((n, mesh) => n + vertices(mesh), 0);
  // the head
  if (s.mergedHeads.length > 1) out.push(`${s.mergedHeads.length} merged heads are mounted`);
  const head = s.mergedHeads.find(s.draws) ?? null;
  const folded = s.pieces.filter((piece) => piece.layers.mask === 0);
  if (!head) {
    if (folded.length > 0) out.push(`no stand-in draws for the head pieces ${names(folded)}`);
  } else {
    if (worn(head).transparent) out.push('the merged head draws through a transparent material');
    if (!h.wocHeadMergedTintOf(worn(head))) out.push('the merged head draws without its layer');
    for (const piece of s.pieces) {
      const gold = h.heads.wocHeadFileMaterial(piece)?.name === 'metal_gold';
      const mask = piece.layers.mask;
      if (!s.shown(piece)) {
        if (mask === 0) out.push(`the hidden head piece ${piece.name} is folded`);
      } else if (gold && mask === 0) out.push(`the piercing ${piece.name} is drawn by nothing`);
      else if (!gold && mask !== 0) out.push(`the head piece ${piece.name} is drawn twice`);
    }
    if (vertices(head) !== total(folded)) {
      out.push(`the merged head has ${vertices(head)} vertices, its pieces ${total(folded)}`);
    }
  }
  // the armor
  const standing = s.mergedArmor.filter(s.draws);
  const taken = s.parts.filter((part) => part.layers.mask === 0);
  if (standing.length === 0) {
    if (taken.length > 0) out.push(`no stand-in draws for the armor parts ${names(taken)}`);
  } else {
    if (standing.length !== s.mergedArmor.length) out.push('half a merged kit draws');
    for (const mesh of standing) {
      if (worn(mesh).transparent) out.push(`${mesh.name} draws through a transparent material`);
    }
    const byMaterial = new Map<THREE.Material | null, THREE.Mesh[]>();
    for (const part of s.parts) {
      if (!s.shown(part)) {
        if (part.layers.mask === 0) out.push(`the hidden armor part ${part.name} is folded`);
        continue;
      }
      const material = h.armorFileMaterial(part);
      byMaterial.set(material, [...(byMaterial.get(material) ?? []), part]);
    }
    let batches = 0;
    for (const batch of byMaterial.values()) {
      if (batch.length > 1) batches++;
      for (const part of batch) {
        const mask = part.layers.mask;
        if (batch.length === 1 && mask === 0)
          out.push(`the lone part ${part.name} is drawn by nothing`);
        if (batch.length > 1 && mask !== 0) out.push(`the armor part ${part.name} is drawn twice`);
      }
    }
    if (standing.length !== batches) {
      out.push(`${standing.length} merged armor meshes draw for ${batches} shared materials`);
    }
    if (total(standing) !== total(taken)) {
      out.push(`the merged kit has ${total(standing)} vertices, its parts ${total(taken)}`);
    }
  }
  // the host's records
  const records = v as unknown as HostRecords;
  const attached = (o: THREE.Object3D): boolean => {
    let at: THREE.Object3D | null = o;
    while (at && at !== v.root) at = at.parent;
    return at === v.root;
  };
  const isStandIn = (mesh: THREE.Mesh): boolean =>
    !!mesh.userData.wocHeadMerged || !!mesh.userData.wocArmorMerged;
  for (const mesh of [...s.mergedHeads, ...s.mergedArmor]) {
    if (!records.originalMaterials.has(mesh)) out.push(`${mesh.name} is unknown to the host`);
    // the pieces it folds cast nothing while they are out of the render lists: it casts
    // for them, exactly while the body's shadows are on
    if (mesh.castShadow !== records.shadowOn) {
      out.push(`${mesh.name} casts ${mesh.castShadow}, the body's shadows are ${records.shadowOn}`);
    }
  }
  for (const mesh of records.originalMaterials.keys()) {
    if (isStandIn(mesh) && !attached(mesh))
      out.push(`the host still records a dropped ${mesh.name}`);
  }
  for (const mesh of records.casters) {
    if (isStandIn(mesh) && !attached(mesh)) out.push(`a dropped ${mesh.name} still casts`);
  }
  return out;
}

/** How a body's head is drawn: 'merged' (its one stand-in draws, the pieces it folds out
 *  of the render lists), 'pieces' (every piece draws by itself; a stand-in may be
 *  mounted, hidden, while its programs link), or what is wrong with it. */
function headDrawn(h: WocVisualHarness, v: Visual): string {
  const problems = drawProblems(h, v);
  if (problems.length > 0) return problems.join('; ');
  const s = sceneOf(v);
  return s.mergedHeads.some(s.draws) ? 'merged' : 'pieces';
}

/** The leases still out on a merged geometry cache (one count per built geometry). */
const leases = (cache: ReadonlyMap<string, { refs: number }>): number[] =>
  [...cache.values()].map((entry) => entry.refs);

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** How many preprocessor conditionals are open at `index` of a shader text (0: the line
 *  there compiles whatever is defined). */
function conditionalDepth(text: string, index: number): number {
  let depth = 0;
  for (const raw of text.slice(0, index).split('\n')) {
    const line = raw.trim();
    if (/^#\s*if/.test(line)) depth++;
    else if (/^#\s*endif/.test(line)) depth--;
  }
  return depth;
}

/**
 * The renderer's own far-bake gate (renderer.ts farBakeGate) with the driver faked:
 * asked to link a target, every material under it gets a linked program and every
 * texture is uploaded, and the settle hands back the renderer's REAL proof
 * (compile_target_readiness.ts) over the target as it is by then. A material an
 * effect mounted on the target meanwhile was never linked by this gate, so the proof
 * reads unprepared, exactly as it does in the world.
 */
async function rendererGate() {
  const { compileTargetPrepared } = await import('../src/render/compile_target_readiness');
  const { markProgramReady } = await import('../src/render/linked_program_readiness');
  const { collectPrewarmTextures } = await import('../src/render/texture_prewarm');
  const records = new WeakMap<object, unknown>();
  const properties = { get: (o: object): unknown => records.get(o) };
  const linking: { target: THREE.Object3D; settle: () => boolean }[] = [];
  const gate: Gate = (target, settle) => {
    target.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const program = { getUniforms: () => ({}), getAttributes: () => ({}) };
        markProgramReady(program);
        records.set(material, { programs: new Map([['fixture', program]]) });
      }
    });
    const textures = new Set<THREE.Texture>();
    collectPrewarmTextures(target, textures);
    for (const t of textures) records.set(t, { __webglTexture: {}, __version: t.version });
    linking.push({
      target,
      /** Settle the link; returns what the proof answered. */
      settle: () => {
        const proof = compileTargetPrepared(properties, target);
        settle(() => proof);
        return proof;
      },
    });
  };
  /** Settle the links in flight on targets named `name`; returns each proof. */
  const settle = (name: string): boolean[] => {
    const due = linking.filter((entry) => entry.target.name === name);
    for (const entry of due) linking.splice(linking.indexOf(entry), 1);
    return due.map((entry) => entry.settle());
  };
  return { gate, linking, settle };
}

afterEach(() => releaseWocVisualHarness());

describe("a merged head's mount rides the renderer's work queue", () => {
  it('twelve arrivals in one frame hand the queue twelve units, and nothing mounts until it runs them', async () => {
    // guards: the host captured the work queue when the visual was constructed, before
    // the gate installed it, so every mount ran on the spot, unthrottled
    const { h, body, frame, face } = await world();
    const queue = heldQueue();
    const crowd = Array.from({ length: 12 }, (_, i) => body(face(i / 12), { queue }));
    // built, wired and dressed: nothing is asked for outside a frame
    expect(queue.units).toHaveLength(0);
    // ONE frame, the queue running nothing (its budget is spent)
    frame(crowd, null);
    expect(queue.units.map((unit) => unit.label)).toEqual(crowd.map(() => HEAD_MERGE_UNIT));
    for (const unit of queue.units) expect(unit.priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    // ...and nothing mounted in it: no stand-in, no geometry built, no program to link
    expect(crowd.filter((v) => mergedHeadOf(v) !== null)).toHaveLength(0);
    expect(h.headMergeCache.size).toBe(0);
    expect(h.gates).toHaveLength(0);
    for (const v of crowd) expect(headDrawn(h, v)).toBe('pieces');
    // a body whose unit has not run asks for no second one
    frame(crowd, null);
    frame(crowd, null);
    expect(queue.units).toHaveLength(12);
    // the queue gets to three of them: three heads mount, hidden while they link
    for (const unit of queue.units.splice(0, 3)) unit.run();
    expect(crowd.map((v) => mergedHeadOf(v) !== null)).toEqual(crowd.map((_, i) => i < 3));
    expect(h.headMergeCache.size).toBe(3);
    expect(new Set(h.gates.map((g) => g.target.name))).toEqual(new Set([HEAD_GATE]));
    for (const v of crowd) expect(headDrawn(h, v)).toBe('pieces');
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    expect(crowd.map((v) => headDrawn(h, v))).toEqual(
      crowd.map((_, i) => (i < 3 ? 'merged' : 'pieces')),
    );
    // the nine still waiting are still one unit each, and stand once it runs
    frame(crowd, null);
    expect(queue.units).toHaveLength(9);
    queue.drain();
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    for (const v of crowd) expect(headDrawn(h, v)).toBe('merged');
    expect(leases(h.headMergeCache)).toEqual(crowd.map(() => 1));
    // steady state: a standing head asks for nothing more
    frame(crowd);
    expect(queue.units).toHaveLength(0);
    // a newcomer in a face somebody already built only mounts: its own label kind
    const twin = body(face(0), { queue });
    frame(twin, null);
    expect(queue.units.map((unit) => unit.label)).toEqual([HEAD_MOUNT_UNIT]);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    queue.drain();
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    expect(headDrawn(h, twin)).toBe('merged');
    expect(h.headMergeCache.size).toBe(12);
    for (const v of [...crowd, twin]) v.dispose();
    expect(leases(h.headMergeCache)).toEqual(crowd.map(() => 0));
  });

  it('a body shown by its far mesh, or not shown at all, asks for nothing until its rig draws', async () => {
    // guards: a stand-in was built for a body nobody saw (a far crowd paid every mount)
    const { h, body, frame } = await world({ kit: 'full' });
    const queue = heldQueue();
    const equipped = { ...FULL_KIT_EQUIPPED };
    const asked = (): (string | undefined)[] => queue.units.map((unit) => unit.label).sort();
    const far = body({ ...h.DEFAULT_APPEARANCE }, { queue, equipped });
    // into the far band before its first frame: the far mesh mints, links, stands in
    h.nextFrame();
    far.setFar(true);
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    far.setFar(true);
    expect(far.root.getObjectByName('character_far_mesh')?.visible).toBe(true);
    expect(rigOf(far).visible).toBe(false);
    frame(far);
    frame(far);
    expect(queue.units).toHaveLength(0);
    // back near: one unit for its kit and one for its head
    far.setFar(false);
    expect(rigOf(far).visible).toBe(true);
    frame(far, null);
    expect(asked()).toEqual([ARMOR_MERGE_UNIT, HEAD_MERGE_UNIT]);
    // far again by the time the queue gets to them: each looks again, and mounts nothing
    far.setFar(true);
    queue.drain();
    expect(mergedHeadOf(far)).toBeNull();
    expect(sceneOf(far).mergedArmor).toHaveLength(0);
    expect(h.headMergeCache.size + h.armorMergeCache.size).toBe(0);
    frame(far);
    expect(queue.units).toHaveLength(0);
    // near for good: asked again, and these mount
    far.setFar(false);
    frame(far, null);
    expect(asked()).toEqual([ARMOR_MERGE_UNIT, HEAD_MERGE_UNIT]);
    queue.drain();
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    expect(headDrawn(h, far)).toBe('merged');
    expect(drawnArmor(far)).toEqual(['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1']);
    // a body the renderer switched off (a form stands in for it, a gated arrival)
    const hidden = body({ ...h.DEFAULT_APPEARANCE }, { queue, equipped });
    hidden.setActive(false);
    frame(hidden);
    frame(hidden);
    expect(queue.units).toHaveLength(0);
    // shown: it asks, for a head and a kit the first body already built
    hidden.setActive(true);
    frame(hidden, null);
    expect(asked()).toEqual([ARMOR_MOUNT_UNIT, HEAD_MOUNT_UNIT]);
    far.dispose();
    hidden.dispose();
  });
});

describe('the hit response reaches a merged head', () => {
  const EMISSION = 'totalEmissiveRadiance+=surfaceEmission;';
  const SHEEN = 'roughnessFactor=mix(roughnessFactor,0.23,surfaceCoat);';

  it.each([
    { lib: 'standard', lowTier: false },
    { lib: 'lambert', lowTier: true },
  ] as const)(
    "a struck merged head glows: the response's emission is in its $lib shader",
    async ({ lib, lowTier }) => {
      // guards: the merged layer replaced the emissive and roughness chunks outright, so
      // the hit response, attached after it, found no anchor and a struck head never glowed
      const { h, body, frame } = await world({ lowTier });
      const v = body({ ...h.DEFAULT_APPEARANCE });
      frame(v);
      expect(headDrawn(h, v)).toBe('merged');
      const head = mergedHeadOf(v) as THREE.Mesh;
      const plain = worn(head);
      expect(plain.type).toBe(lowTier ? 'MeshLambertMaterial' : 'MeshStandardMaterial');
      v.respondToElement('fire', 0.75);
      // its program is new: linked hidden first, the head drawing its plain one meanwhile
      expect(h.gates.map((g) => g.target.name)).toEqual([EFFECT_GATE]);
      expect(worn(head)).toBe(plain);
      for (const g of h.gates.splice(0)) g.settle(PROVEN);
      frame(v);
      // committed: the merged head wears the response, and still stands (it is opaque)
      const struck = worn(head);
      expect(struck).not.toBe(plain);
      expect(struck.userData.wocSurfaceResponseProgram).toBe(true);
      expect(h.wocHeadMergedTintOf(struck)).toBe(h.wocHeadMergedTintOf(plain));
      expect(h.wocHeadMergedTintOf(struck)).not.toBeNull();
      expect(headDrawn(h, v)).toBe('merged');
      // three's own source for the shader, as WebGLPrograms hands it to the hook
      const shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib[lib].vertexShader,
        fragmentShader: THREE.ShaderLib[lib].fragmentShader,
      };
      struck.onBeforeCompile(shader as never, {} as never);
      const fragment = shader.fragmentShader;
      // the response adds its emission, once, right after the emissive map chunk the
      // merged layer left in place, and outside every conditional: nothing resolves it away
      expect(count(fragment, EMISSION)).toBe(1);
      expect(fragment).toContain(`#include <emissivemap_fragment>\n${EMISSION}`);
      expect(conditionalDepth(fragment, fragment.indexOf(EMISSION))).toBe(0);
      // ...on the merged layer's own shader, its slot tables still in it
      expect(count(fragment, 'uniform vec4 uWocHmRef[')).toBe(1);
      if (lib === 'standard') {
        // its roughness edit (the frost sheen) is still in the text, after the chunk
        // that declares the factor it eases
        expect(count(fragment, SHEEN)).toBe(1);
        expect(fragment).toContain(
          `#include <roughnessmap_fragment>\nif(uSurfaceKind>0.5 && uSurfaceKind<1.5)${SHEEN}`,
        );
        expect(conditionalDepth(fragment, fragment.indexOf(SHEEN))).toBe(0);
      } else {
        // a Lambert has no roughness stage: nothing of the sheen to carry
        expect(THREE.ShaderLib.lambert.fragmentShader).not.toContain('roughnessmap_fragment');
        expect(fragment).not.toContain(SHEEN);
      }
      v.dispose();
    },
  );
});

describe('a reveal the gate could not prove', () => {
  it('costs the head one more try, never the merge for life', async () => {
    // guards: one unprepared reveal (the gate's own timeout) left a head in its pieces
    // for as long as the body lived
    const { h, body, frame } = await world();
    const v = body({ ...h.DEFAULT_APPEARANCE });
    // the first reveal comes back unprepared: the head keeps its pieces, nothing mounted
    expect(frame(v, UNPROVEN)).toEqual([HEAD_GATE]);
    expect(headDrawn(h, v)).toBe('pieces');
    expect(mergedHeadOf(v)).toBeNull();
    expect(leases(h.headMergeCache)).toEqual([0]);
    // ...and is planned again: the next frame asks, and the healthy gate lets it stand
    expect(frame(v, PROVEN)).toEqual([HEAD_GATE]);
    expect(headDrawn(h, v)).toBe('merged');
    expect(frame(v, PROVEN)).toEqual([]);
    v.dispose();
  });

  it('twice in a row leaves the head in its pieces, without asking every frame for ever', async () => {
    // guards: a gate that cannot link a head's program was asked again on every frame
    const { h, body, frame, face } = await world();
    const v = body({ ...h.DEFAULT_APPEARANCE });
    expect(frame(v, UNPROVEN)).toEqual([HEAD_GATE]);
    expect(frame(v, UNPROVEN)).toEqual([HEAD_GATE]);
    const asked: string[] = [];
    for (let i = 0; i < 30; i++) asked.push(...frame(v, PROVEN));
    expect(asked).toEqual([]);
    expect(headDrawn(h, v)).toBe('pieces');
    expect(mergedHeadOf(v)).toBeNull();
    // it is that head that is left alone, not the body: another face merges
    v.setWocHeadLook(face(1));
    expect(frame(v, PROVEN)).toEqual([HEAD_GATE]);
    expect(headDrawn(h, v)).toBe('merged');
    v.dispose();
  });

  it.each([
    {
      edge: 'a buff glow',
      // an opaque effect: the same program on another material object, mounted at once,
      // which no gate ever linked, so the proof reads the stand-in as unprepared
      proof: false,
      land: (v: Visual, _settle: (name: string) => boolean[], _frame: () => void) =>
        v.setAuraGlow(0xffaa00, 0.5),
      end: (v: Visual) => v.setAuraGlow(0xffaa00, 0),
    },
    {
      edge: 'a hit response',
      // a program of its own: linked on its own scratch set (the stand-in's clone with
      // it), then mounted from a frame, so the proof holds over what the stand-in wears
      proof: true,
      land: (v: Visual, settle: (name: string) => boolean[], frame: () => void) => {
        v.respondToElement('frost', 0.75);
        expect(settle(EFFECT_GATE)).toEqual([true]);
        frame();
      },
      end: (v: Visual) => v.clearElementResponse(),
    },
  ])(
    '$edge landing while the stand-in links still ends with the head merged',
    async ({ proof, land, end }) => {
      // guards: an effect edge between the gate's start and its settle swapped the
      // material the proof reads, the reveal came back unprepared, and the head stayed
      // in its pieces for good
      const { h, body, face } = await world();
      const { gate, linking, settle } = await rendererGate();
      const v = body(face(0.3), { gate });
      const frame = (): void => {
        h.nextFrame(16);
        v.update(0.016, IDLE, true);
      };
      frame();
      // mounted, hidden, its link in flight
      expect(linking.map((entry) => entry.target.name)).toEqual([HEAD_GATE]);
      const head = mergedHeadOf(v) as THREE.Mesh;
      const linked = worn(head);
      expect(headDrawn(h, v)).toBe('pieces');
      land(v, settle, frame);
      // the stand-in wears another material than the one the gate was asked to link
      expect(worn(head)).not.toBe(linked);
      expect(mergedHeadOf(v)).toBe(head);
      // the link settles on the renderer's own proof, and whatever it says, nothing
      // would link on a draw: the head stands
      expect(settle(HEAD_GATE)).toEqual([proof]);
      expect(headDrawn(h, v)).toBe('merged');
      expect(mergedHeadOf(v)).toBe(head);
      // and it is still standing once the effect is over
      end(v);
      for (let i = 0; i < 4; i++) {
        frame();
        for (const name of [HEAD_GATE, EFFECT_GATE]) settle(name);
      }
      expect(headDrawn(h, v)).toBe('merged');
      v.dispose();
      expect(leases(h.headMergeCache)).toEqual([0]);
    },
  );
});

describe('the linked-program shortcut', () => {
  it('only the first head of a program waits behind the gate; one mounted under a hit response takes it', async () => {
    const { h, body, frame, face } = await world();
    const gated = (asked: readonly string[]): number =>
      asked.filter((name) => name === HEAD_GATE).length;
    // the first head links the plain merged program behind the gate
    const first = body(face(0.1));
    expect(gated(frame(first))).toBe(1);
    expect(headDrawn(h, first)).toBe('merged');
    // guards: every head of a crowd queued a gate of its own behind every other reveal,
    // though all of them draw with the one program the first already linked
    const second = body(face(0.9));
    expect(frame(second, null)).toEqual([]);
    expect(headDrawn(h, second)).toBe('merged');
    // another face, another buffer, the SAME materials: that is what makes it free
    expect(mergedHeadOf(second)?.geometry).not.toBe(mergedHeadOf(first)?.geometry);
    expect(worn(mergedHeadOf(second) as THREE.Mesh).customProgramCacheKey()).toBe(
      worn(mergedHeadOf(first) as THREE.Mesh).customProgramCacheKey(),
    );
    // guards: the shortcut also revealed a head that mounted under a hit response, whose
    // program (the response's, on the merged layer) nobody had linked
    const struck = body(face(0.5));
    struck.respondToElement('fire', 0.75);
    expect(h.gates.map((g) => g.target.name)).toEqual([EFFECT_GATE]);
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    // the frame mounts its head under the response: it waits for the gate, in pieces
    expect(frame(struck, null)).toEqual([HEAD_GATE]);
    const head = mergedHeadOf(struck) as THREE.Mesh;
    expect(worn(head).userData.wocSurfaceResponseProgram).toBe(true);
    expect(headDrawn(h, struck)).toBe('pieces');
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    expect(headDrawn(h, struck)).toBe('merged');
    for (const v of [first, second, struck]) v.dispose();
  });
});

describe('a translucent effect on a merged head', () => {
  /** The pieces a body's look shows, and whether every one of them is back in the render
   *  lists with no merged wrapper left under the body. */
  const inPieces = (v: Visual): boolean => {
    const s = sceneOf(v);
    const drawn = s.pieces.filter(s.shown);
    return (
      drawn.length > 0 &&
      drawn.every((piece) => piece.layers.mask === 1) &&
      s.mergedHeads.length === 0 &&
      v.root.getObjectByName(HEAD_GATE) === undefined
    );
  };
  const translucent = (v: Visual): boolean[] => {
    const s = sceneOf(v);
    return s.pieces.filter(s.shown).map((piece) => worn(piece).transparent);
  };

  it.each([
    { effect: 'the ghost run', set: (v: Visual, on: boolean) => v.setGhost(on, 'spirit') },
    { effect: 'stealth', set: (v: Visual, on: boolean) => v.setGhost(on, 'stealth') },
    { effect: 'Shadowform', set: (v: Visual, on: boolean) => v.setShadowform(on) },
  ])(
    '$effect puts the head back into its pieces in the call that mounts it, and it merges again after',
    async ({ set }) => {
      // guards: a merged head stayed standing under a translucent effect (one two sided
      // mesh blending what three sorts piece by piece), or came down a frame late
      const { h, body, frame } = await world();
      const v = body({ ...h.DEFAULT_APPEARANCE });
      frame(v);
      expect(headDrawn(h, v)).toBe('merged');
      const head = mergedHeadOf(v) as THREE.Mesh;
      const wrapper = head.parent as THREE.Object3D;
      expect(wrapper.name).toBe(HEAD_GATE);
      // guards: the Soul Rend prewarm linked a translucent clone for the merged head,
      // which is never drawn that way (the pieces are)
      const slots = v.prewarmSoulRendSlots();
      expect(slots.map((slot) => slot.source.name)).toContain(BASE);
      expect(slots.some((slot) => slot.source === head)).toBe(false);
      // the effect's clones are not linked yet: they link hidden, the body unchanged
      set(v, true);
      const staging = h.gates.find((g) => g.target.name === EFFECT_GATE);
      if (!staging) throw new Error('the effect was not staged behind the gate');
      const staged = staging.target.children as THREE.Mesh[];
      // guards: the staging linked a translucent clone for the merged head too
      expect(staged.length).toBeGreaterThan(0);
      expect(staged.every((mesh) => worn(mesh).transparent)).toBe(true);
      expect(staged.some((mesh) => mesh.geometry === head.geometry)).toBe(false);
      expect(headDrawn(h, v)).toBe('merged');
      for (const g of h.gates.splice(0)) g.settle(PROVEN);
      // the frame that mounts the effect takes the stand-in down inside that very call
      h.nextFrame(16);
      v.update(0.016, IDLE, true);
      expect(inPieces(v)).toBe(true);
      expect(translucent(v).every(Boolean)).toBe(true);
      expect(wrapper.parent).toBeNull();
      expect(drawProblems(h, v)).toEqual([]);
      expect(leases(h.headMergeCache)).toEqual([0]);
      // for as long as it lasts: pieces, and nothing asked of the gate for a stand-in
      expect(frame(v).filter((name) => name === HEAD_GATE)).toEqual([]);
      expect(frame(v).filter((name) => name === HEAD_GATE)).toEqual([]);
      expect(inPieces(v)).toBe(true);
      // the effect ends: opaque pieces at once, the stand-in back from a later frame
      set(v, false);
      expect(translucent(v).some(Boolean)).toBe(false);
      frame(v);
      frame(v);
      expect(headDrawn(h, v)).toBe('merged');
      // again, its clones linked by now: the swap, and the drop, land inside the setter
      set(v, true);
      expect(h.gates.filter((g) => g.target.name === EFFECT_GATE)).toEqual([]);
      expect(inPieces(v)).toBe(true);
      expect(translucent(v).every(Boolean)).toBe(true);
      expect(drawProblems(h, v)).toEqual([]);
      set(v, false);
      frame(v);
      frame(v);
      expect(headDrawn(h, v)).toBe('merged');
      v.dispose();
    },
  );

  it('a stealth called off before its clones linked still ends with the head merged', async () => {
    // guards: a head adopted straight into an effect that never showed on the pieces was
    // taken down and never planned again
    const { h, body, frame } = await world();
    const v = body({ ...h.DEFAULT_APPEARANCE });
    // stealth starts while the head still waits to merge: its clones link behind the gate
    v.setGhost(true, 'stealth');
    expect(h.gates.map((g) => g.target.name)).toEqual([EFFECT_GATE]);
    // the frame mounts the waiting head, straight into the effect: taken down again
    frame(v, null);
    expect(mergedHeadOf(v)).toBeNull();
    expect(headDrawn(h, v)).toBe('pieces');
    // called off before the gate settled (it never will): the pieces never showed it
    v.setGhost(false);
    h.gates.length = 0;
    const s = sceneOf(v);
    expect(s.pieces.filter(s.shown).some((piece) => worn(piece).transparent)).toBe(false);
    frame(v);
    frame(v);
    expect(headDrawn(h, v)).toBe('merged');
    v.dispose();
  });
});

describe('the merged armor on the real host', () => {
  const KIT_PARTS = Object.values(FULL_KIT_PARTS).flat();
  /** The file material each merged armor mesh a body draws stands for, with its size. */
  const standIns = (v: Visual): { material: string; vertices: number }[] => {
    const s = sceneOf(v);
    return s.mergedArmor
      .filter(s.draws)
      .map((mesh) => ({ material: worn(mesh).name, vertices: vertices(mesh) }))
      .sort((a, b) => (a.material < b.material ? -1 : 1));
  };

  it('a full kit folds into one draw per file material, mounted by a unit of the queue', async () => {
    // guards: the armor's mount ran on the spot too (the same captured queue), and a kit
    // drew one mesh per part
    const { h, body, frame } = await world({ kit: 'full' });
    const queue = heldQueue();
    const v = body({ ...h.DEFAULT_APPEARANCE }, { queue, equipped: { ...FULL_KIT_EQUIPPED } });
    // dressed: seven part meshes on three file materials
    expect(drawnArmor(v)).toEqual([...KIT_PARTS].sort());
    const parts = sceneOf(v).parts;
    const sizeOf = (list: readonly string[]): number =>
      parts.filter((part) => list.includes(part.name)).reduce((n, part) => n + vertices(part), 0);
    for (const [material, list] of Object.entries(FULL_KIT_PARTS)) {
      const meshes = parts.filter((part) => h.armorFileMaterial(part)?.name === material);
      expect(names(meshes), material).toEqual([...list].sort());
    }
    // one frame: a unit for the kit and one for the head, nothing mounted
    frame(v, null);
    expect(queue.units.map((unit) => unit.label).sort()).toEqual([
      ARMOR_MERGE_UNIT,
      HEAD_MERGE_UNIT,
    ]);
    for (const unit of queue.units) expect(unit.priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(sceneOf(v).mergedArmor).toHaveLength(0);
    expect(h.armorMergeCache.size).toBe(0);
    frame(v, null);
    expect(queue.units).toHaveLength(2);
    // the queue runs them: mounted, hidden while they link, the parts still drawing
    queue.drain();
    expect(h.gates.map((g) => g.target.name).sort()).toEqual([ARMOR_GATE, HEAD_GATE]);
    expect(sceneOf(v).mergedArmor).toHaveLength(2);
    expect(drawnArmor(v)).toEqual([...KIT_PARTS].sort());
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    // linked: ONE mesh per file material two parts share, the lone glove left alone
    expect(standIns(v)).toEqual([
      { material: 'kit_hide', vertices: sizeOf(FULL_KIT_PARTS.kit_hide) },
      { material: 'kit_plate', vertices: sizeOf(FULL_KIT_PARTS.kit_plate) },
    ]);
    expect(drawnArmor(v)).toEqual(['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1']);
    expect(drawnArmor(v)).toHaveLength(Object.keys(FULL_KIT_PARTS).length);
    expect(drawProblems(h, v)).toEqual([]);
    expect(headDrawn(h, v)).toBe('merged');
    expect(leases(h.armorMergeCache)).toEqual([1, 1]);
    // steady state: nothing more is asked for
    frame(v);
    expect(queue.units).toHaveLength(0);
    v.dispose();
    expect(leases(h.armorMergeCache)).toEqual([0, 0]);
  });

  it('a part hidden by a re-dress drops the stand-in inside that call, and a later frame brings it back', async () => {
    // guards: a re-dress left the stand-in up until the next poll, so a part the player
    // took off kept drawing through it
    const { h, body, frame } = await world({ kit: 'full' });
    const v = body({ ...h.DEFAULT_APPEARANCE }, { equipped: { ...FULL_KIT_EQUIPPED } });
    const partsOf = (...hidden: string[]): string[] =>
      KIT_PARTS.filter((name) => !hidden.includes(name)).sort();
    const settled = (...hidden: string[]): void => {
      frame(v);
      frame(v);
      expect(drawProblems(h, v)).toEqual([]);
      expect(sceneOf(v).mergedArmor.length).toBeGreaterThan(0);
      // the hidden parts stay hidden, and no stand-in carries their vertices
      const s = sceneOf(v);
      const gone = s.parts.filter((part) => hidden.includes(part.name));
      expect(gone).toHaveLength(hidden.length);
      expect(gone.some(s.shown)).toBe(false);
    };
    settled();
    expect(drawnArmor(v)).toEqual(['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1']);
    const plate = (): number | undefined =>
      standIns(v).find((standIn) => standIn.material === 'kit_plate')?.vertices;
    const whole = plate() as number;
    const one = vertices(sceneOf(v).parts.find((part) => part.name === 'Helm') as THREE.Mesh);

    // the helm's eye: the helm hides, and inside that call the kit is its parts again
    expect(v.setWocEquipment({ ...FULL_KIT_EQUIPPED }, true)).toBe(true);
    expect(sceneOf(v).mergedArmor).toHaveLength(0);
    expect(drawnArmor(v)).toEqual(partsOf('Helm'));
    expect(drawProblems(h, v)).toEqual([]);
    settled('Helm');
    expect(plate()).toBe(whole - one);

    // an item taken off
    const { chest: _chest, ...noChest } = FULL_KIT_EQUIPPED;
    expect(v.setWocEquipment(noChest, true)).toBe(true);
    expect(sceneOf(v).mergedArmor).toHaveLength(0);
    expect(drawnArmor(v)).toEqual(partsOf('Helm', 'Chest'));
    settled('Helm', 'Chest');
    expect(plate()).toBe(whole - 2 * one);

    // the roster's default kit (no equipment snapshot), then its helm hidden
    expect(v.setWocDefaultEquipment(false)).toBe(true);
    expect(sceneOf(v).mergedArmor).toHaveLength(0);
    expect(drawnArmor(v)).toEqual(partsOf());
    settled();
    expect(plate()).toBe(whole);
    expect(v.setWocDefaultEquipment(true)).toBe(true);
    expect(sceneOf(v).mergedArmor).toHaveLength(0);
    expect(drawnArmor(v)).toEqual(partsOf('Helm'));
    settled('Helm');
    expect(plate()).toBe(whole - one);

    // a repeat of the worn set is no re-dress: the stand-in is left standing
    const standing = sceneOf(v).mergedArmor;
    expect(v.setWocDefaultEquipment(true)).toBe(false);
    expect(standing.length).toBeGreaterThan(0);
    expect(sceneOf(v).mergedArmor.map((mesh, i) => mesh === standing[i])).toEqual(
      standing.map(() => true),
    );
    v.dispose();
    expect(leases(h.armorMergeCache).every((n) => n === 0)).toBe(true);
  });

  it('a kit link the gate could not prove is asked for once more, and twice running is left alone', async () => {
    // guards: one unprepared link refused a kit for as long as the body kept its gate
    // (and, the other way, a gate that cannot link it was asked again on every frame)
    const { h, body, frame, gate } = await world({ kit: 'full' });
    const equipped = { ...FULL_KIT_EQUIPPED };
    const merged = ['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1'];
    const asks = (asked: readonly string[]): number =>
      asked.filter((name) => name === ARMOR_GATE).length;
    // one miss: the parts keep drawing, the next frame asks again and the kit stands
    const once = body({ ...h.DEFAULT_APPEARANCE }, { equipped });
    expect(asks(frame(once, UNPROVEN))).toBe(1);
    expect(drawnArmor(once)).toEqual([...KIT_PARTS].sort());
    expect(drawProblems(h, once)).toEqual([]);
    expect(asks(frame(once, PROVEN))).toBe(1);
    expect(drawnArmor(once)).toEqual(merged);
    expect(drawProblems(h, once)).toEqual([]);
    // two misses running: its parts for good, and never an ask per frame
    const twice = body({ ...h.DEFAULT_APPEARANCE }, { equipped });
    expect(asks(frame(twice, UNPROVEN))).toBe(1);
    expect(asks(frame(twice, UNPROVEN))).toBe(1);
    let later = 0;
    for (let i = 0; i < 30; i++) later += asks(frame(twice, PROVEN));
    expect(later).toBe(0);
    expect(drawnArmor(twice)).toEqual([...KIT_PARTS].sort());
    expect(sceneOf(twice).mergedArmor).toHaveLength(0);
    expect(drawProblems(h, twice)).toEqual([]);
    // ...for as long as that gate lasts: a body handed the renderer's gate again tries anew
    twice.setFarBakeGate(gate);
    frame(twice);
    frame(twice);
    expect(drawnArmor(twice)).toEqual(merged);
    once.dispose();
    twice.dispose();
    expect(leases(h.armorMergeCache).filter((n) => n !== 0)).toEqual([]);
  });

  it('a buff glow landing while the kit links still ends with the kit merged', async () => {
    // guards: an opaque effect edge between the gate's start and its settle read as a
    // gate that gave up, and the kit was refused for as long as the body kept that gate
    const { h, body } = await world({ kit: 'full' });
    const { gate, linking, settle } = await rendererGate();
    const v = body({ ...h.DEFAULT_APPEARANCE }, { gate, equipped: { ...FULL_KIT_EQUIPPED } });
    const frame = (): void => {
      h.nextFrame(16);
      v.update(0.016, IDLE, true);
    };
    frame();
    // the kit and the head, mounted, hidden, their links in flight
    expect(linking.map((entry) => entry.target.name).sort()).toEqual([ARMOR_GATE, HEAD_GATE]);
    const merged = sceneOf(v).mergedArmor;
    const linked = merged.map(worn);
    expect(merged).toHaveLength(2);
    v.setAuraGlow(0xffaa00, 0.5);
    expect(merged.map((mesh, i) => worn(mesh) !== linked[i])).toEqual([true, true]);
    // the link settles, and the renderer's proof says unprepared: the glow's clones are
    // materials no gate ever linked (the head, beside it, stands all the same)
    expect(settle(ARMOR_GATE)).toEqual([false]);
    expect(settle(HEAD_GATE)).toEqual([false]);
    expect(drawProblems(h, v)).toEqual([]);
    expect(headDrawn(h, v)).toBe('merged');
    // the glow ends, the gate is healthy: the kit merges
    v.setAuraGlow(0xffaa00, 0);
    for (let i = 0; i < 8; i++) {
      frame();
      for (const name of [ARMOR_GATE, HEAD_GATE, EFFECT_GATE]) settle(name);
    }
    expect(drawProblems(h, v)).toEqual([]);
    expect(drawnArmor(v)).toEqual(['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1']);
    v.dispose();
  });

  it('a settle the replaced gate still delivers never shows a stand-in that is not standing', async () => {
    // guards: a pooled body handed out again while its kit linked (setFarBakeGate once
    // more): the first gate's settle made the merged meshes visible beside their parts
    const { h, body, frame, gate } = await world({ kit: 'full' });
    const v = body({ ...h.DEFAULT_APPEARANCE }, { equipped: { ...FULL_KIT_EQUIPPED } });
    // the kit and the head, mounted, their links in flight
    frame(v, null);
    const old = h.gates.splice(0);
    expect(old.map((g) => g.target.name).sort()).toEqual([ARMOR_GATE, HEAD_GATE]);
    expect(sceneOf(v).mergedArmor).toHaveLength(2);
    expect(drawnArmor(v)).toEqual([...KIT_PARTS].sort());
    // the pool hands the body out again: the renderer's gate goes in once more, and the
    // next frame asks it for the links again
    v.setFarBakeGate(gate);
    frame(v, null);
    expect(h.gates.map((g) => g.target.name).sort()).toEqual([ARMOR_GATE, HEAD_GATE]);
    // the first links settle after all: every piece is still drawn once, by itself
    for (const g of old) g.settle(PROVEN);
    expect(drawProblems(h, v)).toEqual([]);
    expect(headDrawn(h, v)).toBe('pieces');
    expect(drawnArmor(v)).toEqual([...KIT_PARTS].sort());
    // the links asked for since are the ones that stand them
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    frame(v);
    expect(headDrawn(h, v)).toBe('merged');
    expect(drawnArmor(v)).toEqual(['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1']);
    v.dispose();
  });
});

describe('a seeded run of the whole lifecycle', () => {
  it('never draws a piece twice, never leaves a hole, and gives every geometry back', async () => {
    // guards: the interleavings no scripted case names (an effect over a queued mount, a
    // look change over a link in flight, a settle after a dispose, ...)
    const SEED = 8919;
    const STEPS = 3000;
    /** The share of gate settles that come back unproven. */
    const UNPROVEN_SHARE = 0.1;
    const QUIFF = 'models/chars/players/woc/head_type_a_hair_quiff.glb';
    const MOHAWK = 'models/chars/players/woc/head_type_a_hair_mohawk.glb';
    // two hairstyles still on the wire when the run starts: their looks stream mid-run
    const h = await wocVisualHarness({ kit: 'full', held: [QUIFF, MOHAWK] });
    const { createCharacterVisual } = await import('../src/render/characters/index');
    // the sim's own seeded generator: the run is the same on every machine
    const rng = new Rng(SEED);
    const random = (): number => rng.next();
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const chance = (p: number): boolean => random() < p;

    interface Link {
      readonly owner: object;
      readonly target: THREE.Object3D;
      readonly settle: (ready?: () => boolean) => void;
    }
    let links: Link[] = [];
    const queue = heldQueue();
    /** The generation of the renderer's gate each body was last handed. */
    const generation = new Map<Visual, object>();
    /** A gate for `v`: a new generation. Of what its last one still had in flight, half
     *  is dropped with it (it never settles) and half settles late, on a body that has
     *  asked again since: both happen to a pooled body handed out once more. */
    const gateFor = (v: Visual): Gate => {
      const last = generation.get(v);
      links = links.filter((link) => link.owner !== last || chance(0.5));
      const owner = {};
      generation.set(v, owner);
      return (target, settle) => links.push({ owner, target, settle });
    };
    const D = h.DEFAULT_APPEARANCE;
    const looks: Appearance[] = [
      { ...D },
      { ...D, headShape: { ...D.headShape, chinWidth: 1 } },
      { ...D, headHair: 'quiff' },
      { ...D, headHair: 'bald' },
      { ...D, headHair: 'mohawk' },
      { ...D, headHair: 'undercut' },
      { ...D, headBeard: 'none' },
      { ...D, headNose: 'broad', hairHue: 10, hairSat: 0.9 },
      { ...D, headPiercing: 'full' },
    ];
    const schools = ['fire', 'frost', 'physical', 'holy', 'shadow', 'nature'];
    const slots = Object.keys(FULL_KIT_EQUIPPED) as (keyof typeof FULL_KIT_EQUIPPED)[];
    /** A body the way the world builds one. A look whose file still streams builds no
     *  body yet (the world retries next frame): the default look's then. */
    const born = (): Visual => {
      const v =
        createCharacterVisual(player(pick(looks))) ?? createCharacterVisual(player({ ...D }));
      if (!v) throw new Error('the fixture body did not build');
      v.setFarBakeGate(gateFor(v), queue);
      return v;
    };
    const crowd: Visual[] = [born(), born()];
    const history: string[] = [];
    /** How often a stand-in came to stand over the run: a run that never merged would
     *  hold every rule below for free. */
    const stood = { head: 0, armor: 0 };
    const standing = crowd.map(() => ({ head: false, armor: false }));
    /** After EVERY operation: each body draws each piece exactly once. */
    const audit = (did: string): void => {
      history.push(did);
      for (const [i, v] of crowd.entries()) {
        const problems = drawProblems(h, v);
        if (problems.length > 0) {
          throw new Error(
            `seed ${SEED}, operation ${history.length}, body ${i}: ${problems.join('; ')}\n  after: ${history.slice(-12).join(' | ')}`,
          );
        }
        const s = sceneOf(v);
        const now = { head: s.mergedHeads.some(s.draws), armor: s.mergedArmor.some(s.draws) };
        if (now.head && !standing[i].head) stood.head++;
        if (now.armor && !standing[i].armor) stood.armor++;
        standing[i] = now;
      }
    };
    /** One link in flight settles (any of them: the lane's order is not the bodies'). */
    const settleOne = (): void => {
      const link = links.splice(Math.floor(random() * links.length), 1)[0];
      if (!link) return;
      const proven = !chance(UNPROVEN_SHARE);
      link.settle(() => proven);
      audit(`settle ${link.target.name} ${proven ? 'proven' : 'unproven'}`);
    };
    /** The queue gets to one of its units. */
    const runOne = (): void => {
      const unit = queue.units.splice(Math.floor(random() * queue.units.length), 1)[0];
      if (!unit) return;
      unit.run();
      audit(`unit ${unit.label}`);
    };
    /** A head file released off the wire by the last operation. */
    let landing: string | null = null;
    /** The operations, weighted; each returns what it did to body `at`. */
    const operations: readonly (readonly [number, (v: Visual, at: number) => string])[] = [
      [
        440,
        () => {
          h.nextFrame(16);
          for (const each of crowd) each.update(0.016, IDLE, true);
          return 'frame';
        },
      ],
      [
        80,
        (v) => {
          const hold = chance(0.3) ? 'look' : 'slot';
          v.setWocHeadLook(pick(looks), hold);
          return `look (${hold})`;
        },
      ],
      [
        60,
        (v) => {
          // helm toggles and equipment changes: any subset of the kit, the eye either way
          const equipped: Record<string, string> = {};
          for (const slot of slots) if (chance(0.7)) equipped[slot] = FULL_KIT_EQUIPPED[slot];
          const hidden = chance(0.3);
          v.setWocEquipment(equipped, hidden);
          return `equip ${Object.keys(equipped).join('+')}${hidden ? ', helm hidden' : ''}`;
        },
      ],
      [
        20,
        (v) => {
          const hidden = chance(0.5);
          v.setWocDefaultEquipment(hidden);
          return `default kit${hidden ? ', helm hidden' : ''}`;
        },
      ],
      [
        40,
        (v) => {
          const on = chance(0.35);
          const style = pick(['spirit', 'stealth'] as const);
          v.setGhost(on, style);
          return `ghost ${on} (${style})`;
        },
      ],
      [
        20,
        (v) => {
          const on = chance(0.35);
          v.setShadowform(on);
          return `shadowform ${on}`;
        },
      ],
      [
        15,
        (v) => {
          const on = chance(0.35);
          v.setSoulRend(on);
          return `soul rend ${on}`;
        },
      ],
      [
        35,
        (v) => {
          const intensity = chance(0.5) ? 0.5 : 0;
          v.setAuraGlow(0xff8800, intensity);
          return `glow ${intensity}`;
        },
      ],
      [
        40,
        (v) => {
          const school = pick(schools);
          v.respondToElement(school, 0.75);
          return `hit (${school})`;
        },
      ],
      [
        15,
        (v) => {
          const tint = chance(0.5) ? 0x33ff66 : null;
          v.setRuneTint(tint);
          return `rune ${tint}`;
        },
      ],
      [
        10,
        (v) => {
          const stage = Math.floor(random() * 4);
          v.setFerocityStage(stage);
          return `ferocity ${stage}`;
        },
      ],
      [
        20,
        (v) => {
          const skin = chance(0.5) ? 0 : 1;
          v.setSkin(skin);
          return `skin ${skin}`;
        },
      ],
      [
        35,
        (v) => {
          const far = chance(0.35);
          h.nextFrame();
          v.setFar(far);
          return `far ${far}`;
        },
      ],
      [
        15,
        (v) => {
          const on = chance(0.75);
          v.setActive(on);
          return `active ${on}`;
        },
      ],
      [
        20,
        (v) => {
          const on = chance(0.75);
          v.setWocDrawMerge(on);
          return `merge ${on}`;
        },
      ],
      [
        10,
        (v) => {
          const on = chance(0.5);
          v.setShadow(on);
          return `shadow ${on}`;
        },
      ],
      [
        10,
        (v) => {
          v.setFarBakeGate(gateFor(v));
          return 'a new gate';
        },
      ],
      [
        7,
        (v, at) => {
          v.dispose();
          crowd[at] = born();
          standing[at] = { head: false, armor: false };
          return 'dispose, and a newcomer';
        },
      ],
      [
        8,
        () => {
          // a hairstyle lands off the wire
          const [url, release] = [...h.releases.entries()][0] ?? [];
          if (!url || !release) return 'land (nothing left)';
          h.releases.delete(url);
          release();
          landing = url;
          return `land ${url}`;
        },
      ],
    ];
    const weights = operations.reduce((sum, [weight]) => sum + weight, 0);

    for (let step = 0; step < STEPS; step++) {
      const at = Math.floor(random() * crowd.length);
      let roll = random() * weights;
      const [, operation] =
        operations.find(([weight]) => {
          roll -= weight;
          return roll < 0;
        }) ?? operations[0];
      const did = operation(crowd[at], at);
      if (landing !== null) {
        for (let i = 0; i < 4 && !h.heads.wocHeadFileResident(landing); i++)
          await Promise.resolve();
        expect(h.heads.wocHeadFileResident(landing)).toBe(true);
        landing = null;
      }
      audit(`#${at} ${did}`);
      // the queue's budget and the compile lane get to some of what waits, in any order
      for (let n = queue.units.length; n > 0; n--) if (chance(0.3)) runOne();
      for (let n = links.length; n > 0; n--) if (chance(0.3)) settleOne();
    }
    // the run merged, again and again: the rules above were not held for free
    expect(history.length).toBeGreaterThan(STEPS);
    expect(stood.head).toBeGreaterThan(50);
    expect(stood.armor).toBeGreaterThan(30);

    // Whatever came before, a healthy gate and an idle queue end with every body merged:
    // every effect off, near and shown, the whole kit on, and a face no gate ever missed.
    for (const [url, release] of [...h.releases.entries()]) {
      h.releases.delete(url);
      release();
    }
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const fresh = { ...D, headShape: { ...D.headShape, chinWidth: 0.123 } };
    for (const v of crowd) {
      v.setGhost(false);
      v.setShadowform(false);
      v.setSoulRend(false);
      v.setActive(true);
      h.nextFrame();
      v.setFar(false);
      v.setWocDrawMerge(true);
      v.setFarBakeGate(gateFor(v), queue);
      v.setWocEquipment({ ...FULL_KIT_EQUIPPED }, false);
      v.setWocHeadLook(fresh);
    }
    for (let i = 0; i < 12; i++) {
      h.nextFrame(16);
      for (const v of crowd) v.update(0.016, IDLE, true);
      queue.drain();
      for (const link of links.splice(0)) link.settle(PROVEN);
      audit('a healthy frame');
    }
    for (const v of crowd) {
      expect(headDrawn(h, v)).toBe('merged');
      expect(drawnArmor(v)).toEqual(['Gloves', 'woc_armor_merged_0', 'woc_armor_merged_1']);
    }

    // dispose: every piece back in the render lists, every lease returned
    const all = crowd.flatMap((v) => {
      const s = sceneOf(v);
      return [...s.pieces, ...s.parts];
    });
    for (const v of crowd) v.dispose();
    expect(all.filter((mesh) => mesh.layers.mask === 0)).toEqual([]);
    expect(leases(h.headMergeCache).length).toBeGreaterThan(0);
    expect(leases(h.armorMergeCache).length).toBeGreaterThan(0);
    expect(leases(h.headMergeCache).filter((n) => n !== 0)).toEqual([]);
    expect(leases(h.armorMergeCache).filter((n) => n !== 0)).toEqual([]);
    // ...and nothing a disposed body left behind (a queued unit, a link) takes one again
    queue.drain();
    for (const link of links.splice(0)) link.settle(PROVEN);
    expect(leases(h.headMergeCache).filter((n) => n !== 0)).toEqual([]);
    expect(leases(h.armorMergeCache).filter((n) => n !== 0)).toEqual([]);
  });
});
