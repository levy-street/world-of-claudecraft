/** Own the public-page transition independently of game and account state. */
export function createWebsiteViewNavigation(onPlayPanel: (panel: string) => void) {
  const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
  let pendingTransition: number | null = null;
  return (targetId: string): void => {
    const toView = $(targetId);
    if (!toView) return;
    if (pendingTransition !== null) {
      window.clearTimeout(pendingTransition);
      pendingTransition = null;
    }
    const views = [
      '#hero-view',
      '#highscores-view',
      '#news-view',
      '#download-view',
      '#account-view',
    ];
    const currentViewId = views.find((id) => {
      const el = $(id);
      return el && !el.hasAttribute('hidden');
    });

    const navMap: Record<string, string> = {
      '#hero-view': 'nav-btn-play',
      '#highscores-view': 'nav-btn-highscores',
      '#news-view': 'nav-btn-news',
      '#download-view': 'nav-btn-download',
      '#account-view': 'nav-btn-account',
    };

    const activeNavId = navMap[targetId];
    document.querySelectorAll('.nav-link').forEach((link) => {
      const isActive = link.id === activeNavId;
      link.classList.toggle('active', isActive);
      link.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    const fromView = currentViewId ? $(currentViewId) : null;

    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const performSwitch = () => {
      views.forEach((id) => {
        const el = $(id);
        if (el) {
          const isTarget = id === targetId;
          el.style.removeProperty('opacity');
          el.style.removeProperty('transform');
          el.toggleAttribute('hidden', !isTarget);
          el.setAttribute('aria-hidden', isTarget ? 'false' : 'true');
        }
      });

      // The key-art backdrop is for the Play page only; hide it on other views.
      const onPlayPage = targetId === '#hero-view';
      const backdrop = document.getElementById('start-screen-backdrop');
      if (backdrop) backdrop.classList.toggle('trailer-off', !onPlayPage);

      if (targetId === '#hero-view') {
        const activePlayPanel = ['#charselect-panel', '#charcreate-panel', '#offline-select'].find(
          (id) => {
            const el = $(id);
            return el && !el.hasAttribute('hidden');
          },
        );
        if (activePlayPanel) {
          onPlayPanel(activePlayPanel);
        }
      }
    };

    if (isReducedMotion || !fromView || currentViewId === targetId) {
      performSwitch();
      return;
    }

    // Visual cross-fade and slide
    fromView.style.opacity = '0';
    fromView.style.transform = 'translateY(-8px)';

    const handleTransitionEnd = () => {
      performSwitch();

      toView.style.opacity = '0';
      toView.style.transform = 'translateY(8px)';

      void toView.offsetHeight; // force reflow

      toView.style.opacity = '1';
      toView.style.transform = 'translateY(0)';
    };

    pendingTransition = window.setTimeout(() => {
      pendingTransition = null;
      handleTransitionEnd();
    }, 150);
  };
}
