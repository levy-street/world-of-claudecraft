import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEVOTION_KINDS,
  DEVOTION_LIFE,
  DEVOTION_WAVE_SPEED,
  DevotionRings,
  isDevotionKind,
} from '../src/render/ability_vfx/devotion_rings';
import { AbilityVfx } from '../src/render/ability_vfx/painter';

function fixture() {
  const scene = new THREE.Scene();
  // The Paladin (1) at the origin; party members 2 and 3 at 4.4 and 11 yards.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [4.4, 0]],
    [3, [0, 11]],
  ]);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], height * 1.8, at[1]) : null;
  });
  const effect = new DevotionRings(scene, anchor, () => 0);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const rings = () => {
    const g = effect.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const position = g.getAttribute('position');
    const out: { shape: number; x: number; z: number }[] = [];
    for (let i = 0; i < g.drawRange.count; i += 6) {
      if (shape.getX(i) > 4.5) continue;
      let x = 0,
        z = 0;
      for (let k = 0; k < 6; k++) {
        x += position.getX(i + k) / 6;
        z += position.getZ(i + k) / 6;
      }
      out.push({ shape: shape.getX(i), x, z });
    }
    return out;
  };
  return {
    effect,
    scene,
    rings,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

describe('Requital Aura and the Devotions', () => {
  it('knows the five party auras', () => {
    expect([...DEVOTION_KINDS].sort()).toEqual(
      [
        'dawn_devotion',
        'devotion_ward',
        'grace_devotion',
        'radiant_devotion',
        'retribution_aura',
      ].sort(),
    );
    expect(isDevotionKind('dawn_devotion')).toBe(true);
    expect(isDevotionKind('hushbrand')).toBe(false);
    expect(isDevotionKind(undefined)).toBe(false);
  });

  it('rings each party member at their feet, spreading from the Paladin as a wave', async () => {
    const f = fixture();
    expect(f.effect.spawn('dawn_devotion', 1, 1)).toBe(false);
    await f.prepare();
    for (const id of [1, 2, 3]) expect(f.effect.spawn('dawn_devotion', id, 1)).toBe(true);
    f.effect.update(0.05);
    // Only the Paladin's own ring is up at once; the wave reaches the others in turn.
    expect(f.rings()).toHaveLength(1);
    expect(f.rings()[0].x).toBeCloseTo(0);
    for (let t = 0.05; t < 4.4 / DEVOTION_WAVE_SPEED + 0.05; t += 0.05) f.effect.update(0.05);
    expect(f.rings()).toHaveLength(2);
    for (let t = 0; t < 11 / DEVOTION_WAVE_SPEED; t += 0.05) f.effect.update(0.05);
    const rings = f.rings();
    expect(rings).toHaveLength(3);
    // Every ring is the Dawn figure, under its member.
    expect(new Set(rings.map((r) => r.shape))).toEqual(
      new Set([DEVOTION_KINDS.indexOf('dawn_devotion')]),
    );
    expect(rings.some((r) => Math.abs(r.z - 11) < 0.01)).toBe(true);
    // Temporary: all gone after their life.
    for (let t = 0; t < DEVOTION_LIFE + 0.2; t += 0.05) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('gives each aura its own ring figure, and a recast refreshes rather than stacks', async () => {
    const f = fixture();
    await f.prepare();
    DEVOTION_KINDS.forEach((kind, i) => {
      f.effect.clear();
      f.effect.spawn(kind, 1, 1);
      f.effect.update(0.2);
      expect(f.rings().map((r) => r.shape)).toEqual([i]);
    });
    f.effect.spawn('grace_devotion', 1, 1);
    f.effect.update(0.2);
    expect(f.rings()).toHaveLength(1);
    f.effect.dispose();
  });

  it('casts with the off-hand sigil and claims each aura application for its ring', () => {
    const fx = { castPaladinShieldSigil: vi.fn(), devotionRing: vi.fn() };
    const releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx },
      releaseGesture,
    }) as AbilityVfx;
    expect(
      p.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'holy',
        fx: 'selfCast',
        ability: 'grace_devotion',
      }),
    ).toBe(true);
    expect(releaseGesture).toHaveBeenCalledExactlyOnceWith(1, 'grace_devotion');
    expect(fx.castPaladinShieldSigil).toHaveBeenCalledExactlyOnceWith(1);
    const aura = {
      type: 'aura',
      targetId: 3,
      name: 'Requital Aura',
      sourceId: 1,
      abilityId: 'retribution_aura',
    } as const;
    expect(p.onWarriorControlAura({ ...aura, gained: true })).toBe(true);
    expect(p.onWarriorControlAura({ ...aura, gained: false })).toBe(true);
    expect(fx.devotionRing).toHaveBeenCalledExactlyOnceWith('retribution_aura', 3, 1);
  });

  it("answers Requital Aura's reflected blow with a spark on the attacker, not a recast", () => {
    const burst = vi.fn();
    const sequenceInstant = vi.fn();
    const anchor = vi.fn(() => ({ x: 1, y: 2, z: 3 }));
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx: { sequenceInstant }, vfx: { burst }, anchor },
    }) as AbilityVfx;
    // The defender (1) reflects onto the attacker (7); only the name rides it.
    const hit = {
      sourceId: 1,
      targetId: 7,
      school: 'holy',
      ability: 'Requital Aura',
      amount: 12,
      kind: 'hit',
      crit: false,
    };
    expect(p.onDamage(hit)).toBe(true);
    expect(anchor).toHaveBeenCalledWith(7, 0.55);
    expect(burst).toHaveBeenCalledOnce();
    expect(sequenceInstant).not.toHaveBeenCalled();
    // A blow fully avoided shows nothing.
    expect(p.onDamage({ ...hit, amount: 0, kind: 'miss' })).toBe(true);
    expect(burst).toHaveBeenCalledOnce();
  });
});
