// @vitest-environment happy-dom
// The World PvP Skull Bag's client surface (src/ui/hud/skull_bag/): the pure
// pane view (rows, carried count, signature, the take action), the pane
// painter docked in the bags window (markup, buttons, the signature-gated
// refresh), the bag click route and hover hint (src/ui/bags_view.ts), the item
// tooltip line, the Goods section of the honor shop, the ClientWorld send and
// the server's command boundary (server/world_pvp_wire.ts), and the
// sim-line matchers (src/ui/sim_i18n.ts).
import { describe, expect, it, vi } from 'vitest';
import { dispatchWorldPvpCommand, emitSkullBagSelfKey } from '../server/world_pvp_wire';
import { applySocialSelfWire, type SocialSelfMirrors } from '../src/net/social_self_wire';
import { ITEMS } from '../src/sim/data';
import {
  SKULL_BAG_MISSING_LINE,
  SKULL_BAG_NOTHING_LINE,
  SKULL_BAG_STORED_ALL_LINE,
  SKULL_BAG_STORED_LINE,
  WORLD_PVP_SKULL_BAG_ITEM_ID,
  WORLD_PVP_SKULL_ITEM_ID,
} from '../src/sim/pvp';
import type { PlayerMeta } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { type BagMode, bagItemAction, bagTooltipHintKey } from '../src/ui/bags_view';
import {
  carriedSkullCount,
  SkullBagPaneController,
  skullBagPaneView,
  skullBagTakeAction,
  skullBagTooltipLines,
} from '../src/ui/hud/skull_bag';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';
import type { SkullBagAction, SkullBagInfo, WorldPvpInfo } from '../src/world_api';

const NO_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  bankOpen: false,
  bankDeposit: false,
  bankSocketable: false,
  guildBankDeposit: false,
  vaultDeposit: false,
  petFeed: false,
};

function victim(id: number, name: string, count = 1) {
  return { source: { gatherer: { kind: 'character' as const, id, name } }, count };
}

const INFO: SkullBagInfo = {
  owned: true,
  total: 6,
  sources: [{ source: {}, count: 1 }, victim(1002, 'Bet', 2), victim(1003, 'Gimel', 3)],
};

const CARRIED: InvSlot[] = [
  { itemId: WORLD_PVP_SKULL_ITEM_ID, count: 2 },
  { itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1, instance: { locked: true } },
  { itemId: 'copper_ore', count: 5 },
];

describe('the pane view', () => {
  it('lists victims most skulls first, unrecorded last, and counts plain carried skulls', () => {
    const view = skullBagPaneView(INFO, CARRIED)!;
    expect(view.rows.map((r) => [r.victim, r.count])).toEqual([
      ['Gimel', 3],
      ['Bet', 2],
      [null, 1],
    ]);
    expect(view.total).toBe(6);
    // The locked copy stays out of Store.
    expect(view.carried).toBe(2);
    expect(carriedSkullCount(CARRIED)).toBe(2);
  });

  it('is null with no bag and nothing stored, and its signature moves with every painted fact', () => {
    expect(skullBagPaneView(undefined, CARRIED)).toBeNull();
    // A carried bag whose readout has not arrived yet still opens, empty.
    const fresh = skullBagPaneView(undefined, [{ itemId: WORLD_PVP_SKULL_BAG_ITEM_ID, count: 1 }]);
    expect(fresh).toMatchObject({ owned: true, total: 0, rows: [], carried: 0 });
    const base = skullBagPaneView(INFO, CARRIED)!.signature;
    expect(skullBagPaneView(INFO, CARRIED)!.signature).toBe(base);
    expect(skullBagPaneView({ ...INFO, owned: false }, CARRIED)!.signature).not.toBe(base);
    expect(skullBagPaneView(INFO, CARRIED.slice(1))!.signature).not.toBe(base);
    const moreBet = {
      ...INFO,
      total: 7,
      sources: [...INFO.sources.slice(0, 1), victim(1002, 'Bet', 3), INFO.sources[2]],
    };
    expect(skullBagPaneView(moreBet, CARRIED)!.signature).not.toBe(base);
  });

  it('a take sends exactly that victim, never more than the row holds', () => {
    const row = skullBagPaneView(INFO, CARRIED)!.rows[1];
    expect(skullBagTakeAction(row, 1)).toEqual({ op: 'take', sources: [victim(1002, 'Bet')] });
    expect(skullBagTakeAction(row, 99)).toEqual({ op: 'take', sources: [victim(1002, 'Bet', 2)] });
  });
});

describe('the pane painter', () => {
  function mount(info: SkullBagInfo | undefined, inventory: InvSlot[] = CARRIED) {
    setLanguage('en');
    const sent: SkullBagAction[] = [];
    const state = { info, inventory };
    const pane = new SkullBagPaneController({
      world: () => ({
        worldPvpInfo: state.info ? ({ skullBag: state.info } as never) : ({} as never),
        inventory: state.inventory,
        skullBagAction: (action: SkullBagAction) => sent.push(action),
      }),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return { pane, parent, sent, state };
  }

  it('paints nothing until toggled, then the rows, the counts and the store button', () => {
    const { pane, parent, sent } = mount(INFO);
    pane.mount(parent);
    expect(parent.querySelector('.skull-bag-pane')).toBeNull();
    pane.toggle();
    pane.mount(parent);
    const host = parent.querySelector('.skull-bag-pane')!;
    expect(host.querySelector('.skull-bag-title')!.textContent).toBe('Skull Bag');
    expect(host.querySelector('.skull-bag-total')!.textContent).toBe('Skulls: 6');
    const names = [...host.querySelectorAll('.skull-bag-name')].map((n) => n.textContent);
    expect(names).toEqual(["Gimel's Skull", "Bet's Skull", 'Trophy Skull']);
    // A single skull offers Take 1 only; a row of several offers Take all too.
    const rows = [...host.querySelectorAll('.skull-bag-row')];
    expect(rows.map((r) => r.querySelectorAll('button').length)).toEqual([2, 2, 1]);
    const takeAll = rows[1].querySelectorAll('button')[1] as HTMLButtonElement;
    // Label in name (WCAG 2.5.3): the accessible name starts with the visible text.
    expect(takeAll.getAttribute('aria-label')).toBe("Take all: Bet's Skull");
    expect(host.querySelector('.skull-bag-rows')!.getAttribute('role')).toBe('list');
    takeAll.click();
    const store = host.querySelector('.skull-bag-store') as HTMLButtonElement;
    expect(store.textContent).toBe('Store carried skulls (2)');
    store.click();
    expect(sent).toEqual([{ op: 'take', sources: [victim(1002, 'Bet', 2)] }, { op: 'store' }]);
  });

  it('a name never reaches markup: it is text, escaped by construction', () => {
    const { pane, parent } = mount({ owned: true, total: 1, sources: [victim(9, '<b>x</b>')] });
    pane.toggle();
    pane.mount(parent);
    expect(parent.querySelector('b')).toBeNull();
    expect(parent.querySelector('.skull-bag-name')!.textContent).toBe("<b>x</b>'s Skull");
  });

  it('refreshes only when the signature moves, and states why when the bag is not carried', () => {
    const { pane, parent, state } = mount({ owned: true, total: 0, sources: [] }, []);
    pane.toggle();
    pane.mount(parent);
    const host = parent.querySelector('.skull-bag-pane')!;
    expect(host.querySelector('.skull-bag-note')!.textContent).toBe(
      'Empty. While you carry the bag, skulls you loot go straight in.',
    );
    expect((host.querySelector('.skull-bag-store') as HTMLButtonElement).disabled).toBe(true);
    const before = host.firstChild;
    pane.refreshIfChanged();
    expect(host.firstChild).toBe(before); // unchanged view: no repaint
    state.info = { owned: false, total: 1, sources: [victim(1002, 'Bet')] };
    pane.refreshIfChanged();
    expect(host.firstChild).not.toBe(before);
    expect(host.querySelector('.skull-bag-note')!.textContent).toBe(
      'Carry the Skull Bag in your bags to store or take skulls.',
    );
    // No bag: no buttons that would only be refused.
    expect(host.querySelectorAll('.skull-bag-take, .skull-bag-store')).toHaveLength(0);
    // Nothing left to show: the pane closes itself.
    state.info = undefined;
    pane.refreshIfChanged();
    expect(pane.isOpen).toBe(false);
    expect(parent.querySelector('.skull-bag-pane')).toBeNull();
  });

  it('the close button hides it and hands keyboard focus back to the bags', () => {
    setLanguage('en');
    const landing = document.createElement('button');
    document.body.appendChild(landing);
    const pane = new SkullBagPaneController({
      world: () => ({
        worldPvpInfo: { skullBag: INFO } as never,
        inventory: CARRIED,
        skullBagAction: () => {},
      }),
      focusAfterClose: () => landing.focus(),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    pane.toggle();
    pane.mount(parent);
    const close = parent.querySelector('.skull-bag-head .x-btn') as HTMLButtonElement;
    close.focus();
    // A keyboard press (detail 0) hands focus back to the bags.
    close.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
    expect(pane.isOpen).toBe(false);
    expect(parent.querySelector('.skull-bag-pane')).toBeNull();
    expect(document.activeElement).toBe(landing);
    // A mouse click (detail 1) leaves focus alone: a parked button would take
    // the next Enter meant for chat.
    landing.blur();
    pane.toggle();
    pane.mount(parent);
    const again = parent.querySelector('.skull-bag-head .x-btn') as HTMLButtonElement;
    again.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    expect(pane.isOpen).toBe(false);
    expect(document.activeElement).not.toBe(landing);
  });
});

describe('the bag item', () => {
  const bag = ITEMS[WORLD_PVP_SKULL_BAG_ITEM_ID];

  it('a click opens the pane and the hover says so; window modes still win', () => {
    expect(bagItemAction(bag, NO_MODE)).toBe('openSkullBag');
    expect(bagTooltipHintKey(bag, NO_MODE)).toBe('hudChrome.skullBag.clickOpen');
    // Soulbound: a vendor or trade click is refused in place, never opened.
    expect(bagItemAction(bag, { ...NO_MODE, vendorOpen: true })).toBe('transferBlockedSoulbound');
    expect(bagItemAction(bag, { ...NO_MODE, bankOpen: true, bankDeposit: true })).toBe(
      'bankDeposit',
    );
    // Any other junk item keeps its old route.
    expect(bagItemAction(ITEMS[WORLD_PVP_SKULL_ITEM_ID], NO_MODE)).toBe('use');
  });

  it('its tooltip states the mechanic; no other item gets the line', () => {
    setLanguage('en');
    expect(skullBagTooltipLines(bag)).toContain(
      'Holds any number of Trophy Skulls without using bag space.',
    );
    expect(skullBagTooltipLines(ITEMS[WORLD_PVP_SKULL_ITEM_ID])).toBe('');
  });
});

describe('the wire', () => {
  it('the server boundary forwards only well-formed frames', () => {
    const sim = { setWorldPvpFlag: vi.fn(), skullBagAction: vi.fn() };
    dispatchWorldPvpCommand(sim, 7, { cmd: 'skull_bag', op: 'store' });
    dispatchWorldPvpCommand(sim, 7, { cmd: 'skull_bag', op: 'take', sources: [victim(1, 'Bet')] });
    dispatchWorldPvpCommand(sim, 7, { cmd: 'skull_bag', op: 'take', sources: 'all' });
    dispatchWorldPvpCommand(sim, 7, { cmd: 'skull_bag', op: 'dump' });
    dispatchWorldPvpCommand(sim, 7, { cmd: 'pvp_flag', on: true });
    dispatchWorldPvpCommand(sim, 7, { cmd: 'pvp_flag', on: 'yes' });
    expect(sim.skullBagAction.mock.calls).toEqual([
      [{ op: 'store' }, 7],
      [{ op: 'take', sources: [victim(1, 'Bet')] }, 7],
    ]);
    expect(sim.setWorldPvpFlag.mock.calls).toEqual([[true, 7]]);
  });

  it('the three sim lines re-localize', () => {
    setLanguage('en');
    for (const line of [
      SKULL_BAG_MISSING_LINE,
      SKULL_BAG_NOTHING_LINE,
      SKULL_BAG_STORED_LINE,
      SKULL_BAG_STORED_ALL_LINE,
    ]) {
      expect(localizeSimText(line), line).toBe(line);
    }
    setLanguage('ja_JP');
    expect(localizeSimText(SKULL_BAG_STORED_LINE)).toBe('頭蓋骨が頭蓋骨袋に入りました。');
    setLanguage('en');
  });
});

describe('the skb self key', () => {
  function meta(inventory: InvSlot[], skullBag?: PlayerMeta['skullBag']): PlayerMeta {
    return { inventory, ...(skullBag ? { skullBag } : {}) } as unknown as PlayerMeta;
  }

  it('the server sends the bag only when it changed, or after a sent-record reset', () => {
    const bag = { itemId: WORLD_PVP_SKULL_BAG_ITEM_ID, count: 1 };
    const m = meta([bag], [victim(1002, 'Bet')]);
    const sim = { meta: () => m };
    const session = { lastSent: {} as Record<string, string> };
    const sent: unknown[] = [];
    const emit = (key: 'skb', value: unknown) => {
      session.lastSent[key] = JSON.stringify(value);
      sent.push(value);
    };
    emitSkullBagSelfKey(emit, sim, session, 7);
    expect(sent).toEqual([{ owned: true, total: 1, sources: [victim(1002, 'Bet')] }]);
    // Unchanged: nothing is built or sent, however often the gate opens.
    for (let i = 0; i < 5; i++) emitSkullBagSelfKey(emit, sim, session, 7);
    expect(sent).toHaveLength(1);
    // The bag is replaced whole on every write: a new composition is a change.
    m.skullBag = [victim(1002, 'Bet', 2)];
    emitSkullBagSelfKey(emit, sim, session, 7);
    expect(sent).toHaveLength(2);
    // So is banking the bag (owned flips) ...
    m.inventory = [];
    emitSkullBagSelfKey(emit, sim, session, 7);
    expect(sent.at(-1)).toMatchObject({ owned: false, total: 2 });
    // ... and a full resync (the sent-record reset), and a new anchor.
    session.lastSent = {};
    emitSkullBagSelfKey(emit, sim, session, 7);
    expect(sent).toHaveLength(4);
    emitSkullBagSelfKey(emit, sim, session, 8);
    expect(sent).toHaveLength(5);
    // No bag and nothing stored: the explicit null.
    const empty = { meta: () => meta([]) };
    const other = { lastSent: {} as Record<string, string> };
    const got: unknown[] = [];
    emitSkullBagSelfKey((_k, v) => got.push(v), empty, other, 9);
    expect(got).toEqual([null]);
  });

  it('the client merges skb into worldPvpInfo and keeps it across wpvp updates', () => {
    const target = { worldPvpInfo: null } as unknown as SocialSelfMirrors;
    const readout: WorldPvpInfo = {
      flagged: false,
      disarmRemaining: null,
      kills: 0,
      deaths: 0,
      levelLocked: false,
      zone: 'contested',
      enabled: true,
    };
    applySocialSelfWire(target, { wpvp: readout });
    // No bag: the readout is adopted by reference, unchanged.
    expect(target.worldPvpInfo).toBe(readout);
    applySocialSelfWire(target, { skb: INFO });
    expect(target.worldPvpInfo).toEqual({ ...readout, skullBag: INFO });
    // A fresh 2 Hz readout (no skb in the frame) keeps the bag.
    applySocialSelfWire(target, { wpvp: { ...readout, kills: 1 } });
    expect(target.worldPvpInfo).toEqual({ ...readout, kills: 1, skullBag: INFO });
    // An explicit null clears it.
    applySocialSelfWire(target, { skb: null });
    expect(target.worldPvpInfo).toEqual({ ...readout, kills: 1 });
    expect(target.worldPvpInfo).not.toHaveProperty('skullBag');
    // A bag that arrives before the first readout is kept for it.
    const fresh = { worldPvpInfo: null } as unknown as SocialSelfMirrors;
    applySocialSelfWire(fresh, { skb: INFO });
    expect(fresh.worldPvpInfo).toBeNull();
    applySocialSelfWire(fresh, { wpvp: readout });
    expect(fresh.worldPvpInfo?.skullBag).toEqual(INFO);
  });
});
