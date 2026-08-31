// Materials Vault CONSERVATION, proved by property-based testing rather than
// by targeted attack. The VAULT SIBLING of tests/audit_conservation_property.ts
// (which is guild-shaped end to end and passes characters: [] to auditBank, so
// the audit's C2 vault reconciliation had ZERO fuzz coverage before this file).
//
// The claim under test, over any generated sequence of vault ops:
//
//   1. CONSERVATION. For every material id, carried(bags) + vault stock +
//      consumed-by-craft is constant across the run. The consumed term is
//      CLOSED FORM (the recipe's own reagent counts times the number of crafts
//      that completed), never a tally of what the harness watched leave: the
//      addPurgeBurn doctrine from the guild file, for the same reason (a tally
//      of observed movement cannot disagree with observed movement). Copper is
//      conserved modulo two sinks, both closed form as well: the ladder burn a
//      vault's rung PROVES was paid, derived from state.upgrades, and the
//      per-craft gold fee.
//   2. FAILURE IS A NO-OP. Every refusal is PREDICTED from pre-op state, and
//      the bags, the vault, and the purse must all be byte-identical after it.
//      Predicting first is what makes this a property rather than a
//      restatement: the server's own success signal for a vault op is the
//      before/after diff, so "it did not move, therefore it was refused" would
//      prove nothing at all.
//   3. AUDIT CLEAN. scripts/bank_audit.mjs, over the rows the REAL recorders
//      wrote plus the character's REAL persisted vault slice, returns ZERO
//      findings for every seed. This is the point of the file: the C2
//      reconciliation replaying deposit / withdraw / buy_slots / craft_consume
//      rows against final state must converge exactly.
//   4. ROW SHAPE. Every craft_consume row carries container 'vault', a null
//      instance, copper_delta 0, a positive integer count, and the rung the
//      vault stood at when the craft consumed.
//
// Deliberately SIMPLER than the guild file: vault state lives inside the
// character blob, so there is no escrow, no lease fence, and no async save
// lane to race. What replaces that machinery here is the CRAFT, which consumes
// vault stock several ticks after its command and is therefore recorded from a
// sim event rather than a dispatch bracket.
//
// The world drives the offline Sim directly and reproduces the server's
// dispatch idiom (server/game.ts): each vault COMMAND is bracketed with
// sim.vaultInfoFor(pid) snapshots handed to recordVaultOp, and craft
// consumption rides the SAME admission seam production wires
// (SimConfig.vaultConsumptionAdmission over a REAL bank_ledger_session
// journal for this owner, the server/sim_boot_config.ts shape), so the sim's
// craft path itself reserves and commits through the code the live server
// runs; each craft step then drains the journal outbox's committed batches
// into the audit row stream. It never ticks: nothing here needs the clock,
// and a still world keeps the banker standing where it was put.
//
// Prices, caps, reagents, and the gold fee are LITERALS, never reads of the
// tables they check (the tests/materials_vault.test.ts discipline). The
// premise block below pins each literal against content, so a re-spec fails
// loudly there instead of silently agreeing with itself everywhere.

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The ledger sink. Postgres is mocked (hoisted above the server/bank_ledger
// import) exactly like tests/bank_ledger.test.ts, with the two writers
// collecting every inserted row in order under ascending ids and the
// snake_case column names scripts/bank_audit.mjs reads.
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  let nextId = 0;
  const push = (row: Record<string, unknown>): void => {
    nextId += 1;
    rows.push({
      id: nextId,
      realm: row.realm,
      character_id: row.characterId,
      account_id: row.accountId,
      op: row.op,
      item_id: row.itemId ?? null,
      count: row.count ?? null,
      instance: row.instance ?? null,
      copper_delta: row.copperDelta,
      purchased_slots_after: row.purchasedSlotsAfter,
      container: row.container,
      container_id: row.containerId ?? null,
    });
  };
  return {
    rows,
    push,
    reset(): void {
      rows.length = 0;
      nextId = 0;
    },
    insertBankLedgerRow: vi.fn(async (row: Record<string, unknown>) => {
      push(row);
    }),
    insertBankLedgerRows: vi.fn(async (batch: Record<string, unknown>[]) => {
      for (const row of batch) push(row);
    }),
  };
});

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  insertBankLedgerRow: store.insertBankLedgerRow,
  insertBankLedgerRows: store.insertBankLedgerRows,
  loadGuildBankLogRows: vi.fn(async () => []),
}));

import { auditBank, type BankLedgerAuditRow } from '../scripts/bank_audit.mjs';
import { bankLedgerIdle, recordVaultOp } from '../server/bank_ledger';
import {
  type BankLedgerSessionJournal,
  createBankLedgerSessionJournal,
} from '../server/bank_ledger_session';
import { REALM } from '../server/realm';
import { bagCapacity } from '../src/sim/bags';
import { CRAFT_GOLD_SINK_COPPER_PER_BUDGET } from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  VAULT_BASE_CAP,
  VAULT_UPGRADE_PRICES,
  VAULT_UPGRADE_STEP,
  vaultMaterialIds,
} from '../src/sim/materials_vault';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type {
  Entity,
  InvSlot,
  SimEvent,
  VaultConsumptionAdmission,
  WorldContent,
} from '../src/sim/types';
import { completeCraftCast } from './helpers/enchant_family_cast';

// ---------------------------------------------------------------------------
// The fixture, pinned as literals. Everything the oracle computes is derived
// from THESE, never from the tables they mirror; the premise block asserts the
// two agree.
// ---------------------------------------------------------------------------
const CHARACTER_ID = 7;
const WHO = { characterId: CHARACTER_ID, accountId: CHARACTER_ID };

// ---------------------------------------------------------------------------
// The craft-consumption admission: the PRODUCTION seam, wired the way the
// server does (server/sim_boot_config.ts passes SimConfig's admission through;
// server/game.ts builds it over the session's createBankLedgerSessionJournal).
// The Sim is constructed once per world (and ONCE for the whole reused sweep
// world), so the admission indirects through the active world's journal.
// ---------------------------------------------------------------------------
let activeWorldJournal: BankLedgerSessionJournal | null = null;
const SWEEP_VAULT_ADMISSION: VaultConsumptionAdmission = (_pid, takes, upgrades) => {
  if (!activeWorldJournal) throw new Error('vault admission called with no active journal');
  return activeWorldJournal.reserveVaultConsumption(takes, upgrades);
};

/** One Gilded Strongbox bursar and no ambient life: Sim construction would
 *  otherwise dominate a several-hundred-seed sweep (the trimmed world
 *  tests/materials_vault.test.ts builds, for the same reason). */
const BANKER = 'bursar_fernando';
const VAULT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER]: BUILTIN_WORLD.npcs[BANKER] },
  groundObjects: [],
};

/** Field-castable (no stationType), skillReq 0, and its three reagents are all
 *  vault-eligible materials: the one recipe that can be driven anywhere in a
 *  generated sequence without a station or a trained profession. */
const RECIPE = 'recipe_eastbrook_arming_sword';
const OUTPUT = 'eastbrook_arming_sword';
const REAGENTS: readonly { itemId: string; count: number }[] = [
  { itemId: 'wolf_fang', count: 2 },
  { itemId: 'bone_fragments', count: 4 },
  { itemId: 'smithing_flux', count: 6 },
];
/** ceil(itemLevelBudget 10 * CRAFT_GOLD_SINK_COPPER_PER_BUDGET 2). */
const CRAFT_GOLD_FEE = 20;
/** A material NO craft here consumes, so its stock only ever moves through the
 *  vault's own ops: the arm that proves a craft never reaches past its recipe. */
const INERT_MATERIAL = 'copper_ore';
const MATERIALS: readonly string[] = [
  'wolf_fang',
  'bone_fragments',
  'smithing_flux',
  INERT_MATERIAL,
];
/** The five-rung ladder and the per-material ceiling each rung grants. */
const PRICES: readonly number[] = [20000, 50000, 100000, 200000, 400000];
const CAPS: readonly number[] = [40, 80, 120, 160, 200];
/** Comfortably above the whole ladder (770000) plus every fee a run can pay,
 *  so the gold sink's Math.max(0, ...) floor never clamps and the closed-form
 *  fee term stays exact. The craft step asserts the headroom rather than
 *  trusting this number. */
const START_COPPER = 2_000_000;
/** Carried units per material are held under this, so the pack can never fill:
 *  a full pack would deny a craft for space, which the materials oracle does
 *  not model. The craft step counts any space denial and the floor requires it
 *  to be zero. */
const CARRY_CEILING = 40;

const REQUIRED_BY_ID = new Map(REAGENTS.map((r) => [r.itemId, r.count]));
const requiredFor = (itemId: string): number => REQUIRED_BY_ID.get(itemId) ?? 0;

/** The per-material ceiling a rung count grants: 0 while locked. */
const capFor = (upgrades: number): number => (upgrades <= 0 ? 0 : CAPS[upgrades - 1]);

/** The copper a vault's rung position PROVES was burned. Derived from STATE,
 *  never tallied as the harness watches purchases go by (the addPurgeBurn
 *  doctrine): a tally would only ever restate what it just observed. */
function ladderBurn(upgrades: number): number {
  let sum = 0;
  for (let i = 0; i < upgrades; i++) sum += PRICES[i];
  return sum;
}

// ---------------------------------------------------------------------------
// Seeded, reproducible randomness for the HARNESS (never sim randomness: the
// vault module draws no rng at all, and the craft's own draws are the sim's).
// mulberry32; the seed is printed on every failure so a break replays exactly.
// ---------------------------------------------------------------------------
function rngFor(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The op alphabet. Picks are stored as raw [0,1) draws and resolved against
// live state at execution time, so a sequence stays meaningful whatever the
// steps before it left behind.
// ---------------------------------------------------------------------------
type Step =
  | { k: 'grant'; which: number; amt: number }
  /** `hunt` is a COVERAGE BIAS, never a property restriction: it aims the slot
   *  pick at a material whose remaining headroom would TRUNCATE the deposit,
   *  so the partial-fill arm is reached on purpose instead of by luck (a
   *  uniform pick reaches it about never, because the sweep drives every
   *  material to exactly its ceiling or to nothing). The oracle judges a hunted
   *  deposit by the identical rules; only the state it visits changes. */
  | { k: 'deposit'; pick: number; whole: boolean; cnt: number; hunt: boolean }
  | { k: 'withdraw'; pick: number; whole: boolean; cnt: number }
  | { k: 'deposit_all' }
  | { k: 'buy' }
  | { k: 'craft' };

/** The op alphabet, WEIGHTED and split in two PHASES, for coverage alone. Every
 *  op stays reachable at every point and the oracle is identical throughout;
 *  only how often each is drawn changes.
 *
 *  The two phases exist because a rung purchase widens every ceiling by 40, so
 *  the two ends of the ladder cannot both be exercised at one buy rate. The
 *  FRONT half buys rarely, so the vault spends its time pressed against a tight
 *  ceiling, which is where the partial fill and the no-headroom refusal live.
 *  The BACK half buys often, so the ladder tops out and the at-cap refusal is
 *  reached. A uniform draw reaches one or the other, never both. */
const EARLY_WEIGHTS: readonly [Step['k'], number][] = [
  ['grant', 4],
  ['deposit', 5],
  ['withdraw', 3],
  ['deposit_all', 2],
  ['buy', 1],
  ['craft', 3],
];
const LATE_WEIGHTS: readonly [Step['k'], number][] = [
  ['grant', 3],
  ['deposit', 3],
  ['withdraw', 3],
  ['deposit_all', 2],
  ['buy', 4],
  ['craft', 3],
];
const expand = (weights: readonly [Step['k'], number][]): Step['k'][] =>
  weights.flatMap(([k, weight]) => Array.from({ length: weight }, () => k));
const EARLY_KINDS = expand(EARLY_WEIGHTS);
const LATE_KINDS = expand(LATE_WEIGHTS);

function genSteps(seed: number): Step[] {
  const rnd = rngFor(seed);
  // Vary the depth with the seed so a sweep covers short and long sequences
  // rather than one fixed length.
  const depth = 30 + (seed % 31);
  const steps: Step[] = [];
  for (let i = 0; i < depth; i++) {
    const alphabet = i < depth / 2 ? EARLY_KINDS : LATE_KINDS;
    const k = alphabet[Math.floor(rnd() * alphabet.length)];
    switch (k) {
      case 'grant':
        steps.push({
          k,
          which: Math.floor(rnd() * MATERIALS.length),
          amt: 8 + Math.floor(rnd() * 24),
        });
        break;
      case 'deposit':
        steps.push({
          k,
          pick: rnd(),
          whole: rnd() < 0.5,
          cnt: 1 + Math.floor(rnd() * 24),
          hunt: rnd() < 0.4,
        });
        break;
      case 'withdraw':
        steps.push({ k, pick: rnd(), whole: rnd() < 0.4, cnt: 1 + Math.floor(rnd() * 24) });
        break;
      default:
        steps.push({ k } as Step);
        break;
    }
  }
  return steps;
}

function fmtStep(s: Step): string {
  switch (s.k) {
    case 'grant':
      return `grant(${MATERIALS[s.which]}, ${s.amt})`;
    case 'deposit':
      return `deposit(${s.hunt ? 'hunt' : `pick=${s.pick.toFixed(3)}`}, ${s.whole ? 'whole' : `cnt=${s.cnt}`})`;
    case 'withdraw':
      return `withdraw(pick=${s.pick.toFixed(3)}, ${s.whole ? 'whole' : `cnt=${s.cnt}`})`;
    default:
      return s.k;
  }
}

const fmtSteps = (steps: Step[]): string => steps.map((s, i) => `  ${i}. ${fmtStep(s)}`).join('\n');

// ---------------------------------------------------------------------------
// Coverage. A passing property is only as strong as the state it reached, so
// the sweep REPORTS what it exercised and the tail holds a floor under it.
// Every two-arm pair needs BOTH arms: a sweep where every craft was refused
// would prove nothing about consumption.
// ---------------------------------------------------------------------------
const coverage = {
  runs: 0,
  steps: 0,
  /** Off while a scenario below drives steps by hand, so the floor stays a
   *  statement about what the SWEEP reached and cannot be satisfied by a
   *  fixture that hand-picked the arm. */
  enabled: true,
  arms: new Map<string, number>(),
  bump(key: string, by = 1): void {
    if (!this.enabled) return;
    this.arms.set(key, (this.arms.get(key) ?? 0) + by);
  },
  count(key: string): number {
    return this.arms.get(key) ?? 0;
  },
  render(): string {
    return [...this.arms.entries()]
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
  },
};

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------
interface World {
  sim: Sim;
  pid: number;
  /** Materials injected into the bags so far, per id: the SOURCE term of the
   *  conservation identity. Measured as the bags' observed gain rather than
   *  the amount asked for, because the grant is the harness's injection, not
   *  the system under test (a partially landed grant is not a vault defect). */
  granted: Map<string, number>;
  /** Crafts whose craftResult reported ok: the multiplier on the closed-form
   *  consumption term. Taken from the sim's own result event, never inferred
   *  from the movement the property is about to check. */
  crafted: number;
  /** Outputs the craft step vendored away to keep the pack from filling. The
   *  mint is counted the moment it happens, so conservation still accounts for
   *  every sword a craft ever produced. */
  craftedOutputsRemoved: number;
  /** Every craft_consume row this run expects, taken from the sim's own
   *  vaultCraftConsume events (the expectation source stays in the sim). */
  expectedConsume: { itemId: string; count: number; rung: number }[];
  /** The REAL reservation journal this world's Sim reserves and commits
   *  through; its outbox is drained into the store after every craft. */
  journal: BankLedgerSessionJournal;
  /** Journal hook failures. Any entry fails the step that produced it. */
  journalFailures: string[];
}

function entityOf(sim: Sim, pid: number): Entity {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  return e;
}

function metaOf(sim: Sim, pid: number) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing meta ${pid}`);
  return meta;
}

/** Stand the player on the bursar and rebucket, so nearBanker sees them for
 *  the whole run: vaultInfoFor returns null away from a banker, and the
 *  recordVaultOp brackets would then see two nulls and write nothing. */
function moveToBanker(sim: Sim, pid: number): void {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === BANKER) {
      const p = entityOf(sim, pid);
      p.pos = { ...e.pos };
      p.prevPos = { ...p.pos };
      sim.rebucket(p);
      return;
    }
  }
  throw new Error('no banker NPC spawned in the trimmed world');
}

function makeWorld(seed: number, reusableSim?: Sim): World {
  store.reset();
  const journalFailures: string[] = [];
  const journal = createBankLedgerSessionJournal(
    { realm: REALM, characterId: CHARACTER_ID, accountId: CHARACTER_ID },
    {
      onProjectionFailure: (error, surface) => {
        journalFailures.push(`journal projection failure on ${surface}: ${String(error)}`);
      },
      onReservationFailure: (error) => {
        journalFailures.push(`journal reservation failure: ${String(error)}`);
      },
    },
  );
  activeWorldJournal = journal;
  const sim =
    reusableSim ??
    new Sim({
      seed,
      playerClass: 'warrior',
      autoEquip: false,
      noPlayer: true,
      world: VAULT_TEST_WORLD,
      vaultConsumptionAdmission: SWEEP_VAULT_ADMISSION,
    });
  // Reusing the expensive static world must not reuse a prior run's random
  // stream. The property still gets the exact per-seed Sim RNG it had when it
  // constructed a whole world for every case.
  sim.rng = new Rng(seed);
  const pid = sim.addPlayer('warrior', `Vault audit ${seed}`, { autoEquip: false });
  moveToBanker(sim, pid);
  const meta = metaOf(sim, pid);
  // A clean slate: the vault starts empty and LOCKED (rung 0), which is what
  // makes every unit it ever holds replayable from a ledger row the run
  // itself wrote. The audit treats the vault as birth-complete, so seeding
  // stock directly would make the replay disagree by construction.
  meta.inventory.length = 0;
  meta.copper = START_COPPER;
  const w: World = {
    sim,
    pid,
    granted: new Map(),
    crafted: 0,
    craftedOutputsRemoved: 0,
    expectedConsume: [],
    journal,
    journalFailures,
  };
  // One permanent non-material occupant, so the "only materials" refusal is
  // reachable by an ordinary slot pick rather than needing its own step kind.
  sim.addItem('worn_sword', 1, pid, { silent: true });
  for (const id of MATERIALS) grantInto(w, id, 12);
  sim.drainEvents();
  return w;
}

/** Inject materials into the bags, measuring what actually landed. Asserts the
 *  vault did not move: a grant is a bags-side injection, and folding a vault
 *  change into the source term would hide exactly the movement this file
 *  exists to watch. */
function grantInto(w: World, itemId: string, amount: number): string {
  const meta = metaOf(w.sim, w.pid);
  const before = countCarried(w, itemId);
  const vaultBefore = vaultFingerprint(w);
  const room = CARRY_CEILING - before;
  if (room <= 0) return '';
  w.sim.addItem(itemId, Math.min(amount, room), w.pid, { silent: true });
  const gained = countCarried(w, itemId) - before;
  w.granted.set(itemId, (w.granted.get(itemId) ?? 0) + gained);
  coverage.bump('grant:landed');
  if (vaultFingerprint(w) !== vaultBefore) {
    return `a grant of ${itemId} moved the vault (${vaultBefore} -> ${vaultFingerprint(w)})`;
  }
  if (meta.inventory.length > bagCapacity(meta.bags)) {
    return `a grant of ${itemId} overflowed the pack to ${meta.inventory.length} slots`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// State reads. The two fingerprints are the byte-identical probes every
// "nothing moved" assertion compares: slot order and instance payloads on the
// bags side; pooled key order and raw values, plus special-row order and every
// per-copy field, on the vault side.
// ---------------------------------------------------------------------------
function bagFingerprint(w: World): string {
  return metaOf(w.sim, w.pid)
    .inventory.map(
      (s: InvSlot) =>
        `${s.itemId}:${s.count}:${JSON.stringify(s.instance ?? null)}:${s.craftedRecipeId ?? ''}`,
    )
    .join('|');
}

function vaultFingerprint(w: World): string {
  const vault = metaOf(w.sim, w.pid).vault;
  const stock = Object.keys(vault.stock)
    .map((key) => `${key}=${String(vault.stock[key])}`)
    .join(',');
  const special = vault.special
    .map(
      (slot) =>
        `${slot.itemId}:${slot.count}:${JSON.stringify(slot.instance ?? null)}:${slot.craftedRecipeId ?? ''}:${slot.slot ?? ''}`,
    )
    .join('|');
  return `stock{${stock}};special[${special}]`;
}

function countCarried(w: World, itemId: string): number {
  return w.sim.countItem(itemId, w.pid);
}

function vaultStock(w: World, itemId: string): number {
  const stock = metaOf(w.sim, w.pid).vault.stock;
  return Object.hasOwn(stock, itemId) ? stock[itemId] : 0;
}

function upgradesOf(w: World): number {
  return metaOf(w.sim, w.pid).vault.upgrades;
}

function copperOf(w: World): number {
  return metaOf(w.sim, w.pid).copper;
}

function dumpState(w: World): string {
  const meta = metaOf(w.sim, w.pid);
  return (
    `  bags=[${bagFingerprint(w)}]\n` +
    `  vault=[${vaultFingerprint(w)}] upgrades=${meta.vault.upgrades}\n` +
    `  copper=${meta.copper} crafted=${w.crafted} granted=${[...w.granted.entries()]
      .sort()
      .map(([k, v]) => `${k}:${v}`)
      .join(',')}`
  );
}

// ---------------------------------------------------------------------------
// The conservation oracle, checked after EVERY step.
// ---------------------------------------------------------------------------
function conservationViolations(w: World): string[] {
  const out: string[] = [];
  for (const id of MATERIALS) {
    const carried = countCarried(w, id);
    const stocked = vaultStock(w, id);
    // The closed-form sink: what the RECIPE says every completed craft
    // destroys of this id, times the crafts the sim reported completing.
    const consumed = requiredFor(id) * w.crafted;
    const expected = w.granted.get(id) ?? 0;
    const actual = carried + stocked + consumed;
    if (actual !== expected) {
      out.push(
        `ITEM ${id} ${actual > expected ? 'MINTED' : 'DESTROYED'}: bags ${carried} + vault ${stocked} + consumed ${consumed} = ${actual}, granted ${expected} (delta ${actual - expected})`,
      );
    }
  }
  const expectedCopper = START_COPPER - ladderBurn(upgradesOf(w)) - CRAFT_GOLD_FEE * w.crafted;
  if (copperOf(w) !== expectedCopper) {
    out.push(
      `COPPER ${copperOf(w) > expectedCopper ? 'MINTED' : 'DESTROYED'}: expected ${expectedCopper} (start ${START_COPPER} - ladder ${ladderBurn(upgradesOf(w))} - fees ${CRAFT_GOLD_FEE * w.crafted}), got ${copperOf(w)}`,
    );
  }
  // The mint side of the craft: every completed craft grants exactly one
  // output, and nothing else in the run mints one.
  if (countCarried(w, OUTPUT) + w.craftedOutputsRemoved !== w.crafted) {
    out.push(
      `OUTPUT count ${countCarried(w, OUTPUT)} + vendored ${w.craftedOutputsRemoved} does not equal ${w.crafted} completed crafts`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The steps. Each one PREDICTS its outcome from pre-op state, applies the real
// op through the real dispatch idiom, and reports every disagreement.
// ---------------------------------------------------------------------------

/** The server's vault-command bracket (server/game.ts): snapshot, call, record
 *  against the after-snapshot. A refused op diffs empty and writes no row. */
function bracket(w: World, op: 'deposit' | 'withdraw' | 'buy_slots', run: () => void): void {
  const before = w.sim.vaultInfoFor(w.pid);
  run();
  recordVaultOp(op, WHO, before, w.sim.vaultInfoFor(w.pid));
}

function stepDeposit(w: World, s: Step & { k: 'deposit' }): string[] {
  const meta = metaOf(w.sim, w.pid);
  const problems: string[] = [];
  if (meta.inventory.length === 0) {
    coverage.bump('deposit:no-slot');
    return problems;
  }
  let index = Math.min(meta.inventory.length - 1, Math.floor(s.pick * meta.inventory.length));
  if (s.hunt) {
    // The first slot the ceiling would TRUNCATE: a material with room left,
    // asking for more than that room, and asking a count the slot can pay
    // (an over-ask is refused before the headroom gate ever runs). Falls back
    // to the uniform pick when the run has not built such a state yet.
    for (let i = 0; i < meta.inventory.length; i++) {
      const candidate = meta.inventory[i];
      if (!MATERIALS.includes(candidate.itemId)) continue;
      const room = Math.max(0, capFor(upgradesOf(w)) - vaultStock(w, candidate.itemId));
      const ask = s.whole ? candidate.count : s.cnt;
      if (room > 0 && ask > room && ask <= candidate.count) {
        index = i;
        break;
      }
    }
  }
  const slot = meta.inventory[index];
  const itemId = slot.itemId;
  const held = vaultStock(w, itemId);
  const upgrades = upgradesOf(w);
  const want = s.whole ? slot.count : s.cnt;
  const headroom = Math.max(0, capFor(upgrades) - held);

  // The refusal ladder, in the order src/sim/materials_vault.ts applies it, so
  // the coverage label names the arm that actually fired.
  let expectedMove = 0;
  let arm = '';
  if (!MATERIALS.includes(itemId)) arm = 'deposit:refused-not-material';
  else if (!s.whole && (want <= 0 || want > slot.count)) arm = 'deposit:refused-overask';
  else if (upgrades <= 0) arm = 'deposit:refused-locked';
  else if (headroom <= 0) arm = 'deposit:refused-nofit';
  else {
    expectedMove = Math.min(want, headroom);
    arm = expectedMove < want ? 'deposit:partial' : 'deposit:whole';
  }

  const bagsBefore = bagFingerprint(w);
  const vaultBefore = vaultFingerprint(w);
  const carriedBefore = countCarried(w, itemId);
  const copperBefore = copperOf(w);
  bracket(w, 'deposit', () => {
    w.sim.vaultDeposit(index, s.whole ? undefined : s.cnt, w.pid);
  });
  coverage.bump(arm);

  if (expectedMove === 0) {
    if (bagFingerprint(w) !== bagsBefore || vaultFingerprint(w) !== vaultBefore) {
      problems.push(
        `${arm} MUTATED state: bags [${bagsBefore}] -> [${bagFingerprint(w)}], vault [${vaultBefore}] -> [${vaultFingerprint(w)}]`,
      );
    }
  } else {
    if (vaultStock(w, itemId) !== held + expectedMove) {
      problems.push(
        `deposit of ${itemId}: vault expected ${held + expectedMove}, got ${vaultStock(w, itemId)}`,
      );
    }
    if (countCarried(w, itemId) !== carriedBefore - expectedMove) {
      problems.push(
        `deposit of ${itemId}: bags expected ${carriedBefore - expectedMove}, got ${countCarried(w, itemId)}`,
      );
    }
  }
  if (copperOf(w) !== copperBefore) {
    problems.push(`deposit moved copper ${copperBefore} -> ${copperOf(w)}`);
  }
  return problems;
}

function stepWithdraw(w: World, s: Step & { k: 'withdraw' }): string[] {
  const problems: string[] = [];
  // Uniform over the materials plus one id nothing can ever stock, so both the
  // held and the absent arms are reachable from one draw.
  const pool = [...MATERIALS, 'not_a_stocked_material'];
  const itemId = pool[Math.min(pool.length - 1, Math.floor(s.pick * pool.length))];
  const held = vaultStock(w, itemId);
  const carriedBefore = countCarried(w, itemId);
  const copperBefore = copperOf(w);
  const bagsBefore = bagFingerprint(w);
  const vaultBefore = vaultFingerprint(w);
  // The ask the sim will clamp to what the row can pay.
  const want = s.whole ? held : Math.min(s.cnt, held);
  const overAsked = !s.whole && held > 0 && s.cnt > held;

  bracket(w, 'withdraw', () => {
    w.sim.vaultWithdraw(itemId, s.whole ? undefined : s.cnt, w.pid);
  });

  const moved = held - vaultStock(w, itemId);
  if (held <= 0) {
    coverage.bump('withdraw:refused-absent');
    if (bagFingerprint(w) !== bagsBefore || vaultFingerprint(w) !== vaultBefore) {
      problems.push(
        `withdraw of the unstocked ${itemId} MUTATED state: bags [${bagsBefore}] -> [${bagFingerprint(w)}], vault [${vaultBefore}] -> [${vaultFingerprint(w)}]`,
      );
    }
  } else if (moved === 0) {
    // The only remaining refusal is a pack with no room for the units.
    coverage.bump('withdraw:refused-bags-full');
    if (bagFingerprint(w) !== bagsBefore || vaultFingerprint(w) !== vaultBefore) {
      problems.push(`a withdraw that moved nothing still MUTATED state around ${itemId}`);
    }
  } else {
    coverage.bump(overAsked ? 'withdraw:clamped' : 'withdraw:moved');
    if (moved > want) {
      problems.push(`withdraw of ${itemId} moved ${moved}, past the ${want} the ask allowed`);
    }
    if (countCarried(w, itemId) !== carriedBefore + moved) {
      problems.push(
        `withdraw of ${itemId}: bags expected ${carriedBefore + moved}, got ${countCarried(w, itemId)}`,
      );
    }
    if (moved >= held && Object.hasOwn(metaOf(w.sim, w.pid).vault.stock, itemId)) {
      problems.push(`withdraw drained ${itemId} to zero but left the row behind`);
    }
  }
  if (copperOf(w) !== copperBefore) {
    problems.push(`withdraw moved copper ${copperBefore} -> ${copperOf(w)}`);
  }
  return problems;
}

function stepDepositAll(w: World): string[] {
  const problems: string[] = [];
  const upgrades = upgradesOf(w);
  const bagsBefore = bagFingerprint(w);
  const vaultBefore = vaultFingerprint(w);
  const copperBefore = copperOf(w);
  const nonMaterialBefore = countCarried(w, 'worn_sword');
  const anyDepositable = MATERIALS.some(
    (id) => countCarried(w, id) > 0 && capFor(upgrades) - vaultStock(w, id) > 0,
  );

  bracket(w, 'deposit', () => {
    w.sim.vaultDepositAll(w.pid);
  });

  if (upgrades <= 0) {
    coverage.bump('deposit_all:refused-locked');
    if (bagFingerprint(w) !== bagsBefore || vaultFingerprint(w) !== vaultBefore) {
      problems.push('deposit_all on a LOCKED vault MUTATED state');
    }
    return problems;
  }
  coverage.bump(anyDepositable ? 'deposit_all:moved' : 'deposit_all:nothing-to-move');
  // The sweep is COMPLETE: every material is either fully swept out of the
  // bags or blocked by a vault filled to its ceiling. Stated over the outcome
  // rather than replayed slot by slot, so it holds whatever order the sweep
  // walked the pack in.
  const cap = capFor(upgrades);
  for (const id of MATERIALS) {
    if (countCarried(w, id) > 0 && vaultStock(w, id) < cap) {
      problems.push(
        `deposit_all left ${countCarried(w, id)} carried ${id} behind with the vault at ${vaultStock(w, id)} of ${cap}`,
      );
    }
  }
  if (countCarried(w, 'worn_sword') !== nonMaterialBefore) {
    problems.push('deposit_all swept a NON-material out of the bags');
  }
  if (copperOf(w) !== copperBefore) {
    problems.push(`deposit_all moved copper ${copperBefore} -> ${copperOf(w)}`);
  }
  return problems;
}

function stepBuy(w: World): string[] {
  const problems: string[] = [];
  const upgrades = upgradesOf(w);
  const copperBefore = copperOf(w);
  const vaultBefore = vaultFingerprint(w);
  const atCap = upgrades >= PRICES.length;
  const price = atCap ? 0 : PRICES[upgrades];
  const affordable = !atCap && copperBefore >= price;

  bracket(w, 'buy_slots', () => {
    w.sim.vaultBuyUpgrade(w.pid);
  });

  if (atCap) {
    coverage.bump('buy:refused-at-cap');
    if (upgradesOf(w) !== upgrades || copperOf(w) !== copperBefore) {
      problems.push('a buy at the top rung still moved the ladder or the purse');
    }
  } else if (!affordable) {
    coverage.bump('buy:refused-poor');
    if (upgradesOf(w) !== upgrades || copperOf(w) !== copperBefore) {
      problems.push('an unaffordable buy still moved the ladder or the purse');
    }
  } else {
    coverage.bump('buy:bought');
    if (upgradesOf(w) !== upgrades + 1) {
      problems.push(`buy left the rung at ${upgradesOf(w)}, expected ${upgrades + 1}`);
    }
    if (copperOf(w) !== copperBefore - price) {
      problems.push(
        `buy charged ${copperBefore - copperOf(w)} copper, expected the table price ${price}`,
      );
    }
  }
  if (vaultFingerprint(w) !== vaultBefore) {
    problems.push(`a rung purchase moved STOCK: [${vaultBefore}] -> [${vaultFingerprint(w)}]`);
  }
  return problems;
}

/** Drain the journal outbox's committed batches into the store, mapping each
 *  serialized outbox row back to the BankLedgerRow shape the store normalizes
 *  (instanceJson is the outbox's detached instance payload). The module FIFO
 *  is flushed FIRST so vault-op rows enqueued by earlier steps keep their true
 *  op order ahead of this craft's rows: the audit replays in id order, and a
 *  craft_consume row stamped before the deposit that fed it would replay as a
 *  negative net and a rung regression. */
async function drainJournalRows(w: World): Promise<string[]> {
  await bankLedgerIdle();
  const problems: string[] = [];
  const snap = w.journal.outbox.snapshot();
  if (snap.rowCount > 0) {
    for (const batch of snap.batches) {
      for (const row of batch.rows) {
        store.push({
          ...row,
          instance: row.instanceJson === null ? null : JSON.parse(row.instanceJson),
        });
      }
    }
    if (!w.journal.outbox.acknowledge(snap)) {
      problems.push('the journal outbox refused to acknowledge its own snapshot');
    }
  }
  return problems;
}

async function stepCraft(w: World): Promise<string[]> {
  const problems: string[] = [];
  const sim = w.sim;
  const p = entityOf(sim, w.pid);

  // Vendor away the swords the run has already minted, so the pack can never
  // fill and deny a craft for space (the one denial the materials oracle below
  // does not model). Counted first: the mint is what conservation checks, and
  // what happens to the sword afterwards is the harness's business.
  const held = countCarried(w, OUTPUT);
  if (held > 0) {
    sim.removeItem(OUTPUT, held, w.pid);
    w.craftedOutputsRemoved += held;
  }

  // The materials prediction, from raw state against the PINNED reagent list.
  const payable = REAGENTS.every(
    (r) => countCarried(w, r.itemId) + vaultStock(w, r.itemId) >= r.count,
  );
  const rung = upgradesOf(w);
  const copperBefore = copperOf(w);
  const bagsBefore = bagFingerprint(w);
  const vaultBefore = vaultFingerprint(w);
  const stockBefore = new Map(MATERIALS.map((id) => [id, vaultStock(w, id)]));
  const carriedBefore = new Map(MATERIALS.map((id) => [id, countCarried(w, id)]));
  if (copperBefore < CRAFT_GOLD_FEE) {
    problems.push(
      `the purse fell to ${copperBefore}, so the gold sink can clamp: the fee term is no longer exact`,
    );
  }

  sim.drainEvents();
  sim.craftItem(RECIPE, false, w.pid, 1);
  for (let guard = 0; p.craftCastRecipeId !== '' && guard < 4; guard++) {
    completeCraftCast(sim, w.pid);
  }
  const events = sim.drainEvents();

  // The sim's OWN claim about the outcome, taken from craftResult rather than
  // inferred from the movement this step is about to check.
  const results = events.filter((ev: SimEvent) => ev.type === 'craftResult');
  if (results.length !== 1) {
    problems.push(`a craft step produced ${results.length} craftResult events, expected exactly 1`);
    return problems;
  }
  const result = results[0] as Extract<SimEvent, { type: 'craftResult' }>;
  const consumes = events.filter((ev: SimEvent) => ev.type === 'vaultCraftConsume') as Extract<
    SimEvent,
    { type: 'vaultCraftConsume' }
  >[];
  // The craft's ledger rows were reserved and committed INSIDE the sim through
  // the production admission seam (the journal this world was built over);
  // pull the committed batches into the audit row stream, and surface any
  // journal hook failure as this step's problem.
  problems.push(...(await drainJournalRows(w)));
  problems.push(...w.journalFailures.splice(0, w.journalFailures.length));

  if (result.ok) {
    w.crafted += 1;
    const drewFromVault = consumes.length > 0;
    coverage.bump(drewFromVault ? 'craft:vault-drawn' : 'craft:carried-only');
    if (!payable) {
      problems.push('a craft the oracle called UNPAYABLE completed anyway');
    }
    if (copperOf(w) !== copperBefore - CRAFT_GOLD_FEE) {
      problems.push(
        `a completed craft charged ${copperBefore - copperOf(w)} copper, expected the ${CRAFT_GOLD_FEE} gold sink`,
      );
    }
    // The recipe is the authority on what a craft costs: no signed instance
    // ever exists in this world, so no self-signed discount can apply and the
    // listed counts are exact.
    for (const id of MATERIALS) {
      const spent =
        (carriedBefore.get(id) ?? 0) -
        countCarried(w, id) +
        (stockBefore.get(id) ?? 0) -
        vaultStock(w, id);
      if (spent !== requiredFor(id)) {
        problems.push(
          `a completed craft spent ${spent} of ${id}, the recipe lists ${requiredFor(id)}`,
        );
      }
    }
    // The event is the LEDGER RECORD for the vault half, so it must agree with
    // the stock exactly: this is the cross-check that makes the closed-form
    // consumption term above and the ledger replay below independent.
    const claimed = new Map<string, number>();
    for (const ev of consumes) {
      if (ev.upgrades !== rung) {
        problems.push(
          `a vaultCraftConsume event carried rung ${ev.upgrades}, the vault stands at ${rung}`,
        );
      }
      for (const take of ev.takes) {
        claimed.set(take.itemId, (claimed.get(take.itemId) ?? 0) + take.count);
        w.expectedConsume.push({ itemId: take.itemId, count: take.count, rung: ev.upgrades });
      }
    }
    for (const id of MATERIALS) {
      const drained = (stockBefore.get(id) ?? 0) - vaultStock(w, id);
      if (drained !== (claimed.get(id) ?? 0)) {
        problems.push(
          `the vault lost ${drained} ${id} to a craft but the event claimed ${claimed.get(id) ?? 0}`,
        );
      }
    }
    if (vaultStock(w, INERT_MATERIAL) !== stockBefore.get(INERT_MATERIAL)) {
      problems.push('a craft reached past its own reagents into the inert material');
    }
  } else {
    if (result.reason === 'no_bag_space') coverage.bump('craft:refused-space');
    else if (result.reason === 'insufficient_materials') coverage.bump('craft:refused-materials');
    else coverage.bump(`craft:refused-${String(result.reason)}`);
    if (payable && result.reason === 'insufficient_materials') {
      problems.push('a craft both pools could pay was refused for insufficient materials');
    }
    if (consumes.length > 0) {
      problems.push('a REFUSED craft emitted a vaultCraftConsume event');
    }
    if (bagFingerprint(w) !== bagsBefore || vaultFingerprint(w) !== vaultBefore) {
      problems.push(
        `a refused craft (${String(result.reason)}) MUTATED state: bags [${bagsBefore}] -> [${bagFingerprint(w)}], vault [${vaultBefore}] -> [${vaultFingerprint(w)}]`,
      );
    }
    if (copperOf(w) !== copperBefore) {
      problems.push(`a refused craft charged ${copperBefore - copperOf(w)} copper`);
    }
  }
  return problems;
}

async function applyStep(w: World, s: Step): Promise<string[]> {
  switch (s.k) {
    case 'grant': {
      const detail = grantInto(w, MATERIALS[s.which], s.amt);
      return detail ? [detail] : [];
    }
    case 'deposit':
      return stepDeposit(w, s);
    case 'withdraw':
      return stepWithdraw(w, s);
    case 'deposit_all':
      return stepDepositAll(w);
    case 'buy':
      return stepBuy(w);
    default:
      return stepCraft(w);
  }
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------
interface RunResult {
  ok: boolean;
  detail: string;
  rows: number;
}

async function runSteps(seed: number, steps: Step[], reusableSim?: Sim): Promise<RunResult> {
  // vi.fn retains every call's arguments, and a sweep runs hundreds of
  // sequences inside ONE `it`: nothing here reads the histories, so they are
  // bounded to a single run rather than a whole test (the guild file's
  // clearStoreHistory note, which cost a CI shard an OOM before it existed).
  store.insertBankLedgerRow.mockClear();
  store.insertBankLedgerRows.mockClear();
  const w = makeWorld(seed, reusableSim);
  coverage.runs++;

  const fail = (at: string, problems: string[]): RunResult => ({
    ok: false,
    detail: `seed ${seed}: ${at}\n${problems.map((p) => `  - ${p}`).join('\n')}\nstate:\n${dumpState(w)}`,
    rows: store.rows.length,
  });

  try {
    for (let i = 0; i < steps.length; i++) {
      coverage.steps++;
      const problems = await applyStep(w, steps[i]);
      problems.push(...conservationViolations(w));
      if (problems.length > 0) {
        await bankLedgerIdle();
        return fail(`after step ${i} (${fmtStep(steps[i])})`, problems);
      }
    }

    // The ledger is fire-and-forget: drain the FIFO tail before reading it, or
    // the audit replays an empty table and passes for the wrong reason.
    await bankLedgerIdle();
    const rows = [...store.rows];

    const shape: string[] = [];
    for (const row of rows) {
      if (row.container !== 'vault')
        shape.push(`row ${row.id} carries container ${String(row.container)}`);
      if (row.container_id !== null) shape.push(`row ${row.id} carries a container_id`);
      if (row.character_id !== CHARACTER_ID)
        shape.push(`row ${row.id} books character ${String(row.character_id)}`);
      if (row.realm !== REALM) shape.push(`row ${row.id} books realm ${String(row.realm)}`);
    }
    const consumeRows = rows.filter((row) => row.op === 'craft_consume');
    if (consumeRows.length !== w.expectedConsume.length) {
      shape.push(
        `${consumeRows.length} craft_consume rows for ${w.expectedConsume.length} recorded takes`,
      );
    }
    // Two orders meet here, so the comparison is a MULTISET, not positional:
    // the journal serializes the takes reservePlannedVaultConsumption
    // canonicalized (itemId then count, code-unit order,
    // src/sim/sim_context.ts), while the expectation follows the sim event
    // (emitVaultCraftConsume: aggregated per id, sorted by id). The two agree
    // on content per craft but nothing pins their relative row positions.
    // That per-craft agreement PRESUMES no recipe names one material id in
    // two reagent rows (per-take rows vs per-id aggregation would then split);
    // the premise holder is the reagent-uniqueness pin in
    // tests/recipe_economy.test.ts.
    const consumeKey = (itemId: unknown, count: unknown, rung: unknown): string =>
      `${String(itemId)} x${String(count)} @rung ${String(rung)}`;
    const multiset = (keys: string[]): Map<string, number> => {
      const out = new Map<string, number>();
      for (const key of keys) out.set(key, (out.get(key) ?? 0) + 1);
      return out;
    };
    const gotConsume = multiset(
      consumeRows.map((row) => consumeKey(row.item_id, row.count, row.purchased_slots_after)),
    );
    const wantConsume = multiset(
      w.expectedConsume.map((want) => consumeKey(want.itemId, want.count, want.rung)),
    );
    for (const [key, count] of wantConsume) {
      if (gotConsume.get(key) !== count) {
        shape.push(
          `the events took [${key}] ${count} time(s), the ledger holds ${gotConsume.get(key) ?? 0}`,
        );
      }
    }
    for (const [key, count] of gotConsume) {
      if (wantConsume.get(key) !== count) {
        shape.push(
          `the ledger holds [${key}] ${count} time(s), the events took ${wantConsume.get(key) ?? 0}`,
        );
      }
    }
    for (const row of consumeRows) {
      if (row.instance !== null)
        shape.push(`craft_consume row ${row.id} carries an instance payload`);
      if (row.copper_delta !== 0) shape.push(`craft_consume row ${row.id} carries copper`);
      if (!Number.isInteger(row.count) || Number(row.count) <= 0) {
        shape.push(`craft_consume row ${row.id} has a non-positive or fractional count`);
      }
    }
    // Nothing may sit committed-but-undrained: every craft drained its own
    // batches, so leftovers mean a commit the audit stream never saw.
    if (w.journal.outbox.usage.queuedRows !== 0) {
      shape.push(`${w.journal.outbox.usage.queuedRows} journal rows never reached the audit`);
    }
    if (shape.length > 0) return fail('the ledger rows are misshapen', shape);

    // The independent reconciliation: the reference replayer over the rows the
    // real recorders wrote and the character's REAL persisted vault slice (the
    // save blob, not the live record, so the save path rides along).
    const persisted = w.sim.serializeCharacter(w.pid);
    const findings = auditBank({
      ledgerRows: rows as unknown as BankLedgerAuditRow[],
      characters: [{ id: CHARACTER_ID, realm: REALM, state: { vault: persisted?.vault } }],
      guildBanks: [],
    });
    if (findings.length > 0) {
      return fail(
        'scripts/bank_audit.mjs disagrees with the persisted vault',
        findings.map((f) => `[${f.kind}] ${f.detail}`),
      );
    }
    return { ok: true, detail: '', rows: rows.length };
  } finally {
    // Session-teardown hygiene: release the process-wide outbox budget a
    // failed run may still hold, and drop the admission's journal pointer.
    activeWorldJournal = null;
    w.journal.outbox.discard();
    if (reusableSim) {
      reusableSim.removePlayer(w.pid);
      reusableSim.drainEvents();
    }
  }
}

interface Failure {
  seed: number;
  detail: string;
  steps: Step[];
}

async function sweep(seeds: number[]): Promise<{ failures: Failure[]; rows: number }> {
  const failures: Failure[] = [];
  let rows = 0;
  // Static content/NPC construction is ~three orders of magnitude more
  // expensive than a clean player lifecycle. Reuse one empty world while each
  // seed still receives a fresh player and RNG, then remove that player in the
  // runner's finally block. This keeps all 250 cases and coverage floors while
  // avoiding full-suite CPU/memory contention around 250 identical worlds.
  const sim = new Sim({
    seed: 0,
    playerClass: 'warrior',
    autoEquip: false,
    noPlayer: true,
    world: VAULT_TEST_WORLD,
    vaultConsumptionAdmission: SWEEP_VAULT_ADMISSION,
  });
  const baselineEntities = sim.entities.size;
  for (const seed of seeds) {
    const steps = genSteps(seed);
    const r = await runSteps(seed, steps, sim);
    rows += r.rows;
    if (!r.ok) {
      failures.push({ seed, detail: r.detail, steps });
      if (failures.length >= 3) break; // enough evidence; keep the run bounded
    }
    // Inter-run cleanliness (cheap forms only): the reused world must come
    // back to its baseline after removePlayer, or every later seed would run
    // against a polluted world and the whole sweep's evidence would degrade.
    if (sim.players.size !== 0 || sim.entities.size !== baselineEntities) {
      failures.push({
        seed,
        detail: `seed ${seed}: the run left residue in the reused world: players=${sim.players.size}, entities=${sim.entities.size} (baseline ${baselineEntities})`,
        steps,
      });
      break;
    }
  }
  return { failures, rows };
}

const reportFailures = (failures: Failure[]): string =>
  failures
    .map(
      (f) =>
        `\n=== FAILED, seed ${f.seed} ===\n${f.detail}\nsequence (${f.steps.length} steps):\n${fmtSteps(f.steps)}`,
    )
    .join('\n');

const seedList = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);

// ---------------------------------------------------------------------------
// Premises. Every literal the oracle computes with, pinned against the content
// it mirrors: a re-spec fails HERE with a readable reason instead of quietly
// agreeing with itself in every assertion above.
// ---------------------------------------------------------------------------
describe('fixture premises', () => {
  it('pins the ladder, the caps, and the recipe this sweep spends', () => {
    expect([...VAULT_UPGRADE_PRICES]).toEqual(PRICES);
    expect(CAPS).toEqual(PRICES.map((_, i) => VAULT_BASE_CAP + VAULT_UPGRADE_STEP * i));
    expect(recipeById(RECIPE)?.reagents).toEqual(REAGENTS);
    expect(recipeById(RECIPE)?.resultItemId).toBe(OUTPUT);
    expect(recipeById(RECIPE)?.resultCount).toBe(1);
    // Field-castable and untrained: the two facts that let a craft land at any
    // point in a generated sequence.
    expect(recipeById(RECIPE)?.stationType).toBeUndefined();
    expect(recipeById(RECIPE)?.skillReq).toBe(0);
    const budget = recipeById(RECIPE)?.itemLevelBudget ?? 0;
    expect(Math.ceil(budget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET)).toBe(CRAFT_GOLD_FEE);
  });

  it('pins every fixture material as vault-eligible, and the inert one as no reagent', () => {
    const eligible = vaultMaterialIds();
    for (const id of MATERIALS) expect(`${id}:${eligible.has(id)}`).toBe(`${id}:true`);
    // The non-material occupant that makes the "only materials" refusal
    // reachable must really be refused.
    expect(eligible.has('worn_sword')).toBe(false);
    expect(REAGENTS.some((r) => r.itemId === INERT_MATERIAL)).toBe(false);
  });

  it('starts every run at a banker with an empty, locked vault and a full purse', () => {
    const w = makeWorld(1);
    expect(w.sim.vaultInfoFor(w.pid)).not.toBeNull();
    expect(metaOf(w.sim, w.pid).vault).toEqual({ stock: {}, special: [], upgrades: 0 });
    expect(copperOf(w)).toBe(START_COPPER);
    expect(conservationViolations(w)).toEqual([]);
    for (const id of MATERIALS) expect(`${id}:${countCarried(w, id)}`).toBe(`${id}:12`);
  });

  it('fingerprints stock values and every special-row field used by a no-op check', () => {
    const w = makeWorld(1);
    const vault = metaOf(w.sim, w.pid).vault;
    const empty = vaultFingerprint(w);

    vault.stock.wolf_fang = 1;
    const oneStocked = vaultFingerprint(w);
    expect(oneStocked).not.toBe(empty);
    vault.stock.wolf_fang = 2;
    expect(vaultFingerprint(w)).not.toBe(oneStocked);
    delete vault.stock.wolf_fang;
    expect(vaultFingerprint(w)).toBe(empty);
    vault.stock.wolf_fang = 1;
    vault.stock.bone_fragments = 2;
    const orderedStock = vaultFingerprint(w);
    delete vault.stock.wolf_fang;
    delete vault.stock.bone_fragments;
    vault.stock.bone_fragments = 2;
    vault.stock.wolf_fang = 1;
    expect(vaultFingerprint(w)).not.toBe(orderedStock);
    delete vault.stock.bone_fragments;
    delete vault.stock.wolf_fang;

    vault.special.push({
      itemId: 'wolf_fang',
      count: 1,
      instance: {
        signer: 'Ada',
        charges: { spark: 2 },
        rolled: { quality: 'rare', stats: { sta: 2 }, masterwork: true },
        enchant: 'enchant_a',
        craftedRecipeId: 'instance_recipe',
        boundTo: 7,
        bindOnTrade: true,
        locked: true,
        rift: {
          sourceEventId: 'event_a',
          tier: 'C',
          power: 3,
          upgradeLevel: 1,
          maxUpgradeLevel: 5,
          baseStats: { sta: 2 },
          enchant: { stat: 'sta', value: 1 },
          gemSlots: 1,
          gems: ['rift_gem_crimson'],
        },
      },
      craftedRecipeId: 'recipe_eastbrook_arming_sword',
    });
    const oneSpecial = vaultFingerprint(w);
    expect(oneSpecial).not.toBe(empty);
    const special = vault.special[0];
    const instance = special.instance;
    if (!instance?.rolled || !instance.rift) throw new Error('expected full special fixture');
    const changedInstances = [
      { ...instance, signer: 'Bea' },
      { ...instance, charges: { spark: 3 } },
      { ...instance, rolled: { ...instance.rolled, stats: { sta: 3 } } },
      { ...instance, enchant: 'enchant_b' },
      { ...instance, craftedRecipeId: 'instance_recipe_changed' },
      { ...instance, boundTo: 8 },
      { ...instance, bindOnTrade: false },
      { ...instance, locked: false },
      { ...instance, rift: { ...instance.rift, power: 4 } },
      { ...instance, rift: { ...instance.rift, baseStats: { sta: 3 } } },
      { ...instance, rift: { ...instance.rift, enchant: { stat: 'sta', value: 2 } } },
      { ...instance, rift: { ...instance.rift, gems: ['rift_gem_azure'] } },
      { ...instance, futurePayload: { deep: 9 } } as typeof instance,
    ];
    for (const changed of [
      { ...special, itemId: 'bone_fragments' },
      { ...special, count: 2 },
      ...changedInstances.map((changedInstance) => ({ ...special, instance: changedInstance })),
      { ...special, craftedRecipeId: 'recipe_changed' },
      { ...special, slot: 3 },
    ]) {
      vault.special[0] = changed;
      expect(vaultFingerprint(w)).not.toBe(oneSpecial);
    }
    vault.special[0] = special;
    vault.special.push({ ...special, instance: { signer: 'Bea' } });
    const orderedSpecial = vaultFingerprint(w);
    vault.special.reverse();
    expect(vaultFingerprint(w)).not.toBe(orderedSpecial);
  });
});

// ---------------------------------------------------------------------------
// P0: the oracle itself must be able to fail. A harness that cannot detect a
// planted violation proves nothing.
// ---------------------------------------------------------------------------
describe('the conservation oracle (mutation check: it can actually fail)', () => {
  it('detects minted stock, destroyed stock, a free rung, and minted copper', () => {
    const w = makeWorld(1);
    const meta = metaOf(w.sim, w.pid);
    expect(conservationViolations(w)).toEqual([]);

    meta.vault.stock.wolf_fang = 1;
    expect(conservationViolations(w).join()).toContain('wolf_fang MINTED');
    delete meta.vault.stock.wolf_fang;
    expect(conservationViolations(w)).toEqual([]);

    w.sim.removeItem('copper_ore', 1, w.pid);
    expect(conservationViolations(w).join()).toContain('copper_ore DESTROYED');
    w.sim.addItem('copper_ore', 1, w.pid, { silent: true });
    expect(conservationViolations(w)).toEqual([]);

    // Two rungs granted with no copper paid: the purse keeps 70000 the ladder
    // position proves was spent, so the closed-form burn term reports it as
    // minted copper and names the exact ladder amount that went unpaid.
    meta.vault.upgrades = 2;
    expect(conservationViolations(w).join()).toContain('ladder 70000');
    meta.vault.upgrades = 0;

    meta.copper += 1;
    expect(conservationViolations(w).join()).toContain('COPPER MINTED');
    meta.copper -= 1;

    // A craft the sim never really completed: the closed-form sink now claims
    // reagents nothing spent and an output nothing minted, so the identity
    // breaks on every reagent AND on the output count. This is the arm that
    // keeps the sink term honest, which is what the whole craft property
    // rests on.
    w.crafted += 1;
    const unexplained = conservationViolations(w).join();
    expect(unexplained).toContain('wolf_fang MINTED: bags 12 + vault 0 + consumed 2 = 14');
    expect(unexplained).toContain('smithing_flux MINTED: bags 12 + vault 0 + consumed 6 = 18');
    expect(unexplained).toContain('OUTPUT count 0 + vendored 0 does not equal 1 completed crafts');
    w.crafted -= 1;

    expect(conservationViolations(w)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P0b: the AUDIT arm must be load-bearing too. Property 3 asks for zero
// findings, and zero findings is also what a run with no rows and an empty
// vault produces, so "the audit was clean" has to be shown to mean something
// before a sweep of it proves anything.
//
// One hand-driven scenario, chosen so every recorder is exercised at once (a
// rung purchase, a batched sweep that diffs to one row PER MATERIAL, and a
// craft that consumes from the vault), then the same rows are bent three ways
// and the audit must catch each.
// ---------------------------------------------------------------------------
describe('the audit arm (mutation check: a dropped or bent row is caught)', () => {
  it('reconciles the real rows, then reports a finding for each planted defect', async () => {
    coverage.enabled = false;
    let w: World;
    let rows: Record<string, unknown>[];
    try {
      store.insertBankLedgerRow.mockClear();
      store.insertBankLedgerRows.mockClear();
      w = makeWorld(1);
      const scenario: Step[] = [
        { k: 'buy' }, // rung 1: the vault unlocks at a 40 ceiling
        { k: 'deposit_all' }, // one command, four materials, four rows
        { k: 'craft' }, // the bags hold no reagents, so the vault pays all three
        { k: 'buy' }, // rung 2, so the final row's rung is not the first one
      ];
      for (const step of scenario) expect(await applyStep(w, step)).toEqual([]);
      expect(conservationViolations(w)).toEqual([]);
      await bankLedgerIdle();
      rows = [...store.rows];
    } finally {
      coverage.enabled = true;
    }

    // The recorders really wrote, and wrote the shape the wiring promises: ONE
    // sweep command diffs to one row per material moved, and ONE craft writes
    // one craft_consume row per reagent drawn.
    expect(rows.map((r) => r.op)).toEqual([
      'buy_slots',
      'deposit',
      'deposit',
      'deposit',
      'deposit',
      'craft_consume',
      'craft_consume',
      'craft_consume',
      'buy_slots',
    ]);
    // Sorted by material id, aggregated per id, each carrying the rung the
    // vault stood at when the craft consumed (1, not the 2 it ends on).
    expect(
      rows
        .filter((r) => r.op === 'craft_consume')
        .map((r) => `${String(r.item_id)}x${String(r.count)}@${String(r.purchased_slots_after)}`),
    ).toEqual(['bone_fragmentsx4@1', 'smithing_fluxx6@1', 'wolf_fangx2@1']);

    const persisted = w.sim.serializeCharacter(w.pid);
    const character = { id: CHARACTER_ID, realm: REALM, state: { vault: persisted?.vault } };
    const audit = (ledgerRows: Record<string, unknown>[]) =>
      auditBank({
        ledgerRows: ledgerRows as unknown as BankLedgerAuditRow[],
        characters: [character],
        guildBanks: [],
      });

    expect(audit(rows)).toEqual([]);

    // 1) A LOST deposit row: the state holds stock the ledger cannot explain.
    const withoutDeposit = rows.filter(
      (r) => !(r.op === 'deposit' && r.item_id === INERT_MATERIAL),
    );
    expect(audit(withoutDeposit).map((f) => f.kind)).toContain('ledger_state_mismatch');

    // 2) A LOST craft_consume row: exactly the hole the reservation journal
    // exists to prevent, and the reason every crafting character would
    // otherwise reconcile as a permanent mismatch.
    const withoutConsume = rows.filter(
      (r) => r.op !== 'craft_consume' || r.item_id !== 'wolf_fang',
    );
    expect(audit(withoutConsume).map((f) => f.kind)).toContain('ledger_state_mismatch');

    // 3) A BENT rung on the final row: the ladder reconciliation must notice
    // that the ledger's last position disagrees with state.vault.upgrades.
    const bentRung = rows.map((r, i) =>
      i === rows.length - 1 ? { ...r, purchased_slots_after: 1 } : r,
    );
    expect(audit(bentRung).map((f) => f.kind)).toContain('purchased_mismatch');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// P1: the sweep. Conservation, the predicted-refusal no-op, the row shape, and
// the audit reconciliation, on every generated sequence.
// ---------------------------------------------------------------------------
describe('P1 vault conservation across generated op sequences', () => {
  it('holds for every seed, and scripts/bank_audit.mjs reconciles each run', async () => {
    const { failures, rows } = await sweep(seedList(250));
    process.stderr.write(`\n[vault conservation] ledger rows written: ${rows}\n`);
    expect(reportFailures(failures)).toBe('');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The coverage readout, and the floor under it. Every op kind must have fired,
// and BOTH arms of every two-arm pair must have been reached: a sweep where
// every craft was refused, or where no deposit ever hit a full vault, proves
// nothing about the arm it never entered.
// ---------------------------------------------------------------------------
describe('coverage of the property sweep', () => {
  it('reports what was exercised and holds a floor under it', () => {
    process.stderr.write(
      `\n[vault conservation coverage] runs=${coverage.runs} steps=${coverage.steps} | ${coverage.render()}\n`,
    );
    // The sweep-shape floor: every seed RAN (the runner counts runs itself,
    // and only the sweep calls it), and the step total sits above a round
    // conservative bound. The reference sweep is runs=250 steps=11223; the
    // step floor sits far below that so benign generator drift cannot flake
    // it, while a sweep that silently dropped most of its seeds still fails.
    expect(coverage.runs).toBe(250);
    expect(coverage.steps).toBeGreaterThan(5000);
    for (const arm of [
      'grant:landed',
      // Deposit: the moving arms and every refusal the ladder can produce.
      'deposit:whole',
      'deposit:partial',
      'deposit:refused-locked',
      'deposit:refused-nofit',
      'deposit:refused-not-material',
      'deposit:refused-overask',
      // Withdraw: moved, clamped by an over-ask, and refused on an absent row.
      'withdraw:moved',
      'withdraw:clamped',
      'withdraw:refused-absent',
      // The batched sweep: moved, locked, and the armed-but-empty click
      // (reliably reached: 226 of 11,223 steps in the reference 250-seed
      // sweep, so its absence from this floor was an oversight, not a
      // reachability limit).
      'deposit_all:moved',
      'deposit_all:nothing-to-move',
      'deposit_all:refused-locked',
      // The ladder, bought and refused at the top.
      'buy:bought',
      'buy:refused-at-cap',
      // The craft: consumed from the vault, paid entirely from the bags, and
      // refused for materials. The vault-drawn arm is the whole point of the
      // file, so a sweep that never reached it must fail here.
      'craft:vault-drawn',
      'craft:carried-only',
      'craft:refused-materials',
    ]) {
      expect(`${arm}:${coverage.count(arm) > 0}`).toBe(`${arm}:true`);
    }
    // The harness must never be pack-bound: a space denial means the craft
    // oracle was predicting against a constraint it does not model.
    expect(`craft:refused-space=${coverage.count('craft:refused-space')}`).toBe(
      'craft:refused-space=0',
    );
    // Three counted arms are DELIBERATELY unfloored, each best-effort rather
    // than guaranteed (0 hits in the reference 250-seed sweep; the behaviors
    // themselves carry direct unit pins in materials_vault / vault_window):
    // - withdraw:refused-bags-full: the generator rarely packs the bags to
    //   zero fit before a withdraw lands on an empty-fit frame.
    // - buy:refused-poor: the grant schedule keeps copper generous, so the
    //   poor-refusal frame is practically ungeneratable here.
    // - deposit:no-slot: a targeted deposit against a fully swept bag needs
    //   an ordering the step generator does not favor.
  });
});
