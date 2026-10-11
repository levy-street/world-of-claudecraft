// The weekly vault opening choreography: every ray, star, streak and ring
// carries its own start and life (nothing fires in lockstep), the stars
// outlive the streaks which outlive the rays, the loot waits for the open
// door, the whole show settles before the host's reveal, and the layout is
// deterministic across hosts and repaints.
import { describe, expect, it } from 'vitest';
import {
  VAULT_PARTICLE_BOX,
  VAULT_TIMELINE,
  type VaultTimeline,
  vaultRayVars,
  vaultRingVars,
  vaultStarVars,
  vaultStreakVars,
  vaultTimelineVars,
  weeklyVaultBurstLayout,
} from '../src/ui/weekly_vault_burst_core';
import { WEEKLY_REVEAL_DURATION_MS } from '../src/ui/weekly_vault_reveal_controller';

const layout = weeklyVaultBurstLayout();
const { burstMs, settleMs } = VAULT_TIMELINE;
const ends = (list: readonly { delay: number; duration: number }[]) =>
  list.map((e) => e.delay + e.duration);
const mean = (list: readonly number[]) => list.reduce((a, b) => a + b, 0) / list.length;
const timingPairs = (list: readonly { delay: number; duration: number }[]) =>
  new Set(list.map((e) => `${e.delay}:${e.duration}`));
const quadrants = (angles: readonly number[]) =>
  new Set(angles.map((a) => Math.floor((((a % 360) + 360) % 360) / 90)));

describe('weekly vault burst core: the timeline', () => {
  it('orders the show: seam glow, swing, burst, door clear, door open, settle, reveal', () => {
    const t = VAULT_TIMELINE;
    expect(t.chargeMs).toBe(0);
    expect(t.chargeMs).toBeLessThan(t.swingMs);
    expect(t.swingMs).toBeLessThan(t.burstMs);
    expect(t.burstMs).toBeLessThan(t.doorClearMs);
    expect(t.doorClearMs).toBeLessThan(t.doorOpenMs);
    // The loot never starts before the door has swung clear (the bug this
    // suite exists for), starts while the burst is still going, and has
    // finished fading before the host enables it.
    expect(t.lootMs).toBeGreaterThanOrEqual(t.doorClearMs);
    expect(t.lootMs).toBeLessThan(t.settleMs);
    expect(t.lootMs + t.lootFadeMs).toBeLessThanOrEqual(t.revealMs);
    expect(t.settleMs).toBeLessThan(t.revealMs);
  });

  it('is the one source of the controller reveal duration', () => {
    expect(WEEKLY_REVEAL_DURATION_MS).toBe(VAULT_TIMELINE.revealMs);
  });

  it('stamps every milestone the stylesheet reads as a --vault-t-* ms var', () => {
    const vars = vaultTimelineVars();
    expect(vars).toEqual({
      '--vault-t-charge': '0ms',
      '--vault-t-burst': '560ms',
      '--vault-t-open': '1760ms',
      '--vault-t-loot': '1000ms',
      '--vault-t-loot-fade': '420ms',
    });
    const custom: VaultTimeline = { ...VAULT_TIMELINE, lootMs: 2222 };
    expect(vaultTimelineVars(custom)['--vault-t-loot']).toBe('2222ms');
  });
});

describe('weekly vault burst core: the layout', () => {
  it('is deterministic: two mints are identical, and a custom timeline shifts the burst', () => {
    expect(weeklyVaultBurstLayout()).toEqual(layout);
    const later = weeklyVaultBurstLayout({ ...VAULT_TIMELINE, burstMs: burstMs + 100 });
    expect(later.rays.map((r) => r.delay)).toEqual(layout.rays.map((r) => r.delay + 100));
  });

  it('rays fire individually: distinct start/life pairs, spread speeds, three tiers, all around', () => {
    const { rays } = layout;
    expect(rays.length).toBeGreaterThanOrEqual(24);
    expect(timingPairs(rays).size).toBe(rays.length);
    const durations = rays.map((r) => r.duration);
    expect(Math.max(...durations) - Math.min(...durations)).toBeGreaterThanOrEqual(600);
    const delays = rays.map((r) => r.delay);
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThanOrEqual(150);
    for (const r of rays) {
      expect(r.delay).toBeGreaterThanOrEqual(burstMs);
      expect(r.delay + r.duration).toBeLessThanOrEqual(settleMs);
      expect(r.length).toBeGreaterThan(0);
      expect(r.width).toBeGreaterThan(0);
      expect(Math.abs(r.drift)).toBeGreaterThan(0);
      expect(r.peak).toBeGreaterThan(0);
      expect(r.peak).toBeLessThanOrEqual(1);
      // Origins cluster on the doorway centre, not the frame.
      expect(Math.abs(r.x - 50)).toBeLessThanOrEqual(5);
      expect(Math.abs(r.y - 50)).toBeLessThanOrEqual(5);
    }
    const tiers = new Set(rays.map((r) => r.tier));
    expect(tiers).toEqual(new Set(['wide', 'mid', 'thin']));
    const width = (tier: string) => mean(rays.filter((r) => r.tier === tier).map((r) => r.width));
    expect(width('wide')).toBeGreaterThan(width('mid'));
    expect(width('mid')).toBeGreaterThan(width('thin'));
    expect(quadrants(rays.map((r) => r.angle)).size).toBe(4);
    // Fan-out goes both ways, so the beams do not all lean one way.
    expect(rays.some((r) => r.drift > 0) && rays.some((r) => r.drift < 0)).toBe(true);
  });

  it('stars burst out, twinkle inside their life and linger longest; streaks quicker; rays quickest', () => {
    const { stars, streaks, rays } = layout;
    expect(stars.length).toBeGreaterThanOrEqual(10);
    expect(streaks.length).toBeGreaterThanOrEqual(12);
    expect(timingPairs(stars).size).toBe(stars.length);
    expect(timingPairs(streaks).size).toBe(streaks.length);
    for (const s of [...stars, ...streaks]) {
      expect(s.delay).toBeGreaterThanOrEqual(burstMs);
      expect(s.delay + s.duration).toBeLessThanOrEqual(settleMs);
      expect(Math.hypot(s.x, s.y)).toBeGreaterThan(20);
    }
    for (const s of stars) {
      expect(s.size).toBeGreaterThan(0);
      expect(s.twinkleMs).toBeGreaterThanOrEqual(120);
      expect(s.twinkleMs).toBeLessThanOrEqual(400);
      expect(s.twinkles).toBeGreaterThanOrEqual(1);
      // The twinkle never outlives the star, so it is gone before the settle.
      expect(s.twinkles * s.twinkleMs).toBeLessThanOrEqual(s.duration);
      expect(Math.abs(s.spin)).toBeGreaterThan(0);
    }
    for (const s of streaks) expect(s.length).toBeGreaterThan(0);
    expect(mean(stars.map((s) => s.duration))).toBeGreaterThan(
      mean(streaks.map((s) => s.duration)),
    );
    expect(mean(streaks.map((s) => s.duration))).toBeGreaterThan(mean(rays.map((r) => r.duration)));
    expect(Math.max(...ends(stars))).toBeGreaterThan(Math.max(...ends(streaks)));
    expect(quadrants(stars.map((s) => (Math.atan2(s.y, s.x) * 180) / Math.PI)).size).toBe(4);
    expect(quadrants(streaks.map((s) => s.angle)).size).toBe(4);
  });

  it('rings: two shockwaves, the second later, slower and wider, both settled in time', () => {
    const { rings } = layout;
    expect(rings).toHaveLength(2);
    expect(rings[1].delay).toBeGreaterThan(rings[0].delay);
    expect(rings[1].duration).toBeGreaterThan(rings[0].duration);
    expect(rings[1].scale).toBeGreaterThan(rings[0].scale);
    for (const r of rings) {
      expect(r.delay).toBeGreaterThanOrEqual(burstMs);
      expect(r.delay + r.duration).toBeLessThanOrEqual(settleMs);
    }
  });
});

describe('weekly vault burst core: the --vault-* var mapping', () => {
  it('mints unit-bearing values under the --vault- prefix for every family', () => {
    const [ray] = layout.rays;
    const [star] = layout.stars;
    const [streak] = layout.streaks;
    const [ring] = layout.rings;
    const all = [
      vaultRayVars(ray),
      vaultStarVars(star),
      vaultStreakVars(streak),
      vaultRingVars(ring),
    ];
    for (const vars of all)
      for (const name of Object.keys(vars)) expect(name.startsWith('--vault-')).toBe(true);
    expect(vaultRayVars(ray)).toMatchObject({
      '--vault-ray-x': `${ray.x}%`,
      '--vault-ray-angle': `${ray.angle}deg`,
      '--vault-ray-delay': `${ray.delay}ms`,
      '--vault-ray-duration': `${ray.duration}ms`,
      '--vault-ray-drift': `${ray.drift}deg`,
      '--vault-ray-peak': String(ray.peak),
    });
    expect(vaultRingVars(ring)).toEqual({
      '--vault-ring-delay': `${ring.delay}ms`,
      '--vault-ring-duration': `${ring.duration}ms`,
      '--vault-ring-scale': String(ring.scale),
    });
    expect(vaultStreakVars(streak)['--vault-streak-angle']).toBe(`${streak.angle}deg`);
    expect(vaultStarVars(star)['--vault-star-twinkle']).toBe(`${star.twinkleMs}ms`);
    expect(vaultStarVars(star)['--vault-star-twinkles']).toBe(String(star.twinkles));
  });

  it('converts particle reach from illustration percent to box percent', () => {
    const star = {
      x: 30,
      y: -12.5,
      size: 6,
      delay: 600,
      duration: 1500,
      twinkleMs: 200,
      twinkles: 7,
      spin: 30,
    };
    const vars = vaultStarVars(star);
    expect(vars['--vault-star-x']).toBe(`${(30 * 100) / VAULT_PARTICLE_BOX}%`);
    expect(vars['--vault-star-y']).toBe(`${(-12.5 * 100) / VAULT_PARTICLE_BOX}%`);
    expect(vars['--vault-star-size']).toBe(`${(6 * 100) / VAULT_PARTICLE_BOX}%`);
    const streak = { x: 20, y: 0, angle: 0, length: 8, delay: 600, duration: 1200 };
    expect(vaultStreakVars(streak)['--vault-streak-length']).toBe(
      `${(8 * 100) / VAULT_PARTICLE_BOX}%`,
    );
  });
});
