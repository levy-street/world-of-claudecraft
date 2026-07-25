// Unit coverage for the plugin store business rules (server/plugins.ts,
// PluginsService) and the thin route handlers (server/plugins_routes.ts). The
// service is driven against an in-memory FakePluginsDb that mirrors the
// PgPluginsDb semantics (per-account caps checked at insert, the UNIQUE slug
// index emulated as a thrown 23505, replace-or-append pending versions with a
// prune that never drops the live approved version, review flips that only
// touch pending rows). The handlers are driven through the exported `routes`
// table + setPluginsServiceForTests + fakeCtx, per the endpoint-test recipe in
// server/CLAUDE.md; the bearer guards and rate limiters are suite-wide gates,
// not under test here, so route.handler is called directly.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL
// is unset; plugins_routes.ts imports it, so set a dummy URL. The pool never
// connects: every handler under test reads through the injected fake service.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_plugins_units';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginScreenFlag } from '../../server/plugin_screen';
import {
  type CatalogRow,
  type InstalledRow,
  MAX_INSTALLS_PER_ACCOUNT,
  MAX_PLUGIN_SOURCE_BYTES,
  MAX_PLUGINS_PER_ACCOUNT,
  type MineRow,
  type PendingReviewRow,
  PLUGIN_VERSIONS_KEPT,
  type PluginMeta,
  type PluginRecord,
  type PluginsDb,
  type PluginsResult,
  PluginsService,
  type PluginVersionRecord,
} from '../../server/plugins';
import {
  bustPluginsCatalog,
  resetPluginsServiceForTests,
  routes,
  setPluginsServiceForTests,
} from '../../server/plugins_routes';
import { type FakeRes, fakeCtx } from './helpers';

// ---------------------------------------------------------------------------
// The in-memory PluginsDb fake, mirroring PgPluginsDb (plugins_db.ts) semantics.
// ---------------------------------------------------------------------------

interface FakeInstall {
  accountId: number;
  pluginId: number;
  enabled: boolean;
  installedAt: string;
}

class FakePluginsDb implements PluginsDb {
  /** Call count for the catalog read, asserted by the route cache test. */
  listCatalogCalls = 0;

  private plugins: PluginRecord[] = [];
  private versions: PluginVersionRecord[] = [];
  private installs: FakeInstall[] = [];
  private nextPluginId = 1;
  private nextVersionId = 1;
  private tick = 0;

  /** Deterministic, strictly increasing timestamps (no wall clock in tests). */
  private nextTime(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.tick * 1000).toISOString();
  }

  /** Test-only visibility: the stored version numbers for one plugin, ascending. */
  versionNumbersFor(pluginId: number): number[] {
    return this.versions
      .filter((v) => v.pluginId === pluginId)
      .map((v) => v.version)
      .sort((a, b) => a - b);
  }

  private clonePlugin(plugin: PluginRecord): PluginRecord {
    return { ...plugin };
  }

  private cloneVersion(version: PluginVersionRecord): PluginVersionRecord {
    return {
      ...version,
      meta: { ...version.meta },
      screen: version.screen.map((flag) => ({ ...flag })),
    };
  }

  private liveVersionRow(pluginId: number): PluginVersionRecord | null {
    const approved = this.versions
      .filter((v) => v.pluginId === pluginId && v.status === 'approved')
      .sort((a, b) => b.version - a.version);
    return approved[0] ?? null;
  }

  async insertPluginCapped(
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
  ): Promise<PluginRecord | null> {
    if (input.accountId !== null) {
      const owned = this.plugins.filter((p) => p.accountId === input.accountId).length;
      if (owned >= cap) return null;
    }
    if (this.plugins.some((p) => p.slug === input.slug)) {
      // The UNIQUE slug index: a pg unique violation is an Error carrying
      // SQLSTATE 23505 on .code, which isUniqueViolation (http_util.ts) reads.
      const err = new Error(
        'duplicate key value violates unique constraint "plugins_slug_key"',
      ) as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    const now = this.nextTime();
    const plugin: PluginRecord = {
      id: this.nextPluginId,
      accountId: input.accountId,
      slug: input.slug,
      authorHandle: input.authorHandle,
      name: input.meta.name,
      summary: input.meta.summary,
      description: input.meta.description,
      category: input.meta.category,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.nextPluginId += 1;
    this.plugins.push(plugin);
    this.versions.push({
      id: this.nextVersionId,
      pluginId: plugin.id,
      version: 1,
      source: input.source,
      notes: input.notes,
      meta: { ...input.meta },
      screen: input.screen.map((flag) => ({ ...flag })),
      status: 'pending',
      reviewNote: '',
      reviewedBy: null,
      submittedAt: now,
      reviewedAt: null,
    });
    this.nextVersionId += 1;
    return this.clonePlugin(plugin);
  }

  async getPlugin(id: number): Promise<PluginRecord | null> {
    const plugin = this.plugins.find((p) => p.id === id);
    return plugin ? this.clonePlugin(plugin) : null;
  }

  async getPluginBySlug(slug: string): Promise<PluginRecord | null> {
    const plugin = this.plugins.find((p) => p.slug === slug);
    return plugin ? this.clonePlugin(plugin) : null;
  }

  async upsertPendingVersion(
    pluginId: number,
    input: { meta: PluginMeta; source: string; notes: string; screen: PluginScreenFlag[] },
    keep: number,
  ): Promise<PluginVersionRecord> {
    const plugin = this.plugins.find((p) => p.id === pluginId);
    if (!plugin) throw new Error(`plugin ${pluginId} does not exist`);
    const now = this.nextTime();
    let row = this.versions.find((v) => v.pluginId === pluginId && v.status === 'pending');
    if (row) {
      // Replace the pending submission in place: same version number.
      row.source = input.source;
      row.notes = input.notes;
      row.meta = { ...input.meta };
      row.screen = input.screen.map((flag) => ({ ...flag }));
      row.submittedAt = now;
    } else {
      const max = this.versions
        .filter((v) => v.pluginId === pluginId)
        .reduce((m, v) => Math.max(m, v.version), 0);
      row = {
        id: this.nextVersionId,
        pluginId,
        version: max + 1,
        source: input.source,
        notes: input.notes,
        meta: { ...input.meta },
        screen: input.screen.map((flag) => ({ ...flag })),
        status: 'pending',
        reviewNote: '',
        reviewedBy: null,
        submittedAt: now,
        reviewedAt: null,
      };
      this.nextVersionId += 1;
      this.versions.push(row);
    }
    // Prune to the newest `keep` rows by version, never the live approved one.
    const rows = this.versions
      .filter((v) => v.pluginId === pluginId)
      .sort((a, b) => b.version - a.version);
    const keptIds = new Set(rows.slice(0, keep).map((v) => v.id));
    const liveVersion = rows
      .filter((v) => v.status === 'approved')
      .reduce((m, v) => Math.max(m, v.version), -1);
    this.versions = this.versions.filter(
      (v) => v.pluginId !== pluginId || keptIds.has(v.id) || v.version === liveVersion,
    );
    return this.cloneVersion(row);
  }

  async getLiveVersion(pluginId: number): Promise<PluginVersionRecord | null> {
    const live = this.liveVersionRow(pluginId);
    return live ? this.cloneVersion(live) : null;
  }

  async getVersion(versionId: number): Promise<PluginVersionRecord | null> {
    const version = this.versions.find((v) => v.id === versionId);
    return version ? this.cloneVersion(version) : null;
  }

  async listCatalog(limit: number): Promise<CatalogRow[]> {
    this.listCatalogCalls += 1;
    const rows: CatalogRow[] = [];
    for (const plugin of this.plugins) {
      if (plugin.status !== 'listed') continue;
      const live = this.liveVersionRow(plugin.id);
      if (!live) continue;
      rows.push({
        id: plugin.id,
        slug: plugin.slug,
        name: plugin.name,
        summary: plugin.summary,
        category: plugin.category,
        authorHandle: plugin.authorHandle,
        version: live.version,
        installs: this.installs.filter((i) => i.pluginId === plugin.id).length,
        updatedAt: plugin.updatedAt,
      });
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows.slice(0, limit);
  }

  async listForAccount(accountId: number): Promise<MineRow[]> {
    return this.plugins
      .filter((p) => p.accountId === accountId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((plugin) => {
        const live = this.liveVersionRow(plugin.id);
        const latest = this.versions
          .filter((v) => v.pluginId === plugin.id)
          .sort((a, b) => b.version - a.version)[0];
        return {
          plugin: this.clonePlugin(plugin),
          liveVersion: live ? live.version : null,
          latest: latest
            ? {
                version: latest.version,
                status: latest.status,
                reviewNote: latest.reviewNote,
                submittedAt: latest.submittedAt,
              }
            : null,
        };
      });
  }

  async listInstalled(accountId: number): Promise<InstalledRow[]> {
    const rows: InstalledRow[] = [];
    for (const install of this.installs) {
      if (install.accountId !== accountId) continue;
      const plugin = this.plugins.find((p) => p.id === install.pluginId);
      if (!plugin || plugin.status !== 'listed') continue;
      const live = this.liveVersionRow(plugin.id);
      if (!live) continue;
      rows.push({
        id: plugin.id,
        slug: plugin.slug,
        name: plugin.name,
        summary: plugin.summary,
        category: plugin.category,
        version: live.version,
        enabled: install.enabled,
        source: live.source,
        updatedAt: plugin.updatedAt,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }

  async upsertInstallCapped(
    accountId: number,
    pluginId: number,
    enabled: boolean,
    cap: number,
  ): Promise<'ok' | 'cap_reached'> {
    const existing = this.installs.find(
      (i) => i.accountId === accountId && i.pluginId === pluginId,
    );
    if (existing) {
      // An existing row always updates; only a NEW install pays the cap check.
      existing.enabled = enabled;
      return 'ok';
    }
    if (this.installs.filter((i) => i.accountId === accountId).length >= cap) {
      return 'cap_reached';
    }
    this.installs.push({ accountId, pluginId, enabled, installedAt: this.nextTime() });
    return 'ok';
  }

  async setInstallEnabled(accountId: number, pluginId: number, enabled: boolean): Promise<boolean> {
    const install = this.installs.find((i) => i.accountId === accountId && i.pluginId === pluginId);
    if (!install) return false;
    install.enabled = enabled;
    return true;
  }

  async deleteInstall(accountId: number, pluginId: number): Promise<boolean> {
    const index = this.installs.findIndex(
      (i) => i.accountId === accountId && i.pluginId === pluginId,
    );
    if (index === -1) return false;
    this.installs.splice(index, 1);
    return true;
  }

  async deletePlugin(id: number, accountId: number): Promise<boolean> {
    const index = this.plugins.findIndex((p) => p.id === id && p.accountId === accountId);
    if (index === -1) return false;
    this.plugins.splice(index, 1);
    this.versions = this.versions.filter((v) => v.pluginId !== id);
    this.installs = this.installs.filter((i) => i.pluginId !== id);
    return true;
  }

  async reviewVersion(
    versionId: number,
    reviewerAccountId: number,
    action: 'approved' | 'rejected',
    note: string,
  ): Promise<PluginVersionRecord | null> {
    const version = this.versions.find((v) => v.id === versionId);
    // Only a pending row flips; a second review of the same row is a no-op null.
    if (!version || version.status !== 'pending') return null;
    version.status = action;
    version.reviewNote = note;
    version.reviewedBy = reviewerAccountId;
    version.reviewedAt = this.nextTime();
    if (action === 'approved') {
      const plugin = this.plugins.find((p) => p.id === version.pluginId);
      if (plugin) {
        plugin.name = version.meta.name;
        plugin.summary = version.meta.summary;
        plugin.description = version.meta.description;
        plugin.category = version.meta.category;
        // A never-listed plugin goes live; an operator-delisted one stays delisted.
        if (plugin.status === 'pending') plugin.status = 'listed';
        plugin.updatedAt = this.nextTime();
      }
    }
    return this.cloneVersion(version);
  }

  async setListed(pluginId: number, listed: boolean): Promise<boolean> {
    const plugin = this.plugins.find((p) => p.id === pluginId);
    if (!plugin) return false;
    if (!listed) {
      if (plugin.status === 'delisted') return false;
      plugin.status = 'delisted';
      plugin.updatedAt = this.nextTime();
      return true;
    }
    if (plugin.status !== 'delisted') return false;
    const approved = this.versions.some((v) => v.pluginId === pluginId && v.status === 'approved');
    plugin.status = approved ? 'listed' : 'pending';
    plugin.updatedAt = this.nextTime();
    return true;
  }

  async listPendingReview(): Promise<PendingReviewRow[]> {
    const rows: PendingReviewRow[] = [];
    for (const version of this.versions) {
      if (version.status !== 'pending') continue;
      const plugin = this.plugins.find((p) => p.id === version.pluginId);
      if (!plugin) continue;
      rows.push({
        versionId: version.id,
        pluginId: version.pluginId,
        slug: plugin.slug,
        accountId: plugin.accountId,
        authorHandle: plugin.authorHandle,
        version: version.version,
        meta: { ...version.meta },
        notes: version.notes,
        source: version.source,
        screen: version.screen.map((flag) => ({ ...flag })),
        submittedAt: version.submittedAt,
        isUpdate: this.versions.some(
          (v) => v.pluginId === version.pluginId && v.status === 'approved',
        ),
      });
    }
    rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    return rows;
  }

  async listAdmin(
    limit: number,
    offset: number,
  ): Promise<{
    rows: (PluginRecord & { installs: number; liveVersion: number | null })[];
    total: number;
  }> {
    const all = [...this.plugins].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      rows: all.slice(offset, offset + limit).map((plugin) => ({
        ...this.clonePlugin(plugin),
        installs: this.installs.filter((i) => i.pluginId === plugin.id).length,
        liveVersion: this.liveVersionRow(plugin.id)?.version ?? null,
      })),
      total: all.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures and helpers.
// ---------------------------------------------------------------------------

const REVIEWER_ID = 900;

// Clean plugin sources: parse as function bodies, no screen rule fires.
const SOURCE_CLEAN = "woc.on('chat', function (msg) { woc.ui.panel('greet', msg.text); });";
const SOURCE_UPDATE = "woc.on('tick', function () { woc.ui.panel('tick', 'again'); });";
const SOURCE_FLAGGED = "woc.on('tick', function () { fetch('/ping'); });";

/** A fully valid create payload; override single fields per test. */
function submission(overrides: Record<string, unknown> = {}): {
  name: unknown;
  summary: unknown;
  description: unknown;
  category: unknown;
  source: unknown;
  notes: unknown;
  authorHandle: unknown;
} {
  return {
    name: 'Combat Meter',
    summary: 'Tracks damage in real time',
    description: 'A damage meter panel for your party.',
    category: 'combat',
    source: SOURCE_CLEAN,
    notes: '',
    authorHandle: 'Maxie',
    ...overrides,
  };
}

/** A source-only update payload (omitted metadata inherits the plugin row). */
function updateBody(overrides: Record<string, unknown> = {}): {
  name: unknown;
  summary: unknown;
  description: unknown;
  category: unknown;
  source: unknown;
  notes: unknown;
} {
  return {
    name: undefined,
    summary: undefined,
    description: undefined,
    category: undefined,
    source: SOURCE_UPDATE,
    notes: undefined,
    ...overrides,
  };
}

function unwrap<T>(result: PluginsResult<T>): T {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error}`);
  return result.value;
}

async function pendingFor(db: FakePluginsDb, pluginId: number): Promise<PendingReviewRow> {
  const row = (await db.listPendingReview()).find((r) => r.pluginId === pluginId);
  if (!row) throw new Error(`no pending version for plugin ${pluginId}`);
  return row;
}

/** Approve the plugin's current pending version through the service. */
async function approvePending(
  service: PluginsService,
  db: FakePluginsDb,
  pluginId: number,
): Promise<void> {
  const pending = await pendingFor(db, pluginId);
  const reviewed = await service.review(pending.versionId, REVIEWER_ID, 'approved', '');
  if (reviewed === null || reviewed === 'invalid') throw new Error('approve failed');
}

/** Seed a listed plugin straight through the db (the first-party seed path). */
async function seedListed(
  db: FakePluginsDb,
  slug: string,
  name = 'Seed Plugin',
): Promise<PluginRecord> {
  const inserted = await db.insertPluginCapped(
    {
      accountId: null,
      slug,
      authorHandle: null,
      meta: { name, summary: 'A seeded plugin', description: '', category: 'tools' },
      source: SOURCE_CLEAN,
      notes: '',
      screen: [],
    },
    MAX_PLUGINS_PER_ACCOUNT,
  );
  if (!inserted) throw new Error('seed insert failed');
  const pending = await pendingFor(db, inserted.id);
  await db.reviewVersion(pending.versionId, REVIEWER_ID, 'approved', '');
  const listed = await db.getPlugin(inserted.id);
  if (!listed) throw new Error('seed read failed');
  return listed;
}

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** Grab a registered handler by method + path. */
function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route registered for ${method} ${path}`);
  return route.handler;
}

let db: FakePluginsDb;
let service: PluginsService;

beforeEach(() => {
  db = new FakePluginsDb();
  service = new PluginsService(db, () => 'abc123');
});

// ---------------------------------------------------------------------------
// PluginsService.createPlugin
// ---------------------------------------------------------------------------

describe('createPlugin', () => {
  it('creates a pending plugin with a name-derived slug and a pending version 1', async () => {
    const plugin = unwrap(await service.createPlugin(1, submission()));
    expect(plugin.slug).toBe('combat-meter');
    expect(plugin.status).toBe('pending');
    expect(plugin.accountId).toBe(1);
    expect(plugin.authorHandle).toBe('Maxie');
    const pending = await pendingFor(db, plugin.id);
    expect(pending.version).toBe(1);
    expect(pending.meta).toEqual({
      name: 'Combat Meter',
      summary: 'Tracks damage in real time',
      description: 'A damage meter panel for your party.',
      category: 'combat',
    });
    // Never listed before review: the catalog stays empty.
    expect(await service.catalog()).toEqual([]);
  });

  it('records screen flags on the stored version (fetch( yields a network flag)', async () => {
    const plugin = unwrap(
      await service.createPlugin(1, submission({ name: 'Net Caller', source: SOURCE_FLAGGED })),
    );
    const pending = await pendingFor(db, plugin.id);
    expect(pending.screen).toEqual([{ code: 'network', line: 1 }]);
  });

  it('rejects a malformed name with plugins.invalid_name', async () => {
    expect(await service.createPlugin(1, submission({ name: '!!!' }))).toEqual({
      ok: false,
      error: 'plugins.invalid_name',
    });
    expect(await service.createPlugin(1, submission({ name: 'ab' }))).toEqual({
      ok: false,
      error: 'plugins.invalid_name',
    });
  });

  it('rejects a profane name with plugins.name_not_allowed', async () => {
    // A shape-valid name the obscenity matcher catches (the same built-in filter
    // tests/security.test.ts exercises with 'fuuuck').
    expect(await service.createPlugin(1, submission({ name: 'Fuck Swords' }))).toEqual({
      ok: false,
      error: 'plugins.name_not_allowed',
    });
  });

  it('rejects a malformed author handle with plugins.invalid_handle', async () => {
    expect(await service.createPlugin(1, submission({ authorHandle: '???' }))).toEqual({
      ok: false,
      error: 'plugins.invalid_handle',
    });
    expect(await service.createPlugin(1, submission({ authorHandle: 42 }))).toEqual({
      ok: false,
      error: 'plugins.invalid_handle',
    });
  });

  it('rejects a summary over 140 characters with plugins.invalid_summary', async () => {
    expect(await service.createPlugin(1, submission({ summary: 'a'.repeat(141) }))).toEqual({
      ok: false,
      error: 'plugins.invalid_summary',
    });
  });

  it('rejects an unknown category with plugins.invalid_category', async () => {
    expect(await service.createPlugin(1, submission({ category: 'weapons' }))).toEqual({
      ok: false,
      error: 'plugins.invalid_category',
    });
  });

  it('rejects an empty source with plugins.invalid_source', async () => {
    expect(await service.createPlugin(1, submission({ source: '   ' }))).toEqual({
      ok: false,
      error: 'plugins.invalid_source',
    });
  });

  it('rejects a source over 128 KiB with plugins.source_too_large', async () => {
    const big = 'a'.repeat(MAX_PLUGIN_SOURCE_BYTES + 1);
    expect(await service.createPlugin(1, submission({ source: big }))).toEqual({
      ok: false,
      error: 'plugins.source_too_large',
    });
  });

  it('rejects a syntactically invalid source with plugins.source_syntax', async () => {
    expect(await service.createPlugin(1, submission({ source: 'function {' }))).toEqual({
      ok: false,
      error: 'plugins.source_syntax',
    });
  });

  it('returns plugins.limit_reached on the 9th plugin for one account (cap is 8)', async () => {
    for (let i = 0; i < MAX_PLUGINS_PER_ACCOUNT; i++) {
      unwrap(await service.createPlugin(1, submission({ name: `Meter Number ${i}` })));
    }
    expect(await service.createPlugin(1, submission({ name: 'Meter Overflow' }))).toEqual({
      ok: false,
      error: 'plugins.limit_reached',
    });
    // The cap is per account: another account still creates fine.
    expect(
      unwrap(await service.createPlugin(2, submission({ name: 'Other Account' }))).status,
    ).toBe('pending');
  });

  it('retries a slug collision once with the deterministic suffix', async () => {
    const first = unwrap(await service.createPlugin(1, submission()));
    expect(first.slug).toBe('combat-meter');
    // The second insert of the same name throws 23505 on 'combat-meter'; the
    // service retries with the injected suffix and succeeds.
    const second = unwrap(await service.createPlugin(2, submission()));
    expect(second.slug).toBe('combat-meter-abc123');
    // With a fixed suffix every retry now collides too: the loop gives up.
    expect(await service.createPlugin(3, submission())).toEqual({
      ok: false,
      error: 'plugins.slug_unavailable',
    });
  });
});

// ---------------------------------------------------------------------------
// PluginsService.submitVersion
// ---------------------------------------------------------------------------

describe('submitVersion', () => {
  it('inherits the plugin meta on a source-only update and REPLACES the pending version', async () => {
    const plugin = unwrap(await service.createPlugin(1, submission()));
    const version = unwrap(await service.submitVersion(plugin, updateBody()));
    // Version 1 was still pending: the resubmit replaced it in place.
    expect(version.version).toBe(1);
    expect(version.status).toBe('pending');
    expect(version.source).toBe(SOURCE_UPDATE);
    expect(version.meta).toEqual({
      name: 'Combat Meter',
      summary: 'Tracks damage in real time',
      description: 'A damage meter panel for your party.',
      category: 'combat',
    });
    expect(db.versionNumbersFor(plugin.id)).toEqual([1]);
  });

  it('appends version 2 once version 1 is approved', async () => {
    const plugin = unwrap(await service.createPlugin(1, submission()));
    await approvePending(service, db, plugin.id);
    const version = unwrap(await service.submitVersion(plugin, updateBody()));
    expect(version.version).toBe(2);
    expect(version.status).toBe('pending');
    expect(db.versionNumbersFor(plugin.id)).toEqual([1, 2]);
    // The live version is still the approved v1 until v2 is reviewed.
    expect((await db.getLiveVersion(plugin.id))?.version).toBe(1);
  });

  it('validates the update like a create (bad source is refused)', async () => {
    const plugin = unwrap(await service.createPlugin(1, submission()));
    expect(await service.submitVersion(plugin, updateBody({ source: 'function {' }))).toEqual({
      ok: false,
      error: 'plugins.source_syntax',
    });
  });

  it('prunes superseded versions but never the live approved one', async () => {
    const plugin = unwrap(await service.createPlugin(1, submission()));
    await approvePending(service, db, plugin.id);
    // A reject-resubmit streak long enough to overflow the keep window.
    for (let i = 0; i < PLUGIN_VERSIONS_KEPT + 1; i++) {
      const version = unwrap(await service.submitVersion(plugin, updateBody()));
      await db.reviewVersion(version.id, REVIEWER_ID, 'rejected', 'no');
    }
    const numbers = db.versionNumbersFor(plugin.id);
    // Newest PLUGIN_VERSIONS_KEPT rows survive, PLUS the approved v1 outside the
    // window; v2 (superseded, rejected) was pruned.
    expect(numbers).toHaveLength(PLUGIN_VERSIONS_KEPT + 1);
    expect(numbers[0]).toBe(1);
    expect(numbers).not.toContain(2);
    expect((await db.getLiveVersion(plugin.id))?.version).toBe(1);
    expect((await db.getLiveVersion(plugin.id))?.source).toBe(SOURCE_CLEAN);
  });
});

// ---------------------------------------------------------------------------
// PluginsService.review
// ---------------------------------------------------------------------------

describe('review', () => {
  it('approve applies the proposed meta to the plugin row and lists a pending plugin', async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    // Replace the pending v1 with new proposed metadata before review.
    unwrap(
      await service.submitVersion(
        created,
        updateBody({
          name: 'Meter Deluxe',
          summary: 'Better tracking',
          description: 'Now with charts.',
          category: 'tools',
        }),
      ),
    );
    const pending = await pendingFor(db, created.id);
    const reviewed = await service.review(pending.versionId, 42, 'approved', 'looks fine');
    expect(reviewed).toMatchObject({
      status: 'approved',
      reviewNote: 'looks fine',
      reviewedBy: 42,
    });
    const plugin = await db.getPlugin(created.id);
    expect(plugin).toMatchObject({
      name: 'Meter Deluxe',
      summary: 'Better tracking',
      description: 'Now with charts.',
      category: 'tools',
      status: 'listed',
    });
  });

  it('reject stores the review note and leaves the plugin unlisted', async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    const pending = await pendingFor(db, created.id);
    const reviewed = await service.review(pending.versionId, 42, 'rejected', 'needs work');
    expect(reviewed).toMatchObject({ status: 'rejected', reviewNote: 'needs work' });
    expect((await db.getPlugin(created.id))?.status).toBe('pending');
    expect(await service.catalog()).toEqual([]);
  });

  it('returns null for a version that is no longer pending', async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    const pending = await pendingFor(db, created.id);
    await service.review(pending.versionId, 42, 'approved', '');
    expect(await service.review(pending.versionId, 42, 'rejected', 'again')).toBeNull();
  });

  it("returns 'invalid' for a control-character note and leaves the version pending", async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    const pending = await pendingFor(db, created.id);
    expect(await service.review(pending.versionId, 42, 'approved', 'bad\u0000note')).toBe(
      'invalid',
    );
    expect((await db.getVersion(pending.versionId))?.status).toBe('pending');
  });

  it('approving a version of a DELISTED plugin never relists it', async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    expect(await service.setListed(created.id, false)).toBe(true);
    await approvePending(service, db, created.id);
    expect((await db.getPlugin(created.id))?.status).toBe('delisted');
    // Relist is the separate, deliberate action; the approved version now exists.
    expect(await service.setListed(created.id, true)).toBe(true);
    expect((await db.getPlugin(created.id))?.status).toBe('listed');
  });
});

// ---------------------------------------------------------------------------
// Delist / relist and the catalog.
// ---------------------------------------------------------------------------

describe('setListed and catalog', () => {
  it('delist hides the plugin from the catalog; relist with an approved version restores it', async () => {
    const plugin = await seedListed(db, 'kill-switch', 'Kill Switch');
    expect((await service.catalog()).map((r) => r.slug)).toEqual(['kill-switch']);
    expect(await service.setListed(plugin.id, false)).toBe(true);
    expect((await db.getPlugin(plugin.id))?.status).toBe('delisted');
    expect(await service.catalog()).toEqual([]);
    expect(await service.setListed(plugin.id, true)).toBe(true);
    expect((await db.getPlugin(plugin.id))?.status).toBe('listed');
    expect((await service.catalog()).map((r) => r.slug)).toEqual(['kill-switch']);
  });

  it('relist of a plugin with NO approved version restores pending, not listed', async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    expect(await service.setListed(created.id, false)).toBe(true);
    expect(await service.setListed(created.id, true)).toBe(true);
    expect((await db.getPlugin(created.id))?.status).toBe('pending');
  });

  it('catalog() carries only listed plugins with the live version number', async () => {
    const listed = await seedListed(db, 'listed-one', 'Listed One');
    unwrap(await service.createPlugin(1, submission({ name: 'Still Pending' })));
    // Approve a second version so the live number moves to 2.
    await db.upsertPendingVersion(
      listed.id,
      {
        meta: {
          name: listed.name,
          summary: listed.summary,
          description: listed.description,
          category: listed.category,
        },
        source: SOURCE_UPDATE,
        notes: '',
        screen: [],
      },
      PLUGIN_VERSIONS_KEPT,
    );
    await approvePending(service, db, listed.id);
    const rows = await service.catalog();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'listed-one', version: 2, installs: 0 });
  });
});

// ---------------------------------------------------------------------------
// Install flow and installed().
// ---------------------------------------------------------------------------

describe('install flow', () => {
  it('installs a listed plugin and surfaces it in installed()', async () => {
    const plugin = await seedListed(db, 'greeter', 'Greeter');
    expect(await service.install(7, plugin.id, true)).toBeNull();
    const rows = await service.installed(7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'greeter', enabled: true, version: 1 });
  });

  it('refuses to install a pending plugin with plugins.not_listed', async () => {
    const created = unwrap(await service.createPlugin(1, submission()));
    expect(await service.install(7, created.id, true)).toBe('plugins.not_listed');
  });

  it('refuses to install a missing plugin with plugins.not_found', async () => {
    expect(await service.install(7, 9999, true)).toBe('plugins.not_found');
  });

  it('returns plugins.install_limit on the 33rd install (cap is 32)', async () => {
    const ids: number[] = [];
    for (let i = 0; i < MAX_INSTALLS_PER_ACCOUNT + 1; i++) {
      ids.push((await seedListed(db, `seed-${i}`, `Seed Plugin ${i}`)).id);
    }
    for (let i = 0; i < MAX_INSTALLS_PER_ACCOUNT; i++) {
      expect(await service.install(7, ids[i], true)).toBeNull();
    }
    expect(await service.install(7, ids[MAX_INSTALLS_PER_ACCOUNT], true)).toBe(
      'plugins.install_limit',
    );
    // Re-installing an existing row is an update, never blocked by the cap.
    expect(await service.install(7, ids[0], false)).toBeNull();
  });

  it('setEnabled flips an existing install and 404s a missing one', async () => {
    const plugin = await seedListed(db, 'toggler', 'Toggler');
    expect(await service.setEnabled(7, plugin.id, false)).toBe('plugins.not_installed');
    expect(await service.install(7, plugin.id, true)).toBeNull();
    expect(await service.setEnabled(7, plugin.id, false)).toBeNull();
    expect((await service.installed(7))[0]?.enabled).toBe(false);
  });

  it('uninstall removes the install; a second uninstall is plugins.not_installed', async () => {
    const plugin = await seedListed(db, 'remover', 'Remover');
    expect(await service.install(7, plugin.id, true)).toBeNull();
    expect(await service.uninstall(7, plugin.id)).toBeNull();
    expect(await service.installed(7)).toEqual([]);
    expect(await service.uninstall(7, plugin.id)).toBe('plugins.not_installed');
  });
});

describe('installed()', () => {
  it('carries only listed plugins with an approved version', async () => {
    const kept = await seedListed(db, 'kept', 'Kept');
    const killed = await seedListed(db, 'killed', 'Killed');
    expect(await service.install(7, kept.id, true)).toBeNull();
    expect(await service.install(7, killed.id, true)).toBeNull();
    expect(await service.setListed(killed.id, false)).toBe(true);
    // The delisted plugin drops out of the boot payload even though the install
    // row still exists.
    expect((await service.installed(7)).map((r) => r.slug)).toEqual(['kept']);
  });

  it('serves the HIGHEST approved version source, ignoring newer pending rows', async () => {
    const plugin = await seedListed(db, 'versioned', 'Versioned');
    expect(await service.install(7, plugin.id, true)).toBeNull();
    expect((await service.installed(7))[0]).toMatchObject({ version: 1, source: SOURCE_CLEAN });
    // A newer PENDING version must not leak to installers.
    unwrap(await service.submitVersion(plugin, updateBody()));
    expect((await service.installed(7))[0]).toMatchObject({ version: 1, source: SOURCE_CLEAN });
    // Once approved, it becomes the live source.
    await approvePending(service, db, plugin.id);
    expect((await service.installed(7))[0]).toMatchObject({ version: 2, source: SOURCE_UPDATE });
  });
});

// ---------------------------------------------------------------------------
// Route handlers (routes + setPluginsServiceForTests + fakeCtx). Middleware
// (bearer guards, rate limiters) is deliberately NOT mounted here.
// ---------------------------------------------------------------------------

describe('plugins routes', () => {
  beforeEach(() => {
    setPluginsServiceForTests(service);
  });

  afterEach(() => {
    resetPluginsServiceForTests();
    bustPluginsCatalog();
  });

  it('GET /api/plugins serves { rows } through the single-flight TTL cache', async () => {
    await seedListed(db, 'cached-one', 'Cached One');
    const handler = handlerFor('GET', '/api/plugins');
    const first = fakeCtx({ url: '/api/plugins' });
    await handler(first);
    const { status, body } = captured(first.res);
    expect(status).toBe(200);
    const rows = (body as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: 'cached-one',
      name: 'Cached One',
      version: 1,
      installs: 0,
    });
    expect(db.listCatalogCalls).toBe(1);
    // A second read within the 30s TTL is served from cache: no new db call.
    const second = fakeCtx({ url: '/api/plugins' });
    await handler(second);
    expect(captured(second.res).status).toBe(200);
    expect(db.listCatalogCalls).toBe(1);
    // Busting the catalog (the approve/delist/relist/delete paths) refreshes.
    bustPluginsCatalog();
    const third = fakeCtx({ url: '/api/plugins' });
    await handler(third);
    expect(captured(third.res).status).toBe(200);
    expect(db.listCatalogCalls).toBe(2);
  });

  it('GET /api/plugins/:id serves the public detail including the live source', async () => {
    const plugin = await seedListed(db, 'detail-one', 'Detail One');
    const ctx = fakeCtx({ url: `/api/plugins/${plugin.id}`, params: { id: String(plugin.id) } });
    await handlerFor('GET', '/api/plugins/:id')(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect((body as { plugin: Record<string, unknown> }).plugin).toMatchObject({
      id: plugin.id,
      slug: 'detail-one',
      name: 'Detail One',
      version: 1,
      source: SOURCE_CLEAN,
    });
  });

  it('GET /api/plugins/:id throws 404 plugins.not_found for unknown and non-numeric ids', async () => {
    const handler = handlerFor('GET', '/api/plugins/:id');
    await expect(handler(fakeCtx({ params: { id: '9999' } }))).rejects.toMatchObject({
      status: 404,
      code: 'plugins.not_found',
    });
    await expect(handler(fakeCtx({ params: { id: 'abc' } }))).rejects.toMatchObject({
      status: 404,
      code: 'plugins.not_found',
    });
    // An unlisted (pending) plugin is also a public 404, not a leak.
    const created = unwrap(await service.createPlugin(1, submission()));
    await expect(handler(fakeCtx({ params: { id: String(created.id) } }))).rejects.toMatchObject({
      status: 404,
      code: 'plugins.not_found',
    });
  });

  it('POST /api/plugins creates a pending plugin for the authed account', async () => {
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/plugins',
      body: {
        name: 'Route Meter',
        summary: 'Submitted through the route',
        description: 'Handler-level create.',
        category: 'tools',
        source: SOURCE_CLEAN,
        notes: '',
        author: 'Maxie',
      },
      account: { accountId: 1, scope: 'full' },
    });
    await handlerFor('POST', '/api/plugins')(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const plugin = (body as { plugin: { id: number; slug: string; status: string } }).plugin;
    expect(plugin.slug).toBe('route-meter');
    expect(plugin.status).toBe('pending');
    expect((await db.getPlugin(plugin.id))?.accountId).toBe(1);
  });

  it('POST /api/plugins maps service errors onto HttpError codes and statuses', async () => {
    const handler = handlerFor('POST', '/api/plugins');
    const bad = fakeCtx({
      method: 'POST',
      url: '/api/plugins',
      body: { ...submission({ category: 'weapons' }), author: 'Maxie' },
      account: { accountId: 1, scope: 'full' },
    });
    await expect(handler(bad)).rejects.toMatchObject({
      status: 400,
      code: 'plugins.invalid_category',
    });
    const big = fakeCtx({
      method: 'POST',
      url: '/api/plugins',
      body: { ...submission({ source: 'a'.repeat(MAX_PLUGIN_SOURCE_BYTES + 1) }), author: 'Maxie' },
      account: { accountId: 1, scope: 'full' },
    });
    await expect(handler(big)).rejects.toMatchObject({
      status: 413,
      code: 'plugins.source_too_large',
    });
  });
});
