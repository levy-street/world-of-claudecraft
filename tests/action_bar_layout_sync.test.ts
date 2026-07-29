import { describe, expect, it } from 'vitest';
import {
  actionBarSlotMapKey,
  applyActionBarLayout,
  captureActionBarLayout,
  planActionBarRestore,
} from '../src/ui/hud/action_bar/action_bar_layout_sync';
import { attackSlotStorageKey } from '../src/ui/hud/action_bar/hotbar';
import {
  ACTION_BAR_LAYOUT_MAX_ID_LEN,
  ACTION_BAR_LAYOUT_MAX_SLOTS,
  type ActionBarLayout,
  actionBarLayoutIsEmpty,
  sanitizeActionBarLayout,
} from '../src/world_api/action_bar';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const CLS = 'warrior';
const NAME = 'LayoutTester';

describe('sanitizeActionBarLayout (untrusted payload bounds)', () => {
  it('accepts a well-formed layout and normalizes the version', () => {
    const clean = sanitizeActionBarLayout({
      v: 99,
      forms: { normal: { bar: [{ type: 'ability', id: 'heroic_strike' }, null], attack: null } },
    });
    expect(clean).not.toBeNull();
    expect(clean?.v).toBe(1);
    expect(clean?.forms.normal?.bar).toEqual([{ type: 'ability', id: 'heroic_strike' }, null]);
    expect(clean?.forms.normal?.attack).toBeNull();
  });

  it('rejects a non-object payload without throwing', () => {
    expect(sanitizeActionBarLayout(null)).toBeNull();
    expect(sanitizeActionBarLayout(42)).toBeNull();
    expect(sanitizeActionBarLayout('garbage')).toBeNull();
    expect(sanitizeActionBarLayout([])).toBeNull();
    expect(sanitizeActionBarLayout({ v: 1 })).toBeNull(); // no forms object
  });

  it('rejects a bar longer than the slot cap (oversized, not truncated)', () => {
    const bar = Array.from({ length: ACTION_BAR_LAYOUT_MAX_SLOTS + 1 }, () => null);
    expect(sanitizeActionBarLayout({ v: 1, forms: { normal: { bar } } })).toBeNull();
  });

  it('rejects an over-long ability id by nulling the slot, not the payload', () => {
    const id = 'x'.repeat(ACTION_BAR_LAYOUT_MAX_ID_LEN + 1);
    const clean = sanitizeActionBarLayout({
      v: 1,
      forms: { normal: { bar: [{ type: 'ability', id }] } },
    });
    expect(clean?.forms.normal?.bar).toEqual([null]);
  });

  it('drops unknown form keys but keeps the payload', () => {
    const clean = sanitizeActionBarLayout({
      v: 1,
      forms: { normal: { bar: [] }, wat: { bar: [] }, __proto__: { bar: [] } },
    });
    expect(clean).not.toBeNull();
    expect(Object.keys(clean?.forms ?? {})).toEqual(['normal']);
  });

  it('rejects a payload with an abusive number of form keys', () => {
    const forms: Record<string, unknown> = {};
    for (let i = 0; i < 64; i++) forms[`junk${i}`] = { bar: [] };
    expect(sanitizeActionBarLayout({ v: 1, forms })).toBeNull();
  });

  it('nulls a garbage slot entry instead of rejecting the whole bar', () => {
    const clean = sanitizeActionBarLayout({
      v: 1,
      forms: {
        normal: { bar: [{ type: 'nope', id: 'x' }, { id: 5 }, 'string', { type: 'item' }] },
      },
    });
    expect(clean?.forms.normal?.bar).toEqual([null, null, null, null]);
  });

  it('reports emptiness', () => {
    expect(actionBarLayoutIsEmpty({ v: 1, forms: {} })).toBe(true);
    expect(actionBarLayoutIsEmpty({ v: 1, forms: { normal: { bar: [] } } })).toBe(false);
  });
});

describe('capture/apply round trip', () => {
  it('captures every stored form bar plus its attack binding', () => {
    const storage = new MemoryStorage();
    const normalKey = actionBarSlotMapKey(CLS, NAME, 'normal');
    const bearKey = actionBarSlotMapKey(CLS, NAME, 'bear');
    storage.setItem(normalKey, JSON.stringify([{ type: 'ability', id: 'heroic_strike' }, null]));
    storage.setItem(
      attackSlotStorageKey(normalKey),
      JSON.stringify({ type: 'item', id: 'potion' }),
    );
    storage.setItem(bearKey, JSON.stringify([{ type: 'ability', id: 'maul' }]));

    const layout = captureActionBarLayout(storage, CLS, NAME);
    expect(layout.forms.normal?.bar).toEqual([{ type: 'ability', id: 'heroic_strike' }, null]);
    expect(layout.forms.normal?.attack).toEqual({ type: 'item', id: 'potion' });
    expect(layout.forms.bear?.bar).toEqual([{ type: 'ability', id: 'maul' }]);
    // A form with no stored key is absent (leave-alone semantics).
    expect(layout.forms.cat).toBeUndefined();
  });

  it('applies a server layout onto a different device, overwriting the mirror and setting seed markers', () => {
    const storage = new MemoryStorage();
    const layout: ActionBarLayout = {
      v: 1,
      forms: {
        normal: {
          bar: [{ type: 'ability', id: 'mortal_strike' }],
          attack: { type: 'item', id: 'potion' },
        },
      },
    };
    applyActionBarLayout(storage, CLS, NAME, layout);
    const key = actionBarSlotMapKey(CLS, NAME, 'normal');
    expect(JSON.parse(storage.getItem(key) ?? 'null')).toEqual([
      { type: 'ability', id: 'mortal_strike' },
    ]);
    expect(JSON.parse(storage.getItem(attackSlotStorageKey(key)) ?? 'null')).toEqual({
      type: 'item',
      id: 'potion',
    });
    expect(storage.getItem(`${key}_seeded`)).toBe('1');
    expect(storage.getItem(`${key}_blank_v1`)).toBe('1');
  });

  it('is a faithful round trip: capture(apply(L)) preserves the forms in L', () => {
    const storage = new MemoryStorage();
    const layout: ActionBarLayout = {
      v: 1,
      forms: {
        normal: { bar: [{ type: 'ability', id: 'a' }, null, { type: 'item', id: 'b' }] },
        stealth: { bar: [{ type: 'ability', id: 'ambush' }], attack: null },
      },
    };
    applyActionBarLayout(storage, CLS, NAME, layout);
    const captured = captureActionBarLayout(storage, CLS, NAME);
    expect(captured.forms.normal?.bar).toEqual(layout.forms.normal?.bar);
    expect(captured.forms.stealth?.bar).toEqual(layout.forms.stealth?.bar);
  });

  it('leaves an absent form untouched on the device (version-tolerant)', () => {
    const storage = new MemoryStorage();
    const catKey = actionBarSlotMapKey(CLS, NAME, 'cat');
    storage.setItem(catKey, JSON.stringify([{ type: 'ability', id: 'shred' }]));
    // A server layout that only knows about the normal bar must not clear cat.
    applyActionBarLayout(storage, CLS, NAME, {
      v: 1,
      forms: { normal: { bar: [{ type: 'ability', id: 'wrath' }] } },
    });
    expect(JSON.parse(storage.getItem(catKey) ?? 'null')).toEqual([
      { type: 'ability', id: 'shred' },
    ]);
  });
});

describe('planActionBarRestore (the locked merge rule)', () => {
  const local: ActionBarLayout = {
    v: 1,
    forms: { normal: { bar: [{ type: 'ability', id: 'x' }] } },
  };
  const server: ActionBarLayout = {
    v: 1,
    forms: { normal: { bar: [{ type: 'ability', id: 'srv' }] } },
  };

  it('server copy present WINS over local', () => {
    const plan = planActionBarRestore({ source: 'server', layout: server }, () => local);
    expect(plan).toEqual({ action: 'apply-server', layout: server });
  });

  it('server copy absent seeds from a non-empty local layout', () => {
    const plan = planActionBarRestore({ source: 'seed' }, () => local);
    expect(plan).toEqual({ action: 'seed-local', layout: local });
  });

  it('both absent seeds nothing (defaults stand)', () => {
    const plan = planActionBarRestore({ source: 'seed' }, () => ({ v: 1, forms: {} }));
    expect(plan).toEqual({ action: 'none' });
  });

  it('noop / undefined restore does nothing (offline, reconnect)', () => {
    expect(planActionBarRestore({ source: 'noop' }, () => local)).toEqual({ action: 'none' });
    expect(planActionBarRestore(undefined, () => local)).toEqual({ action: 'none' });
  });
});
