// The Welcome Screen's character-stage mounter: re-parents the LIVE char-select
// CharacterPreview canvas (already showing the exact selected character, real
// equipment online / starter kit offline) into the desktop stage host for the
// welcome screen's lifetime. No render imports: the preview is injected
// STRUCTURALLY so this module stays host-agnostic and Node-testable; teardown
// is owned by the existing releaseStartScreenPreview path in main.ts (Continue
// leads to enterLoadingState, which destroys the preview and its canvas).
//
// Fail-soft contract: any of (gate false: mobile/coarse pointer or narrow
// viewport, no live preview: WebGL init failed or assets still warming, or a
// throwing preview) returns null and leaves the stage host empty, which the
// CSS reads via :empty to re-center the greeting. No throw may escape.

export interface WelcomeStagePreview {
  setContainer(el: HTMLElement): void;
  syncSize(): void;
}

export interface WelcomeStageHandle {
  release(): void;
}

export function mountWelcomeStage(
  container: HTMLElement,
  preview: () => WelcomeStagePreview | null,
  isDesktopStage: () => boolean,
): WelcomeStageHandle | null {
  try {
    if (!isDesktopStage()) return null;
    const p = preview();
    if (!p) return null;
    p.setContainer(container);
    // Mirror main.ts syncPreviewAfterPanelLayout: size now, then again across
    // two frames so the canvas tracks the stage box once the grid has laid out.
    p.syncSize();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => p.syncSize());
    });
    // Teardown is the preview's own destroy on world entry; release is kept
    // for symmetry and any future back-navigation flow.
    return { release: () => {} };
  } catch {
    return null;
  }
}
