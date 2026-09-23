import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import {
  AbilityVfx,
  type AbilityVfxDamageEvent,
  type AbilityVfxDeps,
} from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { shamanDamage } from '../src/render/ability_vfx/shaman_events';

const resources: { dispose(): void }[] = [];
afterEach(() => {
  for (const resource of resources.splice(0)) resource.dispose();
});

const echo: AbilityVfxDamageEvent = {
  ability: 'Galeheart Echo',
  abilityId: null,
  sourceId: 1,
  targetId: 2,
  school: 'nature',
  kind: 'hit',
  amount: 35,
  crit: false,
};

function fixture() {
  const texture = new THREE.Texture();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), () => null, {
    ribbon: texture,
    noise: texture,
  } as AbilityVfxTextures);
  resources.push(ribbons, texture);
  const actors = new Map([
    [1, { kind: 'player', templateId: 'shaman', x: 0, y: 1, z: 0 }],
    [2, { kind: 'mob', templateId: 'wolf', x: 10, y: 2, z: 8 }],
    [3, { kind: 'mob', templateId: 'wolf', x: -7, y: 2, z: 4 }],
    [4, { kind: 'mob', templateId: 'wolf', x: 6, y: 2, z: -9 }],
  ]);
  const anchorOf = vi.fn((id: number) => actors.get(id) ?? null);
  const burstAt = vi.fn();
  const release = vi.fn();
  const contact = vi.fn();
  const gesture = vi.fn();
  const fx = {
    disposed: false,
    ribbons,
    anchorOf,
    burstAt,
    pathRibbon: AbilityVfxFx.prototype.pathRibbon,
    setDelegates: vi.fn(),
    sequenceShamanRelease: release,
    sequenceShamanContact: contact,
  } as unknown as AbilityVfxFx;
  const isShaman = (id: number) => {
    const actor = actors.get(id);
    return actor?.kind === 'player' && actor.templateId === 'shaman';
  };
  const host = { fx, isShaman, variant: (id: string) => id, tier: () => 0, gesture };
  const painter = new AbilityVfx(
    {
      fx,
      isShaman,
      triggerAttack: gesture,
      vfx: {},
      anchor: anchorOf,
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  const arcs = (
    ribbons as unknown as {
      arcs: { active: boolean; pts: THREE.Vector3[]; priority: number }[];
    }
  ).arcs;
  return { host, painter, fx, actors, anchorOf, burstAt, release, contact, gesture, ribbons, arcs };
}

describe('Shaman weapon proc receiving accents', () => {
  it('presents two actual echoes in separate real ribbon slots without restarting the main cast', () => {
    const h = fixture();
    expect(h.painter.onDamage(echo)).toBe(true);
    expect(h.painter.onDamage(echo)).toBe(true);
    const active = h.arcs.filter((arc) => arc.active);
    expect(active).toHaveLength(2);
    expect(active[0].pts[0].y).not.toBe(active[1].pts[0].y);
    for (const arc of active) {
      expect(arc.priority).toBe(0);
      for (const point of arc.pts)
        expect(point.distanceTo(new THREE.Vector3(10, 2, 8))).toBeLessThan(1);
    }
    expect(h.burstAt).toHaveBeenCalledTimes(2);
    expect(h.gesture).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
    expect(h.contact).not.toHaveBeenCalled();
    h.ribbons.update(0.02, new THREE.Vector3(0, 4, 20), true);
    expect(
      (h.ribbons as unknown as { mesh: THREE.Mesh }).mesh.geometry.drawRange.count,
    ).toBeGreaterThan(0);
    h.ribbons.update(0.2, new THREE.Vector3(0, 4, 20), true);
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
  });

  it('uses the exact two real cleave victims instead of adding an area explosion or invented targets', () => {
    const h = fixture();
    for (const targetId of [3, 3, 4, 4])
      expect(shamanDamage(h.host, { ...echo, ability: 'Living Weapon', targetId })).toBe(true);
    expect(h.arcs.filter((arc) => arc.active)).toHaveLength(4);
    expect(h.burstAt.mock.calls.map((args) => args.slice(0, 3))).toEqual([
      [-7, 2, 4],
      [-7, 2, 4],
      [6, 2, -9],
      [6, 2, -9],
    ]);
    expect(h.contact).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'hit', amount: 35, absorbed: 0, paths: 1, bursts: 1 },
    { kind: 'block', amount: 10, absorbed: 5, paths: 1, bursts: 1 },
    { kind: 'hit', amount: 0, absorbed: 35, paths: 0, bursts: 1 },
    { kind: 'block', amount: 0, absorbed: 35, paths: 0, bursts: 1 },
    { kind: 'hit', amount: 0, absorbed: 0, paths: 0, bursts: 0 },
    { kind: 'block', amount: 0, absorbed: 0, paths: 0, bursts: 0 },
    { kind: 'miss', amount: 35, absorbed: 35, paths: 0, bursts: 0 },
    { kind: 'resist', amount: 35, absorbed: 35, paths: 0, bursts: 0 },
    { kind: 'dodge', amount: 35, absorbed: 35, paths: 0, bursts: 0 },
    { kind: 'parry', amount: 35, absorbed: 35, paths: 0, bursts: 0 },
  ])('honors the actual outcome $kind / $amount / $absorbed', ({ paths, bursts, ...outcome }) => {
    const h = fixture();
    expect(shamanDamage(h.host, { ...echo, ...outcome })).toBe(true);
    expect(h.arcs.filter((arc) => arc.active)).toHaveLength(paths);
    expect(h.burstAt).toHaveBeenCalledTimes(bursts);
    if (bursts && !paths)
      expect(h.burstAt.mock.calls[0].slice(4)).toEqual([3, 0.16, 'sparks', 0.13]);
    expect(h.contact).not.toHaveBeenCalled();
  });

  it.each([
    { ability: 'galeheart echo' },
    { ability: 'Living Weapon Bonus' },
    { school: 'physical' },
    { abilityId: 'unknown_proc' },
    { abilityId: 'frostbolt' },
    { sourceId: 99 },
    { sourceId: 2 },
  ])('rejects unproven proc ownership: %j', (change) => {
    const h = fixture();
    expect(shamanDamage(h.host, { ...echo, ...change })).toBe(false);
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
    expect(h.burstAt).not.toHaveBeenCalled();
  });

  it('requires a Shaman player source and retains an explicit real ability owner', () => {
    const h = fixture();
    h.actors.get(1)!.templateId = 'warrior';
    expect(shamanDamage(h.host, echo)).toBe(false);
    h.actors.get(1)!.templateId = 'shaman';
    h.actors.get(1)!.kind = 'mob';
    expect(shamanDamage(h.host, echo)).toBe(false);
    h.actors.get(1)!.kind = 'player';
    expect(shamanDamage(h.host, { ...echo, abilityId: 'earth_shock' })).toBe(true);
    expect(h.contact).toHaveBeenCalledTimes(1);
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
    expect(shamanDamage({ ...h.host, isShaman: undefined }, echo)).toBe(false);
  });

  it('does not redirect an absent victim and drops ribbons safely when the fixed pool is full', () => {
    const h = fixture();
    expect(shamanDamage(h.host, { ...echo, targetId: 99 })).toBe(true);
    expect(h.burstAt).not.toHaveBeenCalled();
    expect(h.arcs.some((arc) => arc.active)).toBe(false);
    for (let i = 0; i < 20; i++) shamanDamage(h.host, echo);
    const saved = h.arcs.map((arc) => arc.pts.map((point) => point.clone()));
    shamanDamage(h.host, { ...echo, targetId: 3 });
    expect(h.arcs).toHaveLength(20);
    expect(h.arcs.map((arc) => arc.pts)).toEqual(saved);
    expect(h.burstAt.mock.calls.at(-1)?.slice(0, 3)).toEqual([-7, 2, 4]);
    expect(h.contact).not.toHaveBeenCalled();
  });
});
