// @vitest-environment happy-dom

// Paint pins for the faction standing tier celebration: the English copy the
// plate, subtext and chat line resolve to, the deed-class banner contract,
// the announce line, and the chime dedupe, all through a recorded host.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import type { CelebrationHost } from '../src/ui/hud/professions/skill_level_toast_painter';
import { paintFactionTierCelebrations } from '../src/ui/hud/reputation/faction_tier_celebration_painter';
import { HUD_LOG } from '../src/ui/hud_tones';

function recordedHost(reducedMotion = false) {
  const calls: { log: [string, string][]; banners: unknown[][]; announced: string[] } = {
    log: [],
    banners: [],
    announced: [],
  };
  const host: CelebrationHost = {
    log: (text, color) => calls.log.push([text, color]),
    showCelebrationBanner: (...args) => calls.banners.push(args),
    announce: (text) => calls.announced.push(text),
    reducedMotion: () => reducedMotion,
  };
  return { host, calls };
}

describe('paintFactionTierCelebrations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a gold line per crossing, plates the last one with its faction title, and chimes once', () => {
    const chime = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const { host, calls } = recordedHost();
    paintFactionTierCelebrations(
      host,
      [
        { factionId: 'rift_watch', fromTier: 'recognized', toTier: 'trusted' },
        { factionId: 'automatons', fromTier: 'proven', toTier: 'vanguard' },
      ],
      false,
    );
    expect(calls.log).toEqual([
      [
        'You are now Trusted with the Rift Watch. Your faction title is now Riftwalker.',
        HUD_LOG.NOTICE,
      ],
      [
        'You are now Vanguard with the Automatons. Your faction title is now Forgemaster.',
        HUD_LOG.NOTICE,
      ],
    ]);
    expect(calls.banners).toEqual([
      [
        'Now Vanguard with the Automatons',
        'deed',
        'deed',
        true,
        undefined,
        'Faction title: Forgemaster',
      ],
    ]);
    expect(calls.announced).toEqual([
      'You are now Vanguard with the Automatons. Your faction title is now Forgemaster.',
    ]);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('stands the chime down when the drain already chimed and drops motion under reduced motion', () => {
    const chime = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const { host, calls } = recordedHost(true);
    paintFactionTierCelebrations(
      host,
      [{ factionId: 'church_order', fromTier: 'vanguard', toTier: 'champion' }],
      true,
    );
    expect(calls.banners[0]?.[3]).toBe(false);
    expect(calls.banners[0]?.[0]).toBe('Now Champion with the Church Order');
    expect(chime).not.toHaveBeenCalled();
  });
});
