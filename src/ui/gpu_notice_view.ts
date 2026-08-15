// Pure view-core for the GPU notice (DOM-free, Node-tested in
// tests/gpu_notice_view.test.ts). The thin DOM consumer is
// src/ui/gpu_notice_toast.ts; the verdict comes from the shared adapter-name
// detector plus the failIfMajorPerformanceCaveat probe
// (src/render/software_renderer.ts), assembled by
// src/game/software_render_notice.ts, merged with the desktop shell's own GPU
// verdict when one arrives (src/game/desktop_gpu_status.ts).
//
// Three independent components can arm the notice:
// - 'software': the session runs on a software rasterizer (WARP/SwiftShader/
//   llvmpipe). The most severe condition; owns the body copy when it is active.
// - 'discrete-inactive': the shell detected that a dedicated GPU exists but the
//   session is on the power-saving one; a desktop-shell-only verdict.
// - 'hybrid': the session runs on an integrated GPU on a machine that likely
//   also has a discrete one (issue #2119), resolved at boot from the adapter
//   name by src/game/hybrid_gpu_detect.ts; a browser-only verdict (the shell
//   already forces the discrete adapter, so the detector excludes it).
// 'discrete-inactive' and 'hybrid' can therefore never co-occur; either can
// co-occur with 'software' only via a shell push ('hybrid' cannot, a software
// rasterizer is never classified as an integrated GPU family).
//
// The notice is cosmetic-only and gameplay-neutral: it hides nothing and delays
// nothing a player acts on; it only EXPLAINS why a session runs at a slideshow
// frame rate and says what to do about it. It never re-nags for a verdict the
// player already dismissed, but a verdict that grows a NEW component re-arms it
// (the same shape as the perf nudge's keyed dismissal, perf_nudge_view.ts).

export type GpuNoticeComponent = 'discrete-inactive' | 'hybrid' | 'software';

/** Every component id, in the sorted order a signature stores them in. */
export const GPU_NOTICE_COMPONENTS = ['discrete-inactive', 'hybrid', 'software'] as const;

/** The value shipped installs stored before signatures existed: a software dismissal. */
export const LEGACY_DISMISSED_VALUE = '1';

export interface GpuNoticeVerdict {
  softwareRendering: boolean;
  discreteInactive: boolean;
  hybridGpuLikely: boolean;
}

export interface GpuNoticeState {
  shown: boolean;
  dismissed: boolean;
  /** The components active right now, sorted; empty means nothing to show. */
  components: GpuNoticeComponent[];
}

/**
 * Best-effort desktop-OS family for per-OS hybrid guidance. Mirrors
 * src/game/desktop_download.ts's DesktopPlatform union structurally (this
 * module cannot import from src/game/, see src/CLAUDE.md dependency
 * direction); the caller (src/game/software_render_notice.ts) computes it
 * with that module's detectDesktopPlatform and passes the value in.
 */
export type DesktopPlatform = 'mac' | 'win' | 'linux' | 'other';

export type GpuNoticeBodyKey =
  | 'gpuNotice.bodyDesktop'
  | 'gpuNotice.bodyWeb'
  | 'gpuNotice.bodyDiscreteInactive'
  | 'gpuNotice.hybridBodyWindows'
  | 'gpuNotice.hybridBodyLinux'
  | 'gpuNotice.hybridBodyOther';

/** The active components of a verdict, built in sorted (signature) order. */
export function gpuNoticeComponents(verdict: GpuNoticeVerdict): GpuNoticeComponent[] {
  const components: GpuNoticeComponent[] = [];
  if (verdict.discreteInactive) components.push('discrete-inactive');
  if (verdict.hybridGpuLikely) components.push('hybrid');
  if (verdict.softwareRendering) components.push('software');
  return components;
}

/** OR-merge two verdicts: a component stays armed once any source reports it. */
export function mergeGpuNoticeVerdicts(a: GpuNoticeVerdict, b: GpuNoticeVerdict): GpuNoticeVerdict {
  return {
    softwareRendering: a.softwareRendering || b.softwareRendering,
    discreteInactive: a.discreteInactive || b.discreteInactive,
    hybridGpuLikely: a.hybridGpuLikely || b.hybridGpuLikely,
  };
}

/** Component-wise equality, so the toast can skip no-change re-resolves. */
export function gpuNoticeVerdictsEqual(a: GpuNoticeVerdict, b: GpuNoticeVerdict): boolean {
  return (
    a.softwareRendering === b.softwareRendering &&
    a.discreteInactive === b.discreteInactive &&
    a.hybridGpuLikely === b.hybridGpuLikely
  );
}

/**
 * The persisted-dismissal VALUE for a component set: sorted and comma-joined,
 * so the stored signature can be compared against a later verdict. Sorting
 * makes it order-proof; a verdict that adds a component produces a value the
 * stored one does not cover, which re-arms the notice.
 */
export function formatGpuNoticeSignature(components: readonly GpuNoticeComponent[]): string {
  return [...components].sort().join(',');
}

/**
 * Read a stored signature back into components. The legacy value '1' (what
 * every install shipped before the shell verdict existed) parses as a
 * software-rendering dismissal, so upgrading players are not re-nagged by
 * something they already closed. Unknown parts are dropped.
 */
export function parseGpuNoticeSignature(stored: string): GpuNoticeComponent[] {
  // Bound the parse: a legitimate signature is at most the full component set
  // (33 chars today). A longer value is hand-edited junk; treat it like any
  // other junk (no dismissal at all, the notice shows) without splitting a
  // possibly huge string first.
  if (stored.length > 64) return [];
  if (stored === LEGACY_DISMISSED_VALUE) return ['software'];
  const known = new Set<string>(GPU_NOTICE_COMPONENTS);
  return stored
    .split(',')
    .filter((part): part is GpuNoticeComponent => known.has(part))
    .sort();
}

/**
 * Resolve the state: show when at least one component is armed and the stored
 * dismissal does NOT already cover every armed component. A verdict that
 * shrinks back to a subset of what was dismissed stays hidden.
 * legacyHybridDismissed folds in the separate per-variant key that v0.36.0
 * installs stored for a dismissed hybrid notice (woc_gpu_notice_hybrid_dismissed,
 * before the two notice families merged into one signature), so upgrading
 * players who already closed it are not re-nagged.
 */
export function resolveGpuNotice(input: {
  softwareRendering: boolean;
  discreteInactive: boolean;
  hybridGpuLikely: boolean;
  dismissedSignature: string;
  legacyHybridDismissed: boolean;
}): GpuNoticeState {
  const components = gpuNoticeComponents(input);
  const dismissedComponents = parseGpuNoticeSignature(input.dismissedSignature);
  if (input.legacyHybridDismissed && !dismissedComponents.includes('hybrid')) {
    dismissedComponents.push('hybrid');
  }
  const covered =
    components.length > 0 && components.every((part) => dismissedComponents.includes(part));
  return { shown: components.length > 0 && !covered, dismissed: covered, components };
}

/** The player closed the notice: hide it now and remember the dismissal. */
export function dismissGpuNotice(state: GpuNoticeState): GpuNoticeState {
  return { shown: false, dismissed: true, components: state.components };
}

/**
 * Body-copy key selection. Software rendering is the most severe verdict and
 * wins whenever it is active. Inside the desktop (Electron) shell there is no
 * "browser setting" to enable, so the browser-centric advice would be actively
 * wrong; point at GPU drivers and the Windows per-app graphics setting
 * instead. The inactive-discrete-GPU verdict only exists inside the shell, so
 * it has one key and no web variant. The hybrid verdict never fires inside the
 * shell (hybridGpuLikely already excludes it), so its split is purely by OS,
 * since the fix is a different OS-level or browser-level control on Windows vs
 * Linux; anything else (mac, unknown) gets generic guidance that still names
 * the desktop app.
 */
export function gpuNoticeBodyKey(input: {
  desktopShell: boolean;
  desktopPlatform: DesktopPlatform;
  verdict: GpuNoticeVerdict;
}): GpuNoticeBodyKey {
  if (input.verdict.softwareRendering) {
    return input.desktopShell ? 'gpuNotice.bodyDesktop' : 'gpuNotice.bodyWeb';
  }
  if (input.verdict.discreteInactive) return 'gpuNotice.bodyDiscreteInactive';
  if (input.desktopPlatform === 'win') return 'gpuNotice.hybridBodyWindows';
  if (input.desktopPlatform === 'linux') return 'gpuNotice.hybridBodyLinux';
  return 'gpuNotice.hybridBodyOther';
}
