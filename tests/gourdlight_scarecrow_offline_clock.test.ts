// Old Thatchgrin under the OFFLINE night commands (round 11 playtest bug).
//
// The bug: offline, `/dev servertime night` reached the sim, which swapped the offline
// clock for "that clock plus an offset". The offline clock IS the sky's /daynight
// override, so the reply's own advice (type /daynight night to match the sky) moved the
// base under the offset: the sim landed on (night + offset), which by day is DAY again,
// and he hung on his pole under a midnight sky. Only `/dev scarecrow wake` (a dev hold
// that ignores the clock) got him down.
//
// The fix: offline there is ONE clock, so the client answers `/dev servertime` itself by
// setting the same override /daynight sets (src/game/daynight_dev_command.ts): the sky
// and the sim move together, and the last command typed always wins. Driven here through
// the real chat interceptor chain (tryDevChatHooks) and the real offline world config.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryDevChatHooks } from '../src/game/dev_chat_hooks';
import { offlineWorldConfig } from '../src/game/offline_world_config';
import { setDayNightPhaseOverride } from '../src/render/day_night_clock';
import { THATCHGRIN_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { DAY_NIGHT_CYCLE_MS, isDaylightPhase } from '../src/sim/day_night';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// A real-time instant at mid-morning (phase 0.35): the playtest's daylight wall clock.
const MORNING_MS = Date.UTC(2026, 9, 31) - (Date.UTC(2026, 9, 31) % DAY_NIGHT_CYCLE_MS);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MORNING_MS + Math.round(0.35 * DAY_NIGHT_CYCLE_MS));
});

afterEach(() => {
  vi.useRealTimers();
  setDayNightPhaseOverride(null);
  syncSeasonalDecorColliders(WORLD_SEED, null);
});

const boss = (sim: Sim) =>
  [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID) as Entity;

function seconds(sim: Sim, s: number): void {
  for (let i = 0; i < Math.round(s / DT); i++) sim.tick();
}

/** The offline client's chat send path: the dev interceptors first, the sim otherwise. */
function offlineClient() {
  const sim = new Sim({
    ...offlineWorldConfig({ playerClass: 'warrior', name: 'Tester', devCommands: true }),
    // a fresh character outside the opening tutorial's fence, as the playtester was
    compulsoryTutorial: false,
  });
  const hud = { log: vi.fn(), refreshDayNightDial: vi.fn(), devCommandsAvailable: true };
  const renderer = { scene: {} as never, worldCompileGate: () => undefined };
  const type = (line: string) => {
    if (!tryDevChatHooks(line, { hud, renderer, world: sim as never, offline: true })) {
      sim.chat(line);
    }
  };
  type('/dev season on');
  type('/dev scarecrow');
  // Watch from outside his reach, so no pull keeps him off the pole at dawn (a fight
  // running at dawn is fought to its end, pinned in gourdlight_scarecrow_night.test.ts).
  const b = boss(sim);
  sim.player.pos = sim.groundPos(b.pos.x + 60, b.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  seconds(sim, 1);
  return { sim, type, hud };
}

describe('Old Thatchgrin and the offline night commands', () => {
  it('hangs on his pole by the morning wall clock', () => {
    const { sim } = offlineClient();
    expect(isDaylightPhase(sim.dayNightPhase() ?? 0.5)).toBe(true);
    expect(boss(sim).asleep).toBe(true);
  });

  it('/daynight night wakes him, and /daynight day puts him back on the pole', () => {
    const { sim, type } = offlineClient();
    type('/daynight night');
    seconds(sim, 1);
    expect(boss(sim).asleep).toBe(false);
    expect(boss(sim).hostile).toBe(true);
    seconds(sim, 3);
    type('/daynight day');
    seconds(sim, 20);
    expect(boss(sim).asleep).toBe(true);
  });

  it('/dev servertime night wakes him, and the advised /daynight night keeps him up', () => {
    const { sim, type } = offlineClient();
    type('/dev servertime night');
    seconds(sim, 1);
    expect(boss(sim).asleep).toBe(false);
    type('/daynight night');
    seconds(sim, 1);
    expect(isDaylightPhase(sim.dayNightPhase() ?? 0.5)).toBe(false);
    expect(boss(sim).asleep).toBe(false);
  });

  it('the last command typed wins, whichever of the two it is', () => {
    const { sim, type } = offlineClient();
    type('/dev servertime night');
    seconds(sim, 4);
    type('/daynight day');
    seconds(sim, 20);
    expect(boss(sim).asleep).toBe(true);
    type('/dev servertime night');
    seconds(sim, 1);
    expect(boss(sim).asleep).toBe(false);
    seconds(sim, 3);
    type('/dev servertime day');
    seconds(sim, 20);
    expect(boss(sim).asleep).toBe(true);
    type('/dev servertime auto');
    expect(isDaylightPhase(sim.dayNightPhase() ?? 0)).toBe(true); // the morning wall clock
  });

  it('online, /dev servertime still reaches the server (the hook leaves it alone)', () => {
    const hud = { log: vi.fn(), refreshDayNightDial: vi.fn(), devCommandsAvailable: true };
    const renderer = { scene: {} as never, worldCompileGate: () => undefined };
    const world = { player: undefined, chat: vi.fn() } as never;
    expect(tryDevChatHooks('/dev servertime night', { hud, renderer, world, offline: false })).toBe(
      false,
    );
  });
});
