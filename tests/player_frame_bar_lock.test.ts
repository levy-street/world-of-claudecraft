// lockPlayerFrameToActionBar (the Frames Settings menu): the player frame
// glues to the TOP of the action bars. The mechanics live in three places
// that must stay wired together, so these pin each half at the source level
// (a manual verification script for the live behavior exists at
// scripts/_probe_player_frame_lock.mjs; nothing runs it automatically, it
// must be run by hand against a dev server):
// the frame re-docks into the stack seat and rides INSIDE the combined group
// whenever the group carries a custom position (following drags, bar 2/3
// adds and removes, and resolution re-anchors for free), the unlock
// registration refuses to loosen a locked frame, and the corner move button
// folds away.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOL_SETTINGS } from '../src/game/settings';

// Strip block comments and line comments before pinning, so a pin can never
// be satisfied by commented-out code. Block comments go first (a non-greedy
// match, replaced by a space so token boundaries survive); a line comment is
// stripped only when its slashes follow start-of-line or whitespace, which
// leaves string literals containing '//' (URLs like 'https://...') intact.
// Pragmatic by design: good enough for these source-level pins.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const hudTs = stripComments(readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'));
const hudCss = stripComments(
  readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
);
const mainTs = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
const menuCore = stripComments(
  readFileSync(new URL('../src/ui/interface_unlock_menu_core.ts', import.meta.url), 'utf8'),
);

describe('lockPlayerFrameToActionBar wiring', () => {
  it('is a real bool setting, off by default, applied through main.ts', () => {
    expect(BOOL_SETTINGS.lockPlayerFrameToActionBar).toEqual({ def: false });
    expect(mainTs).toContain("case 'lockPlayerFrameToActionBar':");
    expect(mainTs).toContain('hud.setLockPlayerFrameToActionBar(!!v)');
  });

  it('the unlock registration refuses to loosen a locked frame', () => {
    expect(hudTs).toContain(
      "['playerFrame', this.playerFrameMover, () => !this.playerFrameLockedToBar]",
    );
  });

  it('every combined-group position apply re-evaluates the ride', () => {
    // The group's onPositioned wraps the detacher with the lock re-check, so
    // a drag move, a re-dock, and a resolution re-anchor all carry the frame.
    const start = hudTs.indexOf("spec.id === 'actionBarGroup'\n          ? (active: boolean) =>");
    expect(start).toBeGreaterThan(-1);
    const wrap = hudTs.slice(start, start + 300);
    expect(wrap).toContain('detach(active);');
    expect(wrap).toContain('this.applyPlayerFrameBarLock();');
  });

  it('turning the lock on drops the applied spot (save kept); off restores it', () => {
    const start = hudTs.indexOf('setLockPlayerFrameToActionBar(on: boolean)');
    expect(start).toBeGreaterThan(-1);
    const body = hudTs.slice(start, hudTs.indexOf('\n  }', start));
    expect(body).toContain('this.playerFrameMover?.clearAppliedGeometry()');
    expect(body).toContain('this.playerFrameMover?.restoreSavedPosition()');
    expect(body).toContain('this.interfaceUnlock.refresh()');
  });

  it('riding hops keep bar 1 pixel-fixed via the bottom re-anchor', () => {
    const start = hudTs.indexOf('private applyPlayerFrameBarLock()');
    expect(start).toBeGreaterThan(-1);
    const body = hudTs.slice(start, hudTs.indexOf('\n  }', start));
    expect(body).toContain("group.classList.contains('hud-frame-detached')");
    expect(body).toContain('group.insertBefore(frame, group.firstChild)');
    // Both directions of the hop re-anchor, or the bars jump under the cursor.
    expect(body.match(/reanchorBottom\('actionBarGroup'\)/g)).toHaveLength(2);
  });

  it('the corner move button folds away while locked', () => {
    const start = hudCss.indexOf('body.pf-locked-to-bar #player-frame > .tf-move-btn');
    expect(start).toBeGreaterThan(-1);
    expect(hudCss.slice(start, hudCss.indexOf('}', start))).toContain('display: none');
  });

  it('the Frames Settings dropdown lists the toggle', () => {
    // The toggle table moved out of hud.ts to the pure menu core (the
    // review-round extraction); the row is pinned where it lives now.
    expect(menuCore).toContain(
      "['lockPlayerFrameToActionBar', 'hudChrome.interfaceUnlock.lockPlayerFrameToBar']",
    );
  });
});
