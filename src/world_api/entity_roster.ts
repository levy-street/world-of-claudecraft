import type { Entity, MoveInput, PlayerClass } from '../sim/types';

export interface IWorldEntityRoster {
  cfg: { seed: number; playerClass: PlayerClass };
  entities: Map<number, Entity>;
  playerId: number;
  player: Entity;
  moveInput: MoveInput;
  // the realm (world/shard) this character lives on; '' in offline play
  realm: string;
}
