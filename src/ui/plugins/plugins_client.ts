// Plugin store REST client (the economy_sdk shape: token getter + same-origin
// apiUrl, no throw-into-render). Reads resolve to typed fallbacks so the store
// window renders an empty state when logged out or unreachable; MUTATIONS
// throw PluginsApiError carrying the stable problem+json `code`, which the
// window localizes through userFacingApiError (src/ui/api_error_i18n.ts).

import { apiUrl } from '../../client_origin';

export type PluginCategoryWire = 'combat' | 'economy' | 'social' | 'interface' | 'tools';
export type PluginStatusWire = 'pending' | 'listed' | 'delisted';
export type PluginVersionStatusWire = 'pending' | 'approved' | 'rejected';

export interface CatalogRowWire {
  id: number;
  slug: string;
  name: string;
  summary: string;
  category: PluginCategoryWire;
  author: string | null;
  version: number;
  installs: number;
  updatedAt: string;
}

export interface PluginDetailWire extends CatalogRowWire {
  description: string;
  source: string;
}

export interface InstalledRowWire {
  id: number;
  slug: string;
  name: string;
  summary: string;
  category: PluginCategoryWire;
  version: number;
  enabled: boolean;
  source: string;
  updatedAt: string;
}

export interface MineRowWire {
  id: number;
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: PluginCategoryWire;
  author: string | null;
  status: PluginStatusWire;
  liveVersion: number | null;
  latest: {
    version: number;
    status: PluginVersionStatusWire;
    reviewNote: string;
    submittedAt: string;
  } | null;
  updatedAt: string;
}

export interface PluginSubmission {
  name: string;
  summary: string;
  description: string;
  category: PluginCategoryWire;
  source: string;
  notes: string;
  author?: string;
}

/** A failed store call: `code` is the stable server code when one was sent. */
export class PluginsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    // Dev-channel text only; the window localizes from `code`.
    super(code ?? `plugins request failed (${status})`);
    this.name = 'PluginsApiError';
  }
}

export interface PluginsClientConfig {
  token(): string | null;
  base?: string;
}

async function errorFrom(res: Response): Promise<PluginsApiError> {
  let code: string | null = null;
  try {
    const body = (await res.json()) as { code?: unknown };
    if (typeof body.code === 'string') code = body.code;
  } catch {
    // A non-JSON error body (proxy page) keeps code null.
  }
  return new PluginsApiError(res.status, code);
}

export class PluginsClient {
  constructor(private readonly cfg: PluginsClientConfig) {}

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = this.cfg.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private async get<T>(path: string, fallback: T, auth: boolean): Promise<T> {
    if (auth && !this.cfg.token()) return fallback;
    try {
      const res = await fetch(apiUrl(path, this.cfg.base ?? ''), {
        headers: this.headers(false),
      });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }

  /** A mutation: throws PluginsApiError on any non-2xx or transport failure. */
  private async send<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(apiUrl(path, this.cfg.base ?? ''), {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Transport failure: userFacingApiError shows the connection-lost line.
      throw err instanceof Error ? err : new Error('network failure');
    }
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as T;
  }

  async catalog(): Promise<CatalogRowWire[]> {
    return (await this.get<{ rows: CatalogRowWire[] }>('/api/plugins', { rows: [] }, false)).rows;
  }

  async detail(id: number): Promise<PluginDetailWire | null> {
    const res = await this.get<{ plugin: PluginDetailWire } | null>(
      `/api/plugins/${id}`,
      null,
      false,
    );
    return res?.plugin ?? null;
  }

  async installed(): Promise<InstalledRowWire[]> {
    return (
      await this.get<{ rows: InstalledRowWire[] }>('/api/plugins/installed', { rows: [] }, true)
    ).rows;
  }

  async mine(): Promise<MineRowWire[]> {
    return (await this.get<{ rows: MineRowWire[] }>('/api/plugins/mine', { rows: [] }, true)).rows;
  }

  create(submission: PluginSubmission): Promise<{ plugin: { id: number; slug: string } }> {
    return this.send('POST', '/api/plugins', submission);
  }

  submitVersion(
    id: number,
    submission: Omit<PluginSubmission, 'author'>,
  ): Promise<{ version: { version: number; status: string } }> {
    return this.send('POST', `/api/plugins/${id}/versions`, submission);
  }

  install(id: number, enabled = true): Promise<{ ok: boolean; enabled: boolean }> {
    return this.send('POST', `/api/plugins/${id}/install`, { enabled });
  }

  uninstall(id: number): Promise<{ ok: boolean }> {
    return this.send('DELETE', `/api/plugins/${id}/install`);
  }

  remove(id: number): Promise<{ ok: boolean }> {
    return this.send('DELETE', `/api/plugins/${id}`);
  }
}
