import { describe, expect, it } from 'vitest';
import { parseMaterialGroupingIntent } from '../server/material_stack_wire';
import { bagCapacity } from '../src/sim/bags';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import { Sim } from '../src/sim/sim';

const a = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } };
const b = { gatherer: { kind: 'character' as const, id: 22, name: 'Bru' } };
function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Ana');
  const meta = sim.players.get(pid)!;
  meta.inventory = [
    {
      itemId: 'copper_ore',
      count: 5,
      materialSources: [
        { source: a, count: 2 },
        { source: b, count: 3 },
      ],
    },
  ];
  return { sim, pid, meta };
}
describe('authoritative material grouping', () => {
  it('separates, sorts, reloads and explicitly combines without changing source totals', () => {
    const { sim, pid, meta } = setup();
    const target = captureMaterialStackSelection(meta.inventory, 'copper_ore', 0)!;
    sim.separateMaterialStack('copper_ore', target, undefined, pid);
    expect(meta.inventory.map((s) => s.count)).toEqual([2, 3]);
    expect(meta.inventory.every((s) => s.materialSeparated)).toBe(true);
    sim.sortInventory(pid);
    expect(meta.inventory).toHaveLength(2);
    const state = sim.serializeCharacter(pid)!;
    const restore = sim.addPlayer('warrior', 'Ana', { state });
    const restored = sim.players.get(restore)!;
    expect(restored.inventory.map((s) => s.materialSeparated)).toEqual([true, true]);
    sim.combineMaterialStacks(
      'copper_ore',
      captureMaterialStackSelection(restored.inventory, 'copper_ore', 0)!,
      restore,
    );
    expect(restored.inventory).toHaveLength(1);
    expect(restored.inventory[0]).toMatchObject({
      count: 5,
      materialSources: [
        { source: a, count: 2 },
        { source: b, count: 3 },
      ],
    });
    expect(restored.inventory[0].materialSeparated).toBeUndefined();
  });
  it('refuses full bags and stale same-count source changes before writing', () => {
    const { sim, pid, meta } = setup();
    while (meta.inventory.length < bagCapacity(meta.bags))
      meta.inventory.push({ itemId: 'not_a_material', count: 1 });
    const target = captureMaterialStackSelection(meta.inventory, 'copper_ore', 0)!;
    const before = structuredClone(meta.inventory);
    sim.separateMaterialStack('copper_ore', target, undefined, pid);
    expect(meta.inventory).toEqual(before);
    meta.inventory.pop();
    meta.inventory[0].materialSources = [{ source: b, count: 5 }];
    const changed = structuredClone(meta.inventory);
    sim.separateMaterialStack('copper_ore', target, [{ source: a, count: 1 }], pid);
    expect(meta.inventory).toEqual(changed);
    expect(
      sim
        .drainEvents()
        .some(
          (e) => e.type === 'error' && e.text === 'That material selection is no longer available.',
        ),
    ).toBe(true);
  });
  it('decodes exact sources but refuses malformed optional fields rather than defaulting', () => {
    const { meta } = setup();
    const target = captureMaterialStackSelection(meta.inventory, 'copper_ore', 0)!;
    const frame = { item: 'copper_ore', target };
    expect(parseMaterialGroupingIntent(frame)).toEqual({ itemId: 'copper_ore', target });
    expect(
      parseMaterialGroupingIntent({ ...frame, sources: [{ source: a, count: 1 }] })
        ?.selectedSources,
    ).toEqual([{ source: a, count: 1 }]);
    for (const sources of [
      null,
      undefined,
      [],
      'all',
      [{ source: a, count: 0 }],
      [{ source: a, count: 1.5 }],
    ])
      expect(parseMaterialGroupingIntent({ ...frame, sources })).toBeNull();
    expect(
      parseMaterialGroupingIntent({ ...frame, target: { ...target, anchor: null } }),
    ).toBeNull();
    expect(
      parseMaterialGroupingIntent({ ...frame, target: { ...target, slotIndex: -1 } }),
    ).toBeNull();
  });
});
