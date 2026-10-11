// The cast gate's requirement masks (src/render/ability_vfx/cast_requirements.ts):
// the families a cast of each ability waits on. Every painter cast waits on the
// engine; a Warrior appearance also waits on the kit; no other class ever does.
// The walk below keeps the masks honest against the REAL painter and engine:
// every spec'd id, through every entry point the painter has, drawn with only
// its own families ready, must spawn and draw from nothing else.

import * as THREE from 'three';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
  loadGltf: vi.fn(() => new Promise(() => {})),
  releaseGltf: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));
vi.mock('../src/render/ability_vfx/production_assets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/render/ability_vfx/production_assets')>();
  return {
    ...actual,
    fragmentGeometry: vi.fn(() => new THREE.BoxGeometry(0.2, 0.2, 0.2)),
    // A resident sheet, so the baked layers can draw here at all.
    bakedTexture: vi.fn(() => new THREE.Texture()),
  };
});

import {
  castVfxRequirement,
  drawsWarriorKit,
  WARRIOR_KIT_REQUIREMENT,
} from '../src/render/ability_vfx/cast_requirements';
import type { AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../src/render/cast_vfx_family';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { ABILITIES } from '../src/sim/data';
import { abilityVfxSpecIds } from './helpers/ability_vfx_spec_ids';
import { castGateRig } from './helpers/cast_vfx_headless';

const IDS = abilityVfxSpecIds();

describe('the requirement masks', () => {
  it('walks the whole spec union', () => {
    expect(IDS.length).toBeGreaterThan(300);
    for (const id of ['fireball', 'heroic_strike', 'chaos_bolt', 'emberkin_felbolt'])
      expect(IDS).toContain(id);
  });

  it('asks every id for the engine, and the kit exactly for the Warrior appearances', () => {
    const wrong: string[] = [];
    for (const id of IDS) {
      const mask = castVfxRequirement(id);
      const warrior =
        ABILITIES[id]?.class === 'warrior' || Object.hasOwn(WARRIOR_VFX_FULL_SPECS, id);
      if ((mask & CAST_VFX_ENGINE) === 0) wrong.push(`${id}: no engine`);
      if (((mask & CAST_VFX_KIT) !== 0) !== warrior) wrong.push(`${id}: kit ${!warrior}`);
      if ((mask & ~(CAST_VFX_ENGINE | CAST_VFX_KIT)) !== 0) wrong.push(`${id}: unknown family`);
    }
    expect(wrong).toEqual([]);
  });

  it('never makes another class wait on the kit', () => {
    const kit = IDS.filter((id) => drawsWarriorKit(id));
    expect(kit.length).toBeGreaterThan(20);
    expect(kit.filter((id) => ABILITIES[id] && ABILITIES[id].class !== 'warrior')).toEqual([]);
    expect(castVfxRequirement('fireball')).toBe(CAST_VFX_ENGINE);
    expect(castVfxRequirement('heroic_strike')).toBe(WARRIOR_KIT_REQUIREMENT);
    expect(WARRIOR_KIT_REQUIREMENT).toBe(CAST_VFX_ENGINE | CAST_VFX_KIT);
  });

  it('answers an id with no spec with the engine alone', () => {
    expect(castVfxRequirement('no_such_ability_for_the_gate')).toBe(CAST_VFX_ENGINE);
  });
});

const CAST_KINDS = [
  'projectile',
  'heavyBolt',
  'lightning',
  'windup',
  'shout',
  'nova',
  'tick',
  'beam',
  'selfCast',
  'flourish',
  'weaponAura',
] as const;
const POINT_KINDS = ['nova', 'burst', 'tick'] as const;
const AURA_KINDS = [
  undefined,
  'buff',
  'dot',
  'absorb',
  'slow',
  'root',
  'stun',
  // The Warrior state kinds the per-frame holds match on (power forms, Fury
  // states, blade charges).
  'buff_avatar',
  'buff_reckless',
  'buff_dr',
  'enrage',
  'aoe_echo',
  'overpower_charge',
] as const;
/** Warrior state auras held per frame whose ids are no spec id: walked on
 *  the Warrior-only hold mask. */
const WARRIOR_STATE_AURA_IDS = ['fury_enrage', 'bladed_echo'] as const;
const WARRIOR_CASTER = 1;
const OTHER_CASTER = 5;
const VICTIM = 9;
const IDLE_FRAMES = 20;
const MAX_FRAMES = 240;

type Rig = ReturnType<typeof castGateRig>;

/** Forces the degrade tier the painter plans at (0 or 1), for every cast. */
function forceTier(rig: Rig, tier: 0 | 1): void {
  (rig.painter as unknown as { budget: unknown }).budget = {
    admit: () => tier,
    peek: () => tier,
    admitAccent: () => true,
  };
}

/** Steps until nothing gated has drawn for IDLE_FRAMES frames. */
function drain(rig: Rig, perFrame?: (frame: number) => void, heldFrames = 0): void {
  let idle = 0;
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    if (frame < heldFrames) perFrame?.(frame);
    const seen = rig.step();
    idle = seen === 0 && frame >= heldFrames ? idle + 1 : 0;
    if (idle >= IDLE_FRAMES) return;
  }
}

interface Walked {
  runs: number;
  claimed: number;
  /** Runs whose pools drew engine pieces, and runs that reached a kit pool. */
  drewEngine: number;
  reachedKit: number;
  failures: string[];
  /** Runs that drew anything, per entry point. */
  drewBy: Map<string, number>;
}

const walkedNone = (): Walked => ({
  runs: 0,
  claimed: 0,
  drewEngine: 0,
  reachedKit: 0,
  failures: [],
  drewBy: new Map(),
});

function walkId(
  rig: Rig,
  id: string,
  tier: 0 | 1,
  walked: Walked,
  mask = castVfxRequirement(id),
): void {
  const caster = drawsWarriorKit(id) || (mask & CAST_VFX_KIT) !== 0 ? WARRIOR_CASTER : OTHER_CASTER;
  const run = (label: string, act: () => unknown, perFrame?: (f: number) => void, held = 0) => {
    rig.reset();
    forceTier(rig, tier);
    const before = rig.readiness.snapshot().requirementMiss;
    if (act()) walked.claimed++;
    drain(rig, perFrame, held);
    walked.runs++;
    if (rig.drawn() & CAST_VFX_ENGINE) walked.drewEngine++;
    if (rig.drawn()) walked.drewBy.set(label, (walked.drewBy.get(label) ?? 0) + 1);
    if (rig.asked() & CAST_VFX_KIT) walked.reachedKit++;
    const miss = rig.readiness.snapshot().requirementMiss - before;
    const outside = (rig.asked() | rig.drawn()) & ~mask;
    if (outside || miss)
      walked.failures.push(`${id} ${label} tier ${tier}: outside ${outside}, miss ${miss}`);
  };
  for (const fx of CAST_KINDS)
    for (const target of [caster, VICTIM])
      run(`spellfx ${fx} -> ${target === caster ? 'self' : 'other'}`, () =>
        rig.painter.handleSpellfx({
          sourceId: caster,
          targetId: target,
          school: 'fire',
          fx,
          ability: id,
        }),
      );
  run('channel ticks', () => {
    let claimed = false;
    for (let tick = 0; tick < 3; tick++) {
      claimed ||= rig.painter.handleSpellfx({
        sourceId: caster,
        targetId: VICTIM,
        school: 'shadow',
        fx: 'beam',
        ability: id,
      });
      rig.step(20);
    }
    return claimed;
  });
  for (const fx of POINT_KINDS)
    run(`spellfxAt ${fx}`, () =>
      rig.painter.handleSpellfxAt({
        x: 2,
        z: -3,
        school: 'fire',
        fx,
        ability: id,
        radius: 6,
        sourceId: caster,
      }),
    );
  for (const crit of [false, true])
    for (const absorbed of [false, true])
      run(`damage crit ${crit} absorbed ${absorbed}`, () =>
        rig.painter.onDamage({
          sourceId: caster,
          targetId: VICTIM,
          school: 'physical',
          // The wire carries the display name; the id rides beside it.
          ability: ABILITIES[id]?.name ?? id,
          abilityId: id,
          kind: 'hit',
          crit,
          amount: absorbed ? 0 : 90,
          absorbed: absorbed ? 40 : undefined,
        }),
      );
  run(
    'cast bar',
    () => false,
    (frame) =>
      rig.painter.syncEntity({
        id: caster,
        castingAbility: id,
        castRemaining: 1 - frame / 20,
        castTotal: 1,
        auras: [],
      }),
    20,
  );
  const worn = (label: string, aura: AbilityVfxEntityState['auras'][number]) =>
    run(
      label,
      () => false,
      () =>
        rig.painter.syncEntity({
          id: VICTIM,
          castingAbility: null,
          castRemaining: 0,
          castTotal: 0,
          auras: [aura],
        }),
      12,
    );
  const aura = { remaining: 20, duration: 30, value: 50, stacks: 2, charges: 2, sourceId: caster };
  for (const kind of AURA_KINDS) worn(`aura ${kind ?? 'none'}`, { ...aura, id, kind });
  // The victim-worn ids: a snare or root the sim applies as `<id>_slow` or
  // `<id>_root`, read through the spec's debuff block.
  worn('aura worn slow', { ...aura, id: `${id}_slow`, kind: 'slow' });
  worn('aura worn root', { ...aura, id: `${id}_root`, kind: 'root' });
  // The shared fear id, read as Intimidating Shout once its talent armed a
  // break threshold.
  if (id === 'intimidating_shout')
    worn('aura fear break', {
      ...aura,
      id: 'fear_incap',
      kind: 'incapacitate',
      breakThreshold: 0.3,
    });
  run(
    'queued swing',
    () => false,
    () =>
      rig.painter.syncEntity({
        id: caster,
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
        auras: [],
        queuedOnSwing: id,
      }),
    12,
  );
}

/** A rig with only `mask`'s families proved, equipped so the kit's solid
 *  pieces can draw; `local` makes the caster of that mask the local player. */
function walkRig(mask: number, local = false, askedMask?: (mask: number) => number): Rig {
  // No deadline: a forced family would let a spawn outside the mask through
  // uncounted.
  const rig = castGateRig({
    deadlineMs: Number.POSITIVE_INFINITY,
    equipped: true,
    askedMask,
    localPlayerId: local
      ? (mask & CAST_VFX_KIT) !== 0
        ? WARRIOR_CASTER
        : OTHER_CASTER
      : undefined,
  });
  rig.warriors.add(WARRIOR_CASTER);
  rig.prove(mask);
  return rig;
}

describe('the requirement walk over the real painter', () => {
  const walked = walkedNone();
  const local = walkedNone();
  // One rig per requirement: only a mask's own families are ever proved, so
  // a spawn outside it is refused and counted, exactly as in a live frame.
  const rigs = new Map<string, Rig>();
  const rigFor = (mask: number, local = false): Rig => {
    const key = `${mask}:${local}`;
    let rig = rigs.get(key);
    if (!rig) {
      rig = walkRig(mask, local);
      rigs.set(key, rig);
    }
    return rig;
  };
  afterAll(() => vi.unstubAllGlobals());

  for (const tier of [0, 1] as const) {
    it(`spawns and draws only from each id's own families, tier ${tier}`, () => {
      for (const id of IDS) walkId(rigFor(castVfxRequirement(id)), id, tier, walked);
      for (const id of WARRIOR_STATE_AURA_IDS)
        walkId(rigFor(WARRIOR_KIT_REQUIREMENT), id, tier, walked, WARRIOR_KIT_REQUIREMENT);
      expect(walked.failures).toEqual([]);
    });
  }

  // The painter plans a local caster's casts apart (its own tier bias, crit
  // feedback, a guaranteed windup slot), so the walk runs once more as them.
  it("spawns and draws only from each id's own families as the local player's cast", () => {
    for (const id of IDS) walkId(rigFor(castVfxRequirement(id), true), id, 0, local);
    expect(local.failures).toEqual([]);
    expect(local.drewEngine).toBeGreaterThan(IDS.length * 20);
  });

  it('fails a Warrior id admitted on the engine alone (the walk can see a wrong mask)', () => {
    // A resolver that forgot the kit: the painter asks for the engine only,
    // so the Warrior casts are admitted with the kit shut.
    const control = walkedNone();
    const rig = walkRig(CAST_VFX_ENGINE, false, (mask) => mask & ~CAST_VFX_KIT);
    for (const id of ['shield_slam', 'mortal_strike', 'iron_resolve', 'storm_bolt'])
      walkId(rig, id, 0, control, CAST_VFX_ENGINE);
    expect(control.failures.length).toBeGreaterThan(20);
    expect(control.failures.every((failure) => /miss [1-9]/.test(failure))).toBe(true);
  });

  it('walks every id through a claimed entry point, and both requirement classes', () => {
    expect(walked.runs).toBeGreaterThan(IDS.length * 2 * 30);
    expect(walked.claimed).toBeGreaterThan(IDS.length * 20);
    expect(walked.drewEngine).toBeGreaterThan(IDS.length * 20);
    expect(walked.reachedKit).toBeGreaterThan(500);
    expect([...rigs.keys()].sort()).toEqual([
      `${CAST_VFX_ENGINE}:false`,
      `${CAST_VFX_ENGINE}:true`,
      `${CAST_VFX_ENGINE | CAST_VFX_KIT}:false`,
      `${CAST_VFX_ENGINE | CAST_VFX_KIT}:true`,
    ]);
    // The victim-worn arms reach draws, and the fear-break arm ran on both
    // tiers (the shout's spec authors no debuff block, so what it draws today
    // is the hard-CC band).
    expect(walked.drewBy.get('aura worn slow') ?? 0).toBeGreaterThan(10);
    expect(walked.drewBy.get('aura worn root') ?? 0).toBeGreaterThan(5);
    expect(walked.drewBy.get('aura fear break') ?? 0).toBe(2);
    // The kit's solid pieces, checked before the gate on preparations that
    // are never ready headless unless stubbed, really drew in the walk.
    const kitRig = rigs.get(`${CAST_VFX_ENGINE | CAST_VFX_KIT}:false`)!;
    const pools = kitRig.fx as unknown as Record<
      string,
      { mesh?: THREE.Object3D; meshes?: THREE.Object3D[] }
    >;
    const drew = kitRig.everDrew();
    for (const pool of ['guards', 'spiritHammers'])
      expect(drew.has(pools[pool].mesh!), pool).toBe(true);
    for (const pool of ['powerForms', 'furyStates'])
      expect(
        pools[pool].meshes!.some((mesh) => drew.has(mesh)),
        pool,
      ).toBe(true);
    // Non-vacuity: the engine-only rig really kept the kit shut, the walk
    // drew from every family it proved, and a Warrior id reached the kit.
    for (const [key, rig] of rigs) {
      const mask = Number(key.split(':')[0]);
      expect(rig.readiness.snapshot().families.map((family) => family.ready)).toEqual([
        true,
        (mask & CAST_VFX_KIT) !== 0,
      ]);
    }
  });
});
