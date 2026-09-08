import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  AbilityVfx,
  type AbilityVfxDeps,
  type AbilityVfxEntityState,
} from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { buildWarriorArea } from '../src/render/ability_vfx/warrior_area_shapes';
import { damageEventStartsAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { ABILITIES } from '../src/sim/data';

function harness() {
  const seq = new ArchetypeSequencer();
  const paths: THREE.Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out = { x: 0, y: 0, z: 0 }) =>
        Object.assign(out, { x: id * 3, y: frac * 2, z: 0 }),
      groundYAt: () => 0,
      facingAt: () => 0,
      pathRibbon: vi.fn(
        (_c: number, _w: number, _d: number, fill: (points: THREE.Vector3[]) => number) => {
          const points = Array.from({ length: 60 }, () => new THREE.Vector3());
          fill(points);
          paths.push(points);
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
  Object.assign(host, { disposed: false, sequencer: seq });
  (host as unknown as { sequenceWarriorAreaContact: unknown }).sequenceWarriorAreaContact = vi.fn(
    AbilityVfxFx.prototype.sequenceWarriorAreaContact.bind(host as unknown as AbilityVfxFx),
  );
  const attack = vi.fn(),
    audio = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: host,
      vfx: {},
      anchor: () => ({ x: 3, y: 0, z: 0 }),
      triggerAttack: attack,
      hasGestureClip: () => true,
      abilityAudio: audio,
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { host, paths, painter, attack, audio, seq };
}

it('draws one radial Reaping Arc and keeps recipient hits out of the caster performance', () => {
  const h = harness(),
    seq = h.seq;
  seq.start(h.host, 'cleave', WARRIOR_VFX_FULL_SPECS.cleave, 1, 1, 0xffffff, 0, false);
  // Real event order: the area cue and all damage arrive before presentation advances.
  for (const targetId of [2, 3, 4])
    expect(
      h.painter.onDamage({
        sourceId: 1,
        targetId,
        ability: ABILITIES.cleave.name,
        kind: 'hit',
        amount: 20,
        crit: false,
        school: 'physical',
      }),
    ).toBe(true);
  seq.update(h.host, 0.14);
  expect(h.host.flipbookAt).not.toHaveBeenCalled();
  expect(h.host.contact).not.toHaveBeenCalled();
  seq.update(h.host, 0.011);
  expect(h.paths).toHaveLength(6);
  const primary = h.paths[0];
  expect(Math.min(...primary.map((p) => p.x))).toBeLessThan(-1.5);
  expect(Math.max(...primary.map((p) => p.x))).toBeGreaterThan(7.5);
  expect(Math.min(...primary.map((p) => p.z))).toBeLessThan(-4.5);
  expect(Math.max(...primary.map((p) => p.z))).toBeGreaterThan(4.4);
  expect(h.host.crestAt).toHaveBeenCalledTimes(1);
  expect(h.host.flipbookAt).toHaveBeenCalledTimes(3);
  expect(h.host.crestAt).toHaveBeenCalledTimes(1);
  expect(h.attack).not.toHaveBeenCalled();
  expect(h.audio).not.toHaveBeenCalled();
});

it.each(['bladestorm', 'cleave'])('separates %s hit, absorption and avoidance', (id) => {
  const h = harness();
  for (const outcome of ['miss', 'dodge', 'parry'] as const)
    h.painter.onDamage({
      sourceId: 1,
      targetId: 2,
      ability: ABILITIES[id].name,
      kind: outcome,
      amount: 0,
      crit: false,
      school: 'physical',
    });
  expect(h.host.flipbookAt).not.toHaveBeenCalled();
  h.painter.onDamage({
    sourceId: 1,
    targetId: 2,
    ability: ABILITIES[id].name,
    kind: 'hit',
    amount: 0,
    absorbed: 50,
    crit: false,
    school: 'physical',
  });
  h.seq.update(h.host, 0.16);
  expect(vi.mocked(h.host.flipbookAt).mock.calls[0][5]).toBe('contact_crush');
  expect(h.host.contact).not.toHaveBeenCalled();
  h.painter.onDamage({
    sourceId: 1,
    targetId: 2,
    ability: ABILITIES[id].name,
    kind: 'hit',
    amount: 50,
    crit: false,
    school: 'physical',
  });
  h.seq.update(h.host, 0.16);
  expect(vi.mocked(h.host.flipbookAt).mock.calls[1][5]).toBe('contact_cut');
  expect(h.host.contact).toHaveBeenCalledTimes(1);
});

it('keeps the pending Reaping Arc sweep when same-frame recipients fill its shared pool', () => {
  const h = harness();
  const primary = h.seq.start(
    h.host,
    'cleave',
    WARRIOR_VFX_FULL_SPECS.cleave,
    1,
    1,
    0xffffff,
    0,
    false,
  )!;
  for (let targetId = 2; targetId <= 33; targetId++)
    expect(
      h.painter.onDamage({
        sourceId: 1,
        targetId,
        ability: ABILITIES.cleave.name,
        kind: 'hit',
        amount: 20,
        crit: false,
        school: 'physical',
      }),
    ).toBe(true);
  expect(primary.physicalSecondary).toBe(false);
  expect(primary.targetId).toBe(1);
  h.seq.update(h.host, 0.14);
  expect(h.host.contact).not.toHaveBeenCalled();
  h.seq.update(h.host, 0.011);
  expect(h.host.crestAt).toHaveBeenCalledTimes(1);
  expect(h.host.contact).toHaveBeenCalledTimes(23);
  expect(h.paths).toHaveLength(26);
});

it('claims an excess recipient without evicting any pending cast or playing early fallback', () => {
  const h = harness();
  for (let sourceId = 1; sourceId <= 24; sourceId++)
    h.seq.start(
      h.host,
      'cleave',
      WARRIOR_VFX_FULL_SPECS.cleave,
      sourceId,
      sourceId,
      0xffffff,
      0,
      false,
    );
  expect(
    h.painter.onDamage({
      sourceId: 1,
      targetId: 100,
      ability: ABILITIES.cleave.name,
      kind: 'hit',
      amount: 20,
      crit: false,
      school: 'physical',
    }),
  ).toBe(true);
  h.seq.update(h.host, 0.14);
  expect(h.host.flipbookAt).not.toHaveBeenCalled();
  h.seq.update(h.host, 0.011);
  expect(h.host.crestAt).toHaveBeenCalledTimes(24);
  expect(h.host.contact).not.toHaveBeenCalled();
});

it('uses live channel state before the first pulse and accepts the last pulse after state clears', () => {
  const h = harness();
  const state: AbilityVfxEntityState = {
    id: 1,
    castingAbility: 'bladestorm',
    castTotal: 2,
    castRemaining: 1.7,
    auras: [],
  };
  h.painter.syncEntity(state);
  expect(
    (h.host as unknown as { holdWarriorStorm: unknown }).holdWarriorStorm,
  ).toHaveBeenCalledWith(1, expect.closeTo(0.3, 6));
  expect(h.host.bakedAt).not.toHaveBeenCalled();
  state.castingAbility = null;
  state.castRemaining = 0;
  h.painter.syncEntity(state);
  for (let pulse = 0; pulse < 4; pulse++)
    expect(
      h.painter.handleSpellfxAt({
        sourceId: 1,
        ability: 'bladestorm',
        fx: 'nova',
        x: pulse * 2,
        z: 0,
        radius: 6,
        school: 'physical',
      }),
    ).toBe(true);
  expect(h.audio).toHaveBeenCalledTimes(4);
  expect(h.host.bakedAt).toHaveBeenCalledTimes(16);
  expect(h.host.crestAt).not.toHaveBeenCalled();
  expect(h.host.flipbookAt).not.toHaveBeenCalled();
  expect(h.attack).not.toHaveBeenCalled();
});

it('does not restart a blade action per victim or on the final channel pulse', () => {
  for (const castingAbility of ['bladestorm', null])
    for (const id of ['bladestorm', 'cleave'])
      expect(
        damageEventStartsAttackAnimation(
          { kind: 'player', castingAbility },
          null,
          false,
          ABILITIES[id].name,
          id,
        ),
      ).toBe(false);
  expect(
    damageEventStartsAttackAnimation({ kind: 'player', castingAbility: 'bladestorm' }, null, false),
  ).toBe(false);
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'player', castingAbility: null },
      null,
      false,
      ABILITIES.slam.name,
      'slam',
    ),
  ).toBe(true);
});

it.each(['steel_storm', 'steel_reap'] as const)(
  'ships finite solid %s geometry at the actual area scale',
  (kind) => {
    const geo = buildWarriorArea(kind);
    try {
      const positions = geo.getAttribute('position'),
        normals = geo.getAttribute('normal');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(Array.from(normals.array).every(Number.isFinite)).toBe(true);
      expect(geo.getIndex()!.count / 3).toBeLessThan(3000);
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      expect(box.max.x - box.min.x).toBeGreaterThan(kind === 'steel_storm' ? 10 : 9);
      expect(box.max.z - box.min.z).toBeGreaterThan(9);
      expect(box.max.y - box.min.y).toBeGreaterThan(0.5);
    } finally {
      geo.dispose();
    }
  },
);
