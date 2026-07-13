// The target-of-target id resolver: WHICH field holds "who this entity targets"
// depends on entity kind (a mob/pet/npc uses aggroTargetId, a player/bot uses
// targetId). This pins that rule and the null (no target) cases, so the mini-frame
// reads the right field for each kind and hides when there is no target.

import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { targetOfTargetId } from '../src/ui/target_of_target';

type TotInput = Pick<Entity, 'kind' | 'targetId' | 'aggroTargetId'>;
const ent = (
  kind: Entity['kind'],
  targetId: number | null,
  aggroTargetId: number | null,
): TotInput => ({
  kind,
  targetId,
  aggroTargetId,
});

describe('targetOfTargetId', () => {
  it('a PLAYER target uses its selected targetId (never aggroTargetId)', () => {
    // A player's aggroTargetId stays null; even if some path set it, the player rule
    // reads targetId, so a player-vs-player target-of-target is the SELECTED target.
    expect(targetOfTargetId(ent('player', 7, null))).toBe(7);
    expect(targetOfTargetId(ent('player', 7, 99))).toBe(7);
  });

  it('a MOB / NPC target uses its aggroTargetId (its combat target)', () => {
    // Mobs (pets are mobs with an owner) track their combat target in aggroTargetId;
    // targetId stays null for them, and even if stale it is ignored, so the frame
    // shows who the mob is fighting.
    expect(targetOfTargetId(ent('mob', null, 42))).toBe(42);
    expect(targetOfTargetId(ent('npc', null, 3))).toBe(3);
    expect(targetOfTargetId(ent('mob', 500, 42))).toBe(42);
  });

  it('returns null when the entity is targeting nothing', () => {
    expect(targetOfTargetId(ent('player', null, null))).toBeNull();
    expect(targetOfTargetId(ent('mob', null, null))).toBeNull();
    expect(targetOfTargetId(ent('npc', null, null))).toBeNull();
  });
});
