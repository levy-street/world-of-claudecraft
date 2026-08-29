import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const windowSource = readFileSync(
  new URL('../src/ui/daily_rewards_window.ts', import.meta.url),
  'utf8',
);
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

/** Slice from the anchor to the closing brace of a top-level class member. */
function memberBody(source: string, anchor: string): string {
  const start = source.indexOf(anchor);
  expect(start, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const end = source.indexOf('\n  }', start);
  expect(end, `member end not found after: ${anchor}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

// The poll's own STATE MACHINE (the core predicate gating the fetch, the stamp
// taken before the fetch resolves, both settle arms honouring the seq guard, and
// a pushed status stamping the throttle) used to be source-pinned over a hud.ts
// method body. It moved into src/ui/daily_rewards_launcher_core.ts in Bank
// Storage phase 15 and is now EXECUTED in tests/daily_rewards_launcher_core.test.ts.
// What is left here is what only source can say: that the HUD still WIRES the
// controller into every path that has to keep the launcher fresh.
describe('Daily Rewards launcher throttle wiring', () => {
  const depsStart = hudSource.indexOf('new DailyRewardsWindow({');
  const depsBody = hudSource.slice(depsStart, hudSource.indexOf('\n  });', depsStart));
  const pollStart = hudSource.indexOf('new DailyRewardsLauncherPoll({');
  const pollBody = hudSource.slice(pollStart, hudSource.indexOf('\n  });', pollStart));
  const toggleBody = memberBody(hudSource, 'toggleDailyRewards(): void {');

  it('keeps the poll behind the extracted controller, with no inline cadence of its own', () => {
    // Catches reverting to an inline fast-poll check in the coordinator: the
    // cadence, its arithmetic and the seq guard all live in the core module.
    expect(pollStart, 'the launcher poll controller is not wired in hud.ts').toBeGreaterThan(-1);
    expect(hudSource).toContain("from './daily_rewards_launcher_core'");
    expect(hudSource).not.toContain('private refreshDailyRewardsLauncher(');
    expect(hudSource).not.toContain('this.lastDailyRewardsLauncherRefreshAt');
    expect(hudSource).not.toContain('this.dailyRewardsLauncherSeq');
    expect(hudSource).not.toContain('300_000');
  });

  it('hands the controller every dep it needs, including the mobile tray button', () => {
    // The four that a careless rewiring drops, each with a user-visible cost:
    // no feature gate (fetches for a disabled feature), no mount guard (paints
    // chrome that does not exist), no visibility sync (a stale hidden state),
    // and no mobile button in the failure clear (a stuck glow in the More tray).
    expect(pollBody).toMatch(/enabled:\s*\(\)\s*=>\s*this\.dailyRewardsEnabled\(\)/);
    // The mount gate, by its EXPRESSION rather than its presence. The pre-move
    // code guarded on either button existing, and the natural-looking
    // simplification to showDailyRewardsChestButton() would stop the poll dead
    // for a player who hid the desktop chest, leaving the mobile More-tray
    // entry's spin-ready glow stale forever. The extraction dropped this pin;
    // the core's own suite cannot restore it, because it supplies its own stub.
    expect(pollBody).toMatch(
      /mounted:\s*\(\)\s*=>\s*!!\(this\.dailyRewardsButtonEl\s*\|\|\s*this\.mobileDailyRewardsButtonEl\)/,
    );
    // SLICED to the onFailure arrow. The same token also appears in `mounted:`
    // two lines up, so a whole-body `toContain` is proximity mistaken for
    // containment: deleting the mobile clear from the failure path would leave
    // it green while a stuck glow sat in the More tray.
    const failureStart = pollBody.indexOf('onFailure:');
    expect(failureStart, 'the poll has no onFailure dep').toBeGreaterThan(-1);
    const failureBody = pollBody.slice(failureStart, pollBody.indexOf('},', failureStart));
    expect(failureBody).toContain('this.dailyRewardsButtonEl');
    expect(failureBody).toContain('this.mobileDailyRewardsButtonEl');
    expect((failureBody.match(/remove\('spin-ready'\)/g) ?? []).length).toBe(2);
    expect(pollBody).toMatch(
      /syncVisibility:\s*\(\)\s*=>\s*this\.applyDailyRewardsChestButtonVisibility\(\)/,
    );
    expect(pollBody).toMatch(/fetch:\s*\(\)\s*=>\s*this\.sim\.dailyRewards\(\)/);
  });

  it('forces a launcher refresh from the window close path', () => {
    // Catches dropping the close-path refresh: the managed dispatch and the X
    // button close without going through toggleDailyRewards, so onClose is the
    // only hook that keeps the launcher fresh on those paths. Whitespace-
    // tolerant so a formatter line wrap cannot redden it.
    expect(depsBody).toMatch(/onClose:\s*\(\)\s*=>\s*this\.dailyRewardsLauncher\.refresh\(true\)/);
  });

  it('routes a window-pushed status into the controller rather than a bare paint', () => {
    // Catches wiring onStatus straight to applyDailyRewardsLauncherStatus: the
    // paint would still happen, but the pushed status would neither stamp the
    // throttle nor invalidate an in-flight fetch, so a slower older response
    // could overwrite it. observeFresh is what does all three (executed in
    // tests/daily_rewards_launcher_core.test.ts).
    expect(depsBody).toMatch(
      /onStatus:\s*\(status\)\s*=>\s*this\.dailyRewardsLauncher\.observeFresh\(status\)/,
    );
    expect(depsBody).not.toContain('this.applyDailyRewardsLauncherStatus(status)');
  });

  it('forces the toggle refresh only in the open direction', () => {
    // Catches the double fetch on toggle-close: close() already forces a refresh
    // via onClose, so the toggle path must gate its own force to the open case.
    expect(toggleBody).toMatch(
      /if\s*\(this\.dailyRewardsWindow\.isOpen\)\s*this\.dailyRewardsLauncher\.refresh\(true\)/,
    );
  });

  it('notifies the opener once per actual window close', () => {
    // Catches removing the close hook from the window: close() must fire
    // deps.onClose and the deps interface must declare it.
    const closeBody = memberBody(windowSource, '\n  close(): void {');
    expect(closeBody).toContain('this.deps.onClose?.()');
    expect(windowSource).toContain('onClose?(): void;');
  });
});

// ---------------------------------------------------------------------------
// The store window's own slow-band wiring (Bank Storage phase 15, ruling 21).
// It lives here rather than beside the behavioural store tests because those
// run under happy-dom, where import.meta.url is not a file URL and the source
// cannot be read at all. The claim only the coordinator's source can make: the
// window's refreshIfChanged is USELESS unless hud.update() calls it, and no
// unit test drives a whole HUD frame.
// ---------------------------------------------------------------------------
describe('the store rides the slow band, and hud.ts is where that is decided', () => {
  it('calls refreshIfChanged from the slow divider, gated on the window being open', () => {
    // Anchored INSIDE the `if (slowHud)` guard: hoisted out of it the signature
    // read would run every frame instead of at 2 Hz, and without the isOpen gate
    // a CLOSED store would rebuild markup twice a second.
    const calls =
      hudSource.match(
        /if \(slowHud && this\.dailyRewardsWindow\.isOpen\) this\.dailyRewardsWindow\.refreshIfChanged\(\);/g,
      ) ?? [];
    expect(calls).toHaveLength(1);
    // In the same block as its sibling windows, not on some rarer path (a tab
    // switch, an online-only branch) that would leave the staleness in place.
    // CONTAINMENT, not proximity: an absolute character distance between the two
    // indexOf results is not the claim being made, and one unrelated window
    // joining the band between them (or one comment leaving) moves it either way.
    // The block is the run of slow-band window refreshes, bounded by two of its
    // OWN named rows rather than by a character count. Both endpoints are pinned
    // to exist, so the slice can never be empty and the containment vacuous, and
    // an unrelated window joining or a comment leaving moves neither.
    const first = hudSource.indexOf(
      'if (slowHud && this.mailboxWindow.isOpen) this.mailboxWindow.refreshIfChanged();',
    );
    const last = hudSource.indexOf(
      'if (slowHud && this.deedsWindow.isOpen) this.deedsWindow.refreshIfChanged();',
    );
    expect(first, 'the mailbox slow-band row is gone; re-anchor this pin').toBeGreaterThan(-1);
    expect(last, 'the deeds slow-band row is gone; re-anchor this pin').toBeGreaterThan(first);
    const block = hudSource.slice(first, last);
    expect(block).toContain('if (slowHud && this.bankWindow.isOpen) this.bankWindow');
    expect(block).toContain('this.dailyRewardsWindow.refreshIfChanged();');
  });

  it('adds no repeating driver of its own to the store window', () => {
    // The band is the HUD's. A timer added inside the window for this would be a
    // second cadence source and would tick while the store is shut; the two
    // intervals the window legitimately owns (its 15s status refresh and its 30s
    // countdown) are the ones budgeted in tests/hud_perf_budget.test.ts.
    expect((windowSource.match(/setInterval\(/g) ?? []).length).toBe(2);
    expect(windowSource).not.toContain('requestAnimationFrame');
  });
});
