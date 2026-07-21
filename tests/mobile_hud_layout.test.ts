import { describe, expect, it } from 'vitest';
import {
  COMPACT_MAX_HEIGHT_PX,
  COMPACT_MAX_WIDTH_PX,
  type MobileHudLayoutInput,
  resolveMobileHudLayout,
  TABLET_MIN_DIMENSION_PX,
  TABLET_MIN_WIDTH_PX,
} from '../src/ui/mobile_hud_layout';

function input(overrides: Partial<MobileHudLayoutInput> = {}): MobileHudLayoutInput {
  return {
    width: 1280,
    height: 720,
    safeAreaTop: 0,
    safeAreaRight: 0,
    safeAreaBottom: 0,
    safeAreaLeft: 0,
    touchMode: true,
    menuOpen: false,
    chatOpen: false,
    ...overrides,
  };
}

describe('resolveMobileHudLayout: the six target viewports', () => {
  it('1280x720 resolves to standard (below the tablet height floor, well above compact)', () => {
    const layout = resolveMobileHudLayout(input({ width: 1280, height: 720 }));
    expect(layout.tier).toBe('standard');
    expect(layout.classes).toEqual(['hud-mobile-standard']);
  });

  it('1920x1080 resolves to tablet (both dimensions clear the tablet floors)', () => {
    const layout = resolveMobileHudLayout(input({ width: 1920, height: 1080 }));
    expect(layout.tier).toBe('tablet');
    expect(layout.classes).toEqual(['hud-mobile-tablet']);
  });

  it('844x390 (notched iPhone landscape, with insets) resolves to compact', () => {
    const layout = resolveMobileHudLayout(
      input({ width: 844, height: 390, safeAreaLeft: 47, safeAreaRight: 47 }),
    );
    expect(layout.tier).toBe('compact');
    expect(layout.classes).toEqual(['hud-mobile-compact']);
    expect(layout.cssVars['--mobile-hud-safe-left']).toBe('47px');
    expect(layout.cssVars['--mobile-hud-safe-right']).toBe('47px');
  });

  it('915x412 (Android landscape) resolves to compact', () => {
    const layout = resolveMobileHudLayout(input({ width: 915, height: 412 }));
    expect(layout.tier).toBe('compact');
  });

  it('932x430 (Pro-Max-class phone landscape) resolves to compact, not standard', () => {
    // The whole hand-held phone class is compact: a 430px-tall landscape phone
    // is held exactly like a 390px one and has the same top-strip/bottom-arc
    // vertical squeeze, so the compact height floor (480) covers it.
    const layout = resolveMobileHudLayout(input({ width: 932, height: 430 }));
    expect(layout.tier).toBe('compact');
  });

  it('1024x768 (tablet landscape) resolves to tablet', () => {
    const layout = resolveMobileHudLayout(input({ width: 1024, height: 768 }));
    expect(layout.tier).toBe('tablet');
  });

  it('390x844 (portrait phone) resolves to compact (narrow width; portrait media blocks still apply in CSS)', () => {
    const layout = resolveMobileHudLayout(input({ width: 390, height: 844 }));
    expect(layout.tier).toBe('compact');
  });
});

describe('resolveMobileHudLayout: menu/chat state classes', () => {
  it('adds hud-menu-open iff menuOpen', () => {
    expect(resolveMobileHudLayout(input({ menuOpen: true })).classes).toContain('hud-menu-open');
    expect(resolveMobileHudLayout(input({ menuOpen: false })).classes).not.toContain(
      'hud-menu-open',
    );
  });

  it('adds hud-chat-open iff chatOpen', () => {
    expect(resolveMobileHudLayout(input({ chatOpen: true })).classes).toContain('hud-chat-open');
    expect(resolveMobileHudLayout(input({ chatOpen: false })).classes).not.toContain(
      'hud-chat-open',
    );
  });

  it('can carry both state classes alongside the tier class', () => {
    const layout = resolveMobileHudLayout(input({ menuOpen: true, chatOpen: true }));
    expect(layout.classes).toEqual(
      expect.arrayContaining(['hud-mobile-standard', 'hud-menu-open', 'hud-chat-open']),
    );
    expect(layout.classes).toHaveLength(3);
  });
});

describe('resolveMobileHudLayout: desktop (touchMode false)', () => {
  it('yields an empty classes list regardless of viewport or menu/chat state', () => {
    const layout = resolveMobileHudLayout(
      input({ touchMode: false, width: 390, height: 390, menuOpen: true, chatOpen: true }),
    );
    expect(layout.classes).toEqual([]);
    expect(layout.cssVars).toEqual({});
  });
});

describe('resolveMobileHudLayout: determinism', () => {
  it('returns a deeply equal result for the same input called twice', () => {
    const a = resolveMobileHudLayout(input({ width: 844, height: 390, menuOpen: true }));
    const b = resolveMobileHudLayout(input({ width: 844, height: 390, menuOpen: true }));
    expect(a).toEqual(b);
  });
});

describe('resolveMobileHudLayout: threshold boundaries', () => {
  it('pins the threshold literals (a silent constant drift re-tiers real devices)', () => {
    expect(COMPACT_MAX_HEIGHT_PX).toBe(480);
    expect(COMPACT_MAX_WIDTH_PX).toBe(700);
    expect(TABLET_MIN_DIMENSION_PX).toBe(768);
    expect(TABLET_MIN_WIDTH_PX).toBe(1000);
  });

  it('COMPACT_MAX_HEIGHT_PX: at or below is compact, one above is not (by height alone)', () => {
    const wide = 1500; // clear of COMPACT_MAX_WIDTH_PX
    expect(resolveMobileHudLayout(input({ width: wide, height: COMPACT_MAX_HEIGHT_PX })).tier).toBe(
      'compact',
    );
    expect(
      resolveMobileHudLayout(input({ width: wide, height: COMPACT_MAX_HEIGHT_PX + 1 })).tier,
    ).not.toBe('compact');
  });

  it('COMPACT_MAX_WIDTH_PX: at or below is compact, one above is not (by width alone)', () => {
    const tall = 1500; // clear of COMPACT_MAX_HEIGHT_PX
    expect(resolveMobileHudLayout(input({ width: COMPACT_MAX_WIDTH_PX, height: tall })).tier).toBe(
      'compact',
    );
    expect(
      resolveMobileHudLayout(input({ width: COMPACT_MAX_WIDTH_PX + 1, height: tall })).tier,
    ).not.toBe('compact');
  });

  it('TABLET_MIN_DIMENSION_PX / TABLET_MIN_WIDTH_PX: both must clear for tablet', () => {
    // Exactly at both floors: tablet.
    expect(
      resolveMobileHudLayout(input({ width: TABLET_MIN_WIDTH_PX, height: TABLET_MIN_DIMENSION_PX }))
        .tier,
    ).toBe('tablet');
    // One pixel short on height (the min dimension): not tablet.
    expect(
      resolveMobileHudLayout(
        input({ width: TABLET_MIN_WIDTH_PX, height: TABLET_MIN_DIMENSION_PX - 1 }),
      ).tier,
    ).not.toBe('tablet');
    // One pixel short on width: not tablet.
    expect(
      resolveMobileHudLayout(
        input({ width: TABLET_MIN_WIDTH_PX - 1, height: TABLET_MIN_DIMENSION_PX }),
      ).tier,
    ).not.toBe('tablet');
  });
});
