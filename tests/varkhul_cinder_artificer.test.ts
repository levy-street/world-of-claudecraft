import { describe, expect, it } from 'vitest';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';

import {
  VARKHUL_CINDER_ARTIFICER_FIRST_SECONDS,
  VARKHUL_CINDER_ARTIFICER_HEAL_PCT_HEROIC,
  VARKHUL_CINDER_ARTIFICER_HEAL_PCT_NORMAL,
  VARKHUL_CINDER_ARTIFICER_MINIMUM_WINDOW_SECONDS,
  VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS,
  VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS,
  VARKHUL_CINDER_REPAIR_CAST_ID,
  VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS,
  VARKHUL_CINDER_REPAIR_END_ANIMATION_ID,
  VARKHUL_CINDER_REPAIR_RETRY_SECONDS,
  VARKHUL_CINDER_REPAIR_START_ANIMATION_ID,
  VARKHUL_CINDER_REPAIR_TICK_SECONDS,
  varkhulCinderArtificerCanQueue,
  varkhulCinderArtificerPortalIndex,
  varkhulCinderRepairTickAmount,
} from '../src/sim/varkhul_cinder_artificer';

describe('Varkhul Cinder Artificer', () => {
  it('uses a separate, readable spawn and repair cadence', () => {
    expect(VARKHUL_CINDER_ARTIFICER_FIRST_SECONDS).toBe(10);
    expect(VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS).toBe(18);
    expect(VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS).toBe(2);
    expect(VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS).toBe(6);
    expect(VARKHUL_CINDER_REPAIR_TICK_SECONDS).toBe(1);
    expect(VARKHUL_CINDER_REPAIR_RETRY_SECONDS).toBe(2);
    expect(VARKHUL_CINDER_REPAIR_CAST_ID).toBe('cinder_recalibrate');
    expect(VARKHUL_CINDER_REPAIR_START_ANIMATION_ID).toBe('cinder_recalibrate_start');
    expect(VARKHUL_CINDER_REPAIR_END_ANIMATION_ID).toBe('cinder_recalibrate_end');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[VARKHUL_CINDER_REPAIR_CAST_ID]).toEqual({
      school: 'fire',
    });
  });

  it('rotates through the four physical corner portals without shared RNG', () => {
    expect(
      Array.from({ length: 9 }, (_, index) => varkhulCinderArtificerPortalIndex(index)),
    ).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
  });

  it('only queues a portal when its warning and full repair channel still fit', () => {
    expect(VARKHUL_CINDER_ARTIFICER_MINIMUM_WINDOW_SECONDS).toBe(8);
    expect(varkhulCinderArtificerCanQueue(8)).toBe(true);
    expect(varkhulCinderArtificerCanQueue(7.95)).toBe(false);
    expect(varkhulCinderArtificerCanQueue(0)).toBe(false);
    expect(varkhulCinderArtificerCanQueue(Number.NaN)).toBe(false);
  });

  it('repairs every second for six ticks, with a harsher Heroic channel', () => {
    expect(VARKHUL_CINDER_ARTIFICER_HEAL_PCT_NORMAL).toBe(0.02);
    expect(VARKHUL_CINDER_ARTIFICER_HEAL_PCT_HEROIC).toBe(0.03);
    expect(varkhulCinderRepairTickAmount(80_000, 'normal')).toBe(1_600);
    expect(varkhulCinderRepairTickAmount(80_000, 'heroic')).toBe(2_400);
  });
});
