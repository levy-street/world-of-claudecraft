// Browser offline-world policy. The host supplies randomness before constructing
// the deterministic Sim; saved character identity takes precedence on reload.
import { PLAYER_INTEREST_DROP_RADIUS, type PlayerClass, type SimConfig } from '../sim/types';
import { WORLD_SEED } from '../sim/world_seed';
import { allocateOfflineGathererIdentity } from './gatherer_identity';

export function offlineWorldConfig(options: {
  readonly playerClass: PlayerClass;
  readonly name: string;
  readonly world?: SimConfig['world'];
  readonly seedOverride?: number;
  readonly devCommands: boolean;
}): SimConfig {
  return {
    seed: options.seedOverride ?? WORLD_SEED,
    playerClass: options.playerClass,
    playerName: options.name,
    devCommands: options.devCommands,
    // Editor play-test maps opt out of the live world's entry features.
    riftPortals: options.world === undefined,
    compulsoryTutorial: options.world === undefined,
    // Match live idle-AI throttling outside the player's actionable interest.
    idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    world: options.world,
    gathererIdentity: allocateOfflineGathererIdentity() ?? undefined,
  };
}
