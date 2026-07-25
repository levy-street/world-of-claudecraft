// Postgres-backed PluginsDb plus the plugin store schema. The schema is
// appended to the main ensureSchema() run in db.ts (idempotent CREATE/ALTER
// only, applied at every boot under the advisory lock). All SQL for the
// plugin store lives here; the rules live in plugins.ts.

import type { Pool } from 'pg';
import { decodeScreenFlags } from './plugin_screen';
import type {
  CatalogRow,
  InstalledRow,
  MineRow,
  PendingReviewRow,
  PluginCategory,
  PluginMeta,
  PluginRecord,
  PluginStatus,
  PluginsDb,
  PluginVersionRecord,
  PluginVersionStatus,
} from './plugins';

// Retention: every table here is bounded by construction, so none registers a
// nightly prune. plugins is capped per account (MAX_PLUGINS_PER_ACCOUNT,
// enforced in insertPluginCapped's FOR UPDATE + count transaction);
// plugin_versions is pruned at submit time down to PLUGIN_VERSIONS_KEPT rows
// per plugin (upsertPendingVersion, which never drops the live approved
// version); plugin_installs is keyed (account_id, plugin_id) and capped per
// account (MAX_INSTALLS_PER_ACCOUNT).
export const PLUGINS_SCHEMA = `
CREATE TABLE IF NOT EXISTS plugins (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  author_handle TEXT,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'tools',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plugins_account ON plugins(account_id);
-- Serves the public catalog (status filter + newest-update-first cap).
CREATE INDEX IF NOT EXISTS plugins_status_updated ON plugins(status, updated_at DESC);
CREATE TABLE IF NOT EXISTS plugin_versions (
  id SERIAL PRIMARY KEY,
  plugin_id INT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  version INT NOT NULL,
  source TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  screen JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by INT REFERENCES accounts(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (plugin_id, version)
);
-- Serves the admin review queue (oldest pending first).
CREATE INDEX IF NOT EXISTS plugin_versions_pending
  ON plugin_versions(submitted_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS plugin_installs (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plugin_id INT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, plugin_id)
);
-- Postgres does not auto-index the referencing side of an FK: without this,
-- every plugin delete (and the catalog install-count aggregate) scans installs.
CREATE INDEX IF NOT EXISTS plugin_installs_plugin ON plugin_installs(plugin_id);
`;

const PLUGIN_COLS =
  'id, account_id, slug, author_handle, name, summary, description, category, status, created_at, updated_at';
const VERSION_COLS =
  'id, plugin_id, version, source, notes, meta, screen, status, review_note, reviewed_by, submitted_at, reviewed_at';
// The live version of a plugin is its highest approved version; there is no
// pointer column to keep in sync (and no circular FK).
const LIVE_VERSION_SQL = `
  SELECT ${VERSION_COLS} FROM plugin_versions
   WHERE plugin_id = $1 AND status = 'approved'
   ORDER BY version DESC LIMIT 1`;

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

interface PluginDbRow {
  id: number;
  account_id: number | null;
  slug: string;
  author_handle: string | null;
  name: string;
  summary: string;
  description: string;
  category: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface VersionDbRow {
  id: number;
  plugin_id: number;
  version: number;
  source: string;
  notes: string;
  meta: unknown;
  screen: unknown;
  status: string;
  review_note: string;
  reviewed_by: number | null;
  submitted_at: Date | string;
  reviewed_at: Date | string | null;
}

function toPlugin(row: PluginDbRow): PluginRecord {
  return {
    id: row.id,
    accountId: row.account_id ?? null,
    slug: row.slug,
    authorHandle: row.author_handle ?? null,
    name: row.name,
    summary: row.summary,
    description: row.description,
    category: row.category as PluginCategory,
    status: row.status as PluginStatus,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

function toMeta(raw: unknown): PluginMeta {
  const meta = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    name: typeof meta.name === 'string' ? meta.name : '',
    summary: typeof meta.summary === 'string' ? meta.summary : '',
    description: typeof meta.description === 'string' ? meta.description : '',
    category: (typeof meta.category === 'string' ? meta.category : 'tools') as PluginCategory,
  };
}

function toVersion(row: VersionDbRow): PluginVersionRecord {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    version: row.version,
    source: row.source,
    notes: row.notes,
    meta: toMeta(row.meta),
    screen: decodeScreenFlags(row.screen),
    status: row.status as PluginVersionStatus,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by ?? null,
    submittedAt: isoString(row.submitted_at),
    reviewedAt: row.reviewed_at === null ? null : isoString(row.reviewed_at),
  };
}

export class PgPluginsDb implements PluginsDb {
  constructor(private readonly pool: Pool) {}

  // Same shape as insertMapCapped (maps_db.ts): lock the account row, count,
  // then insert plugin + version 1 atomically. A slug unique violation
  // propagates to the caller's retry loop. accountId null is the seed path
  // (scripts/seed_plugins.ts): first-party rows, no owning account, no cap.
  async insertPluginCapped(
    input: {
      accountId: number | null;
      slug: string;
      authorHandle: string | null;
      meta: PluginMeta;
      source: string;
      notes: string;
      screen: unknown;
    },
    cap: number,
  ): Promise<PluginRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (input.accountId !== null) {
        const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
          input.accountId,
        ]);
        if ((account.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        const count = await client.query(
          'SELECT count(*)::int AS n FROM plugins WHERE account_id = $1',
          [input.accountId],
        );
        if (Number(count.rows[0]?.n ?? 0) >= cap) {
          await client.query('ROLLBACK');
          return null;
        }
      }
      const inserted = await client.query(
        `INSERT INTO plugins (account_id, slug, author_handle, name, summary, description, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${PLUGIN_COLS}`,
        [
          input.accountId,
          input.slug,
          input.authorHandle,
          input.meta.name,
          input.meta.summary,
          input.meta.description,
          input.meta.category,
        ],
      );
      const plugin = toPlugin(inserted.rows[0]);
      await client.query(
        `INSERT INTO plugin_versions (plugin_id, version, source, notes, meta, screen)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          plugin.id,
          input.source,
          input.notes,
          JSON.stringify(input.meta),
          JSON.stringify(input.screen),
        ],
      );
      await client.query('COMMIT');
      return plugin;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getPlugin(id: number): Promise<PluginRecord | null> {
    const res = await this.pool.query(`SELECT ${PLUGIN_COLS} FROM plugins WHERE id = $1`, [id]);
    return res.rows[0] ? toPlugin(res.rows[0]) : null;
  }

  async getPluginBySlug(slug: string): Promise<PluginRecord | null> {
    const res = await this.pool.query(`SELECT ${PLUGIN_COLS} FROM plugins WHERE slug = $1`, [slug]);
    return res.rows[0] ? toPlugin(res.rows[0]) : null;
  }

  // Replace-or-append under the plugin row lock so concurrent submissions
  // cannot mint the same version number. The prune keeps the newest `keep`
  // rows by version PLUS the live approved version (the CASE arm), so a
  // rejected-resubmit streak can never delete the source clients are running.
  async upsertPendingVersion(
    pluginId: number,
    input: { meta: PluginMeta; source: string; notes: string; screen: unknown },
    keep: number,
  ): Promise<PluginVersionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT id FROM plugins WHERE id = $1 FOR UPDATE', [
        pluginId,
      ]);
      if ((locked.rowCount ?? 0) === 0) throw new Error(`plugin ${pluginId} does not exist`);
      const metaJson = JSON.stringify(input.meta);
      const screenJson = JSON.stringify(input.screen);
      const updated = await client.query(
        `UPDATE plugin_versions
            SET source = $2, notes = $3, meta = $4::jsonb, screen = $5::jsonb, submitted_at = now()
          WHERE plugin_id = $1 AND status = 'pending'
          RETURNING ${VERSION_COLS}`,
        [pluginId, input.source, input.notes, metaJson, screenJson],
      );
      let row = updated.rows[0];
      if (!row) {
        const inserted = await client.query(
          `INSERT INTO plugin_versions (plugin_id, version, source, notes, meta, screen)
           SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4::jsonb, $5::jsonb
             FROM plugin_versions WHERE plugin_id = $1
           RETURNING ${VERSION_COLS}`,
          [pluginId, input.source, input.notes, metaJson, screenJson],
        );
        row = inserted.rows[0];
      }
      await client.query(
        `DELETE FROM plugin_versions
          WHERE plugin_id = $1
            AND id NOT IN (
              SELECT id FROM plugin_versions WHERE plugin_id = $1
               ORDER BY version DESC LIMIT $2
            )
            AND version <> (
              SELECT COALESCE(MAX(version), -1) FROM plugin_versions
               WHERE plugin_id = $1 AND status = 'approved'
            )`,
        [pluginId, keep],
      );
      await client.query('COMMIT');
      return toVersion(row);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getLiveVersion(pluginId: number): Promise<PluginVersionRecord | null> {
    const res = await this.pool.query(LIVE_VERSION_SQL, [pluginId]);
    return res.rows[0] ? toVersion(res.rows[0]) : null;
  }

  async getVersion(versionId: number): Promise<PluginVersionRecord | null> {
    const res = await this.pool.query(`SELECT ${VERSION_COLS} FROM plugin_versions WHERE id = $1`, [
      versionId,
    ]);
    return res.rows[0] ? toVersion(res.rows[0]) : null;
  }

  async listCatalog(limit: number): Promise<CatalogRow[]> {
    const res = await this.pool.query(
      `SELECT p.id, p.slug, p.name, p.summary, p.category, p.author_handle, p.updated_at,
              v.version, COALESCE(i.n, 0)::int AS installs
         FROM plugins p
         JOIN LATERAL (
           SELECT version FROM plugin_versions v
            WHERE v.plugin_id = p.id AND v.status = 'approved'
            ORDER BY version DESC LIMIT 1
         ) v ON TRUE
         LEFT JOIN (
           SELECT plugin_id, count(*)::int AS n FROM plugin_installs GROUP BY plugin_id
         ) i ON i.plugin_id = p.id
        WHERE p.status = 'listed'
        ORDER BY p.updated_at DESC
        LIMIT $1`,
      [limit],
    );
    return res.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      category: row.category as PluginCategory,
      authorHandle: row.author_handle ?? null,
      version: row.version,
      installs: row.installs,
      updatedAt: isoString(row.updated_at),
    }));
  }

  async listForAccount(accountId: number): Promise<MineRow[]> {
    const res = await this.pool.query(
      `SELECT ${PLUGIN_COLS.split(', ')
        .map((col) => `p.${col}`)
        .join(', ')},
              live.version AS live_version,
              latest.version AS latest_version, latest.status AS latest_status,
              latest.review_note AS latest_review_note, latest.submitted_at AS latest_submitted_at
         FROM plugins p
         LEFT JOIN LATERAL (
           SELECT version FROM plugin_versions v
            WHERE v.plugin_id = p.id AND v.status = 'approved'
            ORDER BY version DESC LIMIT 1
         ) live ON TRUE
         LEFT JOIN LATERAL (
           SELECT version, status, review_note, submitted_at FROM plugin_versions v
            WHERE v.plugin_id = p.id
            ORDER BY version DESC LIMIT 1
         ) latest ON TRUE
        WHERE p.account_id = $1
        ORDER BY p.updated_at DESC`,
      [accountId],
    );
    return res.rows.map((row) => ({
      plugin: toPlugin(row),
      liveVersion: row.live_version ?? null,
      latest:
        row.latest_version === null || row.latest_version === undefined
          ? null
          : {
              version: row.latest_version,
              status: row.latest_status as PluginVersionStatus,
              reviewNote: row.latest_review_note,
              submittedAt: isoString(row.latest_submitted_at),
            },
    }));
  }

  async listInstalled(accountId: number): Promise<InstalledRow[]> {
    const res = await this.pool.query(
      `SELECT p.id, p.slug, p.name, p.summary, p.category, p.updated_at,
              inst.enabled, v.version, v.source
         FROM plugin_installs inst
         JOIN plugins p ON p.id = inst.plugin_id AND p.status = 'listed'
         JOIN LATERAL (
           SELECT version, source FROM plugin_versions v
            WHERE v.plugin_id = p.id AND v.status = 'approved'
            ORDER BY version DESC LIMIT 1
         ) v ON TRUE
        WHERE inst.account_id = $1
        ORDER BY p.name ASC`,
      [accountId],
    );
    return res.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      category: row.category as PluginCategory,
      version: row.version,
      enabled: row.enabled,
      source: row.source,
      updatedAt: isoString(row.updated_at),
    }));
  }

  // Existing rows always update (a toggle is never blocked by the cap); only a
  // NEW install pays the FOR UPDATE + count check, mirroring insertPluginCapped.
  async upsertInstallCapped(
    accountId: number,
    pluginId: number,
    enabled: boolean,
    cap: number,
  ): Promise<'ok' | 'cap_reached'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE plugin_installs SET enabled = $3
          WHERE account_id = $1 AND plugin_id = $2 RETURNING plugin_id`,
        [accountId, pluginId, enabled],
      );
      if ((updated.rowCount ?? 0) > 0) {
        await client.query('COMMIT');
        return 'ok';
      }
      await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      const count = await client.query(
        'SELECT count(*)::int AS n FROM plugin_installs WHERE account_id = $1',
        [accountId],
      );
      if (Number(count.rows[0]?.n ?? 0) >= cap) {
        await client.query('ROLLBACK');
        return 'cap_reached';
      }
      await client.query(
        `INSERT INTO plugin_installs (account_id, plugin_id, enabled) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, plugin_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [accountId, pluginId, enabled],
      );
      await client.query('COMMIT');
      return 'ok';
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async setInstallEnabled(accountId: number, pluginId: number, enabled: boolean): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE plugin_installs SET enabled = $3
        WHERE account_id = $1 AND plugin_id = $2 RETURNING plugin_id`,
      [accountId, pluginId, enabled],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async deleteInstall(accountId: number, pluginId: number): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM plugin_installs WHERE account_id = $1 AND plugin_id = $2 RETURNING plugin_id',
      [accountId, pluginId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async deletePlugin(id: number, accountId: number): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM plugins WHERE id = $1 AND account_id = $2 RETURNING id',
      [id, accountId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // The review decision and its consequences land atomically: the version row
  // flips exactly once (the status = 'pending' guard under the row lock), and
  // an approval copies the version's proposed meta onto the plugin row in the
  // same transaction, flipping a never-listed plugin to 'listed' while an
  // operator-delisted plugin stays delisted (relist is a separate, deliberate
  // action).
  async reviewVersion(
    versionId: number,
    reviewerAccountId: number,
    action: 'approved' | 'rejected',
    note: string,
  ): Promise<PluginVersionRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE plugin_versions
            SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
          WHERE id = $1 AND status = 'pending'
          RETURNING ${VERSION_COLS}`,
        [versionId, action, note, reviewerAccountId],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const version = toVersion(updated.rows[0]);
      if (action === 'approved') {
        await client.query(
          `UPDATE plugins
              SET name = $2, summary = $3, description = $4, category = $5,
                  status = CASE WHEN status = 'pending' THEN 'listed' ELSE status END,
                  updated_at = now()
            WHERE id = $1`,
          [
            version.pluginId,
            version.meta.name,
            version.meta.summary,
            version.meta.description,
            version.meta.category,
          ],
        );
      }
      await client.query('COMMIT');
      return version;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async setListed(pluginId: number, listed: boolean): Promise<boolean> {
    const res = listed
      ? await this.pool.query(
          `UPDATE plugins
              SET status = CASE
                    WHEN EXISTS (
                      SELECT 1 FROM plugin_versions
                       WHERE plugin_id = $1 AND status = 'approved'
                    ) THEN 'listed' ELSE 'pending' END,
                  updated_at = now()
            WHERE id = $1 AND status = 'delisted'
            RETURNING id`,
          [pluginId],
        )
      : await this.pool.query(
          `UPDATE plugins SET status = 'delisted', updated_at = now()
            WHERE id = $1 AND status <> 'delisted' RETURNING id`,
          [pluginId],
        );
    return (res.rowCount ?? 0) > 0;
  }

  async listPendingReview(): Promise<PendingReviewRow[]> {
    const res = await this.pool.query(
      `SELECT v.id, v.plugin_id, v.version, v.meta, v.notes, v.source, v.screen, v.submitted_at,
              p.slug, p.account_id, p.author_handle,
              EXISTS (
                SELECT 1 FROM plugin_versions a
                 WHERE a.plugin_id = v.plugin_id AND a.status = 'approved'
              ) AS is_update
         FROM plugin_versions v
         JOIN plugins p ON p.id = v.plugin_id
        WHERE v.status = 'pending'
        ORDER BY v.submitted_at ASC`,
    );
    return res.rows.map((row) => ({
      versionId: row.id,
      pluginId: row.plugin_id,
      slug: row.slug,
      accountId: row.account_id ?? null,
      authorHandle: row.author_handle ?? null,
      version: row.version,
      meta: toMeta(row.meta),
      notes: row.notes,
      source: row.source,
      screen: decodeScreenFlags(row.screen),
      submittedAt: isoString(row.submitted_at),
      isUpdate: row.is_update === true,
    }));
  }

  async listAdmin(
    limit: number,
    offset: number,
  ): Promise<{
    rows: (PluginRecord & { installs: number; liveVersion: number | null })[];
    total: number;
  }> {
    const [rows, total] = await Promise.all([
      this.pool.query(
        `SELECT ${PLUGIN_COLS.split(', ')
          .map((col) => `p.${col}`)
          .join(', ')},
                COALESCE(i.n, 0)::int AS installs, live.version AS live_version
           FROM plugins p
           LEFT JOIN (
             SELECT plugin_id, count(*)::int AS n FROM plugin_installs GROUP BY plugin_id
           ) i ON i.plugin_id = p.id
           LEFT JOIN LATERAL (
             SELECT version FROM plugin_versions v
              WHERE v.plugin_id = p.id AND v.status = 'approved'
              ORDER BY version DESC LIMIT 1
           ) live ON TRUE
          ORDER BY p.updated_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.pool.query('SELECT count(*)::int AS n FROM plugins'),
    ]);
    return {
      rows: rows.rows.map((row) => ({
        ...toPlugin(row),
        installs: row.installs,
        liveVersion: row.live_version ?? null,
      })),
      total: Number(total.rows[0]?.n ?? 0),
    };
  }
}
