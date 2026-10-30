// Admin code-update panel. Self-injects into the upstream admin.html shell
// without forking src/admin/. Surfaces:
//   - "Update Now" button (POST /admin/api/update)
//   - Configurable maintenance-warning duration
//   - Last 200 lines of the update log (polled every 4s)
//   - "Currently in maintenance" banner when .maintenance is held
//
// Mount target: any element with id="cr-admin-update" inserted into admin.html.
// The block below is added to admin.html by this same overlay session.

const STATUS_URL = '/admin/api/update/status';
const UPDATE_URL = '/admin/api/update';
const TOKEN_KEY = 'woc_admin_token';

interface StatusPayload {
  inMaintenance: boolean;
  logPath: string;
  log: string;
  scriptExists: boolean;
  disabled: boolean;
}

function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

async function fetchStatus(): Promise<StatusPayload | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await fetch(STATUS_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const body = await r.json();
    return body?.data ?? null;
  } catch { return null; }
}

async function triggerUpdate(warnSeconds: number, branch: string): Promise<string | null> {
  const token = getToken();
  if (!token) return 'not signed in';
  try {
    const r = await fetch(UPDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ warnSeconds, branch }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      return body?.error ?? `update failed (${r.status})`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'request failed';
  }
}

function render(host: HTMLElement, s: StatusPayload | null): void {
  if (!s) {
    host.innerHTML = `
      <div class="cr-admin-panel">
        <h3>Code update</h3>
        <p class="cr-dim">Sign in as admin to use this panel.</p>
      </div>`;
    return;
  }
  if (s.disabled) {
    host.innerHTML = `
      <div class="cr-admin-panel">
        <h3>Code update</h3>
        <p class="cr-dim">Admin updates are disabled on this deploy (CR_DISABLE_ADMIN_UPDATE=1).</p>
      </div>`;
    return;
  }
  if (!s.scriptExists) {
    host.innerHTML = `
      <div class="cr-admin-panel">
        <h3>Code update</h3>
        <p class="cr-error">Update script missing on the server.</p>
      </div>`;
    return;
  }
  host.innerHTML = `
    <div class="cr-admin-panel">
      <h3>Code update</h3>
      ${s.inMaintenance ? '<p class="cr-warn">Maintenance flag held — update in progress.</p>' : ''}
      <div class="cr-admin-row">
        <label>Warning duration
          <input type="number" id="cr-warn" min="0" max="3600" value="300" /> seconds
        </label>
        <label>Branch
          <input type="text" id="cr-branch" value="master" />
        </label>
        <button id="cr-update-btn" type="button" ${s.inMaintenance ? 'disabled' : ''}>Update now</button>
      </div>
      <p class="cr-dim">Triggers <code>scripts/admin/update.sh</code> via the server — broadcasts a maintenance warning to in-game sessions, flips <code>.maintenance</code>, pulls / rebuilds, restarts the server.</p>
      <h4>Recent log (${escapeHtml(s.logPath)})</h4>
      <pre class="cr-admin-log">${escapeHtml(s.log || '(empty)')}</pre>
    </div>
  `;
}

async function tick(host: HTMLElement): Promise<void> {
  const s = await fetchStatus();
  render(host, s);
  host.querySelector('#cr-update-btn')?.addEventListener('click', async () => {
    const warnInput = host.querySelector('#cr-warn') as HTMLInputElement | null;
    const branchInput = host.querySelector('#cr-branch') as HTMLInputElement | null;
    const warnSeconds = Math.max(0, Math.min(3600, Number(warnInput?.value ?? 300)));
    const branch = (branchInput?.value ?? 'master').trim() || 'master';
    if (!confirm(`Trigger a code update on the ${branch} branch with a ${warnSeconds}s maintenance warning?`)) return;
    const err = await triggerUpdate(warnSeconds, branch);
    if (err) {
      alert(`Update failed: ${err}`);
      return;
    }
    // Optimistic refresh — the script touches .maintenance fast.
    setTimeout(() => void tick(host), 1500);
  });
}

export function mountAdminUpdatePanel(): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('cr-admin-update');
  if (!host) return;
  void tick(host);
  setInterval(() => void tick(host), 4000);
}
