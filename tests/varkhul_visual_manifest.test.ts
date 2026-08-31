import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { IGNIVAR_RAID_ENVIRONMENT } from '../src/render/ignivar_raid_environment';
import { DUNGEON_MINIBOSS_STOMP_ABILITY_ID } from '../src/sim/mob/dungeon_miniboss_stomp';

describe('expanded Ignivar raid visual manifest', () => {
  it('routes the Forgefather to his authored smith body and strike clips', () => {
    expect(
      visualKeyFor({ kind: 'mob', templateId: 'varkhul_forgefather_of_the_last_flame' } as never),
    ).toBe('mob_varkhul_forgefather');
    expect(VISUALS.mob_varkhul_forgefather).toMatchObject({
      url: 'models/creatures/varkhul_forgefather.glb',
      height: 3,
      yaw: 0,
      deathGroundOffset: 0.565,
      clips: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        attack: ['Slash'],
        attackByAbility: {
          "Forgefather's Hammer": 'Forging',
          "Anvil's Decree": 'Forging',
          // each storm wave's windup cue powers him up; natural speed (the
          // playAttack default would rush it at 1.3)
          Forgestorm: 'PowerUp',
        },
        attackTimeScaleByAbility: {
          "Forgefather's Hammer": 0.815,
          "Anvil's Decree": 0.815,
          Forgestorm: 1,
        },
        cast: 'Casting',
        // the generic channel freezes on the pointing gesture's peak frame
        // (0.72s in) while the cast channels; the recovery plays out on
        // release
        castHoldPointSeconds: 0.72,
        // clips whose recovery must finish when the cast ends mid-clip;
        // Forging deliberately absent (the decree loop hands off instantly)
        castPlayOut: ['Casting', 'Slam'],
        castByAbility: {
          "Forgefather's Sweep": 'Slam',
          "Anvil's Decree": 'Forging',
        },
        castTimeScaleByAbility: {
          "Forgefather's Sweep": 0.65,
          "Anvil's Decree": 0.815,
        },
        flourish: 'PowerUp',
        death: 'Death',
      },
    });
    // The retired Slam meteor cast row must stay gone: Forgestorm is a
    // windup one-shot now, so a cast-loop mapping would fight it.
    expect(VISUALS.mob_varkhul_forgefather.clips.castByAbility?.Forgestorm).toBeUndefined();
    // Raid-wide damage must never thrash the boss rig: no hit mapping, like
    // the Ignivar colossus.
    expect(VISUALS.mob_varkhul_forgefather.clips.hit).toBeUndefined();
    // anti-slide gait refs are pinned so a retimed clip cannot silently skate
    expect(VISUALS.mob_varkhul_forgefather.walkRef).toBe(6.9);
    expect(VISUALS.mob_varkhul_forgefather.runRef).toBe(18);
  });

  it('routes all three second-boss adds to their dedicated automa bodies and authored clips', () => {
    expect(visualKeyFor({ kind: 'mob', templateId: 'ignivar_crucible_warden' } as never)).toBe(
      'mob_ignivar_crucible_warden',
    );
    expect(visualKeyFor({ kind: 'mob', templateId: 'ignivar_ember_sentinel' } as never)).toBe(
      'mob_ignivar_ember_sentinel',
    );
    expect(VISUALS.mob_ignivar_crucible_warden).toMatchObject({
      url: 'models/creatures/crucible_warden.glb',
      height: 2.2,
      yaw: 0,
      clips: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        attack: ['Attack'],
        attackByAbility: {
          crucible_quake: 'JumpSlam',
          [DUNGEON_MINIBOSS_STOMP_ABILITY_ID]: 'JumpSlam',
        },
        attackTimeScaleByAbility: {
          crucible_quake: 0.8,
          [DUNGEON_MINIBOSS_STOMP_ABILITY_ID]: 1.35,
        },
        hit: ['Hit'],
        death: 'Death',
      },
    });
    expect(VISUALS.mob_ignivar_ember_sentinel).toMatchObject({
      url: 'models/creatures/ember_sentinel.glb',
      height: 2.3,
      yaw: 0,
      clips: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        attack: ['Attack'],
        hit: ['Hit'],
        death: 'Death',
      },
    });
    expect(visualKeyFor({ kind: 'mob', templateId: 'ignivar_cinder_artificer' } as never)).toBe(
      'mob_ignivar_cinder_artificer',
    );
    expect(VISUALS.mob_ignivar_cinder_artificer).toMatchObject({
      url: 'models/creatures/cinder_artificer.glb',
      height: 2.1,
      yaw: 0,
      clips: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        attack: ['Attack'],
        attackByAbility: {
          cinder_recalibrate_start: 'ChannelStart',
          cinder_recalibrate_end: 'ChannelEnd',
        },
        cast: 'Channel',
        hit: ['Hit'],
        death: 'Death',
      },
    });
  });

  it('keeps every raid rig matte so room lights cannot lay a specular sheen on the bodies', () => {
    // Derived from the VISUALS table, not a hardcoded list, so a NEW raid rig
    // (any mob_ignivar* / mob_varkhul* def) must opt into matte or fail here.
    const raidKeys = Object.keys(VISUALS).filter(
      (key) => key.startsWith('mob_ignivar') || key.startsWith('mob_varkhul'),
    );
    // Vacuity floor: the shipped roster (both bosses, the Ashcaller add, the
    // three automata) must all be caught by the derivation.
    for (const key of [
      'mob_ignivar',
      'mob_ignivar_heart_of_the_end',
      'mob_ignivar_crucible_warden',
      'mob_ignivar_ember_sentinel',
      'mob_ignivar_cinder_artificer',
      'mob_varkhul_forgefather',
    ]) {
      expect(raidKeys, `derivation must include ${key}`).toContain(key);
    }
    for (const key of raidKeys) {
      expect(VISUALS[key].matte, `${key} must be matte`).toBe(true);
      // The old boosts (1.3 Ashcaller, 1.6 Forgefather) were dead config
      // (three overwrites per-material envMapIntensity with
      // scene.environmentIntensity under scene env); they stay retired so
      // nobody re-tunes a knob that cannot reach the shader.
      expect(VISUALS[key].envMapIntensity, `${key} must keep stock env`).toBeUndefined();
    }
    // The matte roster and the room grades are a tuned pair: the rooms may
    // not push the scene-wide daylight environment map back toward the
    // blue-white frost band the header of ignivar_raid_environment.ts
    // documents from 0.2 up (the full room-side ceilings live in
    // tests/ignivar_raid_environment.test.ts; this is the pairing pin).
    for (const profile of Object.values(IGNIVAR_RAID_ENVIRONMENT)) {
      expect(profile.envIntensity).toBeLessThanOrEqual(0.18);
    }
  });

  it('reuses the established archivist body for Maelin Emberward', () => {
    const maelin = visualKeyFor({
      kind: 'npc',
      templateId: 'archivist_maelin_emberward',
    } as never);
    const tullo = visualKeyFor({ kind: 'npc', templateId: 'archivist_tullo' } as never);
    expect(maelin).toBe(tullo);
    expect(maelin).toBe('npc_villager_robed');
  });
});
