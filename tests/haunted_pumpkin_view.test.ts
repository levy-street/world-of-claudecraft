import { describe, expect, it } from 'vitest';
import { GOURDLIGHT_PUMPKINS } from '../src/sim/content/gourdlight_pumpkins';
import { hauntedPumpkinTrackerRow } from '../src/ui/haunted_pumpkin_view';
import { questStripView } from '../src/ui/hud/quest/quest_strip_core';
import { questEventPresentation } from '../src/ui/quest_event_view';

describe('Haunted Pumpkin presentation', () => {
  const first = GOURDLIGHT_PUMPKINS[0];

  it('only tracks during the event and does not require an accepted quest', () => {
    expect(hauntedPumpkinTrackerRow(null, [], first.zoneId)).toBeNull();
    expect(hauntedPumpkinTrackerRow('other', [], first.zoneId)).toBeNull();
    const row = hauntedPumpkinTrackerRow('gourdlight_eve', [], first.zoneId)!;
    expect(row.title).toBe('Haunted Pumpkins');
    expect(row.objectives).toHaveLength(2);
    expect(row.worldQuest).toBeUndefined();
    expect(row.number).toBe(0);
    const strip = questStripView([row], 0);
    expect(strip.visible).toBe(true);
    expect(strip.objectives).toHaveLength(2);
  });

  it('counts personal known ids once and retains full counts after completion', () => {
    const row = hauntedPumpkinTrackerRow(
      'gourdlight_eve',
      [first.id, first.id, 'unknown'],
      first.zoneId,
    )!;
    expect(row.objectives.map((objective) => objective.current)).toEqual([1, 1]);
    const completed = hauntedPumpkinTrackerRow(
      'gourdlight_eve',
      GOURDLIGHT_PUMPKINS.map((pumpkin) => pumpkin.id),
      first.zoneId,
    )!;
    expect(completed.objectives.every((objective) => objective.current === objective.total)).toBe(
      true,
    );
    expect(completed.objectives[1].label).toBe(
      `World: ${GOURDLIGHT_PUMPKINS.length}/${GOURDLIGHT_PUMPKINS.length}`,
    );
    expect(completed.complete).toBe(false);
  });

  it('keeps worldwide progress visible outside a collection zone', () => {
    const row = hauntedPumpkinTrackerRow('gourdlight_eve', [first.id], 'unknown')!;
    expect(row.objectives).toHaveLength(1);
    expect(row.objectives[0].current).toBe(1);
    expect(row.objectives[0].label).toContain('World:');
  });

  it('routes discovery through the existing log, progress flash and sound', () => {
    const result = questEventPresentation({
      type: 'seasonal',
      what: 'pumpkinFound',
      pumpkinId: first.id,
      zoneId: first.zoneId,
      count: 2,
      total: 5,
      sweets: 1,
    });
    expect(result).toMatchObject({
      logText: expect.stringContaining('2/5'),
      flashText: 'Haunted Pumpkin found! 2/5',
      sound: 'quest_ready',
    });
    expect(result?.logText).toContain('Gourdlight Sweets received: 1');
    expect(result?.logText).not.toContain(first.id);
  });
});
