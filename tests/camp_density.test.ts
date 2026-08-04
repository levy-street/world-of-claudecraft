// Guards camp DENSITY: how many mobs one farm route can hold at once, and the
// specific Thornpeak corridor de-stack that motivated the model
// (tests/helpers/farm_yield.ts).
import { describe, expect, it } from 'vitest';
import { CAMPS, MOBS, zoneContaining } from '../src/sim/data';
import type { MobTemplate } from '../src/sim/types';
import {
  type CampYield,
  CLUSTER_LINK_DISTANCE,
  campYield,
  clusterCamps,
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
 * exactly the population the zone respawn tiers govern.
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
    .filter((y) => isTrash(y.template) && y.respawnSeconds < FAST_RESPAWN_SECONDS)
    .reduce((n, y) => n + y.camp.count, 0);
}

/**
 * Ceiling on TOTAL standing mobs in any one cluster, at any respawn tier. The
 * fast-trash cap above only ever governs the 60s starter band, so without this
 * the mid and endgame bands would have no density guard at all. Thornpeak's
 * Glimmermere corridor is the largest at 63 (see below, deliberate).
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
    const offenders = worldFarmClusters()
      .map((c) => ({ n: fastTrashCount(c.camps), ids: c.mobIds.join(', ') }))
      .filter((c) => c.n > MAX_TRASH_PER_CLUSTER);
    expect(offenders).toEqual([]);
  });

  it('has that trash cap within reach, so it is a real bound', () => {
    // Same anti-vacuity check the total cap carries: a cap re-based upward has
    // to stay reachable or it stops being a guard.
    const largest = Math.max(...worldFarmClusters().map((c) => fastTrashCount(c.camps)));
    expect(largest).toBeGreaterThan(MAX_TRASH_PER_CLUSTER * 0.7);
  });

  it('caps TOTAL mobs per cluster in every band, not just the fast one', () => {
    const offenders = worldFarmClusters()
      .filter((c) => c.mobCount > MAX_MOBS_PER_CLUSTER)
      .map((c) => `${c.zoneIds.join('+')} (${c.mobCount} mobs): ${c.mobIds.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('has that total cap within reach, so it is a real bound', () => {
    // Guards the opposite failure: a cap set so high nothing could ever hit it.
    const largest = Math.max(...worldFarmClusters().map((c) => c.mobCount));
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
    const fast = worldFarmClusters().filter((c) => fastTrashCount(c.camps) > 0);
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
    expect(merged[0].mobCount).toBe(63);
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

describe('the density model covers the shipped world', () => {
  it('prices every camp, so no camp escapes the guards above', () => {
    const priced = worldFarmClusters().reduce((n, c) => n + c.camps.length, 0);
    const known = CAMPS.filter((c) => MOBS[c.mobId]).length;
    expect(priced).toBe(known);
    expect(known).toBe(CAMPS.length);
  });
});
