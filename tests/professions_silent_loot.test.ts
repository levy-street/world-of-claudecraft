import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { GATHER_NODES, STATIONS } from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { stationsOfType } from '../src/sim/professions/stations';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, StationType } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Every grant in the game flows through the one shared inventory hub
// (Sim.addItem/addItemInstance), which unconditionally emitted a 'loot'
// event that hud.ts's case 'loot' turns into BOTH a generic
// audio.lootItem()/coin() cue AND a generic "You receive: X" chat line. Every
// profession action also emits its own richer result event with its own cue
// and its own line, so each one produced two cues and two lines for one grant.
//
// Two independent stand-down flags close that, and every profession grant site
// passes BOTH:
//   { silent: true }     the hub's generic CUE stands down (the profession's
//                        own audio.gather/craftSuccess/disenchant/salvage/
//                        enchant/fishReel cue is the only one)
//   { callerLogs: true } the hub's generic LINE stands down (#2430; the
//                        profession's own line is the only one, and carries
//                        the quality color, the quantity and an item link)
// The loot event still CARRIES its text and is still emitted: it is what
// dirties the online self inventory mirror, and the client is what elides the
// line. This file pins the sim half on every profession grant path (gather,
// craft, disenchant, apply-enchant, bagged replace, worn replace, salvage,
// fishing), and pins that every OTHER grant path (quest reward, vendor, mail,
// trade, corpse loot, the once-ever Codfather quest catch) is completely
// unaffected and stays loud and logged. The hud.ts case 'loot' half of the
// contract is pinned in tests/professions_audio_wiring.test.ts, and the
// rendered-line behavior in tests/professions_single_line_grants.test.ts.

function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

// A gather cast (Professions 2.0 Phase 12b) runs multiple real ticks, during
// which a nearby mob's damage can interrupt it (castStop, success: false);
// the gathering_rhythm.test.ts idiom silences mobs first so a cast survives
// to completion deterministically.
function despawnMobs(sim: Sim): void {
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

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  const p = mustEntity(sim, pid);
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

const NODE_ID = GATHER_NODES[0].id;
const NODE_MATERIAL = nodeMaterialFor(GATHER_NODES[0].type, GATHER_NODES[0].zoneId);

function lootEvents(events: SimEvent[]): Array<Extract<SimEvent, { type: 'loot' }>> {
  return events.filter((e): e is Extract<SimEvent, { type: 'loot' }> => e.type === 'loot');
}

// Station-bound recipes gate on POSITION only (the professions_crafting.test.ts
// harness): walk the player onto the first station of the required type.
function placeAtStationFor(sim: Sim, pid: number, stationType: StationType): void {
  const station = stationsOfType(STATIONS, stationType)[0];
  if (!station) throw new Error(`no station of type ${stationType}`);
  const entity = mustEntity(sim, pid);
  entity.pos.x = station.pos.x;
  entity.pos.z = station.pos.z;
  entity.prevPos = { ...entity.pos };
}

describe('professions grants suppress BOTH generic hub feedbacks', () => {
  it('a gather harvest emits a silent, caller-logged loot event', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');
    // Bare-handed harvesting is denied even on a tier-1 node (the starting
    // kit carries no gathering tool); grant the matching tier-1 tool
    // (ore_eastbrook_1 is 'ore', see tests/gather_node_harvest.test.ts's
    // TIER1_TOOL_BY_NODE_TYPE for the full id mapping).
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    meta.inventory.push({ itemId: 'copper_mining_pick', count: 1 });
    teleportOntoNode(sim, pid, NODE_ID);
    despawnMobs(sim);

    // harvestNode only STARTS the gather cast (Professions 2.0 Phase 12b);
    // the actual grant lands later via completeGatherCast once the cast
    // timer runs out. GATHER_CAST_BASE_SEC (2.5s) is the longest possible
    // cast, so 3 seconds of ticks always clears it.
    expect(sim.harvestNode(NODE_ID, pid)).toBe(true);
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 3; i++) events.push(...sim.tick());
    const loot = lootEvents(events);
    expect(loot.length).toBeGreaterThan(0);
    for (const ev of loot) {
      expect(ev.silent).toBe(true);
      expect(ev.callerLogs).toBe(true);
      // The text is still CARRIED (the client elides the line, the sim never
      // goes text-free here): deleting it would break the loot-roll matcher
      // and the sim-side text pins in tests/gather_rare_events.test.ts.
      expect(ev.text).toContain('You receive:');
    }
  });

  it('a plain addItem grant (every non-professions path) stays loud and logged by default', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Vendee');
    sim.addItem(NODE_MATERIAL.itemId, 1, pid);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBeUndefined();
    expect(events[0].callerLogs).toBeUndefined();
  });

  it('a plain addItemInstance grant stays loud and logged by default too', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Enchanter');
    sim.addItemInstance(NODE_MATERIAL.itemId, { signer: 'Test' }, pid);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBeUndefined();
    expect(events[0].callerLogs).toBeUndefined();
  });

  it('each flag is settable on its own (they are independent opt-ins)', () => {
    // The two are separate fields on purpose: a caller may own the cue without
    // owning the line. A regression that collapsed them into one flag (or made
    // one imply the other in the hub) would pass every profession case in this
    // file, since those set both.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Splitter');
    sim.addItem(NODE_MATERIAL.itemId, 1, pid, { silent: true });
    sim.addItem(NODE_MATERIAL.itemId, 1, pid, { callerLogs: true });
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(2);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBeUndefined();
    expect(events[1].silent).toBeUndefined();
    expect(events[1].callerLogs).toBe(true);
  });

  it('an unset flag is ABSENT, never a written-undefined key (the parity-digest contract)', () => {
    // Sim.addItem writes both flags through a conditional spread, not
    // `silent: opts?.silent`. The parity canonicalizer keeps an explicitly
    // undefined key (tests/parity/trace.ts maps it to null), so the naive form
    // would move the event digest of EVERY grant in the game, professions or
    // not. Own-key presence is the only assertion that catches it: a
    // `toBeUndefined()` check passes either way.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Digest');
    sim.addItem(NODE_MATERIAL.itemId, 1, pid);
    const [plain] = lootEvents(sim.tick());
    expect(Object.hasOwn(plain, 'silent')).toBe(false);
    expect(Object.hasOwn(plain, 'callerLogs')).toBe(false);
    sim.addItem(NODE_MATERIAL.itemId, 1, pid, { silent: true });
    const [flagged] = lootEvents(sim.tick());
    expect(Object.hasOwn(flagged, 'silent')).toBe(true);
    expect(Object.hasOwn(flagged, 'callerLogs')).toBe(false);
  });

  it('a successful craft emits (only) silent, caller-logged loot events', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('spider_leg', 1, pid); // the reagent grant itself stays loud
    sim.craftItem('recipe_tough_jerky', false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    // The reagent grant (loud + logged) plus the crafted-output grant (silent
    // + caller-logged): only the output grant should stand down, proving the
    // flags are scoped to the specific craft-output call site, not a blanket
    // suppression.
    expect(events.some((e) => e.silent === true && e.callerLogs === true)).toBe(true);
    expect(events.some((e) => e.silent === undefined && e.callerLogs === undefined)).toBe(true);
  });

  it('EVERY multi-output craft recipe elides every one of its output grants', () => {
    // A resultCount > 1 recipe used to print the crafted line PLUS a hub line
    // per internal grant call. Whatever mix of instanced/fungible arms
    // crafting.ts takes for the output, every one of them must carry both
    // flags, or that recipe reintroduces a second line for the one craft.
    // Driven over ALL of them (content sweep, not one sampled recipe) so a
    // future multi-output recipe on a different arm cannot slip through.
    const multiOutput = ALL_RECIPES.filter((r) => r.resultCount > 1);
    expect(multiOutput.length).toBeGreaterThan(0);
    for (const recipe of multiOutput) {
      const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
      const pid = sim.playerId;
      const meta = sim.players.get(pid);
      if (!meta) throw new Error('missing player meta');
      meta.knownRecipes.add(recipe.id);
      for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count * 4, pid);
      if (recipe.stationType) placeAtStationFor(sim, pid, recipe.stationType);
      sim.tick(); // drain the (loud) reagent grants before isolating the craft
      sim.craftItem(recipe.id, false, pid);
      expect(sim.lastCraftResult?.ok, `${recipe.id}: ${sim.lastCraftResult?.reason}`).toBe(true);
      expect(sim.lastCraftResult?.count, recipe.id).toBeGreaterThan(1);
      const events = lootEvents(sim.tick());
      expect(events.length, recipe.id).toBeGreaterThan(0);
      for (const ev of events) {
        expect(ev.silent, recipe.id).toBe(true);
        expect(ev.callerLogs, recipe.id).toBe(true);
      }
    }
  });

  it('a disenchant emits a silent loot event for the reclaimed material', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.tick(); // drain the (loud) sword grant before isolating the disenchant
    sim.disenchantItem('eastbrook_arming_sword', pid);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBe(true);
  });

  it('an apply-enchant emits a silent loot event for the enchanted copy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    sim.tick(); // drain the (loud) sword + reagent grants before isolating the enchant
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBe(true);
  });

  // The #2415 replace arm mints its own copy through the same hub, so it needs
  // the same suppression: without it a confirmed replace plays the generic loot
  // ding stacked on the dedicated enchant cue, exactly the double-ding this
  // whole file exists to pin. The plain-apply case above cannot see it (a
  // different arm, a different mint), which is why this case is separate.
  it('a confirmed enchant REPLACE emits a silent loot event for the replaced copy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 20, pid);
    sim.tick();
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
    sim.tick(); // drain the first (already silent) apply before isolating the replace
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_intellect', undefined, true);
    expect(sim.lastEnchantResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBe(true);
  });

  // The WORN replace arm writes equipmentInstance in place and never reaches
  // the grant hub, so it must emit NO loot event at all: its single cue is the
  // enchantResult one. Pinned so a future refactor that routes the worn arm
  // through a mint cannot quietly reintroduce the stacked ding.
  it('a confirmed WORN enchant replace emits no loot event at all', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 20, pid);
    sim.tick();
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
    sim.tick();
    sim.equipItem('eastbrook_arming_sword', pid);
    sim.tick();
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_intellect', 'mainhand', true);
    expect(sim.lastEnchantResult?.ok).toBe(true);
    expect(lootEvents(sim.tick()).length).toBe(0);
  });

  it('a salvage emits a silent loot event for the reclaimed material', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.tick(); // drain the (loud) sword grant before isolating the salvage
    sim.salvageItem('eastbrook_arming_sword', pid);
    expect(sim.lastSalvageResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBe(true);
  });

  it('a rare+ disenchant flags its TYPED SECONDARY grants too, one per unit', () => {
    // The worst case #2430 called out: resolveDisenchant grants the typed
    // bind-on-trade secondary in a loop of ONE unit per call, so an epic yield
    // used to print four lines for one action. The case above cannot see this
    // arm at all (a common sword is sub-rare, so no secondary is rolled), which
    // left the highest-count call site the only one unpinned at sim level.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    // A rare weapon: typedSecondaryFor resolves resonant_steel for it, so the
    // yield is a primary PLUS at least one secondary.
    sim.addItem('moggers_copper_cudgel', 1, pid);
    sim.tick(); // drain the (loud) weapon grant before isolating the disenchant
    sim.disenchantItem('moggers_copper_cudgel', pid);
    const result = sim.lastDisenchantResult;
    expect(result?.ok).toBe(true);
    expect(result?.secondaryItemId).toBeTruthy();
    expect(result?.secondaryCount).toBeGreaterThan(0);
    const events = lootEvents(sim.tick());
    // One event for the primary plus one PER SECONDARY UNIT: the count is the
    // point, since every one of them has to stand down or the extra units
    // print extra lines.
    expect(events.length).toBe(1 + (result?.secondaryCount ?? 0));
    for (const ev of events) {
      expect(ev.silent).toBe(true);
      expect(ev.callerLogs).toBe(true);
    }
  });

  // FISHING lives in tests/professions_fishing.test.ts ("landed-catch grant
  // flags (pin 11)"), which owns the Vale/Deepfen shore probes and the
  // codfather quest fixture this contract needs on both arms: the landed catch
  // carries both flags, the once-ever Codfather quest catch carries neither.
});

describe('the craft output arms each stand their hub line down', () => {
  // resolveCraftForRecipe branches four ways on the output (masterwork proc,
  // signable single, commissioned, plain), and the multi-output sweep above
  // only ever reaches the PLAIN arm, because every resultCount > 1 recipe in
  // content is food or an elixir. So the other arms were unpinned by behavior.
  // Each case below asserts which arm it took before asserting the flags, or
  // it would silently drift onto the plain arm and pin nothing new.
  const lootAfterCraft = (sim: Sim) => lootEvents(sim.tick());

  it('a SIGNABLE single-output craft (rare-or-better def) stands both down', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    meta.knownRecipes.add('recipe_thorium_mining_pick');
    meta.craftSkills.toolworks = 75;
    sim.addItem('thorium_ore', 4, pid);
    sim.addItem('mithril_mining_pick', 1, pid);
    placeAtStationFor(sim, pid, 'toolworks');
    sim.tick(); // drain the (loud) reagent grants
    sim.craftItem('recipe_thorium_mining_pick', false, pid);
    expect(sim.lastCraftResult?.ok, sim.lastCraftResult?.reason).toBe(true);
    // The arm identity: a rare def at resultCount 1 mints ONE signed instance,
    // and not via the masterwork branch.
    expect(sim.lastCraftResult?.masterwork).toBeFalsy();
    expect(sim.lastCraftResult?.count).toBe(1);
    const events = lootAfterCraft(sim);
    expect(events).toHaveLength(1);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBe(true);
  });

  it('a COMMISSIONED craft stands both down on every armed copy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    meta.knownRecipes.add('recipe_eastbrook_arming_sword');
    sim.addItem('wolf_fang', 2, pid);
    sim.addItem('bone_fragments', 4, pid);
    sim.addItem('smithing_flux', 6, pid);
    sim.tick();
    sim.craftItem('recipe_eastbrook_arming_sword', true, pid);
    expect(sim.lastCraftResult?.ok, sim.lastCraftResult?.reason).toBe(true);
    // The arm identity: commission forces the instance path even for a
    // sub-rare output a plain grant would leave fungible.
    expect(sim.lastCraftResult?.commission).toBe(true);
    const events = lootAfterCraft(sim);
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      expect(ev.silent).toBe(true);
      expect(ev.callerLogs).toBe(true);
    }
  });

  it('a MASTERWORK proc stands both down on the baked instance', () => {
    // Seed 20 with tailoring at skill 200 is the hunted proc window
    // tests/professions_masterwork.test.ts uses: the second successful
    // vestments craft procs. Reused rather than re-hunted so the two files
    // cannot disagree about which craft is the masterwork one.
    const sim = new Sim({ seed: 20, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('tailoring');
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    meta.craftSkills.tailoring = 200;
    for (let i = 0; i < 12; i++) sim.addItem('linen_scrap', 1, pid);
    for (let i = 0; i < 6; i++) sim.addItem('spider_leg', 1, pid);
    for (let i = 0; i < 9; i++) sim.addItem('homespun_cloth', 1, pid);
    for (let i = 0; i < 15; i++) sim.addItem('spool_of_thread', 1, pid);
    sim.tick();
    sim.craftItem('recipe_eastbrook_ritual_vestments', false, pid);
    sim.tick();
    sim.craftItem('recipe_eastbrook_ritual_vestments', false, pid);
    expect(sim.lastCraftResult?.ok, sim.lastCraftResult?.reason).toBe(true);
    // The arm identity, and the whole point of the case.
    expect(sim.lastCraftResult?.masterwork).toBe(true);
    const events = lootAfterCraft(sim);
    expect(events).toHaveLength(1);
    expect(events[0].silent).toBe(true);
    expect(events[0].callerLogs).toBe(true);
  });

  // The two remaining arms (a masterwork proc or a commission on a
  // resultCount > 1 recipe) are unreachable with today's content: all four
  // multi-output recipes are food or elixirs, which bake no bonus stats and
  // are not commission-eligible. They stay defensive, covered by the
  // call-site sweep below rather than by a case that cannot be driven.
});

describe('every professions grant site is accounted for (#2430)', () => {
  // The behavioral pins above cover the flows someone thought to drive. The
  // gap this closes is the one that actually shipped: the Maker's Bond unbind
  // peel in commission.ts was a professions grant with its own result line,
  // and NOTHING enumerated the call sites, so it sat unflagged through the
  // whole sweep. This walks the directory instead, so a NEW grant site added
  // by a later phase has to make a deliberate choice rather than inherit the
  // old double-log by omission.
  const dir = path.resolve(process.cwd(), 'src/sim/professions');

  // Sites that deliberately carry NEITHER flag, keyed by a stable substring of
  // the call itself. A grant belongs here ONLY when no result event follows it,
  // because eliding the hub line for it would make the grant invisible.
  const NO_RESULT_EVENT_GRANTS = [
    // fishing.ts: the once-ever Codfather quest catch returns before the
    // fishingResult emit, so the hub line and ding are its only feedback.
    'THE_CODFATHER_ITEM_ID',
  ];

  // Source with comments removed (`://` protocol slashes preserved), the repo's
  // raw-source-pin idiom (tests/server/board_read_single_flight.test.ts). Every
  // pin below matches on call TEXT, so without this a flag left behind as a
  // comment satisfies the sweep, and the idiomatic way to disable a trailing
  // optional argument is exactly to comment it out in place, leaving the flag
  // words sitting inside the call's own parentheses.
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Every ctx.addItem / ctx.addItemInstance call in `source`, each as the full
   *  call text (paren-balanced, so a multi-line opts object is included). */
  const grantCalls = (source: string): string[] => {
    const calls: string[] = [];
    const re = /\bctx\.addItem(?:Instance)?\(/g;
    let m = re.exec(source);
    while (m) {
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (; end < source.length; end++) {
        if (source[end] === '(') depth++;
        else if (source[end] === ')' && --depth === 0) break;
      }
      calls.push(source.slice(m.index, end + 1));
      m = re.exec(source);
    }
    return calls;
  };

  /** The brace-balanced body of the named top-level function in `source`. */
  const functionBody = (source: string, signature: string): string => {
    const at = source.indexOf(signature);
    expect(at, `${signature} not found`).toBeGreaterThan(-1);
    const open = source.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}' && --depth === 0) break;
    }
    return source.slice(open, end + 1);
  };

  // #2457: corpse harvest is a professions grant flow that does NOT live in
  // src/sim/professions (it is a command body in interaction.ts), so the
  // directory walk above could never see it, and its six grants sat unflagged
  // through the whole of #2430. Only harvestCorpse's own body joins the sweep:
  // the other grants in that file (lootCorpse's distribution, pickUpObject)
  // are ordinary loot and must keep printing the hub line.
  const harvestBody = functionBody(
    codeOnly(readFileSync(path.resolve(process.cwd(), 'src/sim/interaction.ts'), 'utf8')),
    'export function harvestCorpse(',
  );

  const sites = [
    ...readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .flatMap((file) =>
        grantCalls(codeOnly(readFileSync(path.join(dir, file), 'utf8'))).map((call) => ({
          file,
          call,
        })),
      ),
    ...grantCalls(harvestBody).map((call) => ({ file: 'interaction.ts:harvestCorpse', call })),
  ];

  it('the scanner actually finds the grant sites (never passes vacuously)', () => {
    // A regex that stopped matching would make the sweep below green while
    // checking nothing, so bind both the count and the shape.
    expect(sites.length).toBeGreaterThanOrEqual(19);
    expect(sites.some((s) => s.file === 'commission.ts')).toBe(true);
    expect(sites.some((s) => s.call.includes('callerLogs: true'))).toBe(true);
    // The balanced-paren walk must capture the whole call, opts object and all,
    // or every site would read as unflagged and the exclusion list would have
    // to grow to hide it.
    expect(sites.find((s) => s.file === 'salvage.ts')?.call).toContain('callerLogs: true');
  });

  it('the harvestCorpse slice is the whole function and nothing but the function', () => {
    // Two ways the slice could go wrong and leave the sweep green while
    // checking the wrong thing: stopping early (the six grants shrink to
    // fewer, so a real unflagged one hides outside the window) or running past
    // the function's closing brace into the ordinary loot grants below, which
    // legitimately carry neither flag and would turn the sweep permanently
    // red. Bind both ends.
    const harvestSites = sites.filter((s) => s.file === 'interaction.ts:harvestCorpse');
    expect(harvestSites).toHaveLength(6);
    // BOTH flags, and only for these six. The shared sweep below can only ask
    // for `callerLogs`, because a caller may legitimately own the line without
    // the cue (commission.ts's Maker's Bond unbind peel does exactly that), so
    // `silent` would go unchecked everywhere if it were not pinned here. Corpse
    // harvest owns both halves: its result event logs its own lines AND plays
    // its own single cue, so a site that kept `callerLogs` but lost `silent`
    // would give one harvest two cues (#2457 acceptance criterion 3).
    for (const site of harvestSites) {
      const call = site.call.replace(/\s+/g, ' ');
      expect(call, call).toContain('silent: true');
      expect(call, call).toContain('callerLogs: true');
    }
    // pickUpObject's grant is the nearest one outside the function.
    expect(harvestBody).not.toContain('objectItemId');
    // ... and the sliced window really is harvestCorpse: its last statement,
    // the corpse-timer clamp, is inside it.
    expect(harvestBody).toContain('CORPSE_INTERACT_GRACE_SECONDS');
  });

  it('every grant either stands its hub line down or is a named no-result-event grant', () => {
    const unaccounted = sites.filter(
      (s) =>
        !s.call.includes('callerLogs: true') &&
        !NO_RESULT_EVENT_GRANTS.some((marker) => s.call.includes(marker)),
    );
    expect(
      unaccounted.map((s) => `${s.file}: ${s.call.replace(/\s+/g, ' ')}`),
      'a professions grant that neither sets callerLogs nor is a documented no-result-event grant',
    ).toEqual([]);
  });

  it('the exclusion list has no stale entries', () => {
    // A marker whose call went away (renamed, deleted) would silently widen
    // the allowance for whatever call text happens to contain it next.
    for (const marker of NO_RESULT_EVENT_GRANTS) {
      expect(
        sites.filter((s) => s.call.includes(marker)),
        `exclusion marker ${marker} matches no grant call`,
      ).toHaveLength(1);
    }
  });
});
