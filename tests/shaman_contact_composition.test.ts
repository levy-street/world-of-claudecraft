import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroundDecals } from '../src/render/ability_vfx/decals';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxDamageEvent } from '../src/render/ability_vfx/painter';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { shamanDamage } from '../src/render/ability_vfx/shaman_events';
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
      out.set(id * 3, fraction * 2, id % 2 ? -5 : 8),
  );
  const fx = new AbilityVfxFx(
    scene,
    camera,
    anchor,
    () => 0,
    () => 0,
  );
  const ribbons = (fx as unknown as { ribbons: AbilityVfxRibbons }).ribbons;
  return { fx, scene, anchor, ribbons };
}

function compositionFixture() {
  const h = fixture();
  const paths = vi.spyOn(h.fx, 'pathRibbon');
  const sheets = vi.spyOn(h.fx, 'flipbookAt');
  const contact = vi.spyOn(h.fx, 'contact');
  const burst = vi.spyOn(h.fx, 'burstAt');
  const fragments = vi.spyOn(h.fx, 'fragmentsAt');
  const water = vi.spyOn(h.fx, 'waterVolume');
  const baked = vi.spyOn(h.fx, 'bakedAt');
  const arcs = (h.ribbons as unknown as { arcs: { active: boolean; pts: THREE.Vector3[] }[] }).arcs;
  const host: Parameters<typeof shamanDamage>[0] = {
    fx: h.fx,
    variant: (id) => id,
    tier: () => 0,
    gesture: vi.fn(),
  };
  const damage = (targetId: number, overrides: Partial<AbilityVfxDamageEvent> = {}) =>
    shamanDamage(host, {
      sourceId: 1,
      targetId,
      abilityId: 'chain_lightning',
      ability: 'Skybranch',
      school: 'nature',
      amount: 40,
      crit: false,
      kind: 'hit',
      ...overrides,
    });
  return { ...h, paths, sheets, contact, burst, fragments, water, baked, arcs, damage };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Shaman confirmed recipient contact composition', () => {
  it.each([false, true])(
    'stages Faultwake once and carries its charged payoff to the climax: %s',
    (charged) => {
      const h = compositionFixture();
      h.fx.sequenceInstantAt(
        'earthquake',
        SHAMAN_VFX_FULL_SPECS.earthquake,
        1,
        17,
        -23,
        0x72796b,
        0,
        0,
        charged,
      );
      h.fx.update(0.16);
      expect(h.paths).toHaveBeenCalled();
      expect(h.sheets).not.toHaveBeenCalled();
      expect(h.fragments).not.toHaveBeenCalled();
      h.fx.update(0.3);
      expect(h.sheets).not.toHaveBeenCalled();
      h.fx.update(0.1);
      expect(h.sheets).toHaveBeenCalledTimes(charged ? 2 : 1);
      expect(h.sheets.mock.calls[0][5]).toBe('shaman_earth_fault');
      expect(h.sheets.mock.calls[0][0]).toBe(17);
      expect(h.sheets.mock.calls[0][2]).toBe(-23);
      if (charged) expect(h.sheets.mock.calls[1][5]).toBe('shaman_storm');
      h.fx.update(1);
      expect(h.sheets).toHaveBeenCalledTimes(charged ? 2 : 1);
      h.fx.clear();
      h.fx.update(1);
      expect(h.sheets).toHaveBeenCalledTimes(charged ? 2 : 1);
      h.fx.dispose();
    },
  );
  it.each(['lightning_bolt', 'earth_shock', 'flame_shock', 'frost_shock'])(
    '%s carries its confirmed impact into one delayed aftermath without repeating the hit',
    (id) => {
      const h = compositionFixture();
      h.damage(7, { abilityId: id });
      const initialPaths = h.paths.mock.calls.length;
      const initialSheets = h.sheets.mock.calls.length;
      h.fx.update(0.1);
      expect(h.paths).toHaveBeenCalledTimes(initialPaths);
      h.fx.update(0.11);
      expect(h.paths).toHaveBeenCalledTimes(initialPaths + 2);
      expect(h.contact).toHaveBeenCalledOnce();
      expect(h.sheets).toHaveBeenCalledTimes(initialSheets + (id === 'lightning_bolt' ? 1 : 0));
      h.fx.update(1.2);
      expect(h.paths).toHaveBeenCalledTimes(initialPaths + 2);
      expect(h.arcs.some((a) => a.active)).toBe(false);
      h.fx.dispose();
    },
  );

  it('drops the delayed aftermath if its actual recipient disappears', () => {
    const h = compositionFixture();
    h.damage(7, { abilityId: 'lightning_bolt' });
    const count = h.paths.mock.calls.length;
    h.anchor.mockReturnValue(null);
    h.fx.update(0.22);
    expect(h.paths).toHaveBeenCalledTimes(count);
    expect(h.contact).toHaveBeenCalledOnce();
    h.fx.dispose();
  });

  it.each(['storm', 'earth', 'water', 'wind', 'fire'])(
    'Primal %s gathers once then crowns the caster with all four elements',
    (element) => {
      const h = compositionFixture();
      const id = `primal_exaltation_${element}`;
      h.fx.sequenceInstantAt(id, SHAMAN_VFX_FULL_SPECS[id], 1, 3, -5, 0x428bcf, 0);
      h.fx.update(0.16);
      expect(h.water).toHaveBeenCalledTimes(2);
      expect(h.sheets).not.toHaveBeenCalled();
      h.fx.update(0.25);
      expect(h.sheets).not.toHaveBeenCalled();
      h.fx.update(0.1);
      expect(h.sheets).toHaveBeenCalledOnce();
      expect(h.sheets.mock.calls[0][5]).toBe('shaman_fire_ascension');
      expect(h.water).toHaveBeenCalledTimes(3);
      const colors = h.paths.mock.calls.map((c) => c[0]);
      expect(colors).toContain(0xffa148);
      expect(colors).toContain(0x84eddf);
      expect(colors).toContain(0xdaf8ff);
      expect(colors).toContain(0xdbf4e9);
      h.fx.update(2);
      expect(h.sheets).toHaveBeenCalledOnce();
      expect(h.arcs.some((a) => a.active)).toBe(false);
      expect(h.contact).not.toHaveBeenCalled();
      h.fx.dispose();
    },
  );

  it('keeps the authored earth fracture instead of falling back to a glowing rune circle', () => {
    const h = compositionFixture();
    const decals = (h.fx as unknown as { decals: GroundDecals }).decals;
    const spawn = vi.spyOn(decals, 'spawn');
    h.damage(7, { abilityId: 'earth_shock', ability: 'Earthen Jolt' });
    expect(spawn.mock.calls.some((call) => call[5] === 'shaman_fracture')).toBe(true);
    expect(spawn.mock.calls.some((call) => call[5] === 'rune')).toBe(false);
    h.fx.dispose();
  });
  it('admits all three actual chain recipients into the existing ribbon pool with separate body origins', () => {
    const h = compositionFixture();
    const recipients = [7, 8, 11];
    const origins = recipients.map((id) => h.anchor(id, 0.5));
    for (const [index, targetId] of recipients.entries()) {
      const before = h.paths.mock.calls.length;
      expect(h.damage(targetId)).toBe(true);
      const added = h.paths.mock.calls.length - before;
      expect(added).toBeGreaterThan(0);
      expect(added).toBeLessThanOrEqual(3);
      expect(h.sheets).toHaveBeenCalledTimes(index + 1);
      expect(h.sheets.mock.calls[index].slice(0, 3)).toEqual(origins[index]?.toArray());
    }
    expect(h.paths).toHaveBeenCalledTimes(9);
    expect(h.paths.mock.results.every((result) => result.value === true)).toBe(true);
    expect(h.arcs).toHaveLength(20);
    const live = h.arcs.filter((arc) => arc.active);
    expect(live).toHaveLength(9);
    for (const [i, origin] of origins.entries()) {
      const [lead, forkA, forkB] = live.slice(i * 3, i * 3 + 3);
      expect(lead.pts[11].equals(origin!)).toBe(true);
      expect(lead.pts[0].y).toBeGreaterThan(origin!.y + 6);
      // All three remain one connected impact on the actual recipient. The
      // split leaders now emerge from knots in its lead instead of three spokes.
      expect(forkA.pts[0].equals(lead.pts[3])).toBe(true);
      expect(forkB.pts[0].equals(lead.pts[6])).toBe(true);
    }
    expect(h.contact.mock.calls.map((call) => call[1])).toEqual(recipients);
    h.fx.update(0.05);
    expect(h.contact.mock.calls.map((call) => call[1])).toEqual(recipients);
    expect(h.sheets).toHaveBeenCalledTimes(3);
    h.fx.update(0.2);
    expect(h.paths).toHaveBeenCalledTimes(15);
    expect(h.paths.mock.results.every((result) => result.value === true)).toBe(true);
    expect(h.sheets).toHaveBeenCalledTimes(3);
    expect(h.contact.mock.calls.map((call) => call[1])).toEqual(recipients);
    h.fx.update(1);
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
    expect(h.paths).toHaveBeenCalledTimes(15);
    h.fx.dispose();
  });

  it.each([0.016, 0.05, 0.22])(
    'keeps four Skybranch receipts within real pools at a %s second step',
    (dt) => {
      const h = compositionFixture();
      for (const id of [7, 8, 9, 10]) h.damage(id);
      expect(h.sheets).toHaveBeenCalledTimes(4);
      expect(h.arcs.filter((a) => a.active)).toHaveLength(12);
      for (let t = 0; t < 0.3; t += dt) h.fx.update(dt);
      expect(h.paths).toHaveBeenCalledTimes(20);
      expect(h.paths.mock.results.every((r) => r.value === true)).toBe(true);
      expect(h.sheets).toHaveBeenCalledTimes(4);
      expect(h.contact.mock.calls.map((c) => c[1])).toEqual([7, 8, 9, 10]);
      h.fx.update(1);
      expect(h.arcs.some((a) => a.active)).toBe(false);
      h.fx.dispose();
    },
  );

  it.each(['miss', 'resist', 'dodge', 'parry', 'immune'])(
    '%s cannot fabricate a receiving impact',
    (kind) => {
      const h = compositionFixture();
      expect(h.damage(7, { kind, amount: 0 })).toBe(true);
      h.fx.update(0.2);
      for (const material of [h.paths, h.sheets, h.burst, h.fragments, h.water, h.baked, h.contact])
        expect(material).not.toHaveBeenCalled();
      expect(h.arcs.some((arc) => arc.active)).toBe(false);
      h.fx.dispose();
    },
  );

  it('zero damage with no absorption and an explicit zero outcome create no impact material', () => {
    const h = compositionFixture();
    expect(h.damage(7, { amount: 0 })).toBe(true);
    expect(
      h.fx.sequenceShamanContact(
        'chain_lightning',
        SHAMAN_VFX_FULL_SPECS.chain_lightning,
        1,
        7,
        0,
        0,
      ),
    ).toBe(false);
    for (const material of [h.paths, h.sheets, h.burst, h.fragments, h.water, h.baked, h.contact])
      expect(material).not.toHaveBeenCalled();
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
    h.fx.dispose();
  });

  it('an absorbed outcome catches on the real ward without body contact or material ejecta', () => {
    const h = compositionFixture();
    expect(h.damage(8, { amount: 0, absorbed: 40 })).toBe(true);
    expect(h.sheets).toHaveBeenCalledTimes(1);
    expect(h.sheets.mock.calls[0].slice(0, 3)).toEqual(h.anchor(8, 0.5)?.toArray());
    expect(h.burst).toHaveBeenCalledTimes(1);
    for (const material of [h.paths, h.fragments, h.water, h.baked, h.contact])
      expect(material).not.toHaveBeenCalled();
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
    h.fx.dispose();
  });

  it('never paints a neighbouring target when the actual recipient anchor is absent', () => {
    const h = compositionFixture();
    const resolve = h.anchor.getMockImplementation()!;
    h.anchor.mockImplementation((id, fraction, out) =>
      id === 8 ? null : resolve(id, fraction, out),
    );
    expect(h.damage(8)).toBe(true);
    for (const material of [h.paths, h.sheets, h.burst, h.fragments, h.water, h.baked, h.contact])
      expect(material).not.toHaveBeenCalled();
    h.fx.dispose();
  });
});
