// @vitest-environment happy-dom

// The real handleEvents drain wiring of the faction standing tier
// celebration: the observer rides the professions sync flag, baselines
// silently on the first synced drain, plates and logs a later tier crossing
// through the celebration host, and stays quiet on a gain inside a tier.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { STANDING_THRESHOLDS } from '../src/sim/factions';
import type { SimEvent } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

interface DrainHarness {
  sim: {
    playerId: number;
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
    gatheringProficiency: Record<string, number>;
    factions: Record<string, number>;
  };
  bannerEl: HTMLElement;
  bannerTimer: number | undefined;
  log: ReturnType<typeof vi.fn>;
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  prevCraftSkillLevels: Record<string, number> | null;
  prevGatheringSkillLevels: Record<string, number> | null;
  prevFactionStanding: Record<string, number> | null;
  handleEvents(events: SimEvent[]): void;
}

function drainHud(synced: boolean): DrainHarness {
  const hud = Object.create(Hud.prototype) as unknown as DrainHarness;
  hud.sim = {
    playerId: 1,
    craftingIdentity: { synced },
    craftSkills: {},
    gatheringProficiency: {},
    factions: { rift_watch: 0, church_order: 0, automatons: 0 },
  };
  hud.bannerEl = document.createElement('div');
  hud.bannerTimer = undefined;
  hud.log = vi.fn();
  hud.combatAnnouncer = { push: vi.fn() };
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  hud.prevCraftSkillLevels = null;
  hud.prevGatheringSkillLevels = null;
  hud.prevFactionStanding = null;
  return hud;
}

describe('faction tier celebration: the handleEvents drain wiring', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('baselines silently, then plates a later tier crossing and logs it', () => {
    vi.useFakeTimers();
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = drainHud(true);
    hud.sim.factions = { rift_watch: STANDING_THRESHOLDS.trusted, church_order: 0, automatons: 0 };

    // Drain 1: the first synced observation is history, never a toast.
    hud.handleEvents([]);
    expect(hud.log).not.toHaveBeenCalled();
    expect(achievement).not.toHaveBeenCalled();

    // The mirror updates (the online path replaces the object wholesale).
    hud.sim.factions = { rift_watch: STANDING_THRESHOLDS.proven, church_order: 0, automatons: 0 };
    hud.handleEvents([]);
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log).toHaveBeenCalledWith(
      'You are now Proven with the Rift Watch. Your faction title is now Warden.',
      '#ffd100',
    );
    expect(hud.bannerEl.classList.contains('banner-deed')).toBe(true);
    expect(hud.bannerEl.textContent).toContain('Now Proven with the Rift Watch');
    expect(hud.bannerEl.textContent).toContain('Faction title: Warden');
    expect(hud.combatAnnouncer.push).toHaveBeenCalledTimes(1);
    expect(achievement).toHaveBeenCalledTimes(1);

    // Drain 3: a gain inside the tier is silent.
    hud.sim.factions = {
      rift_watch: STANDING_THRESHOLDS.proven + 80,
      church_order: 0,
      automatons: 0,
    };
    hud.handleEvents([]);
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(achievement).toHaveBeenCalledTimes(1);
  });

  it('never baselines on the pre-mirror default (unsynced), so the first real snapshot is history too', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = drainHud(false);
    hud.handleEvents([]);
    expect(hud.prevFactionStanding).toBeNull();
    hud.sim.craftingIdentity = { synced: true };
    hud.sim.factions = { rift_watch: STANDING_THRESHOLDS.champion, church_order: 0, automatons: 0 };
    hud.handleEvents([]);
    expect(hud.log).not.toHaveBeenCalled();
    expect(achievement).not.toHaveBeenCalled();
    expect(hud.prevFactionStanding?.rift_watch).toBe(STANDING_THRESHOLDS.champion);
  });
});
