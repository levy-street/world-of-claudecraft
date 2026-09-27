// The per-cast gate, end to end: the REAL painter over the REAL engine behind
// the real readiness core. A cast draws its whole composition or nothing
// (windup to lingers), each cast waits only on the families it draws from, a
// refusal taken at the cast bar holds through the cast, and a refused hold
// shows the frame its families are ready.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
  // Spirit models never arrive here: a cast whose spirit is still loading
  // skips it silently, and spirits keep their own gate.
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
  return { ...actual, fragmentGeometry: vi.fn(() => new THREE.BoxGeometry(0.2, 0.2, 0.2)) };
});

import type { AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../src/render/cast_vfx_family';
import { ABILITIES } from '../src/sim/data';
import { CAST_PUSHBACK_SEC } from '../src/sim/types';
import { castGateRig } from './helpers/cast_vfx_headless';

const MAGE = 5;
const WARRIOR = 1;
const VICTIM = 9;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A cast bar of `seconds`, then its release, its impact and its lingers. */
function fireball(rig: ReturnType<typeof castGateRig>, seconds = 1) {
  const entity = (remaining: number): AbilityVfxEntityState => ({
    id: MAGE,
    kind: 'player',
    templateId: 'mage',
    castingAbility: remaining > 0 ? 'fireball' : null,
    castRemaining: remaining,
    castTotal: seconds,
    auras: [],
  });
  for (let t = seconds; t > 0; t -= 0.05) {
    rig.painter.syncEntity(entity(t));
    rig.step();
  }
  rig.painter.syncEntity(entity(0));
  rig.painter.handleSpellfx({
    sourceId: MAGE,
    targetId: VICTIM,
    school: 'fire',
    fx: 'projectile',
    ability: 'fireball',
  });
  rig.step(20);
  rig.painter.onDamage({
    sourceId: MAGE,
    targetId: VICTIM,
    school: 'fire',
    ability: ABILITIES.fireball.name,
    abilityId: 'fireball',
    kind: 'hit',
    crit: true,
    amount: 120,
  });
  rig.step(160);
}

/** An authored Warrior strike: its cue, its contact, its lingers. */
function shieldSlam(rig: ReturnType<typeof castGateRig>) {
  rig.warriors.add(WARRIOR);
  rig.painter.handleSpellfx({
    sourceId: WARRIOR,
    targetId: VICTIM,
    school: 'physical',
    fx: 'selfCast',
    ability: 'shield_slam',
  });
  rig.step(4);
  rig.painter.onDamage({
    sourceId: WARRIOR,
    targetId: VICTIM,
    school: 'physical',
    ability: ABILITIES.shield_slam.name,
    abilityId: 'shield_slam',
    kind: 'hit',
    crit: false,
    amount: 80,
  });
  rig.step(160);
}

describe('with the kit not ready', () => {
  it('draws nothing of a Warrior cast, from any pool, over its whole life', () => {
    const rig = castGateRig();
    rig.prove(CAST_VFX_ENGINE);
    shieldSlam(rig);
    expect(rig.drawn()).toBe(0);
    expect(rig.vfxCalls).toEqual([]);
    expect(rig.readiness.snapshot()).toMatchObject({ requirementMiss: 0 });
    // One cast, refused once at its cue; its contact rides the latch.
    expect(rig.readiness.snapshot().families[1].refused).toBe(1);
  });

  it('draws a Mage cast whole, and never asks it for the kit', () => {
    const rig = castGateRig();
    rig.prove(CAST_VFX_ENGINE);
    fireball(rig);
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
    const snapshot = rig.readiness.snapshot();
    expect(snapshot.refused).toBe(0);
    expect(snapshot.requirementMiss).toBe(0);
  });

  it('draws the Warrior cast whole once the kit is ready, kit pieces included', () => {
    const rig = castGateRig({ equipped: true });
    rig.prove(CAST_VFX_ENGINE | CAST_VFX_KIT);
    shieldSlam(rig);
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE | CAST_VFX_KIT);
    expect(rig.readiness.snapshot()).toMatchObject({ refused: 0, requirementMiss: 0 });
  });
});

describe('with the engine not ready', () => {
  it('draws nothing of any cast', () => {
    const rig = castGateRig();
    rig.prove(CAST_VFX_KIT);
    fireball(rig);
    shieldSlam(rig);
    expect(rig.drawn()).toBe(0);
    expect(rig.vfxCalls).toEqual([]);
    expect(rig.readiness.snapshot().requirementMiss).toBe(0);
  });
});

describe('a refusal latched at the cast bar', () => {
  it('holds through the release, impact and lingers after the family latches mid-cast', () => {
    const rig = castGateRig();
    const entity = (remaining: number): AbilityVfxEntityState => ({
      id: MAGE,
      castingAbility: remaining > 0 ? 'fireball' : null,
      castRemaining: remaining,
      castTotal: 2,
      auras: [],
    });
    for (let t = 2; t > 1; t -= 0.05) {
      rig.painter.syncEntity(entity(t));
      rig.step();
    }
    rig.prove(CAST_VFX_ENGINE);
    for (let t = 1; t > 0; t -= 0.05) {
      rig.painter.syncEntity(entity(t));
      rig.step();
    }
    rig.painter.syncEntity(entity(0));
    rig.painter.handleSpellfx({
      sourceId: MAGE,
      targetId: VICTIM,
      school: 'fire',
      fx: 'projectile',
      ability: 'fireball',
    });
    rig.step(20);
    rig.painter.onDamage({
      sourceId: MAGE,
      targetId: VICTIM,
      school: 'fire',
      ability: ABILITIES.fireball.name,
      abilityId: 'fireball',
      kind: 'hit',
      crit: true,
      amount: 120,
    });
    rig.step(160);
    expect(rig.drawn()).toBe(0);
    expect(rig.vfxCalls).toEqual([]);
    // The refused cast counted once, at its cast bar.
    expect(rig.readiness.snapshot().refused).toBe(1);

    // The next cast is a new cast, and draws.
    fireball(rig);
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
  });
});

describe('an interrupted cast bar', () => {
  const bar = (remaining: number, castingAbility = 'fireball'): AbilityVfxEntityState => ({
    id: MAGE,
    castingAbility: remaining > 0 ? castingAbility : null,
    castRemaining: remaining,
    castTotal: 2,
    auras: [],
  });
  /** A two second bar refused for its first second, on screen or not. */
  function refusedBar(rig: ReturnType<typeof castGateRig>, renderEffects = true) {
    for (let t = 2; t > 1; t -= 0.05) {
      rig.painter.syncEntity(bar(t), renderEffects);
      rig.step();
    }
  }
  function release(rig: ReturnType<typeof castGateRig>) {
    rig.painter.handleSpellfx({
      sourceId: MAGE,
      targetId: VICTIM,
      school: 'fire',
      fx: 'projectile',
      ability: 'fireball',
    });
    rig.step(20);
  }
  /** The engine proves, then an instant release of the bar's id: what drew. */
  function instantOnceReady(rig: ReturnType<typeof castGateRig>) {
    rig.prove(CAST_VFX_ENGINE);
    release(rig);
    return rig.drawn();
  }

  it('hands its refusal to no later cast: an instant release of the same id draws', () => {
    const rig = castGateRig();
    refusedBar(rig);
    rig.painter.castInterrupted(MAGE);
    rig.painter.syncEntity(bar(0));
    rig.step();
    expect(instantOnceReady(rig)).toBe(CAST_VFX_ENGINE);
    const snapshot = rig.readiness.snapshot();
    expect(snapshot.refused).toBe(1);
    expect(snapshot.requirementMiss).toBe(0);
  });

  it('reads a bar cleared with time left and no castStop as an interrupt', () => {
    // Death, an evade home and the boss and script clears end a bar this way.
    const rig = castGateRig();
    refusedBar(rig);
    rig.painter.syncEntity(bar(0));
    rig.step();
    expect(instantOnceReady(rig)).toBe(CAST_VFX_ENGINE);
    expect(rig.readiness.snapshot()).toMatchObject({ refused: 1, requirementMiss: 0 });
  });

  it('reads a bar replaced with time left by another cast as an interrupt', () => {
    const rig = castGateRig();
    refusedBar(rig);
    rig.painter.syncEntity(bar(1.5, 'frostbolt'));
    rig.step();
    expect(instantOnceReady(rig)).toBe(CAST_VFX_ENGINE);
  });

  it('reads a bar cleared while its rig is culled as an interrupt', () => {
    const rig = castGateRig();
    refusedBar(rig);
    for (let t = 1; t > 0.5; t -= 0.05) {
      rig.painter.syncEntity(bar(t), false);
      rig.step();
    }
    rig.painter.syncEntity(bar(0), false);
    rig.step();
    expect(instantOnceReady(rig)).toBe(CAST_VFX_ENGINE);
  });

  it('keeps the refusal for the release that ends an uninterrupted bar', () => {
    const rig = castGateRig();
    refusedBar(rig);
    for (let t = 1; t > 0; t -= 0.05) {
      rig.painter.syncEntity(bar(t));
      rig.step();
    }
    rig.painter.syncEntity(bar(0));
    rig.step();
    expect(instantOnceReady(rig)).toBe(0);
    expect(rig.readiness.snapshot().refused).toBe(1);
  });

  it('keeps it when the bar runs out between two slow frames', () => {
    // At 15 fps the sim runs the bar's last two ticks between two frames.
    const rig = castGateRig();
    refusedBar(rig);
    rig.painter.syncEntity(bar(0.1));
    rig.step(1, 1 / 15);
    rig.painter.syncEntity(bar(0));
    rig.step();
    expect(instantOnceReady(rig)).toBe(0);
  });

  it('drops nothing more when the castStop lands after the bar was read as stopped', () => {
    const rig = castGateRig();
    refusedBar(rig);
    rig.painter.syncEntity(bar(0));
    rig.step();
    // A new instant cast, refused on its own while the engine is not ready.
    release(rig);
    rig.painter.castInterrupted(MAGE);
    rig.prove(CAST_VFX_ENGINE);
    rig.painter.onDamage({
      sourceId: MAGE,
      targetId: VICTIM,
      school: 'fire',
      ability: ABILITIES.fireball.name,
      abilityId: 'fireball',
      kind: 'hit',
      crit: false,
      amount: 90,
    });
    rig.step(160);
    expect(rig.drawn()).toBe(0);
    expect(rig.vfxCalls).toEqual([]);
    expect(rig.readiness.snapshot()).toMatchObject({ refused: 2, requirementMiss: 0 });
  });
});

describe('a queued recast of the same ability', () => {
  it('is a new cast: decided afresh though the bar never goes idle between the two', () => {
    const rig = castGateRig();
    const bar = (remaining: number): AbilityVfxEntityState => ({
      id: MAGE,
      castingAbility: 'fireball',
      castRemaining: remaining,
      castTotal: 1.5,
      auras: [],
    });
    for (let t = 1.5; t > 0; t -= 0.05) {
      rig.painter.syncEntity(bar(t));
      rig.step();
    }
    expect(rig.drawn()).toBe(0);
    rig.prove(CAST_VFX_ENGINE);
    // The queue fires the next Fireball on the tick the first completes.
    for (let t = 1.5; t > 0.5; t -= 0.05) {
      rig.painter.syncEntity(bar(t));
      rig.step();
    }
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
    expect(rig.readiness.snapshot()).toMatchObject({ refused: 1, requirementMiss: 0 });
  });
});

describe('a pushed-back cast bar', () => {
  // pushbackCast (src/sim/combat/casting_lifecycle.ts) adds CAST_PUSHBACK_SEC
  // to both the remaining time and the total, once per hit and uncapped, so
  // several hits between two painter frames jump the remaining time back by
  // more than half the cast while the elapsed time stays put.
  const FRAME = 1 / 60;
  function pushedBack(seconds: number, hits: number) {
    const rig = castGateRig();
    let remaining = seconds;
    let total = seconds;
    const frame = () => {
      rig.painter.syncEntity({
        id: MAGE,
        castingAbility: 'fireball',
        castRemaining: remaining,
        castTotal: total,
        auras: [],
      });
      rig.step(1, FRAME);
      remaining -= FRAME;
    };
    for (let i = 0; i < 6; i++) frame();
    rig.prove(CAST_VFX_ENGINE);
    for (let i = 0; i < 6; i++) frame();
    // The engine is ready mid-bar: this frame alone would draw a fresh cast.
    expect(rig.readiness.ready(CAST_VFX_ENGINE)).toBe(true);
    remaining += hits * CAST_PUSHBACK_SEC;
    total += hits * CAST_PUSHBACK_SEC;
    while (remaining > 0) frame();
    return rig;
  }

  it('stays the refused cast through several hits in one frame', () => {
    const rig = pushedBack(1.5, 4);
    expect(rig.drawn()).toBe(0);
    expect(rig.readiness.snapshot().refused).toBe(1);
  });

  it('stays the refused cast through one hit on a short cast', () => {
    const rig = pushedBack(0.4, 1);
    expect(rig.drawn()).toBe(0);
    expect(rig.readiness.snapshot().refused).toBe(1);
  });
});

describe('a contact named like a Warrior ability from another caster', () => {
  // A mob's Reaping Arc carries the display name of Cleave and no id; a
  // foreign id beside a Warrior name is the other shape. Both draw the kit's
  // contact, so both wait on the kit whole.
  for (const [label, ability, abilityId, expectedDrawn] of [
    ['a mob cleave', ABILITIES.cleave.name, null, CAST_VFX_ENGINE],
    [
      'a foreign id',
      ABILITIES.shield_slam.name,
      'no_such_mob_ability_for_the_gate',
      CAST_VFX_ENGINE | CAST_VFX_KIT,
    ],
  ] as const) {
    it(`waits on the kit for ${label}, and draws it whole once the kit is ready`, () => {
      const contact = (rig: ReturnType<typeof castGateRig>) => {
        for (const crit of [false, true]) {
          rig.painter.onDamage({
            sourceId: MAGE,
            targetId: VICTIM,
            school: 'physical',
            ability,
            abilityId,
            kind: 'hit',
            crit,
            amount: 80,
          });
          rig.step(60);
        }
      };
      const shut = castGateRig({ deadlineMs: Number.POSITIVE_INFINITY, equipped: true });
      shut.prove(CAST_VFX_ENGINE);
      contact(shut);
      expect(shut.drawn()).toBe(0);
      expect(shut.readiness.snapshot()).toMatchObject({ refused: 1, requirementMiss: 0 });
      const open = castGateRig({ deadlineMs: Number.POSITIVE_INFINITY, equipped: true });
      open.prove(CAST_VFX_ENGINE | CAST_VFX_KIT);
      contact(open);
      expect(open.drawn()).toBe(expectedDrawn);
      expect(open.readiness.snapshot()).toMatchObject({ refused: 0, requirementMiss: 0 });
    });
  }
});

describe('a white swing', () => {
  it('waits on the kit when a Warrior swings it, and on the engine alone otherwise', () => {
    const swing = (sourceId: number) => ({
      sourceId,
      targetId: VICTIM,
      school: 'physical',
      ability: null,
      kind: 'hit',
      crit: false,
      amount: 30,
    });
    const rig = castGateRig();
    rig.warriors.add(WARRIOR);
    rig.prove(CAST_VFX_ENGINE);
    rig.painter.onDamage(swing(WARRIOR));
    rig.step(10);
    expect(rig.drawn()).toBe(0);
    rig.painter.onDamage(swing(MAGE));
    rig.step(10);
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
    // A swing is a per-frame read, never a counted cast.
    expect(rig.readiness.snapshot()).toMatchObject({ refused: 0, requirementMiss: 0 });
  });
});

describe('a refused hold', () => {
  it('shows a Mage barrier the frame the engine is ready', () => {
    const rig = castGateRig();
    const wearer: AbilityVfxEntityState = {
      id: MAGE,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'ice_barrier', kind: 'absorb', remaining: 30, duration: 60, value: 300 }],
    };
    for (let i = 0; i < 5; i++) {
      rig.painter.syncEntity(wearer);
      rig.step();
    }
    expect(rig.drawn()).toBe(0);
    rig.prove(CAST_VFX_ENGINE);
    rig.painter.syncEntity(wearer);
    expect(rig.step()).toBe(CAST_VFX_ENGINE);
  });

  it('shows a Warrior guard the frame the kit is ready, and nothing of it before', () => {
    const rig = castGateRig();
    rig.warriors.add(WARRIOR);
    rig.prove(CAST_VFX_ENGINE);
    const wearer: AbilityVfxEntityState = {
      id: WARRIOR,
      kind: 'player',
      templateId: 'warrior',
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'iron_resolve', kind: 'absorb', remaining: 8, duration: 10, value: 200 }],
    };
    for (let i = 0; i < 5; i++) {
      rig.painter.syncEntity(wearer);
      rig.step();
    }
    expect(rig.drawn()).toBe(0);
    rig.prove(CAST_VFX_KIT);
    rig.painter.syncEntity(wearer);
    expect(rig.step()).not.toBe(0);
    expect(rig.readiness.snapshot().requirementMiss).toBe(0);
  });

  it('shows a Warrior aura held on the generic path once the kit is ready, and nothing before', () => {
    // A physical blood DoT on its victim: the one Warrior read the generic
    // aura path draws (an orbit of blood leaves), so the per-hold mask, not
    // the engine sleep, is what holds it.
    const rig = castGateRig();
    rig.prove(CAST_VFX_ENGINE);
    const victim: AbilityVfxEntityState = {
      id: VICTIM,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'hamstring', kind: 'dot', remaining: 12, duration: 15, sourceId: WARRIOR }],
    };
    for (let i = 0; i < 5; i++) {
      rig.painter.syncEntity(victim);
      rig.step();
    }
    expect(rig.drawn()).toBe(0);
    rig.prove(CAST_VFX_KIT);
    for (let i = 0; i < 10; i++) {
      rig.painter.syncEntity(victim);
      rig.step();
    }
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
    expect(rig.readiness.snapshot().requirementMiss).toBe(0);
  });
});

describe('a held control mark', () => {
  // The armor and Hamstring marks draw one orbit band of the engine overlay;
  // the armor status is shared, so a Rogue's Armor Breach wears it too.
  const marked = (aura: AbilityVfxEntityState['auras'][number]): AbilityVfxEntityState => ({
    id: VICTIM,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: [aura],
  });

  for (const aura of [
    { id: 'expose_armor', kind: 'sunder', stacks: 3, remaining: 20, duration: 30, sourceId: 3 },
    { id: 'hamstring_slow', kind: 'slow', remaining: 12, duration: 15, sourceId: WARRIOR },
  ]) {
    it(`draws ${aura.id} on the engine alone and never starts the kit clock`, () => {
      const rig = castGateRig({ deadlineMs: 5_000 });
      rig.prove(CAST_VFX_ENGINE);
      for (let i = 0; i < 400; i++) {
        rig.painter.syncEntity(marked(aura));
        rig.step();
      }
      expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
      const snapshot = rig.readiness.snapshot();
      expect(snapshot.families[1]).toMatchObject({ ready: false, forced: false, refused: 0 });
      expect(snapshot.requirementMiss).toBe(0);
    });
  }

  it('waits on the engine: nothing of it draws while the engine is not ready', () => {
    const rig = castGateRig();
    rig.prove(CAST_VFX_KIT);
    for (let i = 0; i < 10; i++) {
      rig.painter.syncEntity(
        marked({ id: 'expose_armor', kind: 'sunder', stacks: 3, remaining: 20, duration: 30 }),
      );
      rig.step();
    }
    expect(rig.drawn()).toBe(0);
  });
});

describe('each Warrior hold site', () => {
  // Every Warrior-only per-frame read waits on the kit as a whole: nothing
  // of it while the kit is shut, shown the frame the kit is ready. The rig
  // is equipped so the kit's solid pieces can draw.
  const warrior = (
    auras: AbilityVfxEntityState['auras'],
    over: Partial<AbilityVfxEntityState> = {},
  ): AbilityVfxEntityState => ({
    id: WARRIOR,
    kind: 'player',
    templateId: 'warrior',
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras,
    ...over,
  });
  const held = (rig: ReturnType<typeof castGateRig>, entity: AbilityVfxEntityState, n = 6) => {
    for (let i = 0; i < n; i++) {
      rig.painter.syncEntity(entity);
      rig.step();
    }
  };
  const rigWithWarrior = () => {
    const rig = castGateRig({ equipped: true });
    rig.warriors.add(WARRIOR);
    rig.prove(CAST_VFX_ENGINE);
    return rig;
  };

  for (const [site, aura] of [
    ['a Fury state', { id: 'furious_mending', kind: 'buff_dr', remaining: 6, duration: 8 }],
    ['a power form', { id: 'avatar', kind: 'buff_avatar', remaining: 12, duration: 20 }],
  ] as const) {
    it(`holds ${site} on the kit, and draws its kit solid once the kit is ready`, () => {
      const rig = rigWithWarrior();
      held(rig, warrior([aura]));
      expect(rig.drawn()).toBe(0);
      rig.prove(CAST_VFX_KIT);
      held(rig, warrior([aura]), 2);
      expect(rig.drawn() & CAST_VFX_KIT).toBe(CAST_VFX_KIT);
      expect(rig.readiness.snapshot().requirementMiss).toBe(0);
    });
  }

  it('holds a readiness stance on the kit: registered only once the kit is ready', () => {
    // The readiness wearers are registered and swept; the engine draws none
    // of them today, so the registration is what the hold is read on.
    const rig = rigWithWarrior();
    const wearers = () =>
      (rig.fx as unknown as { warriorReadiness: { wearers: Map<number, unknown> } })
        .warriorReadiness.wearers.size;
    const stance = warrior([{ id: 'battle_stance', kind: 'battle_stance', remaining: 60 }]);
    rig.painter.syncEntity(stance);
    expect(wearers()).toBe(0);
    rig.prove(CAST_VFX_KIT);
    rig.step();
    rig.painter.syncEntity(stance);
    expect(wearers()).toBe(1);
  });

  it("holds a mob's forced attention on the kit, and draws it once the kit is ready", () => {
    const rig = rigWithWarrior();
    const taunted: AbilityVfxEntityState = {
      id: VICTIM,
      kind: 'mob',
      hp: 100,
      forcedTargetId: WARRIOR,
      forcedTargetTimer: 3,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [],
    };
    held(rig, taunted);
    expect(rig.drawn()).toBe(0);
    rig.prove(CAST_VFX_KIT);
    held(rig, taunted, 2);
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
  });

  it('draws nothing of a Bladestorm bar refused on the kit, and its storm once the kit is ready', () => {
    const bar = (rig: ReturnType<typeof castGateRig>) => {
      for (let t = 4; t > 0; t -= 0.05) {
        rig.painter.syncEntity(
          warrior([], { castingAbility: 'bladestorm', castRemaining: t, castTotal: 4 }),
        );
        rig.step();
      }
    };
    const storms = (rig: ReturnType<typeof castGateRig>) =>
      (rig.fx as unknown as { warriorStorms: Map<number, unknown> }).warriorStorms.size;
    const shut = rigWithWarrior();
    bar(shut);
    expect(shut.drawn()).toBe(0);
    expect(storms(shut)).toBe(0);
    expect(shut.readiness.snapshot()).toMatchObject({ refused: 1, requirementMiss: 0 });
    const open = rigWithWarrior();
    open.prove(CAST_VFX_KIT);
    open.painter.syncEntity(
      warrior([], { castingAbility: 'bladestorm', castRemaining: 4, castTotal: 4 }),
    );
    expect(storms(open)).toBe(1);
    bar(open);
    // Equipped, the storm draws on the kit's weapon surface.
    expect(open.drawn() & CAST_VFX_KIT).toBe(CAST_VFX_KIT);
    expect(open.readiness.snapshot()).toMatchObject({ refused: 0, requirementMiss: 0 });
  });
});

describe('a refused beam channel', () => {
  it('stays refused tick after tick, past the tail, after the engine proves mid-channel', () => {
    const rig = castGateRig();
    const tick = () =>
      rig.painter.handleSpellfx({
        sourceId: MAGE,
        targetId: VICTIM,
        school: 'shadow',
        fx: 'beam',
        ability: 'mind_flay',
      });
    expect(tick()).toBe(true);
    rig.step(20);
    rig.prove(CAST_VFX_ENGINE);
    // One tick a second for longer than the refusal tail: each tick extends
    // the channel's latch, so none of them is taken for a new cast.
    for (let second = 1; second <= 9; second++) {
      expect(tick()).toBe(true);
      rig.step(20);
    }
    expect(rig.drawn()).toBe(0);
    expect(rig.readiness.snapshot()).toMatchObject({ refused: 1, requirementMiss: 0 });
  });
});

describe('a declined kit', () => {
  it('never holds a Warrior cast, whose kit pools stay dark, and counts no miss', () => {
    const rig = castGateRig({ kitDeclined: true });
    rig.prove(CAST_VFX_ENGINE);
    shieldSlam(rig);
    expect(rig.drawn()).toBe(CAST_VFX_ENGINE);
    const snapshot = rig.readiness.snapshot();
    expect(snapshot).toMatchObject({ ready: true, forced: false, refused: 0, requirementMiss: 0 });
  });
});

describe('the kit deadline', () => {
  it('starts no kit clock for a Mage wearing auras, however long', () => {
    const rig = castGateRig({ deadlineMs: 5_000 });
    rig.prove(CAST_VFX_ENGINE);
    const mage: AbilityVfxEntityState = {
      id: MAGE,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [
        { id: 'ice_barrier', kind: 'absorb', remaining: 30, duration: 60, value: 300 },
        { id: 'frost_armor', kind: 'buff', remaining: 30, duration: 60 },
        { id: 'war_stomp_stun', kind: 'stun', remaining: 2 },
      ],
    };
    for (let i = 0; i < 400; i++) {
      rig.painter.syncEntity(mage);
      rig.step();
    }
    rig.reset();
    // Twenty seconds past the bound: had the auras started the kit's clock,
    // this first Warrior cast would be admitted on a forced kit and draw.
    rig.warriors.add(WARRIOR);
    rig.painter.handleSpellfx({
      sourceId: WARRIOR,
      targetId: VICTIM,
      school: 'physical',
      fx: 'selfCast',
      ability: 'shield_slam',
    });
    expect(rig.readiness.snapshot().families[1]).toMatchObject({ ready: false, forced: false });
    rig.step(20);
    expect(rig.drawn()).toBe(0);
  });

  it('opens a stuck kit at its bound, counted from the first Warrior consult, and says so', () => {
    const rig = castGateRig({ deadlineMs: 5_000 });
    rig.prove(CAST_VFX_ENGINE);
    // Minutes of Mage casts start no kit clock.
    for (let i = 0; i < 3; i++) fireball(rig);
    rig.resetDrawn();
    shieldSlam(rig);
    expect(rig.drawn()).toBe(0);
    rig.step(100);
    rig.resetDrawn();
    shieldSlam(rig);
    expect(rig.drawn() & CAST_VFX_ENGINE).toBe(CAST_VFX_ENGINE);
    expect(rig.readiness.snapshot().families[1]).toMatchObject({
      ready: true,
      forced: true,
      refused: 1,
      requirementMiss: 0,
    });
  });
});
