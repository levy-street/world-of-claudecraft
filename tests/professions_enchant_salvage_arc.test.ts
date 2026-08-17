// The real-behavior end-to-end arc.
// Exercises the three commands through the surfaces a player reaches:
// offline Sim through the IWorld surface, then online through a live in-process
// GameServer (harness modeled on tests/professions_bind_on_trade_online.test.ts).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { ClientWorld } from '../src/net/online';
import { BUILTIN_WORLD } from '../src/sim/data';
import { MARKET_MAX_LISTINGS } from '../src/sim/market';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import * as tradeMod from '../src/sim/social/trade';
import type { Entity, InvSlot, SimEvent, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { bareClient } from './helpers/bare_client';
import {
  completeEnchantFamilyCast,
  runApplyEnchant,
  runCraft,
  runDisenchant,
  runSalvage,
} from './helpers/enchant_family_cast';

// Subsystem world (Phase 9 pattern, tests/sim_shared.ts): every offline Sim in
// this suite exercises crafting, disenchant/enchant/salvage, player trade, and
// the World Market, never an ambient camp or mob. It DOES need two built-in
// NPCs by templateId (moveToVendor's trader_wilkes, moveToMerchant's
// the_merchant), so this keeps every built-in npc (fixed placements, no rng
// draw) and trims only the camps and groundObjects that spawn the rest of the
// 11-zone world's mobs/loot and consume rng draws neither surface here reads.
const PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  groundObjects: [],
};

/** Complete a running enchant-family cast on the server sim and route events. */
function flushEnchantFamilyCast(server: GameServer, pid: number): void {
  completeEnchantFamilyCast(server.sim as unknown as import('../src/sim/sim').Sim, pid);
  routeTick(server);
}

const RARE_WEAPON = 'moggers_copper_cudgel'; // rare mace -> resonant_steel
const COMMON_WEAPON = 'eastbrook_arming_sword';
const CRAFTED_COMMON_ARMOR = 'eastbrook_chain_vest';
const CRAFTED_COMMON_ARMOR_RECIPE = 'recipe_eastbrook_chain_vest';
const ENCHANT = 'enchant_weapon_runed_edge'; // essence x2 + resonant_steel x1
const ESSENCE = 'arcane_essence';
const SECONDARY = 'resonant_steel';
const DUST = 'arcane_dust';

type WireMsg = {
  t: string;
  list?: SimEvent[];
  self?: Record<string, unknown>;
  [k: string]: unknown;
};

type SnapMsg = WireMsg & {
  t: 'snap';
  self: Record<string, unknown>;
};

function fakeWs(): { sent: WireMsg[]; ws: unknown } {
  const sent: WireMsg[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: ReturnType<typeof fakeWs>,
  id: number,
  name: string,
): ClientSession {
  const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
  const entity = (server.sim as unknown as { entities: Map<number, Entity> }).entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { ...entity.pos };
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function broadcast(server: GameServer): void {
  (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
}

function isSnapMsg(msg: WireMsg): msg is SnapMsg {
  return msg.t === 'snap' && typeof msg.self === 'object' && msg.self !== null;
}

function lastSnap(sent: WireMsg[]): SnapMsg | null {
  for (let i = sent.length - 1; i >= 0; i--) {
    const msg = sent[i];
    if (isSnapMsg(msg)) return msg;
  }
  return null;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function eventsFor(sent: WireMsg[], type: SimEvent['type'], fromIdx = 0): SimEvent[] {
  return sent
    .slice(fromIdx)
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
}

function serverInv(server: GameServer, pid: number): InvSlot[] {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta.inventory;
}

function simInv(sim: Sim, pid: number): InvSlot[] {
  const meta = (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta.inventory;
}

function metaFor(sim: Sim, pid: number): PlayerMeta {
  const meta = (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta;
}

function grantVestMaterials(sim: Sim, pid: number): void {
  sim.addItem('copper_ore', 4, pid);
  sim.addItem('smithing_flux', 9, pid);
}

function craftedVestSlotIndex(sim: Sim, pid: number): number {
  return simInv(sim, pid).findIndex(
    (slot) =>
      slot.itemId === CRAFTED_COMMON_ARMOR && slot.craftedRecipeId === CRAFTED_COMMON_ARMOR_RECIPE,
  );
}

function applySnap(client: ClientWorld, snap: unknown): void {
  (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
}

function moveToVendor(sim: Sim): void {
  const trader = [...sim.ctx.entities.values()].find((e) => e.templateId === 'trader_wilkes');
  if (!trader) throw new Error('missing trader_wilkes');
  const player = sim.ctx.entities.get(sim.playerId);
  if (!player) throw new Error('missing player');
  player.pos.x = trader.pos.x + 2;
  player.pos.z = trader.pos.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

// The World Market's Merchant NPC (market.ts nearMerchant), distinct from
// trader_wilkes above (vendor buyback only, never market: true).
function moveToMerchant(sim: Sim, pid: number): void {
  const merchant = [...sim.ctx.entities.values()].find((e) => e.templateId === 'the_merchant');
  if (!merchant) throw new Error('missing the_merchant');
  const player = sim.ctx.entities.get(pid);
  if (!player) throw new Error(`missing player ${pid}`);
  player.pos.x = merchant.pos.x + 2;
  player.pos.z = merchant.pos.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

describe('offline Sim end-to-end (IWorld surface)', () => {
  it('crafted Eastbrook Chainmail Vest stacks yield materials but never teach Enchanting', () => {
    const sim = new Sim({
      seed: 20260726,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);

    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    const firstSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(firstSlotIndex).toBeGreaterThanOrEqual(0);
    expect(simInv(sim, pid)[firstSlotIndex].instance).toBeUndefined();

    const dustBefore = sim.countItem(DUST, pid);
    runDisenchant(sim, CRAFTED_COMMON_ARMOR, pid, firstSlotIndex);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(sim.countItem(DUST, pid)).toBeGreaterThan(dustBefore);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, pid)).toBe(0);
    expect(meta.craftSkills.enchanting).toBe(0);

    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    const secondSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(secondSlotIndex).toBeGreaterThanOrEqual(0);

    runDisenchant(sim, CRAFTED_COMMON_ARMOR, pid, secondSlotIndex);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, pid)).toBe(0);
    expect(meta.craftSkills.enchanting).toBe(0);
  });

  it('crafted Eastbrook Chainmail Vest replacement keeps provenance before disenchant', () => {
    const sim = new Sim({
      seed: 20260728,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);

    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    const craftedSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(craftedSlotIndex).toBeGreaterThanOrEqual(0);

    sim.equipItem(CRAFTED_COMMON_ARMOR, pid);
    expect(meta.equipment.chest).toBe(CRAFTED_COMMON_ARMOR);
    expect(meta.equipmentInstance.chest?.craftedRecipeId).toBe(CRAFTED_COMMON_ARMOR_RECIPE);
    expect(craftedVestSlotIndex(sim, pid)).toBe(-1);

    sim.equipItem('recruit_tunic', pid);
    expect(meta.equipment.chest).toBe('recruit_tunic');
    const returnedSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(returnedSlotIndex).toBeGreaterThanOrEqual(0);

    const dustBefore = sim.countItem(DUST, pid);
    runDisenchant(sim, CRAFTED_COMMON_ARMOR, pid, returnedSlotIndex);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(sim.countItem(DUST, pid)).toBeGreaterThan(dustBefore);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, pid)).toBe(0);
    expect(meta.craftSkills.enchanting).toBe(0);
  });

  it('crafted Eastbrook Chainmail Vest unequip keeps provenance before disenchant', () => {
    const sim = new Sim({
      seed: 20260729,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);

    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);

    sim.equipItem(CRAFTED_COMMON_ARMOR, pid);
    expect(meta.equipmentInstance.chest?.craftedRecipeId).toBe(CRAFTED_COMMON_ARMOR_RECIPE);
    expect(sim.unequipItem('chest', pid)).toBe(true);
    const returnedSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(returnedSlotIndex).toBeGreaterThanOrEqual(0);

    runDisenchant(sim, CRAFTED_COMMON_ARMOR, pid, returnedSlotIndex);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(meta.craftSkills.enchanting).toBe(0);
  });

  it('crafted Eastbrook Chainmail Vest buyback keeps provenance before disenchant', () => {
    const sim = new Sim({
      seed: 20260730,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    moveToVendor(sim);

    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    const craftedSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(craftedSlotIndex).toBeGreaterThanOrEqual(0);
    expect(simInv(sim, pid)[craftedSlotIndex].instance).toBeUndefined();

    sim.sellItem(CRAFTED_COMMON_ARMOR, 1, pid);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, pid)).toBe(0);
    expect(meta.vendorBuyback[0]).toMatchObject({
      itemId: CRAFTED_COMMON_ARMOR,
      count: 1,
      craftedRecipeId: CRAFTED_COMMON_ARMOR_RECIPE,
    });

    sim.buyBackItem(CRAFTED_COMMON_ARMOR, 0, undefined, CRAFTED_COMMON_ARMOR_RECIPE);
    const boughtBackSlotIndex = craftedVestSlotIndex(sim, pid);
    expect(boughtBackSlotIndex).toBeGreaterThanOrEqual(0);

    const dustBefore = sim.countItem(DUST, pid);
    runDisenchant(sim, CRAFTED_COMMON_ARMOR, pid, boughtBackSlotIndex);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(sim.countItem(DUST, pid)).toBeGreaterThan(dustBefore);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, pid)).toBe(0);
    expect(meta.craftSkills.enchanting).toBe(0);
  });

  // BUG #9: the same craftedRecipeId marker used to have no equivalent on
  // PendingGrant (social/trade.ts), so a plain crafted stack re-granted to the
  // trade recipient with no marker at all, laundering its provenance and
  // letting the recipient disenchant it for full Enchanting skill.
  it('crafted Eastbrook Chainmail Vest keeps provenance across a player trade before disenchant', () => {
    const sim = new Sim({
      seed: 20260731,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
      noPlayer: true,
    });
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('warrior', 'Buyer');
    const sellerEntity = sim.ctx.entities.get(seller);
    const buyerEntity = sim.ctx.entities.get(buyer);
    if (!sellerEntity || !buyerEntity) throw new Error('missing trade entities');
    buyerEntity.pos.x = sellerEntity.pos.x + 2;
    buyerEntity.pos.z = sellerEntity.pos.z;

    grantVestMaterials(sim, seller);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, seller);
    expect(metaFor(sim, seller).lastCraftResult?.ok).toBe(true);
    expect(craftedVestSlotIndex(sim, seller)).toBeGreaterThanOrEqual(0);

    tradeMod.tradeRequest(sim.ctx, buyer, seller);
    tradeMod.tradeAccept(sim.ctx, buyer);
    tradeMod.tradeSetOffer(sim.ctx, [{ itemId: CRAFTED_COMMON_ARMOR, count: 1 }], 0, seller);
    tradeMod.tradeConfirm(sim.ctx, seller);
    tradeMod.tradeConfirm(sim.ctx, buyer);

    expect(sim.countItem(CRAFTED_COMMON_ARMOR, seller)).toBe(0);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, buyer)).toBe(1);
    const buyerSlotIndex = craftedVestSlotIndex(sim, buyer);
    expect(buyerSlotIndex).toBeGreaterThanOrEqual(0);

    runDisenchant(sim, CRAFTED_COMMON_ARMOR, buyer, buyerSlotIndex);
    expect(sim.lastDisenchantResultFor(buyer)?.ok).toBe(true);
    expect(metaFor(sim, buyer).craftSkills.enchanting).toBe(0);
  });

  // BUG #9's other half: MarketListing had no craftedRecipeId field either, so a
  // crafted stack bought off the World Market re-granted to the buyer bare,
  // with the same skill-farming consequence.
  it('crafted Eastbrook Chainmail Vest keeps provenance across a World Market sale before disenchant', () => {
    const sim = new Sim({
      seed: 20260732,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
      noPlayer: true,
    });
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('warrior', 'Buyer');
    moveToMerchant(sim, seller);
    moveToMerchant(sim, buyer);
    metaFor(sim, buyer).copper = 1000;

    grantVestMaterials(sim, seller);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, seller);
    expect(metaFor(sim, seller).lastCraftResult?.ok).toBe(true);
    expect(craftedVestSlotIndex(sim, seller)).toBeGreaterThanOrEqual(0);

    sim.marketList(CRAFTED_COMMON_ARMOR, 1, 100, seller);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, seller)).toBe(0);
    const listing = sim.marketListings.find((l) => l.itemId === CRAFTED_COMMON_ARMOR && !l.house);
    expect(listing).toBeDefined();
    expect(listing?.craftedRecipeId).toBe(CRAFTED_COMMON_ARMOR_RECIPE);

    sim.marketBuy(listing!.id, buyer);
    expect(sim.countItem(CRAFTED_COMMON_ARMOR, buyer)).toBe(1);
    const buyerSlotIndex = craftedVestSlotIndex(sim, buyer);
    expect(buyerSlotIndex).toBeGreaterThanOrEqual(0);

    runDisenchant(sim, CRAFTED_COMMON_ARMOR, buyer, buyerSlotIndex);
    expect(sim.lastDisenchantResultFor(buyer)?.ok).toBe(true);
    expect(metaFor(sim, buyer).craftSkills.enchanting).toBe(0);
  });

  // BUG #9 edge case the fix must not reopen: some items are BOTH craftable and
  // drop-sourced (recipes.ts: boundstone_helm off two dungeon bosses), so a
  // seller can hold a crafted stack and a plain (dropped) stack of the same
  // item id at once. Listing both together must split into two listings, one
  // per provenance, rather than merging the crafted units into a marker-free
  // listing (which would silently launder them the same way BUG #9 did).
  it('a sell request spanning two provenance buckets splits into two listings, prices summing to the ask', () => {
    const sim = new Sim({
      seed: 20260734,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
      noPlayer: true,
    });
    const seller = sim.addPlayer('warrior', 'Seller');
    moveToMerchant(sim, seller);
    const meta = metaFor(sim, seller);
    const BOUNDSTONE_HELM = 'boundstone_helm';
    const BOUNDSTONE_HELM_RECIPE = 'recipe_ironbound_warplate_helm';
    meta.inventory.push({ itemId: BOUNDSTONE_HELM, count: 1 }); // dungeon-dropped, no marker
    meta.inventory.push({
      itemId: BOUNDSTONE_HELM,
      count: 1,
      craftedRecipeId: BOUNDSTONE_HELM_RECIPE,
    });

    sim.marketList(BOUNDSTONE_HELM, 2, 101, seller);
    expect(sim.countItem(BOUNDSTONE_HELM, seller)).toBe(0);
    const listings = sim.marketListings.filter((l) => l.itemId === BOUNDSTONE_HELM && !l.house);
    expect(listings).toHaveLength(2);
    const plain = listings.find((l) => l.craftedRecipeId === undefined);
    const crafted = listings.find((l) => l.craftedRecipeId === BOUNDSTONE_HELM_RECIPE);
    expect(plain?.count).toBe(1);
    expect(crafted?.count).toBe(1);
    // No copper minted or lost by the split: the two rows' prices sum to the
    // exact ask the seller named for the whole batch.
    expect((plain?.price ?? 0) + (crafted?.price ?? 0)).toBe(101);
  });

  // Review follow-up on #2605: the provenance split must not reopen the two
  // per-seller invariants marketList already enforced for a single-bucket
  // listing. A dual-provenance stack turns one sell request into two rows,
  // so both gates must account for the split BEFORE anything leaves the bag.
  it('refuses a dual-provenance sell that would push the seller over MARKET_MAX_LISTINGS', () => {
    const sim = new Sim({
      seed: 20260735,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
      noPlayer: true,
    });
    const seller = sim.addPlayer('warrior', 'Seller');
    moveToMerchant(sim, seller);
    const meta = metaFor(sim, seller);
    const BOUNDSTONE_HELM = 'boundstone_helm';
    const BOUNDSTONE_HELM_RECIPE = 'recipe_ironbound_warplate_helm';
    meta.inventory.push({ itemId: BOUNDSTONE_HELM, count: 1 });
    meta.inventory.push({
      itemId: BOUNDSTONE_HELM,
      count: 1,
      craftedRecipeId: BOUNDSTONE_HELM_RECIPE,
    });
    // Fill the seller up to one below the cap with unrelated single-row listings.
    for (let i = 0; i < MARKET_MAX_LISTINGS - 1; i++) {
      meta.inventory.push({ itemId: COMMON_WEAPON, count: 1 });
      sim.marketList(COMMON_WEAPON, 1, 10, seller);
    }
    const mineBefore = sim.marketListings.filter((l) => l.sellerKey === String(seller)).length;
    expect(mineBefore).toBe(MARKET_MAX_LISTINGS - 1);

    // The dual-provenance sell would add 2 rows and land at cap + 1: refused,
    // and neither item leaves the seller's bag.
    sim.marketList(BOUNDSTONE_HELM, 2, 101, seller);
    expect(sim.countItem(BOUNDSTONE_HELM, seller)).toBe(2);
    expect(sim.marketListings.filter((l) => l.itemId === BOUNDSTONE_HELM && !l.house)).toHaveLength(
      0,
    );
    expect(sim.marketListings.filter((l) => l.sellerKey === String(seller)).length).toBe(
      mineBefore,
    );
  });

  it('refuses a dual-provenance sell whose ask cannot give every bucket at least 1 copper', () => {
    const sim = new Sim({
      seed: 20260736,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
      noPlayer: true,
    });
    const seller = sim.addPlayer('warrior', 'Seller');
    moveToMerchant(sim, seller);
    const meta = metaFor(sim, seller);
    const BOUNDSTONE_HELM = 'boundstone_helm';
    const BOUNDSTONE_HELM_RECIPE = 'recipe_ironbound_warplate_helm';
    meta.inventory.push({ itemId: BOUNDSTONE_HELM, count: 1 });
    meta.inventory.push({
      itemId: BOUNDSTONE_HELM,
      count: 1,
      craftedRecipeId: BOUNDSTONE_HELM_RECIPE,
    });

    // ask=1 for a 2-bucket split cannot give both rows >= MARKET_MIN_PRICE:
    // refused rather than pricing one row at 0 copper.
    sim.marketList(BOUNDSTONE_HELM, 2, 1, seller);
    expect(sim.countItem(BOUNDSTONE_HELM, seller)).toBe(2);
    expect(sim.marketListings.filter((l) => l.itemId === BOUNDSTONE_HELM && !l.house)).toHaveLength(
      0,
    );
  });

  it('a non-crafted eligible item still gains Enchanting skill when disenchanted', () => {
    const sim = new Sim({
      seed: 20260727,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);

    sim.addItem(COMMON_WEAPON, 1, pid);
    runDisenchant(sim, COMMON_WEAPON, pid);

    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(0);
    expect(meta.craftSkills.enchanting).toBe(1);
  });

  it('disenchants a rare (typed secondary), applies a Runed enchant, salvages, with lastX mirrors', () => {
    const sim = new Sim({
      seed: 20260721,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const inv = () => sim.ctx.resolve()?.meta.inventory ?? [];

    // 1. Rare disenchant: fixed 1 essence + exactly 1 armed resonant_steel.
    const essenceBefore = sim.countItem(ESSENCE);
    sim.addItem(RARE_WEAPON, 1);
    runDisenchant(sim, RARE_WEAPON);
    const denc = sim.lastDisenchantResult;
    expect(denc?.ok).toBe(true);
    expect(denc?.materialItemId).toBe(ESSENCE);
    expect(denc?.count).toBe(1);
    expect(denc?.secondaryItemId).toBe(SECONDARY);
    expect(denc?.secondaryCount).toBe(1);
    expect(sim.countItem(ESSENCE)).toBe(essenceBefore + 1);
    const steelSlot = inv().find((s) => s.itemId === SECONDARY);
    expect(steelSlot?.instance?.bindOnTrade).toBe(true);
    expect(steelSlot?.instance?.boundTo).toBeUndefined();
    expect(sim.countItem(RARE_WEAPON)).toBe(0);

    // Replay of the same action cannot double-grant: item is gone -> not_held.
    runDisenchant(sim, RARE_WEAPON);
    expect(sim.lastDisenchantResult?.ok).toBe(false);
    expect(sim.lastDisenchantResult?.reason).toBe('not_held');
    expect(sim.countItem(ESSENCE)).toBe(essenceBefore + 1);
    expect(sim.countItem(SECONDARY)).toBe(1);

    // 2. Apply the Runed enchant: essence x2 + steel x1 consumed, copy enchanted.
    sim.addItem(RARE_WEAPON, 1);
    sim.addItem(ESSENCE, 2);
    const essencePre = sim.countItem(ESSENCE);
    runApplyEnchant(sim, RARE_WEAPON, ENCHANT);
    const ench = sim.lastEnchantResult;
    expect(ench?.ok).toBe(true);
    expect(ench?.enchantId).toBe(ENCHANT);
    expect(sim.countItem(ESSENCE)).toBe(essencePre - 2);
    expect(sim.countItem(SECONDARY)).toBe(0);
    expect(sim.countItem(RARE_WEAPON)).toBe(1);
    const enchanted = inv().find(
      (s) => s.itemId === RARE_WEAPON && s.instance?.enchant === ENCHANT,
    );
    expect(enchanted).toBeTruthy();

    // 3. Salvage a common weapon: materials granted, item consumed.
    sim.addItem(COMMON_WEAPON, 1);
    runSalvage(sim, COMMON_WEAPON);
    const salv = sim.lastSalvageResult;
    expect(salv?.ok).toBe(true);
    expect(salv?.materialItemId).toBeTruthy();
    expect(salv?.count ?? 0).toBeGreaterThan(0);
    if (salv?.materialItemId) {
      expect(sim.countItem(salv.materialItemId)).toBeGreaterThan(0);
    }
    expect(sim.countItem(COMMON_WEAPON)).toBe(0);
  });
});

describe('online end-to-end (live GameServer, wire commands + self-deltas)', () => {
  it('disenchants the selected duplicate slot and preserves a masterwork copy with the same item id', () => {
    const sim = new Sim({
      seed: 314,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    sim.ctx.addItemInstance(
      COMMON_WEAPON,
      { rolled: { masterwork: true, stats: { str: 2 } } },
      pid,
    );
    sim.ctx.addItemInstance(COMMON_WEAPON, { signer: 'SelectedPlainCopy' }, pid);
    const starting = simInv(sim, pid).filter((slot) => slot.itemId === COMMON_WEAPON);
    expect(starting.map((slot) => slot.instance)).toEqual([
      { rolled: { masterwork: true, stats: { str: 2 } } },
      { signer: 'SelectedPlainCopy' },
    ]);
    const selectedIndex = simInv(sim, pid).findIndex(
      (slot) => slot.itemId === COMMON_WEAPON && slot.instance?.signer,
    );

    runDisenchant(sim, COMMON_WEAPON, pid, selectedIndex);

    expect(sim.lastDisenchantResult?.ok).toBe(true);
    const remaining = simInv(sim, pid).filter((slot) => slot.itemId === COMMON_WEAPON);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].instance).toEqual({ rolled: { masterwork: true, stats: { str: 2 } } });
  });

  it('the server honors the selected duplicate slot for disenchant_item', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 711, 'QaSlot');
    placeAt(server, st.pid, { x: 0, z: 150 });
    server.sim.ctx.addItemInstance(
      COMMON_WEAPON,
      { rolled: { masterwork: true, stats: { str: 2 } } },
      st.pid,
    );
    server.sim.ctx.addItemInstance(COMMON_WEAPON, { signer: 'SelectedPlainCopy' }, st.pid);
    const selectedIndex = serverInv(server, st.pid).findIndex(
      (slot) => slot.itemId === COMMON_WEAPON && slot.instance?.signer,
    );

    cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON, slot: selectedIndex });
    flushEnchantFamilyCast(server, st.pid);

    const dencEvents = eventsFor(fc.sent, 'disenchantResult');
    expect(dencEvents).toHaveLength(1);
    expect(dencEvents[0]).toMatchObject({ ok: true, itemId: COMMON_WEAPON, pid: st.pid });
    const remaining = serverInv(server, st.pid).filter((slot) => slot.itemId === COMMON_WEAPON);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].instance).toEqual({ rolled: { masterwork: true, stats: { str: 2 } } });
  });

  it('resolves the three commands server-side and mirrors denc/ench/salv into a real ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 701, 'QaCorrect');
    placeAt(server, st.pid, { x: 0, z: 150 });

    // Disenchant a rare over the wire.
    server.sim.addItem(RARE_WEAPON, 1, st.pid);
    const essenceBefore = server.sim.countItem(ESSENCE, st.pid);
    cmd(server, st, { cmd: 'disenchant_item', item: RARE_WEAPON });
    flushEnchantFamilyCast(server, st.pid);
    const dencEvents = eventsFor(fc.sent, 'disenchantResult');
    expect(dencEvents.length).toBe(1);
    const dev = dencEvents[0];
    if (dev.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(dev.ok).toBe(true);
    expect(dev.secondaryItemId).toBe(SECONDARY);
    expect(dev.pid).toBe(st.pid);
    expect(server.sim.countItem(ESSENCE, st.pid)).toBe(essenceBefore + 1);

    // Duplicated command: denied server-side, no double grant.
    const mark = fc.sent.length;
    cmd(server, st, { cmd: 'disenchant_item', item: RARE_WEAPON });
    flushEnchantFamilyCast(server, st.pid);
    const dup = eventsFor(fc.sent, 'disenchantResult', mark);
    expect(dup.length).toBe(1);
    if (dup[0].type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(dup[0].ok).toBe(false);
    expect(dup[0].reason).toBe('not_held');
    expect(server.sim.countItem(ESSENCE, st.pid)).toBe(essenceBefore + 1);
    expect(server.sim.countItem(SECONDARY, st.pid)).toBe(1);

    // Apply enchant over the wire (essence x2 + the disenchanted steel).
    server.sim.addItem(RARE_WEAPON, 1, st.pid);
    server.sim.addItem(ESSENCE, 2, st.pid);
    cmd(server, st, { cmd: 'apply_enchant', item: RARE_WEAPON, enchant: ENCHANT });
    flushEnchantFamilyCast(server, st.pid);
    const enchEvents = eventsFor(fc.sent, 'enchantResult');
    expect(enchEvents.length).toBe(1);
    if (enchEvents[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(enchEvents[0].ok).toBe(true);
    expect(server.sim.countItem(SECONDARY, st.pid)).toBe(0);
    const enchSlot = serverInv(server, st.pid).find(
      (s) => s.itemId === RARE_WEAPON && s.instance?.enchant === ENCHANT,
    );
    expect(enchSlot).toBeTruthy();

    // Salvage over the wire.
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);
    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    flushEnchantFamilyCast(server, st.pid);
    const salvEvents = eventsFor(fc.sent, 'salvageResult');
    expect(salvEvents.length).toBe(1);
    if (salvEvents[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salvEvents[0].ok).toBe(true);

    // Convergence arm: the denc/ench/salv self-deltas land on a real ClientWorld.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    expect(snap.self.denc).toEqual(server.sim.lastDisenchantResultFor(st.pid));
    expect(snap.self.ench).toEqual(server.sim.lastEnchantResultFor(st.pid));
    expect(snap.self.salv).toEqual(server.sim.lastSalvageResultFor(st.pid));
    const client = bareClient(st.pid);
    applySnap(client, snap);
    expect(client.lastDisenchantResult).toEqual(server.sim.lastDisenchantResultFor(st.pid));
    expect(client.lastEnchantResult).toEqual(server.sim.lastEnchantResultFor(st.pid));
    expect(client.lastSalvageResult).toEqual(server.sim.lastSalvageResultFor(st.pid));
    expect(client.lastEnchantResult?.ok).toBe(true);
    expect(client.lastSalvageResult?.ok).toBe(true);
  });
});

describe('apply-enchant keeps the crafted-provenance marker (the anti-farm gate)', () => {
  const CHEST_ENCHANT = 'enchant_chest_stamina';
  const reagentsFor = (sim: Sim, pid: number): void => {
    sim.addItem('arcane_dust', 10, pid);
    sim.addItem('arcane_essence', 10, pid);
  };
  const vest = (sim: Sim, pid: number) =>
    simInv(sim, pid).find((s) => s.itemId === CRAFTED_COMMON_ARMOR);
  const markerOf = (
    slot: { craftedRecipeId?: string; instance?: { craftedRecipeId?: string } } | undefined,
  ) => slot?.craftedRecipeId ?? slot?.instance?.craftedRecipeId;

  it('a PLAIN crafted stack keeps its slot marker through the enchant mint', () => {
    // The bug: a common crafted piece carries its provenance on the SLOT with no
    // `instance` at all, and the mint rebuilt the copy from the consumed
    // PAYLOAD only, so the marker had nowhere to survive.
    const sim = new Sim({
      seed: 20260901,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    reagentsFor(sim, pid);

    runApplyEnchant(sim, CRAFTED_COMMON_ARMOR, CHEST_ENCHANT, undefined, undefined, pid);
    expect(sim.lastEnchantResultFor(pid)?.ok).toBe(true);
    const after = vest(sim, pid);
    expect(after?.instance?.enchant).toBe(CHEST_ENCHANT);
    expect(markerOf(after)).toBe(CRAFTED_COMMON_ARMOR_RECIPE);
  });

  it('disenchanting that enchanted self-crafted piece still pays NO enchanting skill', () => {
    // The behaviour the marker exists for. Without it, craft -> enchant ->
    // disenchant is a self-serve skill loop on the player's own gear.
    const sim = new Sim({
      seed: 20260902,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    reagentsFor(sim, pid);
    runApplyEnchant(sim, CRAFTED_COMMON_ARMOR, CHEST_ENCHANT, undefined, undefined, pid);
    const afterApply = meta.craftSkills.enchanting;

    runDisenchant(
      sim,
      CRAFTED_COMMON_ARMOR,
      pid,
      simInv(sim, pid).findIndex((s) => s.itemId === CRAFTED_COMMON_ARMOR),
    );
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(meta.craftSkills.enchanting - afterApply).toBe(0);
  });

  it('a FOUND piece still pays skill: the gate denies provenance, not enchanting', () => {
    // The negative arm. If this ever went to 0 the fix would be over-broad,
    // silently killing the legitimate disenchant faucet.
    const sim = new Sim({
      seed: 20260903,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    sim.addItem(CRAFTED_COMMON_ARMOR, 1, pid); // granted, never crafted: no marker
    reagentsFor(sim, pid);
    runApplyEnchant(sim, CRAFTED_COMMON_ARMOR, CHEST_ENCHANT, undefined, undefined, pid);
    const afterApply = meta.craftSkills.enchanting;

    runDisenchant(
      sim,
      CRAFTED_COMMON_ARMOR,
      pid,
      simInv(sim, pid).findIndex((s) => s.itemId === CRAFTED_COMMON_ARMOR),
    );
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(meta.craftSkills.enchanting - afterApply).toBeGreaterThan(0);
  });

  it('a masterwork crafted copy keeps seal, signer, AND marker through the mint', () => {
    const sim = new Sim({
      seed: 20260904,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    sim.addItemInstance(
      CRAFTED_COMMON_ARMOR,
      { signer: 'Ana', rolled: { masterwork: true, stats: { sta: 5 } } },
      pid,
      1,
      { craftedRecipeId: CRAFTED_COMMON_ARMOR_RECIPE },
    );
    reagentsFor(sim, pid);

    runApplyEnchant(sim, CRAFTED_COMMON_ARMOR, CHEST_ENCHANT, undefined, undefined, pid);
    const after = vest(sim, pid);
    expect(after?.instance?.signer).toBe('Ana');
    expect(after?.instance?.rolled?.masterwork).toBe(true);
    // The enchant's bonus sums ON TOP of the masterwork bake, not over it.
    expect(after?.instance?.rolled?.stats?.sta).toBe(9);
    expect(markerOf(after)).toBe(CRAFTED_COMMON_ARMOR_RECIPE);
  });

  it('the REPLACE arm keeps the marker too', () => {
    const sim = new Sim({
      seed: 20260905,
      playerClass: 'warrior',
      world: PROFESSIONS_ENCHANT_SALVAGE_TEST_WORLD,
      autoEquip: false,
    });
    const pid = sim.playerId;
    grantVestMaterials(sim, pid);
    runCraft(sim, CRAFTED_COMMON_ARMOR_RECIPE, false, pid);
    reagentsFor(sim, pid);
    runApplyEnchant(sim, CRAFTED_COMMON_ARMOR, CHEST_ENCHANT, undefined, undefined, pid);
    reagentsFor(sim, pid);

    // Replacing with a different chest enchant, explicitly confirmed.
    runApplyEnchant(sim, CRAFTED_COMMON_ARMOR, 'enchant_chest_spirit', undefined, true, pid);
    expect(sim.lastEnchantResultFor(pid)?.ok).toBe(true);
    const after = vest(sim, pid);
    expect(after?.instance?.enchant).toBe('enchant_chest_spirit');
    expect(markerOf(after)).toBe(CRAFTED_COMMON_ARMOR_RECIPE);
  });
});
