import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadGltf, QuietFx } = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  QuietFx: class {
    dispose() {}
  },
}));
vi.mock('../src/render/assets/loader', () => ({ loadGltf }));
// Only unrelated heavy painters are replaced; the real BastionFx constructor,
// real ship owner, common TelegraphKit and both attachment gates run below.
vi.mock('../src/render/sunken_bastion/bastion_boss_fx', () => ({
  BastionBossFx: QuietFx,
  BASTION_BOSS_TELEGRAPHS: { surge: 'surge', surgeRadius: 8 },
}));
vi.mock('../src/render/sunken_bastion/bastion_creature_fx', () => ({ BastionCreatureFx: QuietFx }));
vi.mock('../src/render/sunken_bastion/bastion_gaol_fx', () => ({ BastionGaolFx: QuietFx }));
vi.mock('../src/render/sunken_bastion/bastion_mooring_fx', () => ({ BastionMooringFx: QuietFx }));
vi.mock('../src/render/sunken_bastion/bastion_reaper_fx', () => ({ BastionReaperFx: QuietFx }));
vi.mock('../src/render/sunken_bastion/bastion_vael_stage_fx', () => ({
  BastionVaelStageFx: QuietFx,
}));
vi.mock('../src/render/sunken_bastion/bastion_olen_fx', () => ({ BastionOlenFx: QuietFx }));

import { BastionFx } from '../src/render/sunken_bastion/bastion_fx';
import { BastionGhostShip } from '../src/render/sunken_bastion/bastion_ghost_ship';

beforeEach(() => {
  loadGltf.mockReset();
});

describe('optional ghost ship preparation', () => {
  it('cannot attach late after its owner retires during the asset load', async () => {
    let release: (value: { scene: THREE.Group }) => void = () => {};
    loadGltf.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const scene = new THREE.Scene();
    const gate = vi.fn(async () => {});
    const ship = new BastionGhostShip(scene, undefined, undefined, gate);
    ship.dispose();
    release({ scene: new THREE.Group() });
    await ship.ready;
    expect(gate).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
  });

  it('attaches and readies every gameplay tell when the ship GLB never resolves', async () => {
    loadGltf.mockReturnValue(new Promise(() => {}));
    const scene = new THREE.Scene();
    const gate = vi.fn(async () => {});
    const fx = new BastionFx(scene, () => 0, undefined, gate);
    expect(scene.getObjectByName('sunken-bastion-telegraphs')).toBeDefined();
    expect(gate).toHaveBeenCalledTimes(1);
    await fx.readyForEntry;
    expect(scene.getObjectByName('sunken-bastion-telegraphs')?.visible).toBe(true);
    expect(scene.getObjectByName('bastion-spectral-broadside-ship')).toBeUndefined();
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('holds a loaded ship behind its own gate without changing the common root', async () => {
    const authored = new THREE.Group();
    const sourceMaterial = new THREE.MeshBasicMaterial({ color: 0x123456 });
    authored.add(new THREE.Mesh(new THREE.BoxGeometry(), sourceMaterial));
    loadGltf.mockResolvedValue({ scene: authored });
    const scene = new THREE.Scene();
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = vi.fn(() => pending);
    const ship = new BastionGhostShip(scene, undefined, undefined, gate);
    await Promise.resolve();
    expect(gate).toHaveBeenCalledTimes(1);
    const root = scene.getObjectByName('bastion-spectral-broadside-ship');
    expect(root?.visible).toBe(false);
    expect(sourceMaterial.transparent).toBe(false);
    release();
    await ship.ready;
    // No live marker: compilation alone never flashes a ship at world origin.
    expect(root?.visible).toBe(false);
    ship.dispose();
    expect(scene.children).toHaveLength(0);
    authored.children[0].removeFromParent();
    sourceMaterial.dispose();
  });
});
