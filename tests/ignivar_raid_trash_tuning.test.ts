import { describe, expect, it } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  HEROIC_MOB_TUNING,
  NORMAL_DUNGEON_TUNING,
} from '../src/sim/content/dungeon_difficulty';
import { DUNGEONS } from '../src/sim/data';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { dungeonMinibossStompDamageMaxHp } from '../src/sim/mob/dungeon_miniboss_stomp';
import { ignivarCinderLanceDamageMaxHp } from '../src/sim/mob/ignivar_trash_automata';
import { Sim } from '../src/sim/sim';

const PREBOSS_ROOMS = [IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_MOLTEN_ASSEMBLY_ID] as const;

function tuningIdFor(roomId: (typeof PREBOSS_ROOMS)[number]): string {
  return DUNGEONS[roomId].mobDifficultyTuningId ?? roomId;
}

describe('Ignivar raid trash tuning', () => {
  it('keeps both preboss rooms on tuning that cannot reach Varkhul summons', () => {
    for (const roomId of PREBOSS_ROOMS) {
      expect(tuningIdFor(roomId)).toBe(roomId);
      expect(
        DUNGEONS[roomId].spawns.some((spawn) => spawn.mobId === IGNIVAR_CINDER_ARTIFICER_ID),
      ).toBe(false);
    }
  });

  it('pins Normal and Heroic pressure only for roles authored in each preboss room', () => {
    for (const roomId of PREBOSS_ROOMS) {
      expect(NORMAL_DUNGEON_TUNING[roomId]).toMatchObject({
        healthMultiplier: 1,
        damageMultiplierByMob: {
          derelict_mech: 1.5,
          ignivar_ember_sentinel: 1.5,
          ignivar_crucible_warden: 1.5,
        },
        mechanicDamageMultiplierByMob: {
          derelict_mech: 1.25,
          ignivar_ember_sentinel: 1.5,
          ignivar_crucible_warden: 2,
        },
      });
      expect(HEROIC_MOB_TUNING[roomId]).toMatchObject({
        healthMultiplier: 5 / 3,
        healthMultiplierByMob: {
          ignivar_ember_sentinel: 2,
          ignivar_crucible_warden: 2,
        },
        damageMultiplierByMob: {
          derelict_mech: 2,
          ignivar_ember_sentinel: 2,
          ignivar_crucible_warden: 2,
        },
        mechanicDamageMultiplierByMob: {
          derelict_mech: 1.75,
          ignivar_ember_sentinel: 2,
          ignivar_crucible_warden: 4,
        },
      });
      expect(NORMAL_DUNGEON_TUNING[roomId].damageMultiplierByMob).not.toHaveProperty(
        IGNIVAR_CINDER_ARTIFICER_ID,
      );
      expect(HEROIC_MOB_TUNING[roomId].damageMultiplierByMob).not.toHaveProperty(
        IGNIVAR_CINDER_ARTIFICER_ID,
      );
    }
  });

  it('restores the Varkhul room and its summoned adds to their previous tuning', () => {
    expect(NORMAL_DUNGEON_TUNING[IGNIVAR_SECOND_WING_ID]).toBeUndefined();
    expect(HEROIC_DUNGEON_TUNING[IGNIVAR_SECOND_WING_ID]).toMatchObject({
      healthMultiplier: 5 / 3,
      healthMultiplierByMob: {
        ignivar_ember_sentinel: (1_200 * 1.2) / 1_300,
        ignivar_crucible_warden: (1_395 * 1.25) / 1_505,
        ignivar_cinder_artificer: (2_170 * 1.3) / 2_330,
      },
      damageMultiplierByMob: {
        ignivar_ember_sentinel: (101.8 * 1.25) / 110.2,
        ignivar_crucible_warden: (92.2 * 1.25) / 99.8,
        ignivar_cinder_artificer: 1,
      },
      mechanicDamageMultiplierByMob: { ignivar_ember_sentinel: 1.25 },
      burnDamageMultiplierByMob: { ignivar_ember_sentinel: 1.25 },
    });
    expect(HEROIC_DUNGEON_TUNING[IGNIVAR_SECOND_WING_ID]).not.toHaveProperty(
      'rangedDamageMultiplierByMob',
    );
  });

  it('makes telegraphed corridor mechanics punishing by difficulty', () => {
    expect(ignivarCinderLanceDamageMaxHp('normal')).toBe(0.3);
    expect(ignivarCinderLanceDamageMaxHp('heroic')).toBe(0.55);
    expect(dungeonMinibossStompDamageMaxHp('normal')).toBe(0.4);
    expect(dungeonMinibossStompDamageMaxHp('heroic')).toBe(0.7);
  });

  it.each(
    PREBOSS_ROOMS.flatMap((roomId) =>
      (['normal', 'heroic'] as const).map((difficulty) => ({ roomId, difficulty })),
    ),
  )(
    'stamps the configured mechanic multipliers on $difficulty spawns in $roomId',
    ({ roomId, difficulty }) => {
      const sim = new Sim({ seed: 731, playerClass: 'warrior', devCommands: true });
      sim.setDungeonDifficulty(difficulty, sim.player.id);
      expect(enterDungeon(sim.ctx, roomId, sim.player.id, true)).toBe(true);
      const claim = sim.instances.find(
        (instance) => instance.dungeonId === roomId && instance.partyKey !== null,
      );
      if (!claim) throw new Error(`${roomId} claim missing`);
      const byTemplate = new Map(
        claim.mobIds.flatMap((id) => {
          const mob = sim.entities.get(id);
          return mob ? [[mob.templateId, mob] as const] : [];
        }),
      );

      if (roomId === IGNIVAR_FORGE_APPROACH_ID) {
        expect(byTemplate.get('derelict_mech')?.mechanicDamageMult).toBe(
          difficulty === 'heroic' ? 1.75 : 1.25,
        );
        expect(byTemplate.get('derelict_mech')?.weapon).toEqual(
          difficulty === 'heroic'
            ? { min: 284, max: 444, speed: 2.6 }
            : { min: 197, max: 308, speed: 2.6 },
        );
      } else {
        expect(byTemplate.has('derelict_mech')).toBe(false);
      }
      expect(byTemplate.get('ignivar_ember_sentinel')?.mechanicDamageMult).toBe(
        difficulty === 'heroic' ? 2 : 1.5,
      );
      expect(byTemplate.get('ignivar_ember_sentinel')?.weapon).toEqual(
        difficulty === 'heroic'
          ? { min: 264, max: 413, speed: 2.4 }
          : { min: 183, max: 286, speed: 2.4 },
      );
      expect(byTemplate.get('ignivar_crucible_warden')?.mechanicDamageMult).toBe(
        difficulty === 'heroic' ? 4 : 2,
      );
      expect(byTemplate.get('ignivar_crucible_warden')?.weapon).toEqual(
        difficulty === 'heroic'
          ? { min: 240, max: 374, speed: 2.8 }
          : { min: 166, max: 259, speed: 2.8 },
      );
    },
  );
});
