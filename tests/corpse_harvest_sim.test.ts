// Intentional Gathering PR3 migration of the legacy corpse-harvest regression
// suite. Sim.harvestCorpse(id, pid?) now only STARTS a timed
// HARVEST_CAST_SECONDS cast; the old per-call `components` override is gone
// (Field Kit carried, remembered HarvestPreference decides selection; see
// src/sim/professions/corpse_harvest_session.ts and harvest_preference.ts).
// The public admission/lifecycle/wire contracts already have dedicated PR3
// suites (tests/corpse_harvest_cast.test.ts, tests/corpse_harvest_command.test.ts,
// tests/corpse_harvest_rights.test.ts, tests/harvest_admission.test.ts,
// tests/harvest_preference*.test.ts, tests/corpse_harvest_inspection.test.ts,
// tests/corpse_harvest_view.test.ts, tests/corpse_harvest_window.test.ts); this
// file's remaining job is:
//   - the DETERMINISTIC grant-completion arithmetic (quantity/rarity/specimen/
//     premium/tool/capacity math), driven directly against the unchanged
//     grantCorpseHarvest(ctx, mob, meta, snapshotCorpseHarvestGrantInputs(...))
//     domain via the tests/helpers/corpse_harvest_grant.ts fixture, and
//   - the wire/broadcast surfaces this file originated (hcb/ffa mirroring,
//     delta + interest-scope claim truth) adapted to the real timed cast, plus
//     a narrowed proof that the retired per-call `components` override is
//     refused outright over the wire.
// Every literal seed/quantity/rarity/draw-count pinned below is UNCHANGED from
// the pre-migration suite: grantCorpseHarvest's own gates, rolls and grants
// never moved, only the harness calling it did.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectDefined } from './helpers/defined';

// Mock the db layer so no Postgres is needed; only the wire encode/decode and
// broadcast paths are under test (wireEntity round-trips plus a real GameServer
// snapshot pipeline), never persistence.
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
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer, wireEntity } from '../server/game';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
  MONSTER_MATERIAL_TIERS,
  monsterMaterialTierFor,
} from '../src/sim/content/professions';
import { BUILTIN_WORLD, CAMPS, ITEMS, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { isMaterialItemId } from '../src/sim/material_ids';
import {
  forfeitsEveryMappedYield,
  harvestFamilyYieldsItem,
  harvestItemForFamily,
  isHarvestableCorpse,
  yieldingFocusComponents,
} from '../src/sim/professions/gathering';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import {
  bestOwnedAnyGatherToolTier,
  canHarvestMonsterMaterial,
} from '../src/sim/professions/tools';
import { TIER3_TOOL_WIELD_PROFICIENCY } from '../src/sim/professions/wield_gate';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type WorldContent } from '../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';
import { grantCorpseHarvestOnMob } from './helpers/corpse_harvest_grant';
import {
  UNMAPPED_FAMILY,
  UNMAPPED_FAMILY_2,
  withRetaggedTemplates,
} from './helpers/unmapped_family';
import { EMPTY_TEST_WORLD } from './sim_shared';

// End-to-end: a slain mob's corpse can be harvested for profession components
// exactly once, first-come. This is the deliberate OPPOSITE of a world gathering
// node (per-player, everyone gets their own harvest); here two players racing the
// same corpse must resolve to exactly one success, deterministically.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

type SnapshotClient = {
  applySnapshot(snap: unknown): void;
};

type WireEntityRecord = {
  id?: number;
  hcb?: number;
  ffa?: number;
  nm?: unknown;
};

type SnapFrame = {
  ents: WireEntityRecord[];
};

function clientMirror(client: ReturnType<typeof bareClient>): SnapshotClient {
  return client as unknown as SnapshotClient;
}

function asSnapFrame(snap: unknown): SnapFrame {
  return snap as SnapFrame;
}

// Harvest tests preserve the built-in spawn tables because their seed pins
// include constructor RNG draws. Roads are unrelated and would rebuild the
// full solid streetlamp network for every fresh-seed probe.
const CORPSE_TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, roads: [] };

// PUBLIC/timed-cast fixtures need a genuinely controlled world, never
// BUILTIN_WORLD: `getActiveWorldContent()` (src/sim/data.ts) is a process
// GLOBAL the terrain function reads regardless of what `world:` a particular
// `Sim`/`GameServer` was constructed with, so BUILTIN_WORLD's real camps,
// props, blockers (the jail/castle cage) and terrain edits near the origin
// can drift or block a multi-tick cast's grounded position, which reads as
// movement and cancels the cast. tests/corpse_harvest_cast.test.ts and
// tests/corpse_harvest_command.test.ts (the already-passing PR3 fixtures)
// both drive EVERY Sim/GameServer in their files off this exact shape.
const PUBLIC_TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

const TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

function mustPlayer(internals: SimInternals, pid: number): PlayerMeta {
  const meta = internals.players.get(pid);
  if (!meta) throw new Error(`missing player ${pid}`);
  return meta;
}

/** Premium units under the canonical source model, while still recognizing an
 * untouched legacy signer payload deliberately seeded by a compatibility case. */
function premiumMaterialUnits(meta: PlayerMeta, itemId?: string, signer?: string): number {
  let total = 0;
  for (const slot of meta.inventory) {
    if (!isMaterialItemId(slot.itemId)) continue;
    if (itemId !== undefined && slot.itemId !== itemId) continue;
    if (slot.materialSources === undefined) {
      if (
        typeof slot.instance?.signer === 'string' &&
        slot.instance.signer.length > 0 &&
        (signer === undefined || slot.instance.signer === signer)
      ) {
        total += slot.count;
      }
      continue;
    }
    for (const entry of slot.materialSources) {
      if (
        typeof entry.source.signer === 'string' &&
        entry.source.signer.length > 0 &&
        (signer === undefined || entry.source.signer === signer)
      ) {
        total += entry.count;
      }
    }
  }
  return total;
}

/** The DOMAIN fixture: no admission, no cast, no field kit, no preference.
 *  Builds a fresh two-player world on the pinned seed for grant-arithmetic
 *  tests. Unchanged from the pre-migration suite: every literal seed here
 *  keeps drawing exactly the same world-gen rng stream it always has. */
function setup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();

  for (const pid of [a, b]) {
    const e = expectDefined(internals.entities.get(pid));
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }

  // A dead wolf corpse with profession component tags (hide, fang; see #1140).
  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);

  return { sim, internals, a, b, mob };
}

/** Places `e` at `(x, z)` with a coherent rest state: matching `prevPos`, zero
 *  velocity, grounded. Needed only by the PUBLIC/timed-cast fixture below,
 *  since a multi-tick cast would otherwise read a hand-set `y:0` as movement
 *  the moment gravity settles it onto the real heightfield. */
function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
}

/** The PUBLIC fixture: two players on the controlled PUBLIC_TEST_WORLD, each
 *  carrying a Field Kit, at DISTINCT grounded spots (never the exact same x,z
 *  as each other, the corpse_harvest_command.test.ts idiom) so nothing here
 *  relies on same-tile behavior being harmless, but both still within
 *  INTERACT_RANGE (5) of the corpse: several cases here have Bravo win the
 *  corpse in a later, independent attempt after Alpha's is refused or spent,
 *  which needs Bravo actually reachable. Corpse grounded at Alpha's own spot. */
function publicSetup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: PUBLIC_TEST_WORLD });
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();
  placeCoherently(sim, expectDefined(sim.entities.get(a)), 0, 0);
  placeCoherently(sim, expectDefined(sim.entities.get(b)), 2, 0);
  for (const pid of [a, b]) sim.addItem('field_kit', 1, pid);
  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, sim.groundPos(0, 0));
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.entities.set(mob.id, mob);
  return { sim, a, b, mob };
}

// Fill every free slot with distinct 1-per-slot gear so the next add has
// nowhere to go (same idiom as tests/bags.test.ts fillBags, per-player).
function fillBags(sim: Sim, internals: SimInternals, pid: number): void {
  const m = expectDefined(internals.players.get(pid));
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

/**
 * The GRANT-DOMAIN rig: issues a completion directly against
 * grantCorpseHarvestOnMob (which resolves the real mob's componentTags and
 * calls the actual snapshotCorpseHarvestGrantInputs + grantCorpseHarvest
 * pair), reporting every observable a completion could have moved. Replaces
 * the pre-migration harvestCommand rig, which called the retired
 * `sim.harvestCorpse(id, components, pid)` three-argument form; the grant
 * function itself, its gates, its rolls and its grants are byte-identical to
 * before, so every literal below is unchanged.
 *
 * `arrange` runs after the corpse is in the world and before the completion,
 * so a case can move the player, pre-claim the corpse, or fill their bags and
 * still get the same measurement set.
 */
function grantCommand(
  templateId: string,
  components: string[] | undefined,
  opts: {
    seed?: number;
    corpseId?: number;
    arrange?: (rig: ReturnType<typeof setup>, corpse: Entity) => void;
  } = {},
) {
  const rig = setup(opts.seed ?? 5);
  const { sim, internals, a } = rig;
  const meta = mustPlayer(internals, a);
  const template = MOBS[templateId];
  const corpse = createMob(opts.corpseId ?? 7513, template, template.maxLevel, {
    x: 0,
    y: 0,
    z: 0,
  });
  corpse.dead = true;
  corpse.aiState = 'dead';
  corpse.corpseTimer = 9999;
  corpse.respawnTimer = 9999;
  internals.entities.set(corpse.id, corpse);
  opts.arrange?.(rig, corpse);
  sim.drainEvents();
  const before = structuredClone(meta.inventory);
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  const granted = grantCorpseHarvestOnMob(sim, corpse, meta, components);
  sim.rng.setObserver(null);
  const events = sim.drainEvents();
  return {
    sim,
    internals,
    a,
    b: rig.b,
    corpse,
    granted,
    draws,
    events,
    before,
    errors: events
      .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error')
      .map((e) => e.text),
    inventory: structuredClone(meta.inventory),
    items: meta.inventory.length,
    claimedBy: corpse.harvestClaimedBy,
    corpseTimer: corpse.corpseTimer,
  };
}

// claw and tusk joining HARVEST_COMPONENT_ITEMS (content/professions.ts,
// #2905) left no shipped template carrying only unmapped component families:
// fen_troll (claw, tusk) was the one production fixture in that shape. gills
// and horn joining it then left no shipped template MIXING mapped and unmapped
// families either:
// the four `gills, hide` swamp dwellers, sethrael_palecoil (hide, claw, horn)
// and wildheart_hexcaller (hide, horn) were the last six. The corpse-level
// "every family unmapped" gate (#2513), the pick-level refusal (#2509) and
// the forfeited-breadth bonus (#2514) are all still real code, so they are
// driven here through real templates retagged for the duration of a
// callback, the same mutation-seam idiom the "corpse premium-arm tool
// gating" suite below uses for a state shipped content also cannot reach any
// more (there, MONSTER_MATERIAL_TIERS; here, componentTags). The unmapped
// families are the synthetic never-mapped pair of
// tests/helpers/unmapped_family.ts, which tests/harvest_geography.test.ts
// pins as absent from the yield map and carried by no shipped template.
// warlock_imp, warlock_voidwalker and tunnel_rat carry no tags of their own
// (warlock_imp is this file's plain "no tags at all" fixture elsewhere), so
// retagging them borrows no other case's fixture, and every mutation is
// restored in a `finally`. Three fixtures because the arms need three
// shapes at once: an all-unmapped corpse, the three-tag mixed shape
// sethrael_palecoil shipped with (one mapped family beside the unmapped one
// is claw, so the two-mapped-of-three arithmetic is the old serpent's), and
// the two-tag mixed shape the murlocs shipped with, where a single box is
// the whole refusal.
const UNMAPPED_TEMPLATE_ID = 'warlock_imp';
const UNMAPPED_TEMPLATE_TAGS = [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2];
const MIXED_TEMPLATE_ID = 'warlock_voidwalker';
const MIXED_TEMPLATE_TAGS = ['hide', 'claw', UNMAPPED_FAMILY];
const MIXED2_TEMPLATE_ID = 'tunnel_rat';
const MIXED2_TEMPLATE_TAGS = [UNMAPPED_FAMILY_2, 'hide'];
// The retag itself is the corpus's ONE shared idiom, withRetaggedTemplates in
// tests/helpers/unmapped_family.ts, which also carries the premise the three
// fixtures rest on (each is untagged as shipped, so a retag replaces nothing
// and a restore puts back exactly the absence it found): it throws, naming
// the template, before mutating anything if a fixture ever ships tagged.
function withUnmappedTemplate<T>(body: () => T): T {
  return withRetaggedTemplates({ [UNMAPPED_TEMPLATE_ID]: UNMAPPED_TEMPLATE_TAGS }, body);
}
function withMixedTemplates<T>(body: () => T): T {
  return withRetaggedTemplates(
    { [MIXED_TEMPLATE_ID]: MIXED_TEMPLATE_TAGS, [MIXED2_TEMPLATE_ID]: MIXED2_TEMPLATE_TAGS },
    body,
  );
}
function withFixtureTemplates<T>(body: () => T): T {
  return withUnmappedTemplate(() => withMixedTemplates(body));
}

// PUBLIC/lifecycle: driven through the real id-only admission and the real
// timed cast (tests/corpse_harvest_cast.test.ts owns the exhaustive per-gate
// coverage of admission and cancellation; this block keeps only the
// single-use, first-come CLAIM identity guarantees #1141 is actually about,
// plus two admission refusals (an owned corpse, a live mob) that suite does
// not carry).
describe('corpse harvest: single-use, first-come (#1141)', () => {
  // Scoped world switch: PUBLIC_TEST_WORLD for this describe's timed-cast
  // fixtures, restored to the domain's CORPSE_TEST_WORLD for every describe
  // after it (getActiveWorldContent() is a process global; see PUBLIC_TEST_WORLD).
  beforeAll(() => setActiveWorldContent(PUBLIC_TEST_WORLD));
  afterAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));

  it('is unclaimed on a fresh corpse', () => {
    const { mob } = publicSetup();
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('the first attempt starts a cast and completing it claims the corpse', () => {
    const { sim, mob, a } = publicSetup();
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    expect(mob.harvestClaimedBy).toBeNull(); // not yet: the cast has not ticked
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('a later solo attempt against an already-claimed corpse is denied', () => {
    const { sim, mob, a, b } = publicSetup();
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(a);
    // Bravo tries a full second later; still denied, still claimed by Alpha.
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.harvestCorpse(mob.id, b)).toBe(false);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('reservation is exclusive within the same tick: the rival is refused before any grant, no early claim', () => {
    // Both commands land in the SAME 20 Hz tick (the server dispatches a
    // tick's command batch synchronously, one command at a time), so this
    // back-to-back start pair with no tick() between them is the faithful
    // reproduction. The first start reserves; the claim itself is not written
    // until completion, so this also proves there is no early claim/reward.
    const { sim, mob, a, b } = publicSetup();
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    const draws: number[] = [];
    sim.rng.setObserver((v) => draws.push(v));
    expect(sim.harvestCorpse(mob.id, b)).toBe(false);
    sim.rng.setObserver(null);
    expect(draws).toEqual([]);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.corpseHarvestState?.reservedBy).toBe(a);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    // One eventual completion, and the loser never started a cast at all.
    expect(mob.harvestClaimedBy).toBe(a);
    expect(sim.entities.get(b)?.castingAbility).toBeNull();
  });

  it('is order-independent: whichever start is processed first reserves, never both', () => {
    const run1 = publicSetup();
    expect(run1.sim.harvestCorpse(run1.mob.id, run1.a)).toBe(true);
    expect(run1.sim.harvestCorpse(run1.mob.id, run1.b)).toBe(false);
    for (let i = 0; i < TICKS_PER_CAST; i++) run1.sim.tick();

    const run2 = publicSetup();
    expect(run2.sim.harvestCorpse(run2.mob.id, run2.b)).toBe(true);
    expect(run2.sim.harvestCorpse(run2.mob.id, run2.a)).toBe(false);
    for (let i = 0; i < TICKS_PER_CAST; i++) run2.sim.tick();

    // Whichever pid started first claims the corpse; the second never does.
    expect(run1.mob.harvestClaimedBy).toBe(run1.a);
    expect(run2.mob.harvestClaimedBy).toBe(run2.b);
  });

  it('grants the mapped component item only to the eventual winner', () => {
    const { sim, mob, a, b } = publicSetup();
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    expect(sim.harvestCorpse(mob.id, b)).toBe(false);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    // forest_wolf's componentTags (#1140) include 'hide', mapped to the
    // dedicated rough_hide material. #1142's focus-harvest tier roll can grant
    // more than one per tier, so the winner gets AT LEAST one, never the loser.
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('rough_hide', b)).toBe(0);
  });

  it('denies harvest against a mob with no profession component tags', () => {
    const { sim, a } = publicSetup();
    // warlock_imp carries no componentTags (#1140 only tagged a subset of mobs).
    expect(MOBS.warlock_imp.componentTags).toBeUndefined();
    const noTagTemplate = MOBS.warlock_imp;
    const noTagMob = createMob(8888, noTagTemplate, noTagTemplate.maxLevel, sim.groundPos(0, 0));
    noTagMob.dead = true;
    noTagMob.corpseTimer = 9999;
    noTagMob.respawnTimer = 9999;
    sim.entities.set(noTagMob.id, noTagMob);
    expect(sim.harvestCorpse(noTagMob.id, a)).toBe(false);
    expect(noTagMob.harvestClaimedBy).toBeNull();
  });

  it('denies harvest on a live (non-dead) mob', () => {
    const { sim, mob, a } = publicSetup();
    mob.dead = false;
    expect(sim.harvestCorpse(mob.id, a)).toBe(false);
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('a dead player cannot harvest and does not consume the claim', () => {
    const { sim, mob, a, b } = publicSetup();
    const alpha = expectDefined(sim.entities.get(a));
    alpha.dead = true;
    sim.drainEvents();
    expect(sim.harvestCorpse(mob.id, a)).toBe(false);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(sim.countItem('rough_hide', a)).toBe(0);
    // The corpse stays unclaimed: a living player can still win it.
    expect(sim.harvestCorpse(mob.id, b)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(b);
  });

  it('direct harvest refuses an owned tagged corpse without consuming or minting materials', () => {
    const { sim, mob, b } = publicSetup();
    mob.ownerId = 999999;
    mob.lootable = false;
    sim.drainEvents();
    const draws: number[] = [];
    sim.rng.setObserver((v) => draws.push(v));
    expect(sim.harvestCorpse(mob.id, b)).toBe(false);
    sim.rng.setObserver(null);

    expect(mob.harvestClaimedBy).toBeNull();
    expect(draws).toEqual([]);
    expect(sim.countItem('rough_hide', b)).toBe(0);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
  });

  it('a full-bags harvest is refused at the start and does not consume the claim', () => {
    const { sim, mob, a, b } = publicSetup();
    fillBags(sim, sim as unknown as SimInternals, a);
    sim.drainEvents();
    expect(sim.harvestCorpse(mob.id, a)).toBe(false);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(sim.countItem('rough_hide', a)).toBe(0);
    // The unconsumed claim is still winnable by a player with bag room.
    expect(sim.harvestCorpse(mob.id, b)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(b);
    expect(sim.countItem('rough_hide', b)).toBeGreaterThanOrEqual(1);
  });

  it('clears the claim on respawn, so the next corpse is harvestable again', () => {
    const { sim, mob, a, b } = publicSetup();
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(a);

    sim.ctx.respawnMob(mob);
    expect(mob.harvestClaimedBy).toBeNull();

    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    sim.entities.set(mob.id, mob);

    expect(sim.harvestCorpse(mob.id, b)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(b);
  });
});

// #1145 Pristine specimens: a rare-or-better rarity roll on a
// family with a specimen (HARVEST_COMPONENT_SPECIMENS) grants the specimen as
// a SIGNED instance IN ADDITION to the plain component; the regular component
// always grants plain, and below the rarity floor no specimen exists at all.
// A family WITHOUT a specimen (fang) keeps the original behavior: the
// component itself grants signed at rare-or-better. Each case focuses on a
// single component so the harvest draws exactly one tier roll and one rarity
// roll, keeping the seed choice legible. Every seed below, and every literal
// it grants, is unchanged from the pre-PR3 suite: only the call mechanism
// (grantCorpseHarvestOnMob against the unchanged grant domain, instead of the
// retired `sim.harvestCorpse(id, components, pid)`) moved.
describe('signed Pristine specimens (#1145)', () => {
  it('a rare-or-better harvest grants the signed specimen PLUS the plain component (seed 30)', () => {
    const { sim, internals, a, mob } = setup(30);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, meta, ['hide']);
    // The signed jackpot landed signed: no downgrade notice fires.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
    // The regular component grants plain (fungible, unsigned), at its rolled
    // tier quantity: the specimen is now the signed jackpot, not the hide.
    const plain = meta.inventory.find((s) => s.itemId === 'rough_hide');
    expect(plain).toBeDefined();
    expect(plain?.instance).toBeUndefined();
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    // The specimen is granted exactly once and carries its premium mark in
    // the unit source bucket, never in the item payload.
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen).toBeDefined();
    expect(specimen?.instance).toBeUndefined();
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
    expect(sim.countItem('pristine_hide', a)).toBe(1);
  });

  it('a below-rare harvest grants a plain stack at its tier quantity and NO specimen (seed 3)', () => {
    const { sim, internals, a, mob } = setup(3);
    grantCorpseHarvestOnMob(sim, mob, mustPlayer(internals, a), ['hide']);
    const meta = expectDefined(internals.players.get(a));
    const slot = meta.inventory.find((s) => s.itemId === 'rough_hide');
    expect(slot).toBeDefined();
    expect(slot?.instance).toBeUndefined();
    // This seed's focus-tier roll lands above the poor floor, so the fungible
    // grant is more than a single unit (harvestTierQuantity(tier), #1142).
    expect(sim.countItem('rough_hide', a)).toBe(2);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
  });

  it('a specimen-less family (fang) keeps the signed-component behavior at rare-or-better (seed 30)', () => {
    const { sim, internals, a, mob } = setup(30);
    grantCorpseHarvestOnMob(sim, mob, mustPlayer(internals, a), ['fang']);
    const meta = expectDefined(internals.players.get(a));
    const slot = meta.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(slot).toBeDefined();
    expect(slot?.instance).toBeUndefined();
    expect(slot?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 2 }]);
    // Seed 30's fang roll lands a two-unit tier (harvestTierQuantity), and
    // roomy bags fit the whole thing and every rolled unit carries the premium
    // source mark.
    expect(sim.countItem('wolf_fang', a)).toBe(2);
  });

  it('an empty-bag signed grant lands the FULL rolled quantity, never truncated to one (seed 31)', () => {
    // Regression pin: the unfixed code called addItemInstance with no count
    // argument (defaulting to 1) even though grant.plainQty (the rolled tier
    // quantity, harvestTierQuantity) sat right there, silently discarding the
    // rest of a multi-unit signable roll. Empty bags have room for the whole
    // roll, so the fixed grant must land as one signed stack at the full
    // rolled count, not a single unit.
    const { sim, internals, a, mob } = setup(31);
    const meta = expectDefined(internals.players.get(a));
    // A fresh character's starting kit leaves the bags nearly empty (roomy,
    // not necessarily zero items): plenty of free slots for a 3-unit roll.
    expect(bagCapacity(meta.bags) - meta.inventory.length).toBeGreaterThan(3);
    grantCorpseHarvestOnMob(sim, mob, meta, ['fang']);
    const signedSlots = meta.inventory.filter((s) => s.itemId === 'wolf_fang');
    // Exactly one signed stack, not several single-unit slots.
    expect(signedSlots).toHaveLength(1);
    expect(signedSlots[0].count).toBe(3);
    expect(signedSlots[0].instance).toBeUndefined();
    expect(signedSlots[0].materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 3 }]);
    expect(sim.countItem('wolf_fang', a)).toBe(3);
  });

  it('every other specimen family grants its own jackpot beside the plain component (seed 30)', () => {
    // The hide row is exercised above; this sweeps the remaining three
    // specimen rows behaviorally (silk and venomSac via webwood_spider, meat
    // via wild_boar), so a mistargeted HARVEST_COMPONENT_SPECIMENS row cannot
    // hide behind hide-only coverage. Seed 30's rarity roll clears the
    // signable floor for a single focused component regardless of family
    // (the roll's draw position is identical).
    const families: { templateId: string; focus: string; plain: string; specimen: string }[] = [
      {
        templateId: 'webwood_spider',
        focus: 'silk',
        plain: 'spider_silk',
        specimen: 'pristine_silk',
      },
      {
        templateId: 'webwood_spider',
        focus: 'venomSac',
        plain: 'venom_gland',
        specimen: 'pristine_venom_gland',
      },
      { templateId: 'wild_boar', focus: 'meat', plain: 'game_meat', specimen: 'prime_cut' },
    ];
    for (const f of families) {
      const { sim, internals, a } = setup(30);
      const template = MOBS[f.templateId];
      const corpse = createMob(7776, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      const meta = expectDefined(internals.players.get(a));
      grantCorpseHarvestOnMob(sim, corpse, meta, [f.focus]);
      const plain = meta.inventory.find((s) => s.itemId === f.plain);
      expect(plain, `${f.focus} plain`).toBeDefined();
      expect(plain?.instance, `${f.focus} plain stays unsigned`).toBeUndefined();
      const specimen = meta.inventory.find((s) => s.itemId === f.specimen);
      expect(specimen?.instance, `${f.focus} jackpot payload`).toBeUndefined();
      expect(specimen?.materialSources, `${f.focus} jackpot source`).toEqual([
        { source: { signer: 'Alpha' }, count: 1 },
      ]);
      expect(sim.countItem(f.specimen, a)).toBe(1);
    }
  });

  it('the cloth family (no specimen) grants the signed component at rare-or-better (seed 30)', () => {
    const { sim, internals, a } = setup(30);
    const template = MOBS.vale_bandit;
    const corpse = createMob(7775, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    const meta = expectDefined(internals.players.get(a));
    grantCorpseHarvestOnMob(sim, corpse, meta, ['cloth']);
    const slot = meta.inventory.find((s) => s.itemId === 'homespun_cloth');
    expect(slot).toBeDefined();
    expect(slot?.instance).toBeUndefined();
    expect(slot?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
    // This corpse's own rolled quantity (#2473): the bandit's cloth tier rolls
    // one where the wolf's fang rolls two at the same seed, so the count
    // tracks the ROLL rather than any constant the arm could hardcode. The
    // contrast is the point, not the pair of numbers.
    expect(sim.countItem('homespun_cloth', a)).toBe(1);
  });

  it('the gills family (no specimen, Phase 11m) mints a SIGNED mudfin_scale at rare-or-better (seed 31)', () => {
    // The behavioural premise behind tests/recipe_economy.test.ts's reachable
    // mudfin_scale row: 11m-ORPHAN mapped gills to mudfin_scale with NO
    // specimen (HARVEST_COMPONENT_SPECIMENS carries no gills row, decided
    // explicitly), so gills takes the specimen-less signed arm, the same arm
    // fang and cloth take above. Seed 31's first draw is the tier roll (index
    // 1 on this seed, so gills alone on the two-tag murloc, bonus 1, lands
    // tier index 2 and three units) and its second is the rarity roll, which
    // the fang arms at this seed pin as rare: predicted the grant shape
    // { mudfin_scale, qty 3, rare, signed } and measured so. The ledger IS
    // the whole grant: one signed stack, nothing minted beside it.
    expect(HARVEST_COMPONENT_ITEMS.gills).toBe('mudfin_scale');
    expect(HARVEST_COMPONENT_SPECIMENS.gills).toBeUndefined();
    const { sim, internals, a } = setup(31);
    const template = MOBS.mudfin_murloc;
    expect(template.componentTags).toEqual(['gills', 'hide']);
    const corpse = createMob(7774, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    const meta = expectDefined(internals.players.get(a));
    grantCorpseHarvestOnMob(sim, corpse, meta, ['gills']);
    const result = sim
      .drainEvents()
      .find((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result?.yields).toEqual([
      { itemId: 'mudfin_scale', qty: 3, rarity: 'rare', kind: 'signed' },
    ]);
    const scales = meta.inventory.filter((s) => s.itemId === 'mudfin_scale');
    expect(scales).toHaveLength(1);
    expect(scales[0].count).toBe(3);
    expect(scales[0].instance).toBeUndefined();
    expect(scales[0].materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 3 }]);
    // No specimen was minted: nothing else in the bags carries the harvester's
    // signature, and no specimen item of ANY family landed.
    expect(premiumMaterialUnits(meta) - premiumMaterialUnits(meta, 'mudfin_scale')).toBe(0);
    // Non-vacuity floor for the sweep below, this file's first measured
    // ratchet (the #2139 capacity pre-gate premise arm below carries only a
    // bare toBeGreaterThan(0) floor, and nothing else here ratchets): 5
    // specimen families measured 2026-08-25, so an emptied table cannot turn
    // the sweep into a no-op.
    expect(Object.keys(HARVEST_COMPONENT_SPECIMENS).length).toBeGreaterThanOrEqual(5);
    for (const specimen of Object.values(HARVEST_COMPONENT_SPECIMENS)) {
      expect(sim.countItem(specimen, a), specimen).toBe(0);
    }
    expect(sim.countItem('rough_hide', a)).toBe(0);
  });

  it('a slot-full signed-family harvest keeps its source mark in a compatible stack (seed 30)', () => {
    // The pre-gate and grant use the same source-aware packing rule, so the
    // partial compatible stack accepts the rare roll without a fresh slot.
    const { sim, internals, a, mob } = setup(30);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    const fang = m.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(fang?.count).toBe(3);
    expect(fang?.instance).toBeUndefined();
    expect(fang?.materialSources).toEqual([
      { source: {}, count: 1 },
      { source: { signer: 'Alpha' }, count: 2 },
    ]);
    // Seed 30 contributes exactly two premium units above the seeded one.
    expect(sim.countItem('wolf_fang', a)).toBe(3);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('a slot-full specimen harvest truncates the specimen and keeps the plain yield (seed 30)', () => {
    // Plain grant tops up the partial stack without opening a slot, so the
    // specimen guard sees a full bag: the jackpot truncates rather than
    // overflowing, and the plain component still arrives.
    const { sim, internals, a, mob } = setup(30);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['hide']);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(1);
    // Downgrade notice: the dropped jackpot tells the player, exactly once,
    // with the find-lost arm (the plain yield survived, the pure extra did not).
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });

  it('one command keeps its component mark while reporting one lost specimen find', () => {
    // Seed 23 signs both wolf families. Source-compatible fang room preserves
    // that mark in a full bag, while the distinct Pristine Hide cannot fit and
    // emits the one specimen-loss event.
    const seed = 23;
    const probe = setup(seed);
    grantCorpseHarvestOnMob(probe.sim, probe.mob, mustPlayer(probe.internals, probe.a), undefined);
    const pm = expectDefined(probe.internals.players.get(probe.a));
    expect(premiumMaterialUnits(pm, 'wolf_fang', 'Alpha')).toBe(1);
    expect(pm.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(true);

    const { sim, internals, a, mob } = setup(seed);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'rough_hide', count: 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, undefined);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    // The signed fang merged, while the distinct jackpot had no slot.
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(sim.countItem('wolf_fang', a)).toBe(2);
    expect(sim.countItem('rough_hide', a)).toBe(3);
    expect(premiumMaterialUnits(m, 'wolf_fang', 'Alpha')).toBe(1);
    // Exactly one event reports the find that really failed to land.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });
});

// Grant order: a mob carrying TWO specimen families (wild_boar: hide -> and
// meat -> are both in HARVEST_COMPONENT_SPECIMENS; tusk is mapped too but
// carries no specimen of its own, same as fang/cloth) is where the grant
// ORDER matters: the pre-gate reserves room for the plain component stacks
// only, so a specimen jackpot granted mid-loop could consume the slot reserved
// for a LATER family's plain stack and push the uncapped plain grant past
// capacity. Plain yields must all land before any specimen; the
// jackpot is the extra that truncates, never the plain yield.
describe('two-specimen-family harvest capacity contract', () => {
  function addBoarCorpse(internals: SimInternals, id = 8888) {
    const template = MOBS.wild_boar;
    expect(template.componentTags).toEqual(['hide', 'tusk', 'meat']);
    const boar = createMob(id, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    boar.dead = true;
    boar.aiState = 'dead';
    boar.corpseTimer = 9999;
    boar.respawnTimer = 9999;
    internals.entities.set(boar.id, boar);
    return boar;
  }

  it('with a genuinely spare slot the jackpot still lands beside both plain yields (seed 6)', () => {
    const { sim, internals, a } = setup(6);
    const boar = addBoarCorpse(internals);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory.length = cap - 4; // four free slots, no hide/tusk/meat stacks
    grantCorpseHarvestOnMob(sim, boar, m, undefined);
    expect(boar.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('curved_tusk', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('game_meat', a)).toBeGreaterThanOrEqual(1);
    const specimen = m.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance).toBeUndefined();
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
  });

  it('with exactly the reserved free slots the jackpot truncates, never the plain yield (seed 6)', () => {
    const { sim, internals, a } = setup(6);
    const boar = addBoarCorpse(internals);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory.length = cap - 3; // exactly the three reserved plain-stack slots
    grantCorpseHarvestOnMob(sim, boar, m, undefined);
    expect(boar.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('curved_tusk', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('game_meat', a)).toBeGreaterThanOrEqual(1);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
  });
});

// #2139 companion: source descriptors share compatible material stack room,
// while payload differences, full stacks and explicit separation still bind.
// These cases keep the pre-gate and real grant on the same capacity model.
describe('corpse signed-guard capacity vs merge room (#2139)', () => {
  it('no corpse tags two specimen-less harvest families together (the authored spread policy)', () => {
    // Keep the ratified content shape explicit even though source-aware packing
    // no longer depends on signer-specific fallback slots.
    const specimenless = new Set(
      Object.keys(HARVEST_COMPONENT_ITEMS).filter((tag) => !(tag in HARVEST_COMPONENT_SPECIMENS)),
    );
    expect(specimenless.size).toBeGreaterThan(0);
    for (const mob of Object.values(MOBS)) {
      const tags = (mob.componentTags ?? []).filter((tag) => specimenless.has(tag));
      expect(tags.length, `${mob.id} tags ${tags.join('+')}`).toBeLessThanOrEqual(1);
    }
  });

  it('tusk and horn stay specimen-less, which is what made the two refusals bind', () => {
    // The ruling above ratifies the pre-gate on the stated warrant that each
    // REFUSAL already has a working replacement, so the refusal itself must be
    // measured rather than only described. Each candidate ALREADY carries one
    // specimen-less family, which is exactly why it was refused: adding the
    // second would put two on one corpse and breach the premise the arm above
    // guards. dune_troll was refused for tusk (it carries fang) and
    // frostmane_yeti for horn.
    //
    // SCOPE, honestly: the not-toContain arms below are SUBSUMED by the global
    // arm above, which already forbids a second specimen-less tag on any mob.
    // They are kept for the named failure message only. The assertion that
    // earns this case its own place is the LAST one: if tusk or horn ever
    // gains a specimen row, the global arm goes green by SHRINKING while the
    // ratified refusals silently stop meaning anything, and only this reds.
    const specimenless = new Set(
      Object.keys(HARVEST_COMPONENT_ITEMS).filter((tag) => !(tag in HARVEST_COMPONENT_SPECIMENS)),
    );
    for (const [refused, refusedTag] of [
      ['dune_troll', 'tusk'],
      ['frostmane_yeti', 'horn'],
    ] as const) {
      const mob = MOBS[refused];
      expect(mob, `${refused} must still exist to be a meaningful refusal`).toBeDefined();
      const tags = mob?.componentTags ?? [];
      expect(tags, `${refused} must not have gained ${refusedTag}`).not.toContain(refusedTag);
      // Non-vacuity: the refusal only means anything while the candidate still
      // carries a specimen-less family of its own, which is what made the
      // second one unaffordable. If this ever empties, the refusal is moot and
      // its rationale needs re-deriving rather than re-asserting.
      const carried = tags.filter((tag) => specimenless.has(tag));
      expect(
        carried.length,
        `${refused} still carries one specimen-less family (${carried.join('+')})`,
      ).toBe(1);
      expect(specimenless.has(refusedTag), `${refusedTag} is specimen-less`).toBe(true);
    }
  });

  it('the substitutes the refusals lean on are live: tusk on the Horror, horn on six', () => {
    // The other half of the same warrant. Derived from the live tables, never
    // a hand list: if the Sundered
    // Horror loses tusk, or the horn floor drops below six camped carriers,
    // the ratification's stated ground is gone and this reds.
    expect(MOBS.sundered_horror?.componentTags ?? [], 'the tusk substitute').toContain('tusk');
    const campedMobIds = new Set(CAMPS.map((c) => c.mobId));
    const hornCarriers = Object.values(MOBS)
      .filter((m) => (m.componentTags ?? []).includes('horn'))
      .map((m) => m.id);
    // OPEN-WORLD carriers, meaning those with a CAMPS row. NOT "reachable":
    // the seventh tagged template is a Wildheart DUNGEON mob, reached through
    // an instance, which structurally cannot carry a camp row at all. The six
    // open-world carriers are the farm route the ratification leans on.
    const openWorldHorn = hornCarriers.filter((id) => campedMobIds.has(id)).sort();
    expect(openWorldHorn.length, `horn carriers with a camp row: ${openWorldHorn.join(', ')}`).toBe(
      6,
    );
    // Non-vacuity, on the honest ground: the tag set is strictly larger than
    // the camped set, so the filter is doing real work. The reason is that one
    // tagged template is instanced content, not a spread decision.
    expect(hornCarriers.length, 'horn-tagged templates, camped or not').toBe(7);
  });

  it('the filed crossing case: zero free slots + a partial plain stack tops up, never overflows', () => {
    // Seed 31 is the suite's pinned signable fang roll. A roomy-bag probe
    // proves the premise, then a FRESH same-seed world reproduces the same
    // inventory-independent draws against the issue's exact inventory shape.
    const seed = 31;
    const probe = setup(seed);
    grantCorpseHarvestOnMob(probe.sim, probe.mob, mustPlayer(probe.internals, probe.a), ['fang']);
    const pm = expectDefined(probe.internals.players.get(probe.a));
    expect(premiumMaterialUnits(pm, 'wolf_fang', 'Alpha')).toBe(3);

    const { sim, internals, a, mob } = setup(seed);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    expect(mob.harvestClaimedBy).toBe(a);
    // The issue's acceptance: never past capacity, and the whole signed yield
    // arrived in the compatible top-up without losing its source mark.
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    const fang = m.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(fang?.count).toBe(4);
    expect(fang?.instance).toBeUndefined();
    expect(fang?.materialSources).toEqual([
      { source: {}, count: 1 },
      { source: { signer: 'Alpha' }, count: 3 },
    ]);
    expect(sim.countItem('wolf_fang', a)).toBe(4);
  });

  it('a slot-full bag merges a signed grant into an earlier different-signer stack (seed 31)', () => {
    // Seed 31 rolls three premium fang units. Source identity does not choose
    // their destination: the earlier compatible Bravo stack must take them
    // before a later legacy Alpha stack.
    const { sim, internals, a, mob } = setup(31);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = {
      itemId: 'wolf_fang',
      count: 3,
      materialSources: [{ source: { signer: 'Bravo' }, count: 3 }],
    };
    m.inventory[1] = { itemId: 'wolf_fang', count: 3, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    expect(mob.harvestClaimedBy).toBe(a);
    // The earlier stack carries both exact source buckets without a new slot.
    expect(m.inventory.length).toBe(cap);
    expect(m.inventory[0].count).toBe(6);
    expect(m.inventory[0].instance).toBeUndefined();
    expect(m.inventory[0].materialSources).toEqual([
      { source: { signer: 'Alpha' }, count: 3 },
      { source: { signer: 'Bravo' }, count: 3 },
    ]);
    expect(m.inventory[1]).toEqual({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Alpha' },
    });
    // The signature survived: no downgrade notice fires.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('a payload mismatch still refuses a source-only harvest when no compatible room remains', () => {
    // Source differences are compatible, but a real payload difference is
    // still identity. With the only payload-free target capped, the pre-gate
    // refuses before claim or RNG.
    const { sim, internals, a, mob } = setup(30);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    const stack = stackSizeOf(ITEMS.wolf_fang);
    m.inventory[0] = {
      itemId: 'wolf_fang',
      count: 1,
      instance: { enchant: 'ench_stat_str' },
    };
    m.inventory[1] = {
      itemId: 'wolf_fang',
      count: stack,
      materialSources: [{ source: { signer: 'Bravo' }, count: stack }],
    };
    expect(m.inventory.length).toBe(cap);
    const before = structuredClone(m.inventory);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(mob.harvestClaimedBy).toBeNull();
    expect(m.inventory).toEqual(before);
    expect(draws).toBe(0);
  });

  it('a slot-full specimen jackpot merges into a different-signer specimen stack (seed 30)', () => {
    // The specimen is a distinct item id, but source identity within that item
    // does not force a fresh stack. The touched legacy stack normalizes and
    // retains both signers exactly.
    const { sim, internals, a, mob } = setup(30);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    m.inventory[1] = { itemId: 'pristine_hide', count: 2, instance: { signer: 'Bravo' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['hide']);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBe(cap);
    const specimen = m.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance).toBeUndefined();
    expect(specimen?.count).toBe(3);
    expect(specimen?.materialSources).toEqual([
      { source: { signer: 'Alpha' }, count: 1 },
      { source: { signer: 'Bravo' }, count: 2 },
    ]);
    // The plain component still arrived through its reserved top-up room.
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(1);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });
});

// #2473: on a specimen-less family the component ITSELF is the signed grant,
// so the signature and the yield ride one call. That call used to pass a
// hardcoded count of 1 while the ordinary arm granted the whole rolled
// quantity. The premium arm must carry every rolled unit in its source bucket.
describe('a signed specimen-less grant carries its rolled quantity (#2473)', () => {
  it('draws no rng of its own: the count comes from the tier roll already taken', () => {
    const { sim, internals, a, mob } = setup(31);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      grantCorpseHarvestOnMob(sim, mob, mustPlayer(internals, a), ['fang']);
    } finally {
      sim.rng.setObserver(null);
    }
    // Never vacuous: this seed really does reach the multi-unit signed arm.
    expect(sim.countItem('wolf_fang', a)).toBe(3);
    expect(draws).toBe(2);
  });

  it('grants the same premium quantity in roomy and slot-full compatible bags (seed 31)', () => {
    const roomy = setup(31);
    grantCorpseHarvestOnMob(roomy.sim, roomy.mob, mustPlayer(roomy.internals, roomy.a), ['fang']);
    const signedSlot = roomy.internals.players
      .get(roomy.a)
      ?.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(signedSlot?.instance).toBeUndefined();
    expect(signedSlot?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 3 }]);
    const signedQty = roomy.sim.countItem('wolf_fang', roomy.a);

    const full = setup(31);
    fillBags(full.sim, full.internals, full.a);
    const m = expectDefined(full.internals.players.get(full.a));
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(bagCapacity(m.bags));
    grantCorpseHarvestOnMob(full.sim, full.mob, m, ['fang']);
    expect(premiumMaterialUnits(m, 'wolf_fang', 'Alpha')).toBe(3);
    // Minus the unit seeded into the compatible stack.
    const fullQty = full.sim.countItem('wolf_fang', full.a) - 1;

    expect(signedQty).toBe(fullQty);
    expect(fullQty).toBe(3);
  });

  it('grants the whole rolled quantity into ONE signed slot, never a unit per slot (seed 31)', () => {
    const { sim, internals, a, mob } = setup(31);
    const m = expectDefined(internals.players.get(a));
    const before = m.inventory.length;
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    const signed = m.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(signed).toHaveLength(1);
    expect(signed[0].count).toBe(3);
    expect(signed[0].instance).toBeUndefined();
    expect(signed[0].materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 3 }]);
    expect(m.inventory.length).toBe(before + 1);
    const result = sim
      .drainEvents()
      .find((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result?.yields).toEqual([
      { itemId: 'wolf_fang', qty: signed[0].count, rarity: 'rare', kind: 'signed' },
    ]);
  });

  it('the cloth family carries its rolled quantity the same way (seed 31)', () => {
    const { sim, internals, a } = setup(31);
    const template = MOBS.vale_bandit;
    const corpse = createMob(7775, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    grantCorpseHarvestOnMob(sim, corpse, mustPlayer(internals, a), ['cloth']);
    const slot = mustPlayer(internals, a).inventory.find((s) => s.itemId === 'homespun_cloth');
    expect(slot?.instance).toBeUndefined();
    expect(slot?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 2 }]);
    expect(slot?.count).toBe(2);
    // The two families really do land on different counts, so neither literal
    // can be a constant the arm hardcoded.
    const fang = setup(31);
    grantCorpseHarvestOnMob(fang.sim, fang.mob, mustPlayer(fang.internals, fang.a), ['fang']);
    expect(fang.sim.countItem('wolf_fang', fang.a)).not.toBe(slot?.count);
  });

  it('source-compatible room takes the whole mark before a legacy partial target', () => {
    const { sim, internals, a, mob } = setup(31);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    const stack = stackSizeOf(ITEMS.wolf_fang);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'wolf_fang', count: stack - 2, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBe(cap);
    // The later legacy target remains untouched.
    expect(m.inventory[1]).toEqual({
      itemId: 'wolf_fang',
      count: stack - 2,
      instance: { signer: 'Alpha' },
    });
    // The yield still arrived WHOLE, through the plain stack's reserved room.
    expect(m.inventory[0].count).toBe(4);
    expect(m.inventory[0].materialSources).toEqual([
      { source: {}, count: 1 },
      { source: { signer: 'Alpha' }, count: 3 },
    ]);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('keeps a separated stack excluded while a legacy target receives the roll (seed 31)', () => {
    const { sim, internals, a, mob } = setup(31);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    const stack = stackSizeOf(ITEMS.wolf_fang);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1, materialSeparated: true };
    m.inventory[1] = { itemId: 'wolf_fang', count: stack - 6, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, ['fang']);
    expect(m.inventory.length).toBe(cap);
    // The touched legacy stack normalizes and receives the exact three-unit roll.
    expect(m.inventory[1].count).toBe(stack - 3);
    expect(m.inventory[1].instance).toBeUndefined();
    expect(m.inventory[1].materialSources).toEqual([
      { source: { signer: 'Alpha' }, count: stack - 3 },
    ]);
    // The separated stack remains untouched and separated.
    expect(m.inventory[0].count).toBe(1);
    expect(m.inventory[0].materialSeparated).toBe(true);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('a signed component keeps the reserved last slot ahead of a specimen (seed 23)', () => {
    // Seed 23 is pinned in corpse_harvest_result_event.test.ts to a signed fang
    // and a Pristine Hide. Without a compatible fang target, the component uses
    // the last slot reserved by the pre-gate and the specimen reports a loss.
    const { sim, internals, a, mob } = setup(23);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    // Exactly one free slot and no fang target: the component spends the slot
    // reserved for it by the pre-gate before the distinct specimen is tried.
    fillBags(sim, internals, a);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    m.inventory.pop();
    expect(m.inventory.length).toBe(cap - 1);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, undefined);
    const events = sim.drainEvents();
    // Seed 23 is pinned to rough_hide 2, signed wolf_fang 1 and one specimen.
    expect(m.inventory.length).toBe(cap);
    expect(sim.countItem('rough_hide', a)).toBe(3);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(premiumMaterialUnits(m, 'wolf_fang', 'Alpha')).toBe(1);
    // ...and the jackpot had nowhere left to go, so it truncated and said so.
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(events.filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });

  it('a compatible different-signer stack leaves the last slot for the specimen (seed 23)', () => {
    const { sim, internals, a, mob } = setup(23);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    fillBags(sim, internals, a);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    m.inventory[1] = {
      itemId: 'wolf_fang',
      count: 1,
      materialSources: [{ source: { signer: 'Bravo' }, count: 1 }],
    };
    m.inventory.pop();
    expect(m.inventory.length).toBe(cap - 1);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, m, undefined);
    const events = sim.drainEvents();
    expect(m.inventory.length).toBe(cap);
    expect(m.inventory[1].count).toBe(2);
    expect(m.inventory[1].materialSources).toEqual([
      { source: { signer: 'Alpha' }, count: 1 },
      { source: { signer: 'Bravo' }, count: 1 },
    ]);
    const specimen = m.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
    expect(events.filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });
});

// #2474: a corpse is single-use, so the family a repeated tag names must be
// harvested ONCE however many times the pick repeats it. Pre-fix, a
// hand-crafted ['hide','hide'] rolled, granted and logged the hide family
// twice off one claim, signed Pristine Hides included. The dedupe itself
// (effectiveFocusComponents) is unchanged domain logic, still reachable
// through the `chosen` argument grantCorpseHarvestOnMob passes straight
// through to it; only the retired per-call wire override that used to CARRY a
// repeated tag is gone (see the wire refusal describe below).
describe('a repeated component tag harvests the family once (#2474)', () => {
  // Same seed, same corpse template, one completion each: the duplicated pick
  // must land the deduped pick's world, exactly.
  function harvestWith(
    templateId: string,
    components: string[],
    seed: number,
  ): { inventory: unknown; events: unknown; draws: number; claimedBy: number | null } {
    const { sim, internals, a } = setup(seed);
    const template = MOBS[templateId];
    const corpse = createMob(7774, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    grantCorpseHarvestOnMob(sim, corpse, meta, components);
    sim.rng.setObserver(null);
    return {
      inventory: structuredClone(meta.inventory),
      events: sim.drainEvents(),
      draws,
      claimedBy: corpse.harvestClaimedBy,
    };
  }

  // wild_boar tags hide/tusk/meat: three tags, so a two-entry pick stays under
  // the spread threshold and lands on the arm that used to hand the duplicate
  // straight through. old_greyjaw (hide/fang/claw) is the same arm one tag map
  // over. forest_wolf tags hide/fang: two tags, so ['hide','hide'] used to
  // clear `>= tagged.length` and spread onto fang instead.
  const CASES: { templateId: string; tag: string; arm: string; tags: string[] }[] = [
    { templateId: 'wild_boar', tag: 'hide', arm: 'concentrate', tags: ['hide', 'tusk', 'meat'] },
    { templateId: 'wild_boar', tag: 'meat', arm: 'concentrate', tags: ['hide', 'tusk', 'meat'] },
    { templateId: 'old_greyjaw', tag: 'fang', arm: 'concentrate', tags: ['hide', 'fang', 'claw'] },
    { templateId: 'forest_wolf', tag: 'hide', arm: 'spread threshold', tags: ['hide', 'fang'] },
    { templateId: 'forest_wolf', tag: 'fang', arm: 'spread threshold', tags: ['hide', 'fang'] },
  ];

  it('covers both arms for real: each row is the corpse shape it claims to be', () => {
    for (const c of CASES) {
      expect(MOBS[c.templateId].componentTags, `${c.templateId} tags`).toEqual(c.tags);
      expect(c.tags, `${c.templateId} ${c.tag} is on the corpse`).toContain(c.tag);
      const arm = c.tags.length > 2 ? 'concentrate' : 'spread threshold';
      expect(arm, `${c.templateId} ${c.tag} arm`).toBe(c.arm);
    }
    expect(CASES.map((c) => c.arm)).toContain('concentrate');
    expect(CASES.map((c) => c.arm)).toContain('spread threshold');
  });

  it('grants exactly what the single tag grants, on the same seed, on both arms', () => {
    for (const c of CASES) {
      for (const seed of [2, 5, 11]) {
        const label = `${c.templateId} ${c.tag} (${c.arm}) @${seed}`;
        const dup = harvestWith(c.templateId, [c.tag, c.tag], seed);
        const once = harvestWith(c.templateId, [c.tag], seed);
        expect(dup.inventory, `${label} inventory`).toEqual(once.inventory);
        expect(dup.events, `${label} events`).toEqual(once.events);
        expect(dup.draws, `${label} draws`).toEqual(once.draws);
        expect(once.draws, `${label} single-pick draws`).toBe(2);
        expect(dup.claimedBy, `${label} claim`).toBe(once.claimedBy);
        expect(dup.claimedBy, `${label} claim is the harvester`).not.toBeNull();
      }
    }
  });

  it('never mints a second signed Pristine Hide off one claim (seed 277, the issue case)', () => {
    const { sim, internals, a } = setup(277);
    const template = MOBS.wild_boar;
    const corpse = createMob(7769, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    grantCorpseHarvestOnMob(sim, corpse, mustPlayer(internals, a), ['hide', 'hide']);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(sim.countItem('rough_hide', a)).toBe(6);
    expect(premiumMaterialUnits(mustPlayer(internals, a), undefined, 'Alpha')).toBe(0);
  });

  it('rolls and grants the family ONE time, not once per repeat (seed 31, absolute counts)', () => {
    const { sim, internals, a } = setup(31);
    const template = MOBS.wild_boar;
    const corpse = createMob(7773, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    expect(template.componentTags).toEqual(['hide', 'tusk', 'meat']);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, corpse, mustPlayer(internals, a), ['hide', 'hide']);
    const result = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result).toHaveLength(1);
    expect(result[0].yields.map((y) => y.itemId).sort()).toEqual(['pristine_hide', 'rough_hide']);
    expect(result[0].yields.find((y) => y.itemId === 'rough_hide')?.qty).toBe(4);
    expect(sim.countItem('rough_hide', a)).toBe(4);
    expect(sim.countItem('pristine_hide', a)).toBe(1);
    const meta = mustPlayer(internals, a);
    expect(meta.inventory.filter((s) => s.itemId === 'pristine_hide')).toHaveLength(1);
    expect(sim.countItem('game_meat', a)).toBe(0);
  });

  it('a repeat cannot pull in a tag the caller never asked for (spread threshold, seed 31)', () => {
    const { sim, internals, mob, a } = setup(31);
    expect(MOBS.forest_wolf.componentTags).toEqual(['hide', 'fang']);
    grantCorpseHarvestOnMob(sim, mob, mustPlayer(internals, a), ['hide', 'hide']);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
  });

  it('a repeat inside a MULTI-family pick collapses only its own family', () => {
    const { sim, internals, a } = setup(31);
    const template = MOBS.wild_boar;
    const corpse = createMob(7772, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, corpse, mustPlayer(internals, a), ['meat', 'hide', 'meat']);
    const result = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result).toHaveLength(1);
    // Ledger order follows the pick's first-occurrence order, meat before hide,
    // which is also the chat-line order the player reads (#2457).
    expect(result[0].yields.map((y) => y.itemId)).toEqual(['game_meat', 'rough_hide']);
    expect(mustPlayer(internals, a).inventory.filter((s) => s.itemId === 'game_meat')).toHaveLength(
      1,
    );
  });

  it('leaves the corpse lifecycle exactly where a single-tag harvest leaves it', () => {
    const { sim, internals, mob, a, b } = setup(11);
    const once = setup(11);
    expect(mob.corpseTimer).toBe(9999);
    grantCorpseHarvestOnMob(sim, mob, mustPlayer(internals, a), ['hide', 'hide']);
    grantCorpseHarvestOnMob(once.sim, once.mob, mustPlayer(once.internals, once.a), ['hide']);
    expect(mob.harvestClaimedBy).toBe(a);
    // This corpse carries no loot, so the harvest takes the collapse arm and
    // clamps the timer to 4.
    expect(mob.corpseTimer).toBe(4);
    expect(mob.corpseTimer).toBe(once.mob.corpseTimer);
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(false);
    expect(mob.lootable).toBe(once.mob.lootable);
    // A second completion, repeated tag or not, is denied against the same
    // corpse (the claim is already spent).
    expect(grantCorpseHarvestOnMob(sim, mob, mustPlayer(internals, b), ['hide', 'hide'])).toBe(
      false,
    );
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('reserves ONE family of stack room, so a repeat no longer over-reserves the gate', () => {
    const stack = stackSizeOf(ITEMS.rough_hide);
    const rig = (components: string[]) => {
      const { sim, internals, a } = setup(31);
      const template = MOBS.wild_boar;
      const corpse = createMob(7771, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      const m = expectDefined(internals.players.get(a));
      fillBags(sim, internals, a);
      // Zero free slots, and stack room for exactly one family's top roll.
      m.inventory[0] = { itemId: 'rough_hide', count: stack - 6 };
      let draws = 0;
      sim.rng.setObserver(() => {
        draws++;
      });
      grantCorpseHarvestOnMob(sim, corpse, m, components);
      sim.rng.setObserver(null);
      return {
        claimedBy: corpse.harvestClaimedBy,
        hides: sim.countItem('rough_hide', a),
        draws,
      };
    };
    const dup = rig(['hide', 'hide']);
    const once = rig(['hide']);
    expect(once.claimedBy).not.toBeNull();
    expect(once.draws).toBe(2);
    expect(dup.claimedBy).toBe(once.claimedBy);
    expect(dup.draws).toBe(once.draws);
    expect(dup.hides).toBe(once.hides);
    expect(dup.hides).toBe(stack - 6 + 4);
  });

  it('draws NO rng when refused, on every GRANT-level refusal arm, repeat or not', () => {
    // Admission-level refusals (dead actor, too far, live mob, unknown
    // target) are the timed session's own gates, exhaustively pinned in
    // tests/corpse_harvest_cast.test.ts; grantCorpseHarvestOnMob's signature
    // (a real Entity, not an id, no pid resolution) does not reach them at
    // all. What stays in scope here is the GRANT function's own pre-roll
    // gates, which a refused command must not shift rng past.
    function runArm(
      label: string,
      templateId: string,
      arrange: (rig: ReturnType<typeof setup>, corpse: Entity) => void,
    ): void {
      for (const components of [['hide', 'hide'], ['hide']]) {
        const rig = setup(153);
        const template = MOBS[templateId];
        const corpse = createMob(7770, template, template.maxLevel, { x: 0, y: 0, z: 0 });
        corpse.dead = true;
        corpse.aiState = 'dead';
        corpse.corpseTimer = 9999;
        corpse.respawnTimer = 9999;
        rig.internals.entities.set(corpse.id, corpse);
        arrange(rig, corpse);
        let draws = 0;
        rig.sim.rng.setObserver(() => {
          draws++;
        });
        grantCorpseHarvestOnMob(rig.sim, corpse, mustPlayer(rig.internals, rig.a), components);
        rig.sim.rng.setObserver(null);
        const rowLabel = `${label} ${JSON.stringify(components)}`;
        expect(draws, `${rowLabel} draws`).toBe(0);
        expect(rig.sim.countItem('rough_hide', rig.a), `${rowLabel} yield`).toBe(0);
      }
    }

    runArm('full bags (the pre-claim capacity gate)', 'forest_wolf', ({ sim, internals, a }) => {
      fillBags(sim, internals, a);
    });
    runArm('the corpse is already claimed', 'forest_wolf', ({ b }, corpse) => {
      corpse.harvestClaimedBy = b;
    });
    // warlock_imp as SHIPPED (untagged; #1140 only tagged a subset of mobs).
    expect(MOBS.warlock_imp.componentTags).toBeUndefined();
    runArm('the corpse carries no component tags', 'warlock_imp', () => {});
    withUnmappedTemplate(() => {
      runArm('the corpse carries only unmapped component families', UNMAPPED_TEMPLATE_ID, () => {});
    });
  });
});

// #2504: an entry naming no tag on the corpse is dropped before either length
// test, so it can no longer pad the pick past the `>= taggedComponents.length`
// spread threshold. Pre-fix, ['hide','junk'] on a two-tag corpse harvested BOTH
// families at bonus 0 (a family the caller never named), byte-identical to the
// empty pick; ['hide'] concentrated on hide. Same class as #2474 one step over,
// and the same unchanged effectiveFocusComponents domain logic.
describe('an invalid component tag is ignored entirely (#2504)', () => {
  function harvestWith(
    templateId: string,
    components: string[],
    seed: number,
  ): { inventory: unknown; events: unknown; draws: number; claimedBy: number | null } {
    const { sim, internals, a } = setup(seed);
    const template = MOBS[templateId];
    const corpse = createMob(7754, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    grantCorpseHarvestOnMob(sim, corpse, meta, components);
    sim.rng.setObserver(null);
    return {
      inventory: structuredClone(meta.inventory),
      events: sim.drainEvents(),
      draws,
      claimedBy: corpse.harvestClaimedBy,
    };
  }

  const CASES: {
    templateId: string;
    padded: string[];
    stripped: string[];
    tags: string[];
    arm: string;
    draws: number;
    spreadDraws: number;
    absent: string[];
  }[] = [
    {
      templateId: 'forest_wolf',
      padded: ['hide', 'junk'],
      stripped: ['hide'],
      tags: ['hide', 'fang'],
      arm: 'padded past the threshold',
      draws: 2,
      spreadDraws: 4,
      absent: ['wolf_fang'],
    },
    {
      templateId: 'old_greyjaw',
      padded: ['hide', 'claw', 'junk'],
      stripped: ['hide', 'claw'],
      tags: ['hide', 'fang', 'claw'],
      arm: 'padded past the threshold',
      draws: 4,
      spreadDraws: 6,
      absent: ['wolf_fang'],
    },
    {
      templateId: 'wild_boar',
      padded: ['meat', 'junk', 'tusk'],
      stripped: ['meat', 'tusk'],
      tags: ['hide', 'tusk', 'meat'],
      arm: 'padded past the threshold',
      draws: 4,
      spreadDraws: 6,
      absent: ['rough_hide'],
    },
    {
      templateId: 'wild_boar',
      padded: ['hide', 'junk'],
      stripped: ['hide'],
      tags: ['hide', 'tusk', 'meat'],
      arm: 'under the threshold',
      draws: 2,
      spreadDraws: 6,
      absent: ['game_meat'],
    },
  ];

  it('covers both arms for real: each row is the corpse shape it claims to be', () => {
    for (const c of CASES) {
      expect(MOBS[c.templateId].componentTags, `${c.templateId} tags`).toEqual(c.tags);
      for (const tag of c.stripped) {
        expect(c.tags, `${c.templateId} ${tag} is on the corpse`).toContain(tag);
      }
      for (const tag of c.padded.filter((t) => !c.stripped.includes(t))) {
        expect(c.tags, `${c.templateId} ${tag} is NOT on the corpse`).not.toContain(tag);
      }
      const arm =
        new Set(c.padded).size >= c.tags.length
          ? 'padded past the threshold'
          : 'under the threshold';
      expect(arm, `${c.templateId} ${JSON.stringify(c.padded)} arm`).toBe(c.arm);
      for (const itemId of c.absent) {
        const family = Object.keys(HARVEST_COMPONENT_ITEMS).find(
          (k) => HARVEST_COMPONENT_ITEMS[k] === itemId,
        );
        expect(family, `${itemId} maps to a family`).toBeDefined();
        expect(c.tags, `${c.templateId} ${family} is on the corpse`).toContain(family);
        expect(c.stripped, `${c.templateId} ${family} is not named`).not.toContain(family);
      }
      expect(harvestWith(c.templateId, [], 5).draws, `${c.templateId} spread draws`).toBe(
        c.spreadDraws,
      );
      expect(c.draws, `${c.templateId} concentrate vs spread`).not.toBe(c.spreadDraws);
    }
    expect(CASES.map((c) => c.arm)).toContain('padded past the threshold');
    expect(CASES.map((c) => c.arm)).toContain('under the threshold');
  });

  it('grants exactly what the junk-free pick grants, on the same seed, on both arms', () => {
    for (const c of CASES) {
      for (const seed of [2, 5, 11]) {
        const label = `${c.templateId} ${JSON.stringify(c.padded)} (${c.arm}) @${seed}`;
        const padded = harvestWith(c.templateId, c.padded, seed);
        const stripped = harvestWith(c.templateId, c.stripped, seed);
        expect(padded.inventory, `${label} inventory`).toEqual(stripped.inventory);
        expect(padded.events, `${label} events`).toEqual(stripped.events);
        expect(padded.draws, `${label} draws`).toEqual(stripped.draws);
        expect(stripped.draws, `${label} junk-free draws`).toBe(c.draws);
        expect(padded.claimedBy, `${label} claim`).toBe(stripped.claimedBy);
        expect(padded.claimedBy, `${label} claim is the harvester`).not.toBeNull();
        const inv = padded.inventory as { itemId: string; count: number }[];
        for (const itemId of c.absent) {
          expect(
            inv.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0),
            `${label} ${itemId} never named`,
          ).toBe(0);
        }
      }
    }
  });

  it('the issue case in absolute counts: junk no longer buys a family never named', () => {
    const { sim, internals, a } = setup(31);
    expect(MOBS.forest_wolf.componentTags).toEqual(['hide', 'fang']);
    const corpse = createMob(7753, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, {
      x: 0,
      y: 0,
      z: 0,
    });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    grantCorpseHarvestOnMob(sim, corpse, meta, ['hide', 'junk']);
    sim.rng.setObserver(null);
    expect(sim.countItem('rough_hide', a)).toBe(3);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
    expect(sim.countItem('pristine_hide', a)).toBe(1);
    expect(draws).toBe(2);
    const result = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result).toHaveLength(1);
    expect(result[0].yields.map((y) => y.itemId).sort()).toEqual(['pristine_hide', 'rough_hide']);
    expect(result[0].yields.find((y) => y.itemId === 'rough_hide')?.qty).toBe(3);
  });

  it('an ALL-junk pick spreads, exactly as the empty pick does (the settled ruling)', () => {
    for (const templateId of ['forest_wolf', 'wild_boar']) {
      for (const seed of [2, 5, 11]) {
        for (const pick of [['junk'], ['junk', 'zzz'], ['junk', 'zzz', 'qqq']]) {
          const label = `${templateId} ${JSON.stringify(pick)} @${seed}`;
          const junk = harvestWith(templateId, pick, seed);
          const empty = harvestWith(templateId, [], seed);
          expect(junk.inventory, `${label} inventory`).toEqual(empty.inventory);
          expect(junk.events, `${label} events`).toEqual(empty.events);
          expect(junk.draws, `${label} draws`).toEqual(empty.draws);
          expect(junk.claimedBy, `${label} claim`).toBe(empty.claimedBy);
        }
      }
    }
    const junk = harvestWith('forest_wolf', ['junk'], 5);
    expect(junk.draws).toBe(4);
    expect(junk.claimedBy).not.toBeNull();
    const inv = junk.inventory as { itemId: string; count: number }[];
    expect(inv.filter((s) => s.itemId === 'rough_hide').reduce((n, s) => n + s.count, 0)).toBe(1);
    expect(inv.filter((s) => s.itemId === 'wolf_fang').reduce((n, s) => n + s.count, 0)).toBe(1);
  });

  const HIDE_STACK = stackSizeOf(ITEMS.rough_hide);
  const RESERVED_PER_FAMILY = 6;

  const gateRig = (components: string[], room: number) => {
    const { sim, internals, a, mob } = setup(31);
    const meta = mustPlayer(internals, a);
    fillBags(sim, internals, a);
    meta.inventory[0] = { itemId: 'rough_hide', count: HIDE_STACK - room };
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    grantCorpseHarvestOnMob(sim, mob, meta, components);
    sim.rng.setObserver(null);
    return {
      claimedBy: mob.harvestClaimedBy,
      hides: sim.countItem('rough_hide', a),
      fangs: sim.countItem('wolf_fang', a),
      draws,
      errors: sim
        .drainEvents()
        .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error')
        .map((e) => e.text),
    };
  };

  it('the pre-claim capacity gate reserves the junk-free pick, not the padded one', () => {
    const padded = gateRig(['hide', 'junk'], RESERVED_PER_FAMILY);
    const stripped = gateRig(['hide'], RESERVED_PER_FAMILY);
    expect(stripped.claimedBy).not.toBeNull();
    expect(stripped.draws).toBe(2);
    expect(stripped.errors).toEqual([]);
    expect(padded.claimedBy).toBe(stripped.claimedBy);
    expect(padded.draws).toBe(stripped.draws);
    expect(padded.hides).toBe(stripped.hides);
    expect(padded.hides).toBe(HIDE_STACK - RESERVED_PER_FAMILY + 3);
    expect(padded.errors).toEqual([]);
    const tightPadded = gateRig(['hide', 'junk'], RESERVED_PER_FAMILY - 1);
    const tightStripped = gateRig(['hide'], RESERVED_PER_FAMILY - 1);
    expect(tightStripped.claimedBy).toBeNull();
    expect(tightStripped.draws).toBe(0);
    expect(tightStripped.errors).toEqual(['Your bags are full.']);
    expect(tightPadded.claimedBy).toBeNull();
    expect(tightPadded.draws).toBe(0);
    expect(tightPadded.errors).toEqual(['Your bags are full.']);
    expect(tightPadded.hides).toBe(HIDE_STACK - RESERVED_PER_FAMILY + 1);
  });

  it('...and an all-junk pick reserves the whole SPREAD, not one family', () => {
    const junk = gateRig(['junk'], RESERVED_PER_FAMILY);
    const oneFamily = gateRig(['hide'], RESERVED_PER_FAMILY);
    expect(oneFamily.claimedBy).not.toBeNull();
    expect(oneFamily.draws).toBe(2);
    expect(junk.claimedBy).toBeNull();
    expect(junk.draws).toBe(0);
    expect(junk.hides).toBe(HIDE_STACK - RESERVED_PER_FAMILY);
    expect(junk.fangs).toBe(0);
    expect(junk.errors).toEqual(['Your bags are full.']);
    const empty = gateRig([], RESERVED_PER_FAMILY);
    expect(junk.claimedBy).toBe(empty.claimedBy);
    expect(junk.errors).toEqual(empty.errors);
    expect(junk.draws).toBe(empty.draws);
  });

  it('draws NO rng when refused, on every GRANT-level refusal arm, junk in the pick or not', () => {
    // Narrowed the same way as #2474's sweep above: admission-only arms (too
    // far, dead actor, live mob, an id resolving to no entity or no player)
    // are tests/corpse_harvest_cast.test.ts's, unreachable through this
    // function's signature. #2509's and #2513's own arms get their own
    // describes below; this sweep keeps the two arms genuinely driven by the
    // JUNK-bearing pick itself: full bags, and an already-spent claim.
    function runArm(label: string, arrange: (rig: ReturnType<typeof setup>) => void): void {
      for (const components of [['hide', 'junk'], ['junk'], ['junk', 'zzz']]) {
        const rig = setup(153);
        arrange(rig);
        let draws = 0;
        rig.sim.rng.setObserver(() => {
          draws++;
        });
        grantCorpseHarvestOnMob(rig.sim, rig.mob, mustPlayer(rig.internals, rig.a), components);
        rig.sim.rng.setObserver(null);
        const label2 = `${label} ${JSON.stringify(components)}`;
        expect(draws, `${label2} draws`).toBe(0);
        expect(rig.sim.countItem('rough_hide', rig.a), `${label2} yield`).toBe(0);
        expect(rig.sim.countItem('wolf_fang', rig.a), `${label2} fang yield`).toBe(0);
        expect(rig.mob.harvestClaimedBy, `${label2} claim`).toBe(
          label === 'the corpse is already claimed' ? rig.b : null,
        );
        expect(rig.mob.corpseTimer, `${label2} corpse timer`).toBe(9999);
      }
    }
    runArm('full bags (the pre-claim capacity gate)', ({ sim, internals, a }) => {
      fillBags(sim, internals, a);
    });
    runArm('the corpse is already claimed', ({ mob, b }) => {
      mob.harvestClaimedBy = b;
    });

    // Positive control for the observer itself.
    const ok = setup(31);
    let okDraws = 0;
    ok.sim.rng.setObserver(() => {
      okDraws++;
    });
    grantCorpseHarvestOnMob(ok.sim, ok.mob, mustPlayer(ok.internals, ok.a), ['hide', 'junk']);
    ok.sim.rng.setObserver(null);
    expect(okDraws).toBe(2);
    expect(ok.mob.harvestClaimedBy).toBe(ok.a);
    expect(ok.mob.corpseTimer).not.toBe(9999);
  });
});

// Corpse premium-arm tool gating (Professions 2.0): the plain
// component grant is NEVER gated (the bare-hands floor); only the
// signed/specimen upgrade of a signable rarity roll checks the best owned
// gathering tool of ANY profession against MONSTER_MATERIAL_TIERS. Every
// wave-one family ships at tier 1, so the deny arm is unreachable through
// shipped content; the mutation seam below is documented on the test.
describe('corpse premium-arm tool gating (Professions 2.0)', () => {
  // A ONE-player rig (distinct from setup()'s two players): the deny/dedupe
  // seeds below were hunted against exactly this construction order, and the
  // second addPlayer would shift the world's draw positions.
  function soloRig(seed: number, templateId = 'forest_wolf') {
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
    const internals = sim as unknown as SimInternals;
    const a = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const e = expectDefined(internals.entities.get(a));
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
    const template = MOBS[templateId];
    const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    return { sim, internals, a, mob };
  }

  // MONSTER_MATERIAL_TIERS is typed Readonly but is a plain runtime object,
  // and the grant domain resolves monsterMaterialTierFor inline (no injectable
  // seam), so raising one family's tier here, restored in finally, is the
  // narrowest honest way to drive the REAL deny arm rather than pin a
  // re-implementation. Restored before any assertion runs.
  function withTier(component: string, tier: number, body: () => void): void {
    const tiers = MONSTER_MATERIAL_TIERS as Record<string, number>;
    const prior = tiers[component];
    tiers[component] = tier;
    try {
      body();
    } finally {
      if (prior === undefined) delete tiers[component];
      else tiers[component] = prior;
    }
  }

  it('lists every harvest component family literally, all at tier 1 (the wave-one prime directive)', () => {
    expect(MONSTER_MATERIAL_TIERS).toEqual({
      hide: 1,
      fang: 1,
      silk: 1,
      venomSac: 1,
      meat: 1,
      cloth: 1,
      claw: 1,
      tusk: 1,
      horn: 1,
      gills: 1,
    });
    expect(Object.keys(MONSTER_MATERIAL_TIERS).sort()).toEqual(
      Object.keys(HARVEST_COMPONENT_ITEMS).sort(),
    );
    expect(monsterMaterialTierFor('hide')).toBe(1);
    expect(monsterMaterialTierFor('no_such_component')).toBe(1);
  });

  it('the pure deny decision: bare hands (tier 1) cannot cover a tier-2 material, tier 2 can', () => {
    expect(canHarvestMonsterMaterial(1, 2)).toBe(false);
    expect(canHarvestMonsterMaterial(2, 2)).toBe(true);
  });

  it('bare hands still earn the signed specimen on real content: tier-1 families never gate (seed 30)', () => {
    const { sim, internals, a, mob } = setup(30);
    const meta = expectDefined(internals.players.get(a));
    expect(bestOwnedAnyGatherToolTier(meta.inventory, ITEMS)).toBe(1);
    sim.drainEvents();
    grantCorpseHarvestOnMob(sim, mob, meta, ['hide']);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance).toBeUndefined();
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
  });

  it('a denied premium pull downgrades to the plain grant: same qty, same claim, same draws (seed 15)', () => {
    const base = soloRig(15);
    const baseMeta = mustPlayer(base.internals, base.a);
    let baseDraws = 0;
    base.sim.rng.setObserver(() => baseDraws++);
    try {
      grantCorpseHarvestOnMob(base.sim, base.mob, baseMeta, ['hide']);
    } finally {
      base.sim.rng.setObserver(null);
    }
    const basePlain = base.sim.countItem('rough_hide', base.a);
    expect(basePlain).toBe(6);
    expect(base.sim.countItem('pristine_hide', base.a)).toBe(1);

    const { sim, internals, a, mob } = soloRig(15);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    let draws = 0;
    withTier('hide', 2, () => {
      sim.rng.setObserver(() => draws++);
      try {
        grantCorpseHarvestOnMob(sim, mob, meta, ['hide']);
      } finally {
        sim.rng.setObserver(null);
      }
    });
    expect(baseDraws).toBe(2);
    expect(draws).toBe(2);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(sim.countItem('rough_hide', a)).toBe(basePlain);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(meta.inventory.some((s) => s.itemId === 'rough_hide' && s.instance)).toBe(false);
    expect(premiumMaterialUnits(meta)).toBe(0);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: a, surface: 'corpse', requiredTier: 2 },
    ]);
  });

  it('an owned tier-2 tool restores the premium pull at a raised family tier (seed 15)', () => {
    const { sim, internals, a, mob } = soloRig(15);
    const meta = mustPlayer(internals, a);
    sim.addItem('mithril_mining_pick', 1, a); // any-profession owned-best covers tier 2
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    sim.drainEvents();
    let draws = 0;
    withTier('hide', 2, () => {
      sim.rng.setObserver(() => draws++);
      try {
        grantCorpseHarvestOnMob(sim, mob, meta, ['hide']);
      } finally {
        sim.rng.setObserver(null);
      }
    });
    expect(draws).toBe(2);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance).toBeUndefined();
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
    expect(sim.countItem('rough_hide', a)).toBe(6);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('R50: the same tool BELOW its wield requirement restores nothing, and names the rung (seed 15)', () => {
    const { sim, internals, a, mob } = soloRig(15);
    const meta = mustPlayer(internals, a);
    sim.addItem('mithril_mining_pick', 1, a);
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY - 1;
    sim.drainEvents();
    let draws = 0;
    withTier('hide', 2, () => {
      sim.rng.setObserver(() => draws++);
      try {
        grantCorpseHarvestOnMob(sim, mob, meta, ['hide']);
      } finally {
        sim.rng.setObserver(null);
      }
    });
    expect(draws).toBe(2);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(sim.countItem('rough_hide', a)).toBe(6);
    expect(premiumMaterialUnits(meta)).toBe(0);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      {
        type: 'gatherDenied',
        pid: a,
        surface: 'corpse',
        requiredTier: 2,
        wieldProficiency: TIER3_TOOL_WIELD_PROFICIENCY,
      },
    ]);
  });

  it('at most ONE gatherDenied per harvest command, even with several denied families (seed 23)', () => {
    const base = soloRig(23);
    grantCorpseHarvestOnMob(base.sim, base.mob, mustPlayer(base.internals, base.a), undefined);
    const baseMeta = expectDefined(base.internals.players.get(base.a));
    expect(base.sim.countItem('pristine_hide', base.a)).toBe(1);
    expect(premiumMaterialUnits(baseMeta, 'wolf_fang', 'Alpha')).toBe(1);

    const { sim, internals, a, mob } = soloRig(23);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    withTier('hide', 2, () => {
      withTier('fang', 2, () => {
        grantCorpseHarvestOnMob(sim, mob, meta, undefined);
      });
    });
    const denied = sim.drainEvents().filter((e) => e.type === 'gatherDenied');
    expect(denied).toEqual([{ type: 'gatherDenied', pid: a, surface: 'corpse', requiredTier: 2 }]);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('wolf_fang', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(premiumMaterialUnits(meta)).toBe(0);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('the single event is tiered off the FIRST failing family in yield order (seed 2)', () => {
    const first = soloRig(2);
    first.sim.drainEvents();
    withTier('hide', 2, () => {
      withTier('fang', 3, () => {
        grantCorpseHarvestOnMob(
          first.sim,
          first.mob,
          mustPlayer(first.internals, first.a),
          undefined,
        );
      });
    });
    expect(first.sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: first.a, surface: 'corpse', requiredTier: 2 },
    ]);
    const mirror = soloRig(2);
    mirror.sim.drainEvents();
    withTier('hide', 3, () => {
      withTier('fang', 2, () => {
        grantCorpseHarvestOnMob(
          mirror.sim,
          mirror.mob,
          mustPlayer(mirror.internals, mirror.a),
          undefined,
        );
      });
    });
    expect(mirror.sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: mirror.a, surface: 'corpse', requiredTier: 3 },
    ]);
  });
});

// The online half of the claim: the server encodes harvestClaimedBy as the
// sparse terse key `hcb` (server/game.ts wireEntity), ClientWorld mirrors it,
// and the corpse picker's availability core (corpseLootAvailability) therefore
// stops offering an already-claimed corpse online, exactly as offline. Driven
// through the real timed cast now that a claim is no longer instant.
describe('corpse harvest claim over the wire (online picker parity)', () => {
  beforeAll(() => setActiveWorldContent(PUBLIC_TEST_WORLD));
  afterAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));

  it('a real claim rides hcb, mirrors into ClientWorld, and gates the picker', () => {
    const { sim, mob, a, b } = publicSetup();
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    expect(mob.harvestClaimedBy).toBe(a);

    const w = wireEntity(mob);
    expect(w.hcb).toBe(a);

    // Bravo's client sees Alpha's claim mirrored, and the picker refuses it.
    const client = bareClient(b);
    clientMirror(client).applySnapshot({ t: 'snap', ents: [w] });
    const mirrored = expectDefined(client.entities.get(mob.id));
    expect(mirrored.harvestClaimedBy).toBe(a);
    expect(corpseLootAvailability(mirrored, b).harvestable).toBe(false);
  });

  it('an unclaimed tagged corpse stays harvestable through the mirror', () => {
    const { mob, b } = setup();

    const w = wireEntity(mob);
    expect(w).not.toHaveProperty('hcb');

    const client = bareClient(b);
    clientMirror(client).applySnapshot({ t: 'snap', ents: [w] });
    const mirrored = expectDefined(client.entities.get(mob.id));
    expect(mirrored.harvestClaimedBy).toBeNull();
    expect(corpseLootAvailability(mirrored, b).harvestable).toBe(true);
  });
});

// The LIVE broadcast path (the hand-assembled snap envelopes above are always
// fullJson-shaped): the per-session entity cache sends identity only on first
// sight, so a claim landing AFTER a viewer has seen the corpse rides a lite
// (dyn-only) record, and leaving interest scope evicts the corpse from the
// session's sent set so re-entry gets a fresh full record. Both arms must
// deliver claim truth to the mirror. Driven through the real timed cast: the
// harvester is grounded via server.sim.groundPos so the multi-tick completion
// never reads gravity settle as movement.
describe('corpse harvest claim over the live broadcast (delta + interest scope)', () => {
  beforeAll(() => setActiveWorldContent(PUBLIC_TEST_WORLD));
  afterAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));

  function liveSetup() {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 81, 'Alpha');
    const sb = joinServer(server, fcB, 82, 'Bravo');
    const internals = server.sim as unknown as SimInternals;
    // Distinct spots (never the exact same x,z as each other or the corpse
    // below), the corpse_harvest_command.test.ts idiom: nothing here should
    // ever rely on same-tile behavior being harmless. Bravo stays well within
    // the ~120 yd interest radius so the "first sight" arm still applies.
    const place = (pid: number, x: number, z: number) => {
      const e = expectDefined(internals.entities.get(pid));
      e.pos = server.sim.groundPos(x, z);
      e.prevPos = { ...e.pos };
      e.vx = 0;
      e.vy = 0;
      e.vz = 0;
      e.onGround = true;
    };
    place(sa.pid, 0, 0);
    place(sb.pid, 20, 0);
    server.sim.addItem('field_kit', 1, sa.pid);
    // A dead wolf corpse at Alpha's own spot, with a world-unique entity id
    // (the server sim is a full generated world, so 9999 could collide).
    const template = MOBS.forest_wolf;
    const mobId = Math.max(...internals.entities.keys()) + 1;
    const mob = createMob(mobId, template, template.maxLevel, server.sim.groundPos(0, 0));
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    // One tick re-indexes the spatial grid the interest scan reads
    // (forEachInRadius), so the moved players and the inserted corpse land in
    // their cells before the first broadcast.
    server.sim.tick();
    return { server, internals, fcB, sa, sb, mob };
  }

  function completeHarvest(server: GameServer, mobId: number, pid: number): void {
    expect(server.sim.harvestCorpse(mobId, pid)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) server.sim.tick();
  }

  it('a claim landing after first sight arrives as a lite delta record and gates the picker', () => {
    const { server, fcB, sa, sb, mob } = liveSetup();

    // First sight: Bravo's client mirrors the unclaimed corpse via a full record.
    broadcast(server);
    const client = bareClient(sb.pid);
    clientMirror(client).applySnapshot(lastSnap(fcB.sent));
    const first = expectDefined(client.entities.get(mob.id));
    expect(first.harvestClaimedBy).toBeNull();
    expect(corpseLootAvailability(first, sb.pid).harvestable).toBe(true);

    // Alpha's cast completes AFTER Bravo has seen the corpse: the next
    // broadcast carries the claim as a dyn-only lite record (identity already
    // sent), the exact production sequence the hcb mirror exists for.
    completeHarvest(server, mob.id, sa.pid);
    expect(mob.harvestClaimedBy).toBe(sa.pid);
    broadcast(server);
    const snap = asSnapFrame(lastSnap(fcB.sent));
    const rec = expectDefined(snap.ents.find((e) => e.id === mob.id));
    expect(rec.hcb).toBe(sa.pid);
    expect(rec).not.toHaveProperty('nm'); // lite record: no identity resend

    clientMirror(client).applySnapshot(snap);
    const mirrored = expectDefined(client.entities.get(mob.id));
    expect(mirrored.harvestClaimedBy).toBe(sa.pid);
    expect(corpseLootAvailability(mirrored, sb.pid).harvestable).toBe(false);
  });

  it('scope re-entry rebuilds claim truth: claims and clears made out of view arrive on return', () => {
    const { server, internals, fcB, sa, sb, mob } = liveSetup();

    broadcast(server);
    const client = bareClient(sb.pid);
    clientMirror(client).applySnapshot(lastSnap(fcB.sent));
    expect(client.entities.get(mob.id)?.harvestClaimedBy).toBeNull();

    // Bravo walks far out of interest range; the server evicts the corpse from
    // this session's sent set, and the claim lands while it is out of view.
    const bEnt = expectDefined(internals.entities.get(sb.pid));
    const walkTo = (x: number) => {
      bEnt.pos = { x, y: 0, z: 0 };
      bEnt.prevPos = { x, y: 0, z: 0 };
      server.sim.tick(); // re-index the interest grid at the new position
      broadcast(server);
      clientMirror(client).applySnapshot(lastSnap(fcB.sent));
    };
    walkTo(5000);
    completeHarvest(server, mob.id, sa.pid);
    broadcast(server);
    clientMirror(client).applySnapshot(lastSnap(fcB.sent));

    // Re-entry: the fresh full record carries the claim made out of view.
    walkTo(0);
    const back = expectDefined(client.entities.get(mob.id));
    expect(back.harvestClaimedBy).toBe(sa.pid);
    expect(corpseLootAvailability(back, sb.pid).harvestable).toBe(false);

    // Inverse arm: the claim clears out of view (the respawn sweep write,
    // mob lifecycle), so the re-entry record omits hcb and the stale
    // mirrored pid must reset, not linger.
    walkTo(5000);
    mob.harvestClaimedBy = null;
    walkTo(0);
    const cleared = expectDefined(client.entities.get(mob.id));
    expect(cleared.harvestClaimedBy).toBeNull();
    expect(corpseLootAvailability(cleared, sb.pid).harvestable).toBe(true);
  });

  it('an owner-lock lapse after first sight rides a lite delta record and reopens the picker', () => {
    // The `ffa` key flips once per corpse INSIDE dynamicFields, the same
    // cached-record path as hcb, so the flip must invalidate the per-entity
    // dyn cache and reach a viewer who already saw the locked corpse. Driven
    // directly off the fixture (no harvest cast involved): this is the
    // ordinary loot-lock lapse, orthogonal to the timed harvest cast above.
    const { server, fcB, sa, sb, mob } = liveSetup();
    mob.lootable = true;
    mob.tappedById = sa.pid;
    mob.harvestClaimedBy = sa.pid; // harvest arm closed: canOpen isolates loot rights
    mob.lootFfaTimer = 60;
    mob.loot = { copper: 10, items: [{ itemId: 'wolf_fang', count: 1 }] };

    broadcast(server);
    const client = bareClient(sb.pid);
    clientMirror(client).applySnapshot(lastSnap(fcB.sent));
    const locked = expectDefined(client.entities.get(mob.id));
    expect(locked.lootFfaTimer).toBe(Infinity);
    expect(corpseLootAvailability(locked, sb.pid).canOpen).toBe(false);

    // The lock lapses AFTER Bravo has seen the corpse: the next broadcast must
    // carry ffa:1 as a dyn-only lite record (identity already sent).
    mob.lootFfaTimer = 0;
    server.sim.tick();
    broadcast(server);
    const snap = asSnapFrame(lastSnap(fcB.sent));
    const rec = expectDefined(snap.ents.find((e) => e.id === mob.id));
    expect(rec.ffa).toBe(1);
    expect(rec).not.toHaveProperty('nm'); // lite record: no identity resend

    clientMirror(client).applySnapshot(snap);
    const lapsed = expectDefined(client.entities.get(mob.id));
    expect(corpseLootAvailability(lapsed, sb.pid).canOpen).toBe(true);
    expect(corpseLootAvailability(lapsed, sb.pid).hasLoot).toBe(true);
  });
});

// #2474/#2504/#2509 over the wire: these three issues each drove a
// hand-crafted `components` frame (repeated tag, junk tag, unmapped-family-
// only) through the legacy per-call selection protocol. That protocol is
// retired: Sim.harvestCorpse now takes id and an optional pid only, and ANY
// components key on the wire command, whatever it contains, is refused
// outright before admission, with a false commandOutcome and no reservation,
// grant, or rng (see tests/corpse_harvest_command.test.ts's
// legacyComponentPayloads sweep for the general `[]`/null/single/multi-tag
// shape). This keeps the three ADVERSARIAL variants those issues cared about
// on the record as refused, rather than silently dropping the coverage.
describe('legacy per-call components shapes are refused before admission (#2474, #2504, #2509)', () => {
  function joinedServer(characterId: number): {
    server: GameServer;
    session: ClientSession;
    fc: ReturnType<typeof fakeWs>;
  } {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, characterId, 'Legacy');
    return { server, session, fc };
  }

  function spawnCorpseAtSession(server: GameServer, session: ClientSession, id: number): Entity {
    const player = expectDefined(server.sim.entities.get(session.pid), 'player entity');
    const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, { ...player.pos });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    server.sim.entities.set(mob.id, mob);
    return mob;
  }

  const shapes: { label: string; components: unknown }[] = [
    { label: 'a repeated component tag (#2474)', components: ['hide', 'hide'] },
    {
      label: 'a junk component tag beside a real one (#2504)',
      components: ['hide', 'not_a_real_tag'],
    },
    { label: 'a pick naming only an unmapped family (#2509)', components: ['claw'] },
  ];

  for (const [i, shape] of shapes.entries()) {
    it(`refuses ${shape.label}: no admission, reservation, grant, or rng`, () => {
      const { server, session, fc } = joinedServer(200 + i);
      server.sim.addItem('field_kit', 1, session.pid);
      const mob = spawnCorpseAtSession(server, session, 9301 + i);
      fc.sent.length = 0;
      const draws: number[] = [];
      server.sim.rng.setObserver((v) => draws.push(v));

      server.handleMessage(
        session,
        JSON.stringify({
          t: 'cmd',
          cmd: 'harvestCorpse',
          id: mob.id,
          components: shape.components,
          rid: 1,
        }),
      );

      server.sim.rng.setObserver(null);
      expect(draws).toEqual([]);
      expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
      expect(mob.harvestClaimedBy).toBeNull();
      const actor = expectDefined(server.sim.entities.get(session.pid));
      expect(actor.castingAbility).toBeNull();
      const outcome = fc.sent.find((f) => f.t === 'commandOutcome');
      expect(outcome).toEqual({ t: 'commandOutcome', rid: 1, ok: false });
    });
  }
});

// #2509: a pick can name a family the corpse really CARRIES that no harvest
// item is wired to (claw, tusk, gills and horn each shipped that way, until
// #2905 mapped the first two and Masterwrought Phase 11m the last two). It
// survives sanitization for that reason, so pre-fix it spent the single-use
// claim, drew one tier roll per named family, granted nothing, and emitted
// NOTHING AT ALL (the harvestResult ledger is gated on `granted.length > 0`).
//
// The fix is a pre-claim, rng-free refusal inside grantCorpseHarvest
// (forfeitsEveryMappedYield), NOT a narrowing inside effectiveFocusComponents:
// narrowing would move the concentration bonus on every mixed pick. No
// shipped family is unmapped since 11m, so the mixed shapes here are the
// retagged fixtures (MIXED_TEMPLATE_ID, MIXED2_TEMPLATE_ID) and the shipped
// exemplars are pinned as the all-mapped corpses they are now. The old
// per-corpse checkbox picker's "offers exactly what the command accepts"
// sweep (corpseHarvestView) is retired along with that picker: the current
// preference model (All, or one remembered material) is proven against
// corpseHarvestStatusView/corpseHarvestPreferenceOptions in
// tests/corpse_harvest_view.test.ts and tests/harvest_preference*.test.ts.
// The old "an omitted pick derives from town focus" tests are retired the
// same way (town focus is bonus math only now, never selection); what
// remains genuinely domain is that this gate refuses on `chosen` content
// alone, which the last case below states directly.
describe('a pick of nothing but unmapped families is refused, claim intact (#2509)', () => {
  // The shared module-scope rig, with this suite's own corpse id so its cases
  // and the #2513 suite's cannot collide on one entity.
  const harvest2509 = (templateId: string, components: string[] | undefined, seed = 5) =>
    grantCommand(templateId, components, { seed, corpseId: 7509 });

  const REFUSAL = 'Nothing you selected can be harvested from that corpse.';
  const NOT_HARVESTABLE = 'That corpse has nothing to harvest.';

  it('is about families no row maps: the shipped set is empty since 11m, so the synthetic pair carries the case', () => {
    const tagged = new Set(Object.values(MOBS).flatMap((m) => m.componentTags ?? []));
    expect([...tagged].filter((t) => !HARVEST_COMPONENT_ITEMS[t]).sort()).toEqual([]);
    expect(Object.keys(HARVEST_COMPONENT_ITEMS).sort()).toEqual([
      'claw',
      'cloth',
      'fang',
      'gills',
      'hide',
      'horn',
      'meat',
      'silk',
      'tusk',
      'venomSac',
    ]);
    for (const family of [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2]) {
      expect(HARVEST_COMPONENT_ITEMS[family], family).toBeUndefined();
      expect(tagged.has(family), family).toBe(false);
    }
    expect(tagged.has('gills')).toBe(true);
    expect(tagged.has('horn')).toBe(true);
  });

  it('refuses the pick the issue reproduces, and leaves the corpse exactly as it found it', () => {
    withMixedTemplates(() => {
      expect(MOBS[MIXED_TEMPLATE_ID].componentTags).toEqual(['hide', 'claw', UNMAPPED_FAMILY]);
      const refused = harvest2509(MIXED_TEMPLATE_ID, [UNMAPPED_FAMILY]);
      expect(refused.claimedBy).toBeNull();
      expect(refused.draws).toBe(0);
      expect(refused.corpseTimer).toBe(9999);
      expect(refused.errors).toEqual([REFUSAL]);
      expect(refused.events.map((e) => e.type)).toEqual(['error']);
      const ok = harvest2509(MIXED_TEMPLATE_ID, ['hide']);
      expect(ok.claimedBy).not.toBeNull();
      expect(ok.draws).toBe(2);
      expect(ok.sim.countItem('rough_hide', ok.a)).toBeGreaterThan(0);
    });
  });

  it('no longer fires on sethrael_palecoil, the old exemplar: horn pays since Phase 11m', () => {
    expect(MOBS.sethrael_palecoil.componentTags).toEqual(['hide', 'claw', 'horn', 'venomSac']);
    expect(HARVEST_COMPONENT_ITEMS.horn).toBe('curved_tusk');
    const hornOnly = harvest2509('sethrael_palecoil', ['horn']);
    expect(hornOnly.errors).toEqual([]);
    expect(hornOnly.claimedBy).not.toBeNull();
    expect(hornOnly.draws).toBe(2);
    expect(hornOnly.sim.countItem('curved_tusk', hornOnly.a)).toBe(4);
    expect(hornOnly.sim.countItem('rough_hide', hornOnly.a)).toBe(0);
    expect(MOBS.mudfin_murloc.componentTags).toEqual(['gills', 'hide']);
    expect(HARVEST_COMPONENT_ITEMS.gills).toBe('mudfin_scale');
    const gillsOnly = harvest2509('mudfin_murloc', ['gills']);
    expect(gillsOnly.errors).toEqual([]);
    expect(gillsOnly.claimedBy).not.toBeNull();
    expect(gillsOnly.draws).toBe(2);
    expect(gillsOnly.sim.countItem('mudfin_scale', gillsOnly.a)).toBe(2);
    expect(gillsOnly.sim.countItem('rough_hide', gillsOnly.a)).toBe(0);
  });

  it('leaves the corpse harvestable, so the player recovers the yield they nearly threw away', () => {
    withMixedTemplates(() => {
      const { sim, internals, a } = setup(153);
      const template = MOBS[MIXED_TEMPLATE_ID];
      const corpse = createMob(7510, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      const meta = mustPlayer(internals, a);
      expect(grantCorpseHarvestOnMob(sim, corpse, meta, [UNMAPPED_FAMILY])).toBe(false);
      expect(corpse.harvestClaimedBy).toBeNull();
      expect(grantCorpseHarvestOnMob(sim, corpse, meta, ['hide'])).toBe(true);
      expect(corpse.harvestClaimedBy).toBe(a);
      expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
    });
  });

  it('covers every template that mixes mapped and unmapped families: none ships since 11m, so the two retagged widths carry the sweep', () => {
    const mixedTemplates = () =>
      Object.entries(MOBS).filter(([, m]) => {
        const tags = m.componentTags ?? [];
        return (
          tags.some((t) => HARVEST_COMPONENT_ITEMS[t]) &&
          tags.some((t) => !HARVEST_COMPONENT_ITEMS[t])
        );
      });
    expect(mixedTemplates()).toEqual([]);
    const formerlyMixed: Record<string, string> = {
      bogtoad: 'gills',
      deepfen_murloc: 'gills',
      glimmermere_wader: 'gills',
      mudfin_murloc: 'gills',
      sethrael_palecoil: 'horn',
      wildheart_hexcaller: 'horn',
    };
    for (const [id, family] of Object.entries(formerlyMixed)) {
      const tags = expectDefined(MOBS[id].componentTags);
      expect(tags, id).toContain(family);
      expect(
        tags.filter((t) => !HARVEST_COMPONENT_ITEMS[t]),
        id,
      ).toEqual([]);
    }
    const tagged = Object.values(MOBS).filter((m) => (m.componentTags?.length ?? 0) > 0);
    expect(tagged).toHaveLength(54);
    expect(Object.keys(MOBS).length - tagged.length).toBe(188);
    withMixedTemplates(() => {
      const mixed = mixedTemplates();
      expect(mixed.map(([id]) => id).sort()).toEqual(
        [MIXED2_TEMPLATE_ID, MIXED_TEMPLATE_ID].sort(),
      );
      for (const [id, m] of mixed) {
        const tags = expectDefined(m.componentTags);
        const unmapped = tags.filter((t) => !HARVEST_COMPONENT_ITEMS[t]);
        const mapped = tags.filter((t) => HARVEST_COMPONENT_ITEMS[t]);
        for (const pick of [...unmapped.map((t) => [t]), unmapped]) {
          const r = harvest2509(id, pick);
          const label = `${id} ${JSON.stringify(pick)}`;
          expect(r.claimedBy, `${label} claim`).toBeNull();
          expect(r.draws, `${label} draws`).toBe(0);
          expect(r.corpseTimer, `${label} timer`).toBe(9999);
          expect(r.errors, `${label} errors`).toEqual([REFUSAL]);
        }
        const ok = harvest2509(id, mapped);
        expect(ok.claimedBy, `${id} mapped pick`).not.toBeNull();
        expect(ok.errors, `${id} mapped pick errors`).toEqual([]);
      }
    });
  });

  it('does NOT fire on a corpse whose every family is unmapped: the other gate does (#2513)', () => {
    withFixtureTemplates(() => {
      expect(MOBS[UNMAPPED_TEMPLATE_ID].componentTags).toEqual(UNMAPPED_TEMPLATE_TAGS);
      const picks: (string[] | undefined)[] = [
        undefined,
        [],
        [UNMAPPED_FAMILY_2],
        [UNMAPPED_FAMILY],
        [UNMAPPED_FAMILY_2, UNMAPPED_FAMILY],
      ];
      for (const pick of picks) {
        const label = `${UNMAPPED_TEMPLATE_ID} ${JSON.stringify(pick)}`;
        expect(
          forfeitsEveryMappedYield(UNMAPPED_TEMPLATE_TAGS, pick ?? []),
          `${label} predicate`,
        ).toBe(false);
        const r = harvest2509(UNMAPPED_TEMPLATE_ID, pick);
        expect(r.errors, `${label} errors`).toEqual([NOT_HARVESTABLE]);
        expect(r.claimedBy, `${label} claim`).toBeNull();
        expect(r.draws, `${label} draws`).toBe(0);
        expect(r.corpseTimer, `${label} timer`).toBe(9999);
      }
      expect(harvest2509(UNMAPPED_TEMPLATE_ID, [UNMAPPED_FAMILY]).errors).toEqual([
        NOT_HARVESTABLE,
      ]);
      expect(harvest2509(MIXED_TEMPLATE_ID, [UNMAPPED_FAMILY]).errors).toEqual([REFUSAL]);
      expect(NOT_HARVESTABLE).not.toBe(REFUSAL);
    });
  });

  it('refuses driven by `chosen` content alone, not by any town-focus derivation (retires the pre-PR3 default)', () => {
    // Retires the pre-PR3 "an omitted pick derives from meta.townFocus" case:
    // grantCorpseHarvestOnMob takes `chosen` directly and never reads
    // townFocus at all, so there is no live path left that could derive a
    // pick from it. On MIXED_TEMPLATE_ID (hide, claw mapped; UNMAPPED_FAMILY
    // not) an explicit UNMAPPED-ONLY pick still refuses at the pick-level
    // #2509 gate with the claim intact, while an unspecified/empty pick
    // SPREADS across every tag (the mapped ones included) and grants: an
    // all-unmapped corpse refusing on every pick shape, including the
    // derived default, is #2513's own gate and is already fully covered on
    // its dedicated all-unmapped template in that describe below, not
    // repeated here.
    withMixedTemplates(() => {
      const unmappedOnly = harvest2509(MIXED_TEMPLATE_ID, [UNMAPPED_FAMILY], 5);
      expect(unmappedOnly.claimedBy).toBeNull();
      expect(unmappedOnly.draws).toBe(0);
      expect(unmappedOnly.errors).toEqual([REFUSAL]);

      const spread = harvest2509(MIXED_TEMPLATE_ID, undefined, 5);
      expect(spread.claimedBy).not.toBeNull();
      expect(spread.errors).toEqual([]);
      expect(spread.sim.countItem('rough_hide', spread.a)).toBeGreaterThan(0);

      const healthy = harvest2509(MIXED_TEMPLATE_ID, ['hide'], 5);
      expect(healthy.claimedBy).not.toBeNull();
      expect(healthy.errors).toEqual([]);
      expect(healthy.sim.countItem('rough_hide', healthy.a)).toBeGreaterThan(0);
    });
  });

  it('keeps the settled #2504 ruling: an ALL-junk pick still spreads, junk beside an unmapped family still refuses', () => {
    withMixedTemplates(() => {
      const junk = harvest2509(MIXED_TEMPLATE_ID, ['junk']);
      const empty = harvest2509(MIXED_TEMPLATE_ID, []);
      expect(junk.claimedBy).not.toBeNull();
      expect(junk.errors).toEqual([]);
      expect(junk.inventory).toEqual(empty.inventory);
      expect(junk.draws).toBe(empty.draws);
      const unmappedJunk = harvest2509(MIXED_TEMPLATE_ID, [UNMAPPED_FAMILY, 'junk']);
      expect(unmappedJunk.claimedBy).toBeNull();
      expect(unmappedJunk.draws).toBe(0);
      expect(unmappedJunk.errors).toEqual([REFUSAL]);
    });
  });

  it('draws NO rng and moves nothing on the new refusal arm, across every mixed width', () => {
    withMixedTemplates(() => {
      for (const [templateId, pick] of [
        [MIXED2_TEMPLATE_ID, [UNMAPPED_FAMILY_2]],
        [MIXED_TEMPLATE_ID, [UNMAPPED_FAMILY]],
      ] as [string, string[]][]) {
        for (const seed of [2, 5, 11]) {
          const label = `${templateId} ${JSON.stringify(pick)} @${seed}`;
          const r = harvest2509(templateId, pick, seed);
          const never = harvest2509(templateId, ['not_a_tag_at_all'], seed);
          const untouched = harvest2509(templateId, undefined, seed);
          expect(r.draws, `${label} draws`).toBe(0);
          expect(r.claimedBy, `${label} claim`).toBeNull();
          expect(r.corpseTimer, `${label} timer`).toBe(9999);
          expect(r.inventory, `${label} inventory`).toEqual(r.before);
          expect(never.claimedBy, `${label} junk control claim`).not.toBeNull();
          expect(never.draws, `${label} junk control draws`).toBeGreaterThan(0);
          expect(untouched.claimedBy, `${label} omitted control claim`).not.toBeNull();
        }
      }
    });
  });
});

// #2513: the corpse-level half of the same class. Its shipped fixture was
// fen_troll, whose claw and tusk tags HARVEST_COMPONENT_ITEMS mapped NEITHER
// at the time, so it was the one shipped template on which no pick could
// ever have paid out. #2509's pick-level refusal deliberately left it alone
// (nothing is forfeited when nothing was on offer), which left the original
// harm standing: it advertised itself as harvestable, took the command,
// spent the single-use claim, drew one tier roll per effective family,
// granted nothing and emitted NOTHING AT ALL.
//
// The fix answers the corpse-level question honestly instead of reporting the
// dead end: isHarvestableCorpse reads the MAPPED families a template carries,
// so this corpse takes the same path as the 101 templates that carry no
// component tags at all. claw and tusk have since joined
// HARVEST_COMPONENT_ITEMS themselves (#2905), and gills and horn after them
// (Masterwrought Phase 11m), so fen_troll is fully mapped and no shipped
// template carries an unmapped family at all any more: this whole describe
// drives the gate through the synthetic UNMAPPED_TEMPLATE_ID (see
// withUnmappedTemplate above the #1141 describe) instead of fen_troll, and
// its mixed contrasts through the retagged MIXED_TEMPLATE_ID. The old
// "an omitted pick derives from town focus" case is retired the same way as
// #2509's: this gate refuses on the corpse alone, before any pick (derived
// or explicit) is even consulted, which the "preempts" case below still
// states, narrowed to the claim-order half that survives (grantCorpseHarvest
// has no range concept at all; that admission gate is
// tests/corpse_harvest_cast.test.ts's).
describe('a corpse whose EVERY family is unmapped is never offered a harvest (#2513)', () => {
  const harvestAt = (
    templateId: string,
    components: string[] | undefined,
    seed = 5,
    arrange?: (rig: ReturnType<typeof setup>, corpse: Entity) => void,
  ) => grantCommand(templateId, components, { seed, corpseId: 7513, arrange });

  const harvest2513 = (
    components: string[] | undefined,
    seed = 5,
    arrange?: (rig: ReturnType<typeof setup>, corpse: Entity) => void,
  ) => withUnmappedTemplate(() => harvestAt(UNMAPPED_TEMPLATE_ID, components, seed, arrange));

  const NOT_HARVESTABLE = 'That corpse has nothing to harvest.';
  const PICK_REFUSAL = 'Nothing you selected can be harvested from that corpse.';

  it('is about a template the content really leaves fully unmapped, derived not listed', () => {
    const allUnmapped = Object.entries(MOBS)
      .filter(([, m]) => (m.componentTags?.length ?? 0) > 0)
      .filter(([, m]) => !m.componentTags?.some((t) => HARVEST_COMPONENT_ITEMS[t]))
      .map(([id]) => id);
    expect(allUnmapped).toEqual([]);
    withUnmappedTemplate(() => {
      expect(MOBS[UNMAPPED_TEMPLATE_ID].componentTags).toEqual(UNMAPPED_TEMPLATE_TAGS);
      expect(isHarvestableCorpse(MOBS[UNMAPPED_TEMPLATE_ID].componentTags)).toBe(false);
    });
    expect(MOBS.wild_boar.componentTags).toEqual(['hide', 'tusk', 'meat']);
    expect(isHarvestableCorpse(MOBS.wild_boar.componentTags)).toBe(true);
  });

  it('refuses every pick shape, pre-claim and rng-free, and says so exactly once', () => {
    const picks: (string[] | undefined)[] = [
      undefined,
      [],
      [UNMAPPED_FAMILY],
      [UNMAPPED_FAMILY_2],
      [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2],
    ];
    for (const pick of picks) {
      const label = `${UNMAPPED_TEMPLATE_ID} ${JSON.stringify(pick)}`;
      const r = harvest2513(pick);
      expect(r.errors, `${label} errors`).toEqual([NOT_HARVESTABLE]);
      expect(
        r.events.map((e) => e.type),
        `${label} events`,
      ).toEqual(['error']);
      expect(r.claimedBy, `${label} claim`).toBeNull();
      expect(r.draws, `${label} draws`).toBe(0);
      expect(r.corpseTimer, `${label} timer`).toBe(9999);
      expect(r.inventory, `${label} inventory`).toEqual(r.before);
    }
  });

  it('holds across seeds, which is a statement about the gate reading no rng state', () => {
    for (const seed of [2, 5, 11]) {
      const r = harvest2513(undefined, seed);
      expect(r.draws, `@${seed} draws`).toBe(0);
      expect(r.claimedBy, `@${seed} claim`).toBeNull();
      expect(r.corpseTimer, `@${seed} timer`).toBe(9999);
      expect(r.errors, `@${seed} errors`).toEqual([NOT_HARVESTABLE]);
    }
  });

  it('preempts the already-claimed refusal, which is a message change', () => {
    // Gate ORDER, pinned because the diff changed which message a player
    // gets: the corpse-level gate sits above the claim resolve, so on an
    // all-unmapped corpse a second-comer used to say "This corpse has
    // already been harvested." and now says the corpse has nothing to
    // harvest, the more useful of the two (the claim is not the reason it
    // will never work). The discriminator: on a HARVESTABLE corpse the claim
    // gate still owns its own message, so this is precedence on one
    // template and not the corpse gate swallowing the other.
    const claimed = harvest2513(undefined, 5, (rig, corpse) => {
      corpse.harvestClaimedBy = rig.b;
    });
    expect(claimed.errors).toEqual([NOT_HARVESTABLE]);
    expect(claimed.draws).toBe(0);
    const claimedWolf = harvestAt('forest_wolf', undefined, 5, (rig, corpse) => {
      corpse.harvestClaimedBy = rig.b;
    });
    expect(claimedWolf.errors).toEqual(['This corpse has already been harvested.']);
  });

  it('leaves the sim IDENTICAL to the command never being issued', () => {
    withUnmappedTemplate(() => {
      const issued = harvestAt(UNMAPPED_TEMPLATE_ID, [UNMAPPED_FAMILY], 5);
      const { sim: quiet, internals: quietInternals, a: quietA } = setup(5);
      const template = MOBS[UNMAPPED_TEMPLATE_ID];
      const corpse = createMob(7513, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      quietInternals.entities.set(corpse.id, corpse);
      quiet.drainEvents();
      expect(issued.inventory).toEqual(mustPlayer(quietInternals, quietA).inventory);
      expect(issued.corpse.harvestClaimedBy).toBe(corpse.harvestClaimedBy);
      expect(issued.corpse.corpseTimer).toBe(corpse.corpseTimer);
      // Same rng stream position: the next draw either world takes is the same
      // one. A refusal that drew anything would desync exactly here.
      expect(issued.sim.rng.next()).toBe(quiet.rng.next());
    });
  });

  it('is a corpse-level gate, so the pick-level #2509 rule is untouched', () => {
    for (const pick of [
      [],
      [UNMAPPED_FAMILY],
      [UNMAPPED_FAMILY_2],
      [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2],
    ]) {
      expect(forfeitsEveryMappedYield(UNMAPPED_TEMPLATE_TAGS, pick), JSON.stringify(pick)).toBe(
        false,
      );
    }
    expect(forfeitsEveryMappedYield(MIXED_TEMPLATE_TAGS, [UNMAPPED_FAMILY])).toBe(true);
    withMixedTemplates(() => {
      expect(harvestAt(MIXED_TEMPLATE_ID, [UNMAPPED_FAMILY]).errors).toEqual([PICK_REFUSAL]);
    });
    expect(harvest2513([UNMAPPED_FAMILY]).errors).toEqual([NOT_HARVESTABLE]);
  });

  it('every command that spends the claim reports at least one yield', () => {
    // The #2457 "granted path only" contract in src/sim/types.ts used to be
    // pinned by fen_troll alone; #2513 makes its FALSE arm unreachable.
    // Rather than leave the contract asserted by nothing, state it as the
    // property it now is, swept over every shipped template and every
    // subset of its tags.
    const sweep = (ids: readonly string[]) => {
      let spent = 0;
      let refused = 0;
      for (const id of ids) {
        const tags = MOBS[id].componentTags;
        if (!tags?.length) continue;
        for (let mask = 0; mask < 1 << tags.length; mask++) {
          const selected = tags.filter((_, i) => mask & (1 << i));
          const label = `${id} ${JSON.stringify(selected)}`;
          const r = harvestAt(id, selected);
          const results = r.events.filter(
            (e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult',
          );
          if (r.claimedBy === null) {
            refused++;
            expect(results, `${label} refused emits no ledger`).toHaveLength(0);
            continue;
          }
          spent++;
          expect(results, `${label} one ledger event`).toHaveLength(1);
          expect(results[0].yields.length, `${label} non-empty ledger`).toBeGreaterThan(0);
          for (const y of results[0].yields) {
            expect(y.qty, `${label} ${y.itemId} qty`).toBeGreaterThan(0);
          }
        }
      }
      return { spent, refused };
    };
    // The shipped corpus: every subset of every tagged template. Exact totals
    // are pinned against the shipped catalog, not derived, so a template that
    // gains or loses a mapped tag moves one of them.
    expect(sweep(Object.keys(MOBS))).toEqual({ spent: 266, refused: 0 });
    // Both arms still have to be visited, so neither half of the property is
    // vacuous: the refused arm is driven through the three retagged fixtures.
    const fixtures = withFixtureTemplates(() =>
      sweep([UNMAPPED_TEMPLATE_ID, MIXED_TEMPLATE_ID, MIXED2_TEMPLATE_ID]),
    );
    expect(fixtures).toEqual({ spent: 10, refused: 6 });
  });

  // The ten mapped families and their item ids, spelled out. Deriving them
  // from HARVEST_COMPONENT_ITEMS would compare the table with itself and pass
  // against an empty one; this is the tests/gathering.test.ts idiom.
  const EXPECTED_FAMILY_ITEMS: Record<string, string> = {
    hide: 'rough_hide',
    fang: 'wolf_fang',
    silk: 'spider_silk',
    venomSac: 'venom_gland',
    meat: 'game_meat',
    cloth: 'homespun_cloth',
    claw: 'sharp_claw',
    tusk: 'curved_tusk',
    horn: 'curved_tusk',
    gills: 'mudfin_scale',
  };

  it('every family a harvest extracts has an item behind it (#2514)', () => {
    const sweep = (ids: readonly string[]) => {
      let extracted = 0;
      let unmappedOffered = 0;
      for (const id of ids) {
        const tags = MOBS[id].componentTags;
        if (!tags?.length) continue;
        const mapped = tags.filter((t) => harvestFamilyYieldsItem(t));
        for (let mask = 0; mask < 1 << tags.length; mask++) {
          const selected = tags.filter((_, i) => mask & (1 << i));
          const label = `${id} ${JSON.stringify(selected)}`;
          if (selected.some((t) => !harvestFamilyYieldsItem(t))) unmappedOffered++;
          const expectedSet = yieldingFocusComponents(tags, selected);
          for (const family of expectedSet) {
            expect(harvestItemForFamily(family), `${label} ${family}`).toBe(
              EXPECTED_FAMILY_ITEMS[family],
            );
          }
          const r = harvestAt(id, selected);
          if (r.claimedBy === null) continue;
          extracted += expectedSet.length;
          expect(r.draws, `${label} draws`).toBe(2 * expectedSet.length);
          const results = r.events.filter(
            (e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult',
          );
          const component = results[0].yields
            .filter((y) => y.kind !== 'specimen')
            .map((y) => y.itemId);
          expect(new Set(component), `${label} component ids`).toEqual(
            new Set(expectedSet.map((f) => EXPECTED_FAMILY_ITEMS[f])),
          );
          expect(expectedSet.length, `${label} extracted <= mapped`).toBeLessThanOrEqual(
            mapped.length,
          );
        }
      }
      return { extracted, unmappedOffered };
    };
    expect(sweep(Object.keys(MOBS))).toEqual({ extracted: 447, unmappedOffered: 0 });
    const fixtures = withFixtureTemplates(() =>
      sweep([UNMAPPED_TEMPLATE_ID, MIXED_TEMPLATE_ID, MIXED2_TEMPLATE_ID]),
    );
    expect(fixtures).toEqual({ extracted: 13, unmappedOffered: 9 });
  });

  it('keeps every mixed template harvestable, so the gate is not a blanket refusal', () => {
    const mixedTemplates = () =>
      Object.entries(MOBS).filter(([, m]) => {
        const tags = m.componentTags ?? [];
        return (
          tags.some((t) => HARVEST_COMPONENT_ITEMS[t]) &&
          tags.some((t) => !HARVEST_COMPONENT_ITEMS[t])
        );
      });
    expect(mixedTemplates()).toEqual([]);
    withMixedTemplates(() => {
      const mixed = mixedTemplates();
      expect(mixed).toHaveLength(2);
      for (const [id, m] of mixed) {
        const mapped = m.componentTags?.filter((t) => HARVEST_COMPONENT_ITEMS[t]);
        const r = harvestAt(id, mapped);
        expect(r.errors, `${id} errors`).toEqual([]);
        expect(r.claimedBy, `${id} claim`).not.toBeNull();
        expect(r.draws, `${id} draws`).toBeGreaterThan(0);
        expect(r.inventory.length, `${id} inventory`).toBeGreaterThan(r.before.length);
      }
    });
    expect(MOBS.warlock_imp.componentTags).toBeUndefined();
    expect(harvestAt('warlock_imp', undefined).errors).toEqual([NOT_HARVESTABLE]);
  });
});

// The concentration bonus on a mixed corpse, before and after #2514 moved it,
// as literals measured against a real Sim at seed 31. old_greyjaw (hide,
// fang, claw) was this block's fixture; claw was mapped at #2905, which made
// old_greyjaw fully mapped and retired it. sethrael_palecoil (hide, claw,
// horn) took its place until Masterwrought Phase 11m mapped horn (and gave
// the serpent venomSac), which retired it the same way. The same three-tag
// shape is now retagged onto MIXED_TEMPLATE_ID with the synthetic family in
// horn's slot: claw plays the second-mapped-family role fang used to. The
// serpent itself is pinned at the end of the block as the all-mapped corpse
// it is today, on the same seed, which is where "self-healing" is measured.
describe('the concentration bonus on a mixed corpse, moved on purpose (#2514)', () => {
  function yieldAt(templateId: string, components: string[] | undefined) {
    const { sim, internals, a } = setup(30);
    const template = MOBS[templateId];
    const corpse = createMob(7511, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    const meta = mustPlayer(internals, a);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    grantCorpseHarvestOnMob(sim, corpse, meta, components);
    sim.rng.setObserver(null);
    sim.drainEvents();
    return {
      draws,
      hide: sim.countItem('rough_hide', a),
      claw: sim.countItem('sharp_claw', a),
      pristine: sim.countItem('pristine_hide', a),
      claimedBy: corpse.harvestClaimedBy,
    };
  }
  const yieldOf = (components: string[] | undefined) =>
    withMixedTemplates(() => yieldAt(MIXED_TEMPLATE_ID, components));

  const CASES: {
    pick: string[] | undefined;
    draws: number;
    hide: number;
    claw: number;
    pristine: number;
  }[] = [
    // The default harvest: two of the three tags are mapped (hide, claw), so
    // the widest pick this corpse offers is 2 of 3 at bonus 1.
    { pick: undefined, draws: 4, hide: 2, claw: 5, pristine: 0 },
    { pick: [], draws: 4, hide: 2, claw: 5, pristine: 0 },
    { pick: ['hide', 'claw', UNMAPPED_FAMILY], draws: 4, hide: 2, claw: 5, pristine: 0 },
    { pick: ['hide', 'claw'], draws: 4, hide: 2, claw: 5, pristine: 0 },
    // Concentrate on one mapped family: bonus 2, and the extra tier shift is
    // what lands the signed pristine_hide.
    { pick: ['hide'], draws: 2, hide: 3, claw: 0, pristine: 1 },
    // Ticking the unmapped box beside Hide costs nothing at all.
    { pick: ['hide', UNMAPPED_FAMILY], draws: 2, hide: 3, claw: 0, pristine: 1 },
  ];

  for (const c of CASES) {
    it(`${JSON.stringify(c.pick)} yields the #2514 numbers`, () => {
      const r = yieldOf(c.pick);
      expect(r.claimedBy).not.toBeNull();
      expect(r.draws).toBe(c.draws);
      expect(r.hide).toBe(c.hide);
      expect(r.claw).toBe(c.claw);
      expect(r.pristine).toBe(c.pristine);
    });
  }

  it('the full cover, the empty pick and the mapped-only cover land one identical world', () => {
    expect(yieldOf(['hide', 'claw', UNMAPPED_FAMILY])).toEqual(yieldOf([]));
    expect(yieldOf(['hide', 'claw'])).toEqual(yieldOf([]));
    expect(yieldOf(['hide', UNMAPPED_FAMILY])).toEqual(yieldOf(['hide']));
    expect(yieldOf(['hide'])).not.toEqual(yieldOf([]));
  });

  it('is self-healing on the shipped serpent: horn mapped, the same seed rolls the bonus-0 spread', () => {
    expect(MOBS.sethrael_palecoil.componentTags).toEqual(['hide', 'claw', 'horn', 'venomSac']);
    const serpent = yieldAt('sethrael_palecoil', undefined);
    expect(serpent.claimedBy).not.toBeNull();
    expect(serpent.draws).toBe(8);
    expect(serpent.hide).toBe(1);
    expect(serpent.claw).toBe(4);
    expect(serpent.pristine).toBe(0);
    const { sim, internals, a } = setup(30);
    const template = MOBS.sethrael_palecoil;
    const corpse = createMob(7511, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    grantCorpseHarvestOnMob(sim, corpse, mustPlayer(internals, a), undefined);
    expect(sim.countItem('curved_tusk', a)).toBe(2);
    expect(sim.countItem('venom_gland', a)).toBe(4);
    const hornOnly = yieldAt('sethrael_palecoil', ['horn']);
    expect(hornOnly.claimedBy).not.toBeNull();
    expect(hornOnly.draws).toBe(2);
    expect(hornOnly.hide).toBe(0);
    expect(yieldOf([UNMAPPED_FAMILY]).claimedBy).toBeNull();
  });

  it('moves on the TWO-tag mixed corpse too, where the bonus arithmetic differs', () => {
    const shape = (templateId: string, components: string[] | undefined) => {
      const { sim, internals, a } = setup(31);
      const template = MOBS[templateId];
      const corpse = createMob(7512, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      const meta = mustPlayer(internals, a);
      let draws = 0;
      sim.rng.setObserver(() => {
        draws++;
      });
      grantCorpseHarvestOnMob(sim, corpse, meta, components);
      sim.rng.setObserver(null);
      sim.drainEvents();
      return {
        draws,
        hide: sim.countItem('rough_hide', a),
        pristine: sim.countItem('pristine_hide', a),
        scale: sim.countItem('mudfin_scale', a),
        claimedByHarvester: corpse.harvestClaimedBy === a,
      };
    };
    const boar = (components: string[] | undefined) =>
      withMixedTemplates(() => shape(MIXED2_TEMPLATE_ID, components));
    withMixedTemplates(() => {
      expect(MOBS[MIXED2_TEMPLATE_ID].componentTags).toEqual([UNMAPPED_FAMILY_2, 'hide']);
    });

    const concentrate = { draws: 2, hide: 3, pristine: 1, scale: 0, claimedByHarvester: true };
    expect(boar(undefined)).toEqual(concentrate);
    expect(boar([UNMAPPED_FAMILY_2, 'hide'])).toEqual(boar([]));
    expect(boar(['hide'])).toEqual(concentrate);
    expect(boar(['hide'])).toEqual(boar(undefined));
    expect(boar([UNMAPPED_FAMILY_2])).toEqual({
      draws: 0,
      hide: 0,
      pristine: 0,
      scale: 0,
      claimedByHarvester: false,
    });
    expect(MOBS.mudfin_murloc.componentTags).toEqual(['gills', 'hide']);
    const murloc = shape('mudfin_murloc', undefined);
    expect(murloc).toEqual({ draws: 4, hide: 4, pristine: 0, scale: 2, claimedByHarvester: true });
    const gillsOnly = shape('mudfin_murloc', ['gills']);
    expect(gillsOnly.claimedByHarvester).toBe(true);
    expect(gillsOnly.draws).toBe(2);
    expect(gillsOnly.hide).toBe(0);
    expect(gillsOnly.scale).toBe(3);
    expect(shape('mudfin_murloc', ['hide'])).toEqual({
      draws: 2,
      hide: 3,
      pristine: 1,
      scale: 0,
      claimedByHarvester: true,
    });
  });
});
