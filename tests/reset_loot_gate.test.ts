import { describe, expect, it, vi } from 'vitest';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import {
  corpseBlocksInstanceReset,
  isPersonalQuestSlot,
} from '../src/sim/instances/reset_loot_gate';
import { type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, LootSlot } from '../src/sim/types';

// The Crucible report: Varkhul's guaranteed Forgefather's Ember sits on the
// corpse as a personal quest slot, and while nobody took it the raid could not
// change difficulty ("loot remains inside"). A personal quest slot no longer
// blocks a reset; the reset delivers it to its recipients instead.
const EMBER = 'forgefathers_ember';
const LOOT_BLOCKED = 'You cannot reset instances while loot remains inside.';
const APPLIED = 'Dungeon difficulty set to Heroic.';

function raid(sim: Sim): { lead: PlayerMeta; ally: PlayerMeta } {
  const lead = sim.players.get(sim.addPlayer('warrior', 'Lead'))!;
  const ally = sim.players.get(sim.addPlayer('warrior', 'Ally'))!;
  sim.partyInvite(ally.entityId, lead.entityId);
  sim.partyAccept(ally.entityId);
  for (let i = 0; i < 3; i += 1) {
    const pid = sim.addPlayer('mage', `M${i}`);
    sim.partyInvite(pid, lead.entityId);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(lead.entityId);
  return { lead, ally };
}

function liveClaim(sim: Sim, dungeonId: string): InstanceSlot | undefined {
  return sim.instances.find((inst) => inst.dungeonId === dungeonId && inst.partyKey !== null);
}

// Lead walks the real doors down to the Inner Crucible (the dev arm stands in
// for the lift ride and interior gates, as in ignivar_weekly_lockout.test.ts),
// Varkhul is laid dead with `loot`, and the lead walks back out to the keep.
function crucibleWithLoot(loot: (lead: PlayerMeta, ally: PlayerMeta) => LootSlot[]) {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const { lead, ally } = raid(sim);
  if (!enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, lead.entityId)) throw new Error('lift');
  for (const room of [
    IGNIVAR_FORGE_APPROACH_ID,
    IGNIVAR_RAID_ARENA_ID,
    IGNIVAR_MOLTEN_ASSEMBLY_ID,
    IGNIVAR_SECOND_WING_ID,
  ]) {
    if (!enterDungeon(sim.ctx, room, lead.entityId, true)) throw new Error(`${room} entry`);
  }
  const wing = liveClaim(sim, IGNIVAR_SECOND_WING_ID)!;
  const varkhul = wing.mobIds
    .map((id) => sim.entities.get(id))
    .find((m): m is Entity => m?.templateId === VARKHUL_BOSS_ID)!;
  varkhul.dead = true;
  varkhul.lootable = true;
  varkhul.loot = { copper: 0, items: loot(lead, ally) };
  const e = sim.entities.get(lead.entityId)!;
  for (let hop = 0; hop < 6 && e.pos.x > DUNGEON_X_THRESHOLD; hop += 1) {
    leaveDungeon(sim.ctx, lead.entityId);
  }
  if (e.pos.x > DUNGEON_X_THRESHOLD) throw new Error('never left the raid');
  sim.drainEvents();
  return { sim, lead, ally, varkhul };
}

function errors(sim: Sim): string[] {
  return (sim.drainEvents() as { type: string; text?: string }[])
    .filter((ev) => ev.type === 'error')
    .map((ev) => ev.text ?? '');
}

const ember = (...pids: number[]): LootSlot => ({ itemId: EMBER, count: 1, personalFor: pids });

describe('personal quest slot predicate', () => {
  const varkhul = { templateId: VARKHUL_BOSS_ID };
  it('matches a live slot rolled by the mob own quest-gated loot entry', () => {
    expect(isPersonalQuestSlot(varkhul, ember(7))).toBe(true);
  });
  it.each<[string, { templateId: string }, LootSlot]>([
    ['an emptied slot', varkhul, { itemId: EMBER, count: 0, personalFor: [7] }],
    ['no recipients left', varkhul, { itemId: EMBER, count: 1, personalFor: [] }],
    ['a shared (non-personal) slot', varkhul, { itemId: EMBER, count: 1 }],
    ['a shared-personal token', varkhul, { ...ember(7), sharedPersonal: true }],
    // A held roll award is personal gear the winner may still come back for.
    ['a held roll award', varkhul, { itemId: 'varkhul_forgebreaker', count: 1, personalFor: [7] }],
    // Classified by the mob's quest entry, not the item kind.
    ['the quest item on a mob with no quest entry for it', { templateId: 'wolf' }, ember(7)],
  ])('rejects %s', (_label, mob, slot) => {
    expect(isPersonalQuestSlot(mob, slot)).toBe(false);
  });
});

describe('the Crucible difficulty change with an unclaimed quest item on Varkhul', () => {
  it('reproduces the report: only the Ember remains, and the change now applies', () => {
    const { sim, lead, ally, varkhul } = crucibleWithLoot((_l, a) => [ember(a.entityId)]);
    expect(corpseBlocksInstanceReset(sim.ctx, varkhul)).toBe(false);
    sim.setDungeonDifficulty('heroic', lead.entityId);
    const text = errors(sim);
    expect(text).not.toContain(LOOT_BLOCKED);
    expect(text).toContain(APPLIED);
    expect(liveClaim(sim, IGNIVAR_LIFT_ROOM_ID)?.difficulty).toBe('heroic');
    // The deeper room is freed with no replacement claim (the linked-room rule).
    expect(liveClaim(sim, IGNIVAR_SECOND_WING_ID)).toBeUndefined();
    expect(sim.ctx.countItem(EMBER, ally.entityId)).toBe(1);
    expect(sim.ctx.countItem(EMBER, lead.entityId)).toBe(0);
  });

  it('delivers one copy to every online recipient and empties the slot', () => {
    let slot!: LootSlot;
    const { sim, lead, ally } = crucibleWithLoot((l, a) => {
      slot = ember(l.entityId, a.entityId);
      return [slot];
    });
    sim.setDungeonDifficulty('heroic', lead.entityId);
    expect(errors(sim)).toContain(APPLIED);
    expect(sim.ctx.countItem(EMBER, lead.entityId)).toBe(1);
    expect(sim.ctx.countItem(EMBER, ally.entityId)).toBe(1);
    expect(slot.count).toBe(0);
    expect(slot.personalFor).toEqual([]);
  });

  it('skips a recipient who has gone offline and still pays the online one', () => {
    const { sim, lead, ally } = crucibleWithLoot((l, a) => [ember(a.entityId, l.entityId)]);
    const allyId = ally.entityId;
    sim.removePlayer(allyId);
    sim.drainEvents();
    sim.setDungeonDifficulty('heroic', lead.entityId);
    expect(errors(sim)).toContain(APPLIED);
    expect(sim.ctx.countItem(EMBER, lead.entityId)).toBe(1);
    expect(sim.players.has(allyId)).toBe(false);
  });

  it('skips a recipient whose bags cannot fit it, and the change still applies', () => {
    const { sim, lead, ally } = crucibleWithLoot((l, a) => [ember(l.entityId, a.entityId)]);
    const real = sim.ctx.canAddItem;
    const spy = vi
      .spyOn(sim.ctx, 'canAddItem')
      .mockImplementation((itemId, count, pid, copy) =>
        pid === ally.entityId ? false : real(itemId, count, pid, copy),
      );
    sim.setDungeonDifficulty('heroic', lead.entityId);
    spy.mockRestore();
    expect(errors(sim)).toContain(APPLIED);
    expect(sim.ctx.countItem(EMBER, lead.entityId)).toBe(1);
    expect(sim.ctx.countItem(EMBER, ally.entityId)).toBe(0);
  });

  it.each<[string, (l: PlayerMeta) => LootSlot[], number]>([
    ['a shared drop', () => [{ itemId: 'varkhul_forgebreaker', count: 1 }], 0],
    [
      'a held roll award',
      (l) => [{ itemId: 'varkhul_forgebreaker', count: 1, personalFor: [l.entityId] }],
      0,
    ],
    ['copper', () => [], 5],
  ])(
    'still refuses while %s remains beside the Ember, and hands nothing out',
    (_l, extra, copper) => {
      const { sim, lead, ally, varkhul } = crucibleWithLoot((l, a) => [
        ...extra(l),
        ember(a.entityId),
      ]);
      varkhul.loot!.copper = copper;
      sim.setDungeonDifficulty('heroic', lead.entityId);
      expect(errors(sim)).toContain(LOOT_BLOCKED);
      expect(liveClaim(sim, IGNIVAR_LIFT_ROOM_ID)?.difficulty).toBe('normal');
      expect(liveClaim(sim, IGNIVAR_SECOND_WING_ID)).toBeDefined();
      expect(sim.ctx.countItem(EMBER, ally.entityId)).toBe(0);
    },
  );

  it('still refuses while a need-greed roll is open on the corpse', () => {
    const { sim, lead, ally, varkhul } = crucibleWithLoot((_l, a) => [ember(a.entityId)]);
    sim.ctx.pendingLootRolls.set(9_999, { mobId: varkhul.id } as never);
    expect(corpseBlocksInstanceReset(sim.ctx, varkhul)).toBe(true);
    sim.setDungeonDifficulty('heroic', lead.entityId);
    sim.ctx.pendingLootRolls.delete(9_999);
    expect(errors(sim)).toContain(LOOT_BLOCKED);
    expect(sim.ctx.countItem(EMBER, ally.entityId)).toBe(0);
  });

  it('still blocks while an unclaimed harvest remains beside a quest slot', () => {
    // wild_boar carries both a harvest half and a quest-gated boar_hide entry.
    const { sim, varkhul } = crucibleWithLoot(() => []);
    varkhul.templateId = 'wild_boar';
    varkhul.loot = { copper: 0, items: [{ itemId: 'boar_hide', count: 1, personalFor: [7] }] };
    varkhul.harvestClaimedBy = null;
    expect(isPersonalQuestSlot(varkhul, varkhul.loot.items[0])).toBe(true);
    expect(corpseBlocksInstanceReset(sim.ctx, varkhul)).toBe(true);
    varkhul.harvestClaimedBy = 7;
    expect(corpseBlocksInstanceReset(sim.ctx, varkhul)).toBe(false);
  });

  it('a lootable corpse with no loot table still blocks (open roll or harvest window)', () => {
    const { sim, varkhul } = crucibleWithLoot(() => []);
    varkhul.loot = null;
    expect(corpseBlocksInstanceReset(sim.ctx, varkhul)).toBe(true);
  });
});
