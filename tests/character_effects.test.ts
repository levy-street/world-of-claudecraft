import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CharacterWeaponAura,
  characterRecklessnessActive,
  characterSoulRendActive,
  characterWeaponAuraColor,
  characterWeaponAuraInto,
} from '../src/render/character_effects';
import {
  CHARACTER_EFFECT_RECKLESSNESS,
  CHARACTER_EFFECT_SANGUINE,
  CHARACTER_EFFECT_SOUL_REND,
  characterEffectFlags,
  hasCharacterEffect,
} from '../src/render/character_effects_core';
import type { Entity } from '../src/sim/types';

function entity(partial: Partial<Entity>): Entity {
  return {
    id: 1,
    kind: 'player',
    templateId: '',
    name: 'Marked',
    level: 20,
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    facing: 0,
    prevFacing: 0,
    hp: 100,
    maxHp: 100,
    resource: 0,
    maxResource: 0,
    resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    auras: [],
    targetId: null,
    castRemaining: 0,
    castTotal: 0,
    castingAbility: null,
    channeling: false,
    dead: false,
    inCombat: false,
    swingTimer: 0,
    moveSpeed: 7,
    radius: 0.35,
    height: 1.8,
    scale: 1,
    color: 0xffffff,
    ownerId: null,
    petMode: 'defensive',
    petTargetId: null,
    petAttackTargetId: null,
    petReturnTarget: null,
    petNextActionAt: 0,
    hostile: false,
    aggroRadius: 0,
    aiState: 'idle',
    aggroTargetId: null,
    spawnPos: { x: 0, y: 0, z: 0 },
    leashOrigin: { x: 0, y: 0, z: 0 },
    threat: new Map(),
    tappedById: null,
    lootable: false,
    loot: null,
    questIds: [],
    patrol: null,
    patrolIndex: 0,
    fleeing: false,
    fleeTimer: 0,
    fleeReturnTimer: 0,
    fledOnce: false,
    summonedIds: [],
    summonedById: null,
    interactable: false,
    objectItemId: null,
    dungeonId: null,
    dungeonSlot: null,
    overheadEmoteId: null,
    overheadEmoteSeq: 0,
    overheadEmoteUntil: 0,
    ...partial,
  } as unknown as Entity;
}

describe('character visual effects', () => {
  it('detects Soul Rend as a model-level effect instead of a nameplate marker', () => {
    expect(characterSoulRendActive(entity({ auras: [] }))).toBe(false);
    expect(
      characterSoulRendActive(
        entity({
          auras: [
            {
              id: 'nythraxis_soul_rend',
              name: 'Soul Rend',
              kind: 'vulnerability',
              remaining: 8,
              duration: 8,
              value: 0,
              sourceId: 2,
              school: 'shadow',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('routes winning Warrior aura identities to their authored render layers', () => {
    const sanguine = {
      id: 'sanguine_aura',
      name: 'Sanguine Aura',
      kind: 'sanguine',
      remaining: 12,
      duration: 12,
      value: 0.1,
      sourceId: 1,
      school: 'physical',
    } as const;
    const reckless = {
      id: 'recklessness',
      name: 'Recklessness',
      kind: 'buff_reckless',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: 1,
      school: 'physical',
    } as const;

    expect(characterWeaponAuraColor(entity({ auras: [sanguine] }))).toBe(0xff4636);
    expect(characterRecklessnessActive(entity({ auras: [reckless] }))).toBe(true);
    expect(characterWeaponAuraColor(entity({ auras: [reckless] }))).toBe(null);
    expect(characterRecklessnessActive(entity({ auras: [sanguine] }))).toBe(false);
  });

  it('resolves the shaman imbues to their full-duration weapon soak colors', () => {
    const imbue = (id: string, school: 'fire' | 'frost' | 'physical') =>
      ({
        id,
        name: id,
        kind: 'imbue',
        remaining: 300,
        duration: 300,
        value: 8,
        sourceId: 1,
        school,
      }) as const;

    expect(characterWeaponAuraColor(entity({ auras: [imbue('flametongue_weapon', 'fire')] }))).toBe(
      0xff5a26,
    );
    expect(characterWeaponAuraColor(entity({ auras: [imbue('frostbrand_weapon', 'frost')] }))).toBe(
      0xbfe4ff,
    );
    // Rockbiter authors no weaponAura knob (owner opted only the two elemental
    // imbues in): its orbit band keeps carrying the read alone.
    expect(
      characterWeaponAuraColor(entity({ auras: [imbue('rockbiter_weapon', 'physical')] })),
    ).toBe(null);
  });

  it('scopes the rogue poisons: Festering Venom soaks the blade, Adders Bite tips it', () => {
    const coat = (id: string) =>
      ({
        id,
        name: id,
        kind: 'imbue',
        remaining: 1800,
        duration: 1800,
        value: 8,
        sourceId: 1,
        school: 'nature',
      }) as const;
    const scratch: CharacterWeaponAura = { color: 0, tip: false };

    // The mechanically bigger coat (14 damage/swing) wears the bigger read:
    // the full-blade sickly-green wash for the aura's whole 30 min.
    const deadly = characterWeaponAuraInto(entity({ auras: [coat('deadly_poison')] }), scratch);
    expect(deadly).toEqual({ color: 0x58d63c, tip: false });

    // The lesser coat (8 damage/swing) reads as a green-TIPPED weapon.
    const instant = characterWeaponAuraInto(entity({ auras: [coat('instant_poison')] }), scratch);
    expect(instant).toEqual({ color: 0x8fd455, tip: true });

    expect(characterWeaponAuraInto(entity({ auras: [] }), scratch)).toBe(null);
  });

  it('folds mixed aura identities into one renderer-pass bit mask', () => {
    const soulRend = {
      id: 'nythraxis_soul_rend',
      kind: 'vulnerability',
    } as const;
    const sanguine = {
      id: 'sanguine_aura',
      kind: 'sanguine',
    } as const;
    const reckless = {
      id: 'recklessness',
      kind: 'buff_reckless',
    } as const;
    const unrelated = {
      id: 'ice_block',
      kind: 'stasis',
    } as const;

    const flags = characterEffectFlags([unrelated, reckless, soulRend, sanguine]);
    expect(hasCharacterEffect(flags, CHARACTER_EFFECT_SOUL_REND)).toBe(true);
    expect(hasCharacterEffect(flags, CHARACTER_EFFECT_SANGUINE)).toBe(true);
    expect(hasCharacterEffect(flags, CHARACTER_EFFECT_RECKLESSNESS)).toBe(true);
    expect(characterEffectFlags([unrelated])).toBe(0);
  });

  it.each([
    ['Soul Rend', { id: 'nythraxis_soul_rend', kind: 'vulnerability' }, [true, false, false]],
    ['Sanguine', { id: 'sanguine_aura', kind: 'sanguine' }, [false, true, false]],
    ['Recklessness', { id: 'recklessness', kind: 'buff_reckless' }, [false, false, true]],
  ] as const)(
    'keeps the %s flag independent from every other character effect',
    (_, aura, expected) => {
      const flags = characterEffectFlags([aura]);
      expect([
        hasCharacterEffect(flags, CHARACTER_EFFECT_SOUL_REND),
        hasCharacterEffect(flags, CHARACTER_EFFECT_SANGUINE),
        hasCharacterEffect(flags, CHARACTER_EFFECT_RECKLESSNESS),
      ]).toEqual(expected);
    },
  );

  it('pins every folded renderer flag to its intended visual consumer', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain(
      'const hasSoulRend = hasCharacterEffect(characterEffects, CHARACTER_EFFECT_SOUL_REND);',
    );
    expect(renderer).toContain(
      'const hasRecklessness = hasCharacterEffect(characterEffects, CHARACTER_EFFECT_RECKLESSNESS);',
    );
    // The sanguine FLAG no longer drives the weapon overlay: the spec-driven
    // characterWeaponAuraInto supersedes it (it carries a color and a tip
    // scope, and covers the shaman imbues and the rogue poisons too), so the
    // flag and its bit are gone from the renderer rather than left computed
    // and unread. The overlay's own coverage lives in the cases above.
    expect(renderer).not.toContain('hasSanguineAura');
    expect(renderer).toContain(
      'v.visual.setWeaponAura(weaponAura ? weaponAura.color : null, weaponAura?.tip ?? false);',
    );
    expect(renderer).toContain('active.setSoulRend(hasSoulRend);');
    expect(renderer).toContain('this.abilityVfx.syncEntity(e, runCharacterPresentation);');
    expect(renderer).toContain("if (hasSoulRend) {\n          this.vfx.castSparkle(e.id, 'shadow'");
    expect(renderer).toContain(
      'if (hasRecklessness) {\n          this.vfx.recklessFlame(e.id, dt);',
    );
    expect(renderer).toContain('const nextRecklessSkullsLatch = nextRecklessnessSkullsLatch(');
    expect(renderer).toContain('v.recklessSkullsSpawned = nextRecklessSkullsLatch;');
  });
});
