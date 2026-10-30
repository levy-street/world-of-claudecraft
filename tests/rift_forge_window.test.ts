// @vitest-environment happy-dom
// The Rift Forge window (src/ui/hud/rift_forge/rift_forge_window.ts), the thin
// painter over rift_forge_view.ts.
//
// Pins: open renders the wallet, one card per band with the ladder and socket
// lines, and the buttons call the IWorld pair with the exact bag slot; a `false`
// outcome (the online mirror's refused / closed ack) renders a visible refusal
// line rather than silence; a riftForgeResult event maps its structured reason
// to the localized status line and re-reads the payload; worn bands render the
// unequip hint; close restores the opener focus.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { riftBandItemLevel } from '../src/sim/rift/band_ladder';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import type { InvSlot, SimEvent } from '../src/sim/types';
import { RiftForgeWindow, type RiftForgeWindowDeps } from '../src/ui/hud/rift_forge';
import type { IWorld } from '../src/world_api';

type Call = { cmd: string; itemId: string; arg?: string; slotIndex?: number };

describe('RiftForgeWindow', () => {
  let root: HTMLElement;
  let win: RiftForgeWindow;
  let calls: Call[];
  let inventory: InvSlot[];
  let outcome: boolean | { ok: boolean };
  let restored: (HTMLElement | null)[];
  let gear: ReturnType<typeof createRiftGearInstance>;

  function world(): IWorld {
    return {
      inventory,
      equipment: {},
      equipmentInstances: {},
      cfg: { seed: 1, playerClass: 'warrior' },
      player: { name: 'Forgeproof', level: 20 },
      upgradeRiftItem: (itemId: string, target?: { slotIndex: number }) => {
        calls.push({ cmd: 'upgrade', itemId, slotIndex: target?.slotIndex });
        return outcome;
      },
      socketRiftGem: (itemId: string, gemId: string, target?: { slotIndex: number }) => {
        calls.push({ cmd: 'socket', itemId, arg: gemId, slotIndex: target?.slotIndex });
        return outcome;
      },
    } as unknown as IWorld;
  }

  function deps(overrides: Partial<RiftForgeWindowDeps> = {}): RiftForgeWindowDeps {
    return {
      root: () => root,
      world,
      closeOthers: () => {},
      captureFocus: () => document.getElementById('opener'),
      restoreFocus: (target) => void restored.push(target),
      itemTooltip: () => '<div>tip</div>',
      attachTooltip: () => {},
      ...overrides,
    };
  }

  it('identifies an enhanced same-shell copy before spending Essence', () => {
    const enhanced = {
      ...gear.instance,
      lootQuality: {
        version: 1 as const,
        tier: 4 as const,
        weights: [900, 100, 250, 750, 500] as [number, number, number, number, number],
      },
    };
    inventory.push({ itemId: gear.itemId, count: 1, instance: enhanced });
    win.open();
    const rows = root.querySelectorAll('.rf-ring');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.loot-quality-badge')).toBeNull();
    expect(rows[1].textContent).toContain('Transcendent');
    expect(rows[1].textContent).toContain('Item Level 37');
    expect(rows[1].querySelector('[data-upgrade]')?.textContent).toContain('38');
  });

  beforeEach(() => {
    document.body.innerHTML =
      '<button id="opener"></button><div id="rift-forge-window" class="window panel"></div>';
    root = document.getElementById('rift-forge-window') as HTMLElement;
    calls = [];
    restored = [];
    outcome = { ok: true };
    gear = createRiftGearInstance('window-test', 'S', 'warrior', 1);
    inventory = [
      { itemId: 'linen_cloth', count: 2 },
      { itemId: gear.itemId, count: 1, instance: gear.instance },
      { itemId: RIFT_ESSENCE_ITEM_ID, count: 9 },
      { itemId: RIFT_GEM_IDS[2], count: 1 },
    ];
    win = new RiftForgeWindow(deps());
  });

  afterEach(() => {
    win.close();
    document.body.innerHTML = '';
  });

  const text = () => root.textContent ?? '';

  it('opens with the wallet, one band card, the ladder line, and both forge controls', () => {
    win.open();
    expect(win.isOpen).toBe(true);
    expect(root.getAttribute('role')).toBe('dialog');
    expect(text()).toContain('Rift Forge');
    expect(text()).toContain('Rift Essence: 9');
    expect(root.querySelectorAll('.rf-ring')).toHaveLength(1);
    expect(text()).toContain('Rift upgrade 0/5');
    expect(text()).toContain('Rift gems 0/2');
    // The ladder line: the band's item level now, and what the next essence
    // step buys, quoted from band_ladder.ts.
    expect(text()).toContain(`Item Level ${riftBandItemLevel('S', 0)}`);
    expect(root.querySelector('[data-upgrade]')?.textContent).toContain(
      `Upgrade to item level ${riftBandItemLevel('S', 1)} (2 essence)`,
    );
    expect(root.querySelector<HTMLButtonElement>('[data-upgrade]')?.disabled).toBe(false);
    // Only the owned gem is offered, labelled with the rating its colour grants.
    const gemPick = root.querySelector<HTMLSelectElement>('[data-gem]');
    expect([...(gemPick?.options ?? [])].map((o) => o.value)).toEqual([RIFT_GEM_IDS[2]]);
    expect(gemPick?.options[0]?.textContent).toContain('+12 Hit Rating');
    expect(text()).not.toContain('replaces the oldest');
    expect(document.activeElement).toBe(root.querySelector('[data-close]'));
  });

  it('routes the buttons to the IWorld pair with the exact bag slot and the picked gem', async () => {
    win.open();
    // Each click holds the controls until its result event lands (the
    // double-spend pin below), so the sim's event is fed back between clicks.
    const settle = (action: 'upgrade' | 'socket') =>
      win.onResult({ type: 'riftForgeResult', pid: 1, ok: true, action, itemId: gear.itemId });
    root.querySelector<HTMLButtonElement>('[data-upgrade]')?.click();
    await Promise.resolve();
    settle('upgrade');
    root.querySelector<HTMLButtonElement>('[data-socket]')?.click();
    await Promise.resolve();
    settle('socket');
    expect(calls).toEqual([
      { cmd: 'upgrade', itemId: gear.itemId, slotIndex: 1 },
      { cmd: 'socket', itemId: gear.itemId, arg: RIFT_GEM_IDS[2], slotIndex: 1 },
    ]);
  });

  it('keeps the gem picker on a full band and names the gem the next socket replaces', () => {
    gear.instance.rift?.gems.push(RIFT_GEM_IDS[0], RIFT_GEM_IDS[1]);
    win.open();
    expect(text()).toContain('Rift gems 2/2');
    expect(root.querySelector('[data-socket]')).not.toBeNull();
    expect(text()).toContain('replaces the oldest, Crimson Rift Gem');
  });

  it('turns a false outcome (closed or refused wire) into a visible refusal line', async () => {
    outcome = false;
    win.open();
    root.querySelector<HTMLButtonElement>('[data-upgrade]')?.click();
    await Promise.resolve();
    await Promise.resolve();
    const status = root.querySelector('.rf-status');
    expect(status?.classList.contains('rf-status-error')).toBe(true);
    expect(status?.getAttribute('role')).toBe('alert');
    expect(status?.textContent).toContain('The forge refused');
  });

  it('releases a synchronous refusal (the offline Sim answer) and speaks its reason', async () => {
    // too_far and dead are returned, never emitted: without this arm the row
    // would sit disabled until the 6 s backstop with nothing said.
    outcome = { ok: false, reason: 'too_far' } as unknown as { ok: boolean };
    win.open();
    root.querySelector<HTMLButtonElement>('[data-upgrade]')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector('.rf-status')?.textContent).toContain('too far from the Rift Forge');
    expect(root.querySelector<HTMLButtonElement>('[data-upgrade]')?.disabled).toBe(false);
  });

  it('names the destroyed gem when a socket on a full band replaced it', () => {
    win.open();
    win.onResult({
      type: 'riftForgeResult',
      pid: 1,
      ok: true,
      action: 'socket',
      itemId: gear.itemId,
      replacedGem: RIFT_GEM_IDS[0],
    } as Extract<SimEvent, { type: 'riftForgeResult' }>);
    expect(root.querySelector('.rf-status')?.textContent).toContain(
      'Crimson Rift Gem was destroyed',
    );
  });

  it('maps a riftForgeResult reason to the status line and re-reads the payload', () => {
    win.open();
    if (gear.instance.rift) gear.instance.rift.upgradeLevel = 2;
    const refused: SimEvent = {
      type: 'riftForgeResult',
      pid: 1,
      ok: false,
      action: 'upgrade',
      itemId: gear.itemId,
      reason: 'insufficient_essence',
    };
    win.onResult(refused as Extract<SimEvent, { type: 'riftForgeResult' }>);
    expect(root.querySelector('.rf-status')?.textContent).toContain('Not enough Rift Essence');
    expect(text()).toContain('Rift upgrade 2/5');
    const done: SimEvent = {
      type: 'riftForgeResult',
      pid: 1,
      ok: true,
      action: 'socket',
      itemId: gear.itemId,
    };
    win.onResult(done as Extract<SimEvent, { type: 'riftForgeResult' }>);
    const status = root.querySelector('.rf-status');
    expect(status?.classList.contains('rf-status-error')).toBe(false);
    expect(status?.textContent).toContain('Socketed a gem into');
  });

  it('renders a worn band with the unequip hint and no controls, and the empty state', () => {
    const worn = new RiftForgeWindow(
      deps({
        world: () =>
          ({
            ...world(),
            inventory: [],
            equipment: { ring1: gear.itemId },
            equipmentInstances: { ring1: gear.instance },
          }) as unknown as IWorld,
      }),
    );
    worn.open();
    expect(root.querySelector('.rf-ring-worn')).not.toBeNull();
    expect(text()).toContain('Unequip it to forge');
    expect(root.querySelector('[data-upgrade]')).toBeNull();
    worn.close();
    const empty = new RiftForgeWindow(
      deps({ world: () => ({ ...world(), inventory: [] }) as unknown as IWorld }),
    );
    empty.open();
    expect(root.querySelector('.lb-empty')?.textContent).toContain('No Riftbound band');
    empty.close();
  });

  it('quotes the Riftwright greeting with the class spliced in', () => {
    win.open();
    const greeting = root.querySelector('.rf-greeting')?.textContent ?? '';
    expect(greeting).toContain('A Riftbound band remembers the break that made it');
    expect(greeting).not.toContain('$C');
  });

  it('holds the controls from the click until the result event lands (no double spend)', async () => {
    let resolveAck: (ok: boolean) => void = () => {};
    outcome = new Promise<boolean>((resolve) => {
      resolveAck = resolve;
    }) as unknown as { ok: boolean };
    win.open();
    const upgrade = () => root.querySelector<HTMLButtonElement>('[data-upgrade]');
    upgrade()?.click();
    await Promise.resolve();
    // The row re-rendered disabled while the ack is pending; a second click
    // (on the fresh button) sends nothing.
    expect(upgrade()?.disabled).toBe(true);
    upgrade()?.click();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    resolveAck(true);
    await Promise.resolve();
    await Promise.resolve();
    // A true ack alone does not release: the bags are still the old ones.
    expect(upgrade()?.disabled).toBe(true);
    win.onResult({
      type: 'riftForgeResult',
      pid: 1,
      ok: true,
      action: 'upgrade',
      itemId: gear.itemId,
      upgradeLevel: 1,
    } as Extract<SimEvent, { type: 'riftForgeResult' }>);
    expect(upgrade()?.disabled).toBe(false);
    upgrade()?.click();
    expect(calls).toHaveLength(2);
  });

  describe('refreshIfChanged (the Hud slow-band poll)', () => {
    it('rebuilds when loot lands and essence or a gem count moves', () => {
      win.open();
      expect(text()).toContain('Rift Essence: 9');
      inventory.push({ itemId: RIFT_ESSENCE_ITEM_ID, count: 4 });
      win.refreshIfChanged();
      expect(text()).toContain('Rift Essence: 13');
      inventory.push({ itemId: RIFT_GEM_IDS[0], count: 1 });
      win.refreshIfChanged();
      const pick = root.querySelector<HTMLSelectElement>('[data-gem]');
      expect([...(pick?.options ?? [])].map((o) => o.value)).toEqual([
        RIFT_GEM_IDS[0],
        RIFT_GEM_IDS[2],
      ]);
    });

    it("rebuilds when a band's level or sockets move", () => {
      win.open();
      if (gear.instance.rift) gear.instance.rift.upgradeLevel = 3;
      win.refreshIfChanged();
      expect(text()).toContain('Rift upgrade 3/5');
      gear.instance.rift?.gems.push(RIFT_GEM_IDS[1]);
      win.refreshIfChanged();
      expect(text()).toContain('Rift gems 1/2');
    });

    it('an unchanged repeat poll does not rebuild', () => {
      win.open();
      const card = root.querySelector('.rf-ring');
      win.refreshIfChanged();
      win.refreshIfChanged();
      expect(root.querySelector('.rf-ring')).toBe(card);
    });

    it("keeps each row's picked gem and the focused control across the rebuild", () => {
      inventory.push({ itemId: RIFT_GEM_IDS[0], count: 1 });
      win.open();
      const pick = () => root.querySelector<HTMLSelectElement>('[data-gem]');
      (pick() as HTMLSelectElement).value = RIFT_GEM_IDS[2];
      root.querySelector<HTMLButtonElement>('[data-socket]')?.focus();
      inventory.push({ itemId: RIFT_ESSENCE_ITEM_ID, count: 1 });
      win.refreshIfChanged();
      expect(text()).toContain('Rift Essence: 10');
      expect(pick()?.value).toBe(RIFT_GEM_IDS[2]);
      expect(document.activeElement).toBe(root.querySelector('[data-socket]'));
    });

    it('carries the pick and focus to the SAME band when a new band shifts the rows', () => {
      inventory.push({ itemId: RIFT_GEM_IDS[0], count: 1 });
      win.open();
      (root.querySelector('select[data-gem]') as HTMLSelectElement).value = RIFT_GEM_IDS[2];
      root.querySelector<HTMLButtonElement>('[data-socket]')?.focus();
      // A second band lands in the EARLIER bag slot: the original band's row
      // index moves from 0 to 1, its bag slot does not.
      inventory[0] = { itemId: gear.itemId, count: 1, instance: structuredClone(gear.instance) };
      win.refreshIfChanged();
      const picks = [...root.querySelectorAll<HTMLSelectElement>('select[data-gem]')];
      expect(picks).toHaveLength(2);
      expect(picks[0].value, 'the newcomer starts unpicked').toBe(RIFT_GEM_IDS[0]);
      expect(picks[1].value, 'the pick followed its band').toBe(RIFT_GEM_IDS[2]);
      expect(document.activeElement).toBe(root.querySelectorAll('[data-socket]')[1]);
    });

    it("keeps the band list's scroll offset across a poll rebuild", () => {
      win.open();
      const body = root.querySelector<HTMLElement>('.rf-body');
      if (body) body.scrollTop = 120;
      inventory.push({ itemId: RIFT_ESSENCE_ITEM_ID, count: 1 });
      win.refreshIfChanged();
      const rebuilt = root.querySelector<HTMLElement>('.rf-body');
      expect(rebuilt, 'the poll must really rebuild the list').not.toBe(body);
      expect(rebuilt?.scrollTop).toBe(120);
    });

    it('a reopen starts with no carried pick', () => {
      inventory.push({ itemId: RIFT_GEM_IDS[0], count: 1 });
      win.open();
      (root.querySelector('select[data-gem]') as HTMLSelectElement).value = RIFT_GEM_IDS[2];
      win.close();
      win.open();
      expect(root.querySelector<HTMLSelectElement>('select[data-gem]')?.value).toBe(
        RIFT_GEM_IDS[0],
      );
    });

    it('relocalize re-latches: the next unchanged poll does not rebuild', () => {
      win.open();
      win.relocalize();
      const card = root.querySelector('.rf-ring');
      win.refreshIfChanged();
      expect(root.querySelector('.rf-ring')).toBe(card);
    });

    it('holds while a gem picker has focus or a click awaits its result', async () => {
      win.open();
      root.querySelector<HTMLSelectElement>('[data-gem]')?.focus();
      inventory.push({ itemId: RIFT_ESSENCE_ITEM_ID, count: 1 });
      win.refreshIfChanged();
      expect(text()).toContain('Rift Essence: 9');
      // The latch stayed unmoved: once the picker lets go, the poll catches up.
      (document.activeElement as HTMLElement).blur();
      win.refreshIfChanged();
      expect(text()).toContain('Rift Essence: 10');

      outcome = new Promise<boolean>(() => {}) as unknown as { ok: boolean };
      root.querySelector<HTMLButtonElement>('[data-upgrade]')?.click();
      await Promise.resolve();
      inventory.push({ itemId: RIFT_ESSENCE_ITEM_ID, count: 1 });
      win.refreshIfChanged();
      expect(text()).toContain('Rift Essence: 10');
    });

    it('is inert while closed', () => {
      inventory.push({ itemId: RIFT_ESSENCE_ITEM_ID, count: 1 });
      win.refreshIfChanged();
      expect(root.innerHTML).toBe('');
    });
  });

  it('close restores focus to the opener and is idempotent', () => {
    win.open();
    win.close();
    expect(win.isOpen).toBe(false);
    expect(restored).toEqual([document.getElementById('opener')]);
    win.close();
    expect(restored).toHaveLength(1);
  });
});
