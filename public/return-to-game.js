(() => {
  const returnLink = document.querySelector('[data-return-to-game]');
  if (!(returnLink instanceof HTMLAnchorElement)) return;

  returnLink.addEventListener('click', (event) => {
    let referrer;
    try {
      referrer = document.referrer ? new URL(document.referrer) : null;
    } catch {
      referrer = null;
    }

    if (referrer?.origin !== window.location.origin || window.history.length <= 1) return;

    event.preventDefault();
    window.history.back();
  });
})();