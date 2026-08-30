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
  // the character this session is SPECTATING, or null when it is watching itself.
  //
  // Read it before you trust `player` or `cfg.playerClass` to describe the person
  // at the keyboard: a moderator spectate repoints `playerId` at the watched pid
  // and swaps `cfg.playerClass` with it, so both of those answer for the ANCHOR
  // rather than the VIEWER for as long as it runs. src/main.ts already guards a
  // row of per-frame work on the same fact. Anything keyed to the identity that
  // OWNS a session (a saved preference, and above all a real-money record) has to
  // consult this, or it files itself under someone else's name.
  //
  // Offline play is always null: there is nobody else to watch, and the online
  // world already carried this exact field, so the seam costs it no line.
  spectating: string | null;
}
