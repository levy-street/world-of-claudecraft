(() => {
  const prefix = 'woc.wallet.mobile.v1';
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get('woc_wallet_request');
  if (!requestId || !/^[A-Za-z0-9-]{1,80}$/.test(requestId)) {
    window.location.replace('/');
    return;
  }
  const pendingKey = `${prefix}.pending.${requestId}`;
  const responseKey = `${prefix}.response.${requestId}`;
  let returnUrl = '/';
  try {
    const pendingRaw = window.localStorage.getItem(pendingKey);
    if (!pendingRaw) throw new Error('wallet request is not pending');
    const pending = JSON.parse(pendingRaw);
    if (
      typeof pending.createdAt !== 'number' ||
      !Number.isFinite(pending.createdAt) ||
      Math.abs(Date.now() - pending.createdAt) > 5 * 60 * 1000 ||
      typeof pending.returnUrl !== 'string'
    ) {
      throw new Error('wallet request is invalid or expired');
    }
    const candidate = new URL(pending.returnUrl);
    if (candidate.origin !== window.location.origin) {
      throw new Error('wallet return URL is cross-origin');
    }
    returnUrl = candidate.toString();
    window.localStorage.setItem(responseKey, window.location.search);
  } catch {
    window.location.replace('/');
    return;
  }
  window.close();
  if (window.closed) return;
  window.location.replace(returnUrl);
})();
