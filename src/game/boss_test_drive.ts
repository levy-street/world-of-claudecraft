// Boss test drive: `?boss=foreman` / `?boss=cyclops` drops an offline session in
// beside the Mirefen boss, geared and unkillable, so both silhouettes can be watched
// moving and fighting in the real world instead of in a turntable render.
//
// This exists because the two bodies are a CHOICE, and the thing you actually need to
// judge them on is how they read at gameplay distance while walking, winding up and
// landing a slam. A preview render cannot answer that, and the encounter that would
// spawn them for real is blocked on reward design.
//
// DEV BUILDS ONLY, gated at the call site in main.ts exactly like `?mech`. It hands
// out god mode and a full set of best-in-slot gear, which is only ever acceptable
// because the offline Sim is a single-player world running entirely in this tab: there
// is no server to lie to and no other player to affect. It must never be reachable
// from a production bundle, which is what `import.meta.env.DEV` guarantees.

import { ITEMS } from '../sim/data';
import { canEquipItem } from '../sim/equipment_rules';
import { itemLevel } from '../sim/item_level';
import type { EquipSlot, ItemDef, PlayerClass } from '../sim/types';

/** The Troll Mounds POI in Mirefen Marsh: the barrow the trolls dug him out of. */
export const BOSS_TEST_DRIVE_POS = { x: -95, z: 440 };

/**
 * How far off the spawn point the player stands, per axis.
 *
 * 22 puts the true distance around 31 yards, which is deliberately OUTSIDE his 18-yard
 * aggro: left alone he wanders his spawn area, which is the thing you actually want to
 * watch first, and a nine-unit giant needs the room to fit in frame anyway. Walk in to
 * pull him and see the slams; god mode means the fight has no failure state.
 */
export const BOSS_TEST_DRIVE_STANDOFF = 22;

export interface BossTestDrivePlan {
  /** Mob template id to spawn. */
  templateId: string;
  /** Which silhouette the param asked for, for the console line. */
  variant: 'foreman' | 'cyclops';
}

const VARIANTS: Record<string, BossTestDrivePlan> = {
  foreman: { templateId: 'balgath_foreman', variant: 'foreman' },
  cyclops: { templateId: 'balgath_cyclops', variant: 'cyclops' },
};

/**
 * Read the test-drive request out of a query string, or null for an ordinary session.
 *
 * Pure and total: any unknown value answers null rather than throwing or guessing, so a
 * typo (`?boss=cylcops`) starts a normal game instead of silently test-driving the
 * wrong body. A bare `?boss` picks the foreman, which is the recommended one.
 */
export function parseBossTestDrive(search: string): BossTestDrivePlan | null {
  const raw = new URLSearchParams(search).get('boss');
  if (raw === null) return null;
  const key = raw.trim().toLowerCase();
  if (key === '' || key === '1' || key === 'true') return VARIANTS.foreman;
  return VARIANTS[key] ?? null;
}

/**
 * Best-in-slot pick per equip slot for one class, by derived item level.
 *
 * Data-driven rather than a hand-listed set on purpose: a literal list of item ids goes
 * stale the moment itemization moves, and silently, because a stale id just fails to
 * equip and leaves a bare slot nobody notices. Ties break on item id so the same
 * character comes back every run, which matters when the point is comparing two models
 * under identical conditions.
 */
export function bestInSlot(cls: PlayerClass): ItemDef[] {
  const best = new Map<EquipSlot, { item: ItemDef; level: number }>();
  for (const item of Object.values(ITEMS)) {
    const slot = (item as { slot?: EquipSlot }).slot;
    if (!slot || !canEquipItem(cls, item)) continue;
    const level = itemLevel(item) ?? 0;
    const held = best.get(slot);
    if (!held || level > held.level || (level === held.level && item.id < held.item.id)) {
      best.set(slot, { item, level });
    }
  }
  return [...best.values()].map((entry) => entry.item);
}

/** The concrete offline Sim surface this needs. Narrow on purpose. */
interface TestDriveSim {
  playerId: number;
  player: {
    pos: { x: number; z: number; y: number };
    prevPos: { x: number; z: number; y: number };
    facing: number;
  };
  setPlayerLevel(level: number, pid?: number): void;
  setGm(pid?: number, enabled?: boolean): void;
  addItem(itemId: string, count: number, pid?: number): unknown;
  equipItem(itemId: string, pid?: number): unknown;
  spawnDevBoss(templateId: string, x: number, z: number): number;
  groundPos(x: number, z: number): { x: number; y: number; z: number };
}

/**
 * Apply a plan to a freshly created offline session, before `startGame`.
 *
 * Order matters in one place: the player is levelled BEFORE gear is equipped, because
 * equip checks the character's level against the item's requirement and a level-1
 * warrior silently refuses every piece worth looking at.
 */
export function applyBossTestDrive(
  sim: TestDriveSim,
  plan: BossTestDrivePlan,
  cls: PlayerClass,
): number {
  sim.setPlayerLevel(20, sim.playerId);
  sim.setGm(sim.playerId, true);
  for (const item of bestInSlot(cls)) {
    sim.addItem(item.id, 1, sim.playerId);
    sim.equipItem(item.id, sim.playerId);
  }

  const boss = sim.spawnDevBoss(plan.templateId, BOSS_TEST_DRIVE_POS.x, BOSS_TEST_DRIVE_POS.z);

  // Stand due SOUTH of him, not off a diagonal. The chase camera boots at its own
  // default yaw and does not adopt the player's facing, so the only way to guarantee the
  // boss is in the opening frame is to put him where that default already looks. Facing
  // is set too, for the moment the player first moves.
  const stand = sim.groundPos(
    BOSS_TEST_DRIVE_POS.x,
    BOSS_TEST_DRIVE_POS.z - BOSS_TEST_DRIVE_STANDOFF,
  );
  sim.player.pos.x = stand.x;
  sim.player.pos.y = stand.y;
  sim.player.pos.z = stand.z;
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.facing = Math.atan2(BOSS_TEST_DRIVE_POS.x - stand.x, BOSS_TEST_DRIVE_POS.z - stand.z);
  return boss;
}
