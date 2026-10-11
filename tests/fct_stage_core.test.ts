// Beat staging for floating combat text: which authored contact a damage floater rides.
// Red Harvest resolves its three weapon strikes on ONE sim tick, so all three damage
// events reach the client in the same frame; the client plays the blades at
// FURY_AUDIO.red_harvest.times. These tests pin that the Nth strike of a cast maps to the
// Nth authored beat, that nothing else in the game is staged at all, and that the ordinal
// tracker is frame-scoped and bounded.

import { describe, expect, it } from 'vitest';
import { FURY_AUDIO } from '../src/game/fury_audio_core';
import {
  FCT_BEAT_SOURCE_SLOTS,
  FctBeatStager,
  fctBeatDelaySec,
  isBeatStagedAbility,
  RED_HARVEST_ABILITY_ID,
} from '../src/ui/fct_stage_core';

const BEATS = FURY_AUDIO.red_harvest.times;
const HARVEST = { sourceId: 7, abilityId: RED_HARVEST_ABILITY_ID } as const;

function stager(slots?: number): FctBeatStager {
  return new FctBeatStager(BEATS, slots);
}

describe('the authored beat table is the single source of the contact times', () => {
  it('is the three Red Harvest contacts, in order', () => {
    // The literal pin: the staging cannot silently drift off the audio/VFX contacts,
    // and no second copy of these numbers may exist (the core imports the table).
    expect([...BEATS]).toEqual([0.15, 0.32, 0.49]);
  });
});

describe('fctBeatDelaySec: the ordinal to beat mapping', () => {
  it('maps the three strikes of a Red Harvest to the three authored beats', () => {
    expect(fctBeatDelaySec(HARVEST, 0, BEATS)).toBe(0.15);
    expect(fctBeatDelaySec(HARVEST, 1, BEATS)).toBe(0.32);
    expect(fctBeatDelaySec(HARVEST, 2, BEATS)).toBe(0.49);
  });

  it('clamps a fourth (or later) strike to the LAST beat', () => {
    // A cleave or an echo can add a same-frame strike past the authored three. Falling
    // back to 0 would race it ahead of the numbers before it; the final blade is honest.
    expect(fctBeatDelaySec(HARVEST, 3, BEATS)).toBe(0.49);
    expect(fctBeatDelaySec(HARVEST, 9, BEATS)).toBe(0.49);
  });

  it('spawns immediately for a negative ordinal (the tracker declined to stage it)', () => {
    expect(fctBeatDelaySec(HARVEST, -1, BEATS)).toBe(0);
  });

  it('spawns immediately for every other ability, at every ordinal', () => {
    for (const abilityId of ['raging_gale', 'mortal_strike', 'whirlwind', null, undefined]) {
      for (const ordinal of [0, 1, 2, 3]) {
        expect(fctBeatDelaySec({ sourceId: 7, abilityId }, ordinal, BEATS)).toBe(0);
      }
    }
  });

  it('spawns immediately when the beat table is empty', () => {
    expect(fctBeatDelaySec(HARVEST, 0, [])).toBe(0);
  });

  it('classifies the staged ability by its stable id, not a display label', () => {
    expect(isBeatStagedAbility(RED_HARVEST_ABILITY_ID)).toBe(true);
    // The player-facing label is deliberately NOT a lookup key (src/sim/types.ts).
    expect(isBeatStagedAbility('Red Harvest')).toBe(false);
    expect(isBeatStagedAbility(undefined)).toBe(false);
    expect(isBeatStagedAbility(null)).toBe(false);
  });
});

describe('FctBeatStager: per-frame strike ordinals', () => {
  it('walks one caster through the three beats within a frame', () => {
    const beats = stager();
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
    expect(beats.delaySec(HARVEST, 100)).toBe(0.32);
    expect(beats.delaySec(HARVEST, 100)).toBe(0.49);
  });

  it('clamps the fourth same-frame strike to the last beat', () => {
    const beats = stager();
    for (let i = 0; i < 3; i++) beats.delaySec(HARVEST, 100);
    expect(beats.delaySec(HARVEST, 100)).toBe(0.49);
  });

  it('restarts the ordinals on the NEXT frame', () => {
    const beats = stager();
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
    expect(beats.delaySec(HARVEST, 100)).toBe(0.32);
    // A new frame clock is a new cast window: the next Red Harvest opens on beat one.
    expect(beats.delaySec(HARVEST, 150)).toBe(0.15);
    expect(beats.delaySec(HARVEST, 150)).toBe(0.32);
    expect(beats.delaySec(HARVEST, 150)).toBe(0.49);
  });

  it('counts each source separately, so two warriors in one frame both open on beat one', () => {
    const beats = stager();
    const other = { sourceId: 9, abilityId: RED_HARVEST_ABILITY_ID } as const;
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
    expect(beats.delaySec(other, 100)).toBe(0.15);
    expect(beats.delaySec(HARVEST, 100)).toBe(0.32);
    expect(beats.delaySec(other, 100)).toBe(0.32);
  });

  it('advances the beat for an AVOIDED strike too, so the next blade keeps its slot', () => {
    // The stager sees every damage event of the cast; the kind is not part of the
    // decision. If the second blade is dodged, the third must still land on beat three.
    const beats = stager();
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
    expect(beats.delaySec(HARVEST, 100)).toBe(0.32); // the dodged blade consumes its beat
    expect(beats.delaySec(HARVEST, 100)).toBe(0.49);
  });

  it('never consumes an ordinal for an unstaged ability', () => {
    const beats = stager();
    expect(beats.delaySec({ sourceId: 7, abilityId: 'mortal_strike' }, 100)).toBe(0);
    expect(beats.delaySec({ sourceId: 7 }, 100)).toBe(0); // an auto-attack carries no id
    // The interleaved auto-attacks moved nothing: the cast still opens on beat one.
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
  });

  it('is BOUNDED: past its source slots a frame stages nothing rather than growing', () => {
    const slots = 2;
    const beats = stager(slots);
    for (let id = 0; id < slots; id++) {
      expect(beats.delaySec({ sourceId: id, abilityId: RED_HARVEST_ABILITY_ID }, 100)).toBe(0.15);
    }
    // The overflow source is not staged at all (spawn at once, the pre-staging behavior).
    expect(beats.delaySec({ sourceId: slots, abilityId: RED_HARVEST_ABILITY_ID }, 100)).toBe(0);
    // ...and the slots are reclaimed by the next frame, not leaked.
    expect(beats.delaySec({ sourceId: slots, abilityId: RED_HARVEST_ABILITY_ID }, 200)).toBe(0.15);
  });

  it('defaults to a real bound', () => {
    expect(FCT_BEAT_SOURCE_SLOTS).toBeGreaterThan(0);
  });

  it('reset() forgets the frame, so the next strike opens on beat one', () => {
    const beats = stager();
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
    beats.reset();
    expect(beats.delaySec(HARVEST, 100)).toBe(0.15);
  });
});
