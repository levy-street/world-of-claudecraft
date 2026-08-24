export const LONG_STATIONARY_CHANNEL_SEC = 3;

export interface MovementCast {
  def: {
    castWhileMoving?: boolean;
    channel?: { duration: number };
  };
  castWhileMoving?: boolean;
}

/**
 * GW2-style combat casts are mobile by default. Authored mobile overrides and
 * temporary mobility effects also protect channels; otherwise only long
 * channels remain movement-cancelled. A null record is a non-combat activity
 * such as fishing or gathering and keeps the classic movement cancel.
 */
export function castSurvivesMovement(
  casting: MovementCast | null,
  temporaryMobility: boolean,
): boolean {
  if (!casting) return false;
  if (casting.def.castWhileMoving || casting.castWhileMoving || temporaryMobility) return true;
  const channelDuration = casting.def.channel?.duration;
  return channelDuration === undefined || channelDuration < LONG_STATIONARY_CHANNEL_SEC;
}
