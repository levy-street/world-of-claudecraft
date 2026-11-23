// Lantern Hall's guild window: the pure view core (src/ui/hud/guild_hall/guild_hall_view.ts),
// the painter over jsdom (guild_hall_window.ts), the event routing
// (hud/quest/quest_event_router.ts) and the online mirror's decode (net/guild_hall_wire_state.ts).
// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeGuildContractsWire } from '../src/net/guild_hall_wire_state';
import {
  GUILD_CONTRACTS,
  GUILD_QUARTERMASTER_STOCK,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { type GuildContractsView, guildContractsForWeek } from '../src/sim/guild_contracts';
import type { SimEvent } from '../src/sim/types';
import {
  buildGuildHallView,
  buildGuildShopView,
  defaultGuildShopSelection,
  GuildHallWindow,
  guildResetText,
  guildShopTooltip,
  lanternSeals,
} from '../src/ui/hud/guild_hall';
import { guildContractToast } from '../src/ui/hud/guild_hall/guild_hall_toasts';
import {
  type GuildShopInput,
  guildShopOwnedFlags,
} from '../src/ui/hud/guild_hall/guild_quartermaster_view';
import { applyQuestEventPresentation } from '../src/ui/hud/quest/quest_event_router';

// Additive, never bare: only the canvas-touching iconDataUrl (the stock's crests) is stubbed.
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:,',
}));

// The mount stage's preview host (render/mount_preview.ts) needs WebGL, which jsdom lacks: a
// recording stand-in pins the stage's lifecycle (built once per horse, re-staged in place,
// disposed on leaving) without a context.
const stageLog = vi.hoisted(() => ({ built: 0, calls: [] as string[], fail: false }));
vi.mock('../src/render/mount_preview', () => ({
  createMountPreview: () => {
    if (stageLog.fail) return null;
    stageLog.built++;
    const log = (call: string) => stageLog.calls.push(call);
    return {
      setActive: (on: boolean) => log(`active:${on}`),
      setAppearance: () => log('appearance'),
      setMount: (key: string | null) => log(`mount:${key}`),
      setMode: (mode: string) => log(`mode:${mode}`),
      setScene: (scene: string) => log(`scene:${scene}`),
      dispose: () => log('dispose'),
    };
  },
}));

const WEEK = 'wk_6';

type Offer = (typeof GUILD_QUARTERMASTER_STOCK)[number];
/** The stock's titles, cheapest first, and its weapon appearances, in stock order. */
const TITLES = GUILD_QUARTERMASTER_STOCK.filter(
  (o): o is Extract<Offer, { kind: 'title' }> => o.kind === 'title',
);
const SKINS = GUILD_QUARTERMASTER_STOCK.filter(
  (o): o is Extract<Offer, { kind: 'weaponSkin' }> => o.kind === 'weaponSkin',
);

/** The counter's own input: nothing owned and no seals unless a test says so. */
function input(over: Partial<GuildShopInput> = {}): GuildShopInput {
  return {
    seals: 0,
    playerName: 'Wanderer',
    deedsEarned: new Map(),
    ownedMounts: [],
    weaponSkinIds: [],
    ridingTrained: true,
    ...over,
  };
}

function board(done: string[] = []): GuildContractsView {
  return {
    week: WEEK,
    offered: guildContractsForWeek(WEEK).map((c) => c.id),
    done,
    lifetime: done.length,
  };
}

function world(
  seals: number,
  owned: string[] = [],
  done: string[] = [],
  mounts: string[] = [],
  skins: string[] = [],
) {
  return {
    guildContracts: board(done),
    inventory: seals > 0 ? [{ itemId: LANTERN_SEAL_ITEM_ID, count: seals }] : [],
    deedsEarned: new Map(owned.map((id) => [id, '2026-10-16'])),
    ownedMounts: () => mounts,
    ridingTrained: () => true,
    accountCosmetics: { weaponSkinIds: skins },
    weeklyQuestResetAtMs: Date.UTC(2026, 9, 20),
    player: { name: 'Wanderer' },
    buyGuildCosmetic: vi.fn(),
  };
}

describe('the guild window view core', () => {
  it("shapes the week's three cards, the done one marked, in English through t()", () => {
    const offered = board().offered;
    const view = buildGuildHallView(world(0, [], [offered[1]]), Date.UTC(2026, 9, 16), 'contracts');
    expect(view.title).toBe('Lantern Hall');
    expect(view.contracts.map((c) => c.kind)).toEqual(['boss', 'heroic', 'task']);
    expect(view.contracts.map((c) => c.done)).toEqual([false, true, false]);
    expect(view.contracts[0].kindLabel).toBe('Bounty');
    expect(view.contracts[1].goal).toMatch(/on Heroic/);
    // a task card carries its Book of Deeds condition as a sentence of its own
    expect(view.contracts[2].goal).toMatch(/^.+ \(.+\)$/);
    expect(view.contracts[2].detail.length).toBeGreaterThan(0);
    expect(view.contracts[0].detail).toBe('');
    expect(view.contracts[0].reward).toBe('1 Lantern Seal');
    expect(view.contracts[1].reward).toBe('3 Lantern Seals');
    expect(view.contracts[1].rewardLine).toBe('Reward: 3 Lantern Seals');
    expect(view.lifetimeText).toBe('Contracts completed: 1');
    // each notice carries its boss's portrait (the dungeon finder's still) and name, and the
    // week's counter out of the once a contract pays
    const week = guildContractsForWeek(WEEK);
    for (const [i, card] of view.contracts.entries()) {
      expect(card.portraitUrl).toBe(`/ui/dungeons/${week[i].mobId}.webp`);
      expect(card.boss.length).toBeGreaterThan(0);
      expect(card.boss).not.toBe(week[i].mobId);
      expect(card.progressTotal).toBe(1);
    }
    expect(view.contracts.map((c) => [c.progressDone, c.progressText])).toEqual([
      [0, '0/1 this week'],
      [1, '1/1 this week'],
      [0, '0/1 this week'],
    ]);
    // the board's weekly tally
    expect([view.weekDone, view.weekTotal]).toEqual([1, 3]);
    expect(view.weekProgressText).toBe('This week: 1 of 3 contracts complete');
    expect(view.emptyText).toBeNull();
    expect(view.tabs.map((t) => [t.id, t.selected])).toEqual([
      ['contracts', true],
      ['quartermaster', false],
    ]);
    // an empty board says so instead of drawing no cards
    const empty = buildGuildHallView(
      { ...world(0), guildContracts: { week: '', offered: [], done: [], lifetime: 0 } },
      0,
      'contracts',
    );
    expect(empty.contracts).toEqual([]);
    expect(empty.emptyText).toMatch(/weekly reset/);
    expect([empty.weekDone, empty.weekTotal]).toEqual([0, 0]);
  });

  it('has a portrait still for every boss any contract is posted against', () => {
    // the notice shows /ui/dungeons/<mobId>.webp; a contract against a boss without one would
    // ship a broken image
    const missing = [...new Set(GUILD_CONTRACTS.map((c) => c.mobId))].filter(
      (mobId) => !existsSync(path.join(process.cwd(), 'public', 'ui', 'dungeons', `${mobId}.webp`)),
    );
    expect(missing).toEqual([]);
  });

  it('reads the same from the online mirror as from the offline world', () => {
    // ClientWorld's shape: the board decoded off the wire (gcon), the bags and the Book mirrored
    const done = [board().offered[0]];
    const sim = world(
      7,
      [TITLES[0].deedId],
      done,
      ['lantern_hall_destrier'],
      ['lantern_hall_sword'],
    );
    const mirror = {
      ...sim,
      guildContracts: decodeGuildContractsWire(JSON.parse(JSON.stringify(sim.guildContracts))),
      inventory: sim.inventory.map((slot) => ({ ...slot })),
      deedsEarned: new Map(sim.deedsEarned),
      ownedMounts: () => [...sim.ownedMounts()],
      accountCosmetics: { weaponSkinIds: [...sim.accountCosmetics.weaponSkinIds] },
    };
    const now = Date.UTC(2026, 9, 16);
    for (const tab of ['contracts', 'quartermaster'] as const) {
      expect(buildGuildHallView(mirror, now, tab, null)).toEqual(
        buildGuildHallView(sim, now, tab, null),
      );
    }
  });

  it("prices the quartermaster's stock against the seals in the bags, owned ones marked", () => {
    const [first, second, third] = TITLES;
    const view = buildGuildHallView(world(first.seals + 1, [first.deedId]), 0, 'quartermaster');
    expect(view.seals).toBe(first.seals + 1);
    expect(view.sealsText).toBe(`Lantern Seals: ${first.seals + 1}`);
    expect(view.intro).toMatch(/Nothing here makes you stronger/);
    const items = view.shop.items;
    expect(items.map((item) => item.id)).toEqual(GUILD_QUARTERMASTER_STOCK.map((o) => o.id));
    expect(items[0]).toMatchObject({ state: 'owned', stateLabel: 'Owned', name: 'Writ-Runner' });
    expect(items[1].state).toBe('short');
    expect(items[1].stateLabel).toBe(`Needs ${second.seals - first.seals - 1} more`);
    expect(items[1]).toMatchObject({
      priceValue: String(second.seals),
      price: `${second.seals} Lantern Seals`,
      kindLabel: 'Title',
    });
    // every title card names the crest the Book of Deeds shows for its feat
    for (const item of items.filter((i) => i.offerKind === 'title')) {
      expect(item.art.kind).toBe('crest');
      if (item.art.kind === 'crest') expect(item.art.id).toMatch(/^deed_/);
    }
    // a fresh counter opens on the first offer not yet owned (the titles lead, cheapest first)
    expect(items.filter((item) => item.selected).map((item) => item.id)).toEqual([second.id]);
    expect(view.shop.detail?.id).toBe(second.id);
    // exactly enough seals is enough
    const exact = buildGuildShopView(input({ seals: third.seals }), third.id);
    expect(exact.items[2]).toMatchObject({ state: 'ready', stateLabel: 'Buy', selected: true });
    expect(exact.detail).toMatchObject({ id: third.id, actionEnabled: true, shortText: null });
  });

  it("shapes the selected title's detail: the nameplate, the price against the bags, why not", () => {
    const [first, second] = TITLES;
    const short = buildGuildShopView(input({ seals: 2 }), second.id).detail;
    expect(short).toMatchObject({
      name: 'Hallsworn',
      offerKind: 'title',
      stage: {
        kind: 'plate',
        heading: 'Your nameplate',
        pre: '',
        name: 'Wanderer',
        post: ' [Hallsworn]',
      },
      summary: '',
      priceText: `Price: ${second.seals} Lantern Seals`,
      haveText: 'You have 2',
      state: 'short',
      action: `Needs ${second.seals - 2} more`,
      actionEnabled: false,
      shortText: `You need ${second.seals - 2} more Lantern Seals.`,
    });
    expect(short?.howTo).toMatch(/Book of Deeds/);
    expect(short?.cosmetic).toMatch(/Cosmetic only/);
    // one seal short reads in the singular
    const one = buildGuildShopView(input({ seals: first.seals - 1 }), first.id).detail;
    expect(one?.shortText).toBe('You need 1 more Lantern Seal.');
    // an owned title says where to wear it and offers no purchase
    const owned = buildGuildShopView(
      input({ seals: 99, deedsEarned: new Map([[first.deedId, '2026-10-16']]) }),
      first.id,
    ).detail;
    expect(owned).toMatchObject({ state: 'owned', action: 'Owned', actionEnabled: false });
    expect(owned?.howTo).toBe('You own this title. Choose it in the Book of Deeds.');
    // an unknown selection falls back to the default card, never a blank detail
    expect(buildGuildShopView(input(), 'phantom').detail?.id).toBe(first.id);
    expect(defaultGuildShopSelection(input({ deedsEarned: new Map([[first.deedId, 'x']]) }))).toBe(
      second.id,
    );
    // every title owned: the counter moves on to the first appearance
    const titles = new Map(TITLES.map((o) => [o.deedId, 'x']));
    expect(defaultGuildShopSelection(input({ deedsEarned: titles }))).toBe(
      'weapon_skin_lantern_hall_sword',
    );
    // everything owned: the first card
    const all = input({
      deedsEarned: titles,
      ownedMounts: ['lantern_hall_destrier'],
      weaponSkinIds: SKINS.map((o) => o.skinId),
    });
    expect(defaultGuildShopSelection(all)).toBe(first.id);
    expect(guildShopOwnedFlags(all).every(Boolean)).toBe(true);
    expect(guildShopOwnedFlags(input()).some(Boolean)).toBe(false);
  });

  it('stages the war horse and the weapon appearances in 3D, each with its own copy', () => {
    const horse = buildGuildShopView(input({ seals: 3 }), 'mount_lantern_hall_destrier');
    expect(horse.detail).toMatchObject({
      offerKind: 'mount',
      art: { kind: 'item', itemId: 'reins_lantern_hall_destrier' },
      name: 'Lantern Hall Destrier',
      kindLabel: 'Mount',
      stage: { kind: 'mount', heading: 'You, in the saddle', mountKey: 'lantern_hall_destrier' },
      summary:
        'Mount appearance for every character on your account. Your riding training sets your speed.',
      cosmetic: null,
      priceText: 'Price: 40 Lantern Seals',
      state: 'short',
      action: 'Needs 37 more',
    });
    expect(horse.detail?.howTo).toMatch(/reins go to your bags/);
    const sword = buildGuildShopView(input({ seals: 20 }), 'weapon_skin_lantern_hall_sword');
    expect(sword.detail).toMatchObject({
      offerKind: 'weaponSkin',
      art: { kind: 'skin', skinId: 'lantern_hall_sword' },
      kindLabel: 'Sword appearance',
      stage: { kind: 'weapon', heading: 'In your hand', skinId: 'lantern_hall_sword' },
      cosmetic: null,
      state: 'ready',
      action: 'Buy',
      actionEnabled: true,
    });
    expect(sword.detail?.summary).toMatch(/equipped sword .* Appearance only: no stats\.$/);
    expect(sword.detail?.howTo).toMatch(/Cosmetics window/);
    // owned reads the held mount and the account's skin ledger, not the Book of Deeds
    const rich = input({
      seals: 99,
      ownedMounts: ['lantern_hall_destrier'],
      weaponSkinIds: ['lantern_hall_sword'],
    });
    expect(buildGuildShopView(rich, 'mount_lantern_hall_destrier').detail).toMatchObject({
      state: 'owned',
      action: 'Owned',
      actionEnabled: false,
      howTo: 'You own this mount. Its reins are in your bags.',
    });
    expect(buildGuildShopView(rich, 'weapon_skin_lantern_hall_sword').detail).toMatchObject({
      state: 'owned',
      howTo: 'You own this appearance. Apply it from the Cosmetics window.',
    });
    // a skin reserved elsewhere (a future raid's) is no card at this counter
    expect(buildGuildShopView(rich, 'weapon_skin_rimelight_staff').detail?.id).not.toBe(
      'weapon_skin_rimelight_staff',
    );
  });

  it('keeps the horse from a rider who has not learned to ride, and says why', () => {
    const shop = buildGuildShopView(
      input({ seals: 40, ridingTrained: false }),
      'mount_lantern_hall_destrier',
    );
    expect(shop.detail).toMatchObject({
      state: 'ready',
      actionEnabled: false,
      shortText: 'Learn to ride before you buy a mount.',
    });
    expect(
      guildShopTooltip(
        'mount_lantern_hall_destrier',
        input({ seals: 40, ridingTrained: false }),
      )?.lines.at(-1),
    ).toEqual({ text: 'Learn to ride before you buy a mount.', tone: 'red' });
    // the gate is the horse's only: an appearance stays buyable, and an owned horse says owned
    const sword = buildGuildShopView(input({ seals: 40, ridingTrained: false }), SKINS[0].id);
    expect(sword.detail).toMatchObject({ actionEnabled: true, shortText: null });
    const owned = buildGuildShopView(
      input({ ridingTrained: false, ownedMounts: ['lantern_hall_destrier'] }),
      'mount_lantern_hall_destrier',
    );
    expect(owned.detail).toMatchObject({ state: 'owned', shortText: null });
  });

  it("sells the guild's sword as its one weapon appearance, named for the weapon it dresses", () => {
    const shop = buildGuildShopView(input({ seals: 20 }), null);
    const card = (id: string) => {
      const found = shop.items.find((o) => o.id === id);
      if (!found) throw new Error(`no card ${id}`);
      return found;
    };
    // the counter's copy knows swords only: a new weapon type in the stock must bring its own
    // kind label first. The four elemental arms (two of them staves) are reserved for a future
    // raid and are not stocked here.
    expect(new Set(SKINS.map((o) => WEAPON_SKINS[o.skinId]?.weaponType))).toEqual(
      new Set(['sword']),
    );
    expect(SKINS.map((o) => o.skinId)).toEqual(['lantern_hall_sword']);
    expect(SKINS.map((o) => card(o.id).kindLabel)).toEqual(['Sword appearance']);
    expect(card('weapon_skin_lantern_hall_sword')).toMatchObject({
      state: 'ready',
      priceValue: '20',
    });
    const owned = buildGuildShopView(
      input({ seals: 20, weaponSkinIds: ['lantern_hall_sword'] }),
      null,
    ).items.find((o) => o.id === 'weapon_skin_lantern_hall_sword');
    expect(owned).toMatchObject({ state: 'owned', stateLabel: 'Owned' });
    expect(card('weapon_skin_lantern_hall_sword').art).toEqual({
      kind: 'skin',
      skinId: 'lantern_hall_sword',
    });
    expect(card('mount_lantern_hall_destrier')).toMatchObject({ state: 'short', priceValue: '40' });
  });

  it("writes each stock card's hover card from the live rule", () => {
    const [first] = TITLES;
    const tip = guildShopTooltip(first.id, input({ seals: 1 }));
    expect(tip?.title).toBe('Title: Writ-Runner');
    expect(tip?.lines.map((line) => line.tone)).toEqual(['sub', 'desc', 'desc', 'sub', 'red']);
    expect(tip?.lines[0].text).toBe('Shown as Wanderer [Writ-Runner]');
    expect(tip?.lines[3].text).toBe(`Price: ${first.seals} Lantern Seals`);
    expect(tip?.lines[4].text).toBe(`You need ${first.seals - 1} more Lantern Seals.`);
    // affordable: no red line; owned: the owned sentence, no red line
    expect(guildShopTooltip(first.id, input({ seals: first.seals }))?.lines).toHaveLength(4);
    const owned = guildShopTooltip(
      first.id,
      input({ deedsEarned: new Map([[first.deedId, 'x']]) }),
    );
    expect(owned?.lines[1].text).toMatch(/You own this title/);
    expect(owned?.lines).toHaveLength(4);
    // the horse and an appearance lead with what they do, and carry no title-only line
    const horse = guildShopTooltip('mount_lantern_hall_destrier', input({ seals: 40 }));
    expect(horse?.title).toBe('Mount: Lantern Hall Destrier');
    expect(horse?.lines.map((line) => line.tone)).toEqual(['sub', 'desc', 'sub']);
    expect(horse?.lines[0].text).toMatch(/riding training sets your speed/);
    const sword = guildShopTooltip('weapon_skin_lantern_hall_sword', input());
    expect(sword?.title).toMatch(/^Sword appearance: /);
    expect(sword?.lines.at(-1)?.tone).toBe('red');
    // a reserved skin's old offer id has no hover card
    expect(guildShopTooltip('weapon_skin_rimelight_staff', input())).toBeNull();
    expect(guildShopTooltip('phantom', input())).toBeNull();
  });

  it('counts seals across stacks and reads the reset in days and hours', () => {
    expect(
      lanternSeals([
        { itemId: LANTERN_SEAL_ITEM_ID, count: 3 },
        { itemId: 'heroic_mark', count: 9 },
        { itemId: LANTERN_SEAL_ITEM_ID, count: 4 },
      ]),
    ).toBe(7);
    const now = Date.UTC(2026, 9, 16, 0, 0);
    expect(guildResetText(now + (2 * 86_400 + 5 * 3_600) * 1000, now)).toBe(
      'New contracts in 2 days and 5 hours',
    );
    expect(guildResetText(0, now)).toBe('New contracts at the next weekly reset');
    expect(guildContractToast(board().offered[1], 3)).toMatch(
      /^Contract complete: Heroic Clear: .+ You receive 3 Lantern Seals\.$/,
    );
  });
});

describe('the guild window painter', () => {
  function mount(w: ReturnType<typeof world>) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tips = new Map<HTMLElement, () => string>();
    const win = new GuildHallWindow({
      root: () => root,
      world: () => w as never,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      attachTooltip: (el, html) => tips.set(el, html),
    });
    return { root, win, tips };
  }

  it('opens on a tab, switches tabs, sends a purchase, and closes', () => {
    const w = world(GUILD_QUARTERMASTER_STOCK[0].seals);
    const { root, win } = mount(w);
    win.open('quartermaster');
    expect(win.isOpen).toBe(true);
    // the horse draws its reins, the guild's sword appearance its Armory card, a title its crest
    expect(root.querySelectorAll('.gh-slot-skin img').length).toBe(1);
    expect(
      root
        .querySelector('[data-gh-offer="mount_lantern_hall_destrier"] .gh-slot-item img')
        ?.getAttribute('src'),
    ).toBe('/ui/items/reins_lantern_hall_destrier.webp');
    expect(
      root
        .querySelector('[data-gh-offer="weapon_skin_lantern_hall_sword"] .gh-slot-skin img')
        ?.getAttribute('src'),
    ).toBe('/ui/store/armory/lantern_hall_sword.webp');
    expect(root.style.display).toBe('flex');
    expect(root.querySelectorAll('[data-gh-offer]').length).toBe(GUILD_QUARTERMASTER_STOCK.length);
    // the counter opens on the first title, the one buy button under its detail
    const buy = root.querySelector<HTMLButtonElement>(
      `[data-gh-buy="${GUILD_QUARTERMASTER_STOCK[0].id}"]`,
    );
    expect(root.querySelectorAll('[data-gh-buy]').length).toBe(1);
    expect(buy?.disabled).toBe(false);
    buy?.click();
    expect(w.buyGuildCosmetic).toHaveBeenCalledWith(GUILD_QUARTERMASTER_STOCK[0].id);
    // selecting a title it cannot afford shows it with a disabled buy and the reason
    const dearId = GUILD_QUARTERMASTER_STOCK[2].id;
    root.querySelector<HTMLButtonElement>(`[data-gh-offer="${dearId}"]`)?.click();
    expect(root.querySelector(`[data-gh-offer="${dearId}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    const dear = root.querySelector<HTMLButtonElement>(`[data-gh-buy="${dearId}"]`);
    expect(dear?.disabled).toBe(true);
    expect(root.querySelector('.gh-short')?.textContent).toMatch(
      /^You need \d+ more Lantern Seals\.$/,
    );
    expect(root.querySelector('.gh-plate')?.textContent).toBe('Wanderer [of Lantern Hall]');
    root.querySelector<HTMLButtonElement>('[data-gh-tab="contracts"]')?.click();
    expect(root.querySelectorAll('[data-gh-card]').length).toBe(3);
    // each notice shows its boss's portrait, its counter and its reward line
    const card = root.querySelector('[data-gh-card]');
    expect(card?.querySelector('.gh-portrait img')?.getAttribute('src')).toMatch(
      /^\/ui\/dungeons\/.+\.webp$/,
    );
    expect(card?.querySelector('.gh-count')?.textContent).toBe('0/1 this week');
    expect(card?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(card?.querySelector('.gh-reward')?.textContent).toMatch(/^Reward: /);
    root.querySelector<HTMLButtonElement>('[data-close]')?.click();
    expect(win.isOpen).toBe(false);
    expect(root.style.display).toBe('none');
  });

  it('is a keyboard tablist: roving tabindex, arrows switch, focus follows, a tabpanel below', () => {
    const { root, win } = mount(world(0));
    win.open('contracts');
    const tab = (id: string) => root.querySelector<HTMLButtonElement>(`[data-gh-tab="${id}"]`);
    expect(root.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Lantern Hall sections',
    );
    expect(tab('contracts')?.tabIndex).toBe(0);
    expect(tab('quartermaster')?.tabIndex).toBe(-1);
    expect(tab('contracts')?.getAttribute('aria-controls')).toBe('guild-hall-panel');
    expect(root.querySelector('[id="guild-hall-panel"]')?.getAttribute('role')).toBe('tabpanel');
    tab('contracts')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(tab('quartermaster')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('quartermaster'));
    expect(root.querySelectorAll('[data-gh-offer]').length).toBe(GUILD_QUARTERMASTER_STOCK.length);
    tab('quartermaster')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(document.activeElement).toBe(tab('contracts'));
  });

  it('stamps a done notice, counts the week, and hangs hover cards on the stock and the seals', () => {
    const offered = board().offered;
    const { root, win, tips } = mount(world(3, [], [offered[2]]));
    win.open('contracts');
    const cards = [...root.querySelectorAll('[data-gh-card]')];
    expect(cards.map((c) => c.classList.contains('gh-card-done'))).toEqual([false, false, true]);
    expect(cards.map((c) => !!c.querySelector('.gh-stamp'))).toEqual([false, false, true]);
    expect(cards[2].querySelector('.gh-stamp')?.textContent).toBe('Sealed');
    expect(cards[2].querySelector('.gh-count')?.textContent).toBe('1/1 this week');
    expect(root.querySelector('.gh-tally-text')?.textContent).toBe(
      'This week: 1 of 3 contracts complete',
    );
    expect(root.querySelectorAll('.gh-tally .gh-pip-done').length).toBe(1);
    const seals = root.querySelector<HTMLElement>('.gh-seals');
    expect(seals && tips.get(seals)?.()).toMatch(/spent only at Garrick Holt/);
    win.open('quartermaster');
    const card = root.querySelector<HTMLElement>(
      `[data-gh-offer="${GUILD_QUARTERMASTER_STOCK[1].id}"]`,
    );
    const html = card ? tips.get(card)?.() : '';
    expect(html).toContain('<div class="tt-title">Title: Hallsworn</div>');
    expect(html).toContain('class="tt-red"');
  });

  it('hands focus back to the pressed card and the seal chip without popping a hover card', () => {
    const { root, win } = mount(world(3));
    win.open('quartermaster');
    const id = GUILD_QUARTERMASTER_STOCK[2].id;
    root.querySelector<HTMLButtonElement>(`[data-gh-offer="${id}"]`)?.focus();
    root.querySelector<HTMLButtonElement>(`[data-gh-offer="${id}"]`)?.click();
    const twin = root.querySelector<HTMLButtonElement>(`[data-gh-offer="${id}"]`);
    expect(document.activeElement).toBe(twin);
    // the flag attachTooltip's focusin reads (and clears) before it would show the card
    expect(twin?.dataset.suppressFocusTooltip).toBe('true');
    // the seal chip is a named button whose focus survives a rebuild
    const chip = root.querySelector<HTMLButtonElement>('[data-gh-seals]');
    expect(chip?.tagName).toBe('BUTTON');
    expect(
      document.getElementById(chip?.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toMatch(/Garrick Holt/);
    chip?.focus();
    win.relocalize();
    expect(document.activeElement).toBe(root.querySelector('[data-gh-seals]'));
    // a disabled buy names its reason
    const buy = root.querySelector<HTMLButtonElement>(`[data-gh-buy="${id}"]`);
    expect(buy?.disabled).toBe(true);
    expect(document.getElementById(buy?.getAttribute('aria-describedby') ?? '')?.className).toBe(
      'gh-short',
    );
    win.close();
  });

  it('repaints when the horse or an appearance becomes owned', () => {
    const owned: string[] = [];
    const w = { ...world(99), ownedMounts: () => owned };
    const { root, win } = mount(w as ReturnType<typeof world>);
    win.open('quartermaster');
    root.querySelector<HTMLButtonElement>('[data-gh-offer="mount_lantern_hall_destrier"]')?.click();
    root.querySelector('.gh-stock')?.setAttribute('data-probe', '1');
    win.refreshIfChanged();
    expect(root.querySelector('.gh-stock')?.getAttribute('data-probe')).toBe('1');
    owned.push('lantern_hall_destrier');
    win.refreshIfChanged();
    expect(root.querySelector('.gh-stock')?.getAttribute('data-probe')).toBeNull();
    expect(
      root.querySelector<HTMLButtonElement>('[data-gh-buy="mount_lantern_hall_destrier"]')
        ?.disabled,
    ).toBe(true);
    win.close();
  });

  it('stages the horse and the appearances in 3D over the existing hosts, and lets go', () => {
    stageLog.built = 0;
    stageLog.calls = [];
    stageLog.fail = false;
    const w = world(5);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tryOn = vi.fn((stage: HTMLElement) => {
      // Hud's shared turntable moves its one canvas into the stage it is handed
      stage.appendChild(document.createElement('canvas'));
    });
    const win = new GuildHallWindow({
      root: () => root,
      world: () => w as never,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      tryOnWeaponSkin: tryOn,
    });
    const pick = (id: string) =>
      root.querySelector<HTMLButtonElement>(`[data-gh-offer="${id}"]`)?.click();
    win.open('quartermaster');
    // a title's preview is its nameplate: no stage, no preview host touched
    expect(root.querySelector('.gh-plate')).not.toBeNull();
    expect(root.querySelector('.gh-stage')).toBeNull();
    expect([stageLog.built, tryOn.mock.calls.length]).toEqual([0, 0]);
    // the horse: one mount rig, the rider seated on it, live
    pick('mount_lantern_hall_destrier');
    const stage = root.querySelector<HTMLElement>('.gh-stage-mount');
    expect(stage?.querySelector('canvas')).not.toBeNull();
    expect(stage?.getAttribute('role')).toBe('img');
    expect(stage?.getAttribute('aria-label')).toBe('3D preview of Lantern Hall Destrier');
    expect(stage?.closest('.gh-model-stage')?.textContent).toContain('You, in the saddle');
    expect(stageLog.built).toBe(1);
    expect(stageLog.calls).toEqual([
      'mode:rider',
      'scene:dusk',
      'mount:lantern_hall_destrier',
      'active:true',
    ]);
    // a repaint (the seals moved) re-attaches the same stage: no second context
    w.inventory = [{ itemId: LANTERN_SEAL_ITEM_ID, count: 6 }];
    win.refreshIfChanged();
    expect(root.querySelector('.gh-stage-mount')).toBe(stage);
    expect(stageLog.built).toBe(1);
    // an appearance: the horse's context is disposed first, then the shared turntable holds it
    pick('weapon_skin_lantern_hall_sword');
    expect(stageLog.calls.slice(-2)).toEqual(['active:false', 'dispose']);
    expect(stage?.isConnected).toBe(false);
    expect(tryOn).toHaveBeenCalledTimes(1);
    const weapon = root.querySelector<HTMLElement>('.gh-stage-weapon');
    expect(tryOn.mock.calls[0]).toEqual([weapon, 'lantern_hall_sword']);
    expect(weapon?.closest('.gh-model-stage')?.textContent).toContain('In your hand');
    // a title leaves the stage entirely
    pick(TITLES[0].id);
    expect(weapon?.isConnected).toBe(false);
    expect(root.querySelector('.gh-stage')).toBeNull();
    // the contracts tab and closing the window both let a staged horse go
    pick('mount_lantern_hall_destrier');
    expect(stageLog.built).toBe(2);
    root.querySelector<HTMLButtonElement>('[data-gh-tab="contracts"]')?.click();
    expect(stageLog.calls.at(-1)).toBe('dispose');
    expect(root.querySelector('.gh-stage')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-gh-tab="quartermaster"]')?.click();
    expect(stageLog.built).toBe(3);
    win.close();
    expect(stageLog.calls.at(-1)).toBe('dispose');
    // no context on this device: the detail still opens, the stage says why it is empty
    stageLog.fail = true;
    win.open('quartermaster');
    pick('mount_lantern_hall_destrier');
    expect(root.querySelector('.gh-stage-empty')?.textContent).toBe(
      '3D preview unavailable on this device.',
    );
    win.close();
  });

  it('repaints only when its signature moves', () => {
    const w = world(0);
    const { root, win } = mount(w);
    win.open('contracts');
    win.refreshIfChanged();
    const painted = root.innerHTML;
    root.querySelector('.gh-cards')?.setAttribute('data-probe', '1');
    win.refreshIfChanged();
    expect(root.querySelector('.gh-cards')?.getAttribute('data-probe')).toBe('1');
    w.guildContracts = board([board().offered[0]]);
    win.refreshIfChanged();
    expect(root.querySelector('.gh-cards')?.getAttribute('data-probe')).toBeNull();
    expect(root.innerHTML).not.toBe(painted);
  });
});

describe("routing the guild's events", () => {
  function host() {
    return {
      log: vi.fn(),
      questBanner: { show: vi.fn() },
      showBanner: vi.fn(),
      questDialog: { refresh: vi.fn(), open: vi.fn() },
      weeklyQuestsWindow: { open: vi.fn() },
      guildHallWindow: { open: vi.fn(), refreshIfChanged: vi.fn() },
      dungeonFinderWindow: { open: vi.fn() },
      showError: vi.fn(),
      worldQuestPuzzleWindow: { applyEventPresentation: vi.fn() },
      treasureMapWindow: { open: vi.fn(), refresh: vi.fn() },
    };
  }

  it('opens the window on the tab, the finder for the recruiter, and logs payments and refusals', () => {
    const h = host();
    const send = (ev: Record<string, unknown>) =>
      applyQuestEventPresentation(h, ev as unknown as SimEvent);
    expect(send({ type: 'guildHallOpen', tab: 'quartermaster' })).toBe(true);
    expect(h.guildHallWindow.open).toHaveBeenCalledWith('quartermaster');
    expect(send({ type: 'guildRecruiterOpen' })).toBe(true);
    expect(h.dungeonFinderWindow.open).toHaveBeenCalled();
    expect(send({ type: 'guildContractDone', contractId: board().offered[0], seals: 1 })).toBe(
      true,
    );
    expect(h.log.mock.calls[0][0]).toMatch(/You receive 1 Lantern Seal\./);
    expect(send({ type: 'guildCosmeticBought', offerId: GUILD_QUARTERMASTER_STOCK[0].id })).toBe(
      true,
    );
    expect(h.log.mock.calls[1][0]).toMatch(/Writ-Runner/);
    send({ type: 'guildCosmeticBought', offerId: 'mount_lantern_hall_destrier' });
    expect(h.log.mock.calls[2][0]).toBe(
      'You bought the Lantern Hall Destrier. Its reins are in your bags.',
    );
    send({ type: 'guildCosmeticBought', offerId: 'weapon_skin_lantern_hall_sword' });
    expect(h.log.mock.calls[3][0]).toBe(
      'You bought the Blade of Lantern Hall appearance. Apply it from the Cosmetics window.',
    );
    // every refusal reason resolves to its own English line, never a raw key
    for (const [reason, line] of [
      ['seals', 'You do not have enough Lantern Seals.'],
      ['owned', 'You already own that.'],
      ['range', 'Stand at the quartermaster to trade.'],
      ['riding', 'Learn to ride before you buy a mount.'],
      ['bags', 'Your bags are full.'],
    ]) {
      expect(send({ type: 'guildCosmeticRefused', offerId: 'x', reason })).toBe(true);
      expect(h.showError).toHaveBeenLastCalledWith(line);
    }
    // an offer this client does not know logs nothing
    const logged = h.log.mock.calls.length;
    expect(send({ type: 'guildCosmeticBought', offerId: 'phantom' })).toBe(true);
    expect(h.log.mock.calls.length).toBe(logged);
  });
});

describe('the online mirror', () => {
  it('decodes the gcon key, dropping ids the catalog does not know', () => {
    const offered = board().offered;
    expect(
      decodeGuildContractsWire({
        week: WEEK,
        offered: [...offered, 'phantom'],
        done: [offered[0], 7],
        lifetime: 4.6,
      }),
    ).toEqual({ week: WEEK, offered, done: [offered[0]], lifetime: 4 });
    expect(decodeGuildContractsWire(null)).toEqual({
      week: '',
      offered: [],
      done: [],
      lifetime: 0,
    });
    expect(decodeGuildContractsWire([1, 2])).toEqual({
      week: '',
      offered: [],
      done: [],
      lifetime: 0,
    });
  });
});
