// G2 persistence finalize: serializeCharacter <-> addPlayer({state}) is the
// server save/load boundary. This proves a fully-populated character round-trips
// deep-equal (every extracted subsystem's PlayerMeta fields survive), that a
// legacy save missing the post-launch fields loads with sane defaults (back-compat),
// and that the fiesta-snapshot branch persists the PRE-fiesta level. serializeCharacter
// and addPlayer stay on Sim and route through the shared sanitizeRemovedZone1Content
// normalizer; this slice did not change their bodies (verify pass).

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

describe('serializeCharacter <-> addPlayer round-trip (G2 persistence)', () => {
  it('a fully-populated character round-trips deep-equal through serialize -> load -> serialize', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Saver');
    sim.setPlayerLevel(12, pid);
    const meta = sim.meta(pid)!;
    meta.copper = 4242;
    sim.addItem('wolf_fang', 5, pid);
    sim.addItem('baked_bread', 2, pid);
    meta.arenaRating = 1650;
    meta.arenaWins = 7;
    meta.arenaLosses = 3;
    meta.arena2v2Rating = 1880;
    meta.arena2v2Wins = 11;
    meta.arena2v2Losses = 4;
    meta.prestigeRank = 2;
    meta.unlockedMilestones = new Set(['m_first', 'm_second']);
    meta.restedXp = 321;
    meta.skin = 3;
    meta.skinCatalog = 'mech';
    meta.pendingSkinRank = 'rare';
    meta.loadouts = [{ name: 'PvP', alloc: meta.talents, bar: [] }];
    meta.activeLoadout = 0;
    meta.delveMarks = 17;
    meta.delveClears = { crypt: 4 };
    meta.companionUpgrades = { tessa: 2 };
    meta.delveLoreUnlocked = new Set(['lore_1']);
    meta.delveDaily = { date: '2026-06-26', firstClearXp: new Set(['crypt']), markClears: 2 };

    const s1 = sim.serializeCharacter(pid)!;
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: s1 });
    const s2 = sim2.serializeCharacter(pid2)!;
    expect(s2).toEqual(s1);
    // spot-check that the rich fields actually survived (not all defaulted to empty).
    expect(s2.arena2v2Rating).toBe(1880);
    expect(s2.delveMarks).toBe(17);
    expect(s2.loadouts?.length).toBe(1);
    expect(s2.skinCatalog).toBe('mech');
  });

  it('a legacy state missing the post-launch fields loads with sane defaults', () => {
    const sim = makeWorld();
    const seed = sim.addPlayer('warrior', 'Seed');
    const full = sim.serializeCharacter(seed)!;
    // simulate an old save: strip the fields added after the field existed.
    const legacy: Record<string, unknown> = { ...full };
    for (const key of [
      'arenaRating',
      'arenaWins',
      'arenaLosses',
      'arena1v1Rating',
      'arena1v1Wins',
      'arena1v1Losses',
      'arena2v2Rating',
      'arena2v2Wins',
      'arena2v2Losses',
      'skin',
      'skinCatalog',
      'pendingSkinRank',
      'pendingSkinCatalog',
      'pendingSkinItemId',
      'loadouts',
      'activeLoadout',
      'delveMarks',
      'delveClears',
      'companionUpgrades',
      'delveLoreUnlocked',
      'delveDaily',
      'prestigeRank',
      'unlockedMilestones',
      'lifetimeXp',
      'restedXp',
    ]) {
      delete legacy[key];
    }

    const sim2 = makeWorld();
    const pid = sim2.addPlayer('warrior', 'Legacy', { state: legacy as never });
    const m = sim2.meta(pid)!;
    expect(m.arena2v2Rating).toBe(m.arenaRating); // both default to ARENA_BASE_RATING
    expect(m.arena2v2Wins).toBe(0);
    expect(m.delveMarks).toBe(0);
    expect(m.delveClears).toEqual({});
    expect(m.companionUpgrades).toEqual({});
    expect(m.delveLoreUnlocked.size).toBe(0);
    expect(m.delveDaily.date).toBe('');
    expect(m.skin).toBe(0);
    expect(m.skinCatalog).toBe('class');
    expect(m.loadouts).toEqual([]);
    expect(m.prestigeRank).toBe(0);
    expect(m.restedXp).toBe(0);
    // re-serializing a defaulted character does not throw and fills the new fields.
    expect(() => sim2.serializeCharacter(pid)).not.toThrow();
    expect(sim2.serializeCharacter(pid)!.delveMarks).toBe(0);
  });

  it('the fiesta snapshot persists the PRE-fiesta level, not the standardized one', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Bouter');
    sim.setPlayerLevel(20, pid); // pretend mid-bout standardization to 20
    const meta = sim.meta(pid)!;
    meta.fiestaRestore = { level: 8, xp: 1234, talents: meta.talents };
    const s = sim.serializeCharacter(pid)!;
    expect(s.level).toBe(8);
    expect(s.xp).toBe(1234);
  });
});
