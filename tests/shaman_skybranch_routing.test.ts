import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { ArchetypeSequencer, type SeqPoint } from '../src/render/ability_vfx/sequencer';
import { shamanCast, shamanDamage } from '../src/render/ability_vfx/shaman_events';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

function fixture() {
  // Exercise real routing and sequencer release with CPU-only primitive sinks.
  const launch = vi.fn(),
    paths = vi.fn(),
    contact = vi.fn(),
    link = vi.fn(),
    burst = vi.fn();
  const hands = vi.fn((_id: number, _hand: number, out: SeqPoint) =>
    Object.assign(out, { x: 2, y: 1, z: 1 }),
  );
  const anchor = vi.fn((id: number, fraction: number, out = new THREE.Vector3()) =>
    out.set(id * 3, fraction * 2, 5),
  );
  const fx = Object.assign(Object.create(AbilityVfxFx.prototype), {
    disposed: false,
    sequencer: new ArchetypeSequencer(),
    ribbons: { spawnTrailStyled: launch },
    anchor,
    anchorOf: (id: number, fraction: number, out: SeqPoint = { x: 0, y: 0, z: 0 }) =>
      Object.assign(out, { x: id * 3, y: fraction * 2, z: 5 }),
    handPoint: hands,
    pathRibbon: paths,
    burstAt: burst,
    abilityAudio: vi.fn(),
    countPrimitive: vi.fn(),
    sequenceShamanContact: contact,
    boltPoints: link,
  }) as AbilityVfxFx;
  const host = { fx, variant: (id: string) => id, tier: () => 0, gesture: vi.fn() };
  const cue = {
    sourceId: 1,
    targetId: 7,
    ability: 'chain_lightning',
    school: 'nature',
    fx: 'projectile',
  } as const;
  return { fx, host, cue, launch, paths, contact, link, burst, hands, anchor };
}

describe('Skybranch launch and confirmed-hop ownership', () => {
  it('keeps the initial caster performance without a hand comet, discharge, or predicted sky impact', () => {
    const h = fixture();
    expect(shamanCast(h.host, h.cue)).toBe(true);
    expect(h.host.gesture).toHaveBeenCalledWith(1, 'chain_lightning');
    expect(h.burst).toHaveBeenCalledOnce();
    expect(h.burst.mock.calls[0].slice(0, 3)).toEqual([2, 1, 1]);
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.paths).not.toHaveBeenCalled();
    expect(h.contact).not.toHaveBeenCalled();
    expect(h.link).not.toHaveBeenCalled();
  });

  it('suppresses the resolved caster link but retains only actual victim-to-victim relays', () => {
    const h = fixture();
    shamanCast(h.host, { ...h.cue, level: 0 });
    expect(h.link).not.toHaveBeenCalled();
    expect(h.hands).not.toHaveBeenCalled();
    expect(h.anchor).not.toHaveBeenCalled();
    shamanCast(h.host, { ...h.cue, sourceId: 7, targetId: 9, level: 1 });
    expect(h.link).toHaveBeenCalledExactlyOnceWith(
      21,
      1,
      5,
      27,
      1,
      5,
      expect.any(Number),
      0.16,
      0.11,
      0.85,
    );
    expect(h.hands).not.toHaveBeenCalled();
    expect(h.host.gesture).not.toHaveBeenCalled();
    expect(h.contact).not.toHaveBeenCalled();
  });

  it('waits for successful damage before submitting the actual recipient sky contact', () => {
    const h = fixture();
    const damage = {
      sourceId: 1,
      targetId: 7,
      abilityId: 'chain_lightning',
      ability: 'Skybranch',
      school: 'nature',
      amount: 0,
      crit: false,
      kind: 'resist' as const,
    };
    shamanCast(h.host, h.cue);
    shamanCast(h.host, { ...h.cue, level: 0 });
    shamanDamage(h.host, damage);
    expect(h.contact).not.toHaveBeenCalled();
    shamanDamage(h.host, { ...damage, amount: 42, kind: 'hit' });
    expect(h.contact).toHaveBeenCalledExactlyOnceWith(
      'chain_lightning',
      SHAMAN_VFX_FULL_SPECS.chain_lightning,
      1,
      7,
      0,
      1,
    );
  });

  it.each(['lightning_bolt', 'flame_shock', 'frost_shock'])(
    'preserves the authored hand projectile for %s',
    (id) => {
      const h = fixture();
      expect(h.fx.sequenceShamanRelease(id, SHAMAN_VFX_FULL_SPECS[id], 1, 7, 0)).toBe(true);
      expect(h.launch).toHaveBeenCalledOnce();
      const origin = new THREE.Vector3();
      expect(h.launch.mock.calls[0][4].sourceAnchor(1, origin)).toBe(true);
      expect(origin.toArray()).toEqual([2, 1, 1]);
      expect(h.contact).not.toHaveBeenCalled();
      if (id === 'lightning_bolt') expect(h.paths).toHaveBeenCalledOnce();
    },
  );
});
