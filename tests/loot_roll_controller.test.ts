import { describe, expect, it, vi } from 'vitest';
import type { LootRollGroupStatus, LootRollPrompt, SimEvent } from '../src/sim/types';
import { LootRollController } from '../src/ui/hud/loot/loot_roll_controller';
import { LOOT_ROLL_REGRACE_MS } from '../src/ui/hud/loot/loot_roll_reconcile';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';
import { FakeDocument, FakeElement } from './helpers/fake_dom';

class LootElement extends FakeElement {
  override set innerHTML(value: string) {
    super.innerHTML = value;
    if (value.includes('class="loot-roll-item"')) {
      const item = this.ownerDocument.createElement('div');
      item.className = 'loot-roll-item';
      this.appendChild(item);
    }
    for (const choice of value.matchAll(/data-choice="(need|greed|pass)"/g)) {
      const button = this.ownerDocument.createElement('button');
      button.dataset.choice = choice[1];
      this.appendChild(button);
    }
    if (value.includes('class="ml-all"')) {
      const selectAll = this.ownerDocument.createElement('input');
      selectAll.className = 'ml-all';
      (selectAll as unknown as HTMLInputElement).checked = false;
      this.appendChild(selectAll);
    }
    for (const pick of value.matchAll(/class="ml-pick" value="(\d+)"/g)) {
      const input = this.ownerDocument.createElement('input');
      input.className = 'ml-pick';
      input.value = pick[1];
      (input as unknown as HTMLInputElement).checked = false;
      this.appendChild(input);
    }
    if (value.includes('class="loot-roll-btn assign ml-roll"')) {
      const button = this.ownerDocument.createElement('button');
      button.className = 'ml-roll';
      (button as unknown as HTMLButtonElement).disabled = true;
      this.appendChild(button);
    }
  }

  override get innerHTML(): string {
    return super.innerHTML;
  }

  override querySelectorAll<T extends Element = Element>(selector: string): T[] {
    if (selector === '[data-choice]') {
      return this.children.filter((child) => child.dataset.choice) as unknown as T[];
    }
    return super.querySelectorAll<T>(selector);
  }
}

class LootDocument extends FakeDocument {
  override createElement(tagName: string): LootElement {
    return new LootElement(tagName.toUpperCase(), this);
  }
}

const prompt = (rollId = 7): LootRollPrompt => ({
  rollId,
  itemId: 'greyjaw_hide_boots',
  itemName: 'Greyjaw Hide Boots',
  quality: 'uncommon',
  expiresAt: 60_000,
});

const rollEvent = (rollId = 7): Extract<SimEvent, { type: 'lootRoll' }> => ({
  type: 'lootRoll',
  ...prompt(rollId),
});

function harness() {
  const document = new LootDocument();
  const ui = document.element('ui');
  const root = document.element('loot-rolls') as LootElement;
  ui.appendChild(root);
  let now = 1_000;
  let open: LootRollPrompt[] = [];
  let statuses: LootRollGroupStatus[] = [];
  const submitLootRoll = vi.fn();
  const assignMasterLoot = vi.fn();
  const writerCounts = { writes: 0, skips: 0 };
  const writers = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => writerCounts.writes++,
    () => writerCounts.skips++,
  );
  const world = {
    playerId: 2,
    activeLootRolls: () => open,
    lootRollGroupStatus: () => statuses,
    submitLootRoll,
    assignMasterLoot,
  } as unknown as Pick<
    IWorld,
    'activeLootRolls' | 'assignMasterLoot' | 'lootRollGroupStatus' | 'playerId' | 'submitLootRoll'
  >;
  const controller = new LootRollController({
    document: document as unknown as Document,
    world: () => world,
    now: () => now,
    isMobileLayout: () => false,
    itemIcon: () => '<img class="test-item-icon">',
    itemTooltip: () => 'tooltip',
    attachTooltip: () => {},
    writers,
  });
  return {
    controller,
    root,
    submitLootRoll,
    assignMasterLoot,
    setOpen: (next: LootRollPrompt[]) => {
      open = next;
    },
    setStatuses: (next: LootRollGroupStatus[]) => {
      statuses = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    writerCounts,
  };
}

describe('LootRollController', () => {
  it('recovers a missed event from the authoritative mirror and retires it after resolution', () => {
    const test = harness();
    test.setOpen([prompt()]);

    test.controller.update(test.now());

    expect(test.root.style.display).toBe('flex');
    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(1);

    test.setOpen([]);
    test.controller.update(test.now());

    expect(test.root.style.display).toBe('none');
    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(0);
  });

  it('submits the selected choice and suppresses a stale mirror until the retry grace expires', () => {
    const test = harness();
    test.setOpen([prompt()]);
    test.controller.showRoll(rollEvent());
    const row = test.root.querySelector<HTMLElement>('.loot-roll') as unknown as LootElement | null;
    const buttons =
      (row?.querySelectorAll<HTMLElement>('[data-choice]') as unknown as LootElement[]) ?? [];
    const greed = buttons.find((button) => button.dataset.choice === 'greed');

    greed?.dispatchEvent(new Event('click'));

    expect(test.submitLootRoll).toHaveBeenCalledWith(7, 'greed');
    expect(test.root.style.display).toBe('none');

    test.controller.update(test.now());
    expect(test.root.style.display).toBe('none');

    test.advance(LOOT_ROLL_REGRACE_MS);
    test.controller.update(test.now());
    expect(test.root.style.display).toBe('flex');
  });

  it('replaces a master-loot prompt when the server converts the same roll to need-greed', () => {
    const test = harness();
    test.controller.showMasterRoll({
      type: 'masterLoot',
      ...prompt(),
      candidates: [
        { pid: 2, name: 'Aki' },
        { pid: 3, name: 'Bex' },
      ],
    });
    expect(test.root.querySelector('.master')).not.toBeNull();

    test.controller.showRoll(rollEvent());

    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(1);
    expect(test.root.querySelector('.master')).toBeNull();
  });

  it('sends exactly the checked master-loot candidate subset through IWorld', () => {
    const test = harness();
    test.controller.showMasterRoll({
      type: 'masterLoot',
      ...prompt(),
      candidates: [
        { pid: 2, name: 'Aki' },
        { pid: 3, name: 'Bex' },
        { pid: 4, name: 'Cai' },
      ],
    });
    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    picks[0].checked = true;
    picks[2].checked = true;
    picks[0].dispatchEvent(new Event('change'));

    row?.querySelector<HTMLButtonElement>('.ml-roll')?.dispatchEvent(new Event('click'));

    expect(test.assignMasterLoot).toHaveBeenCalledWith(7, [2, 4]);
    expect(test.root.style.display).toBe('none');
  });

  it('elides a repeated timer fraction while still writing real time progress', () => {
    const test = harness();
    test.setOpen([prompt()]);
    test.controller.showRoll(rollEvent());
    expect(test.writerCounts).toEqual({ writes: 1, skips: 0 });

    test.controller.update(test.now());
    test.controller.update(test.now());
    expect(test.writerCounts).toEqual({ writes: 1, skips: 2 });

    test.advance(1_000);
    test.controller.update(test.now());
    expect(test.writerCounts).toEqual({ writes: 2, skips: 2 });
  });
});
