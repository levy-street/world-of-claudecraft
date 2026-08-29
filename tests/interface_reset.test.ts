// Hud.resetUnitFrames is the "put the interface back the way the base game
// ships" button (the options window's Reset Frame Positions row). Its whole job
// is a fan-out, and a surface silently dropped from it is exactly the reported
// bug: reset put the frames back but left the chat box, the meter panels, the
// target-aura panel or the combined action bars where they were. Pinned with
// the same AST walk hud_update_drive uses, because the fan-out lives on a
// method of the giant coordinator, where a grep for `chatGeometry.reset(`
// cannot tell THIS caller from the chat tab's own reset row.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readMethodCallSites } from './helpers/method_call_sites';
import { stripComments } from './helpers/strip_comments';

const HUD_PATH = fileURLToPath(new URL('../src/ui/hud.ts', import.meta.url));
const hudSource = readFileSync(HUD_PATH, 'utf8');
// The AST walk ignores comments by construction; the raw-text pins below read
// the stripped copy so commented-out code can never satisfy one.
const hudCode = stripComments(hudSource);
const scan = readMethodCallSites(HUD_PATH, hudSource, 'Hud', 'resetUnitFrames');
const callees = scan.sites.map((s) => s.call);

describe('Hud.resetUnitFrames restores the stock interface layout', () => {
  it('fans out to every surface that persists layout state of its own', () => {
    // The registered movers (unit frames, action bars + combined group, cast
    // bar, menu, minimap, pet, stance bar, XP bar, aura group) ...
    expect(callees).toContain('this.interfaceUnlock.resetAll');
    // ... plus the four panels that keep their own geometry outside the
    // registry. Each is a real persisted box a player can strand somewhere.
    expect(callees).toContain('this.doomMeter.resetPosition');
    expect(callees).toContain('this.chatGeometry.reset');
    expect(callees).toContain('this.meters.resetFrames');
    expect(callees).toContain('this.targetAurasWindow.resetFrame');
  });

  it('splits combined action bars back apart, through the settings seam', () => {
    // Routed through optionsHooks.onSettingChange so the Interface checkbox,
    // the persisted setting and the body class all stay in sync (the same path
    // the checkbox itself takes), and gated on the flag so an already-split
    // layout writes nothing.
    const site = scan.sites.find((s) => s.call === 'this.optionsHooks.onSettingChange');
    expect(site, 'reset no longer splits combined action bars').toBeTruthy();
    expect(site?.conditions.join(' && ')).toContain('this.combineActionBars');
    // The call walk records the callee and its guard but not the ARGUMENTS, so
    // pin them too: reset flipping a different setting, or flipping this one
    // ON, would otherwise keep the suite green.
    expect(hudCode).toContain("this.optionsHooks?.onSettingChange('combineActionBars', false)");
  });
});

describe('the Interface panel Reset to Defaults restores the layout too', () => {
  it('scopes the footer to the active tab and restores the layout from Frames', () => {
    // The pressed button lives in options_window.ts, and its layout half is a
    // call INSIDE the footer's resetAction closure, which the method-call walk
    // above deliberately does not descend into (a call in a callback is the
    // callback's, not the method's). A scoped source pin holds the wiring
    // instead: the footer resets only the ACTIVE tab's slice (owner request:
    // per-menu reset scope), and the Frames tab's reset still restores the
    // stock layout, or "Reset to Defaults" there goes back to resetting only
    // setting values while the frames stay strewn about.
    const OPTIONS_PATH = fileURLToPath(new URL('../src/ui/options_window.ts', import.meta.url));
    const source = stripComments(readFileSync(OPTIONS_PATH, 'utf8'));
    const start = source.indexOf('private renderInterface(');
    expect(start, 'renderInterface() was renamed or moved; re-point this pin').toBeGreaterThan(-1);
    const end = source.indexOf('private chatTimestampRows(', start);
    // Without this guard a moved end anchor silently widens the slice to the
    // rest of the file, and the containment pins below lose their scoping.
    expect(end, 'chatTimestampRows() was renamed or moved; re-point this pin').toBeGreaterThan(
      start,
    );
    const body = source.slice(start, end);
    expect(body).toContain('this.settingsViewFooter(interfaceControlsForTab(controls, tab)');
    expect(body).toContain(`if (tab === 'frames') this.deps.resetUnitFrames()`);
  });
});
