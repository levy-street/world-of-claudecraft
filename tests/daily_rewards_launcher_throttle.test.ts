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

describe('Daily Rewards launcher throttle wiring', () => {
  const launcherBody = memberBody(hudSource, 'private refreshDailyRewardsLauncher(');
  const depsStart = hudSource.indexOf('new DailyRewardsWindow({');
  const depsBody = hudSource.slice(depsStart, hudSource.indexOf('\n  });', depsStart));
  const toggleBody = memberBody(hudSource, 'toggleDailyRewards(): void {');

  it('gates the closed-window poll through the pure core, not an inline literal', () => {
    // Catches reverting to an inline fast-poll check: the cadence and its
    // arithmetic live in daily_rewards_launcher_core.ts (tested behaviorally
    // in tests/daily_rewards_launcher_core.test.ts) and hud must consume it
    // anchored to the stamp field.
    expect(launcherBody).toMatch(
      /shouldRefreshDailyRewardsLauncher\(\s*force,\s*now,\s*this\.lastDailyRewardsLauncherRefreshAt,?\s*\)/,
    );
    expect(launcherBody).not.toContain('60_000');
    expect(launcherBody).not.toContain('300_000');
    expect(hudSource).toContain("from './daily_rewards_launcher_core'");
    // The launcher-side stamp is what makes the closed-idle poll actually
    // slow: without it the core predicate compares against a stamp only
    // onStatus refreshes, and an idle-closed client fetches every slowHud
    // tick, silently reverting the whole cadence win.
    expect(launcherBody).toContain('this.lastDailyRewardsLauncherRefreshAt = now');
    // The CONSUME side of the seq guard: both settle arms must drop a
    // response from a superseded fetch, or a slower in-flight launcher fetch
    // overwrites (then-arm) or glow-clears (catch-arm) a fresher
    // window-pushed status.
    const seqGuards =
      launcherBody.match(/if \(seq !== this\.dailyRewardsLauncherSeq\) return;/g) ?? [];
    expect(seqGuards).toHaveLength(2);
  });

  it('forces a launcher refresh from the window close path', () => {
    // Catches dropping the close-path refresh: the managed dispatch and the X
    // button close without going through toggleDailyRewards, so onClose is the
    // only hook that keeps the launcher fresh on those paths. Whitespace-
    // tolerant so a formatter line wrap cannot redden it.
    expect(depsBody).toMatch(/onClose:\s*\(\)\s*=>\s*this\.refreshDailyRewardsLauncher\(true\)/);
  });

  it('bumps the fetch seq and stamps the throttle when the window pushes a status', () => {
    // Catches losing the stamp or the seq bump (or applying before either): a
    // status delivered by the window's render or spin must suppress the next
    // slowHud re-fetch AND invalidate any in-flight launcher fetch so a
    // slower older response cannot overwrite the fresher pushed one.
    const seqAt = depsBody.indexOf('this.dailyRewardsLauncherSeq++');
    const stampAt = depsBody.indexOf('this.lastDailyRewardsLauncherRefreshAt = performance.now()');
    const applyAt = depsBody.indexOf('this.applyDailyRewardsLauncherStatus(status)');
    expect(seqAt).toBeGreaterThan(-1);
    expect(stampAt).toBeGreaterThan(seqAt);
    expect(applyAt).toBeGreaterThan(stampAt);
  });

  it('forces the toggle refresh only in the open direction', () => {
    // Catches the double fetch on toggle-close: close() already forces a refresh
    // via onClose, so the toggle path must gate its own force to the open case.
    expect(toggleBody).toMatch(
      /if\s*\(this\.dailyRewardsWindow\.isOpen\)\s*this\.refreshDailyRewardsLauncher\(true\)/,
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
