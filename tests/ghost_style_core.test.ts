// Which translucent look a character wears (src/render/ghost_style_core.ts):
// every ethereal read is the spirit veil in its user's palette, stealth in one
// of two palettes by its source's aura id.

import { describe, expect, it } from 'vitest';
import {
  characterGhostLook,
  ROGUE_STEALTH_AURA_IDS,
  stealthVeilPalette,
} from '../src/render/ghost_style_core';
import { selfBuffAuraId } from '../src/sim/combat/aura_ids';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

const VIEWER = 1;

function entity(over: Partial<Entity> = {}): Entity {
  return {
    id: 7,
    kind: 'player',
    templateId: 'player',
    ghost: false,
    auras: [],
    ...over,
  } as unknown as Entity;
}

const stealthBy = (id: string): Partial<Entity> =>
  ({ auras: [{ kind: 'stealth', id }] }) as unknown as Partial<Entity>;
const stealth = stealthBy('stealth');

describe('characterGhostLook', () => {
  it('veils a released spirit in the released-spirit palette, whatever else it carries', () => {
    expect(characterGhostLook(VIEWER, entity({ ghost: true }), false, 'none')).toBe('spirit');
    // A dead stealther is a spirit first.
    expect(characterGhostLook(VIEWER, entity({ ghost: true, ...stealth }), false, 'none')).toBe(
      'spirit',
    );
    expect(characterGhostLook(VIEWER, entity({ ghost: true }), true, 'march')).toBe('spirit');
  });

  it('veils the Pale Keeper and the quest visions exactly like a released spirit', () => {
    const visions = Object.keys(MOBS).filter((id) => id.startsWith('vision_'));
    expect(visions).toEqual(
      expect.arrayContaining([
        'vision_aldren_warrior',
        'vision_malric_mage',
        'vision_deathstalker_voss',
      ]),
    );
    for (const templateId of visions) {
      expect(
        characterGhostLook(VIEWER, entity({ kind: 'mob', templateId }), false, 'none'),
        templateId,
      ).toBe('spirit');
    }
    expect(
      characterGhostLook(
        VIEWER,
        entity({ kind: 'npc', templateId: 'spirit_healer' }),
        false,
        'none',
      ),
    ).toBe('spirit');
  });

  it('gives Ghost Wolf and the Veilbound March their own palettes', () => {
    expect(characterGhostLook(VIEWER, entity(), true, 'none')).toBe('wolf');
    // A stealthed Ghost Wolf stays a wolf.
    expect(characterGhostLook(VIEWER, entity(stealth), true, 'none')).toBe('wolf');
    expect(characterGhostLook(VIEWER, entity(), true, 'march')).toBe('wolf');
    expect(characterGhostLook(VIEWER, entity(), false, 'march')).toBe('march');
  });

  it("veils a living stealther in its source's palette", () => {
    for (const id of ['stealth', 'vanish']) {
      expect(characterGhostLook(VIEWER, entity(stealthBy(id)), false, 'none'), id).toBe(
        'stealth-rogue',
      );
    }
    for (const id of ['prowl', 'greater_invisibility']) {
      expect(characterGhostLook(VIEWER, entity(stealthBy(id)), false, 'none'), id).toBe(
        'stealth-other',
      );
    }
    expect(characterGhostLook(VIEWER, entity(stealth), false, 'march')).toBe('stealth-rogue');
    // a rogue aura wins wherever it sits among the stealth auras
    expect(
      stealthVeilPalette([
        { kind: 'stealth', id: 'greater_invisibility' },
        { kind: 'buff', id: 'stealth' },
        { kind: 'stealth', id: 'vanish' },
      ] as never),
    ).toBe('stealth-rogue');
    expect(stealthVeilPalette([{ kind: 'buff', id: 'stealth' }] as never)).toBe('stealth-other');
  });

  it('classifies every stealth source in the ability table, by the aura id it applies', () => {
    // A new stealth source fails here until it is given a palette on purpose.
    const sources = new Map<string, string>();
    for (const ability of Object.values(ABILITIES)) {
      for (const effect of ability.effects) {
        if (effect.type === 'selfBuff' && effect.kind === 'stealth') {
          sources.set(selfBuffAuraId(ability, effect), ability.class ?? '');
        }
        if (effect.type === 'greaterInvisibility') sources.set(ability.id, ability.class ?? '');
      }
    }
    expect(Object.fromEntries(sources)).toEqual({
      stealth: 'rogue',
      vanish: 'rogue',
      prowl: 'druid',
      greater_invisibility: 'mage',
    });
    for (const [id, cls] of sources) {
      expect(ROGUE_STEALTH_AURA_IDS.has(id), id).toBe(cls === 'rogue');
    }
  });

  it('leaves everyone else opaque', () => {
    expect(characterGhostLook(VIEWER, entity(), false, 'none')).toBeNull();
    expect(characterGhostLook(VIEWER, entity(), false, 'mark')).toBeNull();
    expect(
      characterGhostLook(VIEWER, entity({ kind: 'mob', templateId: 'wolf' }), false, 'none'),
    ).toBeNull();
    // a stealth aura on a mob is never drawn as stealth (stealth.ts)
    expect(
      characterGhostLook(
        VIEWER,
        entity({ kind: 'mob', templateId: 'wolf', ...stealth }),
        false,
        'none',
      ),
    ).toBeNull();
  });
});
