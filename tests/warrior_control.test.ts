import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { OVERLAY_CELL } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { holdWarriorControlMark } from '../src/render/ability_vfx/warrior_control_marks';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { ABILITIES } from '../src/sim/data';

function fixture() {
  const paths: THREE.Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out = { x: 0, y: 0, z: 0 }) =>
        Object.assign(out, { x: id * 3, y: frac * 2, z: 0 }),
      groundYAt: () => 0,
      pathRibbon: vi.fn(
        (_c: number, _w: number, _d: number, fill: (points: THREE.Vector3[]) => number) => {
          const points = Array.from({ length: 32 }, () => new THREE.Vector3());
          fill(points);
          paths.push(points);
          return true;
        },
      ),
    } as unknown as SequencerHost,
    {
      get(target, key) {
        if (!(key in target)) (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn();
        return Reflect.get(target, key);
      },
    },
  );
  const seq = new ArchetypeSequencer();
  Object.assign(host, {
    disposed: false,
    sequencer: seq,
    queueWarriorControl: AbilityVfxFx.prototype.queueWarriorControl.bind(
      host as unknown as AbilityVfxFx,
    ),
  });
  const painter = new AbilityVfx(
    { fx: host, vfx: {}, triggerAttack: vi.fn() } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { host, painter, paths, seq };
}

it.each(['pummel', 'sunder_armor'])(
  '%s attempts animate without invented injury or armor loss',
  (id) => {
    const h = fixture();
    h.seq.start(h.host, id, WARRIOR_VFX_FULL_SPECS[id], 1, 2, 0xffffff, 1, false);
    h.seq.update(h.host, 0.16);
    expect(h.paths).toHaveLength(2);
    expect(h.host.fragmentsAt).not.toHaveBeenCalled();
    expect(h.host.contact).not.toHaveBeenCalled();
    expect(h.host.flipbookAt).not.toHaveBeenCalled();
    expect(h.host.burstAt).not.toHaveBeenCalled();
  },
);

it('claims zero-damage Armor Shear without a generic physical hit', () => {
  const h = fixture();
  expect(
    h.painter.onDamage({
      sourceId: 1,
      targetId: 2,
      ability: ABILITIES.sunder_armor.name,
      kind: 'miss',
      amount: 0,
      school: 'physical',
      crit: false,
    }),
  ).toBe(true);
  expect(h.host.flipbookAt).not.toHaveBeenCalled();
  expect(h.host.contact).not.toHaveBeenCalled();
});

it('peels the actual recipient on an authoritative armor refresh, without damage feedback', () => {
  const h = fixture();
  expect(
    h.painter.onWarriorControlAura({
      type: 'aura',
      targetId: 2,
      sourceId: 1,
      name: 'Armor Shear',
      abilityId: 'sunder_armor',
      auraKind: 'sunder',
      gained: true,
      stacks: 3,
      refresh: true,
    }),
  ).toBe(true);
  h.seq.update(h.host, 0);
  expect(h.host.fragmentsAt).toHaveBeenCalledTimes(2);
  expect(vi.mocked(h.host.flipbookAt).mock.calls[0].slice(0, 3)).toEqual([6, 1.04, 0]);
  expect(h.host.contact).not.toHaveBeenCalled();
  expect(h.host.burstAt).not.toHaveBeenCalled();
});

it('only actual school lockout earns the Jawcrack spell-break accent', () => {
  const h = fixture();
  const ev = {
    type: 'aura' as const,
    targetId: 2,
    sourceId: 1,
    name: 'Jawcrack',
    abilityId: 'pummel',
    gained: true,
  };
  h.painter.onWarriorControlAura(ev);
  expect(h.paths).toHaveLength(0);
  h.painter.onWarriorControlAura({ ...ev, auraKind: 'lockout' });
  h.seq.update(h.host, 0);
  expect(h.paths).toHaveLength(2);
  expect(h.host.contact).not.toHaveBeenCalled();
  expect(h.host.fragmentsAt).not.toHaveBeenCalled();
  h.painter.onWarriorControlAura({ ...ev, auraKind: 'lockout', gained: false });
  expect(h.paths).toHaveLength(2);
});

it('Hobbling Cut places its authored surface on the lower receiving silhouette', () => {
  const h = fixture();
  h.seq.start(
    h.host,
    'hamstring',
    WARRIOR_VFX_FULL_SPECS.hamstring,
    1,
    2,
    0xffffff,
    1,
    false,
    0,
    undefined,
    1,
  );
  h.seq.update(h.host, 0.16);
  const surface = vi.mocked(h.host.crestAt!).mock.calls[0];
  expect(surface).toBeDefined();
  expect(surface[1]).toBeGreaterThan(0);
  expect(surface[1]).toBeLessThan(0.65);
  expect(surface[7]).toBe('blood_cut');
  expect(h.paths.flat().every((p) => p.y > 0)).toBe(true);
});

it('held control marks follow real stack changes and stop being renewed on expiry or death', () => {
  const orbit = vi.fn(),
    fx = { orbit } as unknown as AbilityVfxFx;
  // The shared armor instance may retain Expose Armor's id after a Warrior refresh.
  for (const stacks of [1, 3, 5])
    holdWarriorControlMark(
      fx,
      2,
      { id: 'expose_armor', kind: 'sunder', remaining: 20, stacks },
      true,
    );
  expect(orbit.mock.calls.map((call) => call[3].n)).toEqual([1, 3, 5]);
  expect(orbit.mock.calls.every((call) => call[1] === 'armorShear')).toBe(true);
  holdWarriorControlMark(fx, 2, { id: 'sunder_armor', kind: 'sunder', remaining: 0 }, true);
  holdWarriorControlMark(fx, 2, { id: 'sunder_armor', kind: 'sunder', remaining: 20 }, false);
  expect(orbit).toHaveBeenCalledTimes(3);
  holdWarriorControlMark(fx, 2, { id: 'hamstring_slow', kind: 'slow', remaining: 15 }, true);
  expect(orbit.mock.lastCall?.[1]).toBe('hamstringMark');
  expect(
    holdWarriorControlMark(fx, 2, { id: 'hamstring_slow', kind: 'stun', remaining: 15 }, true),
  ).toBe(false);
  expect(OVERLAY_CELL.armorShear0 + 4).toBeLessThan(OVERLAY_CELL.hamstring);
});

it('reads ordinary aura creation events, which omit auraKind, from the actual target snapshot', () => {
  const h = fixture();
  h.painter.onWarriorControlAura(
    {
      type: 'aura',
      targetId: 2,
      sourceId: 1,
      name: 'Jawcrack',
      abilityId: 'pummel_lockout',
      gained: true,
    },
    [{ id: 'pummel_lockout', kind: 'lockout', remaining: 4 }],
  );
  h.seq.update(h.host, 0);
  expect(h.paths).toHaveLength(2);
  h.painter.onWarriorControlAura(
    {
      type: 'aura',
      targetId: 2,
      sourceId: 1,
      name: 'Armor Shear',
      abilityId: 'sunder_armor',
      gained: true,
      stacks: 1,
    },
    [{ id: 'sunder_armor', kind: 'sunder', remaining: 30 }],
  );
  h.seq.update(h.host, 0);
  expect(h.host.fragmentsAt).toHaveBeenCalledTimes(2);
  expect(h.host.contact).not.toHaveBeenCalled();
});

it('keeps success on the native contact clock even when events precede snapshots', () => {
  const h = fixture();
  h.seq.start(h.host, 'pummel', WARRIOR_VFX_FULL_SPECS.pummel, 1, 2, 0xffffff, 1, false);
  h.painter.onWarriorControlAura(
    {
      type: 'aura',
      targetId: 2,
      sourceId: 1,
      name: 'Jawcrack',
      abilityId: 'pummel_lockout',
      gained: true,
    },
    [],
  );
  expect(h.paths).toHaveLength(0);
  h.seq.update(h.host, 0.1);
  expect(h.paths).toHaveLength(0);
  h.seq.update(h.host, 0.06);
  expect(h.paths).toHaveLength(4);
  expect(
    vi.mocked(h.host.abilityAudio!).mock.calls.filter((call) => call[0] === 'impact'),
  ).toHaveLength(1);
});
it('a late success paints only the receiving spell break without replaying the jab', () => {
  const h = fixture();
  h.seq.start(h.host, 'pummel', WARRIOR_VFX_FULL_SPECS.pummel, 1, 2, 0xffffff, 1, false);
  h.seq.update(h.host, 0.16);
  expect(h.paths).toHaveLength(2);
  expect(
    vi.mocked(h.host.abilityAudio!).mock.calls.filter((call) => call[0] === 'impact'),
  ).toHaveLength(0);
  h.painter.onWarriorControlAura(
    {
      type: 'aura',
      targetId: 2,
      sourceId: 1,
      name: 'Jawcrack',
      abilityId: 'pummel_lockout',
      gained: true,
    },
    [],
  );
  h.seq.update(h.host, 0);
  expect(h.paths).toHaveLength(4);
});
