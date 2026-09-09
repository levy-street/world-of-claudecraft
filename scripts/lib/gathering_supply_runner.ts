// Intentional Gathering PR5: the Sim-touching half of the supply measurement
// harness. Deliberately imports NOTHING from either repo's `src/sim`: every
// fact this file needs about the target repo's engine arrives through the
// `HarnessBindings` object the CLI builds after esbuild-bundling this module
// together with one small, repo-specific entry that imports the target
// repo's own `src/sim/*` by absolute path. That is what lets the SAME
// compiled scenario logic run unmodified against the baseline (PR3872 head)
// and the final (this PR5 worktree) trees: two different Sim classes with
// two different feature sets, one shared driver.
//
// Because the two trees genuinely differ (the final tree has a Field Kit,
// a timed corpse-harvest cast and a remembered preference; the baseline
// tree has neither), every scenario feature-detects the optional Sim methods
// (`typeof sim.setHarvestPreference === 'function'`, `sim.plantCrop`, ...)
// rather than assuming one shape, and every scenario runs inside its own
// try/catch: an
// API surface the target repo does not have becomes an `error` on that one
// measurement, never a crash of the whole report. That is a DELIBERATE
// choice for a cross-version harness, not a general license to swallow
// errors in production code.
//
// Every quantity reported is what was ACTUALLY GRANTED (read off real
// inventory deltas or the sim's own text-free result events), never a
// planned/rolled amount. A denied attempt contributes zero harvested units
// and is counted in `deniedAttempts`, never folded into a success.

import {
  BULK_SAMPLE_COUNT,
  foldHarvestUnits,
  HARNESS_SEED,
  type HarvestUnitRecord,
  type ScenarioMeasurement,
} from './gathering_supply_scenarios';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface HarnessEntity {
  id: number;
  pos: Vec3;
  prevPos?: Vec3;
  facing: number;
  castingAbility: string | null;
  dead: boolean;
  [extra: string]: unknown;
}

export interface HarnessMoveInput {
  forward: boolean;
  [extra: string]: boolean;
}

/** The subset of `SimEvent` this harness reads for honest denial diagnostics.
 *  `text` covers `error` events (the corpse/node/fishing refusal literals);
 *  the rest cover `gatherDenied`'s structured fields. Never asserted against
 *  a literal union here, since baseline and final may phrase a reason
 *  differently; read as plain diagnostic strings only. */
export interface HarnessSimEvent {
  readonly type: string;
  readonly text?: string;
  readonly reason?: string;
  readonly surface?: string;
  readonly professionId?: string;
  readonly requiredTier?: number;
  readonly [extra: string]: unknown;
}

export interface HarnessMeta {
  readonly inventory: readonly { itemId: string; count: number }[];
  readonly bags: readonly (string | null)[];
}

export interface HarnessSim {
  readonly player: HarnessEntity;
  readonly playerId: number;
  readonly ctx: unknown;
  readonly cfg: { seed: number };
  readonly entities: Map<number, HarnessEntity>;
  readonly moveInput: HarnessMoveInput;
  readonly events: readonly HarnessSimEvent[];
  tick(): unknown[];
  addItem(itemId: string, qty: number, pid?: number): void;
  countItem(itemId: string, pid?: number): number;
  meta(pid: number): HarnessMeta | null;
  groundPos(x: number, z: number): Vec3;
  interact(pid?: number): void;
  lootCorpse?(mobId: number, pid?: number): boolean;
  harvestNode(nodeId: string, confirmEffectUse?: boolean, pid?: number): boolean;
  addPlayer?(cls: string, name: string): number;
  setHarvestPreference?(raw: string, pid?: number): void;
  plantCrop?(bedId: string, cropId: string, knobs?: Record<string, unknown>, pid?: number): void;
  harvestCrop?(bedId: string, pid?: number): void;
  partyInvite?(targetPid: number, pid?: number): void;
  partyAccept?(pid?: number): void;
}

export interface HarnessRecipeReagent {
  readonly itemId: string;
  readonly count: number;
}

export interface HarnessRecipe {
  readonly id: string;
  readonly skillReq: number;
  readonly resultItemId: string;
  readonly resultCount: number;
  readonly reagents: readonly HarnessRecipeReagent[];
}

export interface HarnessWaterShoreSpot {
  readonly x: number;
  readonly z: number;
  readonly faceX: number;
  readonly faceZ: number;
}

export interface HarnessBindings {
  readonly repoLabel: 'baseline' | 'final';
  makeSim(opts: {
    seed: number;
    playerClass?: string;
    autoEquip?: boolean;
    noPlayer?: boolean;
    lockoutNowMs?: () => number;
  }): HarnessSim;
  createMob(id: number, template: unknown, level: number, pos: Vec3): HarnessEntity;
  mobTemplate(mobId: string): { componentTags?: readonly string[]; maxLevel: number } | undefined;
  /**
   * Calls the real `Sim.harvestCorpse` command with the CORRECT positional
   * argument order for whichever tree this binding was built against. The
   * two trees genuinely disagree here: final's is `(mobId, pid?)` (the
   * per-call components override retired with PR3's remembered
   * preference), baseline's is `(mobId, components?, pid?)`. A single
   * fixed call order would feed `pid` into baseline's `components` slot on
   * every corpse scenario, which is why this indirection exists rather than
   * a plain method on `HarnessSim`: the version-specific calling convention
   * lives in the generated per-repo entry, which is regenerated per repo
   * anyway. `components` is ignored
   * on the final tree (there is no such parameter there); the return
   * value is a best-effort admission signal ONLY (final returns a real
   * boolean, baseline's command returns void) and every caller in this
   * file confirms success by diffing actual inventory counts, never by
   * trusting this return value alone.
   */
  harvestCorpseCommand(
    sim: HarnessSim,
    mobId: number,
    pid: number,
    components?: readonly string[],
  ): boolean | void;
  /**
   * Runs the target repo's OWN real `tryNearbyInteraction`
   * (`src/game/nearby_interaction.ts`) against a minimal, real adapter over
   * `sim`: never a hand-reimplementation of its corpse-arm decision. The two
   * trees genuinely disagree on that function's signature and on what its
   * corpse arm does (final: `world.lootCorpse` only, ordinary loot never
   * gathers; a pre-PR1 tree: `world.harvestCorpse` then `world.lootCorpse`,
   * the old unified-F behavior), so this binding detects which shape it was
   * handed by the REAL function's own arity, never by `repoLabel`. Returns
   * whether the corpse's ordinary loot slot was actually looted
   * (`world.lootCorpse`'s own boolean outcome) plus every `hud.showError`
   * diagnostic text seen, so a caller can tell "ordinary interact correctly
   * found nothing left to loot" apart from "gather denied" instead of
   * folding both into one generic denial count.
   */
  tryNearbyOrdinaryInteract(
    sim: HarnessSim,
    mobId: number,
    pid: number,
  ): { looted: boolean; diagnostics: readonly string[] };
  /**
   * Directly sets a player's gathering proficiency for `professionId`,
   * bypassing real skill-gain grinding. The ONE case this harness needs it:
   * the recipe scenario's "properly equipped and skilled" farming retry,
   * which needs a real tier-4 hoe to actually WIELD (the real
   * WIELD_REQUIREMENT_BY_TIER gate a fresh character never earns through
   * play). Reaches into the real Sim's own `PlayerMeta` (a public field on
   * both trees, `Sim.players`), never a command: this is harness setup,
   * exactly like handing over a starting item via `sim.addItem`, not a
   * simulated action. Optional and feature-detected like every other
   * cross-version binding in this file.
   */
  setGatheringProficiency?(
    sim: HarnessSim,
    professionId: string,
    value: number,
    pid?: number,
  ): void;
  terrainHeight(x: number, z: number, seed: number): number;
  gatherNode(
    type: 'ore' | 'wood' | 'herb',
  ): { id: string; zoneId: string; tier: number; pos: { x: number; z: number } } | undefined;
  gatherToolItemId(type: 'ore' | 'wood' | 'herb'): string;
  farmBed(bedId: string): { x: number; z: number } | undefined;
  farmCrop(
    cropId: string,
  ):
    | { seedItemId: string; produceItemId: string; fineProduceItemId: string; durationMs: number }
    | undefined;
  waterShoreSpot(): HarnessWaterShoreSpot;
  startFishing(ctx: unknown, p: HarnessEntity, meta: unknown): void;
  updateCasting(ctx: unknown, p: HarnessEntity, meta: unknown): void;
  recipeById(id: string): HarnessRecipe | undefined;
  gatheringFamilyOf(itemId: string): string | undefined;
  equipmentItemIds(): readonly string[];
  bagCapacityOf(bags: readonly (string | null)[]): number;
}

const FOREST_WOLF_MOB_ID = 'forest_wolf';
const HIDE_ITEM_ID = 'rough_hide';
const FIELD_KIT_ITEM_ID = 'field_kit';
const FARM_HOE_ITEM_ID = 'garden_hoe';
const FARM_BED_ID = 'bed_eastbrook_1';
const FARM_CROP_ID = 'vale_wheat';
// The two explicit recipes for the required/gathered acquisition scenario:
// a starter recipe (skillReq 0, a real wolf_fang consumer) and a
// late recipe (skillReq 125, the apex tool-crafting rung),
// chosen once by hand rather than re-derived by min/max on every run, so a
// content change moving the true extremes cannot silently swap which recipe
// this scenario reports against.
const EARLY_RECIPE_ID = 'recipe_eastbrook_arming_sword';
const LATE_RECIPE_ID = 'recipe_evergarden_hoe';
const LATE_CROP_ID = 'evergarden_greens';
// bed_evergarden_1 is the real bed id (src/sim/content/farm_patches.ts);
// patch_evergarden is the PATCH id one level up and is never accepted by
// farmBedById/plantCrop.
const LATE_FARM_BED_ID = 'bed_evergarden_1';
// The real tier-4 land hoe (src/sim/content/items.ts): what the late-recipe
// retry hands over once the intentional starter-hoe refusal has been
// recorded, alongside a real farming proficiency high enough to wield it
// (setGatheringProficiency, WIELD_REQUIREMENT_BY_TIER caps at 100).
const LATE_HOE_ITEM_ID = 'osmium_hoe';
const MAX_GATHERING_PROFICIENCY = 100;
// A bounded number of real grow-and-harvest cycles the properly equipped
// late-recipe retry runs while trying to reach the recipe's own required
// fine-grade count: the fine grade is a per-pick RNG chance (the
// golden-harvest roll in professions/farming.ts), never guaranteed, so a
// single cycle cannot be trusted to land it. Matches BULK_SAMPLE_COUNT's
// bounded-smoke-count convention elsewhere in this harness: bounded, not
// unbounded, since this is a feature-validation harness, not a statistical
// distribution study.
const MAX_LATE_FARM_CYCLES = 8;

function slotCount(sim: HarnessSim, pid: number): number {
  return sim.meta(pid)?.inventory.length ?? 0;
}

/**
 * Every REAL corpse fixture in this repo's own tests (tests/corpse_harvest_sim.test.ts
 * setup/publicSetup) sets all four of these fields, not just `dead`: a fresh
 * `createMob` entity is otherwise a LIVE mob (`corpseTimer`/`respawnTimer`
 * default to their live values, and `corpseCanInteract` refuses anything
 * where `corpseHasDecayed(dead, corpseTimer)` reads true), so a fixture that
 * only sets `dead = true` is refused at admission as `corpse_invalid` before
 * any harvest logic runs at all.
 *
 * The fixture is placed at `pos`; every caller ALSO places its actor at the
 * same `pos` (never a bare `dead = true` mob dropped at `groundPos(0, 0)`
 * while the actor sits wherever a fresh `Sim` spawned it, which is well
 * outside `INTERACT_RANGE`). Colocating both is the same idiom the real
 * fixtures use (`placeCoherently` in `tests/corpse_harvest_sim.test.ts`).
 */
function makeHarvestableCorpseFixture(
  b: HarnessBindings,
  sim: HarnessSim,
  id: number,
  pos: Vec3,
): HarnessEntity {
  const template = b.mobTemplate(FOREST_WOLF_MOB_ID);
  if (!template) throw new Error(`no mob template ${FOREST_WOLF_MOB_ID}`);
  const mob = b.createMob(id, template, template.maxLevel, pos);
  mob.componentTags = template.componentTags;
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  // Real ORDINARY loot, separate from the gather-harvest ledger every other
  // field on this fixture serves: `openToAll` so `corpseLootAvailability`
  // reports `hasLoot` regardless of tap/party state, which is what lets the
  // real `tryNearbyInteraction` corpse arm select this fixture at all. A
  // single unit is deliberate: the slot is consumed on the first real
  // `lootCorpse` grant, so a repeated ordinary-interact press correctly finds
  // nothing left to loot rather than re-granting or falling through to a
  // second, unrelated arm.
  mob.lootable = true;
  mob.loot = { copper: 0, items: [{ itemId: HIDE_ITEM_ID, count: 1, openToAll: true }] };
  sim.entities.set(mob.id, mob);
  return mob;
}

/**
 * Neutralizes every OTHER mob the world spawned (real camps, real aggro
 * radii): the exact fixture tests/gather_node_harvest.test.ts's own
 * `despawnMobs` uses before a multi-tick cast, because a wandering hostile
 * that aggroes and swings mid-cast cancels a gather/harvest cast with zero
 * grant, which is indistinguishable from a real denial unless this runs
 * first. Never touches the fixture corpse this harness creates AFTERWARD
 * (called before `makeHarvestableCorpseFixture`/node placement in every
 * scenario that runs a multi-tick cast).
 */
function despawnAmbientMobs(sim: HarnessSim): void {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob') continue;
    e.dead = true;
    e.hp = 0;
    e.aiState = 'dead';
    e.respawnTimer = 9999;
    e.corpseTimer = 9999;
    e.inCombat = false;
  }
}

/** Real, bounded bag padding: one real EQUIPPABLE item id per occupied slot
 *  (the exact tests/bags.test.ts / tests/corpse_harvest_sim.test.ts
 *  `fillBags` idiom), stopping the instant the real `bagCapacityOf` ceiling
 *  is reached. Padding with a STACKABLE material instead would split across
 *  many stacks (the stack-size split) rather than one slot per grant, which
 *  is why this walks real equipment ids one at a time instead. */
function fillBagsToCapacity(b: HarnessBindings, sim: HarnessSim, pid: number): void {
  const gearIds = b.equipmentItemIds();
  const bags = sim.meta(pid)?.bags ?? [];
  const cap = b.bagCapacityOf(bags);
  let i = 0;
  while (slotCount(sim, pid) < cap && i < cap + 5) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

/** Colocates `actor` with a shared ground position, matching the real
 *  `placeCoherently` idiom `tests/corpse_harvest_sim.test.ts` uses to keep an
 *  actor and its corpse fixture within `INTERACT_RANGE` of each other: a
 *  fresh `Sim`'s default spawn (the compulsory-tutorial arrival point) is far
 *  from `groundPos(0, 0)`, so a fixture that places only the corpse there and
 *  never moves the actor is unreachable by construction. */
function placeActorAt(actor: HarnessEntity, pos: Vec3): void {
  actor.pos = { ...pos };
  actor.prevPos = { ...pos };
}

interface CastCompletionResult {
  readonly ticks: number;
  /** Every event any `sim.tick()` call in this loop returned, in order. Reading
   *  this instead of `sim.events` afterward is load-bearing: `Sim.tick()`
   *  DRAINS `this.events` on every call (returns the accumulated array and
   *  resets it to empty), so a completion event fired mid-cast is gone from
   *  `sim.events` by the time a caller checks it once the loop returns. */
  readonly events: readonly HarnessSimEvent[];
}

function runCastToCompletion(
  sim: HarnessSim,
  actor: HarnessEntity,
  maxTicks = 200,
): CastCompletionResult {
  let ticks = 0;
  const events: HarnessSimEvent[] = [];
  while (actor.castingAbility && ticks < maxTicks) {
    events.push(...(sim.tick() as HarnessSimEvent[]));
    ticks++;
  }
  return { ticks, events };
}

/** The most recent `error`/`gatherDenied` event text among `events`, for
 *  honest denial reporting: WHY a command refused, not just that it did.
 *  Returns undefined when nothing diagnostic was emitted (a silent refusal,
 *  or a caller that checked before anything could emit). */
function latestDenialTextIn(events: readonly HarnessSimEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'error' && typeof ev.text === 'string') return ev.text;
    if (ev.type === 'gatherDenied') {
      const parts = [`gatherDenied`, ev.surface, ev.professionId, ev.reason].filter(
        (v) => v !== undefined,
      );
      return parts.join(':');
    }
    // farmDenied (professions/farming.ts) is the plant/harvest-side sibling
    // of gatherDenied, structured the same way (reason/bedId/cropId, never a
    // text literal): missing this arm silently reads every farm refusal as
    // "no diagnostic emitted", which is what let a starter-hoe skill refusal
    // pass for a successful plant in the recipe scenario below.
    if (ev.type === 'farmDenied') {
      const parts = [`farmDenied`, ev.reason, ev.bedId, ev.cropId].filter((v) => v !== undefined);
      return parts.join(':');
    }
  }
  return undefined;
}

/** `latestDenialTextIn` over `sim.events` since `sinceIndex`: valid ONLY when
 *  no `sim.tick()` call has happened since `sinceIndex` was captured (an
 *  admission-time refusal, synchronous with the command that produced it).
 *  A denial that can only fire during a multi-tick cast (a capacity gate at
 *  completion, for instance) needs the events `runCastToCompletion` itself
 *  returned instead; see `harvestDenialText`. */
function latestDenialText(sim: HarnessSim, sinceIndex: number): string | undefined {
  return latestDenialTextIn(sim.events.slice(sinceIndex));
}

/** The denial text for a harvest/gather attempt that may have run a
 *  multi-tick cast: `started` selects WHICH events are trustworthy, since
 *  `sim.events` since `sinceIndex` is only valid before any tick ran.
 *  `completionEvents` is whatever `runCastToCompletion` returned for this
 *  same attempt (empty when no cast ran). */
function harvestDenialText(
  sim: HarnessSim,
  sinceIndex: number,
  started: boolean,
  completionEvents: readonly HarnessSimEvent[],
): string | undefined {
  return started ? latestDenialTextIn(completionEvents) : latestDenialText(sim, sinceIndex);
}

interface HarvestResultYieldLike {
  readonly itemId: string;
  readonly qty: number;
  readonly kind: string;
}

/** Reads the REAL `harvestResult` event(s) among `events` and returns exactly
 *  what the grant recorded: real itemId, qty, and kind
 *  (`'plain'`/`'signed'`/`'specimen'`), never a kind inferred from whether the
 *  pick was focused. `events` is either a synchronous `sim.events` slice (a
 *  command that completed within one call, no tick in between) or the
 *  accumulated ticks' events from `runCastToCompletion` (a timed cast). */
function harvestedUnitsFromHarvestResultEvents(
  events: readonly HarnessSimEvent[],
): HarvestUnitRecord[] {
  const out: HarvestUnitRecord[] = [];
  for (const ev of events) {
    if (ev.type !== 'harvestResult') continue;
    const yields = (ev as unknown as { yields?: readonly HarvestResultYieldLike[] }).yields;
    if (!Array.isArray(yields)) continue;
    for (const y of yields) {
      const kind: HarvestUnitRecord['kind'] =
        y.kind === 'signed' || y.kind === 'specimen' ? y.kind : 'plain';
      out.push({ itemId: y.itemId, qty: y.qty, kind });
    }
  }
  return out;
}

function emptyMeasurement(
  scenarioId: string,
  family: string,
  repoLabel: 'baseline' | 'final',
  seed: number,
): ScenarioMeasurement {
  return {
    scenarioId,
    family,
    repoLabel,
    seed,
    attempts: 0,
    successfulHarvests: 0,
    deniedAttempts: 0,
    harvestedUnits: [],
    distinctUnwantedItemIds: [],
    slotsBefore: 0,
    slotsAfter: 0,
    elapsedSimSeconds: 0,
    travelSimSeconds: 0,
    castSimSeconds: 0,
    notes: [],
  };
}

function diffUnits(
  before: Map<string, number>,
  after: Map<string, number>,
  kind: HarvestUnitRecord['kind'],
): HarvestUnitRecord[] {
  const out: HarvestUnitRecord[] = [];
  for (const [itemId, afterQty] of after) {
    const gained = afterQty - (before.get(itemId) ?? 0);
    if (gained > 0) out.push({ itemId, qty: gained, kind });
  }
  return out;
}

function snapshotCounts(
  sim: HarnessSim,
  pid: number,
  itemIds: readonly string[],
): Map<string, number> {
  return new Map(itemIds.map((id) => [id, sim.countItem(id, pid)]));
}

// ---------------------------------------------------------------------------
// Corpse harvesting
// ---------------------------------------------------------------------------

/** Ordinary interact must never GATHER on the final tree; the baseline tree
 *  is the pre-PR1 "unified F" behavior, where it did. This drives the real,
 *  unmodified `tryNearbyInteraction` (never a hand-reimplementation of its
 *  corpse-arm decision) via `tryNearbyOrdinaryInteract`, then reads the real
 *  `harvestResult` event(s) it emitted for the GATHER ledger (never an
 *  inventory diff over a hand-picked item list). The corpse's ordinary LOOT
 *  slot is a separate, independently tracked ledger: an ordinary interact
 *  that correctly loots the body (final, every tree) is a real success, not
 *  a "denial", and a repeated press after that slot is spent correctly finds
 *  nothing left to interact with, which is also not a gather denial. Actor
 *  and corpse are colocated at `groundPos(0, 0)`, since a fresh `Sim`'s
 *  default spawn is not there. */
function corpseOrdinaryInteract(b: HarnessBindings): ScenarioMeasurement {
  const m = emptyMeasurement(
    'corpse_ordinary_interact',
    'corpseHarvesting',
    b.repoLabel,
    HARNESS_SEED,
  );
  const sim = b.makeSim({ seed: HARNESS_SEED });
  const pid = sim.playerId;
  despawnAmbientMobs(sim);
  const actor = sim.entities.get(pid) as HarnessEntity;
  const pos = sim.groundPos(0, 0);
  placeActorAt(actor, pos);
  let mob: HarnessEntity;
  try {
    mob = makeHarvestableCorpseFixture(b, sim, 90001, pos);
  } catch (err) {
    return { ...m, error: err instanceof Error ? err.message : String(err) };
  }
  const slotsBefore = slotCount(sim, pid);
  const attempts = 3;
  const eventsStart = sim.events.length;
  const diagnostics: string[] = [];
  let ordinaryLootSuccesses = 0;
  for (let i = 0; i < attempts; i++) {
    const result = b.tryNearbyOrdinaryInteract(sim, mob.id, pid);
    if (result.looted) ordinaryLootSuccesses++;
    diagnostics.push(...result.diagnostics);
  }
  const harvestedUnits = harvestedUnitsFromHarvestResultEvents(sim.events.slice(eventsStart));
  const gatherGranted = harvestedUnits.length > 0;
  return {
    ...m,
    attempts,
    successfulHarvests: ordinaryLootSuccesses,
    deniedAttempts: attempts - ordinaryLootSuccesses,
    harvestedUnits,
    slotsBefore,
    slotsAfter: slotCount(sim, pid),
    notes: [
      gatherGranted
        ? 'ordinary interact GATHERED materials via the corpse harvest arm: pre-Field-Kit "unified F" behavior (expected only on baseline)'
        : 'ordinary interact granted zero GATHERED units (expected on final): the gather ledger and the ordinary-loot ledger below are counted separately',
      `ordinary loot succeeded on ${ordinaryLootSuccesses} of ${attempts} attempts: the corpse's ordinary loot slot is single-use, so a press after it is spent correctly finds nothing left to interact with, which is not a gather denial`,
      ...(diagnostics.length > 0
        ? [`diagnostic text seen: ${[...new Set(diagnostics)].join(' | ')}`]
        : []),
      `corpse: ${FOREST_WOLF_MOB_ID} (id ${mob.id}), tags hide+fang, componentTags real, dead/aiState/corpseTimer/loot set explicitly by this fixture, actor and corpse both placed at groundPos(0, 0)`,
    ],
  };
}

/** A single deliberate corpse harvest, optionally focused on one material.
 *  On the final tree this needs the Field Kit + preference + a real cast
 *  tick loop; on baseline it is the old instant `harvestCorpse` call, which
 *  accepted a components override directly. */
function corpseDeliberateHarvest(
  b: HarnessBindings,
  scenarioId: string,
  focusItemId: string | undefined,
): ScenarioMeasurement {
  const m = emptyMeasurement(scenarioId, 'corpseHarvesting', b.repoLabel, HARNESS_SEED);
  const sim = b.makeSim({ seed: HARNESS_SEED });
  const pid = sim.playerId;
  despawnAmbientMobs(sim);
  const actor = sim.entities.get(pid) as HarnessEntity;
  const pos = sim.groundPos(0, 0);
  placeActorAt(actor, pos);
  let mob: HarnessEntity;
  try {
    mob = makeHarvestableCorpseFixture(b, sim, 90002, pos);
  } catch (err) {
    return { ...m, error: err instanceof Error ? err.message : String(err) };
  }
  // Field Kit (final tree only) is setup granted BEFORE the slot snapshot
  // below, so it is never counted as harvest-caused slot growth.
  if (typeof sim.setHarvestPreference === 'function') sim.addItem(FIELD_KIT_ITEM_ID, 1, pid);
  const slotsBefore = slotCount(sim, pid);
  const notes: string[] = [];
  let castSeconds = 0;
  let startedAdmission = false;
  const eventsStart = sim.events.length;
  let harvestEvents: readonly HarnessSimEvent[];
  if (typeof sim.setHarvestPreference === 'function') {
    notes.push('final-tree path: Field Kit + preference + timed cast');
    sim.setHarvestPreference(focusItemId ?? 'all', pid);
    startedAdmission = b.harvestCorpseCommand(sim, mob.id, pid) === true;
    if (!startedAdmission) {
      notes.push(
        `admission refused before any cast started: ${latestDenialText(sim, eventsStart) ?? '(no diagnostic emitted)'}`,
      );
      harvestEvents = [];
    } else {
      const cast = runCastToCompletion(sim, actor);
      castSeconds = cast.ticks / 20;
      harvestEvents = cast.events;
    }
  } else {
    notes.push('baseline-tree path: instant harvestCorpse with a components override');
    // 'hide' is the tag HIDE_ITEM_ID (rough_hide) maps to on this fixture
    // (forest_wolf's componentTags: ['hide', 'fang']); named explicitly
    // rather than positionally sliced, so a reorder of that array cannot
    // silently focus the wrong material.
    b.harvestCorpseCommand(sim, mob.id, pid, focusItemId ? ['hide'] : undefined);
    startedAdmission = true;
    harvestEvents = sim.events.slice(eventsStart);
  }
  // The real `harvestResult` event names every landed unit's true itemId,
  // qty, and kind (plain/signed/specimen): never inferred from whether the
  // pick was focused, and never limited to a hand-picked tracked-item list.
  const harvestedUnits = harvestedUnitsFromHarvestResultEvents(harvestEvents);
  const reallyGranted = harvestedUnits.length > 0;
  // "Unwanted" only means something for a FOCUSED pick: All materials wants
  // everything the body yields, so nothing granted there is unwanted.
  // This focused fixture targets hide and also accepts its Pristine Hide
  // specimen; the literal fixture expectation is independent of grant logic.
  const distinctUnwantedItemIds = focusItemId
    ? [
        ...new Set(
          harvestedUnits
            .filter((u) => u.itemId !== focusItemId && u.itemId !== 'pristine_hide')
            .map((u) => u.itemId),
        ),
      ]
    : [];
  return {
    ...m,
    attempts: 1,
    successfulHarvests: reallyGranted ? 1 : 0,
    deniedAttempts: reallyGranted ? 0 : 1,
    harvestedUnits,
    distinctUnwantedItemIds,
    slotsBefore,
    slotsAfter: slotCount(sim, pid),
    castSimSeconds: castSeconds,
    elapsedSimSeconds: castSeconds,
    notes:
      startedAdmission && !reallyGranted
        ? [...notes, 'cast/command reported started but no harvestResult unit landed']
        : notes,
  };
}

/** Fills bags to the pool ceiling first, then attempts the same deliberate
 *  harvest: bags-full must refuse before any grant, leaving slots and the
 *  harvested-unit ledger unchanged. */
function corpseFullBagPressure(b: HarnessBindings): ScenarioMeasurement {
  const m = emptyMeasurement(
    'corpse_full_bag_pressure',
    'corpseHarvesting',
    b.repoLabel,
    HARNESS_SEED,
  );
  const sim = b.makeSim({ seed: HARNESS_SEED });
  const pid = sim.playerId;
  despawnAmbientMobs(sim);
  const actor = sim.entities.get(pid) as HarnessEntity;
  const pos = sim.groundPos(0, 0);
  placeActorAt(actor, pos);
  let mob: HarnessEntity;
  try {
    mob = makeHarvestableCorpseFixture(b, sim, 90003, pos);
  } catch (err) {
    return { ...m, error: err instanceof Error ? err.message : String(err) };
  }
  // Field Kit granted BEFORE padding, so the tool itself is never counted as
  // harvest-caused slot growth: the before/after comparison below spans only
  // the harvest attempt itself.
  if (typeof sim.setHarvestPreference === 'function') sim.addItem(FIELD_KIT_ITEM_ID, 1, pid);
  fillBagsToCapacity(b, sim, pid);
  const slotsBefore = slotCount(sim, pid);
  const notes = [
    `bags padded to ${slotsBefore} occupied real equipment slots (real bagCapacity ceiling) before the attempt`,
  ];
  const eventsStart = sim.events.length;
  let startedAdmission = false;
  let harvestEvents: readonly HarnessSimEvent[];
  if (typeof sim.setHarvestPreference === 'function') {
    sim.setHarvestPreference('all', pid);
    startedAdmission = b.harvestCorpseCommand(sim, mob.id, pid) === true;
    harvestEvents = startedAdmission ? runCastToCompletion(sim, actor).events : [];
  } else {
    b.harvestCorpseCommand(sim, mob.id, pid);
    startedAdmission = true;
    harvestEvents = sim.events.slice(eventsStart);
  }
  const harvestedUnits = harvestedUnitsFromHarvestResultEvents(harvestEvents);
  const reallyGranted = harvestedUnits.length > 0;
  const slotsAfter = slotCount(sim, pid);
  const denial = harvestDenialText(sim, eventsStart, startedAdmission, harvestEvents);
  return {
    ...m,
    attempts: 1,
    successfulHarvests: reallyGranted ? 1 : 0,
    deniedAttempts: reallyGranted ? 0 : 1,
    harvestedUnits,
    slotsBefore,
    slotsAfter,
    notes: [
      ...notes,
      startedAdmission
        ? 'command reported started despite full bags (see slot delta and harvested units)'
        : 'refused as expected',
      ...(denial ? [`denial/error text: ${denial}`] : []),
      slotsAfter === slotsBefore
        ? 'slots unchanged by the refusal'
        : 'WARNING: slots changed despite refusal',
      reallyGranted
        ? 'WARNING: materials were granted despite full bags'
        : 'no materials granted, as expected',
    ],
  };
}

/** Two REAL partied players (`sim.partyInvite` + `sim.partyAccept`, the
 *  actual command pair every social-system test uses) share ONE corpse's
 *  finite harvest opportunity: the first claim must exhaust it for the
 *  second even though both are grouped, never duplicate a grant. */
function corpsePartySharedSupply(b: HarnessBindings): ScenarioMeasurement {
  const m = emptyMeasurement(
    'corpse_party_shared_supply',
    'corpseHarvesting',
    b.repoLabel,
    HARNESS_SEED,
  );
  const sim = b.makeSim({ seed: HARNESS_SEED, noPlayer: true });
  if (typeof sim.addPlayer !== 'function')
    return { ...m, error: 'no multiplayer addPlayer on this tree' };
  const pidA = sim.addPlayer('warrior', 'HarnessA');
  const pidB = sim.addPlayer('warrior', 'HarnessB');
  let partied = false;
  if (typeof sim.partyInvite === 'function' && typeof sim.partyAccept === 'function') {
    sim.partyInvite(pidB, pidA);
    sim.partyAccept(pidB);
    partied = true;
  }
  despawnAmbientMobs(sim);
  // Both party members explicitly colocated with the corpse at
  // groundPos(0, 0): never assumed from a fresh addPlayer's default spawn.
  const pos = sim.groundPos(0, 0);
  const actorA = sim.entities.get(pidA) as HarnessEntity;
  const actorB = sim.entities.get(pidB) as HarnessEntity;
  placeActorAt(actorA, pos);
  placeActorAt(actorB, pos);
  let mob: HarnessEntity;
  try {
    mob = makeHarvestableCorpseFixture(b, sim, 90004, pos);
  } catch (err) {
    return { ...m, error: err instanceof Error ? err.message : String(err) };
  }
  const isFinalTree = typeof sim.setHarvestPreference === 'function';
  if (isFinalTree) {
    sim.addItem(FIELD_KIT_ITEM_ID, 1, pidA);
    sim.addItem(FIELD_KIT_ITEM_ID, 1, pidB);
  }
  // Slots are snapshotted AFTER every setup grant above (Field Kits included)
  // and BEFORE either attempt, so neither snapshot mistakes setup for a
  // harvest-caused change.
  const slotsBeforeA = slotCount(sim, pidA);
  const slotsBeforeB = slotCount(sim, pidB);
  const eventsStartA = sim.events.length;
  let unitsA: HarvestUnitRecord[];
  if (typeof sim.setHarvestPreference === 'function') {
    sim.setHarvestPreference('all', pidA);
    sim.setHarvestPreference('all', pidB);
    const firstGranted = b.harvestCorpseCommand(sim, mob.id, pidA) === true;
    unitsA = firstGranted
      ? harvestedUnitsFromHarvestResultEvents(runCastToCompletion(sim, actorA).events)
      : [];
  } else {
    b.harvestCorpseCommand(sim, mob.id, pidA);
    unitsA = harvestedUnitsFromHarvestResultEvents(sim.events.slice(eventsStartA));
  }
  const eventsStartB = sim.events.length;
  const secondGranted = b.harvestCorpseCommand(sim, mob.id, pidB);
  let unitsB: HarvestUnitRecord[];
  let harvestEventsB: readonly HarnessSimEvent[];
  if (isFinalTree) {
    harvestEventsB = secondGranted === true ? runCastToCompletion(sim, actorB).events : [];
    unitsB = harvestedUnitsFromHarvestResultEvents(harvestEventsB);
  } else {
    harvestEventsB = sim.events.slice(eventsStartB);
    unitsB = harvestedUnitsFromHarvestResultEvents(harvestEventsB);
  }
  const deniedA = unitsA.length > 0 ? 0 : 1;
  const deniedB = unitsB.length > 0 ? 0 : 1;
  const denialB =
    unitsB.length > 0
      ? undefined
      : harvestDenialText(sim, eventsStartB, secondGranted === true, harvestEventsB);
  return {
    ...m,
    attempts: 2,
    successfulHarvests: (unitsA.length > 0 ? 1 : 0) + (unitsB.length > 0 ? 1 : 0),
    deniedAttempts: deniedA + deniedB,
    harvestedUnits: [...unitsA, ...unitsB],
    slotsBefore: slotsBeforeA + slotsBeforeB,
    slotsAfter: slotCount(sim, pidA) + slotCount(sim, pidB),
    notes: [
      partied
        ? 'A and B are a REAL formed party (partyInvite + partyAccept)'
        : 'party commands unavailable on this tree; A and B are independent characters',
      `player A (first claimant) granted: ${unitsA.length > 0}`,
      `player B (partied second attempt) reported started: ${secondGranted}, actually granted anything: ${unitsB.length > 0}`,
      ...(denialB ? [`player B denial/error text: ${denialB}`] : []),
      'the shared corpse must not pay both party members from one death',
    ],
  };
}

/** Bounded, reproducible movement (real ticks via moveInput, never a
 *  teleport) followed by the real harvest cast, with travel time and cast
 *  time reported SEPARATELY. This is the one scenario proving the feature
 *  end to end rather than only its instantaneous completion. */
function corpseLiveTravelAndCast(b: HarnessBindings): ScenarioMeasurement {
  const m = emptyMeasurement(
    'corpse_live_travel_and_cast',
    'corpseHarvesting',
    b.repoLabel,
    HARNESS_SEED,
  );
  const sim = b.makeSim({ seed: HARNESS_SEED });
  const pid = sim.playerId;
  despawnAmbientMobs(sim);
  // Start the player 15 world units from the corpse, a real distance a bare
  // teleport-and-complete measurement would never cross.
  const start = sim.groundPos(0, 0);
  const corpsePos = sim.groundPos(0, 15);
  const actor = sim.player;
  placeActorAt(actor, start);
  actor.facing = Math.atan2(corpsePos.x - start.x, corpsePos.z - start.z);
  let mob: HarnessEntity;
  try {
    mob = makeHarvestableCorpseFixture(b, sim, 90005, corpsePos);
  } catch (err) {
    return { ...m, error: err instanceof Error ? err.message : String(err) };
  }
  // The Field Kit (final tree only) is setup, granted before travel even
  // starts: it must never be counted as harvest-caused slot growth once the
  // before/after snapshot below is taken.
  if (typeof sim.setHarvestPreference === 'function') sim.addItem(FIELD_KIT_ITEM_ID, 1, pid);
  const travelStartTick = 0;
  sim.moveInput.forward = true;
  let travelTicks = 0;
  const maxTravelTicks = 400;
  const closeEnough = 3;
  while (travelTicks < maxTravelTicks) {
    const dx = actor.pos.x - corpsePos.x;
    const dz = actor.pos.z - corpsePos.z;
    if (Math.hypot(dx, dz) <= closeEnough) break;
    sim.tick();
    travelTicks++;
  }
  sim.moveInput.forward = false;
  const arrived = Math.hypot(actor.pos.x - corpsePos.x, actor.pos.z - corpsePos.z) <= closeEnough;
  const slotsBefore = slotCount(sim, pid);
  let castTicks = 0;
  let startedAdmission = false;
  const eventsStart = sim.events.length;
  let harvestEvents: readonly HarnessSimEvent[] = [];
  if (arrived) {
    if (typeof sim.setHarvestPreference === 'function') {
      sim.setHarvestPreference('all', pid);
      startedAdmission = b.harvestCorpseCommand(sim, mob.id, pid) === true;
      if (startedAdmission) {
        const cast = runCastToCompletion(sim, actor);
        castTicks = cast.ticks;
        harvestEvents = cast.events;
      }
    } else {
      b.harvestCorpseCommand(sim, mob.id, pid);
      startedAdmission = true;
      harvestEvents = sim.events.slice(eventsStart);
    }
  }
  const harvestedUnits = harvestedUnitsFromHarvestResultEvents(harvestEvents);
  const denial =
    harvestedUnits.length > 0 || !arrived
      ? undefined
      : harvestDenialText(sim, eventsStart, startedAdmission, harvestEvents);
  return {
    ...m,
    attempts: 1,
    successfulHarvests: harvestedUnits.length > 0 ? 1 : 0,
    deniedAttempts: harvestedUnits.length > 0 ? 0 : 1,
    harvestedUnits,
    slotsBefore,
    slotsAfter: slotCount(sim, pid),
    travelSimSeconds: (travelTicks - travelStartTick) / 20,
    castSimSeconds: castTicks / 20,
    elapsedSimSeconds: (travelTicks + castTicks) / 20,
    notes: [
      arrived
        ? `arrived after ${travelTicks} real movement ticks`
        : 'did not arrive within the tick budget',
      startedAdmission
        ? 'harvest command accepted at arrival'
        : 'harvest command refused or skipped',
      'movement is the real stepPlayerMotion kernel via moveInput; never a teleport',
      ...(denial ? [`denial/error text: ${denial}`] : []),
    ],
  };
}

/** Bounded, SEEDED premium/canonical yield sample: PREMIUM_SAMPLE_COUNT fresh
 *  single-use `forest_wolf` corpses at seeds
 *  `HARNESS_SEED..HARNESS_SEED+PREMIUM_SAMPLE_COUNT-1`, each harvested for
 *  All materials to completion, reading the REAL `harvestResult` event for
 *  every landed unit's true kind. Deliberately SEPARATE from every
 *  live-timing scenario above: this exists only to exercise and report real
 *  signed/specimen premium classification, which a single deterministic-seed
 *  run may never roll. Corpse harvesting rolls rare-or-better (signed) at a
 *  fixed ~16% chance per granted family
 *  (professions/gathering.ts CORPSE_HARVEST_RARITY_BASELINE), so with two
 *  components (hide, fang) per corpse this sample size makes at least one
 *  signed/specimen grant likely without turning this into a statistical
 *  study: like every other bulk sample in this harness, it is a bounded
 *  smoke count, not a distribution claim. */
const PREMIUM_SAMPLE_COUNT = 12;

function corpsePremiumYieldSample(b: HarnessBindings): ScenarioMeasurement {
  const m = emptyMeasurement(
    'corpse_premium_yield_sample',
    'corpseHarvesting',
    b.repoLabel,
    HARNESS_SEED,
  );
  const units: HarvestUnitRecord[] = [];
  let successes = 0;
  let denied = 0;
  for (let i = 0; i < PREMIUM_SAMPLE_COUNT; i++) {
    const seed = HARNESS_SEED + i;
    const sim = b.makeSim({ seed });
    const pid = sim.playerId;
    despawnAmbientMobs(sim);
    const pos = sim.groundPos(0, 0);
    const actor = sim.entities.get(pid) as HarnessEntity;
    placeActorAt(actor, pos);
    let mob: HarnessEntity;
    try {
      mob = makeHarvestableCorpseFixture(b, sim, 90600 + i, pos);
    } catch {
      denied++;
      continue;
    }
    const eventsStart = sim.events.length;
    let harvestEvents: readonly HarnessSimEvent[];
    if (typeof sim.setHarvestPreference === 'function') {
      sim.addItem(FIELD_KIT_ITEM_ID, 1, pid);
      sim.setHarvestPreference('all', pid);
      const started = b.harvestCorpseCommand(sim, mob.id, pid) === true;
      harvestEvents = started ? runCastToCompletion(sim, actor).events : [];
    } else {
      b.harvestCorpseCommand(sim, mob.id, pid);
      harvestEvents = sim.events.slice(eventsStart);
    }
    const landed = harvestedUnitsFromHarvestResultEvents(harvestEvents);
    if (landed.length > 0) {
      successes++;
      units.push(...landed);
    } else {
      denied++;
    }
  }
  return {
    ...m,
    attempts: PREMIUM_SAMPLE_COUNT,
    successfulHarvests: successes,
    deniedAttempts: denied,
    harvestedUnits: units,
    notes: [
      `bounded SEEDED premium/canonical yield sample over ${PREMIUM_SAMPLE_COUNT} fresh seeds (${HARNESS_SEED}..${HARNESS_SEED + PREMIUM_SAMPLE_COUNT - 1}), each a fresh single-use forest_wolf corpse harvested for All materials`,
      'deliberately separate from the live-timing scenarios above: this exists to exercise and report real signed/specimen premium classification, not pacing',
      'every unit kind here is read from the real harvestResult event, never inferred from whether the pick was focused',
    ],
  };
}

// ---------------------------------------------------------------------------
// Node harvesting (mining / logging / herbalism)
// ---------------------------------------------------------------------------

const NODE_TYPES: readonly ('ore' | 'wood' | 'herb')[] = ['ore', 'wood', 'herb'];
const NODE_FAMILY_NAME: Record<'ore' | 'wood' | 'herb', string> = {
  ore: 'mining',
  wood: 'logging',
  herb: 'herbalism',
};

/** Bounded ACTION-SMOKE sampling: BULK_SAMPLE_COUNT fresh Sims per node
 *  type, each running one real harvest cast to completion via the actual
 *  `Sim.harvestNode` command, tallying what actually landed. Deliberately
 *  NOT called "pure yield sampling": this drives the full Sim action
 *  (admission, cast, completion), not a direct call into the yield-roll
 *  function with an isolated Rng, so BULK_SAMPLE_COUNT=8 is a smoke-level
 *  count, not a statistical distribution. Every sample despawns the
 *  world's own ambient mobs FIRST (`despawnAmbientMobs`), the same
 *  `tests/gather_node_harvest.test.ts` idiom, because a wandering hostile
 *  aggroing mid-cast cancels the cast with zero grant, indistinguishable
 *  from a real denial unless this runs first. */
function nodeBulkYieldSample(b: HarnessBindings): ScenarioMeasurement[] {
  return NODE_TYPES.map((type) => {
    const family = NODE_FAMILY_NAME[type];
    const scenarioId = `node_action_smoke_sample_${type}`;
    const node = b.gatherNode(type);
    if (!node)
      return {
        ...emptyMeasurement(scenarioId, family, b.repoLabel, HARNESS_SEED),
        error: `no ${type} node in content`,
      };
    const toolItemId = b.gatherToolItemId(type);
    const units: HarvestUnitRecord[] = [];
    let successes = 0;
    let denied = 0;
    const denialTexts: string[] = [];
    for (let i = 0; i < BULK_SAMPLE_COUNT; i++) {
      const seed = HARNESS_SEED + i;
      const sim = b.makeSim({ seed });
      const pid = sim.playerId;
      despawnAmbientMobs(sim);
      const pos = sim.groundPos(node.pos.x, node.pos.z);
      sim.player.pos = { ...pos };
      sim.player.prevPos = { ...pos };
      sim.addItem(toolItemId, 1, pid);
      const beforeItems = new Map<string, number>(
        (sim.meta(pid)?.inventory ?? []).map((slot) => [slot.itemId, slot.count]),
      );
      const eventsStart = sim.events.length;
      const started = sim.harvestNode(node.id, false, pid);
      if (!started) {
        denied++;
        const text = latestDenialText(sim, eventsStart);
        if (text) denialTexts.push(text);
        continue;
      }
      const cast = runCastToCompletion(sim, sim.entities.get(pid) as HarnessEntity);
      const meta = sim.meta(pid);
      const after = meta?.inventory ?? [];
      let gainedAny = false;
      for (const slot of after) {
        const gained = slot.count - (beforeItems.get(slot.itemId) ?? 0);
        if (gained > 0) {
          units.push({ itemId: slot.itemId, qty: gained, kind: 'node' });
          gainedAny = true;
        }
      }
      if (gainedAny) successes++;
      else {
        denied++;
        const text = latestDenialTextIn(cast.events);
        if (text) denialTexts.push(`cast started but nothing landed: ${text}`);
        else
          denialTexts.push(
            'cast started but nothing landed (cancelled mid-cast, e.g. by a mob attack)',
          );
      }
    }
    return {
      ...emptyMeasurement(scenarioId, family, b.repoLabel, HARNESS_SEED),
      attempts: BULK_SAMPLE_COUNT,
      successfulHarvests: successes,
      deniedAttempts: denied,
      harvestedUnits: units,
      notes: [
        `bounded ACTION-SMOKE sample over ${BULK_SAMPLE_COUNT} fresh seeds (${HARNESS_SEED}..${HARNESS_SEED + BULK_SAMPLE_COUNT - 1}), teleported to node ${node.id}`,
        'this is a real Sim.harvestNode action per sample, not a direct pure-yield-function call: 8 samples is a smoke count, not a statistical distribution',
        ...(denialTexts.length > 0
          ? [`denial reasons seen: ${[...new Set(denialTexts)].join(' | ')}`]
          : []),
      ],
    };
  });
}

/** One bounded live-tick example combining real movement and a real gather
 *  cast, parameterized over the node TYPE (ore/wood/herb) so all three land
 *  professions get the same live-travel proof rather than duplicating this
 *  walker per type. */
function nodeLiveTravelAndCast(
  b: HarnessBindings,
  type: 'ore' | 'wood' | 'herb',
): ScenarioMeasurement {
  const family = NODE_FAMILY_NAME[type];
  const m = emptyMeasurement(
    `node_live_travel_and_cast_${type}`,
    family,
    b.repoLabel,
    HARNESS_SEED,
  );
  const node = b.gatherNode(type);
  if (!node) return { ...m, error: `no ${type} node in content` };
  const sim = b.makeSim({ seed: HARNESS_SEED });
  const pid = sim.playerId;
  despawnAmbientMobs(sim);
  const toolItemId = b.gatherToolItemId(type);
  sim.addItem(toolItemId, 1, pid);
  const target = sim.groundPos(node.pos.x, node.pos.z);
  const start = sim.groundPos(node.pos.x - 15, node.pos.z);
  const actor = sim.player;
  placeActorAt(actor, start);
  actor.facing = Math.atan2(target.x - start.x, target.z - start.z);
  sim.moveInput.forward = true;
  let travelTicks = 0;
  const maxTravelTicks = 400;
  while (travelTicks < maxTravelTicks) {
    if (Math.hypot(actor.pos.x - target.x, actor.pos.z - target.z) <= 3) break;
    sim.tick();
    travelTicks++;
  }
  sim.moveInput.forward = false;
  const slotsBefore = slotCount(sim, pid);
  const beforeItems = new Map<string, number>(
    (sim.meta(pid)?.inventory ?? []).map((slot) => [slot.itemId, slot.count]),
  );
  const eventsStart = sim.events.length;
  const started = sim.harvestNode(node.id, false, pid);
  let castTicks = 0;
  let harvestEvents: readonly HarnessSimEvent[] = [];
  const units: HarvestUnitRecord[] = [];
  if (started) {
    const cast = runCastToCompletion(sim, actor);
    castTicks = cast.ticks;
    harvestEvents = cast.events;
    for (const slot of sim.meta(pid)?.inventory ?? []) {
      const gained = slot.count - (beforeItems.get(slot.itemId) ?? 0);
      if (gained > 0) units.push({ itemId: slot.itemId, qty: gained, kind: 'node' });
    }
  }
  const granted = units.length > 0;
  const denial = granted ? undefined : harvestDenialText(sim, eventsStart, started, harvestEvents);
  return {
    ...m,
    attempts: 1,
    successfulHarvests: granted ? 1 : 0,
    deniedAttempts: granted ? 0 : 1,
    harvestedUnits: units,
    slotsBefore,
    slotsAfter: slotCount(sim, pid),
    travelSimSeconds: travelTicks / 20,
    castSimSeconds: castTicks / 20,
    elapsedSimSeconds: (travelTicks + castTicks) / 20,
    notes: [
      `node ${node.id}`,
      started ? 'cast started and ran to completion' : 'cast refused at start',
      ...(denial ? [`denial/error text: ${denial}`] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Farming: growth is wall-clock, harvesting is an action
// ---------------------------------------------------------------------------

function farmingPlantAndHarvest(b: HarnessBindings): ScenarioMeasurement {
  const family = 'farming';
  const m = emptyMeasurement('farming_plant_and_harvest', family, b.repoLabel, HARNESS_SEED);
  const bed = b.farmBed(FARM_BED_ID);
  const crop = b.farmCrop(FARM_CROP_ID);
  if (!bed || !crop) return { ...m, error: 'farm bed or crop not found in content' };
  let nowMs = 1_700_000_000_000;
  const sim = b.makeSim({ seed: HARNESS_SEED, lockoutNowMs: () => nowMs });
  const pid = sim.playerId;
  despawnAmbientMobs(sim);
  const pos = sim.groundPos(bed.x, bed.z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.addItem(FARM_HOE_ITEM_ID, 1, pid);
  // The seed is a real reagent `plantCrop` spends: tests/professions_farming.test.ts
  // grants `crop.seedItemId` before every plant() call. Omitting it refuses
  // plantCrop outright with no seed in bags.
  sim.addItem(crop.seedItemId, 1, pid);
  if (typeof sim.plantCrop !== 'function' || typeof sim.harvestCrop !== 'function') {
    return { ...m, error: 'plantCrop/harvestCrop not available on this tree' };
  }
  const slotsBefore = slotCount(sim, pid);
  const plantEventsStart = sim.events.length;
  sim.plantCrop(FARM_BED_ID, FARM_CROP_ID, undefined, pid);
  const plantDenial = latestDenialText(sim, plantEventsStart);
  // Deterministic advance PAST the crop's own authored grow duration: this is
  // the injected wall-clock, never a harvest-time shortcut.
  nowMs += crop.durationMs + 1;
  const before = snapshotCounts(sim, pid, [crop.produceItemId, crop.fineProduceItemId]);
  const harvestEventsStart = sim.events.length;
  sim.harvestCrop(FARM_BED_ID, pid);
  const harvestDenial = latestDenialText(sim, harvestEventsStart);
  const after = snapshotCounts(sim, pid, [crop.produceItemId, crop.fineProduceItemId]);
  const harvestedUnits = diffUnits(before, after, 'farm');
  const granted = harvestedUnits.length > 0;
  return {
    ...m,
    attempts: 1,
    successfulHarvests: granted ? 1 : 0,
    deniedAttempts: granted ? 0 : 1,
    harvestedUnits,
    slotsBefore,
    slotsAfter: slotCount(sim, pid),
    elapsedSimSeconds: crop.durationMs / 1000,
    notes: [
      `grow interval: ${(crop.durationMs / 1000).toFixed(0)}s of injected wall-clock, reported separately from the harvest action itself`,
      'the harvest command itself is instantaneous once the plot is ready; the wait is passive, not active play time',
      ...(granted
        ? []
        : [
            `no produce granted; plant denial: ${plantDenial ?? '(none)'}, harvest denial: ${harvestDenial ?? '(none)'}`,
          ]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Fishing: action-lifecycle sampling (bite delay + reel), per the existing
// professions_fishing.test.ts castOnceLive idiom. This jumps the tick
// counter to the drawn bite deadline, which is real cast-lifecycle code
// (startFishing, updateCasting) but NOT a full live-tick travel simulation:
// labelled honestly rather than presented as end-to-end pace evidence.
// ---------------------------------------------------------------------------

function fishingActionLifecycleSample(b: HarnessBindings): ScenarioMeasurement {
  const family = 'fishing';
  const m = emptyMeasurement('fishing_action_lifecycle_sample', family, b.repoLabel, HARNESS_SEED);
  const units: HarvestUnitRecord[] = [];
  let successes = 0;
  let denied = 0;
  const errors: string[] = [];
  const denialTexts: string[] = [];
  const rodItemId = 'simple_fishing_pole';
  const shore = b.waterShoreSpot();
  for (let i = 0; i < BULK_SAMPLE_COUNT; i++) {
    const seed = HARNESS_SEED + i;
    const sim = b.makeSim({ seed });
    const pid = sim.playerId;
    despawnAmbientMobs(sim);
    // A cast needs fishable water in front of the caster: `startFishing`
    // refuses with no water in range, and the default spawn is not lakeside.
    // teleportToValeShore's own idiom (tests/professions_fishing.test.ts):
    // stand just short of the lake's radius, facing the lake center.
    const pos = sim.groundPos(shore.x, shore.z);
    sim.player.pos = { ...pos };
    sim.player.prevPos = { ...pos };
    sim.player.facing = Math.atan2(shore.faceX - shore.x, shore.faceZ - shore.z);
    sim.addItem(rodItemId, 1, pid);
    const actor = sim.entities.get(pid) as HarnessEntity;
    const meta = sim.meta(pid);
    if (!meta) {
      denied++;
      continue;
    }
    const eventsStart = sim.events.length;
    const beforeItems = new Map<string, number>(
      (meta.inventory ?? []).map((slot) => [slot.itemId, slot.count]),
    );
    try {
      b.startFishing(sim.ctx, actor, meta);
      if (actor.castingAbility === null) {
        denied++;
        const text = latestDenialText(sim, eventsStart);
        if (text) denialTexts.push(text);
        continue;
      }
      const deadline = (actor as unknown as { fishBiteAtTick?: number }).fishBiteAtTick;
      if (typeof deadline !== 'number') {
        denied++;
        denialTexts.push('cast started but no fishBiteAtTick deadline was armed');
        continue;
      }
      (sim as unknown as { tickCount: number }).tickCount = deadline;
      b.updateCasting(sim.ctx, actor, meta);
      b.startFishing(sim.ctx, actor, meta);
      for (const slot of sim.meta(pid)?.inventory ?? []) {
        const gained = slot.count - (beforeItems.get(slot.itemId) ?? 0);
        if (gained > 0 && slot.itemId !== rodItemId) {
          units.push({ itemId: slot.itemId, qty: gained, kind: 'fish' });
        }
      }
      // An empty hook is a real, valid catch outcome (a weighted null row in
      // FISHING_TABLES_BY_BAND), not a denial: the reel completed and the
      // rod is spent, it simply caught nothing this cast.
      successes++;
    } catch (err) {
      denied++;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    ...m,
    attempts: BULK_SAMPLE_COUNT,
    successfulHarvests: successes,
    deniedAttempts: denied,
    harvestedUnits: units,
    notes: [
      'ACTION-LIFECYCLE sampling: the tick counter is jumped to the drawn bite deadline',
      'this is real startFishing/updateCasting code, but NOT a full live-tick travel simulation',
      'a completed reel that catches an empty hook is a real outcome, counted as success (not a denial)',
      ...(errors.length > 0 ? [`errors: ${[...new Set(errors)].join(' | ')}`] : []),
      ...(denialTexts.length > 0
        ? [`denial reasons seen: ${[...new Set(denialTexts)].join(' | ')}`]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Recipe required-vs-gathered: a BOUNDED real acquisition attempt against
// two explicitly chosen, real shipped recipes (EARLY_RECIPE_ID at skillReq 0,
// LATE_RECIPE_ID at skillReq 125), reporting every reagent's REQUIRED count
// beside what this harness actually GATHERED for it. A gathering-family
// reagent is attempted for real through the same public Sim actions the
// other scenarios use; a vendor/crafted reagent is reported honestly as
// "not a gathering-family material, not attempted" with its real required
// count, never silently omitted or claimed satisfied.
// ---------------------------------------------------------------------------

/** Bounded real corpse-harvest attempts against fresh single-use forest_wolf
 *  corpses, focused on `itemId` via the real preference/component-override
 *  path, stopping once `required` units have landed or the attempt budget
 *  is spent. The actor is colocated with each fixture at `groundPos(0, 0)`
 *  ONCE, up front (a fresh Sim's default spawn is far from there); every
 *  subsequent fixture lands at the same spot, so the actor never has to
 *  move again. Returns units actually gathered (with their REAL kind, read
 *  from the harvestResult event, never assumed), the attempts/denials spent
 *  getting them, and the total cast ticks spent (0 on baseline, whose
 *  harvestCorpse is instant). */
function acquireCorpseComponent(
  b: HarnessBindings,
  sim: HarnessSim,
  pid: number,
  itemId: string,
  componentTag: string,
  required: number,
  idBase: number,
): {
  gathered: number;
  attempts: number;
  denied: number;
  castTicks: number;
  units: HarvestUnitRecord[];
} {
  let gathered = 0;
  let attempts = 0;
  let denied = 0;
  let castTicks = 0;
  const units: HarvestUnitRecord[] = [];
  const maxAttempts = Math.max(required + 2, 3);
  let fieldKitGranted = false;
  const actor = sim.entities.get(pid) as HarnessEntity;
  const pos = sim.groundPos(0, 0);
  placeActorAt(actor, pos);
  for (let i = 0; i < maxAttempts && gathered < required; i++) {
    attempts++;
    let mob: HarnessEntity;
    try {
      mob = makeHarvestableCorpseFixture(b, sim, idBase + i, pos);
    } catch {
      denied++;
      continue;
    }
    const eventsStart = sim.events.length;
    let harvestEvents: readonly HarnessSimEvent[];
    if (typeof sim.setHarvestPreference === 'function') {
      if (!fieldKitGranted) {
        sim.addItem(FIELD_KIT_ITEM_ID, 1, pid);
        fieldKitGranted = true;
      }
      sim.setHarvestPreference(itemId, pid);
      const started = b.harvestCorpseCommand(sim, mob.id, pid) === true;
      if (started) {
        const cast = runCastToCompletion(sim, actor);
        castTicks += cast.ticks;
        harvestEvents = cast.events;
      } else {
        harvestEvents = [];
      }
    } else {
      b.harvestCorpseCommand(sim, mob.id, pid, [componentTag]);
      harvestEvents = sim.events.slice(eventsStart);
    }
    const landed = harvestedUnitsFromHarvestResultEvents(harvestEvents).filter(
      (u) => u.itemId === itemId,
    );
    const gainedThis = landed.reduce((sum, u) => sum + u.qty, 0);
    if (gainedThis > 0) {
      gathered += gainedThis;
      units.push(...landed);
    } else {
      denied++;
    }
  }
  return { gathered, attempts, denied, castTicks, units };
}

function reagentLine(b: HarnessBindings, reagent: HarnessRecipeReagent, gathered: number): string {
  const family = b.gatheringFamilyOf(reagent.itemId);
  const status = gathered >= reagent.count ? 'MET' : 'SHORT';
  if (family === undefined) {
    return `${reagent.itemId}: required ${reagent.count}, outside gathering families; acquisition not simulated by this harness`;
  }
  return `${reagent.itemId} (${family}): required ${reagent.count}, gathered ${gathered} [${status}]`;
}

function recipeRequiredVsGathered(b: HarnessBindings): ScenarioMeasurement {
  const family = 'recipeEffort';
  const m = emptyMeasurement('recipe_required_vs_gathered', family, b.repoLabel, HARNESS_SEED);
  const early = b.recipeById(EARLY_RECIPE_ID);
  const late = b.recipeById(LATE_RECIPE_ID);
  if (!early) return { ...m, error: `recipe ${EARLY_RECIPE_ID} not found` };
  if (!late) return { ...m, error: `recipe ${LATE_RECIPE_ID} not found` };

  const notes: string[] = [];
  const units: HarvestUnitRecord[] = [];
  let attempts = 0;
  let successes = 0;
  let denied = 0;
  let earlyCastTicks = 0;

  // EARLY (skillReq 0): the one gathering-family reagent is wolf_fang
  // (corpseHarvesting, tag 'fang'). Real bounded corpse-harvest attempts.
  const earlySim = b.makeSim({ seed: HARNESS_SEED });
  const earlyPid = earlySim.playerId;
  despawnAmbientMobs(earlySim);
  notes.push(
    `EARLY recipe ${early.id} (skillReq ${early.skillReq}), result ${early.resultItemId} x${early.resultCount}:`,
  );
  for (const reagent of early.reagents) {
    if (reagent.itemId === 'wolf_fang') {
      const result = acquireCorpseComponent(
        b,
        earlySim,
        earlyPid,
        'wolf_fang',
        'fang',
        reagent.count,
        90200,
      );
      attempts += result.attempts;
      denied += result.denied;
      // Per-ATTEMPT success count, not "1 if anything landed": a run that
      // needed three successful attempts to reach `required` reports three
      // successes, matching `attempts`/`deniedAttempts` (measurementIsInternallyConsistent).
      successes += result.attempts - result.denied;
      earlyCastTicks += result.castTicks;
      units.push(...result.units);
      notes.push(reagentLine(b, reagent, result.gathered));
    } else {
      notes.push(reagentLine(b, reagent, 0));
    }
  }

  // LATE (skillReq 125): first attempt the plant with only the STARTER
  // tier-1 hoe, the honest "what does a player actually have" baseline,
  // against a real tier-4 crop and a real tier-4 farm bed. The expected
  // refusal is the bottleneck finding, but never the whole story: a second
  // attempt then hands over a real tier-4 hoe (osmium_hoe) plus enough
  // farming proficiency to wield it (setGatheringProficiency), so the
  // scenario also reports what a properly equipped/skilled attempt actually
  // yields. Neither attempt claims the whole recipe complete: only the
  // fine_evergarden_greens reagent is exercised, never a full craft.
  const lateCrop = b.farmCrop(LATE_CROP_ID);
  const lateBed = b.farmBed(LATE_FARM_BED_ID);
  notes.push(
    `LATE recipe ${late.id} (skillReq ${late.skillReq}), result ${late.resultItemId} x${late.resultCount}:`,
  );
  if (!lateCrop || !lateBed) {
    return {
      ...m,
      attempts,
      successfulHarvests: successes,
      deniedAttempts: denied,
      harvestedUnits: units,
      castSimSeconds: earlyCastTicks / 20,
      elapsedSimSeconds: earlyCastTicks / 20,
      error: `crop ${LATE_CROP_ID} or bed ${LATE_FARM_BED_ID} not found in content`,
      notes,
    };
  }

  let lateFineGathered = 0;
  let lateWaitSeconds = 0;
  let lateCastTicks = 0;
  let nowMs = 1_700_000_000_000;
  const lateSim = b.makeSim({ seed: HARNESS_SEED, lockoutNowMs: () => nowMs });
  // The recipe's own required count for the fine reagent: read off `late`,
  // never hardcoded, so a content change to the reagent count is reflected
  // here rather than silently under- or over-cycling.
  const requiredFine =
    late.reagents.find((r) => r.itemId === lateCrop.fineProduceItemId)?.count ?? 0;
  const lateUnits: HarvestUnitRecord[] = [];
  if (typeof lateSim.plantCrop !== 'function' || typeof lateSim.harvestCrop !== 'function') {
    notes.push('plantCrop/harvestCrop not available on this tree');
    attempts++;
    denied++;
  } else {
    const latePid = lateSim.playerId;
    const lateActor = lateSim.player;
    despawnAmbientMobs(lateSim);
    const pos = lateSim.groundPos(lateBed.x, lateBed.z);
    lateActor.pos = { ...pos };
    lateActor.prevPos = { ...pos };
    lateSim.addItem(FARM_HOE_ITEM_ID, 1, latePid); // deliberately the tier-1 starter hoe
    lateSim.addItem(lateCrop.seedItemId, 1, latePid);

    attempts++; // attempt 1: the intentional starter-hoe refusal
    const plantEventsStart = lateSim.events.length;
    (lateSim.plantCrop as NonNullable<HarnessSim['plantCrop']>)(
      LATE_FARM_BED_ID,
      LATE_CROP_ID,
      undefined,
      latePid,
    );
    // A `farmDenied` event (professions/farming.ts, reason 'skill' at this
    // gate) is a REAL refusal that `latestDenialText` must recognize: missing
    // that arm previously made every starter-hoe plant read as accepted, so
    // the code jumped the clock and harvested a plot that was never planted.
    const plantDenial = latestDenialText(lateSim, plantEventsStart);
    if (!plantDenial) {
      // The starter hoe unexpectedly worked: report what actually happened
      // rather than assuming the expected refusal. A committed plant starts a
      // real flavor cast (professions/farming.ts FARMING_CAST_ID); it must be
      // run to completion with real ticks before anything else touches this
      // actor, or the next command reads `p.castingAbility` as still set and
      // refuses "You are busy" (never a hand-clear of casting state).
      lateCastTicks += runCastToCompletion(lateSim, lateActor).ticks;
      nowMs += lateCrop.durationMs + 1;
      lateWaitSeconds += lateCrop.durationMs / 1000;
      const before = snapshotCounts(lateSim, latePid, [
        lateCrop.produceItemId,
        lateCrop.fineProduceItemId,
      ]);
      (lateSim.harvestCrop as NonNullable<HarnessSim['harvestCrop']>)(LATE_FARM_BED_ID, latePid);
      const after = snapshotCounts(lateSim, latePid, [
        lateCrop.produceItemId,
        lateCrop.fineProduceItemId,
      ]);
      const gained = diffUnits(before, after, 'farm');
      if (gained.length > 0) {
        successes++;
        lateUnits.push(...gained);
        lateFineGathered += gained
          .filter((u) => u.itemId === lateCrop.fineProduceItemId)
          .reduce((sum, u) => sum + u.qty, 0);
      } else {
        denied++;
      }
    } else {
      denied++;
      notes.push(
        `plant refused with only the tier-1 starter hoe (${FARM_HOE_ITEM_ID}): ${plantDenial}`,
      );
      if (typeof b.setGatheringProficiency !== 'function') {
        notes.push(
          'setGatheringProficiency binding unavailable on this tree; the properly-equipped retry was skipped',
        );
      } else {
        lateSim.addItem(LATE_HOE_ITEM_ID, 1, latePid);
        b.setGatheringProficiency(lateSim, 'farming', MAX_GATHERING_PROFICIENCY, latePid);
        // Bounded, real grow-and-harvest cycles once properly equipped and
        // skilled: replant each cycle (a harvested plot needs a fresh seed),
        // advance the crop's own real duration, then harvest. A NORMAL
        // harvest that lands zero of the FINE grade is still a real success
        // (a plant/harvest cycle actually completed): the fine grade is a
        // per-pick RNG chance (the golden-harvest roll), never guaranteed by
        // tier or proficiency, so only a genuinely denied cycle counts
        // against `denied`. The loop stops once the recipe's own required
        // fine count is reached or the cycle budget is spent, whichever
        // comes first; it never claims the whole recipe complete.
        for (
          let cycle = 0;
          cycle < MAX_LATE_FARM_CYCLES && lateFineGathered < requiredFine;
          cycle++
        ) {
          lateSim.addItem(lateCrop.seedItemId, 1, latePid);
          attempts++;
          const cycleEventsStart = lateSim.events.length;
          (lateSim.plantCrop as NonNullable<HarnessSim['plantCrop']>)(
            LATE_FARM_BED_ID,
            LATE_CROP_ID,
            undefined,
            latePid,
          );
          const cyclePlantDenial = latestDenialText(lateSim, cycleEventsStart);
          if (cyclePlantDenial) {
            denied++;
            notes.push(
              `cycle ${cycle + 1}: plant STILL refused with a real tier-4 hoe (${LATE_HOE_ITEM_ID}) and max farming proficiency: ${cyclePlantDenial}`,
            );
            break;
          }
          // Same real flavor cast as the first plant above: run it to
          // completion before the harvest call, or every cycle past the
          // first refuses "You are busy" and the loop can never repeat a
          // real action.
          lateCastTicks += runCastToCompletion(lateSim, lateActor).ticks;
          nowMs += lateCrop.durationMs + 1;
          lateWaitSeconds += lateCrop.durationMs / 1000;
          const before = snapshotCounts(lateSim, latePid, [
            lateCrop.produceItemId,
            lateCrop.fineProduceItemId,
          ]);
          const harvestEventsStart = lateSim.events.length;
          (lateSim.harvestCrop as NonNullable<HarnessSim['harvestCrop']>)(
            LATE_FARM_BED_ID,
            latePid,
          );
          const harvestDenial = latestDenialText(lateSim, harvestEventsStart);
          const after = snapshotCounts(lateSim, latePid, [
            lateCrop.produceItemId,
            lateCrop.fineProduceItemId,
          ]);
          const gained = diffUnits(before, after, 'farm');
          if (gained.length > 0) {
            successes++;
            lateUnits.push(...gained);
            const fineThisCycle = gained
              .filter((u) => u.itemId === lateCrop.fineProduceItemId)
              .reduce((sum, u) => sum + u.qty, 0);
            lateFineGathered += fineThisCycle;
            notes.push(
              `cycle ${cycle + 1}: properly equipped/skilled harvest SUCCEEDED, granted ${gained.map((u) => `${u.qty}x ${u.itemId}`).join(', ')} after the crop's real ${(lateCrop.durationMs / 1000).toFixed(0)}s grow interval`,
            );
          } else {
            denied++;
            notes.push(
              `cycle ${cycle + 1}: properly equipped/skilled harvest granted nothing${harvestDenial ? `: ${harvestDenial}` : ''}`,
            );
          }
        }
      }
    }
  }
  units.push(...lateUnits);
  notes.push(
    `late farm: ${lateFineGathered} of ${requiredFine} required fine ${lateCrop.fineProduceItemId} gathered across every real harvest (normal and fine grants both counted as a real success; fine yield is a per-pick RNG chance, not guaranteed by tier)`,
  );
  for (const reagent of late.reagents) {
    notes.push(
      reagentLine(b, reagent, reagent.itemId === lateCrop.fineProduceItemId ? lateFineGathered : 0),
    );
  }

  return {
    ...m,
    attempts,
    successfulHarvests: successes,
    deniedAttempts: denied,
    harvestedUnits: units,
    castSimSeconds: (earlyCastTicks + lateCastTicks) / 20,
    elapsedSimSeconds: (earlyCastTicks + lateCastTicks) / 20 + lateWaitSeconds,
    notes: [
      'a BOUNDED real acquisition example, not a full recipe completion: reports required vs actually-gathered per reagent, never a claim the whole recipe was crafted',
      'other acquisition sources are named with their real required count and explicitly NOT attempted',
      ...notes,
    ],
  };
}

export function runAllScenarios(b: HarnessBindings): ScenarioMeasurement[] {
  const runners: (() => ScenarioMeasurement | ScenarioMeasurement[])[] = [
    () => corpseOrdinaryInteract(b),
    () => corpseDeliberateHarvest(b, 'corpse_intentional_all', undefined),
    () => corpseDeliberateHarvest(b, 'corpse_intentional_focused', HIDE_ITEM_ID),
    () => corpseFullBagPressure(b),
    () => corpsePartySharedSupply(b),
    () => corpseLiveTravelAndCast(b),
    () => corpsePremiumYieldSample(b),
    () => nodeBulkYieldSample(b),
    () => NODE_TYPES.map((type) => nodeLiveTravelAndCast(b, type)),
    () => farmingPlantAndHarvest(b),
    () => fishingActionLifecycleSample(b),
    () => recipeRequiredVsGathered(b),
  ];
  const out: ScenarioMeasurement[] = [];
  for (const run of runners) {
    try {
      const result = run();
      if (Array.isArray(result)) out.push(...result);
      else out.push(result);
    } catch (err) {
      out.push({
        ...emptyMeasurement('unknown', 'unknown', b.repoLabel, HARNESS_SEED),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out.map((measurement) => ({
    ...measurement,
    harvestedUnits: foldHarvestUnits(measurement.harvestedUnits),
  }));
}
