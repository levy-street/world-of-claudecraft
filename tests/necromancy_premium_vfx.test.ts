import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  ARMY_OF_THE_DEAD_VFX_FULL_SPEC,
  ARMY_OF_THE_DEAD_VFX_SPEC,
  BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC,
  BONE_MAGE_SHADOW_BOLT_VFX_SPEC,
  CORPSE_EXPLOSION_VFX_FULL_SPEC,
  CORPSE_EXPLOSION_VFX_SPEC,
  DEATH_ECHO_VFX_FULL_SPEC,
  DEATH_ECHO_VFX_SPEC,
  OSSUARY_MARK_DETONATE_VFX_FULL_SPEC,
  OSSUARY_MARK_VFX_FULL_SPEC,
  OSSUARY_MARK_VFX_SPEC,
  REAPING_COMMAND_VFX_FULL_SPEC,
  REAPING_COMMAND_VFX_SPEC,
  SOUL_LANCE_VFX_FULL_SPEC,
  SOUL_LANCE_VFX_SPEC,
} from '../src/render/necromancy_vfx_specs';
import {
  EMBERKIN_FELBOLT_VFX_FULL_SPEC,
  EMBERKIN_FELBOLT_VFX_SPEC,
} from '../src/render/warlock_pet_vfx_specs';

function fakeTextures(): AbilityVfxTextures {
  const texture = (): THREE.CanvasTexture => new THREE.Texture() as THREE.CanvasTexture;
  return {
    noise: texture(),
    ribbon: texture(),
    rune: texture(),
    ember: texture(),
    rime: texture(),
    crack: texture(),
    char: texture(),
    overlay: texture(),
  };
}

function painterHarness() {
  const sequenceBolt = vi.fn();
  const sequenceInstant = vi.fn();
  const sequenceInstantAt = vi.fn();
  const orbit = vi.fn(() => true);
  const windup = vi.fn(() => true);
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt,
    sequenceInstant,
    sequenceInstantAt,
    orbit,
    windup,
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
    holdShell: vi.fn(),
    holdGroundAura: vi.fn(() => false),
    groundYAt: vi.fn(() => 0),
  } as unknown as AbilityVfxFx;
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile: vi.fn(),
        lightningProjectile: vi.fn(),
        burst: vi.fn(),
        nova: vi.fn(),
        tick: vi.fn(),
        shoutwave: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
    },
    () => 0,
  );
  return { painter, sequenceBolt, sequenceInstant, sequenceInstantAt, orbit, windup };
}

describe('Necromancy premium VFX', () => {
  it('retints Emberkin fel-lance anatomy violet for the Bone Mage projectile', () => {
    expect(abilityVfxSpec('bone_mage_shadow_bolt')).toBe(BONE_MAGE_SHADOW_BOLT_VFX_SPEC);
    expect(abilityVfxFullSpec('bone_mage_shadow_bolt')).toBe(BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC);
    expect(BONE_MAGE_SHADOW_BOLT_VFX_SPEC).toMatchObject({
      c: '#8f4dff',
      p: 'shadow',
      pw: 1.05,
      sp: 30,
      rg: 0.7,
      b: { v: 30, h: 1.05, co: 1 },
      a: 'bolt',
    });
    expect(BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC).toMatchObject({
      archetype: 'bolt',
      palette: 'shadow',
      tint: '#8f4dff',
      accent: '#d8b0ff',
      rim: '#c998ff',
      power: 1.05,
      filler: true,
      bolt: {
        speed: 30,
        headScale: 1.05,
        style: 'felLance',
        core: '#18072f',
        accent: '#d8b0ff',
        coils: true,
        tracer: true,
      },
      impact: { ring: 0.7, sparks: 30, light: 1.15 },
    });
    expect(BONE_MAGE_SHADOW_BOLT_VFX_SPEC).toEqual({
      ...EMBERKIN_FELBOLT_VFX_SPEC,
      c: '#8f4dff',
      p: 'shadow',
    });
    expect(BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC).toEqual({
      ...EMBERKIN_FELBOLT_VFX_FULL_SPEC,
      palette: 'shadow',
      tint: '#8f4dff',
      accent: '#d8b0ff',
      rim: '#c998ff',
      bolt: {
        ...EMBERKIN_FELBOLT_VFX_FULL_SPEC.bolt,
        core: '#18072f',
        accent: '#d8b0ff',
      },
    });

    const h = painterHarness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 4,
        targetId: 2,
        school: 'shadow',
        fx: 'projectile',
        ability: 'bone_mage_shadow_bolt',
      }),
    ).toBe(true);
    expect(h.sequenceBolt).toHaveBeenCalledWith(
      'bone_mage_shadow_bolt',
      BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC,
      4,
      2,
      0x8f4dff,
      expect.any(Number),
      0,
      1,
      expect.any(Number),
    );
  });

  it('draws every Bone Mage fel-lance head piece from its purple palette', () => {
    const scene = new THREE.Scene();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(10, 1, 0)],
    ]);
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => anchors.get(id)?.clone() ?? null,
      fakeTextures(),
    );
    const bolt = BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC.bolt;
    if (!bolt) throw new Error('Bone Mage bolt DNA missing');

    ribbons.spawnTrailStyled(1, 2, 0x8f4dff, 0.3, {
      speed: bolt.speed ?? 30,
      style: bolt.style ?? 'comet',
      headSize: bolt.headScale ?? 1,
      coreHex: bolt.core ? Number.parseInt(bolt.core.slice(1), 16) : undefined,
      accentHex: bolt.accent ? Number.parseInt(bolt.accent.slice(1), 16) : undefined,
      coils: bolt.coils === true,
      jagTrail: false,
      forkEvery: 0,
      tracer: bolt.tracer === true,
      delay: 0,
      aimX: 0,
      aimY: 0,
      aimZ: 0,
      groundY: () => 0,
    });

    const head = vi.fn();
    ribbons.drawHeads(0, head);
    const colors = head.mock.calls.map((call) => call[3]);

    expect(colors).toEqual(expect.arrayContaining([0x8f4dff, 0x18072f]));
    expect(colors).not.toContain(0x0b3d1b);
  });

  it('opens Army of the Dead as a final-tier three-lane portal ritual', () => {
    expect(abilityVfxSpec('army_of_the_dead')).toBe(ARMY_OF_THE_DEAD_VFX_SPEC);
    expect(abilityVfxFullSpec('army_of_the_dead')).toBe(ARMY_OF_THE_DEAD_VFX_FULL_SPEC);
    expect(ARMY_OF_THE_DEAD_VFX_SPEC).toMatchObject({
      p: 'shadow',
      pw: 1.9,
      sp: 60,
      vr: 1,
      db: 1,
      sm: 1,
      li: 2,
      fin: 1,
      a: 'summon',
    });
    expect(ARMY_OF_THE_DEAD_VFX_FULL_SPEC).toMatchObject({
      archetype: 'summon',
      power: 1.9,
      finisher: true,
      windupStyle: 'runes',
      motifs: ['chains', 'implosion', 'pillars'],
      motifAt: 'target',
      decal: 'portal',
      screenFx: true,
      impact: {
        flipbook: true,
        ring: false,
        vRing: 1.8,
        sparks: 60,
        debris: true,
        smoke: true,
        light: 2,
        sample: 'imp_shadow',
      },
    });
  });

  it('gives Soul Lance a bespoke three-stream spectral spear sequence', () => {
    const h = painterHarness();

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'projectile',
        ability: 'soul_lance',
      }),
    ).toBe(true);

    expect(h.sequenceBolt).toHaveBeenCalledOnce();
    expect(h.sequenceBolt).toHaveBeenCalledWith(
      'soul_lance',
      SOUL_LANCE_VFX_FULL_SPEC,
      1,
      2,
      0x7b42c3,
      expect.any(Number),
      0,
      1,
      expect.any(Number),
    );
    expect(SOUL_LANCE_VFX_SPEC).toMatchObject({
      p: 'shadow',
      pw: 1.45,
      sp: 42,
      wu: 1.6,
    });
    expect(SOUL_LANCE_VFX_FULL_SPEC).toMatchObject({
      archetype: 'bolt',
      chargeStreams: 3,
      windupStyle: 'compression',
      bolt: {
        style: 'soulLance',
        speed: 26,
        coils: true,
      },
    });
  });

  it('draws a directional seven-part bone-and-soul head instead of an orb', () => {
    const scene = new THREE.Scene();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(10, 1, 0)],
    ]);
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => anchors.get(id)?.clone() ?? null,
      fakeTextures(),
    );
    const bolt = SOUL_LANCE_VFX_FULL_SPEC.bolt;
    if (!bolt) throw new Error('Soul Lance bolt DNA missing');

    ribbons.spawnTrailStyled(1, 2, 0x7b42c3, 0.3, {
      speed: bolt.speed ?? 26,
      style: bolt.style ?? 'comet',
      headSize: bolt.headScale ?? 1,
      coreHex: bolt.core ? Number.parseInt(bolt.core.slice(1), 16) : undefined,
      accentHex: bolt.accent ? Number.parseInt(bolt.accent.slice(1), 16) : undefined,
      coils: bolt.coils === true,
      jagTrail: false,
      forkEvery: 0,
      tracer: false,
      delay: 0,
      aimX: 0,
      aimY: 0,
      aimZ: 0,
      groundY: () => 0,
    });

    const head = vi.fn();
    ribbons.drawHeads(0, head);

    expect(head).toHaveBeenCalledTimes(7);
    expect(head.mock.calls[0][0]).toBeGreaterThan(head.mock.calls[1][0]);
    expect(head.mock.calls.map((call) => call[3])).toEqual(
      expect.arrayContaining([0xf2f0ff, 0x7b42c3, 0x25123d, 0x8ce7ed]),
    );
  });

  it('shows Ossuary Mark on application, while stored, and on detonation', () => {
    const h = painterHarness();

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'selfCast',
        ability: 'ossuary_mark',
      }),
    ).toBe(true);
    expect(h.sequenceInstant).toHaveBeenCalledWith(
      'ossuary_mark',
      OSSUARY_MARK_VFX_FULL_SPEC,
      1,
      2,
      0x6730a6,
      0,
      expect.any(Number),
    );

    h.painter.syncEntity({
      id: 2,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'ossuary_mark' }],
    });
    expect(h.orbit).toHaveBeenCalledWith(
      2,
      'runes',
      0x6730a6,
      expect.objectContaining({ n: 5, radius: 1.05 }),
      0,
    );

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'nova',
        ability: 'ossuary_mark_detonate',
      }),
    ).toBe(true);
    expect(h.sequenceInstant).toHaveBeenCalledWith(
      'ossuary_mark_detonate',
      OSSUARY_MARK_DETONATE_VFX_FULL_SPEC,
      1,
      2,
      expect.any(Number),
      0,
      expect.any(Number),
    );
    expect(OSSUARY_MARK_VFX_SPEC.bo).toBe('runes');
  });

  it('gives Death Echo creation and Corpse Explosion distinct point-anchored payoffs', () => {
    const h = painterHarness();

    expect(
      h.painter.handleSpellfxAt({
        sourceId: 1,
        x: 4,
        z: 6,
        school: 'shadow',
        fx: 'burst',
        ability: 'death_echo',
      }),
    ).toBe(true);
    expect(h.sequenceInstantAt).toHaveBeenCalledWith(
      'death_echo',
      DEATH_ECHO_VFX_FULL_SPEC,
      1,
      4,
      6,
      expect.any(Number),
      0,
      expect.any(Number),
    );

    expect(
      h.painter.handleSpellfxAt({
        sourceId: 1,
        x: 4,
        z: 6,
        radius: 8,
        school: 'shadow',
        fx: 'nova',
        ability: 'corpse_explosion',
      }),
    ).toBe(true);
    expect(h.sequenceInstantAt).toHaveBeenCalledWith(
      'corpse_explosion',
      CORPSE_EXPLOSION_VFX_FULL_SPEC,
      1,
      4,
      6,
      expect.any(Number),
      0,
      expect.any(Number),
    );
    expect(DEATH_ECHO_VFX_SPEC).toMatchObject({ pw: 1.08, a: 'nova' });
    expect(CORPSE_EXPLOSION_VFX_SPEC).toMatchObject({ pw: 1.62, sp: 52, fin: 1 });
    expect(CORPSE_EXPLOSION_VFX_FULL_SPEC).toMatchObject({
      motifs: ['implosion', 'fissure', 'pillars'],
      nova: { radius: 8 },
      screenFx: true,
    });
  });

  it('uses one premium command identity for melee servants and Bone Mages', () => {
    const melee = painterHarness();
    expect(
      melee.painter.handleSpellfx({
        sourceId: 3,
        targetId: 2,
        school: 'physical',
        fx: 'selfCast',
        ability: 'reaping_command',
      }),
    ).toBe(true);
    expect(melee.sequenceInstant).toHaveBeenCalledWith(
      'reaping_command',
      REAPING_COMMAND_VFX_FULL_SPEC,
      3,
      2,
      expect.any(Number),
      0,
      expect.any(Number),
    );

    const mage = painterHarness();
    expect(
      mage.painter.handleSpellfx({
        sourceId: 4,
        targetId: 2,
        school: 'shadow',
        fx: 'heavyBolt',
        ability: 'reaping_command',
      }),
    ).toBe(true);
    expect(mage.sequenceBolt).toHaveBeenCalledWith(
      'reaping_command',
      REAPING_COMMAND_VFX_FULL_SPEC,
      4,
      2,
      expect.any(Number),
      expect.any(Number),
      0,
      1,
      expect.any(Number),
    );
    expect(REAPING_COMMAND_VFX_SPEC).toMatchObject({ pw: 1.38, fin: 1 });
    expect(REAPING_COMMAND_VFX_FULL_SPEC).toMatchObject({
      motifs: ['chains', 'fissure'],
      bolt: { style: 'shadowFang', coils: true },
    });
  });

  it('routes all three authored moments through the production renderer', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const casting = readFileSync(
      new URL('../src/sim/combat/casting_lifecycle.ts', import.meta.url),
      'utf8',
    );
    const necromancy = readFileSync(
      new URL('../src/sim/combat/necromancy.ts', import.meta.url),
      'utf8',
    );

    expect(casting).toContain('ability: ability.id');
    expect(renderer).toContain('this.abilityVfx.handleSpellfx(ev)');
    expect(renderer).toContain('this.abilityVfx.handleSpellfxAt(ev)');
    expect(renderer).toContain('this.necromancyGroundFx.syncDeathEcho');
    expect(renderer).toContain('this.abilityVfx.handleSpellfxAt(ev)');
    expect(necromancy).toContain("ability: 'ossuary_mark_detonate'");
  });
});
