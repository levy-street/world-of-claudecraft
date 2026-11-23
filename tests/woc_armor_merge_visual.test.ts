// @vitest-environment happy-dom
// The merged armor through the REAL CharacterVisual, with only asset IO stubbed. The rig
// and the dressing are pinned against a mock host elsewhere (woc_armor_merge.test.ts,
// woc_armor_dressing.test.ts); this suite pins the other half of that seam, the calls the
// visual itself makes (redressed, the frame poll, rigDrawn, schedule, effectsChanged,
// gateChanged, dispose), which nothing else would notice going missing.
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  // the fixture ships no head file: a failed head ends the body's wait for it
  loadGltf: vi.fn((url: string) =>
    url.includes('/head_type_')
      ? Promise.reject(new Error('the fixture ships no head file'))
      : Promise.resolve(url.includes('/armor/') ? armorSource() : baseSource()),
  ),
  loadHdr: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn((url: string) =>
    Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
  ),
  loadKtx2Texture: vi.fn((url: string) =>
    Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
  ),
  releaseGltf: vi.fn(),
}));

import { charactersReady, visualAssetsResident } from '../src/render/characters/assets';
import { VISUALS } from '../src/render/characters/manifest';
import { CharacterVisual } from '../src/render/characters/visual';
import { wocArmorPackUrl } from '../src/render/characters/woc_armor_core';
import { currentWocArmorTier } from '../src/render/characters/woc_armor_dressing';
import { wocArmorMergeInternalsForTest } from '../src/render/characters/woc_armor_merge';
import { ensureWocArmorPack, wocArmorPackResident } from '../src/render/characters/woc_armor_packs';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';
import { wocHeadCoreUrl } from '../src/render/characters/woc_head_catalog';
import { ensureWocHeadFile, wocHeadFileState } from '../src/render/characters/woc_head_packs';

const KEY = 'player_paladin';
/** A standing idle frame (armory_preview.ts IDLE_STATE). */
const IDLE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
} as never;
const WORN = { helmet: 'some-helm', chest: 'some-chest' };
const MERGED = 'woc_armor_merged';
const SCRATCH = 'character_effect_compile_scratch';
const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' }, chest: { label: 'Chest' } },
  items: {
    original_helm: { label: 'Helm', slot: 'head', set: 'fixture', nodes: ['Helm'] },
    original_chest: { label: 'Chest', slot: 'chest', set: 'fixture', nodes: ['Chest'] },
  },
  defaultEquipment: { head: 'original_helm', chest: 'original_chest' },
  animationNames: ['Idle'],
};

/** The kit's file: a helm and a chest, rigid on the file's copy of the rig bone, on the
 *  file's one material, so the two fold into one draw. */
function armorSource() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'root';
  scene.add(bone);
  const material = new THREE.MeshStandardMaterial({ color: 0x8090a0 });
  material.name = 'fixture_plate';
  for (const [name, x, y] of [
    ['Helm', 0, 4],
    ['Chest', 3, 0],
  ] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = name;
    mesh.position.set(x, y, 0);
    bone.add(mesh);
  }
  return { scene, animations: [] };
}

function baseSource() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const bone = new THREE.Bone();
  bone.name = 'root';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.name = 'Character_Body';
  scene.add(mesh);
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

interface Gate {
  target: THREE.Object3D;
  settle: (ready?: () => boolean) => void;
}
interface Unit {
  work: () => unknown;
  label: string | undefined;
}

// One fixture body for the file: its base, its kit and the outcome of its head fetch are
// resident before any visual is built, as they are for a player who walks into view.
beforeAll(async () => {
  VISUALS[KEY] = {
    ...VISUALS[KEY],
    wocCharacter: manifest,
    clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: ['Idle'], death: 'Idle' },
  };
  // the head file the fixture does not ship is reported once, on the dev channel
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await charactersReady();
  await vi.waitFor(() => expect(visualAssetsResident(KEY)).toBe(true));
  const kit = wocArmorPackUrl('male', 'fixture', currentWocArmorTier());
  ensureWocArmorPack(kit);
  await vi.waitFor(() => expect(wocArmorPackResident(kit)).toBe(true));
  ensureWocHeadFile(wocHeadCoreUrl('a'));
  await vi.waitFor(() => expect(wocHeadFileState(wocHeadCoreUrl('a'))).toBe('failed'));
  quiet.mockRestore();
});

beforeEach(() => {
  wocArmorMergeInternalsForTest.reset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** One world body: the real visual, opted in to merged draws as createCharacterVisual does,
 *  behind a compile gate and a work queue the test settles and runs by hand. */
function body() {
  const visual = new CharacterVisual(KEY, 0xffffff, 0);
  visual.setWocDrawMerge(true);
  const gates: Gate[] = [];
  const units: Unit[] = [];
  const gate = (target: THREE.Object3D, settle: Gate['settle']): void => {
    gates.push({ target, settle });
  };
  visual.setFarBakeGate(gate, {
    run: (work: () => unknown, _priority?: number, label?: string) => {
      units.push({ work, label });
      return Promise.resolve(undefined as never);
    },
  });
  const part = (name: string): THREE.Mesh => visual.root.getObjectByName(name) as THREE.Mesh;
  return {
    visual,
    gate,
    gates,
    units,
    cache: wocArmorMergeInternalsForTest.cache,
    part,
    wrapper: (): THREE.Object3D | undefined => visual.root.getObjectByName(MERGED),
    frame: (): void => visual.update(0.05, IDLE, true),
    /** Run what the work queue holds, as its frame budget would. */
    work: (): void => {
      for (const unit of units.splice(0)) unit.work();
    },
    /** The gate asks still open for a target of this name. */
    asked: (name: string): Gate[] => gates.filter((g) => g.target.name === name),
    /** Settle (and forget) every gate ask for a target of this name. */
    settle: (name: string, ready?: () => boolean): void => {
      for (let i = gates.length - 1; i >= 0; i--) {
        if (gates[i].target.name !== name) continue;
        const [asked] = gates.splice(i, 1);
        asked.settle(ready);
      }
    },
    /** The kit's meshes three would draw this frame: visible through their whole chain and
     *  on the camera's layer. */
    drawn: (): string[] => {
      const out: string[] = [];
      const walk = (o: THREE.Object3D): void => {
        if (!o.visible) return;
        const isKit = o.name === 'Helm' || o.name === 'Chest' || o.name.startsWith(`${MERGED}_`);
        if (isKit && (o.layers.mask & 1) !== 0) out.push(o.name);
        for (const child of o.children) walk(child);
      };
      walk(visual.root);
      return out.sort();
    },
    /** Dress the kit and bring its stand-in all the way up. */
    stand(): void {
      visual.setWocEquipment(WORN, false);
      this.frame();
      this.work();
      this.settle(MERGED);
    },
  };
}

function opaque(mesh: THREE.Mesh): boolean {
  return !(mesh.material as THREE.Material).transparent;
}

describe('a WOC body drawing its kit merged, through the real visual', () => {
  it('mounts as one queued unit from the frame poll, links behind the gate, then stands', () => {
    const h = body();
    h.visual.setWocEquipment(WORN, false);
    // the dress pass mounts nothing: the parts draw, and nothing is queued until a frame
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    expect(h.units).toEqual([]);
    expect(h.wrapper()).toBeUndefined();

    h.frame();
    expect(h.units.map((u) => u.label)).toEqual(['woc-armor-merge:male']);
    h.frame();
    expect(h.units).toHaveLength(1);
    expect(h.wrapper()).toBeUndefined();

    // the unit mounts it hidden and asks the gate: the parts still draw meanwhile
    h.work();
    expect(h.asked(MERGED).map((g) => g.target)).toEqual([h.wrapper()]);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.frame();
    expect(h.asked(MERGED)).toHaveLength(1);
    expect(h.units).toEqual([]);

    // linked: one draw for the two parts, which stay shown (the source of truth)
    h.settle(MERGED);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.part('Helm').visible).toBe(true);
    expect(h.part('Chest').visible).toBe(true);
    const merged = h.part(`${MERGED}_0`) as THREE.SkinnedMesh;
    expect(merged.isSkinnedMesh).toBe(true);
    expect(merged.skeleton).toBe((h.part('Character_Body') as THREE.SkinnedMesh).skeleton);
    expect(merged.geometry.getAttribute('position').count).toBe(48);
    // a steady frame asks for nothing more
    h.frame();
    h.frame();
    expect(h.units).toEqual([]);
    expect(h.asked(MERGED)).toEqual([]);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);

    // the visual's teardown takes it down: the shared buffer is given back, and the parts
    // (the file's own nodes, handed back to the store) are on their layer again
    const parts = [h.part('Helm'), h.part('Chest')];
    expect(parts.map((p) => p.layers.mask)).toEqual([0, 0]);
    expect([...h.cache.values()].map((e) => e.refs)).toEqual([1]);
    h.visual.dispose();
    expect([...h.cache.values()].map((e) => e.refs)).toEqual([0]);
    expect(parts.map((p) => p.layers.mask)).toEqual([1, 1]);
    expect(merged.parent?.parent).toBeNull();
  });

  it('goes back to the parts inside the dress pass that changes the kit, and comes back cached', () => {
    const h = body();
    h.stand();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);

    // the helm hidden: no frame in between, the one part left draws by itself at once
    h.visual.setWocEquipment(WORN, true);
    expect(h.drawn()).toEqual(['Chest']);
    expect(h.wrapper()).toBeUndefined();
    h.frame();
    expect(h.units).toEqual([]);

    // the helm back: the parts draw at once, and the kit somebody built only mounts
    h.visual.setWocEquipment(WORN, false);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.frame();
    expect(h.units.map((u) => u.label)).toEqual(['woc-armor-mount:male']);
    h.work();
    h.settle(MERGED);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.cache.size).toBe(1);
    h.visual.dispose();
  });

  it('draws its parts under a translucent effect from the frame it is mounted, and stands again after it with no new link', () => {
    const h = body();
    h.stand();
    const wrapper = h.wrapper();

    // the ghost run links behind the gate first: nothing changes until it is mounted
    h.visual.setGhost(true);
    expect(h.asked(SCRATCH)).toHaveLength(1);
    h.frame();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    h.settle(SCRATCH);
    h.frame();
    // mounted on that frame: the parts draw it, the merged mesh never does
    expect(opaque(h.part('Helm'))).toBe(false);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.frame();
    expect(h.drawn()).toEqual(['Chest', 'Helm']);

    // it ends: the same stand-in stands again from the next frame, nothing mounted or linked
    h.visual.setGhost(false);
    expect(opaque(h.part('Helm'))).toBe(true);
    h.frame();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.wrapper()).toBe(wrapper);
    expect(h.units).toEqual([]);
    expect(h.asked(MERGED)).toEqual([]);

    // the Soul Rend mark swaps in on the spot (never staged): so does the way back to the parts
    h.visual.setSoulRend(true);
    expect(opaque(h.part('Helm'))).toBe(false);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.visual.setSoulRend(false);
    h.frame();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.wrapper()).toBe(wrapper);
    expect(h.asked(MERGED)).toEqual([]);
    h.visual.dispose();
  });

  it('is one more armor mesh to the sweeps of the visual: an opaque overlay and the shadow flags reach it', () => {
    const h = body();
    h.stand();
    const colour = (name: string): number =>
      (h.part(name).material as THREE.MeshStandardMaterial).color.getHex();
    expect(colour(`${MERGED}_0`)).toBe(0x8090a0);

    // a rune's tint blends nothing: the stand-in keeps standing and draws it itself
    h.visual.setRuneTint(0xff0000);
    h.frame();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(colour('Helm')).not.toBe(0x8090a0);
    expect(colour(`${MERGED}_0`)).toBe(colour('Helm'));
    h.visual.setRuneTint(null);
    h.frame();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(colour(`${MERGED}_0`)).toBe(0x8090a0);
    expect(h.units).toEqual([]);
    expect(h.asked(MERGED)).toEqual([]);

    // it casts for its parts, and stops when the body's shadows are turned off
    const merged = h.part(`${MERGED}_0`);
    expect(merged.castShadow).toBe(true);
    h.visual.setShadow(false);
    expect(merged.castShadow).toBe(false);
    h.visual.setShadow(true);
    expect(merged.castShadow).toBe(true);
    h.visual.dispose();
  });

  it('is born parked when it mounts while a translucent effect still links, with no thrash', () => {
    const h = body();
    h.visual.setWocEquipment(WORN, false);
    h.visual.setGhost(true);
    expect(h.asked(SCRATCH)).toHaveLength(1);
    // the parts are still opaque (the effect has not been mounted), so the mount is asked for
    h.frame();
    expect(h.units).toHaveLength(1);
    h.work();
    // the visual mounts an effect on a new mesh ahead of the parts: it must not stand, link
    // or come down over that
    const wrapper = h.wrapper();
    expect(wrapper).toBeDefined();
    expect(h.asked(MERGED)).toEqual([]);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    for (let i = 0; i < 3; i++) h.frame();
    expect(h.wrapper()).toBe(wrapper);
    expect(h.units).toEqual([]);
    expect(h.asked(MERGED)).toEqual([]);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);

    // the effect lands on the parts: still theirs to draw
    h.settle(SCRATCH);
    h.frame();
    expect(opaque(h.part('Helm'))).toBe(false);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    expect(h.wrapper()).toBe(wrapper);

    // it ends: only now are the stand-in's own programs linked, and then it stands
    h.visual.setGhost(false);
    h.frame();
    expect(h.asked(MERGED).map((g) => g.target)).toEqual([wrapper]);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.settle(MERGED);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.units).toEqual([]);
    h.visual.dispose();
  });

  it('mounts nothing for a body nobody sees, and asks the gate again when the pool hands it out', () => {
    const h = body();
    h.visual.setWocEquipment(WORN, false);
    h.visual.setActive(false);
    h.frame();
    h.frame();
    expect(h.units).toEqual([]);
    h.visual.setActive(true);
    h.frame();
    expect(h.units).toHaveLength(1);

    // hidden again before the queue reaches it: the unit looks again and mounts nothing
    h.visual.setActive(false);
    h.work();
    expect(h.wrapper()).toBeUndefined();
    h.visual.setActive(true);
    h.frame();
    h.work();
    const wrapper = h.wrapper();
    expect(h.asked(MERGED)).toHaveLength(1);

    // the pool hands the body out again while that link is in flight (the gate goes in
    // once more): the same stand-in is asked for again, not rebuilt...
    const [stale] = h.gates.splice(0);
    h.visual.setFarBakeGate(h.gate);
    h.frame();
    expect(h.asked(MERGED).map((g) => g.target)).toEqual([wrapper]);
    expect(h.units).toEqual([]);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    // ...and the first ask, settling ahead of it (one lane, in order), shows nothing: the
    // parts go on drawing alone until THIS link settles
    stale.settle();
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.frame();
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    expect(h.asked(MERGED)).toHaveLength(1);
    h.settle(MERGED);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.wrapper()).toBe(wrapper);
    h.visual.dispose();
  });

  it('asks again for a link the gate could not prove, and stops after two in a row', () => {
    const h = body();
    h.visual.setWocEquipment(WORN, false);
    h.frame();
    h.work();
    const wrapper = h.wrapper();

    // a buff glow lands while the kit links: the proof reads its clones, which no gate was
    // asked for. No verdict on the kit: it stays behind its parts and is asked for again
    h.visual.setAuraGlow(0xffaa00, 0.5);
    h.settle(MERGED, () => false);
    expect(h.wrapper()).toBe(wrapper);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.frame();
    expect(h.asked(MERGED).map((g) => g.target)).toEqual([wrapper]);
    expect(h.units).toEqual([]);
    // proven this time: it stands under the glow, and through its end
    h.settle(MERGED);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    h.visual.setAuraGlow(0xffaa00, 0);
    h.frame();
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    expect(h.asked(MERGED)).toEqual([]);

    // a gate that cannot prepare the very materials it was asked with: one more try...
    h.visual.setWocEquipment(WORN, true);
    h.visual.setWocEquipment(WORN, false);
    h.frame();
    h.work();
    const again = h.wrapper();
    h.settle(MERGED, () => false);
    expect(h.wrapper()).toBe(again);
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    h.frame();
    expect(h.asked(MERGED)).toHaveLength(1);
    // ...then the kit keeps its parts, and nothing is asked for again, frame after frame
    h.settle(MERGED, () => false);
    expect(h.wrapper()).toBeUndefined();
    expect(h.drawn()).toEqual(['Chest', 'Helm']);
    for (let i = 0; i < 3; i++) h.frame();
    expect(h.units).toEqual([]);
    expect(h.asked(MERGED)).toEqual([]);
    // ...under THAT gate: the next one the body is handed gets its own tries
    h.visual.setFarBakeGate(h.gate);
    h.frame();
    expect(h.units.map((u) => u.label)).toEqual(['woc-armor-mount:male']);
    h.work();
    h.settle(MERGED);
    expect(h.drawn()).toEqual([`${MERGED}_0`]);
    h.visual.dispose();
  });
});
