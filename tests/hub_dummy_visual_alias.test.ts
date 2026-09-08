// The Eastbrook hub's two level-5 practice targets (content/practice_dummies.ts)
// share the Highwatch row's body (render/characters/manifest.ts MOB_KEYS), told
// apart only by the entity tint (mob_training_dummy: tint: 'entity'). This suite
// pins the literal alias for BOTH new ids against the real MOBS records, not just
// against the Highwatch row's own pre-existing coverage in tests/visual_manifest.test.ts,
// and pins the one fact that makes "friendly, not hostile" a render guarantee rather
// than an assumption: the healing dummy alone carries friendlyPracticeTarget.
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  FRIENDLY_PLAYER_DUMMY_ID,
  HUB_HEALING_DUMMY_ID,
  HUB_TRAINING_DUMMY_ID,
} from '../src/sim/content/practice_dummies';
import { MOBS } from '../src/sim/data';

describe('hub practice dummy render aliases', () => {
  it('both hub dummy ids render as the shared mob_training_dummy body', () => {
    expect(visualKeyFor({ kind: 'mob', templateId: HUB_TRAINING_DUMMY_ID } as never)).toBe(
      'mob_training_dummy',
    );
    expect(visualKeyFor({ kind: 'mob', templateId: HUB_HEALING_DUMMY_ID } as never)).toBe(
      'mob_training_dummy',
    );
  });

  it('the shared body tints per entity, so the alias alone never fixes a color', () => {
    const def = VISUALS.mob_training_dummy;
    expect(def).toBeDefined();
    expect(def.tint).toBe('entity');
    expect(def.tintStrength).toBeGreaterThan(0);
    expect(def.lazyPreload).toBe(true);
  });

  it('both hub ids resolve to real, distinct level-5 MOBS records', () => {
    const damage = MOBS[HUB_TRAINING_DUMMY_ID];
    const healing = MOBS[HUB_HEALING_DUMMY_ID];
    expect(damage).toBeDefined();
    expect(healing).toBeDefined();
    expect(damage.id).not.toBe(healing.id);
    expect(damage.maxLevel).toBe(5);
    expect(healing.maxLevel).toBe(5);
    expect(damage.dummy).toBe(true);
    expect(healing.dummy).toBe(true);
  });

  it('only the healing dummy is a friendly target; the damage dummy stays attackable', () => {
    expect(MOBS[HUB_HEALING_DUMMY_ID].friendlyPracticeTarget).toBe(true);
    expect(MOBS[HUB_TRAINING_DUMMY_ID].friendlyPracticeTarget).toBeUndefined();
  });

  it("the healing dummy carries the row's own ally-green, not the damage dummy's wood tan", () => {
    // mob_training_dummy's tint is 'entity': this color IS what the render draws,
    // so a future edit that lets the healing dummy drift off the ally family (or
    // onto the damage dummy's tan) would silently ship a healing target that
    // reads as hostile at a glance.
    expect(MOBS[HUB_HEALING_DUMMY_ID].color).toBe(MOBS[FRIENDLY_PLAYER_DUMMY_ID].color);
    expect(MOBS[HUB_HEALING_DUMMY_ID].color).not.toBe(MOBS[HUB_TRAINING_DUMMY_ID].color);
  });

  it('the Highwatch practice row keeps its own aliases untouched by the hub additions', () => {
    for (const id of [
      'training_dummy',
      'friendly_player_dummy',
      'normal_boss_dummy',
      'heroic_boss_dummy',
    ]) {
      expect(visualKeyFor({ kind: 'mob', templateId: id } as never)).toBe('mob_training_dummy');
    }
    expect(MOBS.training_dummy.maxLevel).not.toBe(5);
  });
});
