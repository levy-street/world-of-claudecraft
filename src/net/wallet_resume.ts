export function installWalletResumeHandlers(refresh: () => void): () => void {
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') refresh();
  };
  const onFocus = (): void => refresh();
  const onPageShow = (): void => refresh();

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onPageShow);
  };
}
