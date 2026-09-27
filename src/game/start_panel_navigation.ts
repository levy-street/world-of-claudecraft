/** Own transitions between login, recovery, realm, and character panels. */
export function createStartPanelNavigation() {
  const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
  let activeTransitionTimeout: number | null = null;
  let activeTransitionCleanup: (() => void) | null = null;
  return (el: string, onVisible: () => void): void => {
    const toPanel = $(el);
    if (!toPanel) return;
    const panels = [
      '#mode-select',
      '#login-panel',
      '#forgot-panel',
      '#reset-panel',
      '#discord-choice-panel',
      '#realm-panel',
      '#charselect-panel',
      '#charcreate-panel',
      '#offline-select',
    ];
    document.body.dataset.startPanel = el.slice(1);

    // Clear active transition
    if (activeTransitionTimeout !== null) {
      window.clearTimeout(activeTransitionTimeout);
      activeTransitionTimeout = null;
    }
    if (activeTransitionCleanup) {
      activeTransitionCleanup();
      activeTransitionCleanup = null;
    }

    // Find currently visible panel. Not every entry carries every panel: play.html omits
    // #discord-choice-panel (the chooser is an index.html-only flow), so resolve each id
    // defensively and skip a missing one rather than dereferencing null.
    const currentActiveId = panels.find((id) => {
      const panel = document.querySelector(id);
      return panel !== null && !panel.hasAttribute('hidden');
    });

    if (!currentActiveId || currentActiveId === el) {
      // Show instantly on initial load or same panel
      for (const id of panels) {
        document.querySelector(id)?.toggleAttribute('hidden', id !== el);
      }
      onVisible();
      return;
    }

    const fromPanel = $(currentActiveId);
    if (!fromPanel) return;

    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isReducedMotion) {
      fromPanel.toggleAttribute('hidden', true);
      toPanel.toggleAttribute('hidden', false);
      onVisible();
      return;
    }

    // Fade out using CSS classes
    fromPanel.classList.add('panel-transition', 'panel-fade-out');

    const cleanupFrom = () => {
      fromPanel.toggleAttribute('hidden', true);
      fromPanel.classList.remove('panel-transition', 'panel-fade-out');
    };

    activeTransitionCleanup = cleanupFrom;

    activeTransitionTimeout = window.setTimeout(() => {
      cleanupFrom();
      activeTransitionCleanup = null;
      activeTransitionTimeout = null;

      // Set initial state for fade-in
      toPanel.classList.add('panel-transition', 'panel-fade-in-start');
      toPanel.toggleAttribute('hidden', false);
      onVisible();

      // Force layout reflow
      void toPanel.offsetHeight;

      // Trigger fade-in
      toPanel.classList.remove('panel-fade-in-start');
      toPanel.classList.add('panel-fade-in');

      const cleanupTo = () => {
        toPanel.classList.remove('panel-transition', 'panel-fade-in');
      };

      activeTransitionCleanup = cleanupTo;

      activeTransitionTimeout = window.setTimeout(() => {
        cleanupTo();
        activeTransitionCleanup = null;
        activeTransitionTimeout = null;
      }, 150);
    }, 150);
  };
}
