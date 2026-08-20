import { describe, expect, it, vi } from 'vitest';
import { CROSS_HOTBAR_ATTACK_ID } from '../src/game/cross_hotbar';
import { createPadTargetPick, type PadTargetPickWorld } from '../src/game/pad_target_pick';
import type { ResolvedAbility } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';

const PLAYER_ID = 1;

function entity(id: number, kind: string, x: number, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    kind,
    dead: false,
    hostile: kind === 'mob',
    pos: { x, y: 0, z: 0 },
    ...extra,
  } as unknown as Entity;
}

function harness(
  entities: Entity[],
  targetId: number | null = null,
  player: { known?: ResolvedAbility[]; auras?: { kind: string }[] } = {},
) {
  const targetEntity = vi.fn();
  const interactKey = vi.fn();
  const world: PadTargetPickWorld = {
    player: {
      id: PLAYER_ID,
      pos: { x: 0, y: 0, z: 0 },
      targetId,
      auras: player.auras ?? [],
    } as unknown as PadTargetPickWorld['player'],
    playerId: PLAYER_ID,
    entities: new Map(entities.map((e) => [e.id, e])),
    known: player.known ?? [],
    targetEntity,
  };
  return { pick: createPadTargetPick({ world, interactKey }), targetEntity, interactKey };
}

// A learned action whose button transforms into a targeted one while an aura is up.
// Synthetic because every shipped replacement pair happens to agree on whether a
// target is needed, which is exactly what makes the base-id read look harmless.
const SWAP_AURA = 'pad_target_pick_swap';
const swapsIntoTargeted = {
  def: {
    id: 'swap_base',
    requiresTarget: false,
    actionReplacement: { abilityId: 'hammer_of_grace', auraKind: SWAP_AURA },
  },
} as unknown as ResolvedAbility;

const OUT_OF_REACH = INTERACT_RANGE + 5;

describe('padTargetPick.interact', () => {
  it('keeps an npc that is already selected and within reach', () => {
    const { pick, targetEntity, interactKey } = harness(
      [entity(7, 'npc', 1), entity(8, 'npc', 2)],
      7,
    );
    pick.interact();
    expect(targetEntity).not.toHaveBeenCalled();
    expect(interactKey).toHaveBeenCalledWith(7);
  });

  it('selects the nearest npc when the selected one is out of reach', () => {
    const { pick, targetEntity, interactKey } = harness(
      [entity(7, 'npc', OUT_OF_REACH), entity(8, 'npc', 3), entity(9, 'npc', 9)],
      7,
    );
    pick.interact();
    expect(targetEntity).toHaveBeenCalledWith(8);
    expect(interactKey).toHaveBeenCalledWith(8);
  });

  it('selects the nearest npc when nothing is selected', () => {
    const { pick, targetEntity, interactKey } = harness([entity(9, 'npc', 6), entity(8, 'npc', 2)]);
    expect(targetEntity).not.toHaveBeenCalled();
    pick.interact();
    expect(targetEntity).toHaveBeenCalledWith(8);
    expect(interactKey).toHaveBeenCalledWith(8);
  });

  it('does not treat a selected non-npc as the npc to talk to', () => {
    const { pick, targetEntity, interactKey } = harness(
      [entity(4, 'mob', 1), entity(8, 'npc', 2)],
      4,
    );
    pick.interact();
    expect(targetEntity).toHaveBeenCalledWith(8);
    expect(interactKey).toHaveBeenCalledWith(8);
  });

  it('interacts with no preference when no npc is nearby', () => {
    const { pick, targetEntity, interactKey } = harness([entity(9, 'npc', OUT_OF_REACH)]);
    pick.interact();
    expect(targetEntity).not.toHaveBeenCalled();
    expect(interactKey).toHaveBeenCalledWith(null);
  });
});

describe('padTargetPick.autoTarget', () => {
  it('picks a hostile for the basic Attack, which has no ABILITIES record', () => {
    const { pick, targetEntity } = harness([entity(3, 'mob', 12), entity(2, 'mob', 4)]);
    pick.autoTarget({ type: 'ability', id: CROSS_HOTBAR_ATTACK_ID });
    expect(targetEntity).toHaveBeenCalledWith(2);
  });

  it('leaves a live hostile selection alone', () => {
    const { pick, targetEntity } = harness([entity(2, 'mob', 12), entity(3, 'mob', 1)], 2);
    pick.autoTarget({ type: 'ability', id: CROSS_HOTBAR_ATTACK_ID });
    expect(targetEntity).not.toHaveBeenCalled();
  });

  it('replaces a dead selection', () => {
    const { pick, targetEntity } = harness(
      [entity(2, 'mob', 1, { dead: true }), entity(3, 'mob', 5)],
      2,
    );
    pick.autoTarget({ type: 'ability', id: CROSS_HOTBAR_ATTACK_ID });
    expect(targetEntity).toHaveBeenCalledWith(3);
  });

  it('picks a hostile for an ability that requires one', () => {
    const { pick, targetEntity } = harness([entity(5, 'mob', 3)]);
    pick.autoTarget({ type: 'ability', id: 'hammer_of_grace' });
    expect(targetEntity).toHaveBeenCalledWith(5);
  });

  it('never yanks the player off an ally for a friendly ability', () => {
    const { pick, targetEntity } = harness([entity(5, 'mob', 3)]);
    pick.autoTarget({ type: 'ability', id: 'beacon_of_light' });
    expect(targetEntity).not.toHaveBeenCalled();
  });

  it('leaves an untargeted ability untargeted', () => {
    const { pick, targetEntity } = harness([entity(5, 'mob', 3)]);
    pick.autoTarget({ type: 'ability', id: 'aura_mastery' });
    expect(targetEntity).not.toHaveBeenCalled();
  });

  it('judges the press on the replacement an aura swapped in, not the learned base id', () => {
    const { pick, targetEntity } = harness([entity(5, 'mob', 3)], null, {
      known: [swapsIntoTargeted],
      auras: [{ kind: SWAP_AURA }],
    });
    pick.autoTarget({ type: 'ability', id: 'swap_base' });
    expect(targetEntity).toHaveBeenCalledWith(5);
  });

  it('reads the base definition while the transforming aura is absent', () => {
    const { pick, targetEntity } = harness([entity(5, 'mob', 3)], null, {
      known: [swapsIntoTargeted],
    });
    pick.autoTarget({ type: 'ability', id: 'swap_base' });
    expect(targetEntity).not.toHaveBeenCalled();
  });

  it('ignores item presses', () => {
    const { pick, targetEntity } = harness([entity(5, 'mob', 3)]);
    pick.autoTarget({ type: 'item', id: CROSS_HOTBAR_ATTACK_ID });
    expect(targetEntity).not.toHaveBeenCalled();
  });

  it('does not pick a friendly npc as an attack target', () => {
    const { pick, targetEntity } = harness([entity(6, 'npc', 2)]);
    pick.autoTarget({ type: 'ability', id: CROSS_HOTBAR_ATTACK_ID });
    expect(targetEntity).not.toHaveBeenCalled();
  });
});
