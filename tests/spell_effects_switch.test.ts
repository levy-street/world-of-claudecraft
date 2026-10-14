// The Spell Effects option (src/render/spell_effects_switch.ts): off drops the
// cosmetic spell and ability visuals that PLAYERS (and their pets) cast, and
// keeps every effect an enemy or creature casts plus every read a player acts
// on. Driven through the real modules: the switch, the ability painter, the
// production ability presentation factory, the pooled Vfx cloud, the light
// pulse pool, the class spell visuals outside both, the world cue module, and
// the renderer's own event dispatch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfx, type AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../src/render/cast_vfx_family';
import { GlacialFrontVisual } from '../src/render/glacial_front_visual';
import { LightPulses } from '../src/render/light_pulses';
import { NeedleOfFateVfx } from '../src/render/needle_of_fate_vfx';
import { type EntityView, Renderer } from '../src/render/renderer';
import { createRendererAbilityPresentation } from '../src/render/renderer_ability_presentation';
import { SentenceVfx } from '../src/render/sentence_vfx';
import {
  bindSpellEffectsWorld,
  enterSpellEvent,
  isPlayerAbilityId,
  isPlayerSideSource,
  leaveSpellEvent,
  type SpellSource,
  setSpellEffectsEnabled,
  spellEffectsEnabled,
  spellEffectsMuted,
  spellEffectsMutedBy,
  spellEventSourceId,
} from '../src/render/spell_effects_switch';
import { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { RecklessSkullPainter } from '../src/render/warrior_cast_fx_painter';
import { playWorldCueFx, riteShrineSchool } from '../src/render/world_cue_fx';
import type { SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';
import { drawsUnder } from './helpers/three_program_keys';

// One world for every suite: a player, a wild mob, a player's pet, and a
// neutral world object. The ids double as x positions for the anchors below.
const PLAYER = 1;
const MOB = 2;
const PET = 3;
const OBJECT = 4;
const WORLD: Record<number, SpellSource> = {
  [PLAYER]: { kind: 'player', ownerId: null },
  [MOB]: { kind: 'mob', ownerId: null },
  [PET]: { kind: 'mob', ownerId: PLAYER },
  [OBJECT]: { kind: 'object', ownerId: null },
};

beforeEach(() => {
  setSpellEffectsEnabled(true);
  bindSpellEffectsWorld((id) => WORLD[id]);
});

afterEach(() => {
  setSpellEffectsEnabled(true);
  bindSpellEffectsWorld(() => undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Run `body` inside the scope of an event cast by `sourceId`. */
function inEventFrom<T>(sourceId: number | undefined, body: () => T): T {
  const scope = enterSpellEvent(sourceId === undefined ? {} : { sourceId });
  try {
    return body();
  } finally {
    leaveSpellEvent(scope);
  }
}

describe('the switch', () => {
  it('starts on in a freshly loaded module', async () => {
    vi.resetModules();
    const fresh = await import('../src/render/spell_effects_switch');
    expect(fresh.spellEffectsEnabled()).toBe(true);
    expect(fresh.spellEffectsMuted(PLAYER)).toBe(false);
  });

  it('classifies players and their pets as the muted side, nothing else', () => {
    expect(isPlayerSideSource(WORLD[PLAYER])).toBe(true);
    expect(isPlayerSideSource(WORLD[PET])).toBe(true);
    expect(isPlayerSideSource(WORLD[MOB])).toBe(false);
    expect(isPlayerSideSource(WORLD[OBJECT])).toBe(false);
    expect(isPlayerSideSource(undefined)).toBe(false);
    // An online mirror that omits ownerId reads as wild, never as a pet.
    expect(isPlayerSideSource({ kind: 'mob' })).toBe(false);
  });

  it('mutes nothing while on', () => {
    for (const id of [PLAYER, MOB, PET, OBJECT, undefined]) {
      expect(spellEffectsMuted(id)).toBe(false);
      expect(inEventFrom(PLAYER, () => spellEffectsMuted(id))).toBe(false);
    }
  });

  it('outside an event, mutes by the id it is handed', () => {
    setSpellEffectsEnabled(false);
    expect(spellEffectsEnabled()).toBe(false);
    expect(spellEffectsMuted(PLAYER)).toBe(true);
    expect(spellEffectsMuted(PET)).toBe(true);
    expect(spellEffectsMuted(MOB)).toBe(false);
    expect(spellEffectsMuted(OBJECT)).toBe(false);
    // Unattributable draws: a gap may only show too much, never hide.
    expect(spellEffectsMuted(99)).toBe(false);
    expect(spellEffectsMuted()).toBe(false);
  });

  it("inside an event, the event's caster decides, whatever body the effect lands on", () => {
    setSpellEffectsEnabled(false);
    // A player's detonation drawn on a mob.
    expect(inEventFrom(PLAYER, () => spellEffectsMuted(MOB))).toBe(true);
    // A mob's cue drawn on a player (or on itself).
    expect(inEventFrom(MOB, () => spellEffectsMuted(PLAYER))).toBe(false);
    expect(inEventFrom(MOB, () => spellEffectsMuted())).toBe(false);
    expect(inEventFrom(PET, () => spellEffectsMuted())).toBe(true);
    // An event that names no caster is unattributed and draws, whatever id
    // the effect is anchored on (a boss debuff's gain swirl on a player).
    expect(inEventFrom(undefined, () => spellEffectsMuted(PLAYER))).toBe(false);
    expect(inEventFrom(undefined, () => spellEffectsMuted(MOB))).toBe(false);
  });

  it('answers per-frame holds by their own id, whatever event scope is open', () => {
    setSpellEffectsEnabled(false);
    expect(inEventFrom(MOB, () => spellEffectsMutedBy(PLAYER))).toBe(true);
    expect(inEventFrom(PLAYER, () => spellEffectsMutedBy(MOB))).toBe(false);
    expect(spellEffectsMutedBy(PET)).toBe(true);
    expect(spellEffectsMutedBy(undefined)).toBe(false);
    setSpellEffectsEnabled(true);
    expect(spellEffectsMutedBy(PLAYER)).toBe(false);
  });

  it('restores the outer scope when an event closes, nested or not', () => {
    setSpellEffectsEnabled(false);
    const outer = enterSpellEvent({ sourceId: MOB });
    const inner = enterSpellEvent({ sourceId: PLAYER });
    expect(spellEffectsMuted()).toBe(true);
    leaveSpellEvent(inner);
    expect(spellEffectsMuted()).toBe(false);
    leaveSpellEvent(outer);
    // Back outside: the id decides again.
    expect(spellEffectsMuted(PLAYER)).toBe(true);
    expect(spellEffectsMuted()).toBe(false);
  });

  it('reads the caster off sourceId, else entityId', () => {
    expect(spellEventSourceId({ type: 'spellfx', sourceId: 5, targetId: 6 })).toBe(5);
    expect(spellEventSourceId({ type: 'castStart', entityId: 7 })).toBe(7);
    expect(spellEventSourceId({ type: 'levelup' })).toBeUndefined();
  });

  it('leaves a spell cue unattributed when no player class owns its ability', () => {
    // A player class ability and a player's trinket cue name their caster.
    expect(isPlayerAbilityId('frostbolt')).toBe(true);
    expect(isPlayerAbilityId('trinket_sundered_prism')).toBe(true);
    const cue = (type: string, ability: string) => ({ type, ability, sourceId: PLAYER });
    expect(spellEventSourceId(cue('spellfx', 'frostbolt'))).toBe(PLAYER);
    expect(spellEventSourceId(cue('spellfxAt', 'frostbolt'))).toBe(PLAYER);
    // An encounter mechanic that names the player it resolves on (the hoard
    // boss's soul catch) is not that player's spell.
    expect(isPlayerAbilityId('Soul Harvest')).toBe(false);
    expect(spellEventSourceId(cue('spellfxAt', 'Soul Harvest'))).toBeUndefined();
    expect(spellEventSourceId(cue('spellfx', 'Soul Harvest'))).toBeUndefined();
    // A damage event's ability is a display name, never an id: its source stands.
    expect(spellEventSourceId(cue('damage', 'Frostbolt'))).toBe(PLAYER);
    setSpellEffectsEnabled(false);
    const scope = enterSpellEvent(cue('spellfxAt', 'Soul Harvest'));
    try {
      expect(spellEffectsMuted()).toBe(false);
    } finally {
      leaveSpellEvent(scope);
    }
  });
});

const frostbolt = (sourceId: number) => ({
  sourceId,
  targetId: sourceId === PLAYER ? MOB : PLAYER,
  school: 'frost',
  fx: 'heavyBolt',
  ability: 'frostbolt',
});

describe('the ability painter', () => {
  /** The real painter over a recording engine and recording particle deps. */
  function painter() {
    const calls: string[] = [];
    const fx = new Proxy(
      {},
      {
        get:
          (_t, key) =>
          (..._args: unknown[]) => {
            calls.push(String(key));
            return 0;
          },
      },
    ) as unknown as AbilityVfxFx;
    const vfx = {
      projectile: vi.fn(),
      lightningProjectile: vi.fn(),
      burst: vi.fn(),
      nova: vi.fn(),
      tick: vi.fn(),
      shoutwave: vi.fn(),
      buffSwirl: vi.fn(),
      beam: vi.fn(),
    };
    const triggerAttack = vi.fn();
    const spawnAoeRing = vi.fn();
    const p = new AbilityVfx(
      {
        fx,
        vfx,
        anchor: () => ({ x: 0, y: 1, z: 0 }),
        spawnAoeRing,
        triggerAttack,
        localPlayerId: () => PLAYER,
        isWarrior: (id) => id === PLAYER,
        castVfxAdmit: () => true,
        castVfxReady: () => true,
      },
      () => 0,
    );
    calls.length = 0;
    const drewAny = () => calls.length > 0 || Object.values(vfx).some((f) => f.mock.calls.length);
    return { painter: p, calls, vfx, triggerAttack, spawnAoeRing, drewAny };
  }

  it("claims a player's cast and draws nothing of it while off; draws it while on", () => {
    const off = painter();
    setSpellEffectsEnabled(false);
    expect(off.painter.handleSpellfx(frostbolt(PLAYER))).toBe(true);
    expect(off.drewAny()).toBe(false);
    setSpellEffectsEnabled(true);
    const on = painter();
    expect(on.painter.handleSpellfx(frostbolt(PLAYER))).toBe(true);
    expect(on.drewAny()).toBe(true);
  });

  it("draws a mob's cast in full while off", () => {
    const { painter: p, drewAny } = painter();
    setSpellEffectsEnabled(false);
    expect(p.handleSpellfx(frostbolt(MOB))).toBe(true);
    expect(drewAny()).toBe(true);
  });

  it("draws nothing of a player's impact while off, and draws it while on", () => {
    const hit = {
      sourceId: PLAYER,
      targetId: MOB,
      school: 'frost',
      ability: 'frostbolt',
      kind: 'hit',
      crit: true,
      amount: 40,
    };
    const off = painter();
    setSpellEffectsEnabled(false);
    off.painter.onDamage(hit);
    expect(off.drewAny()).toBe(false);
    setSpellEffectsEnabled(true);
    const on = painter();
    on.painter.onDamage(hit);
    expect(on.drewAny()).toBe(true);
  });

  it("keeps a player's aimed blast ring and its zone's pulse rings while off", () => {
    const { painter: p, spawnAoeRing } = painter();
    setSpellEffectsEnabled(false);
    const blast = { x: 4, z: 5, school: 'frost', radius: 8, sourceId: PLAYER, ability: 'blizzard' };
    expect(p.handleSpellfxAt({ ...blast, fx: 'nova' })).toBe(true);
    expect(spawnAoeRing).toHaveBeenCalledTimes(1);
    expect(spawnAoeRing.mock.calls[0].slice(0, 4)).toEqual([4, 5, 8, 'frost']);
    // With the pulse particles gone the ring is the zone's footprint, which
    // a player may choose to stand in (a friendly heal circle).
    expect(p.handleSpellfxAt({ ...blast, fx: 'tick' })).toBe(true);
    expect(spawnAoeRing).toHaveBeenCalledTimes(2);
  });

  it("keeps a player's shout ring and drops only its shockwave", () => {
    const shout = {
      sourceId: PLAYER,
      targetId: PLAYER,
      school: 'shadow',
      fx: 'shout',
      ability: 'demoralizing_roar',
    };
    const off = painter();
    setSpellEffectsEnabled(false);
    off.painter.handleSpellfx(shout);
    expect(off.spawnAoeRing).toHaveBeenCalledTimes(1);
    expect(off.vfx.shoutwave).not.toHaveBeenCalled();
    setSpellEffectsEnabled(true);
    const on = painter();
    on.painter.handleSpellfx(shout);
    expect(on.vfx.shoutwave).toHaveBeenCalledTimes(1);
  });

  it('still plays a windup clip for a muted caster: an animation is not an effect', () => {
    const { painter: p, triggerAttack } = painter();
    setSpellEffectsEnabled(false);
    expect(p.handleSpellfx({ ...frostbolt(PLAYER), fx: 'windup' })).toBe(true);
    expect(triggerAttack).toHaveBeenCalledWith(PLAYER, 'frostbolt');
  });

  it("drops a player Warrior's physical tick accent while off, and draws it while on", () => {
    const tick = { sourceId: PLAYER, targetId: MOB, school: 'physical', fx: 'tick' };
    const off = painter();
    setSpellEffectsEnabled(false);
    expect(off.painter.handleSpellfx(tick)).toBe(true);
    expect(off.calls).not.toContain('burstAt');
    setSpellEffectsEnabled(true);
    const on = painter();
    on.painter.handleSpellfx(tick);
    expect(on.calls).toContain('burstAt');
  });

  const body = (id: number, auras: AbilityVfxEntityState['auras']): AbilityVfxEntityState =>
    ({
      id,
      kind: id === PLAYER ? 'player' : 'mob',
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras,
    }) as AbilityVfxEntityState;
  const stun = { id: 'war_stomp_stun', kind: 'stun', remaining: 2.5 };
  const barrier = { id: 'ice_barrier', kind: 'absorb', remaining: 30, duration: 60, value: 300 };

  it('holds the hard-CC band over a stunned player while off', () => {
    const { painter: p, calls } = painter();
    setSpellEffectsEnabled(false);
    p.syncEntity(body(PLAYER, [{ ...stun, sourceId: MOB }]));
    expect(calls).toEqual(['holdCcBand']);
  });

  it("drops a player's own buff shell while off and holds it while on", () => {
    const off = painter();
    setSpellEffectsEnabled(false);
    off.painter.syncEntity(body(PLAYER, [{ ...barrier, sourceId: PLAYER }]));
    expect(off.calls).toEqual([]);
    setSpellEffectsEnabled(true);
    const on = painter();
    on.painter.syncEntity(body(PLAYER, [{ ...barrier, sourceId: PLAYER }]));
    expect(on.calls.length).toBeGreaterThan(0);
  });

  it("keeps an enemy's aura on a player body while off (no whole-body sleep)", () => {
    const { painter: p, calls } = painter();
    setSpellEffectsEnabled(false);
    p.syncEntity(body(PLAYER, [{ ...barrier, sourceId: MOB }]));
    expect(calls).not.toContain('sleepEntity');
    expect(calls.length).toBeGreaterThan(0);
  });

  it("drops a player's cast windup while off and keeps a mob's", () => {
    const casting = (id: number): AbilityVfxEntityState => ({
      ...body(id, []),
      castingAbility: 'frostbolt',
      castRemaining: 1,
      castTotal: 2,
    });
    setSpellEffectsEnabled(false);
    const player = painter();
    player.painter.syncEntity(casting(PLAYER));
    expect(player.calls).not.toContain('windup');
    const mob = painter();
    mob.painter.syncEntity(casting(MOB));
    expect(mob.calls).toContain('windup');
    setSpellEffectsEnabled(true);
    const on = painter();
    on.painter.syncEntity(casting(PLAYER));
    expect(on.calls).toContain('windup');
  });

  it("keeps a mob's own buff shell while off", () => {
    const { painter: p, calls } = painter();
    setSpellEffectsEnabled(false);
    p.syncEntity(body(MOB, [{ ...barrier, sourceId: MOB }]));
    expect(calls).not.toContain('sleepEntity');
    expect(calls.length).toBeGreaterThan(0);
  });

  it("drops a player's aura hold on a mob while off, and keeps the same aura cast by a mob", () => {
    const byPlayer = painter();
    setSpellEffectsEnabled(false);
    byPlayer.painter.syncEntity(body(MOB, [{ ...barrier, sourceId: PLAYER }]));
    expect(byPlayer.calls).toEqual([]);
    const byMob = painter();
    byMob.painter.syncEntity(body(MOB, [{ ...barrier, sourceId: MOB }]));
    expect(byMob.calls.length).toBeGreaterThan(0);
  });
});

/** The production factory, headless, with every family linked: whatever it
 *  refuses below, it refuses because of the option alone. */
function presentation() {
  installCastVfxCanvasStub();
  const gate = { admitted: [] as number[], spawns: [] as number[] };
  const castGate = {
    admit: (mask: number) => {
      gate.admitted.push(mask);
      return true;
    },
    ready: () => true,
    spawnAllowed: (bit: number) => {
      gate.spawns.push(bit);
      return true;
    },
  };
  const world = {
    entities: new Map([
      [PLAYER, { id: PLAYER, kind: 'player', templateId: 'mage', facing: 0, ownerId: null }],
      [MOB, { id: MOB, kind: 'mob', templateId: 'wolf', facing: 0, ownerId: null }],
    ]),
    player: { id: PLAYER },
    playerId: PLAYER,
    talentSpec: null,
  } as unknown as IWorld;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 3, 12);
  camera.updateMatrixWorld();
  const anchor = createVfxAnchor((id, pose) => {
    pose.x = id * 2;
    pose.y = 0;
    pose.z = 0;
    pose.height = 2;
    return true;
  });
  const vfxCalls: string[] = [];
  const vfx = new Proxy(
    {},
    {
      get:
        (_t, key) =>
        (..._args: unknown[]) => {
          vfxCalls.push(String(key));
        },
    },
  ) as unknown as Vfx;
  const spawnAoeRing = vi.fn();
  const { fx, painter: p } = createRendererAbilityPresentation({
    scene: new THREE.Scene(),
    camera,
    vfx,
    anchor,
    world: () => world,
    time: () => 0,
    views: new Map<number, EntityView>(),
    visual: () => null,
    textureReady: () => true,
    ground: () => 0,
    height: () => 720,
    pixelRatio: () => 1,
    reducedMotion: () => false,
    audio: () => null,
    spiritBuild: () => {},
    compile: null,
    light: { pulse: () => {} } as never,
    castGate,
    painter: {
      spawnAoeRing,
      triggerAttack: () => {},
      lightPulse: () => {},
      addShake: () => {},
      screenFlash: () => {},
      screenImpact: () => {},
    },
  });
  vfxCalls.length = 0;
  return { fx, painter: p, gate, vfxCalls, spawnAoeRing };
}

describe('the ability presentation the renderer builds', () => {
  it("binds the live world: a player's cast draws nothing while off, and never asks readiness", () => {
    const { fx, painter: p, gate, vfxCalls } = presentation();
    setSpellEffectsEnabled(false);
    expect(p.handleSpellfx(frostbolt(PLAYER))).toBe(true);
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    // Not asked: a player preference is not a readiness refusal in telemetry.
    expect(gate.admitted).toEqual([]);
    expect(gate.spawns).toEqual([]);
    expect(vfxCalls).toEqual([]);
  });

  it("draws a mob's cast while off", () => {
    const { fx, painter: p, gate } = presentation();
    setSpellEffectsEnabled(false);
    expect(p.handleSpellfx(frostbolt(MOB))).toBe(true);
    expect(gate.admitted).toEqual([CAST_VFX_ENGINE]);
    for (let i = 0; i < 20; i++) fx.update(1 / 30);
    expect(gate.spawns).toContain(CAST_VFX_ENGINE);
  });

  it("draws a player's next cast once switched back on", () => {
    const { fx, painter: p, gate } = presentation();
    setSpellEffectsEnabled(false);
    p.handleSpellfx(frostbolt(PLAYER));
    setSpellEffectsEnabled(true);
    expect(p.handleSpellfx(frostbolt(PLAYER))).toBe(true);
    expect(gate.admitted).toEqual([CAST_VFX_ENGINE]);
    for (let i = 0; i < 20; i++) fx.update(1 / 30);
    expect(gate.spawns.every((bit) => bit === CAST_VFX_ENGINE || bit === CAST_VFX_KIT)).toBe(true);
    expect(gate.spawns).toContain(CAST_VFX_ENGINE);
  });
});

describe('the pooled particle cloud (Vfx)', () => {
  // Positions by id: the player at the origin, everyone else along +x.
  const anchorAt = (id: number, _frac: number, out?: THREE.Vector3) =>
    (out ?? new THREE.Vector3()).set(id === PLAYER ? 0 : id * 3, 1, 0);

  function cloud() {
    installCastVfxCanvasStub();
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, anchorAt);
    const probe = vfx as unknown as {
      activeCount: number;
      projectiles: unknown[];
      drainLifeVfx: { slots: { active: boolean }[] };
      paladinSpellFx: Record<string, (...args: unknown[]) => unknown>;
    };
    return { scene, vfx, probe };
  }

  /** Every spell emitter, called with `id` in the caster's slot. The five
   *  paladin arms that delegate to the paladin controller are observed there. */
  type Row = [string, (vfx: Vfx, id: number) => void, string?];
  const EMITTERS: Row[] = [
    ['projectile', (v, id) => v.projectile(id, MOB, 'fire')],
    ['lightningProjectile', (v, id) => v.lightningProjectile(id, MOB)],
    ['beam', (v, id) => v.beam(id, OBJECT, 'arcane')],
    ['chainHealArc', (v, id) => v.chainHealArc(id, OBJECT)],
    ['lichTransform', (v, id) => v.lichTransform(id)],
    ['procSurge', (v, id) => v.procSurge(id, 'fire')],
    ['wardBloom', (v, id) => v.wardBloom(id, 'holy')],
    ['echoBurst', (v, id) => v.echoBurst(id, 'nature')],
    ['detonate', (v, id) => v.detonate(id, 'fire')],
    ['tick', (v, id) => v.tick(id, 'shadow')],
    ['shoutwave', (v, id) => v.shoutwave(id, 0xff0000)],
    ['recklessFlame', (v, id) => v.recklessFlame(id, 1)],
    ['formAura', (v, id) => v.formAura(id, 'moonkin', 1)],
    ['lichAura', (v, id) => v.lichAura(id, 1, 3)],
    ['paladinFinalEdict', (v, id) => v.paladinFinalEdict(id, MOB)],
    ['paladinAscensionImpact', (v, id) => v.paladinAscensionImpact(id, MOB, 'offensive')],
    ['paladinHolyShock', (v, id) => v.paladinHolyShock(id, MOB, 'damage'), 'holyShock'],
    ['paladinSunwardDisc', (v, id) => v.paladinSunwardDisc(id, MOB, 0, 3), 'sunwardDisc'],
    [
      'paladinSunwardDiscImpact',
      (v, id) => v.paladinSunwardDiscImpact(id, MOB, 0, 3),
      'sunwardDiscImpact',
    ],
    ['paladinBastionSweep', (v, id) => v.paladinBastionSweep(id, 6, 180, 0), 'bastionSweep'],
    ['paladinBastionSweepImpact', (v, id) => v.paladinBastionSweepImpact(id), 'bastionSweepTarget'],
    ['paladinDawnfall', (v, id) => v.paladinDawnfall(id, 6), 'dawnfall'],
    ['paladinDawnfallImpact', (v, id) => v.paladinDawnfallImpact(id), 'dawnfallTarget'],
    ['spellNova', (v, id) => v.spellNova(id, 'fire')],
    ['spellHealGlow', (v, id) => v.spellHealGlow(id)],
    ['spellBuffSwirl', (v, id) => v.spellBuffSwirl(id)],
    ['spellCastSparkle', (v, id) => v.spellCastSparkle(id, 'arcane', 1)],
  ];

  /** Draw `row` as `id` and report whether anything landed. */
  function drew(row: Row, id: number): boolean {
    const [, call, controllerMethod] = EMITTERS.find((r) => r[0] === row[0]) ?? row;
    const { vfx, probe } = cloud();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const spy = controllerMethod ? vi.spyOn(probe.paladinSpellFx, controllerMethod) : null;
    call(vfx, id);
    const landed = probe.activeCount + probe.projectiles.length > 0 || !!spy?.mock.calls.length;
    vi.restoreAllMocks();
    return landed;
  }

  it.each(EMITTERS)('%s draws while on', (...row) => {
    expect(drew(row, PLAYER)).toBe(true);
  });

  it.each(EMITTERS)("%s skips a player's effect while off", (...row) => {
    setSpellEffectsEnabled(false);
    expect(drew(row, PLAYER)).toBe(false);
    expect(drew(row, PET)).toBe(false);
  });

  it.each(EMITTERS)("%s still draws a mob's effect while off", (...row) => {
    setSpellEffectsEnabled(false);
    expect(drew(row, MOB)).toBe(true);
  });

  it("judges a target-anchored effect by the event's caster", () => {
    setSpellEffectsEnabled(false);
    // A player's detonation lands on a mob: muted by its caster.
    let c = cloud();
    inEventFrom(PLAYER, () => c.vfx.detonate(MOB, 'fire'));
    expect(c.probe.activeCount).toBe(0);
    // A bomber's fuse flash (procSurge on itself) keeps drawing.
    c = cloud();
    inEventFrom(MOB, () => c.vfx.procSurge(MOB, 'fire'));
    expect(c.probe.activeCount).toBeGreaterThan(0);
    // A mob's heal beam into the boss keeps drawing.
    c = cloud();
    inEventFrom(MOB, () => c.vfx.beam(MOB, OBJECT, 'shadow'));
    expect(c.probe.activeCount).toBeGreaterThan(0);
  });

  it('never gates the shared emitters, one by one, even inside a muted event', () => {
    // A delve shrine's pulse (nova), a lit wardstone (castSparkle), a correct
    // touch (healGlow), a minigame power-up (buffSwirl), a burning hut
    // (burst) and melee hit sparks: none of them is a spell effect.
    setSpellEffectsEnabled(false);
    const shared: Array<[string, (v: Vfx) => void]> = [
      ['nova', (v) => v.nova(OBJECT, 'holy')],
      ['castSparkle', (v) => v.castSparkle(OBJECT, 'arcane', 1)],
      ['healGlow', (v) => v.healGlow(OBJECT)],
      ['buffSwirl', (v) => v.buffSwirl(OBJECT)],
      ['burst', (v) => v.burst(new THREE.Vector3(), 'fire', 20, 1)],
      ['meleeSpark', (v) => v.meleeSpark(MOB, true)],
    ];
    for (const [name, call] of shared) {
      const { vfx, probe } = cloud();
      inEventFrom(PLAYER, () => call(vfx));
      expect(probe.activeCount, name).toBeGreaterThan(0);
    }
  });

  it("flies a muted player's soul unseen and still lands its callback on time", () => {
    setSpellEffectsEnabled(false);
    const { vfx, probe } = cloud();
    const onImpact = vi.fn();
    inEventFrom(PLAYER, () => vfx.soulTravel(0, 1, 0, MOB, onImpact));
    expect(probe.projectiles).toHaveLength(1);
    // 6 yards at 14 yd/s: not yet after a sixth of a second, done by one.
    for (let i = 0; i < 5; i++) {
      vfx.update(1 / 30);
      expect(probe.activeCount).toBe(0);
    }
    expect(onImpact).not.toHaveBeenCalled();
    for (let i = 0; i < 25; i++) {
      vfx.update(1 / 30);
      expect(probe.activeCount).toBe(0);
    }
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(probe.projectiles).toHaveLength(0);
  });

  it("shows a muted player's death bolt only while on", () => {
    const hands = () => [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.5, 1, 0)] as const;
    let c = cloud();
    inEventFrom(PLAYER, () => c.vfx.deathBolt(...hands(), MOB));
    expect(c.probe.activeCount + c.probe.projectiles.length).toBeGreaterThan(0);
    setSpellEffectsEnabled(false);
    c = cloud();
    inEventFrom(PLAYER, () => c.vfx.deathBolt(...hands(), MOB));
    expect(c.probe.activeCount + c.probe.projectiles.length).toBe(0);
  });

  it("ends a player's channels when the option goes off, and keeps a mob's", () => {
    const { scene, vfx, probe } = cloud();
    const streams = () => scene.children.filter((o) => o.name === 'drain-life-beam').length;
    const draining = () => probe.drainLifeVfx.slots.filter((s) => s.active).length;
    vfx.bubbleBeam(PLAYER, MOB, 4);
    vfx.drainBeam(PLAYER, MOB, 5);
    vfx.drainBeam(MOB, PLAYER, 5);
    expect(streams()).toBe(1);
    expect(draining()).toBe(2);
    setSpellEffectsEnabled(false);
    // The next refresh of each channel is what ends it.
    vfx.bubbleBeam(PLAYER, MOB, 4);
    vfx.drainBeam(PLAYER, MOB, 5);
    vfx.drainBeam(MOB, PLAYER, 5);
    expect(streams()).toBe(0);
    expect(draining()).toBe(1);
    vfx.demonicDrainBeam(PLAYER, MOB, 5);
    vfx.evilEyeGaze(PLAYER, MOB);
    expect(draining()).toBe(1);
    const tick = vi.spyOn(probe.drainLifeVfx as unknown as { tick(id: number): void }, 'tick');
    vfx.drainLifeTick(PLAYER);
    expect(tick).not.toHaveBeenCalled();
    vfx.drainLifeTick(MOB);
    expect(tick).toHaveBeenCalledWith(MOB);
  });
});

describe('the spell light pulses', () => {
  const lit = (pulses: LightPulses) => pulses.lights.some((l) => l.intensity > 0);

  it("stay dark inside a muted player's event and flash for a mob's", () => {
    setSpellEffectsEnabled(false);
    let pulses = new LightPulses(new THREE.Scene());
    inEventFrom(PLAYER, () => pulses.pulse(new THREE.Vector3(), 'fire', 8, 0.5));
    pulses.update(0.01);
    expect(lit(pulses)).toBe(false);
    pulses = new LightPulses(new THREE.Scene());
    inEventFrom(MOB, () => pulses.pulse(new THREE.Vector3(), 'fire', 8, 0.5));
    pulses.update(0.01);
    expect(lit(pulses)).toBe(true);
  });

  it('flash for a player while on', () => {
    const pulses = new LightPulses(new THREE.Scene());
    inEventFrom(PLAYER, () => pulses.pulse(new THREE.Vector3(), 'fire', 8, 0.5));
    pulses.update(0.01);
    expect(lit(pulses)).toBe(true);
  });
});

describe('the class spell visuals outside the pooled engines', () => {
  const TEXTURES = {
    noise: new THREE.Texture(),
    ribbon: new THREE.Texture(),
    rune: new THREE.Texture(),
    ember: new THREE.Texture(),
    rime: new THREE.Texture(),
    crack: new THREE.Texture(),
    char: new THREE.Texture(),
    overlay: new THREE.Texture(),
  } as unknown as AbilityVfxTextures;
  const at = (_id: number, _h: number, out: THREE.Vector3): boolean => {
    out.set(3, 0, 3);
    return true;
  };
  /** Whether some draw under `root` is on screen. */
  const shows = (root: THREE.Object3D): boolean =>
    drawsUnder(root).some(({ object }) => {
      for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        if (!node.visible) return false;
      }
      return true;
    });

  type Play = (caster: number) => { root: THREE.Object3D; play: () => void };
  const needle =
    (step: 'beginCast' | 'spawn'): Play =>
    (caster) => {
      const vfx = new NeedleOfFateVfx(new THREE.Scene(), new THREE.PerspectiveCamera(), at, false);
      return {
        root: vfx.group,
        play: () => {
          if (step === 'beginCast') vfx.beginCast(caster, 1);
          else vfx.spawn(caster, MOB);
          vfx.update(1 / 30);
        },
      };
    };
  const PLAYS: Array<[string, Play]> = [
    ['the Needle of Fate windup', needle('beginCast')],
    ['the Needle of Fate flight', needle('spawn')],
    [
      'Sentence',
      (caster) => {
        const vfx = new SentenceVfx(
          new THREE.Scene(),
          new THREE.PerspectiveCamera(),
          at,
          false,
          vi.fn(),
          TEXTURES,
        );
        return {
          root: vfx.group,
          play: () => {
            vfx.trigger(caster, MOB, 80, 3);
            vfx.update(1 / 30);
          },
        };
      },
    ],
    [
      'the released Glacial Front cone',
      (caster) => {
        const scene = new THREE.Scene();
        const visual = new GlacialFrontVisual(scene);
        const release = new THREE.Group();
        for (const child of scene.children.filter((o) => o.name === 'glacial-front-release'))
          release.add(child);
        scene.add(release);
        return {
          root: release,
          play: () => inEventFrom(caster, () => visual.spawn(0, 0, 0, 0, 16, 4)),
        };
      },
    ],
  ];

  it.each(PLAYS)(
    "%s: a player's draws while on, not while off; a mob's draws while off",
    (_, build) => {
      const on = build(PLAYER);
      on.play();
      expect(shows(on.root)).toBe(true);
      setSpellEffectsEnabled(false);
      const off = build(PLAYER);
      off.play();
      expect(shows(off.root)).toBe(false);
      const enemy = build(MOB);
      enemy.play();
      expect(shows(enemy.root)).toBe(true);
    },
  );

  it('spawns a Recklessness skull over its wearer only while that wearer is unmuted', () => {
    installCastVfxCanvasStub();
    const spawned = (owner: number) => {
      const parent = new THREE.Group();
      new RecklessSkullPainter().spawn(parent, 2, owner);
      return parent.children.length;
    };
    expect(spawned(PLAYER)).toBe(1);
    setSpellEffectsEnabled(false);
    expect(spawned(PLAYER)).toBe(0);
    expect(spawned(MOB)).toBe(1);
  });
});

describe('the world cues that are not spells', () => {
  it('draw through the shared emitters, so a muted scope never hides them', () => {
    setSpellEffectsEnabled(false);
    const calls: string[] = [];
    const vfx = {
      burst: () => calls.push('burst'),
      nova: (_id: number, school: string) => calls.push(`nova:${school}`),
      healGlow: () => calls.push('healGlow'),
    } as unknown as Vfx;
    inEventFrom(PLAYER, () => {
      playWorldCueFx(vfx, { type: 'worldObjectBurning', x: 0, z: 0 } as never, 1);
      playWorldCueFx(
        vfx,
        { type: 'delveRitePulse', entityId: OBJECT, shrineKind: 'rite_shrine_reed' } as never,
        1,
      );
      playWorldCueFx(
        vfx,
        { type: 'delveRiteFeedback', shrineId: OBJECT, correct: true } as never,
        1,
      );
      playWorldCueFx(
        vfx,
        { type: 'delveRiteFeedback', shrineId: OBJECT, correct: false } as never,
        1,
      );
    });
    expect(calls).toEqual(['burst', 'burst', 'nova:nature', 'healGlow', 'nova:shadow']);
  });

  it('colour each rite shrine by its accent', () => {
    expect(riteShrineSchool('rite_shrine_candle')).toBe('fire');
    expect(riteShrineSchool('rite_shrine_reed')).toBe('nature');
    expect(riteShrineSchool('rite_shrine_skull')).toBe('shadow');
    expect(riteShrineSchool('rite_shrine_bell')).toBe('holy');
    expect(riteShrineSchool(undefined)).toBe('holy');
  });
});

describe("the renderer's event dispatch", () => {
  /** A renderer stripped to what the spellfx and aura arms touch. */
  function harness() {
    const seen: Array<{ name: string; muted: boolean }> = [];
    const record =
      (name: string) =>
      (..._args: unknown[]) =>
        seen.push({ name, muted: spellEffectsMuted() });
    const renderer = Object.create(Renderer.prototype) as Record<string, unknown> & {
      handleEvent(ev: SimEvent): void;
    };
    renderer.abilityVfx = {
      handleSpellfx: () => false,
      onWarriorControlAura: () => false,
    };
    renderer.vfx = {
      spellNova: record('spellNova'),
      nova: record('nova'),
      spellBuffSwirl: record('spellBuffSwirl'),
      buffSwirl: record('buffSwirl'),
    };
    renderer.showChatBubble = () => {};
    renderer.sim = {
      playerId: PLAYER,
      player: { id: PLAYER },
      entities: new Map([
        [PLAYER, { id: PLAYER, kind: 'player', auras: [], ownerId: null }],
        [MOB, { id: MOB, kind: 'mob', auras: [], ownerId: null }],
      ]),
      cfg: { seed: 1 },
    };
    renderer.views = new Map();
    return { renderer, seen };
  }

  it("draws an unclaimed spell's nova through the gated twin, inside the caster's scope", () => {
    setSpellEffectsEnabled(false);
    const { renderer, seen } = harness();
    renderer.handleEvent({
      type: 'spellfx',
      sourceId: PLAYER,
      targetId: MOB,
      school: 'fire',
      fx: 'nova',
    } as SimEvent);
    expect(seen).toEqual([{ name: 'spellNova', muted: true }]);
    // The scope closed with the event.
    expect(spellEffectsMuted()).toBe(false);
  });

  it('draws an encounter cue that names a player as unattributed', () => {
    setSpellEffectsEnabled(false);
    const { renderer, seen } = harness();
    renderer.handleEvent({
      type: 'spellfx',
      sourceId: PLAYER,
      targetId: PLAYER,
      school: 'holy',
      fx: 'nova',
      ability: 'Soul Harvest',
    } as SimEvent);
    expect(seen).toEqual([{ name: 'spellNova', muted: false }]);
  });

  it("draws a player's aura swirl through the gated twin", () => {
    const { renderer, seen } = harness();
    renderer.handleEvent({
      type: 'aura',
      sourceId: PLAYER,
      targetId: PLAYER,
      gained: true,
      name: 'Arcane Intellect',
    } as unknown as SimEvent);
    expect(seen.map((s) => s.name)).toEqual(['spellBuffSwirl']);
  });

  it('routes the delve and burning-hut cues to the world cue module', () => {
    const { renderer } = harness();
    const nova = vi.fn();
    renderer.vfx = { nova, healGlow: vi.fn(), burst: vi.fn() };
    renderer.handleEvent({
      type: 'delveRitePulse',
      entityId: OBJECT,
      shrineKind: 'rite_shrine_candle',
    } as unknown as SimEvent);
    expect(nova).toHaveBeenCalledWith(OBJECT, 'fire');
  });

  it('uses the gated twins at every per-frame spell sparkle, and the shared emitter elsewhere', () => {
    // The per-frame entity loop is too deep to drive headless, so pin the
    // call sites in source (comments stripped): four spell or aura sparkles
    // ride the twin; the Soul Rend mark, the lit wardstone, the two rift
    // objects and the Spirit Healer shimmer keep the shared emitter. The same pin covers the
    // aimed-blast fallback burst.
    const src = readFileSync(
      fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const count = (needle: string) => src.split(needle).length - 1;
    expect(count('this.vfx.spellCastSparkle(')).toBe(4);
    expect(count('this.vfx.castSparkle(')).toBe(5);
    // The Nythraxis Soul Rend mark is a boss debuff on a raider: shared emitter.
    expect(count("if (hasSoulRend) {\n          this.vfx.castSparkle(e.id, 'shadow'")).toBe(1);
    expect(count('this.vfx.spellBurst(at, ev.school,')).toBe(1);
    expect(count('this.vfx.spellHealGlow(')).toBe(1);
  });
});

describe('the main.ts wiring', () => {
  it('pushes the stored value on boot and on every change', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const count = (needle: string) => src.split(needle).length - 1;
    expect(count("setSpellEffectsEnabled(settings.get('spellEffects'))")).toBe(1);
    expect(count("setSpellEffectsEnabled(settings.set('spellEffects', !!value))")).toBe(1);
    expect(count("if (key === 'spellEffects')")).toBe(1);
  });
});
