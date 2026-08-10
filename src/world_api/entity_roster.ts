import type { Entity, MoveInput, PlayerClass, WorldContent } from '../sim/types';

export interface IWorldEntityRoster {
  // `world` is the offline editor play-test world (carries render-only placements
  // for the renderer); optional and absent online.
  cfg: { seed: number; playerClass: PlayerClass; world?: WorldContent };
  entities: Map<number, Entity>;
  playerId: number;
  player: Entity;
  moveInput: MoveInput;
  // the realm (world/shard) this character lives on; '' in offline play
  realm: string;
  // whether this session's ACCOUNT holds a staff/admin role. Advert only: every
  // admin-gated action is re-checked server-side, so a forged true opens inert
  // UI. Offline play is true (the player owns the world).
  accountAdmin: boolean;
}
