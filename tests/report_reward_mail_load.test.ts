import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustodyParcelBook } from '../server/mail_custody_overlay';

const ports = vi.hoisted(() => ({ load: vi.fn(), merge: vi.fn() }));
vi.mock('../server/db', () => ({ loadMailState: ports.load }));
vi.mock('../server/mail_custody_overlay', () => ({ mergeCustodyParcelOverlay: ports.merge }));

import { loadRealmMail } from '../server/mail_load';

describe('report reward mail readiness', () => {
  beforeEach(() => vi.resetAllMocks());

  it('allows delivery only after the saved book loads and custody replay succeeds', async () => {
    const order: string[] = [];
    const save = { marker: 'saved mail' };
    ports.load.mockResolvedValue(save);
    const loadMail = vi.fn(() => order.push('load'));
    const book = { loadMail } as unknown as CustodyParcelBook & { loadMail: typeof loadMail };
    ports.merge.mockImplementation(async (actual) => {
      expect(actual).toBe(book);
      order.push('replay');
      return { ok: true };
    });
    expect(await loadRealmMail(book)).toBe(true);
    expect(loadMail).toHaveBeenCalledWith(save);
    expect(order).toEqual(['load', 'replay']);
  });

  it('refuses delivery and does not replay custody against a failed partition load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    ports.load.mockRejectedValue(new Error('database unavailable'));
    const loadMail = vi.fn();
    try {
      expect(
        await loadRealmMail({ loadMail } as unknown as CustodyParcelBook & {
          loadMail: typeof loadMail;
        }),
      ).toBe(false);
      expect(loadMail).not.toHaveBeenCalled();
      expect(ports.merge).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('refuses delivery when custody replay cannot establish durable mail truth', async () => {
    ports.load.mockResolvedValue(null);
    ports.merge.mockResolvedValue({ ok: false });
    const loadMail = vi.fn();
    expect(
      await loadRealmMail({ loadMail } as unknown as CustodyParcelBook & {
        loadMail: typeof loadMail;
      }),
    ).toBe(false);
    expect(loadMail).toHaveBeenCalledWith(null);
  });
});
