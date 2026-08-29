import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dismissGpuNotice,
  formatGpuNoticeSignature,
  GPU_NOTICE_COMPONENTS,
  type GpuNoticeComponent,
  gpuNoticeBodyKey,
  gpuNoticeComponents,
  gpuNoticeVerdictsEqual,
  LEGACY_DISMISSED_VALUE,
  mergeGpuNoticeVerdicts,
  parseGpuNoticeSignature,
  resolveGpuNotice,
} from '../src/ui/gpu_notice_view';

// The notice carries THREE independent components (software rendering, the
// desktop shell's inactive-dedicated-GPU verdict, and the browser-only
// hybrid-GPU-likely verdict), so every dimension gets a decisive case:
// component arming, the dismissal signature round trip, the legacy values
// shipped installs already stored ('1' on the signature key, and the separate
// v0.36.0 hybrid key surfaced as legacyHybridDismissed), the subset rule that
// decides re-nag vs re-arm, and the body-copy precedence.

const NONE = { softwareRendering: false, discreteInactive: false, hybridGpuLikely: false };
const SOFTWARE = { ...NONE, softwareRendering: true };
const DISCRETE = { ...NONE, discreteInactive: true };
const HYBRID = { ...NONE, hybridGpuLikely: true };
const SOFTWARE_AND_DISCRETE = { ...NONE, softwareRendering: true, discreteInactive: true };
const SOFTWARE_AND_HYBRID = { ...NONE, softwareRendering: true, hybridGpuLikely: true };

// resolveGpuNotice with no stored dismissals unless a case overrides them.
const FRESH = { dismissedSignature: '', legacyHybridDismissed: false };

describe('gpuNoticeComponents', () => {
  it('lists only the armed components, in signature order', () => {
    expect(gpuNoticeComponents(NONE)).toEqual([]);
    expect(gpuNoticeComponents(SOFTWARE)).toEqual(['software']);
    expect(gpuNoticeComponents(DISCRETE)).toEqual(['discrete-inactive']);
    expect(gpuNoticeComponents(HYBRID)).toEqual(['hybrid']);
    expect(gpuNoticeComponents(SOFTWARE_AND_DISCRETE)).toEqual(['discrete-inactive', 'software']);
    expect(gpuNoticeComponents(SOFTWARE_AND_HYBRID)).toEqual(['hybrid', 'software']);
  });
});

describe('mergeGpuNoticeVerdicts', () => {
  it('ORs each component so a second source can only add, never un-arm', () => {
    expect(mergeGpuNoticeVerdicts(SOFTWARE, DISCRETE)).toEqual(SOFTWARE_AND_DISCRETE);
    expect(mergeGpuNoticeVerdicts(SOFTWARE, NONE)).toEqual(SOFTWARE);
    expect(mergeGpuNoticeVerdicts(NONE, DISCRETE)).toEqual(DISCRETE);
    expect(mergeGpuNoticeVerdicts(NONE, HYBRID)).toEqual(HYBRID);
    expect(mergeGpuNoticeVerdicts(HYBRID, SOFTWARE)).toEqual(SOFTWARE_AND_HYBRID);
    expect(mergeGpuNoticeVerdicts(NONE, NONE)).toEqual(NONE);
  });
});

describe('gpuNoticeVerdictsEqual', () => {
  it('is true only when EVERY component matches (one negative per dimension)', () => {
    expect(gpuNoticeVerdictsEqual(SOFTWARE_AND_DISCRETE, { ...SOFTWARE_AND_DISCRETE })).toBe(true);
    expect(gpuNoticeVerdictsEqual(NONE, { ...NONE })).toBe(true);
    expect(gpuNoticeVerdictsEqual(SOFTWARE, SOFTWARE_AND_DISCRETE)).toBe(false);
    expect(gpuNoticeVerdictsEqual(DISCRETE, SOFTWARE_AND_DISCRETE)).toBe(false);
    expect(gpuNoticeVerdictsEqual(SOFTWARE, DISCRETE)).toBe(false);
    expect(gpuNoticeVerdictsEqual(HYBRID, NONE)).toBe(false);
    expect(gpuNoticeVerdictsEqual(SOFTWARE, SOFTWARE_AND_HYBRID)).toBe(false);
  });
});

describe('gpu notice dismissal signature', () => {
  it('formats a sorted, order-proof value', () => {
    const reversed: GpuNoticeComponent[] = ['software', 'hybrid', 'discrete-inactive'];
    expect(formatGpuNoticeSignature(reversed)).toBe('discrete-inactive,hybrid,software');
    expect(formatGpuNoticeSignature(['software'])).toBe('software');
    expect(formatGpuNoticeSignature(['hybrid'])).toBe('hybrid');
    expect(formatGpuNoticeSignature([])).toBe('');
  });

  it('parses its own values back, and drops unknown parts', () => {
    expect(parseGpuNoticeSignature('discrete-inactive,software')).toEqual([
      'discrete-inactive',
      'software',
    ]);
    expect(parseGpuNoticeSignature('discrete-inactive,hybrid,software')).toEqual([
      'discrete-inactive',
      'hybrid',
      'software',
    ]);
    expect(parseGpuNoticeSignature('hybrid')).toEqual(['hybrid']);
    expect(parseGpuNoticeSignature('software')).toEqual(['software']);
    expect(parseGpuNoticeSignature('')).toEqual([]);
    expect(parseGpuNoticeSignature('bogus,software')).toEqual(['software']);
  });

  it('treats an oversized stored value as junk (no dismissal) without splitting it', () => {
    // The bound is the guard; a value past it must parse as "nothing dismissed"
    // (the notice shows), the same verdict as any other unparseable junk.
    const oversized = `software,${'x'.repeat(80)}`;
    expect(oversized.length).toBeGreaterThan(64);
    expect(parseGpuNoticeSignature(oversized)).toEqual([]);
    expect(resolveGpuNotice({ ...SOFTWARE, ...FRESH, dismissedSignature: oversized }).shown).toBe(
      true,
    );
  });

  it('parses the legacy shipped value as a software dismissal', () => {
    // Installs that dismissed the notice before the shell verdict existed
    // stored '1'; that must keep meaning "software rendering, already read".
    expect(LEGACY_DISMISSED_VALUE).toBe('1');
    expect(parseGpuNoticeSignature(LEGACY_DISMISSED_VALUE)).toEqual(['software']);
  });
});

describe('resolveGpuNotice', () => {
  it('shows for any single component on a first, undismissed session', () => {
    expect(resolveGpuNotice({ ...SOFTWARE, ...FRESH })).toEqual({
      shown: true,
      dismissed: false,
      components: ['software'],
    });
    expect(resolveGpuNotice({ ...DISCRETE, ...FRESH })).toEqual({
      shown: true,
      dismissed: false,
      components: ['discrete-inactive'],
    });
    expect(resolveGpuNotice({ ...HYBRID, ...FRESH })).toEqual({
      shown: true,
      dismissed: false,
      components: ['hybrid'],
    });
  });

  it('never shows when no component is armed', () => {
    expect(resolveGpuNotice({ ...NONE, ...FRESH })).toEqual({
      shown: false,
      dismissed: false,
      components: [],
    });
  });

  it('stays hidden on relaunch for the exact verdict that was dismissed', () => {
    expect(resolveGpuNotice({ ...SOFTWARE, ...FRESH, dismissedSignature: 'software' })).toEqual({
      shown: false,
      dismissed: true,
      components: ['software'],
    });
    expect(resolveGpuNotice({ ...HYBRID, ...FRESH, dismissedSignature: 'hybrid' }).shown).toBe(
      false,
    );
    expect(
      resolveGpuNotice({
        ...SOFTWARE_AND_DISCRETE,
        ...FRESH,
        dismissedSignature: 'discrete-inactive,software',
      }).shown,
    ).toBe(false);
  });

  it('re-arms when the verdict grows a component the dismissal does not cover', () => {
    const state = resolveGpuNotice({
      ...SOFTWARE_AND_DISCRETE,
      ...FRESH,
      dismissedSignature: 'software',
    });
    expect(state.shown).toBe(true);
    expect(state.dismissed).toBe(false);
    expect(state.components).toEqual(['discrete-inactive', 'software']);
  });

  it('honors the legacy value for software but not for the other components', () => {
    // The load-bearing set: an upgrading install that dismissed the old notice
    // is not re-nagged about software rendering, yet the inactive-dedicated-GPU
    // and hybrid verdicts were never dismissed and must show.
    expect(
      resolveGpuNotice({ ...SOFTWARE, ...FRESH, dismissedSignature: LEGACY_DISMISSED_VALUE }).shown,
    ).toBe(false);
    expect(
      resolveGpuNotice({ ...DISCRETE, ...FRESH, dismissedSignature: LEGACY_DISMISSED_VALUE }).shown,
    ).toBe(true);
    expect(
      resolveGpuNotice({ ...HYBRID, ...FRESH, dismissedSignature: LEGACY_DISMISSED_VALUE }).shown,
    ).toBe(true);
  });

  it('honors the v0.36.0 per-variant hybrid key for hybrid but nothing else', () => {
    // Upstream stored a dismissed hybrid notice under its own key; the flag
    // covers exactly the hybrid component and never suppresses the others.
    expect(
      resolveGpuNotice({ ...HYBRID, dismissedSignature: '', legacyHybridDismissed: true }).shown,
    ).toBe(false);
    expect(
      resolveGpuNotice({ ...SOFTWARE, dismissedSignature: '', legacyHybridDismissed: true }).shown,
    ).toBe(true);
    expect(
      resolveGpuNotice({ ...DISCRETE, dismissedSignature: '', legacyHybridDismissed: true }).shown,
    ).toBe(true);
  });

  it('a hybrid dismissal never suppresses a later software trigger, and vice versa', () => {
    expect(
      resolveGpuNotice({ ...SOFTWARE, dismissedSignature: '', legacyHybridDismissed: true }).shown,
    ).toBe(true);
    expect(resolveGpuNotice({ ...HYBRID, ...FRESH, dismissedSignature: 'software' }).shown).toBe(
      true,
    );
    expect(
      resolveGpuNotice({ ...HYBRID, ...FRESH, dismissedSignature: LEGACY_DISMISSED_VALUE }).shown,
    ).toBe(true);
  });

  it('stays hidden when the verdict shrinks back to a subset of the dismissal', () => {
    const state = resolveGpuNotice({
      ...SOFTWARE,
      ...FRESH,
      dismissedSignature: 'discrete-inactive,software',
    });
    expect(state.shown).toBe(false);
    expect(state.dismissed).toBe(true);
  });

  it('ignores a stored value it cannot parse rather than treating it as dismissed', () => {
    expect(resolveGpuNotice({ ...SOFTWARE, ...FRESH, dismissedSignature: 'bogus' }).shown).toBe(
      true,
    );
  });
});

describe('dismissGpuNotice', () => {
  it('hides the notice, remembers the dismissal, and keeps the dismissed components', () => {
    const state = resolveGpuNotice({ ...SOFTWARE_AND_DISCRETE, ...FRESH });
    expect(dismissGpuNotice(state)).toEqual({
      shown: false,
      dismissed: true,
      components: ['discrete-inactive', 'software'],
    });
  });
});

describe('gpuNoticeBodyKey', () => {
  it('picks the desktop copy inside the Electron shell and the browser copy on the web', () => {
    // Inside the desktop shell "enable hardware acceleration in your browser" is
    // actively wrong advice (there is no such setting), so the split is load-bearing.
    expect(
      gpuNoticeBodyKey({ desktopShell: true, desktopPlatform: 'other', verdict: SOFTWARE }),
    ).toBe('gpuNotice.bodyDesktop');
    expect(
      gpuNoticeBodyKey({ desktopShell: false, desktopPlatform: 'other', verdict: SOFTWARE }),
    ).toBe('gpuNotice.bodyWeb');
  });

  it('uses the one desktop-only key for an inactive dedicated GPU', () => {
    expect(
      gpuNoticeBodyKey({ desktopShell: true, desktopPlatform: 'other', verdict: DISCRETE }),
    ).toBe('gpuNotice.bodyDiscreteInactive');
    expect(
      gpuNoticeBodyKey({ desktopShell: false, desktopPlatform: 'other', verdict: DISCRETE }),
    ).toBe('gpuNotice.bodyDiscreteInactive');
  });

  it('picks per-OS copy for the hybrid verdict, generic for anything else', () => {
    expect(gpuNoticeBodyKey({ desktopShell: false, desktopPlatform: 'win', verdict: HYBRID })).toBe(
      'gpuNotice.hybridBodyWindows',
    );
    expect(
      gpuNoticeBodyKey({ desktopShell: false, desktopPlatform: 'linux', verdict: HYBRID }),
    ).toBe('gpuNotice.hybridBodyLinux');
    expect(gpuNoticeBodyKey({ desktopShell: false, desktopPlatform: 'mac', verdict: HYBRID })).toBe(
      'gpuNotice.hybridBodyOther',
    );
    expect(
      gpuNoticeBodyKey({ desktopShell: false, desktopPlatform: 'other', verdict: HYBRID }),
    ).toBe('gpuNotice.hybridBodyOther');
  });

  it('lets the more severe software verdict win over either sibling component', () => {
    expect(
      gpuNoticeBodyKey({
        desktopShell: true,
        desktopPlatform: 'other',
        verdict: SOFTWARE_AND_DISCRETE,
      }),
    ).toBe('gpuNotice.bodyDesktop');
    expect(
      gpuNoticeBodyKey({
        desktopShell: false,
        desktopPlatform: 'win',
        verdict: SOFTWARE_AND_HYBRID,
      }),
    ).toBe('gpuNotice.bodyWeb');
  });
});

describe('the capture helper suppresses every component, not just software', () => {
  it('seeds the full sorted component signature (scripts/lib/gpu_notice_suppress.mjs)', () => {
    // The helper is plain .mjs and cannot import this module, so its literal is
    // pinned here: a new component makes the helper's value incomplete, the
    // notice re-arms on every headless capture, and it lands in the frames.
    const helper = readFileSync('scripts/lib/gpu_notice_suppress.mjs', 'utf8');
    const full = formatGpuNoticeSignature([...GPU_NOTICE_COMPONENTS]);
    expect(helper, 'the capture helper must seed the full component signature').toContain(
      `'${full}'`,
    );
    // And that value really does cover every component.
    expect(parseGpuNoticeSignature(full).sort()).toEqual([...GPU_NOTICE_COMPONENTS].sort());
  });
});
