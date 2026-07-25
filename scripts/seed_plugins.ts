// Seed (or refresh) the first-party plugin store catalog. Idempotent by slug:
//   - a missing plugin is inserted as first party (account_id NULL) with an
//     APPROVED version 1 and status 'listed';
//   - an existing plugin whose live source or metadata differs from the seed
//     gets a new APPROVED version (max version + 1) and refreshed metadata,
//     which is exactly the update path clients pick up on their next
//     installed-list fetch (no redeploy);
//   - an unchanged seed is a no-op; an operator-delisted seed STAYS delisted
//     (the kill switch outranks the seeder).
// Run with: npm run db:seed-plugins (needs DATABASE_URL; docker dev db via
// `npm run db:up` uses postgres://woc:woc@127.0.0.1:5433/woc, see README).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { screenPluginSource } from '../server/plugin_screen';
import { PLUGIN_VERSIONS_KEPT, validatePluginSource } from '../server/plugins';
import { SEED_PLUGINS } from '../server/plugins_seed/manifest';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production usually injects DATABASE_URL directly.
}

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'plugins_seed');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set; aborting.');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const seed of SEED_PLUGINS) {
      const source = readFileSync(join(seedDir, seed.file), 'utf8');
      const invalid = validatePluginSource(source);
      if (invalid) throw new Error(`${seed.slug}: seed source failed validation (${invalid})`);
      const screen = screenPluginSource(source);
      if (screen.length > 0) {
        throw new Error(
          `${seed.slug}: seed source tripped the pre-screen (${screen
            .map((flag) => flag.code)
            .join(', ')}); seeds must screen clean`,
        );
      }
      const meta = {
        name: seed.name,
        summary: seed.summary,
        description: seed.description,
        category: seed.category,
      };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          'SELECT id, status FROM plugins WHERE slug = $1 FOR UPDATE',
          [seed.slug],
        );
        let pluginId: number;
        if ((existing.rowCount ?? 0) === 0) {
          const inserted = await client.query(
            `INSERT INTO plugins (account_id, slug, author_handle, name, summary, description, category, status)
             VALUES (NULL, $1, NULL, $2, $3, $4, $5, 'listed') RETURNING id`,
            [seed.slug, seed.name, seed.summary, seed.description, seed.category],
          );
          pluginId = inserted.rows[0].id;
          await client.query(
            `INSERT INTO plugin_versions (plugin_id, version, source, notes, meta, screen, status, review_note, reviewed_at)
             VALUES ($1, 1, $2, 'First-party seed.', $3::jsonb, '[]'::jsonb, 'approved', 'Seeded first-party plugin.', now())`,
            [pluginId, source, JSON.stringify(meta)],
          );
          console.log(`seeded ${seed.slug} (new, v1)`);
        } else {
          pluginId = existing.rows[0].id;
          const live = await client.query(
            `SELECT version, source, meta FROM plugin_versions
              WHERE plugin_id = $1 AND status = 'approved'
              ORDER BY version DESC LIMIT 1`,
            [pluginId],
          );
          const liveRow = live.rows[0] as
            | { version: number; source: string; meta: Record<string, unknown> }
            | undefined;
          // Field-wise comparison, never JSON.stringify on the jsonb value:
          // Postgres normalizes jsonb key order, so a stringify comparison
          // would read every unchanged seed as changed and mint a version.
          const liveMeta = liveRow?.meta ?? {};
          const unchanged =
            liveRow !== undefined &&
            liveRow.source === source &&
            (Object.keys(meta) as (keyof typeof meta)[]).every(
              (key) => liveMeta[key] === meta[key],
            );
          if (unchanged) {
            console.log(`unchanged ${seed.slug} (v${liveRow.version})`);
          } else {
            const next = await client.query(
              `INSERT INTO plugin_versions (plugin_id, version, source, notes, meta, screen, status, review_note, reviewed_at)
               SELECT $1, COALESCE(MAX(version), 0) + 1, $2, 'First-party seed refresh.', $3::jsonb, '[]'::jsonb, 'approved', 'Seeded first-party plugin.', now()
                 FROM plugin_versions WHERE plugin_id = $1
               RETURNING version`,
              [pluginId, source, JSON.stringify(meta)],
            );
            // Refresh live metadata; a delisted seed stays delisted (the
            // operator kill switch outranks the seeder).
            await client.query(
              `UPDATE plugins
                  SET name = $2, summary = $3, description = $4, category = $5,
                      status = CASE WHEN status = 'pending' THEN 'listed' ELSE status END,
                      updated_at = now()
                WHERE id = $1`,
              [pluginId, seed.name, seed.summary, seed.description, seed.category],
            );
            // Keep seed history bounded like community submissions: prune to
            // the newest PLUGIN_VERSIONS_KEPT rows, never the row just
            // inserted (it is the highest approved version).
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
              [pluginId, PLUGIN_VERSIONS_KEPT],
            );
            console.log(`updated ${seed.slug} (v${next.rows[0].version})`);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
