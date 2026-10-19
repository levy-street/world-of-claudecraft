// Item history doors (docs/design/item-tracking.md): another player can open a
// tracked copy's history from the trade window (both offers), the guild bank,
// a World Market listing row and the inspect window's worn rows. Every recipe
// stages REAL sim state offline: a second local player ("Borin", seated with
// sim.addPlayer) holds a tracked epic whose provenance names earlier hands, and
// then trades it, deposits it in a guild bank book, lists it on the market, or
// wears it. Only the online-only read the offline Sim keeps inert forever (the
// guild bank snapshot, sim.guildBankInfo) is pointed at the sim's own gated
// read (guildBankInfoFor), so the pane renders the real member projection.
//
// The same recipes shoot the BEFORE tree (the PR head without the doors). Each
// capture asserts the tree it runs on: when the door's pure core
// (src/ui/item_history_access_view.ts) exists the door must render, and when
// it does not the surface must show no door, so a stale dev server or a wrong
// checkout fails loudly instead of shooting the wrong side.

import { dismissPerfNudge } from './perf_nudge_dismiss.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BORIN = 'Borin';
const DAY = 86400000;
const ORIGIN_AT = Date.UTC(2026, 7, 14, 19, 0, 0);

// The tracked copy every surface shows: looted by Kaelra, then passed through
// two more hands before Borin (the movement grant below appends Borin). The
// guid is a fixed canonical UUID so the copy is tracked from the first grant.
const WARBLADE = {
  itemId: 'duskforged_warblade',
  instance: {
    guid: '4d6f1c2a-8b3e-4f5a-9c7d-2e1b0a9f8c6d',
    provenance: {
      at: ORIGIN_AT,
      by: 'Kaelra',
      source: 'mob:grimtusk',
      zone: 'zone1',
      owners: [
        { at: ORIGIN_AT + 9 * DAY, by: 'Brannoc' },
        { at: ORIGIN_AT + 23 * DAY, by: 'Elowen' },
      ],
      transfers: 2,
    },
  },
};

// A second tracked copy, for the viewer's own trade offer and Borin's neck.
const PENDANT = {
  itemId: 'wyrmfall_pendant',
  instance: {
    guid: '9a2e7b4c-1d5f-4c8e-a3b6-7f0d2c9e1b4a',
    provenance: { at: ORIGIN_AT + 4 * DAY, by: 'Thessaly', source: 'quest:q_wyrmfall' },
  },
};

const DOOR = '.item-history-action';
const DIALOG = '.item-history-dialog';

/** Whether this tree ships the doors: the door's pure core exists. */
async function treeHasDoors(page) {
  return page.evaluate(async () => {
    try {
      await import('/src/ui/item_history_access_view.ts');
      return true;
    } catch {
      return false;
    }
  });
}

async function pollFor(page, fn, arg, attempts = 30, intervalMs = 500) {
  for (let i = 0; i < attempts; i++) {
    if (await page.evaluate(fn, arg)) return true;
    await wait(intervalMs);
  }
  return false;
}

const shown = (sel) =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || getComputedStyle(el).display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;

async function waitShown(page, sel, what) {
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(shown(sel))) return;
    await wait(500);
  }
  throw new Error(`${what} never rendered (${sel})`);
}

// The loading veil can rise again after the staging teleport; a clip taken
// under it shoots the curtain art, so hold until it has stayed down a while.
async function waitVeilDown(page) {
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 6; i++) {
    const down = await page.evaluate(() => {
      const veil = document.getElementById('loading-screen');
      if (!veil) return true;
      const s = getComputedStyle(veil);
      return s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0;
    });
    quiet = down ? quiet + 1 : 0;
    await wait(500);
  }
}

/** Seat Borin beside the viewer at `anchor` ({x, z}, or an NPC template id to
 *  stand next to), and hand him the tracked copies as a change of hands. */
async function stageBorin(page, anchor, grants) {
  // The entry flow falls through on a slow boot; the staging needs the world.
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 180000 });
  const staged = await page.evaluate(
    (name, anchor, grants) => {
      const sim = window.__game?.sim;
      if (!sim?.player || typeof sim.addPlayer !== 'function') return { ok: false, why: 'no sim' };
      let at = typeof anchor === 'object' ? anchor : null;
      if (!at) {
        for (const e of sim.entities.values()) {
          if (e.kind === 'npc' && e.templateId === anchor) at = { x: e.pos.x, z: e.pos.z };
        }
      }
      if (!at) return { ok: false, why: `no anchor ${anchor}` };
      const place = (e, dx) => {
        e.pos = { ...e.pos, x: at.x + dx, z: at.z };
        e.prevPos = { ...e.pos };
        sim.rebucket?.(e);
      };
      place(sim.player, 0);
      const borin = sim.addPlayer('warrior', name);
      const be = sim.entities.get(borin);
      be.level = 40;
      place(be, 2);
      for (const g of grants) {
        sim.addItemInstance(g.itemId, structuredClone(g.instance), borin, 1, { movement: true });
      }
      return { ok: true, borin };
    },
    BORIN,
    anchor,
    grants,
  );
  if (!staged.ok) throw new Error(`staging failed: ${staged.why}`);
  return staged.borin;
}

/** Assert the door matches the tree, then return whether it is there. */
async function assertDoors(page, scope, surface) {
  const hasDoors = await treeHasDoors(page);
  const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, scope);
  console.log(`[item-history-${surface}] tree has doors: ${hasDoors}, door count: ${count}`);
  if (hasDoors && count === 0) throw new Error(`${surface}: AFTER tree but no door rendered`);
  if (!hasDoors && count > 0) throw new Error(`${surface}: BEFORE tree but a door rendered`);
  return hasDoors;
}

/** The viewport region covering every listed element that is on screen. */
async function unionClip(page, selectors) {
  return page.evaluate((sels) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
    if (!Number.isFinite(x0)) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, selectors);
}

/** Open the dialog through a REAL input: a click on the visible button, or a
 *  mouse right-click on the row/cell (the desktop door for a grid cell). */
async function openDialog(page, selector, how, surface) {
  await page.evaluate(
    (sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }),
    selector,
  );
  await wait(200);
  await page.click(selector, how === 'contextmenu' ? { button: 'right' } : undefined);
  await waitShown(page, DIALOG, `${surface} Item history dialog`);
  const lines = await page.evaluate(
    (sel) => [...document.querySelectorAll(`${sel} .item-history-row`)].map((r) => r.textContent),
    DIALOG,
  );
  console.log(`[item-history-${surface}] dialog lines: ${JSON.stringify(lines)}`);
  if (!lines.some((l) => l.includes('Kaelra'))) {
    throw new Error(`${surface}: dialog does not show the counterparty copy's history`);
  }
}

/** The perf-doctor nudge lands on every slow capture box; press it away
 *  (the player's own Dismiss) before handing the region to the shutter. */
async function finish(page, clip) {
  await dismissPerfNudge(page);
  return { clip };
}

function hideBags(page) {
  return page.evaluate(() => {
    const bags = document.querySelector('#bags');
    if (bags) bags.style.display = 'none';
  });
}

export function itemHistoryDoorTargets({ beforeLoad, dismissOverlays }) {
  const when = ['ui/item_history_access_view', 'scripts/lib/pr_shot_item_history'];
  return [
    {
      key: 'item-history-trade',
      label: 'Trade window: the Item history button on both offers, and the partner copy history',
      when,
      variants: [
        { key: 'desktop', beforeLoad },
        { key: 'dialog', beforeLoad, dialog: true },
      ],
      async capture(page, variant) {
        await dismissOverlays(page);
        const borin = await stageBorin(page, 'bursar_fernando', [WARBLADE]);
        await waitVeilDown(page);
        await dismissOverlays(page);
        // A real offline trade: the viewer asks, Borin accepts, both stage a
        // tracked copy from their own bags (the exact payload they hold).
        const ok = await page.evaluate(
          (borin, pendant) => {
            const sim = window.__game.sim;
            sim.addItemInstance(pendant.itemId, structuredClone(pendant.instance));
            const held = (pid, itemId) =>
              sim.players.get(pid).inventory.find((s) => s?.itemId === itemId);
            sim.tradeRequest(borin);
            sim.tradeAccept(borin);
            const theirs = held(borin, 'duskforged_warblade');
            const mine = held(sim.playerId, pendant.itemId);
            if (!theirs || !mine) return false;
            sim.tradeSetOffer([structuredClone(theirs)], 0, borin);
            sim.tradeSetOffer([structuredClone(mine)], 0);
            return !!sim.tradeInfo;
          },
          borin,
          PENDANT,
        );
        if (!ok) throw new Error('trade did not open');
        await waitShown(page, '#trade-window', 'trade window');
        const rowsReady = await pollFor(
          page,
          () => document.querySelectorAll('#trade-window .trade-item').length >= 2,
        );
        if (!rowsReady) throw new Error('trade offers never rendered');
        await hideBags(page);
        await wait(600);
        const hasDoors = await assertDoors(page, `#trade-window ${DOOR}`, 'trade');
        if (variant.dialog && hasDoors) {
          await openDialog(page, `#trade-window .trade-col:last-child ${DOOR}`, 'click', 'trade');
          return finish(page, await unionClip(page, ['#trade-window', DIALOG]));
        }
        return finish(page, '#trade-window');
      },
    },
    {
      key: 'item-history-guild-bank',
      label: 'Guild bank: right-click a tracked cell for its history; a touch button under it',
      when,
      variants: [
        { key: 'desktop', beforeLoad, dialog: true },
        // A large landscape phone (932x430): the bank's fixed head leaves the
        // grid only a sliver on the 844x390 house frame, too short to show a
        // cell and the button under it together.
        { key: 'mobile', mobile: true, beforeLoad, viewport: { width: 932, height: 430 } },
      ],
      async capture(page, variant) {
        await dismissOverlays(page);
        const borin = await stageBorin(page, 'bursar_fernando', [WARBLADE, PENDANT]);
        await waitVeilDown(page);
        await dismissOverlays(page);
        // A loaded book, both players in the guild (the viewer a plain member,
        // Borin an officer who deposits through the real op), and the offline
        // facet's inert read pointed at the sim's own gated member snapshot.
        const ok = await page.evaluate((borin) => {
          const sim = window.__game.sim;
          const guildId = 4242;
          sim.loadGuildBank(guildId, { treasury: 1254300, purchasedSlots: 24, inventory: [] });
          sim.setPlayerGuildMembership(sim.playerId, { guildId, rank: 'member' });
          sim.setPlayerGuildMembership(borin, { guildId, rank: 'officer' });
          sim.addItem('rough_hide', 20, borin);
          sim.addItem('copper_ore', 12, borin);
          for (const id of [
            'duskforged_warblade',
            'wyrmfall_pendant',
            'rough_hide',
            'copper_ore',
          ]) {
            const inv = sim.players.get(borin).inventory;
            const at = inv.findIndex((s) => s?.itemId === id);
            if (at >= 0) sim.guildBankDepositFor(borin, at);
          }
          Object.defineProperty(sim, 'guildBankInfo', {
            configurable: true,
            get: () => sim.guildBankInfoFor(sim.playerId),
          });
          return (sim.guildBankInfo?.slots.length ?? 0) >= 2;
        }, borin);
        if (!ok) throw new Error('guild bank book did not stage');
        await page.evaluate(() => window.__game.hud.openBank());
        await waitShown(page, '#bank-window', 'bank window');
        await page.evaluate(() =>
          document.querySelector('#bank-window .bank-tab[data-tab="guild"]')?.click(),
        );
        const cells = await pollFor(
          page,
          () => document.querySelectorAll('#bank-window .bank-item').length >= 2,
        );
        if (!cells) throw new Error('guild bank grid never filled');
        await hideBags(page);
        await wait(600);
        const hasDoors = await treeHasDoors(page);
        if (variant.mobile) {
          await assertDoors(page, `#bank-window ${DOOR}`, 'guild-bank-mobile');
          // The short phone frame scrolls the pane: bring the grid and the
          // buttons under its cells into view.
          await page.evaluate(
            (door) =>
              document.querySelector(`#bank-window ${door}`)?.scrollIntoView({ block: 'end' }),
            DOOR,
          );
          await wait(400);
          await dismissPerfNudge(page);
          return finish(page, '#bank-window');
        }
        // Desktop: the door is the cell's right-click (no per-cell button).
        // The pane renders every slot at its wire index, so the book's index
        // of the Warblade names its cell.
        const cell = await page.evaluate(() => {
          const slots = window.__game.sim.guildBankInfo?.slots ?? [];
          const i = slots.findIndex((s) => s?.itemId === 'duskforged_warblade');
          const cells = [...document.querySelectorAll('#bank-window .bank-item')];
          if (i < 0 || !cells[i]) return false;
          cells[i].setAttribute('data-shot-cell', '1');
          return true;
        });
        if (!cell) throw new Error('tracked guild bank cell not found');
        if (hasDoors) {
          await openDialog(page, '[data-shot-cell]', 'contextmenu', 'guild-bank');
          return finish(page, await unionClip(page, ['#bank-window', DIALOG]));
        }
        await page.click('[data-shot-cell]', { button: 'right' });
        await wait(500);
        if (await page.evaluate(shown(DIALOG))) {
          throw new Error('guild-bank: BEFORE tree opened a history dialog');
        }
        return finish(page, '#bank-window');
      },
    },
    {
      key: 'item-history-market',
      label: 'World Market: the Item history button on a tracked listing, and its history',
      when,
      variants: [
        { key: 'desktop', beforeLoad },
        { key: 'dialog', beforeLoad, dialog: true },
        { key: 'mobile', mobile: true, beforeLoad },
      ],
      async capture(page, variant) {
        await dismissOverlays(page);
        // Borin lists the copy standing at the Merchant; the viewer browses it.
        const borin = await stageBorin(page, 'the_merchant', [WARBLADE]);
        await waitVeilDown(page);
        await dismissOverlays(page);
        const listed = await page.evaluate((borin) => {
          const sim = window.__game.sim;
          sim.addItemInstance('duskforged_bulwark', {}, borin);
          for (const id of ['duskforged_warblade', 'duskforged_bulwark']) {
            const slot = sim.players.get(borin).inventory.find((s) => s?.itemId === id);
            if (slot?.instance)
              sim.marketListInstance(id, 2450000, structuredClone(slot.instance), borin);
          }
          return sim.players.get(borin).inventory.every((s) => s?.itemId !== 'duskforged_warblade');
        }, borin);
        if (!listed) throw new Error('Borin could not list the tracked copy');
        await page.evaluate(() => {
          const el = document.querySelector('#market-window');
          if (el) el.style.display = 'none';
          window.__game.hud.openMarket();
        });
        await waitShown(page, '#market-window', 'market window');
        await page.evaluate(() => {
          const input = document.querySelector('#market-window .mkt-search');
          if (!input) return;
          input.value = 'Duskforged';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const rows = await pollFor(page, () =>
          [...document.querySelectorAll('#market-window .mkt-row')].some((r) =>
            /Duskforged Warblade/.test(r.textContent ?? ''),
          ),
        );
        if (!rows) throw new Error('the tracked listing never reached the browse rows');
        await hideBags(page);
        await wait(800);
        const hasDoors = await assertDoors(page, `#market-window ${DOOR}`, 'market');
        if (variant.dialog && hasDoors) {
          const target = await page.evaluate((door) => {
            for (const b of document.querySelectorAll(`#market-window ${door}`)) {
              if (/Duskforged Warblade/.test(b.getAttribute('aria-label') ?? '')) {
                b.setAttribute('data-shot-door', '1');
                return true;
              }
            }
            return false;
          }, DOOR);
          if (!target) throw new Error('market: no door on the Warblade row');
          await openDialog(page, '[data-shot-door]', 'click', 'market');
          return finish(page, await unionClip(page, ['#market-window', DIALOG]));
        }
        return finish(page, '#market-window');
      },
    },
    {
      key: 'item-history-inspect',
      label: 'Inspect: right-click a worn tracked row for its history; a touch button under it',
      when,
      variants: [
        { key: 'desktop', beforeLoad, dialog: true },
        { key: 'mobile', mobile: true, beforeLoad },
      ],
      async capture(page, variant) {
        await dismissOverlays(page);
        const borin = await stageBorin(page, 'bursar_fernando', [WARBLADE, PENDANT]);
        await waitVeilDown(page);
        await dismissOverlays(page);
        const worn = await page.evaluate((borin) => {
          const sim = window.__game.sim;
          sim.equipItem('duskforged_warblade', borin);
          sim.equipItem('wyrmfall_pendant', borin);
          const e = sim.entities.get(borin);
          window.__game.hud.openInspect(borin);
          return Object.keys(e.equippedInstances ?? {});
        }, borin);
        console.log(`[item-history-inspect] Borin wears tracked slots: ${JSON.stringify(worn)}`);
        if (!worn.includes('mainhand')) throw new Error('Borin did not equip the tracked warblade');
        await waitShown(page, '#inspect-window', 'inspect window');
        await wait(1500);
        const hasDoors = await treeHasDoors(page);
        if (variant.mobile) {
          await assertDoors(page, `#inspect-window ${DOOR}`, 'inspect-mobile');
          // The weapons row sits below the fold on a phone: bring the worn
          // Warblade row (and the button under it) into view.
          await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#inspect-equip-weapons > *')];
            rows
              .find((el) => /Duskforged Warblade/.test(el.textContent ?? ''))
              ?.scrollIntoView({ block: 'center' });
          });
          await wait(400);
          return finish(page, '#inspect-window');
        }
        const row = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#inspect-equip-weapons > *')];
          const r = rows.find((el) => /Duskforged Warblade/.test(el.textContent ?? ''));
          r?.setAttribute('data-shot-row', '1');
          return !!r;
        });
        if (!row) throw new Error('inspect: the worn Warblade row was not found');
        if (hasDoors) {
          await openDialog(page, '[data-shot-row]', 'contextmenu', 'inspect');
          return finish(page, await unionClip(page, ['#inspect-window', DIALOG]));
        }
        await page.click('[data-shot-row]', { button: 'right' });
        await wait(500);
        if (await page.evaluate(shown(DIALOG))) {
          throw new Error('inspect: BEFORE tree opened a history dialog');
        }
        return finish(page, '#inspect-window');
      },
    },
  ];
}
