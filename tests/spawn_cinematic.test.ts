import { describe, expect, it } from 'vitest';
import {
  type CameraPose,
  recordSkipTap,
  SKIP_TAP_COUNT,
  SKIP_TAP_WINDOW_SEC,
  type SpawnIntroGate,
  shouldPersistIntroSeen,
  shouldPlaySpawnIntro,
  spawnCinematicFor,
  spawnCinematicPose,
} from '../src/game/spawn_cinematic';

// The gameplay pose the cinematic must land on (input.ts camera defaults).
const END: CameraPose = { yaw: Math.PI, pitch: 0.32, dist: 12 };

describe('spawn cinematic camera path', () => {
  const cin = spawnCinematicFor(END);

  it('opens far out and high, a fraction of a turn behind the landing yaw', () => {
    const p0 = spawnCinematicPose(0, cin);
    expect(p0.done).toBe(false);
    expect(p0.dist).toBe(cin.startDist);
    expect(p0.pitch).toBe(cin.startPitch);
    expect(p0.yaw).toBeCloseTo(END.yaw - cin.turns * Math.PI * 2, 10);
    // An approach, not an orbit: well under half a turn of total sweep.
    expect(cin.turns).toBeLessThan(0.5);
    // An establishing shot: it starts far beyond the gameplay camera.
    expect(cin.startDist).toBeGreaterThan(2 * END.dist);
  });

  it('clamps negative time to the opening pose', () => {
    expect(spawnCinematicPose(-5, cin)).toEqual(spawnCinematicPose(0, cin));
  });

  it('lands exactly on the gameplay pose and reports done', () => {
    for (const t of [cin.durationSec, cin.durationSec + 3]) {
      const p = spawnCinematicPose(t, cin);
      expect(p.done).toBe(true);
      expect(p.yaw).toBeCloseTo(END.yaw, 10);
      expect(p.pitch).toBeCloseTo(END.pitch, 10);
      expect(p.dist).toBeCloseTo(END.dist, 10);
    }
  });

  it('moves monotonically: yaw forward, camera always closing in and settling', () => {
    let prev = spawnCinematicPose(0, cin);
    for (let t = 0.05; t <= cin.durationSec; t += 0.05) {
      const p = spawnCinematicPose(t, cin);
      expect(p.yaw).toBeGreaterThanOrEqual(prev.yaw);
      expect(p.dist).toBeLessThanOrEqual(prev.dist + 1e-9);
      expect(p.pitch).toBeLessThanOrEqual(prev.pitch + 1e-9);
      prev = p;
    }
  });

  it('is continuous: no per-frame jumps anywhere on the path', () => {
    const step = 1 / 60;
    let prev = spawnCinematicPose(0, cin);
    for (let t = step; t <= cin.durationSec + step; t += step) {
      const p = spawnCinematicPose(t, cin);
      expect(Math.abs(p.yaw - prev.yaw)).toBeLessThan(0.05);
      expect(Math.abs(p.dist - prev.dist)).toBeLessThan(0.15);
      expect(Math.abs(p.pitch - prev.pitch)).toBeLessThan(0.02);
      prev = p;
    }
  });
});

describe('skip tap burst', () => {
  it('a lone tap or slow taps never skip', () => {
    const taps: number[] = [];
    expect(recordSkipTap(taps, 1)).toBe(false);
    // One tap every 2 s: the window keeps pruning, never reaches the count.
    for (let t = 3; t < 20; t += 2) expect(recordSkipTap(taps, t)).toBe(false);
  });

  it('a rapid burst skips', () => {
    const taps: number[] = [];
    let skipped = false;
    for (let i = 0; i < SKIP_TAP_COUNT; i++) {
      skipped = recordSkipTap(taps, 1 + i * 0.15);
    }
    expect(skipped).toBe(true);
  });

  it('taps outside the window do not count toward the burst', () => {
    const taps: number[] = [];
    for (let i = 0; i < SKIP_TAP_COUNT - 1; i++) recordSkipTap(taps, i * 0.1);
    // The next tap lands past the window: everything before it is pruned.
    expect(recordSkipTap(taps, SKIP_TAP_WINDOW_SEC + 1)).toBe(false);
  });
});

describe('does the arrival cinematic play', () => {
  const gate = (over: Partial<SpawnIntroGate> = {}): SpawnIntroGate => ({
    requested: true,
    seen: false,
    playerLevel: 1,
    reduceMotion: false,
    tutorial: false,
    ...over,
  });

  it('plays once for a fresh live character, then never again', () => {
    expect(shouldPlaySpawnIntro(gate())).toBe(true);
    expect(shouldPlaySpawnIntro(gate({ seen: true }))).toBe(false);
  });

  it('REPLAYS every time on the tutorial isle, seen marker or not', () => {
    // The regression this exists for: the isle's arrival is a set piece (you wash
    // ashore and the camera sweeps in off the sea), not a one-time welcome. It was
    // being suppressed on the second visit by the live world's seen marker, so a
    // player only ever saw the opening of the tutorial once, on their first class.
    expect(shouldPlaySpawnIntro(gate({ tutorial: true, seen: true }))).toBe(true);
    expect(shouldPlaySpawnIntro(gate({ tutorial: true, seen: false }))).toBe(true);
  });

  it('never persists the seen marker for a tutorial session', () => {
    // Persisting it would retire the isle's own arrival, AND (because the tutorial
    // borrows the offline keybind scope, class + name) silently retire the
    // first-spawn intro for an ordinary offline character of the same class + name.
    expect(shouldPersistIntroSeen(true)).toBe(false);
    expect(shouldPersistIntroSeen(false)).toBe(true);
  });

  it('reduce motion outranks everything, the tutorial included', () => {
    expect(shouldPlaySpawnIntro(gate({ reduceMotion: true }))).toBe(false);
    expect(shouldPlaySpawnIntro(gate({ reduceMotion: true, tutorial: true }))).toBe(false);
  });

  it('never plays for a character past level 1, or when not asked for', () => {
    expect(shouldPlaySpawnIntro(gate({ playerLevel: 2 }))).toBe(false);
    expect(shouldPlaySpawnIntro(gate({ playerLevel: 2, tutorial: true }))).toBe(false);
    expect(shouldPlaySpawnIntro(gate({ requested: false }))).toBe(false);
    expect(shouldPlaySpawnIntro(gate({ requested: false, tutorial: true }))).toBe(false);
  });
});
