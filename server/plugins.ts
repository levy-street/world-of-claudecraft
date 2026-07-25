// Plugin store business rules: submit-for-review lifecycle (every version of
// every community plugin is human-approved before any client can load it),
// the catalog/install surface, caps, and validation. Mirrors the
// MapsService/MapsDb split (server/maps.ts): this module holds the rules
// against a narrow PluginsDb interface (Postgres implementation in
// plugins_db.ts; tests use an in-memory fake) and carries zero SQL and zero
// HTTP. The review model is the whole security story: plugin source runs with
// page privileges on OTHER players' clients, so nothing a client submits is
// ever served to another player until an operator approves that exact version
// (docs/prd/plugins-store.md, Threat model).

import { randomBytes } from 'node:crypto';
import { offensiveName } from './auth';
import { isUniqueViolation } from './http_util';
import { type PluginScreenFlag, screenPluginSource } from './plugin_screen';

export const MAX_PLUGINS_PER_ACCOUNT = 8;
export const MAX_INSTALLS_PER_ACCOUNT = 32;
// Source is capped well under the WS/body ceilings: a mod the size of a small
// module, not an application bundle.
export const MAX_PLUGIN_SOURCE_BYTES = 128 * 1024;
// The submit body wraps the source in JSON with metadata; this caps raw bytes.
export const MAX_PLUGIN_SUBMIT_BYTES = 192 * 1024;
// Superseded versions kept per plugin (newest by version number, plus the live
// approved version, which the prune never drops). Keeps plugin_versions
// bounded by construction: MAX_PLUGINS_PER_ACCOUNT x this, per account.
export const PLUGIN_VERSIONS_KEPT = 20;
// The catalog is one bounded, cached page: a community store measured in
// hundreds of listings, not millions. Revisit with real pagination if the
// listed count ever approaches this.
export const CATALOG_LIMIT = 200;

export const MAX_PLUGIN_NAME_LENGTH = 40;
export const MAX_AUTHOR_HANDLE_LENGTH = 24;
export const MAX_SUMMARY_LENGTH = 140;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_NOTES_LENGTH = 1000;

export const PLUGIN_CATEGORIES = ['combat', 'economy', 'social', 'interface', 'tools'] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Plugin listing status. 'pending' = no approved version yet (never listed);
 * 'listed' = live in the catalog; 'delisted' = operator kill switch (hidden
 * from the catalog AND excluded from every player's installed payload). */
export type PluginStatus = 'pending' | 'listed' | 'delisted';
export type PluginVersionStatus = 'pending' | 'approved' | 'rejected';

/** The metadata a submission proposes; applied to the plugin row only when the
 * version is approved, so unreviewed text never reaches the public catalog. */
export interface PluginMeta {
  name: string;
  summary: string;
  description: string;
  category: PluginCategory;
}

export interface PluginRecord extends PluginMeta {
  id: number;
  /** null = first-party seed content (shown as the WoC team, not a player). */
  accountId: number | null;
  slug: string;
  authorHandle: string | null;
  status: PluginStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PluginVersionRecord {
  id: number;
  pluginId: number;
  version: number;
  source: string;
  notes: string;
  meta: PluginMeta;
  screen: PluginScreenFlag[];
  status: PluginVersionStatus;
  reviewNote: string;
  reviewedBy: number | null;
  submittedAt: string;
  reviewedAt: string | null;
}

/** One catalog row: the live approved version joined with install counts. */
export interface CatalogRow {
  id: number;
  slug: string;
  name: string;
  summary: string;
  category: PluginCategory;
  authorHandle: string | null;
  version: number;
  installs: number;
  updatedAt: string;
}

/** One installed row for the boot payload: carries the approved source. */
export interface InstalledRow {
  id: number;
  slug: string;
  name: string;
  summary: string;
  category: PluginCategory;
  version: number;
  enabled: boolean;
  source: string;
  updatedAt: string;
}

/** The author's own view of one plugin, including review state. */
export interface MineRow {
  plugin: PluginRecord;
  liveVersion: number | null;
  latest: {
    version: number;
    status: PluginVersionStatus;
    reviewNote: string;
    submittedAt: string;
  } | null;
}

/** One admin review-queue row: the pending version plus its proposed meta. */
export interface PendingReviewRow {
  versionId: number;
  pluginId: number;
  slug: string;
  accountId: number | null;
  authorHandle: string | null;
  version: number;
  meta: PluginMeta;
  notes: string;
  source: string;
  screen: PluginScreenFlag[];
  submittedAt: string;
  /** Whether an older approved version is currently live (an update) or this
   * would be the plugin's first listing. */
  isUpdate: boolean;
}

export type PluginsErrorCode =
  | 'plugins.invalid_name'
  | 'plugins.name_not_allowed'
  | 'plugins.invalid_handle'
  | 'plugins.invalid_summary'
  | 'plugins.invalid_description'
  | 'plugins.invalid_category'
  | 'plugins.invalid_source'
  | 'plugins.source_too_large'
  | 'plugins.source_syntax'
  | 'plugins.limit_reached'
  | 'plugins.install_limit'
  | 'plugins.not_found'
  | 'plugins.not_listed'
  | 'plugins.not_installed'
  | 'plugins.slug_unavailable'
  | 'plugins.review_invalid';

export type PluginsResult<T> = { ok: true; value: T } | { ok: false; error: PluginsErrorCode };

export function pluginsErrorStatus(code: PluginsErrorCode): number {
  switch (code) {
    case 'plugins.not_found':
    case 'plugins.not_installed':
      return 404;
    case 'plugins.slug_unavailable':
      return 409;
    case 'plugins.source_too_large':
      return 413;
    default:
      return 400;
  }
}

// Storage abstraction. The Postgres implementation (plugins_db.ts) enforces the
// per-account caps inside FOR UPDATE + count transactions and relies on the
// UNIQUE slug index (a violation is thrown and retried here); the in-memory
// test fake mirrors those semantics.
export interface PluginsDb {
  /** Insert a plugin plus its version-1 pending submission atomically; null
   * when the per-account plugin cap is hit. Throws a unique violation on a
   * slug clash. */
  insertPluginCapped(
    input: {
      accountId: number | null;
      slug: string;
      authorHandle: string | null;
      meta: PluginMeta;
      source: string;
      notes: string;
      screen: PluginScreenFlag[];
    },
    cap: number,
  ): Promise<PluginRecord | null>;
  getPlugin(id: number): Promise<PluginRecord | null>;
  getPluginBySlug(slug: string): Promise<PluginRecord | null>;
  /** Replace the plugin's pending version if one exists, else append a new
   * version (max version + 1). Prunes superseded rows past `keep`, never the
   * live approved version. Returns the stored version row. */
  upsertPendingVersion(
    pluginId: number,
    input: { meta: PluginMeta; source: string; notes: string; screen: PluginScreenFlag[] },
    keep: number,
  ): Promise<PluginVersionRecord>;
  /** The live (highest approved) version row, or null when none is approved. */
  getLiveVersion(pluginId: number): Promise<PluginVersionRecord | null>;
  getVersion(versionId: number): Promise<PluginVersionRecord | null>;
  /** Catalog rows for every 'listed' plugin with an approved version, newest
   * update first, capped at `limit`, with install counts. */
  listCatalog(limit: number): Promise<CatalogRow[]>;
  listForAccount(accountId: number): Promise<MineRow[]>;
  /** Every installed plugin for the account that is currently listed with an
   * approved live version; carries the live source. */
  listInstalled(accountId: number): Promise<InstalledRow[]>;
  /** Upsert an install; 'cap_reached' when the per-account install cap is hit
   * (counting only NEW installs, an existing row always updates). */
  upsertInstallCapped(
    accountId: number,
    pluginId: number,
    enabled: boolean,
    cap: number,
  ): Promise<'ok' | 'cap_reached'>;
  setInstallEnabled(accountId: number, pluginId: number, enabled: boolean): Promise<boolean>;
  deleteInstall(accountId: number, pluginId: number): Promise<boolean>;
  deletePlugin(id: number, accountId: number): Promise<boolean>;
  /** Approve or reject a pending version. Approve also copies the version's
   * proposed meta onto the plugin row and flips a 'pending' plugin to
   * 'listed' (a 'delisted' plugin stays delisted; relist is separate),
   * atomically. Returns the updated version row, or null when the version is
   * missing or not pending. */
  reviewVersion(
    versionId: number,
    reviewerAccountId: number,
    action: 'approved' | 'rejected',
    note: string,
  ): Promise<PluginVersionRecord | null>;
  /** Operator listing flip. Delist always sticks; relist restores 'listed'
   * only when an approved version exists, else 'pending'. False on a missing
   * plugin. */
  setListed(pluginId: number, listed: boolean): Promise<boolean>;
  /** Every pending version with its plugin context, oldest submission first. */
  listPendingReview(): Promise<PendingReviewRow[]>;
  /** Admin moderation list: every plugin regardless of status, newest first. */
  listAdmin(
    limit: number,
    offset: number,
  ): Promise<{
    rows: (PluginRecord & { installs: number; liveVersion: number | null })[];
    total: number;
  }>;
}

// Names: letters/digits first, then letters, digits, spaces, apostrophes, and
// hyphens (the map-name posture, server/maps.ts).
const PLUGIN_NAME_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9' -]{2,${MAX_PLUGIN_NAME_LENGTH - 1}}$`);
const AUTHOR_HANDLE_RE = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9' -]{1,${MAX_AUTHOR_HANDLE_LENGTH - 1}}$`,
);
const MAX_SLUG_ATTEMPTS = 25;
const MAX_SLUG_LENGTH = 64;

export function normalizePluginName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  return PLUGIN_NAME_RE.test(cleaned) ? cleaned : null;
}

/** Single-line, printable, length-capped free text (summary/notes). */
function normalizeLine(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (cleaned.length > maxLength) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  return /[\u0000-\u001f\u007f]/.test(cleaned) ? null : cleaned;
}

/** Multi-line description: normalized newlines, control chars rejected. */
function normalizeDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\r\n?/g, '\n').trim();
  if (cleaned.length > MAX_DESCRIPTION_LENGTH) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  return /[\u0000-\u0009\u000b-\u001f\u007f]/.test(cleaned) ? null : cleaned;
}

export function isPluginCategory(raw: unknown): raw is PluginCategory {
  return typeof raw === 'string' && (PLUGIN_CATEGORIES as readonly string[]).includes(raw);
}

/** URL-safe slug base from a plugin name; mirrors mapSlugBase (server/maps.ts). */
export function pluginSlugBase(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'plugin';
}

/**
 * Validate submitted source: a non-empty string under the byte cap that at
 * least parses as a function body. The Function constructor only PARSES here
 * (the returned function is discarded and never invoked), so hostile source
 * cannot execute on the server; this catches truncated pastes and syntax
 * errors before they reach a reviewer.
 */
export function validatePluginSource(raw: unknown): PluginsErrorCode | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'plugins.invalid_source';
  if (Buffer.byteLength(raw, 'utf8') > MAX_PLUGIN_SOURCE_BYTES) return 'plugins.source_too_large';
  try {
    new Function('woc', `'use strict';${raw}`);
  } catch {
    return 'plugins.source_syntax';
  }
  return null;
}

interface SubmissionInput {
  meta: PluginMeta;
  source: string;
  notes: string;
}

/** Wire shape for a catalog row (already anonymous-safe: no account ids). */
export function catalogRowJson(row: CatalogRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    category: row.category,
    author: row.authorHandle,
    version: row.version,
    installs: row.installs,
    updatedAt: row.updatedAt,
  };
}

export function installedRowJson(row: InstalledRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    category: row.category,
    version: row.version,
    enabled: row.enabled,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

export function mineRowJson(row: MineRow): Record<string, unknown> {
  return {
    id: row.plugin.id,
    slug: row.plugin.slug,
    name: row.plugin.name,
    summary: row.plugin.summary,
    description: row.plugin.description,
    category: row.plugin.category,
    author: row.plugin.authorHandle,
    status: row.plugin.status,
    liveVersion: row.liveVersion,
    latest: row.latest,
    updatedAt: row.plugin.updatedAt,
  };
}

/** Public detail: live metadata plus the live version's source (plugin source
 * is public by design, like a browser extension store's view-source). */
export function detailJson(
  plugin: PluginRecord,
  live: PluginVersionRecord,
): Record<string, unknown> {
  return {
    id: plugin.id,
    slug: plugin.slug,
    name: plugin.name,
    summary: plugin.summary,
    description: plugin.description,
    category: plugin.category,
    author: plugin.authorHandle,
    version: live.version,
    source: live.source,
    updatedAt: plugin.updatedAt,
  };
}

/** Admin moderation list row (the { success, data } admin envelope carries it). */
export function adminPluginRowJson(
  row: PluginRecord & { installs: number; liveVersion: number | null },
): Record<string, unknown> {
  return {
    id: row.id,
    accountId: row.accountId,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    category: row.category,
    author: row.authorHandle,
    status: row.status,
    liveVersion: row.liveVersion,
    installs: row.installs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Admin review-queue row: the full pending submission for a reviewer. */
export function pendingReviewRowJson(row: PendingReviewRow): Record<string, unknown> {
  return {
    versionId: row.versionId,
    pluginId: row.pluginId,
    slug: row.slug,
    accountId: row.accountId,
    author: row.authorHandle,
    version: row.version,
    name: row.meta.name,
    summary: row.meta.summary,
    description: row.meta.description,
    category: row.meta.category,
    notes: row.notes,
    source: row.source,
    screen: row.screen,
    submittedAt: row.submittedAt,
    isUpdate: row.isUpdate,
  };
}

export class PluginsService {
  constructor(
    private readonly db: PluginsDb,
    private readonly slugSuffix: () => string = () => randomBytes(3).toString('hex'),
  ) {}

  private slugCandidate(base: string, attempt: number): string {
    if (attempt === 0) return base.slice(0, MAX_SLUG_LENGTH);
    return `${base}-${this.slugSuffix()}`.slice(0, MAX_SLUG_LENGTH);
  }

  /** Validate one submission payload (create or update) into normalized parts. */
  private resolveSubmission(raw: {
    name: unknown;
    summary: unknown;
    description: unknown;
    category: unknown;
    source: unknown;
    notes: unknown;
  }): PluginsResult<SubmissionInput> {
    const name = normalizePluginName(raw.name);
    if (!name) return { ok: false, error: 'plugins.invalid_name' };
    if (offensiveName(name)) return { ok: false, error: 'plugins.name_not_allowed' };
    const summary = normalizeLine(raw.summary, MAX_SUMMARY_LENGTH);
    if (!summary) return { ok: false, error: 'plugins.invalid_summary' };
    if (offensiveName(summary)) return { ok: false, error: 'plugins.invalid_summary' };
    const description = normalizeDescription(raw.description ?? '');
    if (description === null) return { ok: false, error: 'plugins.invalid_description' };
    if (description && offensiveName(description)) {
      return { ok: false, error: 'plugins.invalid_description' };
    }
    if (!isPluginCategory(raw.category)) return { ok: false, error: 'plugins.invalid_category' };
    const sourceError = validatePluginSource(raw.source);
    if (sourceError) return { ok: false, error: sourceError };
    const notes = normalizeLine(raw.notes ?? '', MAX_NOTES_LENGTH);
    if (notes === null) return { ok: false, error: 'plugins.invalid_description' };
    return {
      ok: true,
      value: {
        meta: { name, summary, description, category: raw.category },
        source: raw.source as string,
        notes,
      },
    };
  }

  /** Create a plugin: metadata + version 1, both pending review. */
  async createPlugin(
    accountId: number,
    raw: {
      name: unknown;
      summary: unknown;
      description: unknown;
      category: unknown;
      source: unknown;
      notes: unknown;
      authorHandle: unknown;
    },
  ): Promise<PluginsResult<PluginRecord>> {
    const submission = this.resolveSubmission(raw);
    if (!submission.ok) return submission;
    const handleRaw = typeof raw.authorHandle === 'string' ? raw.authorHandle.trim() : '';
    if (!AUTHOR_HANDLE_RE.test(handleRaw) || offensiveName(handleRaw)) {
      return { ok: false, error: 'plugins.invalid_handle' };
    }
    const screen = screenPluginSource(submission.value.source);
    const base = pluginSlugBase(submission.value.meta.name);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = this.slugCandidate(base, attempt);
      try {
        const plugin = await this.db.insertPluginCapped(
          {
            accountId,
            slug,
            authorHandle: handleRaw,
            meta: submission.value.meta,
            source: submission.value.source,
            notes: submission.value.notes,
            screen,
          },
          MAX_PLUGINS_PER_ACCOUNT,
        );
        if (!plugin) return { ok: false, error: 'plugins.limit_reached' };
        return { ok: true, value: plugin };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return { ok: false, error: 'plugins.slug_unavailable' };
  }

  /** Submit an update for an owned plugin: a new (or replaced) pending version. */
  async submitVersion(
    plugin: PluginRecord,
    raw: {
      name: unknown;
      summary: unknown;
      description: unknown;
      category: unknown;
      source: unknown;
      notes: unknown;
    },
  ): Promise<PluginsResult<PluginVersionRecord>> {
    const submission = this.resolveSubmission({
      // Omitted metadata fields fall back to the plugin's current values so an
      // update can ship source-only.
      name: raw.name ?? plugin.name,
      summary: raw.summary ?? plugin.summary,
      description: raw.description ?? plugin.description,
      category: raw.category ?? plugin.category,
      source: raw.source,
      notes: raw.notes,
    });
    if (!submission.ok) return submission;
    const screen = screenPluginSource(submission.value.source);
    const version = await this.db.upsertPendingVersion(
      plugin.id,
      { ...submission.value, screen },
      PLUGIN_VERSIONS_KEPT,
    );
    return { ok: true, value: version };
  }

  catalog(): Promise<CatalogRow[]> {
    return this.db.listCatalog(CATALOG_LIMIT);
  }

  /** Owner-path read: the raw plugin row regardless of listing status. */
  getPlugin(id: number): Promise<PluginRecord | null> {
    return this.db.getPlugin(id);
  }

  /** Public detail for a listed plugin with an approved live version. */
  async detail(
    pluginId: number,
  ): Promise<{ plugin: PluginRecord; live: PluginVersionRecord } | null> {
    const plugin = await this.db.getPlugin(pluginId);
    if (!plugin || plugin.status !== 'listed') return null;
    const live = await this.db.getLiveVersion(pluginId);
    if (!live) return null;
    return { plugin, live };
  }

  mine(accountId: number): Promise<MineRow[]> {
    return this.db.listForAccount(accountId);
  }

  installed(accountId: number): Promise<InstalledRow[]> {
    return this.db.listInstalled(accountId);
  }

  /** Install (or re-enable) a listed plugin for an account. */
  async install(
    accountId: number,
    pluginId: number,
    enabled: boolean,
  ): Promise<PluginsErrorCode | null> {
    const plugin = await this.db.getPlugin(pluginId);
    if (!plugin) return 'plugins.not_found';
    if (plugin.status !== 'listed') return 'plugins.not_listed';
    const outcome = await this.db.upsertInstallCapped(
      accountId,
      pluginId,
      enabled,
      MAX_INSTALLS_PER_ACCOUNT,
    );
    return outcome === 'ok' ? null : 'plugins.install_limit';
  }

  /** Flip the enabled bit on an existing install. */
  async setEnabled(
    accountId: number,
    pluginId: number,
    enabled: boolean,
  ): Promise<PluginsErrorCode | null> {
    const updated = await this.db.setInstallEnabled(accountId, pluginId, enabled);
    return updated ? null : 'plugins.not_installed';
  }

  async uninstall(accountId: number, pluginId: number): Promise<PluginsErrorCode | null> {
    const removed = await this.db.deleteInstall(accountId, pluginId);
    return removed ? null : 'plugins.not_installed';
  }

  deletePlugin(accountId: number, pluginId: number): Promise<boolean> {
    return this.db.deletePlugin(pluginId, accountId);
  }

  // Admin surface (permission-gated in server/admin.ts, content.moderate).

  listPendingReview(): Promise<PendingReviewRow[]> {
    return this.db.listPendingReview();
  }

  adminList(
    page: number,
    limit: number,
  ): Promise<{
    rows: (PluginRecord & { installs: number; liveVersion: number | null })[];
    total: number;
  }> {
    return this.db.listAdmin(limit, (page - 1) * limit);
  }

  /** Approve or reject a pending version. Null = missing or not pending. */
  async review(
    versionId: number,
    reviewerAccountId: number,
    action: 'approved' | 'rejected',
    rawNote: unknown,
  ): Promise<PluginVersionRecord | 'invalid' | null> {
    const note = normalizeLine(rawNote ?? '', MAX_NOTES_LENGTH);
    if (note === null) return 'invalid';
    return this.db.reviewVersion(versionId, reviewerAccountId, action, note);
  }

  /** Operator kill switch (delist) and its inverse. */
  setListed(pluginId: number, listed: boolean): Promise<boolean> {
    return this.db.setListed(pluginId, listed);
  }
}
