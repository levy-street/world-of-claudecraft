// The Proving Shore (tutorial island) content pins: every authored position
// sits on dry, walkable ground on the real terrain, the strait to the vale is
// honest open water, the on-rails chain is a strict rail (each quest requires
// the previous), every quest pays copper and XP (the rail graduates a level
// 3, no higher by quests alone), and the chain's total pays for the full
// tier-1 gathering tool set the quartermaster stocks.

import { describe, expect, it } from 'vitest';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { NOTICEBOARDS } from '../src/sim/content/noticeboards';
import {
  BOOTCAMP_COURSE_CHECKPOINTS,
  PROVING_SHORE_ARRIVAL,
  PROVING_SHORE_CAMPS,
  PROVING_SHORE_MOBS,
  PROVING_SHORE_NPCS,
  PROVING_SHORE_OBJECTS,
  PROVING_SHORE_PORTALS,
  PROVING_SHORE_PROPS,
  PROVING_SHORE_QUEST_ORDER,
  PROVING_SHORE_QUESTS,
  PROVING_SHORE_ROADS,
  PROVING_SHORE_ZONE,
} from '../src/sim/content/proving_shore';
import { ITEMS, ZONES } from '../src/sim/data';
import { FERRY_BELL_TOWN_LANDING } from '../src/sim/interactions/ferry_bell';
import { mobXpValue, xpForLevel } from '../src/sim/types';
import { groundHeight, provingLandness, terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const PLAYER_MAX_CLIMB_SLOPE = 1.5;

function dry(x: number, z: number): boolean {
  return groundHeight(x, z, WORLD_SEED) >= WATER_LEVEL + 0.5;
}
function walkable(x: number, z: number): boolean {
  return terrainSteepnessAt(x, z, WORLD_SEED) <= PLAYER_MAX_CLIMB_SLOPE;
}

describe('proving shore placement', () => {
  it('registers the zone', () => {
    expect(ZONES.some((zn) => zn.id === 'proving_shore')).toBe(true);
  });

  it('pins the town landing literally, beside the harbor return bell', () => {
    // The home ride's destination as bare literals (the ferry_prewarm suite
    // compares constant to constant, which a bad edit moves in lockstep).
    // Moved with the New Eastbrook rebuild: the dock road's crafts lane,
    // beside the return bell at (-7.5, -100), facing the mailbox.
    expect(FERRY_BELL_TOWN_LANDING).toEqual({ x: -4.5, z: -101.5, facing: -0.87 });
  });

  it('hub, graveyard, pois, arrival, npcs, camps, and crates sit on dry walkable ground', () => {
    const points: { x: number; z: number; what: string }[] = [
      { ...PROVING_SHORE_ZONE.hub, what: 'hub' },
      { ...PROVING_SHORE_ZONE.graveyard, what: 'graveyard' },
      ...PROVING_SHORE_ZONE.pois.map((p) => ({ x: p.x, z: p.z, what: `poi:${p.id}` })),
      { x: PROVING_SHORE_ARRIVAL.x, z: PROVING_SHORE_ARRIVAL.z, what: 'arrival' },
      // The home ride's landing too (interactions/ferry_bell.ts): the one
      // teleport destination this sweep used to miss, so a landing dropped in
      // the harbour could pass (PR #3467 review).
      {
        x: FERRY_BELL_TOWN_LANDING.x,
        z: FERRY_BELL_TOWN_LANDING.z,
        what: 'ferry town landing',
      },
      ...Object.values(PROVING_SHORE_NPCS)
        .filter((n) => n.id !== 'wayfarer_bryn') // the greeter stands in Eastbrook
        .map((n) => ({ x: n.pos.x, z: n.pos.z, what: `npc:${n.id}` })),
      ...PROVING_SHORE_CAMPS.map((c) => ({ ...c.center, what: `camp:${c.mobId}` })),
      ...PROVING_SHORE_OBJECTS.flatMap((o) =>
        o.positions.map((p, i) => ({ x: p.x, z: p.z, what: `object:${o.itemId}[${i}]` })),
      ),
      // The Gauntlet's furniture and the camp's perimeter rails: every fence
      // post, mantle box, and checkpoint flag stands on dry walkable ground.
      ...(PROVING_SHORE_PROPS.fences ?? []).flatMap((f, i) => [
        { x: f.x1, z: f.z1, what: `fence[${i}].a` },
        { x: f.x2, z: f.z2, what: `fence[${i}].b` },
      ]),
      ...(PROVING_SHORE_PROPS.crates ?? []).map(([x, z], i) => ({ x, z, what: `crate[${i}]` })),
      ...(PROVING_SHORE_PROPS.decorProps ?? []).map((d, i) => ({
        x: d.x,
        z: d.z,
        what: `decor:${d.key}[${i}]`,
      })),
      // Road knots too: a spline knot in the shallows would paint a dirt
      // track into the sea and sprout a drowned streetlamp beside it.
      ...PROVING_SHORE_ROADS.flatMap((road, i) =>
        road.map((p, j) => ({ x: p.x, z: p.z, what: `road[${i}][${j}]` })),
      ),
    ];
    const wet = points.filter((p) => !dry(p.x, p.z)).map((p) => p.what);
    const steep = points.filter((p) => !walkable(p.x, p.z)).map((p) => p.what);
    expect(wet, `underwater: ${wet.join(', ')}`).toEqual([]);
    expect(steep, `too steep: ${steep.join(', ')}`).toEqual([]);
  });

  it('the camp services stand on dry walkable ground', () => {
    // The mailbox and the guild notice board are world services, authored
    // outside this module (content/mailboxes.ts, content/noticeboards.ts), so
    // the placement sweep above cannot see them.
    // Scoped to the island RECT, not just x: the northern realms sit in the
    // same western column (Amberfall's mailbox is at x -353).
    const inIsland = (p: { x: number; z: number }) =>
      p.x >= -540 && p.x < -180 && p.z >= -180 && p.z < 180;
    const mailbox = MAILBOXES.find(inIsland);
    expect(mailbox, 'the island mailbox').toBeTruthy();
    expect([mailbox?.x, mailbox?.z]).toEqual([-306, 56]);
    const board = NOTICEBOARDS.find(inIsland);
    expect(board, 'the island notice board').toBeTruthy();
    for (const point of [mailbox, board]) {
      if (!point) continue;
      expect(dry(point.x, point.z)).toBe(true);
      expect(walkable(point.x, point.z)).toBe(true);
    }
    // Its reading spot is reachable too, not stranded inside the board.
    const front = board?.frontStandingPoint;
    expect(front && dry(front.x, front.z)).toBe(true);
    // A second board needs its own reserved static-service id.
    expect(new Set(NOTICEBOARDS.map((b) => b.entityId)).size).toBe(NOTICEBOARDS.length);
  });

  it('the Gauntlet checkpoints mirror the authored flag dressing, in running order', () => {
    // The bootcamp overlay detects course progress by position against
    // BOOTCAMP_COURSE_CHECKPOINTS; the flags a player actually sees are the
    // decorProps hexFlag entries INSIDE the walled course rect (the rail's
    // giver-station flags stand elsewhere, checked below). One list must be
    // the other, first to last (the red flag is the finish), or the overlay
    // would point at bare sand.
    const inCourseRect = (p: { x: number; z: number }) =>
      p.x > -338 && p.x < -284 && p.z > -38 && p.z < -10;
    const allFlags = (PROVING_SHORE_PROPS.decorProps ?? []).filter((d) =>
      d.key.startsWith('hexFlag'),
    );
    const flags = allFlags.filter(inCourseRect);
    expect(flags.map((d) => ({ x: d.x, z: d.z }))).toEqual([...BOOTCAMP_COURSE_CHECKPOINTS]);
    expect(flags.at(-1)?.key).toBe('hexFlagRed');
    // Every checkpoint stands inside the walled course rect on the south
    // strand near camp, NOT out at the far-strand wreck line: the two
    // grounds are deliberately separate.
    for (const c of BOOTCAMP_COURSE_CHECKPOINTS) {
      expect(inCourseRect(c)).toBe(true);
    }
    // Every rail quest giver has a station flag planted beside them (within
    // 3 yards), OUTSIDE the course rect, so each stop on the relay reads as
    // a station from across the ground.
    const stationFlags = allFlags.filter((d) => !inCourseRect(d));
    const givers = new Set(
      PROVING_SHORE_QUEST_ORDER.map((id) => PROVING_SHORE_QUESTS[id].giverNpcId),
    );
    for (const npcId of givers) {
      const npc = PROVING_SHORE_NPCS[npcId];
      const near = stationFlags.some((d) => Math.hypot(d.x - npc.pos.x, d.z - npc.pos.z) <= 3);
      expect(near, `station flag beside ${npcId}`).toBe(true);
    }
    // And a lit lantern post stands behind each giver (within 2.5 yards),
    // kcasTorch decor lit by render/decor_torch_fx.ts, so every station
    // stays readable after dark.
    const lanterns = (PROVING_SHORE_PROPS.decorProps ?? []).filter((d) =>
      d.key.startsWith('kcasTorch'),
    );
    for (const npcId of givers) {
      const npc = PROVING_SHORE_NPCS[npcId];
      const near = lanterns.some((d) => Math.hypot(d.x - npc.pos.x, d.z - npc.pos.z) <= 2.5);
      expect(near, `lantern behind ${npcId}`).toBe(true);
    }
    // The Gauntlet is lit for night running by its fence-line lantern posts
    // (kcasTorch decorProps, lit via render/decor_torch_fx.ts), NOT ground
    // fires: campfires are solid colliders and the lanes stay clear.
    const torches = (PROVING_SHORE_PROPS.decorProps ?? []).filter((d) =>
      d.key.startsWith('kcasTorch'),
    );
    expect(torches.length).toBeGreaterThanOrEqual(10);
    // (The practice yard's brazier at (-334, -10) sits west of the course
    // rect and is not a course fire.)
    const courseFires = (PROVING_SHORE_PROPS.campfires ?? []).filter(
      ([x, z]) => x > -332 && z < -10,
    );
    expect(courseFires).toEqual([]);
  });

  it('the greeter stands on dry ground at the Eastbrook spawn', () => {
    const bryn = PROVING_SHORE_NPCS.wayfarer_bryn;
    expect(dry(bryn.pos.x, bryn.pos.z)).toBe(true);
  });

  it('the crossing is clicked bells on both shores, never a walk-in portal', () => {
    // The rework's contract: no walk-in portal trigger anywhere near the
    // island (nobody is teleported by wandering), and exactly one ferry bell
    // stands on each side of the strait (island pier, Eastbrook town beside
    // the greeter). Their dryness rides the placement sweep above (bells are
    // ground objects).
    expect(PROVING_SHORE_PORTALS).toEqual([]);
    const bells = PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_ferry_bell')?.positions ?? [];
    expect(bells.filter((b) => b.x < -180)).toHaveLength(1);
    expect(bells.filter((b) => b.x >= -180)).toHaveLength(1);
  });

  it('the strait to the vale is open water (the island is isolated)', () => {
    for (const z of [-120, -60, 0, 60, 120]) {
      const h = groundHeight(-180, z, WORLD_SEED);
      expect(h, `strait at z=${z}`).toBeLessThan(WATER_LEVEL - 1);
    }
    expect(provingLandness(PROVING_SHORE_ZONE.hub.x, PROVING_SHORE_ZONE.hub.z)).toBeGreaterThan(
      0.3,
    );
  });

  it('the quest chain is a strict rail with XP and copper on every step', () => {
    const order = PROVING_SHORE_QUEST_ORDER;
    expect(order[0]).toBe(PROVING_SHORE_ZONE.welcomeQuestId);
    for (let i = 0; i < order.length; i++) {
      const q = PROVING_SHORE_QUESTS[order[i]];
      expect(q, order[i]).toBeTruthy();
      expect(q.xpReward, `${q.id} xp`).toBeGreaterThan(0);
      expect(q.copperReward, `${q.id} copper`).toBeGreaterThan(0);
      if (i === 0) expect(q.requiresQuest).toBeUndefined();
      else expect(q.requiresQuest, `${q.id} requires`).toBe(order[i - 1]);
    }
  });

  it('level 3 lands ON the final hand-in, counting the forced kills, never before', () => {
    // The rail's XP budget is quest XP PLUS the kill XP its own objectives
    // force (one effigy, three scuttlers): the total must clear the level 3
    // threshold at Set Sail's hand-in even when every kill pays its minimum,
    // and must still be short of level 3 before that hand-in even when every
    // kill pays its maximum. Quest XP alone stays far from level 4.
    const toLevel3 = xpForLevel(1) + xpForLevel(2);
    const toLevel4 = toLevel3 + xpForLevel(3);
    const questXp = PROVING_SHORE_QUEST_ORDER.reduce(
      (sum, id) => sum + PROVING_SHORE_QUESTS[id].xpReward,
      0,
    );
    const forcedKills = PROVING_SHORE_QUESTS.q_ps_strike_true.objectives[0].count ?? 0;
    const forcedCrabs = PROVING_SHORE_QUESTS.q_ps_shell_and_claw.objectives[0].count ?? 0;
    const forcedBoss = PROVING_SHORE_QUESTS.q_ps_mother_of_pearl.objectives[0].count ?? 0;
    // Worst case low: every forced kill is a level-1 mob felled as late as
    // player level 2 (the boss is fixed level 2, felled at level 2). Worst
    // case high: the effigy is a level-1 mob at player level 1, and every
    // scuttler (and the boss) spawns level 2 and dies at player level 1.
    const minKillXp =
      (forcedKills + forcedCrabs) * mobXpValue(1, 2) + forcedBoss * mobXpValue(2, 2);
    const maxKillXp =
      forcedKills * mobXpValue(1, 1) + (forcedCrabs + forcedBoss) * mobXpValue(2, 1);
    const sailXp = PROVING_SHORE_QUESTS.q_ps_set_sail.xpReward;
    expect(questXp + minKillXp).toBeGreaterThanOrEqual(toLevel3);
    expect(questXp - sailXp + maxKillXp).toBeLessThan(toLevel3);
    expect(questXp).toBeLessThan(toLevel4);
  });

  it('the chain pays for the pouch lesson AND the tool set, and vendors no tools', () => {
    // The island vendor stocks provisions and the bank lesson's Linen Pouch,
    // NEVER professions tools (the R37 rule
    // tests/professions_zone_rollout.test.ts enforces): the chain's copper is
    // sized to buy the pouch mid-chain and the tier-1 tool kit at the vale's
    // own counters after.
    const stocked = PROVING_SHORE_NPCS.quartermaster_finch.vendorItems ?? [];
    // EXACTLY the pouch: a newcomer who could spend their lesson copper on
    // provisions was able to softlock themselves out of the pouch purchase.
    expect(stocked).toEqual(['linen_pouch']);
    for (const id of stocked) {
      expect(ITEMS[id]?.use?.type === 'gatherTool', `${id} is a professions tool`).toBe(false);
    }
    // The full tier-1 gathering kit at the vale's counters.
    const TOOL_SET = ['copper_mining_pick', 'handaxe', 'gathering_sickle', 'simple_fishing_pole'];
    const toolCost = TOOL_SET.reduce((sum, id) => sum + (ITEMS[id]?.buyValue ?? 0), 0);
    expect(toolCost).toBeGreaterThan(0);
    const totalCopper = PROVING_SHORE_QUEST_ORDER.reduce(
      (sum, id) => sum + PROVING_SHORE_QUESTS[id].copperReward,
      0,
    );
    // The bank lesson (q_ps_pouch_and_purse) makes the player SPEND the
    // pouch's price mid-chain, so the spendable total is rewards minus one
    // pouch; it must still cover the whole tool set.
    const pouch = ITEMS.linen_pouch?.buyValue ?? 0;
    expect(pouch).toBeGreaterThan(0);
    expect(totalCopper - pouch).toBeGreaterThanOrEqual(toolCost);
    // And the pouch is affordable from quest rewards alone when its lesson
    // unlocks: every quest BEFORE q_ps_pouch_and_purse in the rail pays in.
    const pouchAt = PROVING_SHORE_QUEST_ORDER.indexOf('q_ps_pouch_and_purse');
    expect(pouchAt).toBeGreaterThan(0);
    const beforeLesson = PROVING_SHORE_QUEST_ORDER.slice(0, pouchAt).reduce(
      (sum, id) => sum + PROVING_SHORE_QUESTS[id].copperReward,
      0,
    );
    expect(beforeLesson).toBeGreaterThanOrEqual(pouch);
  });

  it('the rail is a relay: each NPC takes one quest in and hands the next out', () => {
    // The rework's contract: the chain walks the newcomer around the whole
    // island, NPC to NPC, and every hand-in NPC is the next quest's giver.
    expect(PROVING_SHORE_QUEST_ORDER).toEqual([
      'q_ps_the_gauntlet',
      'q_ps_strike_true',
      'q_ps_hone_the_edge',
      'q_ps_shell_and_claw',
      'q_ps_mother_of_pearl',
      'q_ps_the_wreck_line',
      'q_ps_pouch_and_purse',
      'q_ps_the_signpost',
      'q_ps_the_long_walk',
      'q_ps_set_sail',
    ]);
    const relay = PROVING_SHORE_QUEST_ORDER.map((id) => PROVING_SHORE_QUESTS[id]);
    expect(relay.map((q) => [q.giverNpcId, q.turnInNpcId])).toEqual([
      ['warden_tam', 'overseer_pell'],
      ['overseer_pell', 'drillmaster_rook'],
      // Rook holds two stations: the yard drills the swing, then the
      // action bar, both on the same effigies.
      ['drillmaster_rook', 'drillmaster_rook'],
      ['drillmaster_rook', 'tidewarden_nel'],
      // Nel holds two stations: the miniboss detour leaves and returns to
      // her watch, then she hands the salvage haul out as before.
      ['tidewarden_nel', 'tidewarden_nel'],
      ['tidewarden_nel', 'quartermaster_finch'],
      ['quartermaster_finch', 'instructor_maren'],
      ['instructor_maren', 'instructor_maren'],
      // Maren holds three stations: the board, the death lesson, and the
      // crossing that sends a graduate off the island.
      ['instructor_maren', 'instructor_maren'],
      ['instructor_maren', 'ferryman_odo'],
    ]);
    for (let i = 1; i < relay.length; i++) {
      expect(relay[i].giverNpcId, `${relay[i].id} giver is the previous hand-in`).toBe(
        relay[i - 1].turnInNpcId,
      );
    }
    // The bank lesson's vault half lives at Maren: a banker's click opens
    // the bank window, not the quest gossip, so Bursar Wick can hold NO
    // quest (give or hand-in) and stays questIds-empty by design; Maren's
    // completion points at his desk instead.
    expect(PROVING_SHORE_NPCS.bursar_wick.banker).toBe(true);
    expect(PROVING_SHORE_NPCS.bursar_wick.questIds).toEqual([]);
    // The pouch cannot be bought before the lesson opens (the vendor gate
    // items.ts buyItem enforces and the vendor window mirrors), so an early
    // purchase can never strand the lesson's copper.
    expect(PROVING_SHORE_NPCS.quartermaster_finch.vendorQuestGates).toEqual({
      linen_pouch: 'q_ps_pouch_and_purse',
    });
  });

  it('the effigies are true dummies and the first fight is the scuttlers', () => {
    // The yard teaches the swing against a target that cannot answer: the
    // dummy flag (types.ts) removes retaliation outright, the damage is
    // zeroed for good measure, and a felled effigy is back in seconds.
    const effigy = PROVING_SHORE_MOBS.training_effigy;
    expect(effigy.dummy).toBe(true);
    expect(effigy.dmgBase).toBe(0);
    expect(effigy.respawnSeconds).toBe(5);
    // Five targets for one required fell: no queueing even in a rush. Spread
    // as five single-mob camps (a camp spawns at its center and an effigy
    // never wanders, so one count-5 camp would stack them on one point),
    // every pair at least 4 yards apart.
    const yards = PROVING_SHORE_CAMPS.filter((c) => c.mobId === 'training_effigy');
    expect(yards.reduce((sum, c) => sum + c.count, 0)).toBe(5);
    for (const a of yards) {
      for (const b of yards) {
        if (a === b) continue;
        expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z)).toBeGreaterThanOrEqual(
          4,
        );
      }
    }
    expect(PROVING_SHORE_QUESTS.q_ps_strike_true.objectives[0].count).toBe(1);
    // The scuttlers stay a real (gentle) fight: the whole point of Shell and
    // Claw is a target that finally hits back. Six of them on a 7-second
    // respawn so a shared wreck line never queues the cull, on a VERY short
    // aggro leash and spread over three well-separated camps, so a newcomer
    // only ever fights the crab they walked onto.
    expect(PROVING_SHORE_MOBS.shore_scuttler.dummy).toBeUndefined();
    expect(PROVING_SHORE_MOBS.shore_scuttler.dmgBase).toBeGreaterThan(0);
    expect(PROVING_SHORE_MOBS.shore_scuttler.respawnSeconds).toBe(7);
    expect(PROVING_SHORE_MOBS.shore_scuttler.aggroRadius).toBeLessThanOrEqual(2);
    const shells = PROVING_SHORE_CAMPS.filter((c) => c.mobId === 'shore_scuttler');
    expect(shells.length).toBeGreaterThanOrEqual(3);
    expect(shells.reduce((sum, c) => sum + c.count, 0)).toBe(6);
    for (const a of shells) {
      for (const b of shells) {
        if (a === b) continue;
        expect(
          Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z),
          'scuttler camps stay spread',
        ).toBeGreaterThanOrEqual(10);
      }
    }
    // The cull ground lives on the SOUTH-WEST strand, well away from
    // Tidewarden Nel's watch: her path stays a safe walk.
    const nel = PROVING_SHORE_NPCS.tidewarden_nel;
    for (const c of shells) {
      expect(
        Math.hypot(c.center.x - nel.pos.x, c.center.z - nel.pos.z),
        'scuttler camp keeps its distance from Nel',
      ).toBeGreaterThanOrEqual(25);
    }
    // The crate line asks for six opens and authors exactly six crates: the
    // quest IS clearing the line, and OBJECT_RESPAWN covers a shared island.
    expect(PROVING_SHORE_QUESTS.q_ps_the_wreck_line.objectives[0].count).toBe(6);
    expect(
      PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_castaway_crate')?.positions,
    ).toHaveLength(6);
  });
});
