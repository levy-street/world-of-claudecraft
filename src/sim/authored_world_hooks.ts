// Behavior only an AUTHORED world (an editor playtest or a studio map, i.e. a Sim
// built with a custom `cfg.world`) can switch on. The built-in world never
// satisfies either gate, so the live realm, the headless env, and the default
// offline world take the exact release path:
// - playerStartPos: a world carrying `playerSpawnArea` spreads fresh players
//   across it (spawn_area.ts). Placement draws no rng, so rng streams are unchanged.
// - setPlaytestGod: the editor playtest's god-mode toggle. Refused (returns
//   false) unless the Sim was constructed with `cfg.world`; the server never passes
//   one (server/sim_boot_config.ts), and this is a direct offline Sim call, never
//   a wire command, so it cannot bypass ALLOW_DEV_COMMANDS online.
import type { SimContext } from './sim_context';
import { spawnPointInArea } from './spawn_area';
import type { Vec3, WorldContent } from './types';

/** Per-Sim count of fresh players placed by a spawn area (held on Sim). */
export interface SpawnSlots {
  next: number;
}

/**
 * Where a joining player starts: its saved spot, else the authored spawn-area
 * slot (advancing the per-Sim counter), else the world's `playerStart`. Grounded with the Sim's own `groundPos`.
 */
export function playerStartPos(
  ctx: Pick<SimContext, 'groundPos'>,
  saved: { x: number; z: number } | null | undefined,
  world: Pick<WorldContent, 'playerStart' | 'playerSpawnArea'>,
  slots: SpawnSlots,
): Vec3 {
  const area = world.playerSpawnArea;
  const xz =
    saved ?? (area ? spawnPointInArea(area, slots.next++) : undefined) ?? world.playerStart;
  return ctx.groundPos(xz.x, xz.z);
}

/** Toggle playtest god mode on a player. Refused (false) outside an authored world. */
export function setPlaytestGod(
  ctx: Pick<SimContext, 'cfg' | 'entities'>,
  on: boolean,
  pid: number,
): boolean {
  if (ctx.cfg.world === undefined) return false;
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return false;
  player.devGod = on;
  if (on) {
    // Same entry state as the /dev god toggle (dev_commands.ts).
    player.profilerInvulnerable = false;
    player.hp = player.maxHp;
    player.resource = player.maxResource;
  }
  return true;
}
