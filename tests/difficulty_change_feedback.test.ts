// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import type { SimEvent } from '../src/sim/types';
import { ErrorToastController } from '../src/ui/error_toast_controller';
import { Hud } from '../src/ui/hud';
import * as i18n from '../src/ui/i18n';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

const queued =
  'Difficulty change queued because someone or their corpse is still inside. It will apply when the instances are clear.';
const cancelled = 'Queued difficulty change cancelled because the party or leader changed.';

function rig() {
  const toast = document.createElement('div');
  const hud = Object.assign(Object.create(Hud.prototype), {
    sim: {
      playerId: 7,
      dungeonInfo: { raidLockouts: [] },
      craftingIdentity: { synced: false },
      craftSkills: {},
      gatheringProficiency: {},
    },
    renderer: { handleEvent: vi.fn() },
    playEventSfx: vi.fn(),
    meters: { onEvent: vi.fn() },
    isNythraxisEvent: vi.fn(() => false),
    bankWindow: { observeStorageText: (text: string) => text },
    errorTextDeps: { raidLockouts: () => [] },
    plantSheetWindow: { notifyErrorToast: vi.fn() },
    perfectingWindow: { notifyErrorToast: vi.fn() },
    errorToast: new ErrorToastController(toast),
    log: vi.fn(),
    prevCraftSkills: null,
    craftTierUpDrains: 0,
  });
  return {
    toast,
    hud,
    send: (text: string, pid = 7) =>
      hud.handleEvents([{ type: 'error', text, pid }] satisfies SimEvent[]),
  };
}

describe('difficulty change feedback reaches the screen and chat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLanguage('en');
    vi.spyOn(audio, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLanguage('en');
  });

  it.each([
    'You cannot reset instances while someone is still inside.',
    'You cannot reset instances while loot remains inside.',
    'Instances can only be reset once every 5 minutes.',
    'You are locked to Heroic Nythraxis Raid Arena.',
    queued,
    cancelled,
  ])('shows and retains the reason: %s', (text) => {
    const { toast, hud, send } = rig();
    send(text);
    const localized = localizeSimText(text) ?? text;
    expect(toast.textContent).toBe(localized);
    expect(toast.style.opacity).toBe('1');
    expect(hud.log).toHaveBeenCalledWith(localized, expect.any(String), undefined, 'system', false);
    vi.advanceTimersByTime(1600);
    expect(toast.style.opacity).toBe('0');
    expect(hud.log).toHaveBeenCalledTimes(1);
  });

  it('resolves queue and cancellation messages through their translation keys', () => {
    vi.spyOn(i18n, 't').mockImplementation((key) => `Translated ${key}`);
    for (const [text, key] of [
      [queued, 'hudChrome.dungeonDifficulty.queuedOccupied'],
      [cancelled, 'hudChrome.dungeonDifficulty.queuedCancelled'],
    ]) {
      const { toast, hud, send } = rig();
      send(text);
      expect(toast.textContent).toBe(localizeSimText(text));
      expect(toast.textContent).toBe(`Translated ${key}`);
      expect(hud.log.mock.calls[0][0]).toBe(toast.textContent);
    }
  });

  it("does not show another player's failure", () => {
    const { toast, hud, send } = rig();
    send(queued, 8);
    expect(toast.textContent).toBe('');
    expect(hud.log).not.toHaveBeenCalled();
  });
});
