// Combo-gating liveness parity (Professions 2.0): the crafting view's
// combo gate must consume the shared combo_eligibility result identically and
// LIVELY for Sim-shaped and ClientWorld-shaped inputs. This guards the #2033
// stub trap: a ClientWorld member that exists (so the type checks and a
// members-exist parity sweep passes) but never mirrors live server values.
// Every assertion here is about values FLOWING and CHANGING outcomes: an
// all-zero craftSkills stub or a craftingIdentity that stops tracking cprof
// deltas fails these tests, mere member existence does not pass them.
//
// The online arm always feeds values through the real wire path: a GameServer
// broadcast encoded by selfWireJson (`cprof` via the maybe() delta diff) and
// decoded by ClientWorld.applySnapshot, never by poking mirror fields.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (the snapshots.test.ts idiom);
// hoisted, so it must stay above the server/game import.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
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

import { GameServer } from '../server/game';
import { COMBO_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { buildCraftingView, type CraftingRecipeRow } from '../src/ui/crafting_view';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

// The armorcrafting+weaponcrafting minTier-1 combo recipe (content pinned by
// tests/professions_contracts.test.ts; re-priced
// reagents: arcanite_bar x1, thorium_ore x5, wolf_fang x4, smithing_flux x2).
const RECIPE = COMBO_RECIPES.find((entry) => entry.id === 'recipe_ironbound_warplate_helm')!;

function makeReagents(): InvSlot[] {
  return [
    { itemId: 'arcanite_bar', count: 1 },
    { itemId: 'thorium_ore', count: 5 },
    { itemId: 'wolf_fang', count: 4 },
    { itemId: 'smithing_flux', count: 2 },
  ];
}

// The exact pair the recipe requires, attuned, in the wire fixture shape
// (snapshots.test.ts full self-state fixture).
function makePairArchetype() {
  return {
    activeArchetype: 'armorcrafting',
    pairedMajor: 'weaponcrafting',
    hobbyCraft: 'leatherworking',
    attunedPairs: ['weaponcrafting+armorcrafting'],
    switchCount: 0,
    amendsProgress: 0,
  };
}

// A pair that does NOT match the recipe (wrong_pair from the shared gate).
function makeWrongPairArchetype() {
  return {
    activeArchetype: 'alchemy',
    pairedMajor: 'engineering',
    hobbyCraft: null,
    attunedPairs: ['alchemy+engineering'],
    switchCount: 0,
    amendsProgress: 0,
  };
}

// The one shape both arms are read through: the exact IWorld members the
// crafting window consumes. Sim and ClientWorld both satisfy it structurally.
interface ComboWorldReads {
  inventory: readonly InvSlot[];
  craftSkills: Readonly<Record<string, number>>;
  craftingIdentity: {
    synced: boolean;
    activeArchetype: string | null;
    pairedMajor: string | null;
    hobbyCraft: string | null;
  };
}

function comboRow(world: ComboWorldReads): CraftingRecipeRow {
  return buildCraftingView(
    [RECIPE],
    world.inventory,
    ITEMS,
    world.craftSkills,
    world.craftingIdentity,
  ).recipes[0];
}

describe('crafting view combo gate liveness across both IWorld arms', () => {
  it('offline Sim arm: the live IWorld reads carry the arranged values and open the gate', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const meta = sim.meta(sim.player.id)!;
    meta.craftSkills.armorcrafting = 25;
    meta.craftSkills.weaponcrafting = 25;
    meta.archetype = makePairArchetype();
    meta.inventory = makeReagents();
    // The reads flow the arranged values, not a zeroed default.
    expect(sim.craftSkills).toMatchObject({ armorcrafting: 25, weaponcrafting: 25 });
    expect(sim.craftingIdentity.synced).toBe(true);
    expect(sim.craftingIdentity.activeArchetype).toBe('armorcrafting');
    expect(sim.craftingIdentity.pairedMajor).toBe('weaponcrafting');
    const row = comboRow(sim);
    expect(row.comboRequirement?.met).toBe(true);
    expect(row.comboRequirement?.reason).toBeNull();
    expect(row.reagents.every((r) => r.satisfied)).toBe(true);
    expect(row.craftable).toBe(true);
  });

  it('online arm mirrors equal values through a real cprof snapshot and yields the identical view', () => {
    // Offline arm.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const offMeta = sim.meta(sim.player.id)!;
    offMeta.craftSkills.armorcrafting = 25;
    offMeta.craftSkills.weaponcrafting = 25;
    offMeta.archetype = makePairArchetype();
    offMeta.inventory = makeReagents();
    // Online arm: the SAME underlying values, fed through the wire.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 71, 'Combo');
    const onMeta = server.sim.meta(session.pid)!;
    onMeta.craftSkills.armorcrafting = 25;
    onMeta.craftSkills.weaponcrafting = 25;
    onMeta.archetype = makePairArchetype();
    onMeta.inventory = makeReagents();
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    // Stub guard: the mirror holds the live server values, not defaults.
    expect(client.craftingIdentity.synced).toBe(true);
    expect(client.craftSkills).toMatchObject({ armorcrafting: 25, weaponcrafting: 25 });
    expect(client.craftingIdentity.activeArchetype).toBe('armorcrafting');
    expect(client.craftingIdentity.pairedMajor).toBe('weaponcrafting');
    const offRow = comboRow(sim);
    const onRow = comboRow(client);
    // The shared outcome must be the ELIGIBLE one (two equally broken arms
    // would still deep-equal, so the absolute outcome is asserted first).
    expect(onRow.craftable).toBe(true);
    expect(onRow.comboRequirement?.met).toBe(true);
    expect(onRow.comboRequirement?.reason).toBeNull();
    // Full-row parity: same craftable, same combo verdict, same reagent rows.
    expect(onRow).toEqual(offRow);
  });

  it('liveness: successive cprof snapshots move the combo outcome on the same client', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 72, 'Livey');
    const meta = server.sim.meta(session.pid)!;
    meta.inventory = makeReagents();
    meta.craftSkills.armorcrafting = 25;
    meta.craftSkills.weaponcrafting = 25;
    meta.archetype = makeWrongPairArchetype();
    const client = bareClient(session.pid);

    // Snapshot 1: skills suffice but the attuned pair is the wrong one.
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    let row = comboRow(client);
    expect(row.comboRequirement?.met).toBe(false);
    expect(row.comboRequirement?.reason).toBe('wrong_pair');
    expect(row.craftable).toBe(false);

    // Snapshot 2: the right pair attunes but both skills sit one point below
    // the tier threshold. A frozen mirror would still read the first snapshot.
    meta.archetype = makePairArchetype();
    meta.craftSkills.armorcrafting = 24;
    meta.craftSkills.weaponcrafting = 24;
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.craftSkills).toMatchObject({ armorcrafting: 24, weaponcrafting: 24 });
    expect(client.craftingIdentity.activeArchetype).toBe('armorcrafting');
    row = comboRow(client);
    expect(row.comboRequirement?.met).toBe(false);
    expect(row.comboRequirement?.reason).toBe('tier_unmet');
    expect(row.comboRequirement?.unmetCrafts).toEqual(['armorcrafting', 'weaponcrafting']);
    expect(row.craftable).toBe(false);

    // Snapshot 3: skills cross the tier threshold and the SAME client flips
    // to craftable. This is the assertion an all-zero stub can never pass.
    meta.craftSkills.armorcrafting = 25;
    meta.craftSkills.weaponcrafting = 25;
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.craftSkills).toMatchObject({ armorcrafting: 25, weaponcrafting: 25 });
    row = comboRow(client);
    expect(row.comboRequirement?.met).toBe(true);
    expect(row.comboRequirement?.reason).toBeNull();
    expect(row.craftable).toBe(true);
  });

  it('before any cprof arrives the gate reads syncing and stays optimistically enabled', () => {
    const client = bareClient(1);
    // A snapshot WITHOUT the cprof delta key (the delta-omission path): the
    // identity mirror must keep its pre-sync declaration default.
    (client as any).applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Sync',
        lv: 15,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        inv: makeReagents(),
      },
    });
    expect(client.craftingIdentity.synced).toBe(false);
    expect(client.inventory).toEqual(makeReagents());
    const row = comboRow(client);
    expect(row.comboRequirement?.reason).toBe('syncing');
    expect(row.comboRequirement?.met).toBeNull();
    // Reagents are satisfied, so the button stays optimistically enabled while
    // the identity is still syncing (the locked design: never disable on a
    // not-yet-arrived mirror).
    expect(row.reagents.every((r) => r.satisfied)).toBe(true);
    expect(row.craftable).toBe(true);
  });
});
