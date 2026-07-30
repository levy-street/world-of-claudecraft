import { describe, expect, it, vi } from 'vitest';
import { deleteUnusedFederatedProvision } from '../server/federated_auth_db';

describe('deleteUnusedFederatedProvision', () => {
  it('deletes only an unreachable password-less account and lets its seeded characters cascade', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 });

    await expect(deleteUnusedFederatedProvision({ query } as never, 7)).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/password_set\s*=\s*FALSE/i);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM auth_tokens/i);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM apple_auth_links/i);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM discord_links/i);
    expect(sql).not.toMatch(/NOT EXISTS \(SELECT 1 FROM characters/i);
    expect(sql).toMatch(/RETURNING a\.id/i);
    expect(params).toEqual([7]);
  });

  it('reports false when a token, password, or federated link makes the account reachable', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(deleteUnusedFederatedProvision({ query } as never, 9)).resolves.toBe(false);
  });
});
