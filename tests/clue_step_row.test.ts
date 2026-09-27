import { describe, expect, it } from 'vitest';
import { CLUE_HUNTS_BY_ID, type ClueHuntDef } from '../src/sim/content/clue_hunts';
import { clueStepRowFor, clueStepRowSig } from '../src/ui/hud/quest/clue_step_row_view';

// The playtest bug (2026-09-22): the fenwitch salt hunt's first step is a
// hand-over at Mother Sedge, an ordinary quest giver, and the gossip menu had
// no row for it, so the client never sent the interact and the salt was never
// taken. The row decision is pinned against the SHIPPED hunt so a content
// rename of the NPC or item id is caught here, not in play.
const SALT_HUNT = 'hunt_willowfen_fenwitch_salt';

const FIXTURE: ClueHuntDef = {
  id: 'hunt_fixture',
  steps: [
    { kind: 'landmark', zoneId: 'drakelands', poiId: 'wyrmwatch' },
    { kind: 'npc', npcId: 'gatecaptain_brannoc' },
    { kind: 'emote', emote: 'salute', zoneId: 'drakelands', poiId: 'the_gatewood' },
    { kind: 'deliver', npcId: 'quartermaster_sela', itemId: 'baked_bread', count: 2 },
    { kind: 'dig', zoneId: 'drakelands', x: 330, z: 2100 },
  ],
};
const HUNTS = { hunt_fixture: FIXTURE };

describe('clueStepRowFor', () => {
  it('the shipped salt hunt: step 0 is a hand-over of one cooking salt at Mother Sedge', () => {
    const shipped = CLUE_HUNTS_BY_ID[SALT_HUNT];
    expect(shipped).toBeDefined();
    expect(clueStepRowFor({ huntId: SALT_HUNT, step: 0 }, 'mother_sedge')).toEqual({
      kind: 'deliver',
      itemId: 'cooking_salt',
      count: 1,
    });
    // Any other NPC gets nothing for the same step.
    expect(clueStepRowFor({ huntId: SALT_HUNT, step: 0 }, 'widow_tansy')).toBeNull();
  });

  it('a talk step yields the talk row at its NPC only', () => {
    expect(
      clueStepRowFor({ huntId: 'hunt_fixture', step: 1 }, 'gatecaptain_brannoc', HUNTS),
    ).toEqual({ kind: 'talk' });
    expect(
      clueStepRowFor({ huntId: 'hunt_fixture', step: 1 }, 'quartermaster_sela', HUNTS),
    ).toBeNull();
  });

  it('a deliver step yields the hand-over row with the item and count at its NPC only', () => {
    expect(
      clueStepRowFor({ huntId: 'hunt_fixture', step: 3 }, 'quartermaster_sela', HUNTS),
    ).toEqual({ kind: 'deliver', itemId: 'baked_bread', count: 2 });
    expect(
      clueStepRowFor({ huntId: 'hunt_fixture', step: 3 }, 'gatecaptain_brannoc', HUNTS),
    ).toBeNull();
  });

  it('landmark, emote and dig steps, no hunt, an unknown hunt and a past-the-end step yield nothing', () => {
    for (const step of [0, 2, 4]) {
      expect(
        clueStepRowFor({ huntId: 'hunt_fixture', step }, 'gatecaptain_brannoc', HUNTS),
      ).toBeNull();
      expect(
        clueStepRowFor({ huntId: 'hunt_fixture', step }, 'quartermaster_sela', HUNTS),
      ).toBeNull();
    }
    expect(clueStepRowFor(null, 'quartermaster_sela', HUNTS)).toBeNull();
    expect(clueStepRowFor(undefined, 'quartermaster_sela', HUNTS)).toBeNull();
    expect(
      clueStepRowFor({ huntId: 'hunt_missing', step: 0 }, 'quartermaster_sela', HUNTS),
    ).toBeNull();
    expect(
      clueStepRowFor({ huntId: 'hunt_fixture', step: 5 }, 'quartermaster_sela', HUNTS),
    ).toBeNull();
  });

  it('the staleness signature separates none, talk and each hand-over', () => {
    expect(clueStepRowSig(null)).toBe('');
    expect(clueStepRowSig({ kind: 'talk' })).toBe('talk');
    expect(clueStepRowSig({ kind: 'deliver', itemId: 'baked_bread', count: 2 })).toBe(
      'deliver:baked_bread:2',
    );
    expect(clueStepRowSig({ kind: 'deliver', itemId: 'baked_bread', count: 1 })).not.toBe(
      clueStepRowSig({ kind: 'deliver', itemId: 'baked_bread', count: 2 }),
    );
  });
});
