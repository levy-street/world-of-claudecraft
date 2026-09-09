import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { buildIronguardShape, ironguardPath } from '../src/render/ability_vfx/ironguard_shapes';
import {
  AbilityVfx,
  type AbilityVfxDeps,
  type AbilityVfxEntityState,
} from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorWornMark } from '../src/render/ability_vfx/warrior_worn_marks';
import { damageEventStartsAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { ABILITIES } from '../src/sim/data';

function fixture() {
  const seq = new ArchetypeSequencer(),
    paths: THREE.Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out = { x: 0, y: 0, z: 0 }) =>
        Object.assign(out, { x: id === 1 ? 0 : 1, y: frac * 2, z: id === 1 ? 0 : 1 }),
      groundYAt: (x: number, z: number) => x * 0.1 + z * 0.05,
      facingAt: () => 0,
      pathRibbon: vi.fn(
        (_c: number, _w: number, _d: number, fill: (points: THREE.Vector3[]) => number) => {
          const points = Array.from({ length: 60 }, () => new THREE.Vector3());
          fill(points);
          paths.push(points);
        },
      ),
      disposed: false,
      sequencer: seq,
      sequenceInstant: vi.fn().mockReturnValue(true),
    } as unknown as SequencerHost & Pick<AbilityVfxFx, 'orbit' | 'sequenceInstant'>,
    {
      get(target, key) {
        if (!(key in target)) (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn();
        return Reflect.get(target, key);
      },
    },
  );
  Object.assign(host, {
    sequenceWarriorAreaContact: AbilityVfxFx.prototype.sequenceWarriorAreaContact.bind(
      host as unknown as AbilityVfxFx,
    ),
  });
  const attack = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: host,
      vfx: {},
      triggerAttack: attack,
      hasGestureClip: () => true,
      localPlayerId: () => 1,
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { seq, host, paths, painter, attack };
}

it('claims Breachmaker before the renderer can add an immediate duplicate contact', () => {
  const h = fixture();
  expect(
    h.painter.onDamage({
      sourceId: 1,
      targetId: 2,
      ability: ABILITIES.breachmaker.name,
      abilityId: 'breachmaker',
      school: 'physical',
      kind: 'hit',
      amount: 20,
      crit: false,
    }),
  ).toBe(true);
});

it('preserves an absorbed Breachmaker collision after the real crowd budget saturates', () => {
  const h = fixture();
  const event = {
    sourceId: 2,
    targetId: 99,
    ability: ABILITIES.breachmaker.name,
    abilityId: 'breachmaker',
    school: 'physical' as const,
    kind: 'hit' as const,
    amount: 20,
    crit: false,
  };
  for (let sourceId = 2; sourceId < 47; sourceId++) h.painter.onDamage({ ...event, sourceId });
  const sequence = vi.mocked(h.host.sequenceInstant);
  sequence.mockClear();
  expect(h.painter.onDamage({ ...event, sourceId: 48, amount: 0, absorbed: 150 })).toBe(true);
  expect(sequence).toHaveBeenCalledTimes(1);
  expect(sequence.mock.calls[0][5]).toBe(1);
  expect(sequence.mock.calls[0][7]).toBe(2);
  const args = sequence.mock.calls[0];
  h.seq.start(h.host, args[0], args[1], args[2], args[3], args[4], args[5], false, 0, undefined, 2);
  h.seq.update(h.host, 0.151);
  expect(h.host.flipbookAt).toHaveBeenCalledTimes(1);
  expect(h.host.contact).not.toHaveBeenCalled();
  expect(h.host.crestAt).not.toHaveBeenCalled();
});

it('keeps every Faultline mesh vertex inside its actual frontal sector', () => {
  const geometry = buildIronguardShape('iron_fault'),
    p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    expect(Math.abs(Math.atan2(p.getX(i), p.getZ(i)))).toBeLessThanOrEqual(2.2 + 1e-6);
  geometry.dispose();
});

it.each(['iron_quake', 'iron_fault'] as const)(
  '%s has outward upper faces for stable material lighting',
  (kind) => {
    const geo = buildIronguardShape(kind),
      p = geo.getAttribute('position'),
      index = geo.getIndex()!;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    let upperFaces = 0;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(p, index.getX(i));
      b.fromBufferAttribute(p, index.getX(i + 1));
      c.fromBufferAttribute(p, index.getX(i + 2));
      if (Math.min(a.y, b.y, c.y) <= 0.05) continue;
      const normal = b.sub(a).cross(c.sub(a));
      if (Math.abs(normal.y) < 1e-6) continue;
      expect(normal.y).toBeGreaterThan(0);
      upperFaces++;
    }
    expect(upperFaces).toBeGreaterThan(50);
    geo.dispose();
  },
);

it('keeps worn marks within the existing eight-sprite allowance', () => {
  const push = vi.fn();
  drawWarriorWornMark({ push }, true, { x: 0, y: 1, z: 0 }, 1, 0, 0, 1);
  expect(push.mock.calls.length).toBeGreaterThan(0);
  expect(push.mock.calls.length).toBeLessThanOrEqual(8);
});

it('retains all twelve cold Quaking Blow paths through nine real recipient admissions', () => {
  const h = fixture(),
    texture = new THREE.Texture();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), () => null, {
    ribbon: texture,
    noise: texture,
  } as AbilityVfxTextures);
  h.host.pathRibbon = (c, w, d, fill, brushed, motion, preserve, priority) => {
    ribbons.spawnPath(c, w, d, fill, brushed, motion, preserve, false, priority);
  };
  try {
    h.seq.start(
      h.host,
      'thunder_clap',
      WARRIOR_VFX_FULL_SPECS.thunder_clap,
      1,
      1,
      0xffffff,
      0,
      false,
    );
    for (let targetId = 2; targetId <= 10; targetId++)
      h.painter.onDamage({
        sourceId: 1,
        targetId,
        ability: ABILITIES.thunder_clap.name,
        school: 'physical',
        kind: 'hit',
        amount: 20,
        crit: false,
      });
    h.seq.update(h.host, 0.151);
    const probe = ribbons as unknown as { arcs: { active: boolean; pts: THREE.Vector3[] }[] };
    const outer = probe.arcs.filter(
      (a) => a.active && Math.hypot(a.pts.at(-1)!.x, a.pts.at(-1)!.z) > 7.99,
    );
    expect(outer).toHaveLength(12);
    expect(h.host.flipbookAt).toHaveBeenCalledTimes(10);
  } finally {
    ribbons.dispose();
    texture.dispose();
  }
});

it.each(['revenge', 'thunder_clap', 'faultline'])(
  '%s keeps one cast footprint and delays only actual recipient outcomes',
  (id) => {
    const h = fixture();
    h.seq.start(h.host, id, WARRIOR_VFX_FULL_SPECS[id], 1, 1, 0xffffff, 0, false);
    for (const [targetId, kind, amount, absorbed] of [
      [2, 'hit', 20, 0],
      [3, 'hit', 0, 20],
      [4, 'dodge', 0, 0],
    ] as const)
      expect(
        h.painter.onDamage({
          sourceId: 1,
          targetId,
          ability: ABILITIES[id].name,
          school: 'physical',
          kind,
          amount,
          absorbed,
          crit: false,
        }),
      ).toBe(true);
    h.seq.update(h.host, 0.14);
    expect(h.host.flipbookAt).not.toHaveBeenCalled();
    expect(h.host.crestAt).not.toHaveBeenCalled();
    h.seq.update(h.host, 0.011);
    expect(h.host.crestAt).toHaveBeenCalledTimes(1);
    // Quake/Fault have one central ground collision as well as the two recipients.
    expect(h.host.flipbookAt).toHaveBeenCalledTimes(id === 'revenge' ? 2 : 3);
    expect(h.host.contact).toHaveBeenCalledTimes(1);
    expect(h.host.contact).toHaveBeenCalledWith(1, 2, 'physical', expect.any(Number), id, 0);
    h.seq.update(h.host, 0.6);
    expect(h.host.crestAt).toHaveBeenCalledTimes(1);
    expect(h.attack).not.toHaveBeenCalled();
    expect(
      damageEventStartsAttackAnimation({ kind: 'player' }, null, false, ABILITIES[id].name),
    ).toBe(false);
  },
);

it.each(['revenge', 'thunder_clap', 'faultline'])(
  '%s keeps its eight-yard silhouette when reduced to the lowest sequence tier',
  (id) => {
    const h = fixture();
    h.seq.start(h.host, id, WARRIOR_VFX_FULL_SPECS[id], 1, 1, 0xffffff, 1, false);
    h.seq.update(h.host, 0.151);
    expect(h.host.crestAt).toHaveBeenCalledTimes(1);
    const points = h.paths.flat();
    expect(Math.max(...points.map((p) => Math.hypot(p.x, p.z)))).toBeCloseTo(8, 5);
    expect(Math.min(...points.map((p) => p.x))).toBeLessThan(-6);
    expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(6);
    expect(Math.min(...points.map((p) => p.z))).toBeLessThan(id === 'thunder_clap' ? -7.9 : -4.6);
    if (id !== 'revenge')
      for (const p of points) expect(p.y).toBeCloseTo(h.host.groundYAt(p.x, p.z) + 0.045, 5);
  },
);

it('uses the actual broad frontal half-angle and bounded prepared geometry', () => {
  const p = { x: 0, y: 0, z: 0 };
  for (const kind of ['iron_counter', 'iron_fault'] as const) {
    ironguardPath(kind, 0, kind === 'iron_counter' ? 0 : 1, p);
    expect(Math.atan2(p.x, p.z)).toBeCloseTo(-2.2, 5);
    ironguardPath(kind, kind === 'iron_counter' ? 3 : 6, 1, p);
    expect(Math.atan2(p.x, p.z)).toBeCloseTo(2.2, 5);
  }
  for (const kind of ['iron_counter', 'iron_quake', 'iron_fault', 'breach_wedge'] as const) {
    const geometry = buildIronguardShape(kind);
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    expect(geometry.getIndex()!.count / 3).toBeLessThan(1000);
    geometry.dispose();
  }
});

it('wears source-owned vulnerability and real attack-speed burden without requiring damage', () => {
  const h = fixture();
  const entity: AbilityVfxEntityState = {
    id: 2,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: [
      { id: 'breachmaker_vuln', sourceId: 1, remaining: 8 },
      { id: 'thunder_clap_as', remaining: 10 },
    ],
  };
  h.painter.syncEntity(entity);
  expect(h.host.orbit).toHaveBeenCalledWith(2, 'breachMark', 0xe9ad79, undefined, 0);
  expect(h.host.orbit).toHaveBeenCalledWith(2, 'quakeBurden', 0x93bfdb, undefined, 0);
  vi.mocked(h.host.orbit).mockClear();
  h.painter.syncEntity({
    ...entity,
    auras: [{ id: 'breachmaker_vuln', sourceId: 3, remaining: 8 }],
  });
  expect(h.host.orbit).not.toHaveBeenCalled();
  h.painter.syncEntity({ ...entity, dead: true });
  expect(h.host.orbit).not.toHaveBeenCalled();
  h.painter.syncEntity({ ...entity, auras: [{ id: 'thunder_clap_as', remaining: 0 }] });
  expect(h.host.orbit).not.toHaveBeenCalled();
});
