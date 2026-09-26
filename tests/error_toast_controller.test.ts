// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import type { SimEvent } from '../src/sim/types';
import { ErrorToastController } from '../src/ui/error_toast_controller';
import { heldLootWarningText } from '../src/ui/held_loot_warning_view';
import { Hud } from '../src/ui/hud';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

const heldText = 'Your bags are full; [[i:greyjaw_hide_boots]] is waiting on the corpse for you.';

function rig() {
  const el = document.createElement('div');
  const bannerEl = document.createElement('div');
  const hud = Object.assign(Object.create(Hud.prototype), {
    sim: {
      playerId: 7,
      player: { name: 'LootTester' },
      craftingIdentity: { synced: false },
      craftSkills: {},
      gatheringProficiency: {},
    },
    renderer: { handleEvent: vi.fn() },
    playEventSfx: vi.fn(),
    meters: { onEvent: vi.fn() },
    isNythraxisEvent: vi.fn(() => false),
    lootRolls: { closeForItem: vi.fn() },
    errorToast: new ErrorToastController(el),
    bannerEl,
    log: vi.fn(),
    prevCraftSkills: null,
    craftTierUpDrains: 0,
  });
  return { el, bannerEl, hud, send: (events: SimEvent[]) => hud.handleEvents(events) };
}

describe('held loot error toast through the HUD', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLanguage('en');
    document.body.innerHTML = '<div id="bags" style="display:none"></div>';
    vi.spyOn(audio, 'lootItem').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLanguage('en');
  });

  it('shows the winner a readable item name for 7.5 seconds and keeps one linked chat line', () => {
    const { el, hud, send } = rig();
    send([{ type: 'loot', text: heldText, pid: 7 }]);
    expect(el.textContent).toBe(
      'Your bags are full; [Greyjaw Hide Boots] is waiting on the corpse for you.',
    );
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log.mock.calls[0][0]).toBe(heldText);
    expect(el.style.opacity).toBe('1');
    vi.advanceTimersByTime(7499);
    expect(el.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(el.style.opacity).toBe('0');
  });

  it('keeps ordinary errors at 1.6 seconds and cancels their old fade for held loot', () => {
    const { el, hud, send } = rig();
    hud.errorToast.show('Unknown dev command.');
    vi.advanceTimersByTime(1599);
    expect(el.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(el.style.opacity).toBe('0');
    hud.errorToast.show('Unknown dev command.');
    vi.advanceTimersByTime(1000);
    send([{ type: 'loot', text: heldText, pid: 7 }]);
    vi.advanceTimersByTime(7499);
    expect(el.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(el.style.opacity).toBe('0');
  });

  it('does not warn for someone else or for a normal successful roll', () => {
    const { el, hud, send } = rig();
    send([{ type: 'loot', text: heldText, pid: 8 }]);
    expect(hud.log).not.toHaveBeenCalled();
    send([{ type: 'loot', text: 'Aaa wins [[i:greyjaw_hide_boots]] (100)', pid: 7 }]);
    expect(el.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    expect(hud.lootRolls.closeForItem).toHaveBeenCalledTimes(1);
  });

  it('shows the win for five seconds and keeps the lower full-bag warning for 7.5 seconds', () => {
    const { el, bannerEl, hud, send } = rig();
    send([
      { type: 'loot', text: 'LootTester wins [[i:greyjaw_hide_boots]] (87)', pid: 7 },
      { type: 'loot', text: heldText, pid: 7 },
    ]);
    expect(bannerEl.textContent).toBe(
      'Congratulations! You won [Greyjaw Hide Boots] with a roll of 87',
    );
    expect(hud.log).toHaveBeenCalledTimes(2);
    expect(bannerEl.classList.contains('banner-loot')).toBe(true);
    expect(el.classList.contains('held-loot-warning')).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(el.style.opacity).toBe('1');
    expect(bannerEl.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(el.style.opacity).toBe('1');
    expect(bannerEl.style.opacity).toBe('0');
    vi.advanceTimersByTime(2499);
    expect(el.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(el.style.opacity).toBe('0');
    vi.advanceTimersByTime(250);
    hud.showBanner('The Proving Shore');
    expect(bannerEl.classList.contains('banner-loot')).toBe(false);
    hud.errorToast.show('Unknown dev command.');
    expect(el.classList.contains('held-loot-warning')).toBe(false);
  });

  it('congratulates a winning player even when their bags have room', () => {
    const { el, bannerEl, send } = rig();
    send([{ type: 'loot', text: 'LootTester wins [[i:greyjaw_hide_boots]] (100)', pid: 7 }]);
    expect(bannerEl.textContent).toContain('with a roll of 100');
    expect(bannerEl.style.opacity).toBe('1');
    expect(el.textContent).toBe('');
  });

  it('uses the active locale for the warning and item name', async () => {
    await ensureLocaleLoaded('de_DE');
    setLanguage('de_DE');
    const { el, send } = rig();
    send([{ type: 'loot', text: heldText, pid: 7 }]);
    expect(el.textContent).not.toContain('Your bags are full');
    expect(el.textContent).not.toContain('Greyjaw Hide Boots');
    expect(el.textContent).not.toContain('[[i:');
    expect(el.textContent).not.toBe('');
  });

  it('does not show internal ids for unknown items or promote ordinary bag errors', () => {
    expect(
      heldLootWarningText(
        'Your bags are full; [[i:missing_item]] is waiting on the corpse for you.',
      ),
    ).toBeNull();
    expect(heldLootWarningText('Your bags are full.')).toBeNull();
  });
});
