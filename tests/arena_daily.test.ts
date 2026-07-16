import { describe, expect, it } from 'vitest';
import {
  ARENA_DAILY_HERO_BASE,
  ARENA_DAILY_HONOR_BASE,
  ARENA_DAILY_HONOR_PER_RATING,
  arenaDailyClaimStatus,
  arenaDailyInfo,
  arenaDailyReward,
  markArenaEntered,
  normalizeArenaDaily,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';

describe('Ashen Coliseum daily: reward + reset logic', () => {
  it('normalizes junk to a well-formed state or undefined', () => {
    expect(normalizeArenaDaily(undefined)).toBeUndefined();
    expect(normalizeArenaDaily({ enteredDay: '', claimedDay: '' })).toBeUndefined();
    expect(normalizeArenaDaily({ enteredDay: '2026-07-15', claimedDay: 3 })).toEqual({
      enteredDay: '2026-07-15',
      claimedDay: '',
    });
  });

  it('scales the reward from arena rating off a flat base', () => {
    expect(arenaDailyReward(0)).toEqual({
      honor: ARENA_DAILY_HONOR_BASE,
      hero: ARENA_DAILY_HERO_BASE,
    });
    const r = arenaDailyReward(1500);
    expect(r.honor).toBe(ARENA_DAILY_HONOR_BASE + Math.floor(1500 / ARENA_DAILY_HONOR_PER_RATING));
    expect(r.honor).toBeGreaterThan(ARENA_DAILY_HONOR_BASE);
    expect(r.hero).toBeGreaterThan(ARENA_DAILY_HERO_BASE);
  });

  it('is claimable only after entering a bout that day, and only once', () => {
    const meta = { arenaRating: 1500 } as unknown as Parameters<typeof arenaDailyClaimStatus>[0];
    // Never entered: unavailable.
    expect(arenaDailyClaimStatus(meta, '2026-07-15')).toBe('unavailable');
    // Entered today: ready.
    markArenaEntered(meta, '2026-07-15');
    expect(arenaDailyClaimStatus(meta, '2026-07-15')).toBe('ready');
    // Claimed today (simulate): claimed.
    meta.arenaDaily = { enteredDay: '2026-07-15', claimedDay: '2026-07-15' };
    expect(arenaDailyClaimStatus(meta, '2026-07-15')).toBe('claimed');
    // Next day, no fresh entry: unavailable again (must re-enter to claim).
    expect(arenaDailyClaimStatus(meta, '2026-07-16')).toBe('unavailable');
  });
});

describe('Ashen Coliseum daily: the claim command', () => {
  it('grants honor + hero once per day and refuses a second claim', () => {
    const sim = new Sim({ seed: 61, playerClass: 'warrior', autoEquip: true });
    const pid = sim.player.id;
    const meta = sim.meta(pid)!;
    meta.arenaRating = 1600;
    sim.utcDay = '2026-07-15';

    // Not entered a bout: refused, no reward.
    const honor0 = meta.honor;
    const hero0 = meta.heroPoints;
    sim.arenaDailyClaim(pid);
    expect(meta.honor).toBe(honor0);
    expect(meta.heroPoints).toBe(hero0);

    // Enter a bout (the arena match hook), then claim: honor + hero granted.
    markArenaEntered(meta, sim.utcDay);
    const { honor, hero } = arenaDailyReward(meta.arenaRating);
    sim.arenaDailyClaim(pid);
    expect(meta.honor).toBe(honor0 + honor);
    expect(meta.heroPoints).toBe(hero0 + hero);
    expect(sim.arenaDaily.status).toBe('claimed');

    // A second claim the same day does nothing.
    sim.arenaDailyClaim(pid);
    expect(meta.honor).toBe(honor0 + honor);
    expect(meta.heroPoints).toBe(hero0 + hero);

    // The reward round-trips through the IWorld read.
    const info = arenaDailyInfo(meta, sim.utcDay);
    expect(info.status).toBe('claimed');
    expect(info.honor).toBe(honor);
  });

  it('persists the daily state across serialize / addPlayer', () => {
    const sim = new Sim({ seed: 62, playerClass: 'warrior', autoEquip: true });
    const meta = sim.meta(sim.player.id)!;
    sim.utcDay = '2026-07-15';
    markArenaEntered(meta, sim.utcDay);
    sim.arenaDailyClaim(sim.player.id);
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.arenaDaily).toEqual({ enteredDay: '2026-07-15', claimedDay: '2026-07-15' });

    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Alt', { state });
    expect(sim2.meta(pid2)!.arenaDaily).toEqual({
      enteredDay: '2026-07-15',
      claimedDay: '2026-07-15',
    });
  });

  it('omits an all-empty record from serialization (byte-stable save/load/save)', () => {
    const sim = new Sim({ seed: 63, playerClass: 'warrior', autoEquip: true });
    const meta = sim.meta(sim.player.id)!;
    // Offline/headless never set a host calendar, so entering a bout stamps ''.
    markArenaEntered(meta, sim.utcDay);
    expect(meta.arenaDaily).toEqual({ enteredDay: '', claimedDay: '' });
    // normalizeArenaDaily coerces the all-empty record back to undefined on load, so
    // emitting it would make save/load/save unstable; the serializer omits it.
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.arenaDaily).toBeUndefined();

    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Alt', { state });
    expect(sim2.meta(pid2)!.arenaDaily).toBeUndefined();
    expect(sim2.serializeCharacter(pid2)!.arenaDaily).toBeUndefined();
  });
});
