// The Hud-side prewarm composition (preview_prewarm_wiring.ts): the plan
// scheduling itself is preview_prewarm_core.test.ts's job; this suite pins the
// WIRING, that the stateless halves (the class roster, the real per-class skin
// counts, the async portrait prewarm) are composed in, and that every
// Hud-supplied thunk is routed verbatim.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters/portrait', () => ({
  prewarmPlayerPortrait: vi.fn(),
}));

import { skinCount } from '../src/render/characters/manifest';
import { prewarmPlayerPortrait } from '../src/render/characters/portrait';
import { GFX, gfxInternalsForTest } from '../src/render/gfx';
import { ALL_CLASSES } from '../src/sim/types';
import { buildHudPreviewPrewarmUnits } from '../src/ui/preview_prewarm_wiring';

type Calls = {
  shell: number;
  skins: number[];
  poses: string[];
};

type PlanFlags = {
  warmCharSkins?: boolean;
  includeCardPoses?: boolean;
  portraitFramings?: readonly ('headshot' | 'body')[];
};

// The wiring suite exercises the FULL plan by default (both framings, skins and
// poses on) so the routing pins stay decisive; the login-trim flags are pinned
// separately below as pure pass-throughs.
function makeDeps(
  includeCharFamily: boolean,
  playerClass: 'warrior' | 'paladin' = 'warrior',
  flags: PlanFlags = {},
) {
  const calls: Calls = { shell: 0, skins: [], poses: [] };
  const units = buildHudPreviewPrewarmUnits<string>({
    playerClass,
    cardPoses: ['poseA', 'poseB'],
    includeCharFamily,
    warmCharSkins: flags.warmCharSkins ?? true,
    includeCardPoses: flags.includeCardPoses ?? true,
    portraitFramings: flags.portraitFramings ?? ['headshot', 'body'],
    renderCharShell: () => {
      calls.shell++;
    },
    prewarmCharSkin: (skin) => {
      calls.skins.push(skin);
    },
    prewarmCardPose: (pose) => {
      calls.poses.push(pose);
    },
  });
  return { calls, units };
}

describe('buildHudPreviewPrewarmUnits', () => {
  beforeEach(() => {
    vi.mocked(prewarmPlayerPortrait).mockClear();
  });

  it('composes the real class roster and skin counts into the portrait units', () => {
    const { units } = makeDeps(true);
    const portraitUnits = units.filter((u) => u.label.startsWith('preview:portrait:'));
    let expected = 0;
    for (const cls of ALL_CLASSES) expected += skinCount(`player_${cls}`) * 2;
    expect(expected).toBeGreaterThan(0);
    expect(portraitUnits.length).toBe(expected);
    for (const u of portraitUnits) u.run();
    expect(vi.mocked(prewarmPlayerPortrait).mock.calls.length).toBe(expected);
    // The wiring routes portrait units at the module level (no Hud state): the
    // first warrior headshot goes straight to prewarmPlayerPortrait, and the
    // roster covers every class, never only the deps-supplied one (a
    // hardcoded playerClass inside the wiring would fail the mage arm).
    expect(vi.mocked(prewarmPlayerPortrait).mock.calls).toContainEqual(['warrior', 0, 'headshot']);
    expect(vi.mocked(prewarmPlayerPortrait).mock.calls).toContainEqual(['warrior', 0, 'body']);
    expect(vi.mocked(prewarmPlayerPortrait).mock.calls).toContainEqual(['mage', 0, 'headshot']);
  });

  it('routes every Hud thunk verbatim and forwards includeCharFamily', () => {
    const { calls, units } = makeDeps(true);
    for (const u of units) u.run();
    expect(calls.shell).toBe(1);
    expect(calls.skins).toEqual(
      Array.from({ length: skinCount('player_warrior') }, (_, index) => index),
    );
    expect(calls.poses).toEqual(['poseA', 'poseB']);
    // NEGATIVE pin, mirroring the core suite: the armory catalog warming was
    // removed upstream (about 2.1 to 2.6 s of live-frame hitches every online
    // session paid for a window only some players open), so the composed plan
    // must never carry an armory unit, and the wiring surface must offer no
    // armory dep a restored loop could ride back in on.
    expect(units.some((u) => u.label.startsWith('preview:armory'))).toBe(false);
    expect(units.every((u) => u.family === 'char')).toBe(true);
  });

  it('forwards the deps playerClass into the char-skin count, never a hardcoded class', () => {
    const { calls, units } = makeDeps(true, 'paladin');
    for (const u of units) u.run();
    // Guard the arm's own premise: the two classes must differ in skin count
    // for this to be decisive.
    expect(skinCount('player_paladin')).not.toBe(skinCount('player_warrior'));
    expect(calls.skins).toEqual(
      Array.from({ length: skinCount('player_paladin') }, (_, index) => index),
    );
  });

  it('forwards the login-trim flags verbatim (skins, poses, framings)', () => {
    const { calls, units } = makeDeps(true, 'warrior', {
      warmCharSkins: false,
      includeCardPoses: false,
      portraitFramings: ['headshot'],
    });
    for (const u of units) u.run();
    // The shell still builds (includeCharFamily), but no skin or pose unit rides
    // it, and only the headshot framing reaches the portrait prewarm.
    expect(calls.shell).toBe(1);
    expect(calls.skins).toEqual([]);
    expect(calls.poses).toEqual([]);
    const framings = new Set(vi.mocked(prewarmPlayerPortrait).mock.calls.map((c) => c[2]));
    expect([...framings]).toEqual(['headshot']);
    let expected = 0;
    for (const cls of ALL_CLASSES) expected += skinCount(`player_${cls}`);
    expect(vi.mocked(prewarmPlayerPortrait).mock.calls.length).toBe(expected);
  });

  it('excludes the char-family units when includeCharFamily is false', () => {
    const { calls, units } = makeDeps(false);
    for (const u of units) u.run();
    expect(calls.shell).toBe(0);
    expect(calls.skins).toEqual([]);
    expect(calls.poses).toEqual([]);
    // The portrait units still warm (canvas-2D only, no shell dependence).
    expect(units.some((u) => u.label.startsWith('preview:portrait:'))).toBe(true);
    expect(units.every((u) => u.label.startsWith('preview:portrait:'))).toBe(true);
  });
});

describe('buildHudPreviewPrewarmUnits on the iOS memory profile', () => {
  let restoreGfx: (() => void) | null = null;
  const withGfx = (overrides: Parameters<typeof gfxInternalsForTest.overrideSettings>[0]) => {
    restoreGfx?.();
    restoreGfx = gfxInternalsForTest.overrideSettings(overrides);
  };
  // The login flags hud.ts passes for a composed look (see its
  // postEntryPreviewPrewarmUnits): shell, no skins, no poses, headshots.
  const loginPortraitLabels = (): string[] =>
    makeDeps(true, 'warrior', {
      warmCharSkins: false,
      includeCardPoses: false,
      portraitFramings: ['headshot'],
    })
      .units.map((u) => u.label)
      .filter((label) => label.startsWith('preview:portrait:'));
  const everyClassSkinHeadshot = (): string[] =>
    ALL_CLASSES.flatMap((cls) =>
      Array.from(
        { length: skinCount(`player_${cls}`) },
        (_, skin) => `preview:portrait:${cls}:${skin}:headshot`,
      ),
    );

  beforeEach(() => {
    vi.mocked(prewarmPlayerPortrait).mockClear();
  });
  afterEach(() => {
    restoreGfx?.();
    restoreGfx = null;
  });

  it('warms one default-skin headshot per class and no alternate skin', () => {
    // Premise: the real roster has alternate skins to drop.
    expect(ALL_CLASSES.some((cls) => skinCount(`player_${cls}`) > 1)).toBe(true);
    withGfx({ iosMemoryProfile: true, tightMemory: false });
    const { units } = makeDeps(true, 'warrior', {
      warmCharSkins: false,
      includeCardPoses: false,
      portraitFramings: ['headshot'],
    });
    const portraitUnits = units.filter((u) => u.label.startsWith('preview:portrait:'));
    expect(portraitUnits.map((u) => u.label)).toEqual(
      ALL_CLASSES.map((cls) => `preview:portrait:${cls}:0:headshot`),
    );
    for (const u of portraitUnits) u.run();
    expect(vi.mocked(prewarmPlayerPortrait).mock.calls).toEqual(
      ALL_CLASSES.map((cls) => [cls, 0, 'headshot']),
    );
  });

  it('keeps every (class, skin) headshot on desktop and on constrained Android', () => {
    // Node resolves the desktop profile.
    expect(GFX.iosMemoryProfile).toBe(false);
    const desktop = loginPortraitLabels();
    expect(desktop).toEqual(everyClassSkinHeadshot());
    expect(desktop).toContain('preview:portrait:warrior:5:headshot');
    // A phone-class Android browser is constrained but not the iOS profile.
    withGfx({ constrainedMemory: true, iosMemoryProfile: false, tightMemory: false });
    expect(loginPortraitLabels()).toEqual(desktop);
  });

  it('reads the profile each time the plan is built, not once at module load', () => {
    withGfx({ iosMemoryProfile: true, tightMemory: false });
    expect(loginPortraitLabels()).toEqual(
      ALL_CLASSES.map((cls) => `preview:portrait:${cls}:0:headshot`),
    );
    restoreGfx?.();
    restoreGfx = null;
    expect(loginPortraitLabels()).toEqual(everyClassSkinHeadshot());
  });
});
