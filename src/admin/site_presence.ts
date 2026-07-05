const STORAGE_KEY = 'woc_site_visitor_id';
const HEARTBEAT_MS = 45_000;

function randomVisitorId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function visitorId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const next = randomVisitorId();
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return randomVisitorId();
  }
}

export function startSitePresence(): void {
  const id = visitorId();
  const send = () => {
    if (document.visibilityState === 'hidden') return;
    void fetch('/api/site-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: id, page: 'admin' }),
      keepalive: true,
    }).catch(() => {});
  };

  send();
  const timer = window.setInterval(send, HEARTBEAT_MS);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') send();
  });
}
