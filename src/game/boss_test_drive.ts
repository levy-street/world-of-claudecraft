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

/**
 * The Starfall Crater's western rim, east Mirefen: where he sleeps and wakes.
 *
 * The same spot the live scheduler spawns him on (WORLD_BOSSES in src/sim/world_boss.ts),
 * so the test drive shows the real opening: dry ground beside Brother Aldric's fallen
 * star, 45+ yards clear of the Widow Thicket camps, with the long march west to the
 * Drowned Chapel as his first leg. Kept as a literal rather than an import so this
 * dev-only module never pulls the world-boss registry into the client bundle; a test
 * welds the two.
 */
export const BOSS_TEST_DRIVE_POS = { x: 128, z: 262 };

/**
 * How far off the spawn point the player stands, per axis.
 *
 * Sized to the body, not picked round: at scale 4.2 he stands about 13.4 world units, so
 * anything closer than this fills the screen with shin. 38 frames him whole and still sits
 * outside his 26-yard aggro, so the first thing you see is him moving under his own AI
 * rather than already walking at you. Step in to pull; god mode means there is no failure
 * state either way.
 */
export const BOSS_TEST_DRIVE_STANDOFF = 38;

export interface BossTestDrivePlan {
  /** Mob template id to spawn. */
  templateId: string;
}

const BALGATH: BossTestDrivePlan = { templateId: 'balgath_cyclops' };

/**
 * Read the test-drive request out of a query string, or null for an ordinary session.
 *
 * Pure and total: an unrecognised value answers null and starts a normal game rather
 * than guessing, so a typo can never quietly put you somewhere you did not ask to be.
 * `?boss`, `?boss=1` and `?boss=balgath` all mean the same thing now that the design
 * bake-off is settled and there is one body.
 */
export function parseBossTestDrive(search: string): BossTestDrivePlan | null {
  const raw = new URLSearchParams(search).get('boss');
  if (raw === null) return null;
  const key = raw.trim().toLowerCase();
  return key === '' || key === '1' || key === 'true' || key === 'balgath' || key === 'cyclops'
    ? BALGATH
    : null;
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
/**
 * The first-run camera prompt is a modal that opens over the world on a fresh profile.
 * This entry skips the start screens that would otherwise have dealt with it, so it
 * would open directly on top of the thing you loaded the URL to look at. Marking it seen
 * is what the E2E harness does for the same reason (scripts/enter_offline_game.mjs).
 */
function dismissFirstRunCameraPrompt(): void {
  try {
    localStorage.setItem('woc.cameraModePrompt.shown', '1');
  } catch {
    // Private mode or a blocked store: the prompt is cosmetic friction, never fatal.
  }
}

export function applyBossTestDrive(
  sim: TestDriveSim,
  plan: BossTestDrivePlan,
  cls: PlayerClass,
): number {
  dismissFirstRunCameraPrompt();
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
