import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';

// The streamed-armor lifecycle one character sees (the 2026-09-25 character size gameplan,
// steps 5 and 6): a set not yet resident draws nothing (the suit), a resident lower tier
// stands in while the wanted tier streams, the wanted tier takes over once its reveal
// settles (the file it replaces drawing until then: 2026-10-03), every attached node goes
// through the host's setup and compile gate, and a set nobody wears is freed after the idle
// window. And the merged stand-in a world view asks for (woc_armor_merge.ts): never mounted
// by default, built from the poll, dropped at once by the host's redress when the drawn parts
// change, taken down before a file it folds detaches. Only the loader and the graphics profile
// are stubbed. Most cases dress a CROWD character (the medium file on any preset but low), a
// set's one-file path; the local player's assembled high pack has its own suite
// (tests/woc_armor_high_pack.test.ts).

const manifest: WocCharacterManifest = {
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

function bones(): { root: THREE.Group; spine: THREE.Bone; list: THREE.Bone[] } {
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

function tri(): THREE.BufferGeometry {
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
function model(): THREE.Group {
  const r = bones();
  const body = new THREE.SkinnedMesh(tri(), new THREE.MeshBasicMaterial());
  body.name = 'Character_Body';
  r.root.add(body);
  body.bind(new THREE.Skeleton(r.list));
  return r.root;
}

/** One armor file: a skinned helm and a rigid shoulder pad on its own rig copy. */
function armorFile(tier: string) {
  const r = bones();
  const material = new THREE.MeshBasicMaterial();
  material.name = tier;
  const helm = new THREE.SkinnedMesh(tri(), material);
  helm.name = 'Armor_Test_Helm';
  r.root.add(helm);
  helm.bind(new THREE.Skeleton(r.list));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  pad.name = 'Armor_Test_Shoulder_L';
  r.spine.add(pad);
  return { scene: r.root, animations: [] };
}

/** `tier`: the graphics preset. `reveals`: how the host's compile gate answers a reveal.
 *  'never' (the default: the attach cases only count the calls), 'now' (no gate: the node is
 *  live at once), or 'gated' (hidden until `settle`, as a link in flight). */
async function harness(
  tier: 'low' | 'medium' | 'high',
  reveals: 'never' | 'now' | 'gated' = 'never',
  file: (fileTier: string) => { scene: THREE.Object3D; animations: never[] } = armorFile,
) {
  vi.resetModules();
  const pending = new Map<string, (value: unknown) => void>();
  const released: string[] = [];
  vi.doMock('../src/render/gfx', () => ({ GFX: { tier, constrainedMemory: false } }));
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          pending.set(url, resolve);
        }),
    ),
    releaseGltf: vi.fn((url: string) => released.push(url)),
  }));
  const packs = await import('../src/render/characters/woc_armor_packs');
  const dressing = await import('../src/render/characters/woc_armor_dressing');
  const core = await import('../src/render/characters/woc_armor_core');
  let now = 0;
  packs.setWocArmorClockForTest(() => now);
  const land = async (fileTier: string) => {
    const url = core.wocArmorPackUrl('male', 'test', fileTier as 'low');
    pending.get(url)?.(file(fileTier));
    await Promise.resolve();
    await Promise.resolve();
  };
  const linking: ((prepared: boolean) => void)[] = [];
  const host = {
    model: model(),
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
  };
  return {
    packs,
    core,
    dressing,
    host,
    land,
    pending,
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
  };
}

afterEach(() => {
  vi.doUnmock('../src/render/gfx');
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

describe('a WOC character wearing streamed armor', () => {
  it('draws the suit until its set lands, then attaches it through the host the frame it does', async () => {
    const h = await harness('high');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.want(['test'])).toBe(false);
    expect(d.isWaiting).toBe(true);
    expect(d.attachedFiles).toEqual([]);
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    expect([...h.pending.keys()]).toEqual([medium]); // the wanted tier only, never the others
    expect(d.poll()).toBe(false); // nothing new yet
    await h.land('medium');
    expect(d.poll()).toBe(true);
    expect(d.isWaiting).toBe(false);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    // the Group of skinned parts and the rigid pad's wrapper, each set up and gated
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    expect(h.host.reveal).toHaveBeenCalledTimes(2);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    expect(helm.isSkinnedMesh).toBe(true);
    expect(helm.visible).toBe(false); // the dressing, not the attach, decides visibility
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L');
    expect(pad?.parent?.parent?.name).toBe('spine');
    expect(h.packs.wocArmorPackRefs(medium)).toBe(1);
    expect(d.poll()).toBe(false); // steady state: free
  });

  it('stands a resident lower tier in while the wanted tier streams, then swaps it', async () => {
    const h = await harness('high', 'now');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.want(['test'])).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    expect(d.isWaiting).toBe(true);
    expect(h.pending.has(medium)).toBe(true);
    await h.land('medium');
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    // the stand-in's pieces left the bookkeeping and the model, and its reference went back
    expect(h.host.forget).toHaveBeenCalledTimes(2);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(1);
    const helms: string[] = [];
    h.host.model.traverse((o) => {
      if (o.name === 'Armor_Test_Helm')
        helms.push(((o as THREE.Mesh).material as THREE.Material).name);
    });
    expect(helms).toEqual(['medium']);
    // the take-over was told once: the next frame is free
    expect(d.poll()).toBe(false);
  });

  it('keeps the file it replaces drawing until every piece of the new one is revealed, then takes it off in that step', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    const lowHelm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    const lowPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    lowHelm.visible = true; // the host's part pass
    const drawn = (node: THREE.Object3D): boolean => {
      for (let at: THREE.Object3D | null = node; at; at = at.parent) if (!at.visible) return false;
      return true;
    };
    expect(drawn(lowHelm)).toBe(true);
    await h.land('medium');
    // the replacement attaches (the host dresses its parts: the files changed)...
    expect(d.poll()).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    // ...hidden behind the gate, while the file it replaces keeps drawing, whole
    expect(h.host.forget).not.toHaveBeenCalled();
    expect(drawn(lowHelm)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent !== null && piece.visible)).toBe(true);
    expect(h.packs.wocArmorPackRefs(low)).toBe(1);
    // what draws is what a far bake keys on: still the old file
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    const nextPieces = h.packs.wocArmorPieces(next);
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    // one piece's link settles: it waits hidden for the others (one step, never both files)
    h.settleOne();
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    expect(drawn(lowHelm)).toBe(true);
    expect(d.poll()).toBe(false);
    // the last one settles: the new file draws and the old one is off, in that very step
    h.settle();
    expect(nextPieces.every((piece) => piece.visible)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent === null)).toBe(true);
    expect(h.host.forget).toHaveBeenCalledTimes(2);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(1);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    // the host hears of it on its next frame, once, and re-dresses
    expect(d.poll()).toBe(true);
    expect(d.poll()).toBe(false);
  });

  it('asks an unprepared replacement again while the old file draws, and takes over all the same on the next try', async () => {
    const h = await harness('high', 'gated');
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'test', 'low'));
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    const lowPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    await h.land('medium');
    d.poll();
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    const nextPieces = h.packs.wocArmorPieces(next);
    const reveals = h.host.reveal.mock.calls.length;
    // the gate gives up on both pieces: the old file stands in, so each is asked again
    h.settle(false);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + nextPieces.length);
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent !== null && piece.visible)).toBe(true);
    expect(h.host.forget).not.toHaveBeenCalled();
    expect(d.attachedFiles).toEqual([
      { set: 'test', url: h.core.wocArmorPackUrl('male', 'test', 'low') },
    ]);
    // ...and a gate that keeps giving up does not keep the old file drawing for good
    h.settle(false);
    expect(nextPieces.every((piece) => piece.visible)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent === null)).toBe(true);
    expect(d.attachedFiles).toEqual([
      { set: 'test', url: h.core.wocArmorPackUrl('male', 'test', 'medium') },
    ]);
    d.dispose();
  });

  it('asks a replaced gate again for every piece of a replacement, the old gate settling nothing', async () => {
    const h = await harness('high', 'gated');
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'test', 'low'));
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    const nextPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[1]);
    // one piece linked under the old renderer generation, then the gate was replaced
    h.settleOne();
    const reveals = h.host.reveal.mock.calls.length;
    d.gateChanged();
    // every piece again, the one the old gate settled too
    expect(h.host.reveal.mock.calls.length).toBe(reveals + nextPieces.length);
    // the old gate's last settle lands late: it hands nothing over
    h.settleOne();
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    // the new gate's settles do
    h.settle();
    expect(nextPieces.every((piece) => piece.visible)).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    d.dispose();
  });

  it('takes off a replacement overtaken while it links, and one no longer wanted, never the drawn file', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    // a gate replaced mid-link is asked again for what it still owes
    const reveals = h.host.reveal.mock.calls.length;
    d.gateChanged();
    expect(h.host.reveal.mock.calls.length).toBe(reveals + h.packs.wocArmorPieces(next).length);
    // the set comes off before the link settles: the replacement goes, unseen, with it
    expect(d.want([])).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(0);
    // a stale settle of the gone replacement changes nothing
    h.settle();
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(d.attachedFiles).toEqual([]);
    expect(d.poll()).toBe(false);
    d.dispose();
  });

  it('detaches a set no longer wanted, and frees a set nobody has worn for the idle window', async () => {
    const h = await harness('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('medium');
    d.poll();
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    const geometry = helm.geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    // the rigid pad draws the parse's own geometry: freed with the file too
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    const padDispose = vi.spyOn(pad.geometry, 'dispose');
    expect(d.want([])).toBe(true);
    expect(h.host.model.getObjectByName('Armor_Test_Helm')).toBeUndefined();
    expect(h.host.model.getObjectByName('Armor_Test_Shoulder_L')).toBeUndefined();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    // still in memory inside the window (a re-equip attaches at once, no fetch)
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS - 1);
    h.packs.sweepWocArmorPacks();
    expect(h.packs.wocArmorPackResident(url)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([url]);
    expect(h.packs.wocArmorPackResident(url)).toBe(false);
    expect(dispose).toHaveBeenCalled();
    expect(padDispose).toHaveBeenCalled();
    expect(h.released).toEqual([url]);
    d.dispose();
  });

  it('frees an idle set from the per-frame poll alone, with no later release', async () => {
    const h = await harness('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('medium');
    d.poll();
    d.want([]); // released now; nothing else will release again
    const other = new h.dressing.WocArmorDressing({ ...h.host, model: model() }, manifest, 'crowd');
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    other.poll(); // any character's frame
    expect(h.packs.wocArmorPackResident(url)).toBe(false);
    d.dispose();
    other.dispose();
  });

  it('gives every file back on dispose', async () => {
    const h = await harness('low');
    const url = h.core.wocArmorPackUrl('male', 'test', 'low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest);
    d.want(['test']);
    await h.land('low');
    d.poll();
    expect(h.packs.wocArmorPackRefs(url)).toBe(1);
    d.dispose();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(d.attachedFiles).toEqual([]);
  });
});

describe('a WOC character drawing its armor merged', () => {
  const MERGED = 'woc_armor_merged';
  const PARTS = ['Armor_Test_Helm', 'Armor_Test_Shoulder_L'];

  /** An armor file whose two parts can share a draw: the helm (skinned to the spine) and
   *  the pad (rigid on it) on one material, carrying the same vertex attributes. */
  function kitFile(tier: string) {
    const r = bones();
    const material = new THREE.MeshBasicMaterial();
    material.name = tier;
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    geometry.translate(0, 1.6, 0);
    const count = geometry.getAttribute('position').count;
    const joints = new Uint16Array(count * 4).fill(0);
    const weights = new Float32Array(count * 4).fill(0);
    for (let i = 0; i < count; i++) {
      joints[i * 4] = 1;
      weights[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    const helm = new THREE.SkinnedMesh(geometry, material);
    helm.name = 'Armor_Test_Helm';
    r.root.add(helm);
    helm.bind(new THREE.Skeleton(r.list));
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    pad.name = 'Armor_Test_Shoulder_L';
    pad.position.set(0.3, 0.2, 0);
    r.spine.add(pad);
    return { scene: r.root, animations: [] };
  }

  /** A crowd dressing on the `tier` preset with its set attached (its one file: low on the
   *  low preset, else medium). The fake host never dresses by itself: `dress` below is its
   *  part pass. */
  async function dressed(
    tier: 'low' | 'medium' | 'high',
    reveals: 'now' | 'gated' = 'now',
    file: (fileTier: string) => { scene: THREE.Object3D; animations: never[] } = kitFile,
  ) {
    const h = await harness(tier, reveals, file);
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land(tier === 'low' ? 'low' : 'medium');
    expect(d.poll()).toBe(true);
    return { h, d };
  }
  /** The host's part pass: show these parts, hide the rest, then tell the dressing. */
  const dress = (
    model: THREE.Object3D,
    d: { redressed(): void },
    shown: readonly string[] = PARTS,
  ): void => {
    // every node of a part's name, as the visual's pass does (woc_parts.ts): a file and the
    // replacement linking behind it carry the same parts
    model.traverse((node) => {
      if (PARTS.includes(node.name)) node.visible = shown.includes(node.name);
    });
    d.redressed();
  };
  const merged = (model: THREE.Object3D): THREE.Object3D | undefined =>
    model.children.find((child) => child.name === MERGED);
  const mergedMesh = (model: THREE.Object3D): THREE.SkinnedMesh => {
    const mesh = merged(model)?.children[0];
    if (!mesh) throw new Error('no merged mesh');
    return mesh as THREE.SkinnedMesh;
  };
  const masks = (model: THREE.Object3D): number[] =>
    PARTS.map((name) => model.getObjectByName(name)?.layers.mask ?? -1);
  /** The visual's blended overlay: a transparent clone on every mesh of the body. */
  const overlay = (model: THREE.Object3D): { lift(): void } => {
    const plain = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      plain.set(mesh, mesh.material);
      const ghost = (mesh.material as THREE.Material).clone();
      ghost.transparent = true;
      mesh.material = ghost;
    });
    return {
      lift: () => {
        for (const [mesh, material] of plain) mesh.material = material;
      },
    };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps drawing part by part until a world view asks', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    expect(d.poll()).toBe(false);
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    // only the attach went through the host
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    // ...and the entry points a world view's host calls are nothing without the ask
    d.redressed();
    d.effectsChanged();
    d.gateChanged();
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
  });

  it('folds the drawn parts from the poll once asked, and the poll still answers for the files alone', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    // asking mounts nothing: a mount belongs to the per-frame poll
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // the files did not change (false), and the helm and the pad are one mesh now
    expect(d.poll()).toBe(false);
    const wrapper = merged(h.host.model);
    expect(wrapper?.children.map((child) => child.name)).toEqual([`${MERGED}_0`]);
    expect(d.isMerged).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    // the stand-in went through the host's setup and its compile gate like any attach
    expect(h.host.adopt).toHaveBeenLastCalledWith(wrapper);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    expect(h.host.reveal).toHaveBeenCalledTimes(3);
    expect(h.host.reveal.mock.calls[2][0]).toBe(wrapper);
    const mesh = mergedMesh(h.host.model);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    expect(mesh.isSkinnedMesh).toBe(true);
    expect(mesh.skeleton).toBe(helm.skeleton);
    expect(mesh.material).toBe(h.packs.wocArmorFileMaterial(helm));
    d.dispose();
  });

  it('costs a flag read a frame once it stands: nothing read again, nothing mounted', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const wrapper = merged(h.host.model);
    const merge = await import('../src/render/characters/woc_armor_merge');
    const reconciles = vi.spyOn(merge.WocArmorMergeRig.prototype, 'sync');
    const mounts = vi.spyOn(merge.WocArmorMergeRig.prototype, 'mountPending');
    for (let frame = 0; frame < 5; frame++) expect(d.poll()).toBe(false);
    expect(reconciles).not.toHaveBeenCalled();
    expect(mounts).not.toHaveBeenCalled();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    d.dispose();
  });

  it('asks once: a second ask keeps the stand-in it has', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const wrapper = merged(h.host.model);
    d.setMerged(true);
    d.poll();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.model.children.filter((child) => child.name === MERGED)).toHaveLength(1);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('drops the stand-in the moment a redress changes the drawn parts, and mounts the next from the poll', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const first = merged(h.host.model);
    expect(d.isMerged).toBe(true);
    // the pad comes off: the stand-in still draws it, so it goes inside the redress
    dress(h.host.model, d, ['Armor_Test_Helm']);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    expect(h.host.forget).toHaveBeenLastCalledWith(first);
    // one part left: nothing to fold, whatever the poll runs
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    // the pad goes back on: the redress never mounts, the next poll does
    dress(h.host.model, d);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(true);
    expect(merged(h.host.model)).not.toBe(first);
    expect(masks(h.host.model)).toEqual([0, 0]);
    // a redress that changes nothing keeps it
    const second = merged(h.host.model);
    dress(h.host.model, d);
    expect(merged(h.host.model)).toBe(second);
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('hands the mount to the host work queue where there is one, one unit at a time, labelled by its cost', async () => {
    const { h, d } = await dressed('high');
    const queue: { work: () => void; label: string }[] = [];
    h.host.schedule = (work, label) => queue.push({ work, label });
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    // asked for, not done: the queue's frame budget decides when
    expect(queue.map((unit) => unit.label)).toEqual(['woc-armor-merge:male']);
    expect(h.dressing.WOC_ARMOR_MERGE_LABEL).toBe('woc-armor-merge');
    expect(h.dressing.WOC_ARMOR_MOUNT_LABEL).toBe('woc-armor-mount');
    expect(merged(h.host.model)).toBeUndefined();
    // every frame until it runs asks nothing more
    d.poll();
    d.poll();
    expect(queue).toHaveLength(1);
    queue.shift()?.work();
    expect(d.isMerged).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    d.poll();
    expect(queue).toHaveLength(0);
    // a kit somebody already built rides its own kind: the budget learns the two apart
    const peerHost = { ...h.host, model: model() };
    const other = new h.dressing.WocArmorDressing(peerHost, manifest, 'crowd');
    other.want(['test']);
    dress(peerHost.model, other);
    other.setMerged(true);
    other.poll();
    expect(queue.map((unit) => unit.label)).toEqual(['woc-armor-mount:male']);
    queue.shift()?.work();
    expect(other.isMerged).toBe(true);
    // one buffer for the two of them
    expect(mergedMesh(peerHost.model).geometry).toBe(mergedMesh(h.host.model).geometry);
    d.dispose();
    other.dispose();
  });

  it('looks again when its queued mount runs: the kit as it draws then, or nothing at all', async () => {
    const { h, d } = await dressed('high');
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    // the pad came off while the unit waited: one part left, nothing to stand in for
    dress(h.host.model, d, ['Armor_Test_Helm']);
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    // back on and asked again, and the rig went far before the unit ran
    dress(h.host.model, d);
    d.poll();
    expect(queue).toHaveLength(1);
    h.host.rigDrawn = () => false;
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    // near again: asked again, and the world view let go before it ran
    h.host.rigDrawn = () => true;
    d.poll();
    expect(queue).toHaveLength(1);
    d.setMerged(false);
    // ...and asked again at once: a unit of its own, the old one still in the queue
    d.setMerged(true);
    d.poll();
    expect(queue).toHaveLength(2);
    // the old unit belongs to a stand-in that is gone: it mounts nothing, and it does not
    // free the slot the new unit holds (no third unit for the same mount)
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    d.poll();
    expect(queue).toHaveLength(1);
    // disposed before the new one ran
    d.dispose();
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
  });

  it('mounts on the spot with no renderer behind the body, every wearer of a kit over one buffer', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    const peerHost = { ...h.host, model: model() };
    const other = new h.dressing.WocArmorDressing(peerHost, manifest, 'crowd');
    other.want(['test']);
    dress(peerHost.model, other);
    other.setMerged(true);
    // no queue, no timer of its own: both stand from their own poll
    d.poll();
    other.poll();
    expect(d.isMerged).toBe(true);
    expect(other.isMerged).toBe(true);
    expect(mergedMesh(peerHost.model).geometry).toBe(mergedMesh(h.host.model).geometry);
    d.dispose();
    other.dispose();
  });

  it('mounts nothing for a rig nobody sees, and mounts it the frame it draws', async () => {
    const { h, d } = await dressed('high');
    let drawn = false;
    h.host.rigDrawn = () => drawn;
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    // far, or hidden for its head: a stand-in nobody would see is not mounted, and not
    // one unit of the queue is spent asking
    for (let frame = 0; frame < 3; frame++) d.poll();
    expect(queue).toHaveLength(0);
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    drawn = true;
    d.poll();
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(d.isMerged).toBe(true);
    // a rig that goes far again keeps the stand-in it has: hidden with it, it costs nothing
    drawn = false;
    d.poll();
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('goes back to its parts inside the host call that says an overlay landed, and stands again once it lifts', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const wrapper = merged(h.host.model);
    expect(d.isMerged).toBe(true);
    // the visual's ghost run committed: a blended clone on every mesh, then the host's call
    const ghost = overlay(h.host.model);
    d.effectsChanged();
    expect(d.isMerged).toBe(false);
    expect(masks(h.host.model)).toEqual([1, 1]);
    // parked, not gone: still mounted, hidden, nothing rebuilt when the overlay lifts
    expect(merged(h.host.model)).toBe(wrapper);
    expect(wrapper?.visible).toBe(false);
    d.poll();
    expect(d.isMerged).toBe(false);
    ghost.lift();
    // lifting is the host's material pass: the stand-in comes back from the poll
    d.effectsChanged();
    expect(d.isMerged).toBe(false);
    d.poll();
    expect(d.isMerged).toBe(true);
    expect(merged(h.host.model)).toBe(wrapper);
    expect(wrapper?.visible).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    expect(h.host.forget).not.toHaveBeenCalled();
    d.dispose();
  });

  it('waits out an overlay that was on before it could mount, and asks for no mount meanwhile', async () => {
    const { h, d } = await dressed('high');
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    const ghost = overlay(h.host.model);
    d.setMerged(true);
    for (let frame = 0; frame < 3; frame++) d.poll();
    // the parts draw blended, by themselves: not one unit queued for a mount under it
    expect(queue).toHaveLength(0);
    expect(merged(h.host.model)).toBeUndefined();
    ghost.lift();
    d.effectsChanged();
    d.poll();
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('asks a replaced gate and queue again for what the old ones still held', async () => {
    const { h, d } = await dressed('high', 'gated');
    h.settle();
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(queue).toHaveLength(1);
    // the renderer generation changed: the old queue never runs its unit
    d.gateChanged();
    d.poll();
    expect(queue).toHaveLength(2);
    queue[1]();
    const wrapper = merged(h.host.model);
    expect(wrapper).toBeDefined();
    expect(d.isMerged).toBe(false);
    const reveals = h.host.reveal.mock.calls.length;
    // ...and again while its programs link: the old gate never settles, the new one is asked
    d.gateChanged();
    d.poll();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + 1);
    h.settle();
    expect(d.isMerged).toBe(true);
    // the old queue's unit, should it ever run after all, changes nothing
    queue[0]();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.model.children.filter((child) => child.name === MERGED)).toHaveLength(1);
    d.dispose();
  });

  it('takes the stand-in down before the file it folds detaches', async () => {
    const { h, d } = await dressed('medium');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    expect([helm.layers.mask, pad.layers.mask]).toEqual([0, 0]);
    h.host.forget.mockClear();
    expect(d.want([])).toBe(true);
    // the merged wrapper left the host's bookkeeping first, then the file's own nodes
    expect(h.host.forget.mock.calls.map(([node]) => node.name)).toEqual([
      MERGED,
      'woc_armor_test',
      'woc_armor_rigid_Armor_Test_Shoulder_L',
    ]);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // the parts left the model drawing as they were attached: another wearer of the file
    // shares their geometry, and a re-attach makes new meshes
    expect([helm.layers.mask, pad.layers.mask]).toEqual([1, 1]);
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    d.dispose();
  });

  it('forgets a stand-in that only waited when its file detaches: none mounts for parts that are gone', async () => {
    const { h, d } = await dressed('medium');
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(queue).toHaveLength(1);
    expect(d.want([])).toBe(true);
    queue.shift()?.();
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    d.dispose();
  });

  it('follows a tier swap: down with the stand-in tier, up again on the file that landed', async () => {
    const h = await harness('high', 'now', kitFile);
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.want(['test'])).toBe(true);
    d.setMerged(true);
    dress(h.host.model, d);
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(true);
    const lowMesh = mergedMesh(h.host.model);
    expect((lowMesh.material as THREE.Material).name).toBe('low');
    // the wanted tier lands: the files change (true), and the low stand-in is gone with them
    await h.land('medium');
    h.host.forget.mockClear();
    expect(d.poll()).toBe(true);
    expect(h.host.forget.mock.calls[0][0].name).toBe(MERGED);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // the host re-dresses the new file's parts, and the next poll folds them
    dress(h.host.model, d);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(true);
    const highMesh = mergedMesh(h.host.model);
    expect((highMesh.material as THREE.Material).name).toBe('medium');
    expect(highMesh.geometry).not.toBe(lowMesh.geometry);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    d.dispose();
  });

  it('keeps the replaced file folded and drawing while its replacement links, then folds the new one', async () => {
    const h = await harness('high', 'gated', kitFile);
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'test', 'low'));
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    d.setMerged(true);
    dress(h.host.model, d);
    d.poll();
    h.settle();
    expect(d.isMerged).toBe(true);
    const lowMerged = merged(h.host.model);
    // the medium file lands and attaches behind the gate; the host dresses both files' parts
    await h.land('medium');
    expect(d.poll()).toBe(true);
    dress(h.host.model, d);
    // the low kit's stand-in still stands for exactly the parts that draw: the armor never
    // drops to its bare parts, let alone to nothing, while the new file links
    expect(d.isMerged).toBe(true);
    expect(merged(h.host.model)).toBe(lowMerged);
    expect(lowMerged?.visible).toBe(true);
    d.poll();
    expect(merged(h.host.model)).toBe(lowMerged);
    // the replacement's reveal settles: the low file and its stand-in leave in that step, the
    // medium parts draw by themselves at once
    h.settle();
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    const helms: THREE.Mesh[] = [];
    h.host.model.traverse((o) => {
      if (o.name === 'Armor_Test_Helm') helms.push(o as THREE.Mesh);
    });
    expect(helms).toHaveLength(1);
    expect((helms[0].material as THREE.Material).name).toBe('medium');
    expect(helms[0].layers.mask).toBe(1);
    expect(helms[0].visible && helms[0].parent?.visible).toBe(true);
    // the host re-dresses on its next frame, and the medium kit is folded from the one after
    expect(d.poll()).toBe(true);
    dress(h.host.model, d);
    d.poll();
    h.settle();
    expect(d.isMerged).toBe(true);
    expect((mergedMesh(h.host.model).material as THREE.Material).name).toBe('medium');
    d.dispose();
  });

  it('folds a file that attached behind the compile gate only once its reveal settles', async () => {
    const { h, d } = await dressed('high', 'gated');
    d.setMerged(true);
    dress(h.host.model, d);
    // the file's nodes are hidden while its programs link: nothing of it draws yet
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // its reveals settle with no redress following: the poll reads the parts again
    h.settle();
    d.poll();
    const wrapper = merged(h.host.model);
    expect(wrapper).toBeDefined();
    // ...and the stand-in waits behind the gate in its turn, the parts drawing meanwhile
    expect(d.isMerged).toBe(false);
    expect(wrapper?.visible).toBe(false);
    expect(masks(h.host.model)).toEqual([1, 1]);
    h.settle();
    expect(d.isMerged).toBe(true);
    expect(wrapper?.visible).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    d.dispose();
  });

  it('leaves a blended part drawing by itself', async () => {
    const glass = (fileTier: string) => {
      const out = kitFile(fileTier);
      out.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.Material).transparent = true;
      });
      return out;
    };
    const { h, d } = await dressed('high', 'now', glass);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    d.poll();
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    d.dispose();
  });

  it('leaves parts that carry different vertex attributes in their own draws', async () => {
    // the plain fixture: the helm is a bare triangle (no normal, no uv), the pad a box
    // with both. One material, but two programs: nothing to fold
    const { h, d } = await dressed('high', 'now', armorFile);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    d.dispose();
  });

  it('takes the stand-in down when the world view lets go, and on dispose', async () => {
    const { h, d } = await dressed('low');
    const url = h.core.wocArmorPackUrl('male', 'test', 'low');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(d.isMerged).toBe(true);
    d.setMerged(false);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    // asked again: the same kit, already built
    d.setMerged(true);
    d.poll();
    expect(d.isMerged).toBe(true);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    d.dispose();
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(helm.layers.mask).toBe(1);
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
  });

  it('remembers the material each attached part hangs with, whatever a host mounts on it', async () => {
    const { h, d } = await dressed('high');
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    const file = helm.material as THREE.Material;
    expect(file.name).toBe('medium');
    expect(pad.material).toBe(file);
    // the visual's material pass: a tier material per mesh
    helm.material = file.clone();
    pad.material = file.clone();
    expect(h.packs.wocArmorFileMaterial(helm)).toBe(file);
    expect(h.packs.wocArmorFileMaterial(pad)).toBe(file);
    // a mesh the store did not attach has none
    expect(h.packs.wocArmorFileMaterial(h.host.model)).toBeNull();
    expect(
      h.packs.wocArmorFileMaterial(h.host.model.getObjectByName('Character_Body') as THREE.Mesh),
    ).toBeNull();
    d.dispose();
  });
});
