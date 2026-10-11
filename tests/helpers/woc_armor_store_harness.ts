// The REAL armor store and dressing (woc_armor_packs.ts, woc_armor_dressing.ts) over a
// fixture rig, with only the loader and the graphics profile stubbed: the shared harness of
// the suites that drive one character's streamed armor (tests/woc_armor_dressing.test.ts) and
// the store itself (tests/woc_armor_packs.test.ts). Every harness is its own module world
// (vi.resetModules): its own packs, its own ledger, its own clock.
//
// A consumer calls `armorStoreHarness()` per case and `releaseArmorStoreHarness()` in its
// afterEach.
import * as THREE from 'three';
import { vi } from 'vitest';
import type { WocCharacterManifest } from '../../src/render/characters/woc_character_manifest';

export const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'dressing-fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' }, arms: { label: 'Arms' } },
  items: {
    male_test_helm: { label: 'Helm', slot: 'head', set: 'test', nodes: ['Armor_Test_Helm'] },
    male_test_shoulders: {
      label: 'Shoulders',
      slot: 'arms',
      set: 'test',
      nodes: ['Armor_Test_Shoulder_L'],
    },
  },
  defaultEquipment: { head: 'male_test_helm', arms: 'male_test_shoulders' },
  animationNames: [],
};

export function bones(): { root: THREE.Group; spine: THREE.Bone; list: THREE.Bone[] } {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'root';
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.set(0, 1, 0);
  root.add(hips);
  hips.add(spine);
  root.updateMatrixWorld(true);
  return { root, spine, list: [hips, spine] };
}

export function tri(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 1, 0, 0.2, 1.2, 0, -0.2, 1.4, 0], 3),
  );
  g.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  g.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  return g;
}

/** The character: a base body on the rig. */
export function model(): THREE.Group {
  const r = bones();
  const body = new THREE.SkinnedMesh(tri(), new THREE.MeshBasicMaterial());
  body.name = 'Character_Body';
  r.root.add(body);
  body.bind(new THREE.Skeleton(r.list));
  return r.root;
}

/** A set id as its node names spell it: `test` -> `Test`. */
const label = (set: string): string => set[0].toUpperCase() + set.slice(1);

/** The node names of a set's two parts: its skinned helm and its rigid shoulder pad. */
export const partNames = (set: string): [helm: string, pad: string] => [
  `Armor_${label(set)}_Helm`,
  `Armor_${label(set)}_Shoulder_L`,
];

export type ArmorParse = { scene: THREE.Object3D; animations: never[] };

/** One armor file: a skinned helm and a rigid shoulder pad on its own rig copy, on one
 *  material named after the file's tier. */
export function armorFile(tier: string, set = 'test'): ArmorParse {
  const r = bones();
  const material = new THREE.MeshBasicMaterial();
  material.name = tier;
  const [helmName, padName] = partNames(set);
  const helm = new THREE.SkinnedMesh(tri(), material);
  helm.name = helmName;
  r.root.add(helm);
  helm.bind(new THREE.Skeleton(r.list));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  pad.name = padName;
  r.spine.add(pad);
  return { scene: r.root, animations: [] };
}

/** One unit of work handed to a work queue, held until the case runs it. */
export interface HeldUnit {
  readonly run: () => void;
  readonly priority: number | undefined;
  readonly label: string | undefined;
}

/**
 * The renderer's background work queue as the store and a body see it
 * (background_gpu_queue.ts), holding every unit until the case runs it: what the real one's
 * frame budget does to a crowd arriving at once.
 */
export function heldQueue() {
  const units: HeldUnit[] = [];
  return {
    units,
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        units.push({
          run: () => {
            try {
              resolve(work() as T);
            } catch (err) {
              reject(err);
            }
          },
          priority,
          label,
        });
      });
    },
    labels: (): (string | undefined)[] => units.map((unit) => unit.label),
    /** The label KIND of each unit queued (what the frame budget prices: the label up to its
     *  first colon), in the order they were asked for. */
    kinds: (): string[] => units.map((unit) => kindOf(unit.label)),
    /** Run every unit queued so far, in the order it was asked for. */
    drain(): void {
      for (const unit of units.splice(0)) unit.run();
    },
    /** Run the first unit queued under the label kind `kind` (and take it off). */
    runOne(kind: string): void {
      const at = units.findIndex((unit) => kindOf(unit.label) === kind);
      if (at < 0) throw new Error(`no ${kind} unit queued`);
      units.splice(at, 1)[0].run();
    },
  };
}

const kindOf = (label: string | undefined): string => (label ?? '').split(':')[0];

export type HeldQueue = ReturnType<typeof heldQueue>;

/** `tier`: the graphics preset. `reveals`: how the host's compile gate answers a reveal.
 *  'never' (the default: the attach cases only count the calls), 'now' (no gate: the node is
 *  live at once), or 'gated' (hidden until `settle`, as a link in flight). */
export async function armorStoreHarness(
  tier: 'low' | 'medium' | 'high',
  reveals: 'never' | 'now' | 'gated' = 'never',
  file: (fileTier: string, set: string) => ArmorParse = armorFile,
) {
  vi.resetModules();
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  const fetches: string[] = [];
  /** Every loadGltf call, in order, with the class it was asked at (`fetches` lists only the
   *  ones that put a file on the wire). */
  const asks: { url: string; priority: string }[] = [];
  const released: string[] = [];
  // the real loader's contract: ONE promise per url however often and however it is asked
  // for, dropped when the load fails or its owner releases the parse
  const inFlight = new Map<string, Promise<unknown>>();
  /** The live graphics profile: a case moves the preset or the memory profile under the
   *  store by writing it. */
  const gfx: { tier: string; constrainedMemory: boolean } = { tier, constrainedMemory: false };
  vi.doMock('../../src/render/gfx', () => ({ GFX: gfx }));
  vi.doMock('../../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string, opts?: { priority?: string }) => {
      asks.push({ url, priority: opts?.priority ?? 'demand' });
      let load = inFlight.get(url);
      if (!load) {
        load = new Promise((resolve, reject) => {
          fetches.push(url);
          pending.set(url, { resolve, reject });
        });
        load.catch(() => {
          if (inFlight.get(url) === load) inFlight.delete(url);
        });
        inFlight.set(url, load);
      }
      return load;
    }),
    releaseGltf: vi.fn((url: string) => {
      released.push(url);
      inFlight.delete(url);
    }),
  }));
  // the real binder, counted (how many times a file was prepared, and when) and open to a
  // case that needs one of its steps to throw
  vi.doMock('../../src/render/characters/woc_armor_bind', async () => {
    const actual = await vi.importActual<
      typeof import('../../src/render/characters/woc_armor_bind')
    >('../../src/render/characters/woc_armor_bind');
    return {
      ...actual,
      prepareWocArmor: vi.fn(actual.prepareWocArmor),
      hangWocRigidArmor: vi.fn(actual.hangWocRigidArmor),
    };
  });
  const packs = await import('../../src/render/characters/woc_armor_packs');
  const dressing = await import('../../src/render/characters/woc_armor_dressing');
  const core = await import('../../src/render/characters/woc_armor_core');
  const bind = await import('../../src/render/characters/woc_armor_bind');
  // the CPU build ledger's sink (build_spans.ts): the kinds recorded, in order
  const spans: string[] = [];
  (await import('../../src/render/build_spans')).setBuildSpanSink((kind) => spans.push(kind));
  const cover = await import('../../src/render/arrival_cover');
  let now = 0;
  packs.setWocArmorClockForTest(() => now);
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  const land = async (fileTier: string, set = 'test'): Promise<void> => {
    const url = core.wocArmorPackUrl('male', set, fileTier as 'low');
    const settle = pending.get(url);
    pending.delete(url);
    settle?.resolve(file(fileTier, set));
    await flush();
  };
  const linking: ((prepared: boolean) => void)[] = [];
  /** A character's side of the dressing over `body` (a fresh fixture body by default). */
  const hostOf = (body: THREE.Object3D = model()) => ({
    model: body,
    adopt: vi.fn((_node: THREE.Object3D): void => undefined),
    forget: vi.fn((_node: THREE.Object3D): void => undefined),
    reveal: vi.fn((node: THREE.Object3D, live?: (prepared: boolean) => void): void => {
      if (reveals === 'now') live?.(true);
      if (reveals !== 'gated') return;
      node.visible = false;
      linking.push((prepared) => {
        // the real gate drops the settle of a node detached meanwhile
        if (node.parent === null) return;
        node.visible = true;
        live?.(prepared);
      });
    }),
    /** The articulated rig draws (a case that tests a far or hidden body swaps this). */
    rigDrawn: (): boolean => true,
    /** No renderer's work queue behind the body, unless a case installs one. */
    schedule: undefined as ((work: () => void, label: string) => void) | undefined,
  });
  const host = hostOf();
  return {
    packs,
    core,
    dressing,
    /** The binder, its `prepareWocArmor` and `hangWocRigidArmor` counting pass-throughs. */
    bind: bind as typeof bind & {
      prepareWocArmor: ReturnType<typeof vi.fn>;
      hangWocRigidArmor: ReturnType<typeof vi.fn>;
    },
    gfx,
    /** The build-ledger span kinds recorded so far: a prepare or an attach run as a queue
     *  unit names itself under `view:`, a prepare paid on the spot under `view-part:` (a step
     *  of whatever build paid it). */
    spans,
    /** Raise or drop the arrival curtain (arrival_cover.ts): a view built under it must come
     *  out whole. */
    setArrivalCover: (up: boolean): void => cover.setArrivalCover(up),
    host,
    hostOf,
    land,
    /** A file's fetch fails. */
    fail: async (fileTier: string, set = 'test'): Promise<void> => {
      const url = core.wocArmorPackUrl('male', set, fileTier as 'low');
      const settle = pending.get(url);
      pending.delete(url);
      settle?.reject(new Error('offline'));
      await flush();
    },
    flush,
    pending,
    fetches,
    asks,
    released,
    advance: (ms: number) => {
      now += ms;
    },
    /** Every reveal in flight settles (`prepared`: its programs are known linked; false is a
     *  gate that gave up). */
    settle: (prepared = true) => {
      for (const reveal of linking.splice(0)) reveal(prepared);
    },
    /** Only the first reveal in flight settles. */
    settleOne: (prepared = true) => {
      linking.shift()?.(prepared);
    },
    /** Reveals in flight right now. */
    linking: (): number => linking.length,
  };
}

export type ArmorStoreHarness = Awaited<ReturnType<typeof armorStoreHarness>>;

/** A consumer's afterEach: let go of the stubs. */
export function releaseArmorStoreHarness(): void {
  vi.doUnmock('../../src/render/gfx');
  vi.doUnmock('../../src/render/assets/loader');
  vi.doUnmock('../../src/render/characters/woc_armor_bind');
  vi.restoreAllMocks();
  vi.resetModules();
}
