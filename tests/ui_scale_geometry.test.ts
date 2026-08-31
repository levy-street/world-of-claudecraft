import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('live UI Scale geometry refresh', () => {
  // The three unit-frame movers are no longer named one by one in these two
  // methods: they register with the InterfaceUnlock coordinator (which also owns
  // the action bars, cast bar, menu rail, minimap and pet frame), and the
  // coordinator fans out to every entry. So the shape pinned here is the
  // DELEGATION, and the completeness half moved to two behavioural pins: the
  // registration below, and tests/interface_unlock.test.ts, which drives the real
  // coordinator and asserts every registered frame is reached. The doom meter
  // stays outside the registry and so is still named explicitly.
  it('reapplies chat, every registered frame, and the doom meter through the live Hud seam', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).toMatch(
      /reapplySavedGeometry\(\): void {\s*this\.chatGeometry\.reapply\(\);\s*this\.interfaceUnlock\.reapplyAll\(\);\s*this\.doomMeter\.reapplyPosition\(\);\s*}/,
    );
  });

  it('includes the Affliction resource block in the unit-frame reset fanout', () => {
    // The fanout grew (chat, meters, target auras, the combined-bars split),
    // so pin the delegations by containment over the method body rather than
    // an exact-body regex that reds on every legitimate addition.
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const start = hud.indexOf('resetUnitFrames(): void {');
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, hud.indexOf('\n  }\n', start));
    expect(body).toContain('this.interfaceUnlock.resetAll();');
    expect(body).toContain('this.doomMeter.resetPosition();');
  });

  it('registers all three unit-frame movers with the coordinator that drives them', () => {
    // Without this, the delegation above would still match while a unit frame
    // silently fell out of the registry and stopped following the UI Scale.
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const registration =
      /\[\s*'playerFrame',\s*this\.playerFrameMover,[\s\S]*?'targetFrame',\s*this\.targetFrameMover,[\s\S]*?'partyFrames',\s*this\.partyFrameMover,/;
    expect(hud).toMatch(registration);
    // ... and that the list is actually handed to the coordinator.
    expect(hud).toMatch(/this\.interfaceUnlock\.register\(\{\s*id,\s*mover,\s*isActive\s*\}\)/);
  });

  it('refreshes saved geometry immediately after publishing the new CSS scale', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(
      /case 'uiScale':\s*document\.documentElement\.style\.setProperty\('--ui-scale', String\(v\)\);\s*hud\.reapplySavedGeometry\(\);/,
    );
  });
});
