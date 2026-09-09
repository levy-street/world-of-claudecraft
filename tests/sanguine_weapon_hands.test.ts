import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorReadinessCast } from '../src/render/ability_vfx/warrior_readiness_cast';
import * as assets from '../src/render/characters/assets';
import { SanguineWeaponSheath } from '../src/render/characters/sanguine_weapon_sheath';
import { CharacterVisual, type FarBakeGate } from '../src/render/characters/visual';

const blood = vi.hoisted(() => ({ texture: null as THREE.Texture | null }));
vi.mock('../src/render/ability_vfx/production_assets', () => ({
  warriorBloodTexture: () => blood.texture,
}));

function held(hand: 0 | 1) {
  const holder = new THREE.Group();
  holder.userData = {
    heldPropHolder: true,
    heldSlot: hand,
    [hand === 0 ? 'swapWeaponHolder' : 'swapOffhandHolder']: true,
  };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.08));
  mesh.userData.weaponMesh = true;
  holder.add(mesh);
  return { holder, mesh };
}

// Exercise the real overlay and lean offhand-swap methods without loading a rig.
function fixture(offhandItemId: string | null = 'deathless_greatblade') {
  const main = held(0),
    off = held(1),
    model = new THREE.Group();
  model.add(main.holder);
  if (offhandItemId) model.add(off.holder);
  const state = {
    model,
    weaponItemId: 'wyrmfang_greatblade',
    offhandItemId,
    weaponSkinId: null,
    weaponAuraColor: null as number | null,
    weaponAuraTip: false,
    weaponAuraSanguine: false,
    weaponAuraMode: 'none',
    weaponAuraMeshes: [] as THREE.Mesh[],
    sanguineSheath: new SanguineWeaponSheath(),
    def: { offhandSlot: 0 },
    stow: { attached: false },
    tintedRigClaims: new Set(),
    rebuildCasters: vi.fn(),
    applyVisualMaterials: vi.fn(),
  };
  const visual = Object.assign(Object.create(CharacterVisual.prototype), state) as CharacterVisual;
  return { visual, state, main, off, model };
}

afterEach(() => {
  blood.texture = null;
  vi.restoreAllMocks();
});

describe('Sanguine equipped sword coverage', () => {
  it('coats both independently tagged hands and releases both overlays on aura loss', () => {
    const f = fixture();
    const sourceDisposals = [f.main, f.off].map(({ mesh }) => vi.spyOn(mesh.geometry, 'dispose'));
    f.visual.setWeaponAura(0xff4636, false, true);
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([
      f.main.holder,
      f.off.holder,
    ]);
    const overlays = [...f.state.weaponAuraMeshes];
    const disposals = overlays.map((mesh) => vi.spyOn(mesh.material as THREE.Material, 'dispose'));
    f.visual.setWeaponAura(null);
    expect(overlays.every((mesh) => mesh.parent === null)).toBe(true);
    expect(f.state.weaponAuraMeshes).toHaveLength(0);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of sourceDisposals) expect(dispose).not.toHaveBeenCalled();
  });

  it.each(['eastbrook_buckler', null])('excludes a shield or absent offhand (%s)', (item) => {
    const f = fixture(item);
    f.visual.setWeaponAura(0xff4636, false, true);
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([f.main.holder]);
  });

  it('prepares both blood surfaces and releases their owned geometry without touching weapons', () => {
    const f = fixture();
    blood.texture = new THREE.Texture();
    const textureDisposed = vi.spyOn(blood.texture, 'dispose');
    const jobs: { target: THREE.Mesh; settle: Parameters<FarBakeGate>[1] }[] = [];
    f.state.sanguineSheath.setGate((target, settle) => {
      jobs.push({ target: target as THREE.Mesh, settle });
    });
    f.visual.setWeaponAura(0xff4636, false, true);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) job.settle(true);
    const overlays = [...f.state.weaponAuraMeshes];
    const ownedDisposals = overlays.map((mesh, index) => {
      expect(mesh.geometry).toBe(jobs[index].target.geometry);
      expect(mesh.material).toBe(jobs[index].target.material);
      expect(mesh.userData.ownsAuraGeometry).toBe(true);
      return vi.spyOn(mesh.geometry, 'dispose');
    });
    const sources = [f.main, f.off].map(({ mesh }) => vi.spyOn(mesh.geometry, 'dispose'));
    f.visual.setWeaponAura(null);
    for (const dispose of ownedDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of sources) expect(dispose).not.toHaveBeenCalled();
    expect(textureDisposed).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps other imbues on the mainhand with tip scope %s', (tip) => {
    const f = fixture();
    f.visual.setWeaponAura(0x58d63c, tip, false);
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([f.main.holder]);
  });

  it('rebuilds and cleans overlays when the offhand changes during an unchanged buff', () => {
    const f = fixture();
    f.visual.setWeaponAura(0xff4636, false, true);
    const oldOverlays = [...f.state.weaponAuraMeshes];
    const disposals = oldOverlays.map((mesh) =>
      vi.spyOn(mesh.material as THREE.Material, 'dispose'),
    );
    const replacement = held(1);
    vi.spyOn(assets, 'setHeldOffhand').mockImplementation(() => {
      f.off.holder.removeFromParent();
      f.model.add(replacement.holder);
      return [replacement.holder];
    });
    vi.spyOn(assets, 'applyMaterials').mockImplementation(() => {});
    vi.spyOn(assets, 'skinTexture').mockReturnValue(null);
    vi.spyOn(assets, 'skinEmissiveTexture').mockReturnValue(null);
    f.visual.setOffhand('rusty_dagger');
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([
      f.main.holder,
      replacement.holder,
    ]);
    expect(oldOverlays.every((mesh) => mesh.parent === null)).toBe(true);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    f.visual.setOffhand('eastbrook_buckler');
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([f.main.holder]);
  });
});

describe('Sanguine cast equipment coverage', () => {
  it.each([0, 1])('gathers and trails both weapons on beat %s', (beat) => {
    const handPoint = vi.fn((_id: number, hand: number) => ({ x: hand, y: 1, z: 0 }));
    const weaponTrail = vi.fn(),
      bakedAt = vi.fn(),
      countPrimitive = vi.fn();
    const host = { handPoint, weaponTrail, bakedAt, countPrimitive, isWeaponHand: () => true };
    drawWarriorReadinessCast(
      host as unknown as SequencerHost,
      { abilityId: 'sanguine_aura', casterId: 7 } as SeqSlot,
      beat,
    );
    expect(weaponTrail.mock.calls.map((args) => args[1])).toEqual([0, 1]);
    expect(bakedAt.mock.calls.map((args) => args[1])).toEqual([0, 1]);
    expect(countPrimitive.mock.calls.reduce((sum, args) => sum + args[1], 0)).toBe(4);
  });

  it.each([false, undefined])('does not coat an offhand without weapon proof (%s)', (offhand) => {
    const weaponTrail = vi.fn(),
      bakedAt = vi.fn();
    const host = {
      handPoint: (_id: number, hand: number) => ({ x: hand, y: 1, z: 0 }),
      weaponTrail,
      bakedAt,
      countPrimitive: vi.fn(),
      isWeaponHand: offhand === undefined ? undefined : (_id: number, hand: number) => hand === 0,
    };
    drawWarriorReadinessCast(
      host as unknown as SequencerHost,
      { abilityId: 'sanguine_aura', casterId: 7 } as SeqSlot,
      0,
    );
    expect(weaponTrail.mock.calls.map((args) => args[1])).toEqual([0]);
    expect(bakedAt).toHaveBeenCalledOnce();
  });

  it('skips absent hand anchors and duplicate secondary casts without emitting at the other hand', () => {
    const weaponTrail = vi.fn(),
      bakedAt = vi.fn();
    const host = {
      handPoint: (_id: number, hand: number) => (hand === 0 ? null : { x: 1, y: 1, z: 0 }),
      isWeaponHand: () => true,
      weaponTrail,
      bakedAt,
      countPrimitive: vi.fn(),
    };
    const slot = { abilityId: 'sanguine_aura', casterId: 7 } as SeqSlot;
    drawWarriorReadinessCast(host as unknown as SequencerHost, slot, 0);
    expect(weaponTrail.mock.calls.map((args) => args[1])).toEqual([1]);
    expect(bakedAt.mock.calls.map((args) => args[1])).toEqual([1]);
    slot.physicalSecondary = true;
    drawWarriorReadinessCast(host as unknown as SequencerHost, slot, 1);
    expect(weaponTrail).toHaveBeenCalledOnce();
    expect(bakedAt).toHaveBeenCalledOnce();
  });
});
