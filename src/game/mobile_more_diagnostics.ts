export type MobileMoreStateListener = (open: boolean) => void;

export type MobileMoreObserverFactory = (
  callback: MutationCallback,
) => Pick<MutationObserver, 'observe' | 'disconnect'>;

/** Observe the body class so every More close path, including HUD-owned paths, is recorded. */
export function watchMobileMoreState(
  target: HTMLElement,
  onStateChange: MobileMoreStateListener,
  createObserver: MobileMoreObserverFactory = (callback) => new MutationObserver(callback),
): () => void {
  let previous = target.classList.contains('mobile-more-open');
  const observer = createObserver(() => {
    const open = target.classList.contains('mobile-more-open');
    if (open === previous) return;
    previous = open;
    onStateChange(open);
  });
  observer.observe(target, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
