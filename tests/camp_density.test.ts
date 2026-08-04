// Guards camp DENSITY: how many mobs one farm route can hold at once, the
// specific Thornpeak corridor de-stack that motivated the model
// (tests/helpers/farm_yield.ts), and the one cluster held over the count caps on
// purpose (the Drakemaw brood belt, pinned by composition at the bottom).
import { describe, expect, it } from 'vitest';
import { CAMPS, MOBS, zoneContaining } from '../src/sim/data';
import type { MobTemplate } from '../src/sim/types';
import {
  type CampYield,
  CLUSTER_LINK_DISTANCE,
  campYield,
  clusterCamps,
  coinEvPerKill,
  worldFarmClusters,
} from './helpers/farm_yield';

/**
 * The most farmable trash one cluster may hold.
 *
 * This was a FAST-respawn cap back when respawn varied by level band and only
 * the level 1-7 zones qualified. The band tiers are retired (every zone is now
 * on one 60s delay, see src/sim/respawn_policy.ts), so every trash cluster in
 * the world is "fast" and this is simply a trash-density cap now. Re-based to
 * 25% above Thornpeak's Glimmermere corridor at 59, on the same convention as
 * the yield ceilings.
 *
 * It still measures something the total cap below does not: trash is what a
 * farmer can actually cycle, so a cluster that is mostly rares reads very
 * differently here than it does there (the corridor is 59 of 63).
 */
const MAX_TRASH_PER_CLUSTER = 75;

/**
 * What one camp mob is worth to a FARMER. A hatching shell (a 1 HP egg, xpMult 0
 * with an empty table of its own) is worth its HATCHLING, never nothing:
 * cracking one egg creates exactly one whelp (sim/mob/dragonkin_brood.ts
 * hatchEgg, and broodEgg carries a single hatchMobId, so the swap is 1:1), and
 * the whelp is a summonedAdd that never respawns where it hatched, so the
 * standing shell count bounds the whelp population EXACTLY. A clutch of N eggs
 * is an N-whelp farm on the shell's respawn, paying the whelp's guaranteed 15c:
 * calling it scenery would hide that from every guard in this file.
 *
 * Because the swap is 1:1 in COUNT, FarmCluster.mobCount already IS the
 * hatch-adjusted count and the count caps read it directly; only the trash
 * CLASSIFICATION needs the substituted template. Nothing is exempted by xpMult,
 * so a future no-XP template cannot slip past the model unseen (pinned as a
 * literal in "the density model covers the shipped world" below).
 */
function farmTemplate(template: MobTemplate): MobTemplate {
  const hatch = template.broodEgg?.hatchMobId;
  return (hatch ? MOBS[hatch] : undefined) ?? template;
}

/**
 * The one cluster held OVER the count caps on purpose, identified by the shell
 * it is the only home of in the world. Its shells are fully farmable, so this is
 * not a scenery exemption: it is granted because the union-find joins a 240 yd
 * belt rather than a pocket a farmer can hold, which "the Drakemaw brood belt"
 * block below is the evidence for and pins by composition.
 */
const DENSE_BY_DESIGN_SHELL = 'dragonkin_egg';

/** Every cluster the count caps govern: the world minus the pinned belt. */
const cappedClusters = () =>
  worldFarmClusters().filter((c) => !c.mobIds.includes(DENSE_BY_DESIGN_SHELL));

/**
 * Below this a respawn counts as "fast" for density purposes. Every authored
 * zone is under it today, which is the point: the classifier is kept so a future
 * per-zone ZoneDef.trashRespawnSeconds slower than 100s drops out of the trash
 * cap automatically, rather than the cap silently governing a cadence nobody
 * meant it to.
 */
const FAST_RESPAWN_SECONDS = 100;

/**
 * Farmable trash: not a rare, boss, dummy or ambient prop, and carrying no
 * authored respawnMult (which marks a mob with its own tuned schedule). This is
 * exactly the population the zone respawn tiers govern. Fed the FARM template
 * (farmTemplate above), so a hatching shell is classified as the hatchling a
 * farmer actually cycles, and a shell that ever hatched a rare would drop out of
 * the trash cap on its own.
 */
function isTrash(template: MobTemplate): boolean {
  return (
    !template.rare &&
    !template.boss &&
    !template.dummy &&
    !template.ambient &&
    template.respawnMult === undefined
  );
}

function fastTrashCount(camps: readonly CampYield[]): number {
  return camps
    .filter((y) => isTrash(farmTemplate(y.template)) && y.respawnSeconds < FAST_RESPAWN_SECONDS)
    .reduce((n, y) => n + y.camp.count, 0);
}

/**
 * Ceiling on TOTAL standing mobs in any one cluster, at any respawn tier. The
 * fast-trash cap above only ever governs the 60s starter band, so without this
 * the mid and endgame bands would have no density guard at all. Thornpeak's
 * Glimmermere corridor is the largest GOVERNED cluster at 63 (see below,
 * deliberate); the Drakemaw brood belt sits above both caps by decision and is
 * bounded by its pinned composition instead (cappedClusters, and the belt block
 * at the bottom of the file).
 */
const MAX_MOBS_PER_CLUSTER = 70;

describe('clusterCamps: the union-find proximity model', () => {
  it('pins the link distance, which decides whether any guard here has teeth', () => {
    // Without this, dropping the constant to 20 would shatter the world into
    // singletons and turn every density assertion in this file green.
    expect(CLUSTER_LINK_DISTANCE).toBe(60);
  });

  const stub = (mobId: string, x: number, z: number, count = 1): CampYield => {
    const y = campYield({ mobId, center: { x, z }, radius: 4, count }, 60);
    if (!y) throw new Error(`no template ${mobId}`);
    return y;
  };

  it('joins camps inside the link distance and separates camps beyond it', () => {
    const near = clusterCamps([stub('forest_wolf', 0, 0), stub('forest_wolf', 0, 50)], 60);
    expect(near).toHaveLength(1);
    const far = clusterCamps([stub('forest_wolf', 0, 0), stub('forest_wolf', 0, 70)], 60);
    expect(far).toHaveLength(2);
  });

  it('is inclusive exactly at the link distance, and excludes just past it', () => {
    expect(clusterCamps([stub('forest_wolf', 0, 0), stub('forest_wolf', 0, 60)], 60)).toHaveLength(
      1,
    );
    expect(
      clusterCamps([stub('forest_wolf', 0, 0), stub('forest_wolf', 0, 60.5)], 60),
    ).toHaveLength(2);
  });

  it('links transitively, so a chain of hops is one cluster', () => {
    // 0 -> 50 -> 100: the ends are 100 apart but chain through the middle.
    const chain = clusterCamps(
      [stub('forest_wolf', 0, 0), stub('forest_wolf', 0, 50), stub('forest_wolf', 0, 100)],
      60,
    );
    expect(chain).toHaveLength(1);
    expect(chain[0].mobCount).toBe(3);
  });

  it('totals mob counts and kill rate across the whole cluster', () => {
    const [cluster] = clusterCamps(
      [stub('forest_wolf', 0, 0, 4), stub('forest_wolf', 0, 20, 6)],
      60,
    );
    expect(cluster.mobCount).toBe(10);
    // 10 mobs on a 60s respawn is 600 sustainable kills an hour.
    expect(cluster.killsPerHour).toBeCloseTo(600, 6);
  });
});

describe('no farm cluster is overdense', () => {
  it('keeps every farmable-trash cluster at or under the cap', () => {
    const offenders = cappedClusters()
      .map((c) => ({ n: fastTrashCount(c.camps), ids: c.mobIds.join(', ') }))
      .filter((c) => c.n > MAX_TRASH_PER_CLUSTER);
    expect(offenders).toEqual([]);
  });

  it('has that trash cap within reach, so it is a real bound', () => {
    // Same anti-vacuity check the total cap carries: a cap re-based upward has
    // to stay reachable or it stops being a guard. Measured over the GOVERNED
    // clusters, so the exempt belt can never stand in as the proof.
    const largest = Math.max(...cappedClusters().map((c) => fastTrashCount(c.camps)));
    expect(largest).toBeGreaterThan(MAX_TRASH_PER_CLUSTER * 0.7);
  });

  it('caps TOTAL mobs per cluster in every band, not just the fast one', () => {
    // mobCount, not a farmable subset: farmTemplate makes every shell count as
    // the whelp it hatches, one for one, so the standing total IS the farm
    // density here.
    const offenders = cappedClusters()
      .filter((c) => c.mobCount > MAX_MOBS_PER_CLUSTER)
      .map((c) => `${c.zoneIds.join('+')} (${c.mobCount} mobs): ${c.mobIds.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('has that total cap within reach, so it is a real bound', () => {
    // Guards the opposite failure: a cap set so high nothing could ever hit it.
    // Same quantity the cap filters on, over the same clusters: a reach proof
    // measuring anything else proves nothing about the cap.
    const largest = Math.max(...cappedClusters().map((c) => c.mobCount));
    expect(largest).toBeGreaterThan(MAX_MOBS_PER_CLUSTER * 0.8);
  });

  it('keeps every camp INSIDE an authored zone rect, even at its radius corners', () => {
    // THE hole this guard exists to close. A camp that overhangs a zone edge has
    // spawn points where zoneContaining is null, and the respawn policy hands
    // those the 25s off-map fallback: a fast-farm pocket strictly worse than the
    // pre-tier world, landing silently. Checked at the corners, not just the
    // centre, because mobs scatter across the whole radius.
    const outside: string[] = [];
    for (const camp of CAMPS) {
      const corners: [number, number][] = [
        [0, 0],
        [camp.radius, 0],
        [-camp.radius, 0],
        [0, camp.radius],
        [0, -camp.radius],
      ];
      for (const [dx, dz] of corners) {
        if (zoneContaining(camp.center.x + dx, camp.center.z + dz) === null) {
          outside.push(`${camp.mobId} at (${camp.center.x},${camp.center.z}) r=${camp.radius}`);
          break;
        }
      }
    }
    expect(outside).toEqual([]);
    // ...and the sweep really looked at every camp, so an empty CAMPS or a
    // short-circuited loop could not pass the row above.
    expect(CAMPS.length).toBeGreaterThanOrEqual(175);
  });

  it('never lets a camp straddle a zone seam, which the yield model assumes', () => {
    // farm_yield prices a camp from its CENTER's zone, while the live sim
    // resolves respawn per mob from its own spawn point. Those agree only while
    // no camp's scatter radius crosses a band boundary, which would otherwise
    // price a camp at one tier while its mobs respawned on another.
    const straddling: string[] = [];
    for (const camp of CAMPS) {
      const home = zoneContaining(camp.center.x, camp.center.z);
      for (const [dx, dz] of [
        [camp.radius, 0],
        [-camp.radius, 0],
        [0, camp.radius],
        [0, -camp.radius],
      ]) {
        const edge = zoneContaining(camp.center.x + dx, camp.center.z + dz);
        if (edge?.id !== home?.id) {
          straddling.push(`${camp.mobId} at (${camp.center.x},${camp.center.z}) r=${camp.radius}`);
          break;
        }
      }
    }
    expect(straddling).toEqual([]);
  });

  it('actually has fast-respawn trash to check, so the cap is not vacuous', () => {
    // If the tiers ever slow every zone past 100s this guard would silently
    // stop testing anything; fail loudly instead.
    const fast = cappedClusters().filter((c) => fastTrashCount(c.camps) > 0);
    expect(fast.length).toBeGreaterThan(0);
    expect(Math.max(...fast.map((c) => fastTrashCount(c.camps)))).toBeGreaterThan(20);
  });
});

describe('the Thornpeak corridor is one dense cluster ON PURPOSE', () => {
  // The Glimmermere shore group (temple.ts) plus the packs it links to. These
  // form the single biggest cluster in the world and are DELIBERATELY left that
  // way, so the reason is pinned here rather than rediscovered.
  const SHORE = ['glimmermere_wader', 'drowned_votary', 'sethrael_palecoil'];
  const CORRIDOR_PACKS = [
    'thornpeak_ogre',
    'ogre_crusher',
    'warlord_drogmar',
    'brutok_skullsmasher',
    'boneclad_revenant',
    'marrowlord_varkas',
  ];

  it('cannot be separated without marching the shore mobs off the water', () => {
    // The load-bearing fact behind the temple.ts comment. The binding
    // neighbours are the WESTERN packs, not the revenants: no shore camp can
    // reach the 60yd link distance from them while staying by the tarn.
    const wader = CAMPS.find((c) => c.mobId === 'glimmermere_wader');
    if (!wader) throw new Error('no glimmermere_wader camp');
    const nearest = CAMPS.filter((c) => CORRIDOR_PACKS.includes(c.mobId))
      .map((p) => ({
        id: p.mobId,
        d: Math.hypot(wader.center.x - p.center.x, wader.center.z - p.center.z),
      }))
      .sort((a, b) => a.d - b.d)[0];
    expect(nearest.id).toBe('brutok_skullsmasher');
    expect(nearest.d).toBeLessThan(CLUSTER_LINK_DISTANCE);
    // The tarn (POI the_glimmermere, -70/760) sits inside the corridor, which is
    // why this is a content fact and not a spacing bug.
    expect(Math.hypot(wader.center.x - -70, wader.center.z - 760)).toBeLessThan(30);
  });

  it('holds the shore group and the packs in ONE cluster, as shipped', () => {
    const merged = worldFarmClusters().filter(
      (c) =>
        c.mobIds.some((m) => SHORE.includes(m)) && c.mobIds.some((m) => CORRIDOR_PACKS.includes(m)),
    );
    expect(merged).toHaveLength(1);
    // Pinned so a future camp addition to this corridor is a visible decision.
    // 63 -> 64: the quest-dedupe pass placed Brakka the Wallbreaker (a single
    // slow-respawn quest capstone elite) at the ogre foothills inside this
    // corridor.
    expect(merged[0].mobCount).toBe(64);
  });

  it('bounds that cluster by YIELD instead, since density here is the layout', () => {
    // Density here is inherent to the layout, so the guard that matters is the
    // economic one. tests/economy_yield.test.ts owns the ceilings; this asserts
    // the corridor is the cluster they are protecting against.
    const clusters = worldFarmClusters();
    const richest = clusters.reduce((a, b) => (b.copperPerHour > a.copperPerHour ? b : a));
    expect(richest.mobIds).toContain('glimmermere_wader');
    expect(richest.mobIds).toContain('thornpeak_ogre');
    // Every TRASH camp in it now sits on the single 60s world delay (the rares
    // and Drogmar keep their own declared cadence, which is why isTrash excludes
    // them), so the corridor IS fast-respawn: that is the decision, and the
    // yield ceilings rather than the density cap are what bound it.
    for (const y of richest.camps) {
      if (isTrash(y.template)) expect(y.respawnSeconds, y.camp.mobId).toBe(60);
    }
    expect(fastTrashCount(richest.camps)).toBe(59);
  });
});

describe('the Drakemaw brood belt is over the count caps ON PURPOSE', () => {
  // 15 egg clutches, the broodguard packs staked around them, the four
  // broodlords and the matriarch chain into the biggest cluster in the world at
  // 97. It is NOT skipped because the shells are scenery: each one hatches a 15c
  // whelp, so they are as farmable as anything else here. It is skipped because
  // the union-find joins a 240 yd BELT rather than a pocket a farmer can hold,
  // which the two tests after the pin are the evidence for.
  const shellClusters = () =>
    worldFarmClusters().filter((c) => c.mobIds.includes(DENSE_BY_DESIGN_SHELL));
  const brood = () => {
    const found = shellClusters();
    if (found.length !== 1) throw new Error('expected exactly one brood-belt cluster');
    return found[0];
  };
  const corridor = () => {
    const found = worldFarmClusters().find((c) => c.mobIds.includes('glimmermere_wader'));
    if (!found) throw new Error('no Glimmermere corridor cluster');
    return found;
  };

  it('is the ONLY cluster the count caps skip, pinned by composition', () => {
    expect(shellClusters()).toHaveLength(1);
    const b = brood();
    expect(b.zoneIds).toEqual(['drakelands']);
    expect(b.mobIds).toEqual([
      'cindraleth_maw_matriarch',
      'dragonkin_broodguard',
      'dragonkin_egg',
      'drakemaw_broodlord',
    ]);
    // Literals on purpose, self-healing in BOTH directions: adding a clutch, a
    // pack or a broodlord reddens these, and so does removing one, so the
    // exemption can neither widen quietly nor outlive the layout it was granted
    // for.
    expect(b.mobCount).toBe(97);
    expect(fastTrashCount(b.camps)).toBe(93);
    const shellCount = b.camps
      .filter((y) => y.template.broodEgg)
      .reduce((n, y) => n + y.camp.count, 0);
    expect(shellCount).toBe(75);
  });

  it('is THINNER on the ground than the corridor that fits under the caps', () => {
    // The load-bearing reason for the exemption: mobs per square yard, not per
    // cluster. The belt holds more only because it is a far bigger piece of map,
    // and the corridor it beats on the total is comfortably under both caps.
    const perThousandSquareYards = (c: { camps: CampYield[]; mobCount: number }): number => {
      const xs = c.camps.map((y) => y.camp.center.x);
      const zs = c.camps.map((y) => y.camp.center.z);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...zs) - Math.min(...zs);
      return c.mobCount / ((w * h) / 1000);
    };
    expect(perThousandSquareYards(brood())).toBeLessThan(perThousandSquareYards(corridor()));
  });

  it('is not the richest cluster even once its hatchlings are priced in', () => {
    // The exemption is DENSITY only, so the economic bound has to be real.
    // farm_yield prices a shell at its own empty table, so add what the clutches
    // actually pay: one whelp per shell per respawn at the whelp's guaranteed 15c
    // (it drops no items). Even then the belt sits far under the Glimmermere
    // corridor, the cluster tests/economy_yield.test.ts calibrates its ceilings
    // against.
    const b = brood();
    const hatchCoin = b.camps
      .filter((y) => y.template.broodEgg)
      .reduce((n, y) => n + y.killsPerHour * coinEvPerKill(MOBS.dragonkin_whelp), 0);
    expect(hatchCoin).toBeCloseTo(67_500, 6);
    expect(b.copperPerHour + hatchCoin).toBeLessThan(corridor().copperPerHour);
  });
});

describe('the density model covers the shipped world', () => {
  it('prices every camp, so no camp escapes the guards above', () => {
    const priced = worldFarmClusters().reduce((n, c) => n + c.camps.length, 0);
    const known = CAMPS.filter((c) => MOBS[c.mobId]).length;
    expect(priced).toBe(known);
    expect(known).toBe(CAMPS.length);
  });

  it('pins every no-XP template, so a new one cannot skip the model silently', () => {
    // This file used to exempt no-XP mobs from the count cap by CLASS, which
    // would have waved a future one through with no author ever seeing it. The
    // list is a literal instead, self-healing in both directions: adding a no-XP
    // template reddens this, and so does deleting one.
    const noXp = Object.values(MOBS)
      .filter((t) => t.xpMult === 0)
      .map((t) => t.id)
      .sort();
    expect(noXp).toEqual([
      'dragonkin_egg',
      'spider_egg',
      'spider_egg_sac',
      'vale_cup_ball',
      'yumi_cat',
    ]);
    // Two are camp-spawned: the sac is placed by delve room logic and the ball
    // and the cat are battleground objectives, so no camp cluster can ever hold
    // those three and the density model never sees them.
    //
    // spider_egg is the second, and it is deliberately NOT added to the
    // dense-by-design exemption: the Broodmother clutch sits in ordinary Widow
    // Thicket camps that the count caps still govern (the caps passed with it,
    // which is the point of leaving it capped), whereas DENSE_BY_DESIGN_SHELL is
    // granted only to the 240 yd Drakemaw brood belt the block below pins by
    // composition. A no-XP template being camp-spawned does not earn the
    // exemption; being an uncappable belt does.
    const campIds = [...new Set(CAMPS.map((c) => c.mobId))];
    expect(campIds.filter((id) => noXp.includes(id)).sort()).toEqual([
      DENSE_BY_DESIGN_SHELL,
      'spider_egg',
    ]);
    // The hatching-shell mechanic is one template today, pinned so a second
    // clutch family lands as a decision here and cannot widen the belt exemption
    // by arriving quietly.
    const shells = Object.values(MOBS)
      .filter((t) => t.broodEgg)
      .map((t) => t.id)
      .sort();
    expect(shells).toEqual([DENSE_BY_DESIGN_SHELL]);
    // ...and that one shell is counted as a hatchling that is genuinely
    // farmable: guaranteed coin and real kill XP. A shell whose hatchling paid
    // nothing would be the only case where skipping it were honest, and the
    // world has none.
    for (const id of shells) {
      const hatch = MOBS[id].broodEgg?.hatchMobId;
      expect(hatch, `${id} must hatch something`).toBeTruthy();
      const hatched = MOBS[hatch as string];
      expect(hatched.xpMult, hatch).not.toBe(0);
      const guaranteedCoin = hatched.loot.some((l) => l.copper !== undefined && l.chance === 1);
      expect(guaranteedCoin, hatch).toBe(true);
    }
  });
});
