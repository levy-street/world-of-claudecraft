// Professions 2.0: ONE real Sim scripted through the deed
// beats end to end, with NO direct grantDeed shortcuts anywhere: every unlock
// below lands through its live site (the craft command, the quest-validated
// attunement, a real masterwork proc, the queued-grant proficiency drain, the
// bite-and-reel fishing loop, the gather-cast rare events, and the corpse
// specimen jackpot). The it-blocks run in file order over the shared sim (the
// keep-ledger idiom), so each beat starts from the world the previous beat
// left behind, exactly like a play session.
//
// Hunted literals: every stochastic beat runs a bounded hunt over the shared
// deterministic rng stream and PINS the observed hit as a literal beside the
// hunt (suite idiom: only the pinned literal is committed). Re-hunt them
// together if PLAYTHROUGH_SEED, an earlier beat, or any draw site upstream
// changes.
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { LAKE, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { startFishing } from '../src/sim/professions/fishing';
import { queueGatheringGrant } from '../src/sim/professions/gathering';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { FISHING_CAST_ID, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const PLAYTHROUGH_SEED = 4242;
const PAIR = 'weaponcrafting+armorcrafting';
const SMITH_MASTER = 'forgemistress_darva';
const VESTMENTS_RECIPE = 'recipe_eastbrook_ritual_vestments';
const KOI = 'glimmerfin_koi';

const sim = new Sim({ seed: PLAYTHROUGH_SEED, playerClass: 'warrior', autoEquip: true });
const pid = sim.playerId;
const meta = sim.players.get(pid) as PlayerMeta;
const player = sim.entities.get(pid)!;

function deedEvents(evs: SimEvent[]): Extract<SimEvent, { type: 'deedUnlocked' }>[] {
  return evs.filter((ev): ev is Extract<SimEvent, { type: 'deedUnlocked' }> => {
    return ev.type === 'deedUnlocked';
  });
}

function moveToNpc(templateId: string): void {
  const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  player.pos.x = npc.pos.x + 1;
  player.pos.z = npc.pos.z;
  player.prevPos = { ...player.pos };
}

function teleportTo(x: number, z: number): void {
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = terrainHeight(x, z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

/** Delete every inventory slot holding `itemId` (plain or instance). State
 *  cleanup between hunt iterations only: never draws, never grants. */
function purgeItem(itemId: string): void {
  for (let i = meta.inventory.length - 1; i >= 0; i--) {
    if (meta.inventory[i].itemId === itemId) meta.inventory.splice(i, 1);
  }
}

// The marquee bar, mirrored from server/deeds_records.ts isMarqueeDeed (kept
// inline so this suite stays sim-pure: importing the server module drags the
// db pool into the graph; the REAL predicate agreeing with these inputs is
// pinned in tests/deed_records.test.ts, profession exemplar included).
function marqueeBar(deedId: string): boolean {
  const def = DEEDS[deedId];
  return def.renown >= 25 || def.reward !== undefined;
}

describe('scripted playthrough (one sim, live sites only)', () => {
  it('beat 1: the first successful craft lands Made By Hand through the craft command', () => {
    sim.tick(); // settle spawn
    expect(meta.deedsEarned.has('prog_first_craft')).toBe(false);
    sim.addItem('linen_scrap', 3, pid);
    sim.addItem('spider_leg', 1, pid);
    // The vestments recipe gained cloth and thread volume.
    sim.addItem('homespun_cloth', 3, pid);
    sim.addItem('spool_of_thread', 5, pid);
    sim.craftItem(VESTMENTS_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    // Hunted precondition of the whole run: seed 4242's FIRST craft does not
    // masterwork-proc (base 3 percent), so the Masterwright beat below stays
    // a distinct moment.
    expect(sim.lastCraftResult?.masterwork).toBeUndefined();
    const evs = sim.tick();
    expect(meta.deedsEarned.has('prog_first_craft')).toBe(true);
    expect(deedEvents(evs).some((ev) => ev.deedId === 'prog_first_craft')).toBe(true);
  });

  it('beat 2: the quest-validated attunement is the Craftsworn moment (marquee, titled)', () => {
    const renownBefore = meta.renown;
    moveToNpc(SMITH_MASTER);
    sim.acceptQuest('q_prof_attune_smith', PAIR);
    const qp = sim.questLog.get('q_prof_attune_smith');
    if (!qp) throw new Error('attune quest not accepted');
    qp.counts = [...(qp.resolvedCounts ?? [])];
    qp.state = 'ready';
    moveToNpc(SMITH_MASTER);
    sim.turnInQuest('q_prof_attune_smith');
    expect(meta.archetype.attunedPairs).toContain(PAIR);
    expect(meta.deedStats.counters.attunementsCompleted).toBe(1);
    const evs = sim.tick();
    expect(evs.some((e) => e.type === 'attuned' && e.pairId === PAIR)).toBe(true);
    const ev = deedEvents(evs).find((e) => e.deedId === 'prog_guildsworn');
    expect(ev).toBeDefined();
    expect(ev?.pid).toBe(pid);
    expect(ev?.retro).toBeUndefined(); // a live grant, not the veteran heal
    expect(meta.renown).toBe(renownBefore + 25);
    expect(DEEDS.prog_guildsworn.reward).toEqual({ kind: 'title', text: 'Craftsworn' });
    expect(marqueeBar('prog_guildsworn')).toBe(true);
    // The title reward is immediately selectable (the nameplate surface).
    sim.setActiveTitle('prog_guildsworn', pid);
    expect(meta.activeTitle).toBe('prog_guildsworn');
  });

  it('beats 3 to 5: the armorcrafting ladder lands 50, the Specialist at 75, Grandmaster at 125', () => {
    expect(meta.deedsEarned.has('prog_armorcrafting_50')).toBe(false);
    sim.gainCraftSkill(pid, 'armorcrafting', 50 - meta.craftSkills.armorcrafting);
    sim.ctx.markDeedsDirty(pid);
    sim.tick();
    expect(meta.deedsEarned.has('prog_armorcrafting_50')).toBe(true);
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(false);

    sim.gainCraftSkill(pid, 'armorcrafting', 25);
    sim.ctx.markDeedsDirty(pid);
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(true);
    expect(meta.deedsEarned.has('prog_grandmaster_armorcrafting')).toBe(false);

    sim.gainCraftSkill(pid, 'armorcrafting', 50);
    expect(meta.craftSkills.armorcrafting).toBe(125); // the resolved cap
    sim.ctx.markDeedsDirty(pid);
    const evs = sim.tick();
    expect(meta.deedsEarned.has('prog_grandmaster_armorcrafting')).toBe(true);
    expect(deedEvents(evs).some((ev) => ev.deedId === 'prog_grandmaster_armorcrafting')).toBe(true);
    expect(DEEDS.prog_grandmaster_armorcrafting.reward?.kind).toBe('title');
  });

  it('beat 6: a REAL masterwork proc (skill and specialization pushing chance, hunted) is the Masterwright moment', () => {
    expect(meta.deedsEarned.has('prog_masterwright')).toBe(false);
    // Push the proc chance honestly through its real inputs: tailoring at the
    // 125 cap (tier capability above the recipe's tier plus specialization)
    // and a self-signed reagent each attempt, never by stubbing the proc:
    // 0.03 base + 0.05 tiers-above + 0.02 signed + 0.03 specialized = 0.13.
    sim.gainCraftSkill(pid, 'tailoring', 125 - meta.craftSkills.tailoring);
    let procAt = -1;
    for (let i = 0; i < 120 && procAt < 0; i++) {
      // Session-only pacing state, reset per attempt so the hunt spends rng
      // draws only through the ONE proc roll per successful craft (the shared
      // action throttle would otherwise deny, which draws nothing and would
      // stall the hunt).
      meta.craftThrottle.count = 0;
      sim.addItemInstance('linen_scrap', { signer: meta.name }, pid);
      sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.addItem('homespun_cloth', 3, pid);
      sim.addItem('spool_of_thread', 5, pid);
      sim.craftItem(VESTMENTS_RECIPE, false, pid);
      if (!sim.lastCraftResult?.ok)
        throw new Error(`craft ${i} denied: ${sim.lastCraftResult?.reason}`);
      if (sim.lastCraftResult.masterwork === true) procAt = i;
      else purgeItem('eastbrook_ritual_vestments'); // keep the bags clear between attempts
    }
    // Hunted literal (seed 4242, this exact beat order): the proc lands on
    // attempt index 10.
    expect(procAt).toBe(10);
    expect(meta.deedStats.counters.masterworksCrafted).toBe(1);
    const evs = sim.tick();
    const ev = deedEvents(evs).find((e) => e.deedId === 'prog_masterwright');
    expect(ev).toBeDefined();
    expect(ev?.retro).toBeUndefined();
    expect(meta.deedsEarned.has('prog_masterwright')).toBe(true);
    expect(DEEDS.prog_masterwright.reward).toEqual({ kind: 'title', text: 'Masterwright' });
    expect(marqueeBar('prog_masterwright')).toBe(true);
    // The proc copy itself is real: a signed masterwork instance in the bags.
    const mw = meta.inventory.find(
      (s) => s.itemId === 'eastbrook_ritual_vestments' && s.instance?.rolled?.masterwork === true,
    );
    expect(mw).toBeDefined();
  });

  it('beats 7 and 8: fishing proficiency 100 and the 200 cap land Old Salt and Master Angler', () => {
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(false);
    queueGatheringGrant(meta, 'fishing', 100 - meta.gatheringProficiency.fishing);
    sim.tick(); // the live drain applies the grant and sweeps the deeds
    expect(meta.gatheringProficiency.fishing).toBe(100);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(true);
    expect(meta.deedsEarned.has('prog_master_angler')).toBe(false);

    queueGatheringGrant(meta, 'fishing', 100);
    const evs = sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(200); // fishing's cap
    expect(deedEvents(evs).some((ev) => ev.deedId === 'prog_master_angler')).toBe(true);
    expect(DEEDS.prog_master_angler.reward).toEqual({ kind: 'title', text: 'Master Angler' });
    expect(marqueeBar('prog_master_angler')).toBe(true);
  });

  it('beat 9: Master Gatherer completes WITH fishing as one of its three', () => {
    expect(meta.deedsEarned.has('prog_master_gatherer')).toBe(false);
    queueGatheringGrant(meta, 'mining', 100 - meta.gatheringProficiency.mining);
    queueGatheringGrant(meta, 'logging', 100 - meta.gatheringProficiency.logging);
    sim.tick();
    // Herbalism is still untouched at the moment of the grant, so fishing is
    // provably the third profession of the any-three trigger.
    expect(meta.gatheringProficiency.herbalism).toBe(0);
    expect(meta.deedsEarned.has('prog_master_gatherer')).toBe(true);
  });

  it('beat 10: a bite left to expire gets away: no catch, no collection credit', () => {
    // The negative half of the bite-and-reel contract, and the standing proof
    // that col_glimmerfin below cannot land without the reel: a session whose
    // reel window expires loses the catch outright (one bite-delay draw spent,
    // no table draw, nothing granted).
    teleportTo(LAKE.x, LAKE.z - LAKE.radius - 2);
    player.facing = 0; // due north, into the lake
    // Stagecraft, not the contract under test: this seed's shoreline murloc
    // pack mauls a level-1 angler mid-session (fishing refuses in combat and
    // a dead player cannot cast), so the LOCAL pack is laid to rest first,
    // dead with a far respawn, the same corpse shaping the specimen beat
    // uses. The bite-and-reel contract below still runs over the real
    // ticking world.
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (dx * dx + dz * dz < 60 * 60) {
        e.dead = true;
        e.aiState = 'dead';
        e.hp = 0;
        e.respawnTimer = 9999;
        e.corpseTimer = 9999;
      }
    }
    const koiBefore = sim.countItem(KOI, pid);
    startFishing(sim.ctx, player, meta);
    expect(player.castingAbility).toBe(FISHING_CAST_ID);
    const drained: SimEvent[] = [];
    let guard = 0;
    while (player.fishReelDeadlineTick === 0 && guard++ < 400) drained.push(...sim.tick());
    expect(player.fishReelDeadlineTick).toBeGreaterThan(0); // the bite fired
    expect(drained.some((e) => e.type === 'fishingBite')).toBe(true);
    // Never reel: run the window out to the got-away arm.
    guard = 0;
    while (player.castingAbility === FISHING_CAST_ID && guard++ < 400) drained.push(...sim.tick());
    expect(drained.some((e) => e.type === 'fishingGotAway')).toBe(true);
    expect(drained.some((e) => (e as { type: string }).type === 'fishingResult')).toBe(false);
    expect(sim.countItem(KOI, pid)).toBe(koiBefore);
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(false);
  });

  it('beat 11: the koi lands through the REAL bite-and-reel loop and the deed fires on the catch', () => {
    let koiSession = -1;
    let sawBiteOnKoiSession = false;
    for (let s = 0; s < 120 && koiSession < 0; s++) {
      // A wandering mob can tag the shore: fishing refuses in combat, so wait
      // it out (bounded); the pinned session literal locks whatever the
      // deterministic world does here.
      let guard = 0;
      while (player.inCombat && guard++ < 2000) sim.tick();
      const before = sim.countItem(KOI, pid);
      startFishing(sim.ctx, player, meta);
      if (player.castingAbility !== FISHING_CAST_ID) throw new Error(`session ${s} did not cast`);
      // Tick the REAL world to the drawn bite (the lifecycle fires it and
      // arms the server-authoritative reel window).
      guard = 0;
      let bit = false;
      while (player.fishReelDeadlineTick === 0 && guard++ < 400) {
        if (sim.tick().some((e) => e.type === 'fishingBite')) bit = true;
      }
      if (player.fishReelDeadlineTick === 0) throw new Error(`session ${s} never bit`);
      // Reel inside the window: the table draw resolves the catch NOW.
      startFishing(sim.ctx, player, meta);
      expect(player.castingAbility).toBeNull(); // the reel ended the session
      if (sim.countItem(KOI, pid) > before) {
        koiSession = s;
        sawBiteOnKoiSession = bit;
      }
    }
    // Hunted literal (seed 4242, after every beat above): the koi bites on
    // session index 16.
    expect(koiSession).toBe(16);
    expect(sawBiteOnKoiSession).toBe(true); // the celebration follows the bite moment
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(false); // grant sweeps at the tick tail
    const evs = sim.tick();
    const ev = deedEvents(evs).find((e) => e.deedId === 'col_glimmerfin');
    expect(ev).toBeDefined();
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(true);
  });

  it('beats 12 to 14: every node rare-find deed lands through its real gather-cast event', () => {
    // Bank the run's loot: the hunts need free bags for the x5 windfalls, and
    // no later beat reads the inventory. Pure state cleanup, zero draws.
    meta.inventory.length = 0;
    // Hunted literals (seed 4242, after every beat above): the harvest index
    // where each flavor's 1-in-90 event fires under the shared stream.
    const hunts: { nodeId: string; deedId: string; itemId: string; hitAt: number }[] = [
      { nodeId: 'ore_eastbrook_1', deedId: 'col_pristine_vein', itemId: 'copper_ore', hitAt: 271 },
      {
        nodeId: 'wood_eastbrook_1',
        deedId: 'col_ancient_heartwood',
        itemId: 'ironbark_log',
        hitAt: 156,
      },
      {
        nodeId: 'herb_eastbrook_1',
        deedId: 'col_moonlit_bloom',
        itemId: 'silverleaf_herb',
        hitAt: 5,
      },
    ];
    for (const hunt of hunts) {
      const node = GATHER_NODES.find((n) => n.id === hunt.nodeId);
      if (!node) throw new Error(`missing node ${hunt.nodeId}`);
      teleportTo(node.pos.x, node.pos.z);
      expect(meta.deedsEarned.has(hunt.deedId)).toBe(false);
      let hitAt = -1;
      for (let i = 0; i < 2000 && hitAt < 0; i++) {
        // Session-only cooldown and bag state reset per iteration, so every
        // pass is a clean granted harvest advancing ONLY the shared stream
        // (the gather_rare_events.test.ts hunt idiom).
        purgeItem(hunt.itemId);
        delete meta.nodeHarvestReadyAt[hunt.nodeId];
        if (!sim.harvestNode(hunt.nodeId, pid)) throw new Error(`${hunt.nodeId} cast denied`);
        player.castingAbility = null;
        player.castRemaining = 0;
        sim.ctx.completeGatherCast(player, meta);
        if (meta.deedStats.visited.has(`gather_event:${hunt.deedId.slice(4)}`)) hitAt = i;
      }
      expect(hitAt, hunt.deedId).toBe(hunt.hitAt);
      const renownBefore = meta.renown;
      const evs = sim.tick(); // the visit mark sweeps at the tail
      expect(meta.deedsEarned.has(hunt.deedId)).toBe(true);
      // Luck-based finds are renown 0 by doctrine: THIS deed's grant paid
      // nothing (incidental discovery deeds from the windfall loot, e.g. a
      // first epic-quality roll, can land beside it and pay their own).
      expect(DEEDS[hunt.deedId].renown).toBe(0);
      const paid = deedEvents(evs).reduce((sum, ev) => sum + DEEDS[ev.deedId].renown, 0);
      expect(meta.renown).toBe(renownBefore + paid);
    }
  });

  it('beat 15: the perfect specimen jackpot lands through the real corpse harvest', () => {
    expect(meta.deedsEarned.has('col_perfect_specimen')).toBe(false);
    // A dead harvestable wolf at the player's feet (the corpse_harvest_sim
    // idiom); the claim is reset per attempt so each pass re-runs the REAL
    // harvest command with its one tier roll and one rarity roll.
    const template = MOBS.forest_wolf;
    const mob = createMob(987654, template, template.maxLevel, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z,
    });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    sim.entities.set(mob.id, mob);
    let hitAt = -1;
    for (let i = 0; i < 400 && hitAt < 0; i++) {
      mob.harvestClaimedBy = null;
      purgeItem('rough_hide');
      sim.harvestCorpse(mob.id, ['hide'], pid);
      if (sim.countItem('pristine_hide', pid) > 0) hitAt = i;
    }
    // Hunted literal (seed 4242, after every beat above): the rare-or-better
    // rarity roll that mints the signed specimen lands on attempt index 20.
    expect(hitAt).toBe(20);
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance?.signer).toBe(meta.name);
    expect(meta.deedStats.visited.has('gather_event:perfect_specimen')).toBe(true);
    sim.tick();
    expect(meta.deedsEarned.has('col_perfect_specimen')).toBe(true);
    sim.entities.delete(mob.id);
  });

  it('epilogue: the whole playthrough earned every beat deed exactly once', () => {
    const earned = [
      'prog_first_craft',
      'prog_guildsworn',
      'prog_armorcrafting_50',
      'prog_craft_specialist',
      'prog_grandmaster_armorcrafting',
      'prog_masterwright',
      'prog_fishing_100',
      'prog_master_angler',
      'prog_master_gatherer',
      'col_glimmerfin',
      'col_pristine_vein',
      'col_ancient_heartwood',
      'col_moonlit_bloom',
      'col_perfect_specimen',
    ];
    for (const id of earned) expect(meta.deedsEarned.has(id), id).toBe(true);
    // deedsEarned is a Map, so "exactly once" is structural; the renown total
    // equals the catalog sum of the earned set (grantDeed's incremental
    // bookkeeping never drifted across the run).
    const expected = [...meta.deedsEarned.keys()].reduce((sum, id) => sum + DEEDS[id].renown, 0);
    expect(meta.renown).toBe(expected);
  });
});
