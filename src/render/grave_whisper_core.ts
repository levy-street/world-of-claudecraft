// When the Graveyard Shift's grave whispers to the player: once per session,
// the first frame the player stands within GRAVE_WHISPER_RADIUS of it. The
// grave only exists for an eligible player (the sim spawns it that way), so
// this needs no eligibility rule of its own. Pure: positions in, a verdict out.
import { GRAVE_WHISPER_RADIUS } from '../sim/graveyard_shift/grave_entry';

type Pos = { readonly x: number; readonly z: number };

export function graveWhisperDue(
  gravePos: Pos | null | undefined,
  playerPos: Pos,
  alreadyWhispered: boolean,
): boolean {
  if (alreadyWhispered || !gravePos) return false;
  return Math.hypot(playerPos.x - gravePos.x, playerPos.z - gravePos.z) <= GRAVE_WHISPER_RADIUS;
}
