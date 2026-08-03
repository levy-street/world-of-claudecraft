// Bag money-row freshness on a MONEY-ONLY change (issue #2373: collecting
// auction proceeds at the Merchant left the gold in the bag window stale until
// the player closed and reopened it).
//
// The defect is a missing convergence edge, not a missing button handler:
//  - the sim's proceeds arm moves ONLY meta.copper (src/sim/market.ts), so the
//    player's inventory is byte-identical;
//  - `copper` rides every self-frame in the server's UNCONDITIONAL base object
//    while `inv` is serialize-diffed, so a money-only frame carries no `inv`;
//  - ClientWorld therefore mirrored the new copper while raising NO
//    inventory-changed flag, and Hud.onInventoryChanged() (the one authoritative
//    online path to renderBags) never ran.
// The bag money row is a cold painter with no signature of its own, so nothing
// else converged it. That is the whole bug, and it is the same hole behind the
// trainer fee, the bank slot buy, and a settled Vale Cup bet.
//
// This file owns the WIRE half, driven through a REAL GameServer and a real
// ClientWorld: a proceeds-only collect must raise the flag from the copper delta
// alone (red before the fix), an unchanged purse must not raise it (which is what
// forces a diff rather than an `s.copper !== undefined` presence test, and with it a
// 20 Hz repaint), the pre-existing inventory arm must still flag, and the spectate
// anchor ruling is pinned so it cannot drift silently.
//
// The other two halves live where they can be EXECUTED rather than pattern-matched:
// the pure staleness decision is a truth table on bagsMoneyRowStale in
// tests/bags_view.test.ts, and the painter (including everything the refresh must
// not disturb) is driven against the real BagsWindow in
// tests/bags_money_row_paint.test.ts. Only the call-site wiring is pinned as source
// text here, and only where a unit test genuinely cannot reach.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the wire path is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { bareClient } from './helpers/bare_client';

const PROCEEDS = 54321;

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name = 'Fernando',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, 'warrior', null, false, {});
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function merchant(sim: any): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

/** Stand the player on the Merchant so marketCollect's proximity gate passes. */
function standAtMerchant(sim: any, pid: number): void {
  const m = merchant(sim);
  const e = sim.entities.get(pid);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

/**
 * A player parked at the Merchant with PROCEEDS waiting in their collection box
 * and one snapshot already mirrored, so the next broadcast is a true delta.
 * The priming consume is a FIXTURE control, not a negative control: the first full
 * snapshot always carries inv/buyback/bags, so it reports true with or without the
 * fix. Its job is to prove the flag mechanism itself works (and to clear the flag),
 * so a later read is attributable to the copper arm alone.
 */
function setup() {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, 7301);
  const sim = (server as any).sim;
  const meta = sim.players.get(session.pid);
  standAtMerchant(sim, session.pid);
  // Seed the seller's collection box with sale proceeds and NO items: the
  // money-only shape the issue reports.
  sim.market.marketCollections.set(String(meta.characterId ?? meta.entityId), {
    copper: PROCEEDS,
    items: [],
  });

  const client = bareClient(session.pid);
  (server as any).broadcastSnapshots();
  (client as any).applySnapshot(lastSnap(fc.sent));
  expect(client.consumeInventoryChanged()).toBe(true); // fixture control, see above
  fc.sent.length = 0;
  return { server, fc, session, sim, meta, client };
}

/** Collect, broadcast, and return the resulting delta snapshot. */
function collect(server: GameServer, fc: FakeClient, session: ClientSession): any {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'market_collect' }));
  (server as any).broadcastSnapshots();
  return lastSnap(fc.sent);
}

describe('bag money-row freshness on a money-only delta (#2373)', () => {
  it('raises the inventory-changed flag from the copper delta alone', () => {
    const { server, fc, session, meta, client } = setup();
    const copperBefore = meta.copper;
    const invBefore = JSON.stringify(meta.inventory);

    const snap = collect(server, fc, session);

    // The sim really did credit the purse...
    expect(meta.copper).toBe(copperBefore + PROCEEDS);
    // ...and really did leave the inventory untouched, which is WHY the wire
    // carries no inv echo. Assert both, so a future content change that starts
    // handing out an item here fails loudly here instead of silently making the
    // flag assertion below pass for the wrong reason.
    expect(JSON.stringify(meta.inventory)).toBe(invBefore);
    expect('inv' in snap.self).toBe(false);
    // `bags` and `buyback` raise the same flag from the same heavy-gated cluster,
    // so name them too: without this, a future wire change that started shipping
    // either one would keep the assertion below green for the wrong reason.
    expect('bags' in snap.self).toBe(false);
    expect('buyback' in snap.self).toBe(false);
    expect(snap.self.copper).toBe(copperBefore + PROCEEDS);

    (client as any).applySnapshot(snap);
    expect(client.copper).toBe(copperBefore + PROCEEDS);
    // The bug in one assertion. consumeInventoryChanged() is what src/main.ts
    // gates hud.onInventoryChanged() on, and onInventoryChanged is the only
    // authoritative online path that repaints the bag money row.
    // NOTE: this read is DESTRUCTIVE (it clears the flag), so call it once.
    expect(client.consumeInventoryChanged()).toBe(true);
  });

  it('stays quiet when the purse did NOT move (no 20 Hz repaint)', () => {
    const { server, fc, session, client } = setup();
    const snap = collect(server, fc, session);
    (client as any).applySnapshot(snap);
    expect(client.consumeInventoryChanged()).toBe(true);

    // A second broadcast with no further money movement. A fix written as
    // `if (s.copper !== undefined) this.invChanged = true` would pass the test
    // above and fire here on EVERY snapshot, tearing down the bags, the vendor,
    // the char sheet and the crafting probe twice a tick under the player's
    // cursor. Diffing against the prior mirror is what keeps this false.
    fc.sent.length = 0;
    (server as any).broadcastSnapshots();
    const quiet = lastSnap(fc.sent);
    expect(quiet.self.copper).toBe(client.copper); // copper still rides the frame
    (client as any).applySnapshot(quiet);
    expect(client.consumeInventoryChanged()).toBe(false);
  });

  it('still flags an inventory-bearing delta (the pre-existing arm is intact)', () => {
    // Guards against a fix that swapped the inv/buyback/bags flag writes for a
    // copper-only one: an item collect must keep converging as it always did.
    const { server, fc, session, sim, meta, client } = setup();
    sim.market.marketCollections.set(String(meta.characterId ?? meta.entityId), {
      copper: 0,
      items: [{ itemId: 'worn_sword', count: 1 }],
    });

    const snap = collect(server, fc, session);
    expect('inv' in snap.self).toBe(true);
    (client as any).applySnapshot(snap);
    expect(client.inventory.some((s) => s.itemId === 'worn_sword')).toBe(true);
    expect(client.consumeInventoryChanged()).toBe(true);
  });
});

describe('the spectate anchor (a ruling, pinned so it cannot drift silently)', () => {
  // While spectating, the server builds the whole self block from the SPECTATED
  // player's meta, and the client's self decode has no spectate branch. So the
  // viewer's purse mirror follows their target. That is pre-existing and is exactly
  // what `inv` has always done (the spectator's bag already lists the target's
  // items), which is why the purse is deliberately NOT special-cased: guarding only
  // copper would leave the window showing the target's ITEMS beside the viewer's own
  // GOLD, which is worse than either coherent answer. What this fix changes is only
  // that the row now converges promptly instead of holding a stale number.
  it('follows the spectated player, exactly as the inventory mirror already does', () => {
    const server = new GameServer();
    const targetFc = fakeWs();
    const target = joinServer(server, targetFc, 8801, 'Target');
    const viewerFc = fakeWs();
    const viewer = joinServer(server, viewerFc, 8802, 'Viewer');
    const sim = (server as any).sim;
    const targetMeta = sim.players.get(target.pid);

    (viewer as any).spectating = {
      characterId: 8801,
      name: 'Target',
      savedPos: { ...sim.entities.get(viewer.pid).pos },
      priorGm: false,
      stowedPet: null,
    };

    const client = bareClient(viewer.pid);
    (server as any).broadcastSnapshots();
    (client as any).applySnapshot(lastSnap(viewerFc.sent));
    client.consumeInventoryChanged();

    // The target earns money the viewer had nothing to do with.
    viewerFc.sent.length = 0;
    targetMeta.copper += 777;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(viewerFc.sent);

    expect(snap.self.copper).toBe(targetMeta.copper);
    // Attributable to the copper arm alone: without this, a future wire change that
    // started shipping inv on this frame would keep the flag assertion green for the
    // wrong reason.
    expect('inv' in snap.self).toBe(false);
    (client as any).applySnapshot(snap);
    expect(client.copper).toBe(targetMeta.copper);
    expect(client.consumeInventoryChanged()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wiring. The pure staleness decision is a truth table in tests/bags_view.test.ts
// and the painter behavior is driven for real in tests/bags_money_row_paint.test.ts,
// so what is left here is only WHERE the call sites live: code paths a unit test
// cannot execute (the per-frame update band, the online delta hook). Pinned against
// comment-stripped source, so prose alone can never satisfy a pin.
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const hud = stripComments(readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8'));

describe('bag purse-freshness wiring (source pins)', () => {
  it('drives the window probe from the SLOW band, never per frame', () => {
    // Pin the gate INLINE with the call rather than slicing a region: a region
    // ending at the next painter runs past the block's closing brace, so a call
    // hoisted just outside it would still sit inside the slice and pass. Requiring
    // the `if (slowHud)` prefix on the one and only occurrence cannot be dodged
    // that way: hoisting it to per-frame drops the prefix and reds this.
    // Heads-up for a future tidier: the slow-band siblings read `slowHud && X.isOpen`,
    // but this one is deliberately bare. BagsWindow.refreshIfChanged self-gates on the
    // window's own display through bagsMoneyRowStale, so an isOpen term here would be
    // a second gate for the same fact. Adding one is not wrong, but update this pin
    // deliberately rather than to make the line look like its neighbours.
    const calls = hud.match(/this\.bagsWindow\.refreshIfChanged\(\);/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(hud).toMatch(/if \(slowHud\) this\.bagsWindow\.refreshIfChanged\(\);/);
  });

  it('the online authoritative delta repaints the bags through the cold-safe gate', () => {
    // This is the edge that makes the ONLINE half of the fix visible: the copper
    // diff raises the flag, main.ts calls this hook, and this line repaints. Pin
    // the cold-load-safe form too (issue #1538): every money-only credit now routes
    // through here, so the raw `!== 'none'` compare would rebuild a window the
    // player has never opened on each one.
    expect(hud).toMatch(
      /onInventoryChanged\(\): void \{[^}]*if \(bagsWindowShown\(\$\('#bags'\)\.style\.display\)\) this\.renderBags\(\);/,
    );
  });

  it('keeps BOTH crafting reagent edges it is layered beside', () => {
    // The two staleness probes are independent. Deleting a crafting edge on the
    // theory that the purse diff now covers staleness would regress issue #2375.
    // Count rather than merely match: the crafting probe has to keep ALL THREE of
    // its call sites (the slow band, the online delta hook, and the vendor
    // buyAndRefresh closure), and a bare toMatch would stay green with two of them
    // removed. The behavior itself is pinned in tests/crafting_reagent_refresh.test.ts;
    // this only guards that adding the purse probe did not displace any of them.
    const crafting = hud.match(/this\.refreshOpenCraftingIfReagentsChanged\(\);/g) ?? [];
    expect(crafting).toHaveLength(3);
  });
});

describe('async balance reads repaint the FOOTER, not the whole window', () => {
  // Both $WOC and Claudium balances resolve on their own schedule with no user action
  // behind them, and both used to call the HUD's full renderBags() from a promise
  // resolve. That tore the window down under a player who was mid-drag, hovering a
  // tooltip, or typing in bag search, and it defeated the narrow money-row rewrite the
  // purse probe was built around (the Claudium read is 30s-throttled, so an open bag
  // with a moving purse hit it roughly twice a minute). Pinned per SITE, because a
  // whole-file assertion would be satisfied by either one alone.

  it('the wallet UI change listener repaints only the money row', () => {
    expect(hud).toMatch(/onWalletUiChange\(\(\) => \{[^}]*this\.bagsWindow\.refreshMoneyRow\(\);/);
    // ONLY. A toMatch on the new call says nothing about the old one: re-adding
    // `this.renderBags();` on the next line satisfies every affirmative pin here
    // while restoring the exact teardown this block is named after. Scoped to the
    // block, not the file, because ~7 other sites call renderBags() legitimately.
    expect(hud).not.toMatch(/onWalletUiChange\(\(\) => \{[^}]*this\.renderBags\(\);/);
  });

  // The Claudium balance itself no longer lives here to be pattern-matched. Its
  // state, its 30s read, the in-flight and stale-response guards and the changed-only
  // converge moved to src/ui/claudium_launcher_balance_core.ts (issues #2411, #2414),
  // where tests/claudium_launcher_balance.test.ts EXECUTES all of them: the elision on
  // an unchanged read, the re-entry guard on both paths (the in-flight flag inside a
  // resolve, the stamp-before-converge ordering on a direct write), the seq drop and
  // the throttle arithmetic. tests/bags_money_row_paint.test.ts then composes that
  // module with the real painter and counts paints. What is left for source text is
  // only the HUD's wiring: where the converge lands, and that nothing bypasses it.

  it('the Claudium balance converge repaints only the money row', () => {
    expect(hud).toMatch(
      /onChanged: \(\) => \{[^}]*if \(bagsWindowShown\(\$\('#bags'\)\.style\.display\)\) this\.bagsWindow\.refreshMoneyRow\(\);/,
    );
    // ONLY. A toMatch on the new call says nothing about the old one: re-adding
    // `this.renderBags();` on the next line satisfies every affirmative pin here
    // while restoring the exact teardown this block is named after.
    expect(hud).not.toMatch(/onChanged: \(\) => \{[^}]*this\.renderBags\(\);/);
  });

  it('routes every balance write through that one converging seam (#2414)', () => {
    // Three writes arrive without a launcher read: the WOC Store snapshot, a store
    // spend, and the Claudium window's snapshot. Each used to update a private field
    // and stop there, which is what left an open bag showing the pre-spend number.
    // Counted rather than merely matched, because the regression shape is a FOURTH
    // surface hand-wired around the seam; a new balance write goes through set() and
    // moves this number deliberately.
    const writes = hud.match(/this\.claudiumBalance\.set\(/g) ?? [];
    expect(writes).toHaveLength(3);
    // And no shadow copy survived the extraction. A balance the HUD assigned itself
    // would render from state the converge and the changed compare never see, which
    // is both bugs back in one line.
    expect(hud).not.toMatch(/this\.claudiumLauncherBalance/);
  });

  it('writes the balance each of those surfaces actually reported', () => {
    // The count above says three writers exist; it says nothing about WHAT they write.
    // Swapping an argument for the balance already held typechecks (the getter is
    // `number | null`) and quietly re-opens #2414 for that one surface while every
    // other pin in this file stays green, so slice each closure and name its argument.
    const between = (from: string, to: string): string => {
      const start = hud.indexOf(from);
      expect(start, `anchor missing: ${from}`).toBeGreaterThan(-1);
      const end = hud.indexOf(to, start);
      expect(end, `anchor missing: ${to}`).toBeGreaterThan(start);
      return hud.slice(start, end);
    };
    expect(between('storeSnapshot: async () => {', 'spendStoreItem:')).toContain(
      'this.claudiumBalance.set(snapshot.balance);',
    );
    expect(between('spendStoreItem: async (', 'openClaudium:')).toContain(
      'this.claudiumBalance.set(result.balance);',
    );
    expect(between('new ClaudiumWindow({', 'buy: (rail, sku)')).toContain(
      'this.claudiumBalance.set(snapshot.balance);',
    );
  });

  it('keeps the launcher label starting the throttled read it renders from', () => {
    // The label paint IS the poll: nothing else drives an unforced read, so dropping
    // this call would freeze the number at whatever the last forced read left.
    expect(hud).toMatch(
      /claudiumLauncherHtml\(\): string \{[^}]*this\.claudiumBalance\.refresh\(\);/,
    );
  });

  it('neither async path is left on the cold-load-unsafe raw display compare', () => {
    // `!== 'none'` reads a never-opened window as shown (#1538), so the old form
    // would paint a window the player has never opened on every balance read.
    const sites = hud.match(/this\.bagsWindow\.refreshMoneyRow\(\);/g) ?? [];
    expect(sites).toHaveLength(2);
    const guarded =
      hud.match(
        /if \(bagsWindowShown\(\$\('#bags'\)\.style\.display\)\) this\.bagsWindow\.refreshMoneyRow\(\);/g,
      ) ?? [];
    expect(guarded).toHaveLength(2);
  });
});

describe('ClientWorld purse decode (source pin)', () => {
  const online = stripComments(
    readFileSync(path.resolve(process.cwd(), 'src/net/online.ts'), 'utf8'),
  );

  it('diffs the purse against the prior mirror rather than testing presence', () => {
    // The behavior is proven by the runtime tests above; this pin names the FORM,
    // because the presence-test mistake is silent (it passes the flag test and only
    // shows up as a continuous repaint in a real client).
    expect(online).toContain('if (copper !== this.copper) this.invChanged = true;');
    expect(online).not.toMatch(/if \(s\.copper !== undefined\) this\.invChanged = true;/);
  });
});
