import { describe, expect, it } from 'vitest';
import type { WorldQuestProgress } from '../src/sim/types';
import { worldQuestCycleForResetDay } from '../src/sim/world_quest_rotation';
import { activeWorldQuestsForCycle } from '../src/sim/world_quests';
import {
  buildWorldQuestRailView,
  worldQuestRerollReason,
} from '../src/ui/hud/map/world_quest_rail_view';

const cycle = worldQuestCycleForResetDay('2026-08-31');
const board = activeWorldQuestsForCycle(cycle);
const log = (rows: Array<[string, WorldQuestProgress['state']]>) =>
  new Map<string, WorldQuestProgress>(
    rows.map(([questId, state]) => [questId, { questId, count: 0, state } as WorldQuestProgress]),
  );

describe('world quest rail view', () => {
  it('lists the whole shared board for the cycle, marking state and the selected row', () => {
    const first = board[0];
    const view = buildWorldQuestRailView({
      worldQuestCycle: cycle,
      worldQuestLog: log([
        [first.id, 'completed'],
        [board[1].id, 'active'],
      ]),
      worldQuestExpiresAtMs: 10_000,
      playerLevel: 20,
      selectedWorldQuestId: board[1].id,
    });
    expect(view.total).toBe(board.length);
    expect(view.completed).toBe(1);
    expect(view.rows[0]).toMatchObject({ questId: first.id, state: 'completed', selected: false });
    expect(view.rows[1]).toMatchObject({ questId: board[1].id, state: 'active', selected: true });
    expect(view.rows[2].state).toBe('available');
    expect(view.rows.every((row) => typeof row.factionId === 'string')).toBe(true);
  });

  it('shows a rerolled replacement in the old slot and flags it', () => {
    const [old, ...rest] = board;
    const replacement = rest.find((quest) => quest.zoneId === old.zoneId) ?? rest[0];
    const view = buildWorldQuestRailView({
      worldQuestCycle: cycle,
      worldQuestLog: new Map(),
      worldQuestReplacements: { [old.id]: replacement.id },
      worldQuestRerollCycle: cycle,
      worldQuestExpiresAtMs: 0,
      playerLevel: 20,
      selectedWorldQuestId: null,
    });
    expect(view.rows.some((row) => row.questId === old.id)).toBe(false);
    const row = view.rows.find((r) => r.questId === replacement.id);
    expect(row?.replacement).toBe(true);
    expect(view.reroll.usedToday).toBe(true);
  });

  it('an empty cycle (older server) lists nothing rather than phantom quests', () => {
    const view = buildWorldQuestRailView({
      worldQuestCycle: '',
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 0,
      playerLevel: 20,
      selectedWorldQuestId: null,
    });
    expect(view.rows).toEqual([]);
    expect(view.reroll).toEqual({
      questId: null,
      canReroll: false,
      reason: null,
      usedToday: false,
    });
  });

  it('asks the host whether the selected row can be replaced and keeps its reason by identity', () => {
    const target = board[0];
    const allowed = buildWorldQuestRailView({
      worldQuestCycle: cycle,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 0,
      playerLevel: 20,
      selectedWorldQuestId: target.id,
      canReroll: () => ({ canReroll: true }),
    });
    expect(allowed.reroll).toEqual({
      questId: target.id,
      canReroll: true,
      reason: null,
      usedToday: false,
    });
    const refused = buildWorldQuestRailView({
      worldQuestCycle: cycle,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 0,
      playerLevel: 20,
      selectedWorldQuestId: target.id,
      canReroll: () => ({
        canReroll: false,
        reason: 'Daily world quest reroll already used today.',
      }),
    });
    expect(refused.reroll.canReroll).toBe(false);
    expect(refused.reroll.reason).toBe('usedToday');
    const noHost = buildWorldQuestRailView({
      worldQuestCycle: cycle,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 0,
      playerLevel: 20,
      selectedWorldQuestId: target.id,
    });
    expect(noHost.reroll.canReroll).toBe(false);
    expect(noHost.reroll.reason).toBe('unknown');
  });

  it('maps every sim refusal text to an identity and degrades unknown wording', () => {
    expect(worldQuestRerollReason('No active world quest cycle.')).toBe('noCycle');
    expect(worldQuestRerollReason('Completed world quests cannot be rerolled.')).toBe('completed');
    expect(worldQuestRerollReason('In-progress world quests cannot be rerolled.')).toBe(
      'inProgress',
    );
    expect(worldQuestRerollReason('This world quest is not currently active for you.')).toBe(
      'notActive',
    );
    expect(worldQuestRerollReason('No alternative assignments available in this zone today.')).toBe(
      'noAlternative',
    );
    expect(worldQuestRerollReason('something new')).toBe('unknown');
    expect(worldQuestRerollReason(undefined)).toBe('unknown');
  });

  it('marks rows the character cannot take yet instead of hiding them', () => {
    const view = buildWorldQuestRailView({
      worldQuestCycle: cycle,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 0,
      playerLevel: 5,
      selectedWorldQuestId: null,
    });
    expect(view.rows.length).toBe(board.length);
    expect(view.rows.some((row) => row.belowLevel)).toBe(board.some((q) => q.minLevel > 5));
  });
});
