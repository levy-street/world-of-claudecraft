// @vitest-environment happy-dom

// Pure-core pins for profession skill level-up toasts: integer floor crossings
// over craft and gathering skill snapshots, silent first init, the milestone
// cadence (chat line every point, plate/chime only on a gathering 25-crossing),
// cross-drain chime dedupe, reduced-motion batching, the HUD paint contracts
// the skill plate renders, and the real handleEvents drain wiring.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import type { SimEvent } from '../src/sim/types';
import { type BannerVariant, Hud } from '../src/ui/hud';
import { professionImageUrl } from '../src/ui/profession_art';
import {
  advanceSkillLevelObservation,
  buildSkillLevelCelebrationPlan,
  computeSkillLevelUps,
  crossedSkillPlateMilestone,
  SKILL_PLATE_MILESTONE_STEP,
  skillDisplayLevel,
  skillLevelArtId,
} from '../src/ui/skill_level_toast_view';

describe('skillDisplayLevel', () => {
  it('floors a fractional skill to the player-visible level', () => {
    expect(skillDisplayLevel(24.9)).toBe(24);
    expect(skillDisplayLevel(25)).toBe(25);
    expect(skillDisplayLevel(25.01)).toBe(25);
  });

  it('treats non-positive and non-finite values as 0', () => {
    expect(skillDisplayLevel(0)).toBe(0);
    expect(skillDisplayLevel(-3)).toBe(0);
    expect(skillDisplayLevel(Number.NaN)).toBe(0);
    expect(skillDisplayLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('computeSkillLevelUps', () => {
  it('reports no skill-ups on first observation (null prev), the silent init', () => {
    expect(computeSkillLevelUps(null, { mining: 47, cooking: 12 })).toEqual([]);
  });

  it('reports nothing when floors do not climb (fractional progress only)', () => {
    expect(
      computeSkillLevelUps({ mining: 24.1, cooking: 10 }, { mining: 24.9, cooking: 10.75 }),
    ).toEqual([]);
  });

  it('reports one entry with both floors on a single crossing', () => {
    expect(computeSkillLevelUps({ mining: 24.9 }, { mining: 25.1 })).toEqual([
      { skillId: 'mining', fromLevel: 24, toLevel: 25 },
    ]);
  });

  it('reports one entry per skill when several climb in one drain', () => {
    expect(
      computeSkillLevelUps({ mining: 10.5, cooking: 49.2 }, { mining: 11.0, cooking: 50.0 }),
    ).toEqual([
      { skillId: 'mining', fromLevel: 10, toLevel: 11 },
      { skillId: 'cooking', fromLevel: 49, toLevel: 50 },
    ]);
  });

  it('collapses a multi-level jump to a single entry carrying both floors', () => {
    expect(computeSkillLevelUps({ mining: 1.2 }, { mining: 12.8 })).toEqual([
      { skillId: 'mining', fromLevel: 1, toLevel: 12 },
    ]);
  });

  it('treats a skill key absent from prev as level 0', () => {
    expect(computeSkillLevelUps({}, { cooking: 0.5 })).toEqual([]);
    expect(computeSkillLevelUps({}, { cooking: 1.0 })).toEqual([
      { skillId: 'cooking', fromLevel: 0, toLevel: 1 },
    ]);
  });

  it('never reports a downward move (skills are monotonic)', () => {
    expect(computeSkillLevelUps({ mining: 20 }, { mining: 5 })).toEqual([]);
  });
});

describe('crossedSkillPlateMilestone', () => {
  it('pins the milestone stride to the 25-point tier step', () => {
    expect(SKILL_PLATE_MILESTONE_STEP).toBe(25);
  });

  it('fires exactly when a crossing passes a multiple of the stride', () => {
    expect(crossedSkillPlateMilestone({ skillId: 'mining', fromLevel: 24, toLevel: 25 })).toBe(
      true,
    );
    expect(crossedSkillPlateMilestone({ skillId: 'mining', fromLevel: 49, toLevel: 50 })).toBe(
      true,
    );
    expect(crossedSkillPlateMilestone({ skillId: 'mining', fromLevel: 25, toLevel: 26 })).toBe(
      false,
    );
    expect(crossedSkillPlateMilestone({ skillId: 'mining', fromLevel: 0, toLevel: 1 })).toBe(false);
    expect(crossedSkillPlateMilestone({ skillId: 'mining', fromLevel: 1, toLevel: 12 })).toBe(
      false,
    );
  });

  it('still fires once when a multi-level jump clears a boundary', () => {
    expect(crossedSkillPlateMilestone({ skillId: 'mining', fromLevel: 23, toLevel: 26 })).toBe(
      true,
    );
  });
});

describe('buildSkillLevelCelebrationPlan', () => {
  it('plans nothing for an empty drain', () => {
    expect(buildSkillLevelCelebrationPlan([], [], false, false)).toEqual({
      skillUpLogs: [],
      banner: null,
      playSound: false,
      motion: false,
    });
  });

  it('craft ups log but NEVER plate or chime (tier-up owns craft boundaries)', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [{ skillId: 'cooking', fromLevel: 24, toLevel: 25 }],
      [],
      false,
      false,
    );
    expect(plan.skillUpLogs).toEqual([{ skillId: 'cooking', fromLevel: 24, toLevel: 25 }]);
    expect(plan.banner).toBeNull();
    expect(plan.playSound).toBe(false);
    expect(plan.motion).toBe(false);
  });

  it('a gathering crossing between milestones logs without a plate', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [],
      [{ skillId: 'mining', fromLevel: 46, toLevel: 47 }],
      false,
      false,
    );
    expect(plan.skillUpLogs).toEqual([{ skillId: 'mining', fromLevel: 46, toLevel: 47 }]);
    expect(plan.banner).toBeNull();
    expect(plan.playSound).toBe(false);
  });

  it('a gathering milestone crossing plates, chimes, and moves', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [],
      [{ skillId: 'mining', fromLevel: 24, toLevel: 25 }],
      false,
      false,
    );
    expect(plan.banner).toEqual({ skillId: 'mining', fromLevel: 24, toLevel: 25 });
    expect(plan.playSound).toBe(true);
    expect(plan.motion).toBe(true);
  });

  it('logs craft then gathering and coalesces the plate to the LAST milestone', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [{ skillId: 'cooking', fromLevel: 12, toLevel: 13 }],
      [
        { skillId: 'fishing', fromLevel: 24, toLevel: 25 },
        { skillId: 'mining', fromLevel: 46, toLevel: 47 },
      ],
      false,
      false,
    );
    expect(plan.skillUpLogs).toEqual([
      { skillId: 'cooking', fromLevel: 12, toLevel: 13 },
      { skillId: 'fishing', fromLevel: 24, toLevel: 25 },
      { skillId: 'mining', fromLevel: 46, toLevel: 47 },
    ]);
    // fishing is the milestone; mining's later non-milestone crossing must
    // not steal the slot.
    expect(plan.banner).toEqual({ skillId: 'fishing', fromLevel: 24, toLevel: 25 });
    expect(plan.playSound).toBe(true);
  });

  it('two gathering milestones in one drain plate the LAST one', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [],
      [
        { skillId: 'mining', fromLevel: 24, toLevel: 25 },
        { skillId: 'herbalism', fromLevel: 49, toLevel: 50 },
      ],
      false,
      false,
    );
    expect(plan.banner).toEqual({ skillId: 'herbalism', fromLevel: 49, toLevel: 50 });
    expect(plan.playSound).toBe(true);
  });

  it('stands the chime down when the drain already chimed, keeping the plate', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [],
      [{ skillId: 'mining', fromLevel: 24, toLevel: 25 }],
      false,
      true,
    );
    expect(plan.banner).toEqual({ skillId: 'mining', fromLevel: 24, toLevel: 25 });
    expect(plan.playSound).toBe(false);
    expect(plan.motion).toBe(true);
  });

  it('reducedMotion trims MOTION only: logs, plate, and chime survive', () => {
    const plan = buildSkillLevelCelebrationPlan(
      [],
      [{ skillId: 'mining', fromLevel: 49, toLevel: 50 }],
      true,
      false,
    );
    expect(plan.motion).toBe(false);
    expect(plan.banner).toEqual({ skillId: 'mining', fromLevel: 49, toLevel: 50 });
    expect(plan.playSound).toBe(true);
  });

  it('does not mutate or alias the caller arrays', () => {
    const craftUps = [{ skillId: 'cooking', fromLevel: 11, toLevel: 12 }];
    const gatherUps = [{ skillId: 'mining', fromLevel: 24, toLevel: 25 }];
    const plan = buildSkillLevelCelebrationPlan(craftUps, gatherUps, false, false);
    expect(plan.skillUpLogs).not.toBe(craftUps);
    expect(plan.skillUpLogs).not.toBe(gatherUps);
    expect(craftUps).toEqual([{ skillId: 'cooking', fromLevel: 11, toLevel: 12 }]);
    expect(gatherUps).toEqual([{ skillId: 'mining', fromLevel: 24, toLevel: 25 }]);
  });
});

describe('advanceSkillLevelObservation (silent init + always-on after)', () => {
  it('never baselines an unsynced mirror, even with values present', () => {
    const obs = advanceSkillLevelObservation(false, null, { mining: 40 });
    expect(obs).toEqual({ skillUps: [], prev: null });
  });

  it('leaves an initialized snapshot UNTOUCHED while unsynced', () => {
    const prev = { mining: 24.1 };
    const obs = advanceSkillLevelObservation(false, prev, { mining: 25.9 });
    expect(obs.skillUps).toEqual([]);
    expect(obs.prev).toBe(prev);
    expect(prev.mining).toBe(24.1);
  });

  it('initializes silently on the first synced observation, copying next', () => {
    const next = { mining: 40, cooking: 12 };
    const obs = advanceSkillLevelObservation(true, null, next);
    expect(obs.skillUps).toEqual([]);
    expect(obs.prev).toEqual(next);
    expect(obs.prev).not.toBe(next);
  });

  it('reports floor crossings and advances the SAME snapshot in place', () => {
    const prev = { mining: 24.9 };
    const obs = advanceSkillLevelObservation(true, prev, { mining: 25.1 });
    expect(obs.skillUps).toEqual([{ skillId: 'mining', fromLevel: 24, toLevel: 25 }]);
    expect(obs.prev).toBe(prev);
    expect(obs.prev?.mining).toBe(25.1);
  });

  it('carries values forward without toasting pure fractional progress', () => {
    const prev = { mining: 24.1 };
    const obs = advanceSkillLevelObservation(true, prev, { mining: 24.8 });
    expect(obs.skillUps).toEqual([]);
    expect(obs.prev?.mining).toBe(24.8);
  });
});

describe('skillLevelArtId', () => {
  it('maps gathering ids to the profession art registry prefix', () => {
    expect(skillLevelArtId('mining')).toBe('gather_mining');
    expect(skillLevelArtId('fishing')).toBe('gather_fishing');
  });

  it('resolves to shipped art URLs for every gathering profession', () => {
    for (const id of ['mining', 'logging', 'herbalism', 'fishing'] as const) {
      expect(professionImageUrl(skillLevelArtId(id))).toMatch(
        new RegExp(`/ui/professions/gather_${id}\\.webp$`),
      );
    }
  });
});

interface SkillLevelHudHarness {
  bannerEl: HTMLElement;
  bannerTimer: number | undefined;
  log: ReturnType<typeof vi.fn>;
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  handleSkillLevelCelebrations(
    craftUps: { skillId: string; fromLevel: number; toLevel: number }[],
    gatherUps: { skillId: string; fromLevel: number; toLevel: number }[],
    celebrationAlreadyChimed: boolean,
  ): void;
  showBanner(
    text: string,
    motion?: boolean,
    decorativeIconUrl?: string,
    variant?: BannerVariant,
    subtext?: string,
  ): void;
}

function skillLevelHud(): SkillLevelHudHarness {
  const hud = Object.create(Hud.prototype) as unknown as SkillLevelHudHarness;
  hud.bannerEl = document.createElement('div');
  hud.bannerTimer = undefined;
  hud.log = vi.fn();
  hud.combatAnnouncer = { push: vi.fn() };
  return hud;
}

/** Ends the live celebration the way the advance chain does, so a follow-up
 *  banner paints instead of queueing behind the plate. */
function clearBannerSlot(hud: SkillLevelHudHarness): void {
  const queueHost = hud as unknown as {
    bannerQueue?: { clear(): void };
    bannerTimer: number | undefined;
  };
  queueHost.bannerQueue?.clear();
  queueHost.bannerTimer = undefined;
}

describe('skill level celebration HUD behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(
      (query: string) =>
        ({ matches: query === '(prefers-reduced-motion: reduce)', media: query }) as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders crest, name title, level subtext, and announces under reduced motion', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = skillLevelHud();

    hud.handleSkillLevelCelebrations(
      [],
      [{ skillId: 'mining', fromLevel: 24, toLevel: 25 }],
      false,
    );

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    const icon = hud.bannerEl.querySelector<HTMLImageElement>('img.banner-art');
    const copy = hud.bannerEl.querySelector<HTMLElement>('.banner-art-copy');
    const title = hud.bannerEl.querySelector<HTMLElement>('.banner-title');
    const sub = hud.bannerEl.querySelector<HTMLElement>('.banner-subtext');
    expect(icon?.getAttribute('src')).toBe(professionImageUrl('gather_mining'));
    expect(icon?.alt).toBe('');
    expect(title?.textContent).toBe('Mining');
    expect(sub?.textContent).toBe('Skill increased to 25!');
    // The title/detail column rides inside the variant-agnostic wrapper.
    expect(copy?.contains(title as Node)).toBe(true);
    expect(copy?.contains(sub as Node)).toBe(true);
    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(true);
    expect(hud.bannerEl.classList.contains('banner-with-art')).toBe(true);
    expect(hud.bannerEl.classList.contains('has-subtext')).toBe(true);
    expect(hud.bannerEl.classList.contains('banner-no-motion')).toBe(true);
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log).toHaveBeenCalledWith('Mining skill increased to 25!', '#ffd100');
    // The polite region gets the COMBINED line: the level the visual title
    // omits must reach a screen reader.
    expect(hud.combatAnnouncer.push).toHaveBeenCalledTimes(1);
    expect(hud.combatAnnouncer.push.mock.calls[0][0]).toBe('Mining skill increased to 25!');
    expect(achievement).toHaveBeenCalledTimes(1);

    // A later ordinary banner through the same reused element must not
    // inherit the skill language.
    clearBannerSlot(hud);
    hud.showBanner('Ordinary banner');
    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(false);
    expect(hud.bannerEl.classList.contains('banner-with-art')).toBe(false);
    expect(hud.bannerEl.querySelector('img')).toBeNull();
    expect(hud.bannerEl.querySelector('.banner-copy')?.textContent).toBe('Ordinary banner');
  });

  it('keeps the fade (no banner-no-motion) when motion is not reduced', () => {
    vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    window.matchMedia = vi.fn(
      (query: string) => ({ matches: false, media: query }) as MediaQueryList,
    );
    const hud = skillLevelHud();

    hud.handleSkillLevelCelebrations(
      [],
      [{ skillId: 'mining', fromLevel: 24, toLevel: 25 }],
      false,
    );

    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(true);
    expect(hud.bannerEl.classList.contains('banner-no-motion')).toBe(false);
  });

  it('a multi-up drain logs every line, plates the last milestone, chimes once', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = skillLevelHud();

    hud.handleSkillLevelCelebrations(
      [{ skillId: 'cooking', fromLevel: 12, toLevel: 13 }],
      [
        { skillId: 'mining', fromLevel: 24, toLevel: 25 },
        { skillId: 'herbalism', fromLevel: 49, toLevel: 50 },
      ],
      false,
    );

    expect(hud.log).toHaveBeenCalledTimes(3);
    expect(hud.log).toHaveBeenNthCalledWith(1, 'Cooking skill increased to 13!', '#ffd100');
    expect(hud.log).toHaveBeenNthCalledWith(2, 'Mining skill increased to 25!', '#ffd100');
    expect(hud.log).toHaveBeenNthCalledWith(3, 'Herbalism skill increased to 50!', '#ffd100');
    expect(hud.bannerEl.querySelector('.banner-title')?.textContent).toBe('Herbalism');
    expect(achievement).toHaveBeenCalledTimes(1);
    expect(hud.combatAnnouncer.push).toHaveBeenCalledTimes(1);
    expect(hud.combatAnnouncer.push.mock.calls[0][0]).toBe('Herbalism skill increased to 50!');
  });

  it('keeps the plate but not the chime when the drain already chimed', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = skillLevelHud();

    hud.handleSkillLevelCelebrations([], [{ skillId: 'mining', fromLevel: 24, toLevel: 25 }], true);

    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(true);
    expect(achievement).not.toHaveBeenCalled();
  });

  it('a craft-only drain logs without touching the banner or the chime', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = skillLevelHud();

    hud.handleSkillLevelCelebrations(
      [{ skillId: 'cooking', fromLevel: 24, toLevel: 25 }],
      [],
      false,
    );

    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log).toHaveBeenCalledWith('Cooking skill increased to 25!', '#ffd100');
    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(false);
    expect(hud.bannerEl.childElementCount).toBe(0);
    expect(achievement).not.toHaveBeenCalled();
    expect(hud.combatAnnouncer.push).not.toHaveBeenCalled();
  });

  it('falls back to a text-only plate when the art registry has no entry', () => {
    vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = skillLevelHud();

    // An id with no art file: professionImageUrl(gather_kelp) is null, so the
    // plate paints title + detail directly, no img and no art layout class.
    hud.handleSkillLevelCelebrations([], [{ skillId: 'kelp', fromLevel: 24, toLevel: 25 }], false);

    expect(hud.bannerEl.querySelector('img')).toBeNull();
    expect(hud.bannerEl.classList.contains('banner-with-art')).toBe(false);
    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(true);
    expect(hud.bannerEl.classList.contains('has-subtext')).toBe(true);
    expect(hud.bannerEl.querySelector('.banner-art-copy')).toBeNull();
    expect(hud.bannerEl.querySelector('.banner-subtext')?.textContent).toBe(
      'Skill increased to 25!',
    );
  });
});

interface DrainHarness {
  sim: {
    playerId: number;
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
    gatheringProficiency: Record<string, number>;
  };
  bannerEl: HTMLElement;
  bannerTimer: number | undefined;
  log: ReturnType<typeof vi.fn>;
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  prevCraftSkillLevels: Record<string, number> | null;
  prevGatheringSkillLevels: Record<string, number> | null;
  handleEvents(events: SimEvent[]): void;
}

function drainHud(synced: boolean): DrainHarness {
  const hud = Object.create(Hud.prototype) as unknown as DrainHarness;
  hud.sim = {
    playerId: 1,
    craftingIdentity: { synced },
    craftSkills: {},
    gatheringProficiency: {},
    // The concrete worlds carry far more; handleEvents with an empty drain
    // reads only this slice (the six sibling harnesses are the precedent).
  };
  hud.bannerEl = document.createElement('div');
  hud.bannerTimer = undefined;
  hud.log = vi.fn();
  hud.combatAnnouncer = { push: vi.fn() };
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  hud.prevCraftSkillLevels = null;
  hud.prevGatheringSkillLevels = null;
  return hud;
}

describe('handleEvents drain wiring (the real observation path)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(
      (query: string) => ({ matches: true, media: query }) as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('baselines silently, then celebrates a later gathering milestone crossing', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = drainHud(true);
    hud.sim.gatheringProficiency = { mining: 24.2 };

    // Drain 1: first synced observation, the whole map is history, no toast.
    hud.handleEvents([]);
    expect(hud.log).not.toHaveBeenCalled();
    expect(achievement).not.toHaveBeenCalled();

    // The mirror updates (the online path replaces the object wholesale).
    hud.sim.gatheringProficiency = { mining: 25.1 };
    hud.handleEvents([]);
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log).toHaveBeenCalledWith('Mining skill increased to 25!', '#ffd100');
    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(true);
    expect(achievement).toHaveBeenCalledTimes(1);

    // Drain 3: nothing changed, nothing fires.
    hud.handleEvents([]);
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(achievement).toHaveBeenCalledTimes(1);
  });

  it('logs fractional-free craft climbs without plating', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = drainHud(true);
    hud.sim.craftSkills = { cooking: 11.2 };

    hud.handleEvents([]);
    hud.sim.craftSkills = { cooking: 12.4 };
    hud.handleEvents([]);

    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log).toHaveBeenCalledWith('Cooking skill increased to 12!', '#ffd100');
    expect(hud.bannerEl.classList.contains('banner-skill')).toBe(false);
    expect(achievement).not.toHaveBeenCalled();
  });

  it('stays quiet on pure fractional gathering progress', () => {
    const hud = drainHud(true);
    hud.sim.gatheringProficiency = { mining: 24.1 };
    hud.handleEvents([]);
    hud.sim.gatheringProficiency = { mining: 24.9 };
    hud.handleEvents([]);
    expect(hud.log).not.toHaveBeenCalled();
  });

  it('never observes an unsynced world, and never baselines it', () => {
    const hud = drainHud(false);
    hud.sim.gatheringProficiency = { mining: 47 };
    hud.handleEvents([]);
    expect(hud.log).not.toHaveBeenCalled();
    expect(hud.prevGatheringSkillLevels).toBeNull();
    expect(hud.prevCraftSkillLevels).toBeNull();
  });

  it('tolerates a world stub without the gathering map while unsynced', () => {
    const hud = drainHud(false);
    (hud.sim as { gatheringProficiency?: Record<string, number> }).gatheringProficiency = undefined;
    expect(() => hud.handleEvents([])).not.toThrow();
    expect(hud.log).not.toHaveBeenCalled();
  });
});

describe('skill plate tokens and CSS contract', () => {
  const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hudCss = stripComments(readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8'));
  const mobileCss = stripComments(
    readFileSync(join(process.cwd(), 'src/styles/hud.mobile.css'), 'utf8'),
  );
  const tokensCss = stripComments(
    readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8'),
  );

  it('declares every token the plate consumes', () => {
    expect(tokensCss).toMatch(/--color-skill-banner-text: #f0d078;/);
    expect(tokensCss).toMatch(/--color-skill-banner-border: #c49a3c;/);
    expect(tokensCss).toMatch(/--skill-banner-bg: linear-gradient\(/);
    expect(tokensCss).toMatch(/--color-skill-banner-subtext: #e8d8a8;/);
    expect(tokensCss).toMatch(/--color-skill-banner-inset: rgb\(255 209 0 \/ 14%\);/);
  });

  it('keeps the plate rules and the variant-agnostic art+subtext layout', () => {
    expect(hudCss).toMatch(/#banner\.banner-skill\s*\{[^}]*background: var\(--skill-banner-bg\)/);
    expect(hudCss).toMatch(/#banner\.banner-with-art\.has-subtext\s*\{[^}]*flex-direction: row/);
    expect(hudCss).toMatch(
      /#banner\.banner-with-art\.has-subtext \.banner-art-copy\s*\{[^}]*flex-direction: column/,
    );
    expect(hudCss).toMatch(/#banner\.banner-skill \.banner-art\s*\{[^}]*width: 52px/);
  });

  it('scales the plate on touch chrome', () => {
    expect(mobileCss).toMatch(
      /body\.mobile-touch #banner\.banner-skill\s*\{[^}]*font-size: calc\(20px \* var\(--mobile-chrome-scale, 1\)\)/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #banner\.banner-skill \.banner-art\s*\{[^}]*width: 40px/,
    );
  });
});
