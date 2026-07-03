import { beforeEach, describe, expect, it, vi } from 'vitest';

// Guards that ensureSchema() actually APPLIES every schema module, not just the
// core one. The Discord integration wiring regressed once (DISCORD_SCHEMA was
// defined but never run, so its tables were never created at boot and every
// Discord query would throw "relation does not exist"); this pins it. Mock pg so
// ensureSchema runs against a recording client with no live database.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  const calls: string[] = [];
  const query = vi.fn((sql: string) => {
    calls.push(String(sql));
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { calls, query, connect: vi.fn(() => Promise.resolve({ query, release: vi.fn() })) };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: h.query, connect: h.connect };
  }),
}));

import { ensureSchema } from '../server/db';

describe('ensureSchema wires every schema module at boot', () => {
  beforeEach(() => {
    h.calls.length = 0;
  });

  it('applies the Discord schema so its tables exist before the feature is enabled', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    // The whole Discord integration (login/link, rewards, and the new first-time
    // chooser) depends on these being created at boot.
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS discord_links');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS discord_oauth_states');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS discord_pending_logins');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS reward_points');
    // The captured Discord email column (recovery-email capture) must be added at boot,
    // on both the durable link and the first-time pending-login rows.
    expect(applied).toContain('ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS discord_email');
    expect(applied).toContain(
      'ALTER TABLE discord_pending_logins ADD COLUMN IF NOT EXISTS discord_email',
    );
  });

  it('still applies the core schema (accounts) under the advisory lock', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('pg_advisory_xact_lock');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS accounts');
    // password_set is the column the unlink guard reads; it must be added at boot.
    expect(applied).toContain('password_set');
  });
});
