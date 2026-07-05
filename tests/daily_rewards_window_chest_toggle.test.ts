// Regression for a reported bug: clicking the Daily Rewards panel's "Hide Chest"
// button immediately hid the HUD chest launcher and persisted it (localStorage),
// with no confirmation and no obvious way back short of clearing site data. The
// button sits right below the task list with identical styling to routine
// buttons, so it was easy to trigger by accident while browsing the panel.
// Hiding must go through a confirm dialog; un-hiding stays immediate (not
// destructive/hard to reverse).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/daily_rewards_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('daily_rewards_window: chest-visibility toggle confirms before hiding', () => {
  it('gates the hide path through deps.confirmDialog, not an immediate hide', () => {
    const toggleHandler = code.slice(code.indexOf("'[data-chest-toggle]'"));
    const confirmIdx = toggleHandler.indexOf('this.deps.confirmDialog?.(');
    const hideCallIdx = toggleHandler.indexOf('this.deps.setShowChestButton?.(false)');
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(hideCallIdx).toBeGreaterThan(-1);
    // The hide call must be nested inside the confirmDialog's onOk callback,
    // i.e. textually after the confirmDialog call opens.
    expect(hideCallIdx).toBeGreaterThan(confirmIdx);
  });

  it('does not require confirmation to re-show the chest button', () => {
    const toggleHandler = code.slice(code.indexOf("'[data-chest-toggle]'"));
    const showCallIdx = toggleHandler.indexOf('this.deps.setShowChestButton?.(true)');
    const confirmIdx = toggleHandler.indexOf('this.deps.confirmDialog?.(');
    expect(showCallIdx).toBeGreaterThan(-1);
    // The un-hide call sits after the early `return` of the hide branch, so it
    // is reached directly, without going through confirmDialog first.
    expect(showCallIdx).toBeGreaterThan(confirmIdx);
    expect(toggleHandler.slice(confirmIdx, showCallIdx)).toContain('return;');
  });

  it('declares confirmDialog as an injected dep, matching the questlog/talents pattern', () => {
    expect(code).toContain('confirmDialog?(');
  });

  it('hud.ts wires the shared confirmDialog into the daily rewards window', () => {
    const wiring = hud.slice(hud.indexOf('new DailyRewardsWindow({'));
    expect(wiring.slice(0, wiring.indexOf('});'))).toContain(
      'confirmDialog: (title, body, okText, cancelText, onOk) =>',
    );
  });
});
