import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  abilityVfxCompileMaterials,
  collectAbilityVfxCompileTargets,
} from '../src/render/ability_vfx/prewarm';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { ArchetypeSequencer } from '../src/render/ability_vfx/sequencer';
import type { ShamanHeldEntity } from '../src/render/ability_vfx/shaman_held';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

function fixture() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = {
    arc: noop,
    beginPath: noop,
    clip: noop,
    closePath: noop,
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    ellipse: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    putImageData: noop,
    rect: noop,
    restore: noop,
    rotate: noop,
    save: noop,
    scale: noop,
    stroke: noop,
    translate: noop,
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  const anchor = vi.fn(
    (id: number, fraction: number, out = new THREE.Vector3()): THREE.Vector3 | null =>
      out.set(id * 3, fraction * 2, -5),
  );
  const fx = new AbilityVfxFx(
    scene,
    camera,
    anchor,
    () => 0,
    () => 0,
  );
  const ribbons = (fx as unknown as { ribbons: AbilityVfxRibbons }).ribbons;
  const held = vi.spyOn(ribbons, 'appendHeld');
  return { fx, scene, anchor, ribbons, held };
}
function actor(id: number, auras: ShamanHeldEntity['auras']): ShamanHeldEntity {
  return { id, auras, hp: 100, maxHp: 100, dead: false };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Shaman held engine integration', () => {
  it('packs offensive charges into real ribbon buffers on the synced frame and sweeps them next frame', () => {
    const h = fixture();
    h.fx.holdShamanState(actor(1, [{ id: 'shaman_thunder_charges', stacks: 5, remaining: 20 }]), 1);
    h.fx.update(0.05);
    expect(h.held).toHaveBeenCalledTimes(5);
    expect(
      (h.ribbons as unknown as { mesh: THREE.Mesh }).mesh.geometry.drawRange.count,
    ).toBeGreaterThan(0);
    expect(h.anchor.mock.calls.every((call) => call[2] !== undefined)).toBe(true);
    h.held.mockClear();
    h.fx.update(0.05);
    expect(h.held).not.toHaveBeenCalled();
    expect((h.ribbons as unknown as { mesh: THREE.Mesh }).mesh.geometry.drawRange.count).toBe(0);
    h.fx.dispose();
  });

  it.each([0, 1])(
    'packs all ten own-party Chorus signals with Ward and transient load at quality %s',
    (quality) => {
      const h = fixture();
      h.fx.setQuality(quality);
      h.anchor.mockImplementation((id, fraction, out = new THREE.Vector3()) =>
        out.set(id * 10, fraction * 2, -5),
      );
      for (let id = 1; id <= 40; id++)
        h.fx.holdShamanState(actor(id, [{ id: 'elemental_mastery', remaining: 8 }]), 50);
      for (let id = 50; id < 60; id++)
        h.fx.holdShamanState(
          actor(id, [{ id: 'bloodlust', kind: 'buff_haste', remaining: 15, sourceId: 50 }]),
          50,
        );
      for (let id = 1; id <= 10; id++)
        h.fx.orbit(id, 'wardCharges', 0x8fddff, { n: 3 }, quality ? 0 : 1);
      for (let i = 0; i < 20; i++)
        h.fx.pathRibbon(0xffffff, 0.1, 1, (points) => {
          points[0].set(-30, 1, 0);
          points[1].set(-25, 2, 0);
          return 2;
        });
      h.fx.update(0.05, true);
      const geo = (h.ribbons as unknown as { mesh: THREE.Mesh }).mesh.geometry;
      const indices = geo.getIndex()!;
      const positions = geo.getAttribute('position');
      for (let id = 50; id < 60; id++) {
        let found = false;
        for (let i = 0; i < geo.drawRange.count; i++) {
          const x = positions.getX(indices.getX(i));
          if (Math.abs(x - id * 10) < 1.8 && positions.getY(indices.getX(i)) > 0.4) {
            found = true;
            break;
          }
        }
        expect(found, `missing packed Chorus recipient ${id}`).toBe(true);
      }
      h.fx.dispose();
    },
  );

  it('preserves every defensive Ward charge separately from the offensive bank at reduced motion and low detail', () => {
    const h = fixture();
    h.fx.setQuality(0);
    for (let charges = 0; charges <= 3; charges++) {
      h.held.mockClear();
      h.fx.holdShamanState(
        actor(1, [
          { id: 'shaman_thunder_charges', stacks: 5, remaining: 20 },
          { id: 'lightning_shield', charges, remaining: 20 },
        ]),
        1,
      );
      h.fx.orbit(1, 'wardCharges', 0x8fddff, { n: charges }, 1);
      h.fx.update(0.05, true);
      // Two conductor contours per defensive charge, one dorsal prong per offensive charge.
      expect(h.held).toHaveBeenCalledTimes(charges * 2 + 5);
    }
    h.fx.dispose();
  });

  it('draws the owned healing reservoir only on its recipient and releases it on sleep, clear and disposal', () => {
    const h = fixture();
    const recipient = actor(7, [
      { id: 'shaman_mending_current', sourceId: 1, value: 15, remaining: 12 },
    ]);
    h.fx.holdShamanState(recipient, 1);
    h.fx.holdShamanState(actor(8, []), 1);
    h.fx.update(0.05);
    expect(h.held).toHaveBeenCalledTimes(4);
    expect(h.anchor.mock.calls.every((call) => call[0] === 7)).toBe(true);
    for (const release of [() => h.fx.sleepEntity(7), () => h.fx.clear(), () => h.fx.dispose()]) {
      h.held.mockClear();
      h.fx.holdShamanState(recipient, 1);
      release();
      h.fx.update(0.05);
      expect(h.held).not.toHaveBeenCalled();
    }
    h.fx.holdShamanState(recipient, 1);
    h.fx.update(0.05);
    expect(h.held).not.toHaveBeenCalled();
  });

  it('ends release-only slots immediately and requires an authoritative outcome for recipient contact', () => {
    const h = fixture();
    const sequencer = (h.fx as unknown as { sequencer: ArchetypeSequencer }).sequencer;
    const start = vi.spyOn(sequencer, 'start');
    const impact = vi.spyOn(sequencer, 'triggerImpact');
    const spec = SHAMAN_VFX_FULL_SPECS.earth_shock;
    expect(h.fx.sequenceShamanRelease('earth_shock', spec, 1, 7, 0)).toBe(true);
    const launch = start.mock.results[0].value;
    expect(launch.active).toBe(false);
    expect(launch.impactDone).toBe(false);
    expect(launch.impactAt).toBe(Infinity);
    h.fx.update(2);
    expect(impact).not.toHaveBeenCalled();
    start.mockClear();
    expect(h.fx.sequenceShamanContact('earth_shock', spec, 1, 7, 0, 0)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(h.fx.sequenceShamanContact('earth_shock', spec, 1, 7, 0)).toBe(true);
    expect(start.mock.calls[0][11]).toBe(true);
    expect(impact).toHaveBeenCalledOnce();
    expect(impact.mock.calls[0].slice(2)).toEqual([21, 1, -5]);
    const landed = start.mock.results[0].value;
    expect(landed.componentOutcomes).toBe(1);
    expect(landed.physicalSecondary).toBe(true);
    expect(landed.impactDone).toBe(true);
    expect(landed.active).toBe(true);
    expect(landed.shamanClimaxAt).toBeGreaterThan(0);
    impact.mockClear();
    h.fx.update(2);
    expect(impact).not.toHaveBeenCalled();
    expect(landed.active).toBe(false);
    h.fx.dispose();
  });

  it('never substitutes a neighbour for a missing contact anchor and preserves the absorption outcome', () => {
    const h = fixture();
    const sequencer = (h.fx as unknown as { sequencer: ArchetypeSequencer }).sequencer;
    const start = vi.spyOn(sequencer, 'start');
    const spec = SHAMAN_VFX_FULL_SPECS.lightning_bolt;
    h.anchor.mockImplementation(() => null);
    expect(h.fx.sequenceShamanContact('lightning_bolt', spec, 1, 7, 0)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    h.anchor.mockImplementation((id, fraction, out = new THREE.Vector3()) =>
      out.set(id * 3, fraction * 2, -5),
    );
    expect(h.fx.sequenceShamanContact('lightning_bolt', spec, 1, 7, 0, 2)).toBe(true);
    expect(start.mock.results[0].value.componentOutcomes).toBe(2);
    h.fx.dispose();
    expect(h.fx.sequenceShamanRelease('lightning_bolt', spec, 1, 7, 0)).toBe(false);
    expect(h.fx.sequenceShamanContact('lightning_bolt', spec, 1, 7, 0)).toBe(false);
  });

  it('registers the existing water pool in the shared preparation and cast-readiness traversals', () => {
    const h = fixture();
    const water = h.scene.getObjectByName('restorativeWaterVolumes') as THREE.Mesh;
    expect(water).toBeDefined();
    expect(water.visible).toBe(false);
    expect(collectAbilityVfxCompileTargets(h.scene).some((target) => target.object === water)).toBe(
      true,
    );
    expect(abilityVfxCompileMaterials(h.scene)).toContain(water.material);
    h.fx.dispose();
    expect(h.scene.getObjectByName('restorativeWaterVolumes')).toBeUndefined();
  });
});
