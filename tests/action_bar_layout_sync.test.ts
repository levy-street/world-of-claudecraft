import { describe, expect, it } from 'vitest';
import {
  actionBarLayoutProfileForSurface,
  actionBarSlotMapKey,
  applyActionBarLayout,
  captureActionBarLayout,
  planActionBarRestore,
} from '../src/ui/hud/action_bar/action_bar_layout_sync';
import { attackSlotStorageKey } from '../src/ui/hud/action_bar/hotbar';
import {
  ACTION_BAR_LAYOUT_MAX_ID_LEN,
  ACTION_BAR_LAYOUT_MAX_PROFILE_KEYS,
  ACTION_BAR_LAYOUT_MAX_SLOTS,
  ACTION_BAR_LAYOUT_PROFILES,
  type ActionBarLayout,
  type ActionBarLayoutProfile,
  type ActionBarLayoutProfiles,
  actionBarLayoutIsEmpty,
  actionBarLayoutWire,
  resolveActionBarLayoutProfile,
  sanitizeActionBarLayout,
  sanitizeActionBarLayoutProfile,
  sanitizeActionBarLayoutProfiles,
  withActionBarLayoutProfile,
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

function layoutOf(id: string): ActionBarLayout {
  return { v: 1, forms: { normal: { bar: [{ type: 'ability', id }] } } };
}

const EMPTY: ActionBarLayout = { v: 1, forms: {} };

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

describe('sanitizeActionBarLayoutProfiles (the stored per-surface document)', () => {
  it('reads a v1 layout at rest as the desktop profile', () => {
    const doc = sanitizeActionBarLayoutProfiles(layoutOf('heroic_strike'));
    expect(doc).toEqual({ v: 2, profiles: { desktop: layoutOf('heroic_strike') } });
  });

  it('keeps every known profile of a v2 document and normalizes the version', () => {
    const doc = sanitizeActionBarLayoutProfiles({
      v: 7,
      profiles: { desktop: layoutOf('a'), touch: layoutOf('b'), gamepad: layoutOf('c') },
    });
    expect(doc?.v).toBe(2);
    expect(doc?.profiles).toEqual({
      desktop: layoutOf('a'),
      touch: layoutOf('b'),
      gamepad: layoutOf('c'),
    });
  });

  it('prefers `profiles` over the `forms` mirror on the wire view', () => {
    const wire = actionBarLayoutWire({
      v: 2,
      profiles: { desktop: layoutOf('a'), touch: layoutOf('b') },
    });
    expect(wire.forms).toEqual(layoutOf('a').forms);
    expect(sanitizeActionBarLayoutProfiles(wire)?.profiles.touch).toEqual(layoutOf('b'));
    // A pre-profile bundle reads the same wire value as the desktop layout.
    expect(sanitizeActionBarLayout(wire)?.forms).toEqual(layoutOf('a').forms);
  });

  it('wires an empty forms mirror when the document has no desktop profile', () => {
    const wire = actionBarLayoutWire({ v: 2, profiles: { touch: layoutOf('b') } });
    expect(wire.forms).toEqual({});
    expect(wire.profiles.touch).toEqual(layoutOf('b'));
  });

  it('drops unknown profile keys and a garbage profile, keeping the well-formed rest', () => {
    expect(
      sanitizeActionBarLayoutProfiles({
        v: 2,
        profiles: { desktop: layoutOf('a'), vr: layoutOf('x') },
      })?.profiles,
    ).toEqual({ desktop: layoutOf('a') });
    // A corrupt row at rest loses only the corrupt surface, never the others.
    expect(
      sanitizeActionBarLayoutProfiles({
        v: 2,
        profiles: { desktop: layoutOf('a'), touch: 'nope' },
      })?.profiles,
    ).toEqual({ desktop: layoutOf('a') });
    expect(
      sanitizeActionBarLayoutProfiles({ v: 2, profiles: { touch: { v: 1, forms: 'nope' } } }),
    ).toEqual({ v: 2, profiles: {} });
  });

  it('rejects malformed documents and an abusive number of profile keys', () => {
    expect(sanitizeActionBarLayoutProfiles(null)).toBeNull();
    expect(sanitizeActionBarLayoutProfiles({ v: 2, profiles: [] })).toBeNull();
    expect(sanitizeActionBarLayoutProfiles({ v: 2 })).toBeNull(); // neither profiles nor forms
    const profiles: Record<string, unknown> = {};
    for (let i = 0; i <= ACTION_BAR_LAYOUT_MAX_PROFILE_KEYS; i++) profiles[`p${i}`] = layoutOf('a');
    expect(sanitizeActionBarLayoutProfiles({ v: 2, profiles })).toBeNull();
  });

  it('accepts only the known profile names', () => {
    for (const profile of ACTION_BAR_LAYOUT_PROFILES) {
      expect(sanitizeActionBarLayoutProfile(profile)).toBe(profile);
    }
    expect(sanitizeActionBarLayoutProfile('vr')).toBeNull();
    expect(sanitizeActionBarLayoutProfile(1)).toBeNull();
    expect(sanitizeActionBarLayoutProfile(undefined)).toBeNull();
  });

  it('withActionBarLayoutProfile replaces one profile and leaves the rest untouched', () => {
    const base: ActionBarLayoutProfiles = { v: 2, profiles: { desktop: layoutOf('a') } };
    const next = withActionBarLayoutProfile(base, 'touch', layoutOf('b'));
    expect(next.profiles).toEqual({ desktop: layoutOf('a'), touch: layoutOf('b') });
    // Immutable: the input document is not mutated.
    expect(base.profiles).toEqual({ desktop: layoutOf('a') });
    expect(withActionBarLayoutProfile(null, 'gamepad', layoutOf('c')).profiles).toEqual({
      gamepad: layoutOf('c'),
    });
    expect(withActionBarLayoutProfile(next, 'desktop', layoutOf('z')).profiles.desktop).toEqual(
      layoutOf('z'),
    );
  });

  it('resolveActionBarLayoutProfile: own copy wins, else the first non-empty fallback', () => {
    const doc: ActionBarLayoutProfiles = {
      v: 2,
      profiles: { desktop: layoutOf('d'), touch: EMPTY },
    };
    expect(resolveActionBarLayoutProfile(doc, 'desktop')).toEqual({
      profile: 'desktop',
      layout: layoutOf('d'),
    });
    // A present-but-empty own copy still wins (the surface chose to be empty).
    expect(resolveActionBarLayoutProfile(doc, 'touch')).toEqual({
      profile: 'touch',
      layout: EMPTY,
    });
    // No gamepad copy: desktop seeds it; the empty touch copy is skipped.
    expect(resolveActionBarLayoutProfile(doc, 'gamepad')).toEqual({
      profile: 'desktop',
      layout: layoutOf('d'),
    });
    expect(
      resolveActionBarLayoutProfile({ v: 2, profiles: { touch: layoutOf('t') } }, 'gamepad'),
    ).toEqual({ profile: 'touch', layout: layoutOf('t') });
    expect(resolveActionBarLayoutProfile({ v: 2, profiles: {} }, 'touch')).toBeNull();
    expect(
      resolveActionBarLayoutProfile({ v: 2, profiles: { desktop: EMPTY } }, 'touch'),
    ).toBeNull();
  });
});

describe('the per-profile localStorage key scheme', () => {
  it('keeps the legacy unsuffixed keys for the desktop profile', () => {
    expect(actionBarSlotMapKey(CLS, NAME, 'desktop', 'normal')).toBe(
      'woc_hotbar_warrior_LayoutTester',
    );
    expect(actionBarSlotMapKey(CLS, NAME, 'desktop', 'bear')).toBe(
      'woc_hotbar_warrior_LayoutTester_bear',
    );
  });

  it('suffixes the profile ahead of the form for every other profile', () => {
    expect(actionBarSlotMapKey(CLS, NAME, 'touch', 'normal')).toBe(
      'woc_hotbar_warrior_LayoutTester_touch',
    );
    expect(actionBarSlotMapKey(CLS, NAME, 'touch', 'stealth')).toBe(
      'woc_hotbar_warrior_LayoutTester_touch_stealth',
    );
    expect(actionBarSlotMapKey(CLS, NAME, 'gamepad', 'cat')).toBe(
      'woc_hotbar_warrior_LayoutTester_gamepad_cat',
    );
  });

  it('resolves the touch interface to the touch profile and everything else to desktop', () => {
    expect(actionBarLayoutProfileForSurface(true)).toBe('touch');
    expect(actionBarLayoutProfileForSurface(false)).toBe('desktop');
  });
});

describe('capture/apply round trip', () => {
  it('captures every stored form bar plus its attack binding', () => {
    const storage = new MemoryStorage();
    const normalKey = actionBarSlotMapKey(CLS, NAME, 'desktop', 'normal');
    const bearKey = actionBarSlotMapKey(CLS, NAME, 'desktop', 'bear');
    storage.setItem(normalKey, JSON.stringify([{ type: 'ability', id: 'heroic_strike' }, null]));
    storage.setItem(
      attackSlotStorageKey(normalKey),
      JSON.stringify({ type: 'item', id: 'potion' }),
    );
    storage.setItem(bearKey, JSON.stringify([{ type: 'ability', id: 'maul' }]));

    const layout = captureActionBarLayout(storage, CLS, NAME, 'desktop');
    expect(layout.forms.normal?.bar).toEqual([{ type: 'ability', id: 'heroic_strike' }, null]);
    expect(layout.forms.normal?.attack).toEqual({ type: 'item', id: 'potion' });
    expect(layout.forms.bear?.bar).toEqual([{ type: 'ability', id: 'maul' }]);
    // A form with no stored key is absent (leave-alone semantics).
    expect(layout.forms.cat).toBeUndefined();
  });

  it('captures each profile from its own keys only', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      actionBarSlotMapKey(CLS, NAME, 'desktop', 'normal'),
      JSON.stringify([{ type: 'ability', id: 'heroic_strike' }]),
    );
    storage.setItem(
      actionBarSlotMapKey(CLS, NAME, 'touch', 'normal'),
      JSON.stringify([{ type: 'ability', id: 'sunder_armor' }]),
    );
    expect(captureActionBarLayout(storage, CLS, NAME, 'desktop').forms.normal?.bar).toEqual([
      { type: 'ability', id: 'heroic_strike' },
    ]);
    expect(captureActionBarLayout(storage, CLS, NAME, 'touch').forms.normal?.bar).toEqual([
      { type: 'ability', id: 'sunder_armor' },
    ]);
    expect(actionBarLayoutIsEmpty(captureActionBarLayout(storage, CLS, NAME, 'gamepad'))).toBe(
      true,
    );
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
    applyActionBarLayout(storage, CLS, NAME, 'desktop', layout);
    const key = actionBarSlotMapKey(CLS, NAME, 'desktop', 'normal');
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

  it('applies into the named profile keys and leaves the other profiles alone', () => {
    const storage = new MemoryStorage();
    const desktopKey = actionBarSlotMapKey(CLS, NAME, 'desktop', 'normal');
    storage.setItem(desktopKey, JSON.stringify([{ type: 'ability', id: 'heroic_strike' }]));
    applyActionBarLayout(storage, CLS, NAME, 'touch', layoutOf('sunder_armor'));
    expect(JSON.parse(storage.getItem(desktopKey) ?? 'null')).toEqual([
      { type: 'ability', id: 'heroic_strike' },
    ]);
    const touchKey = actionBarSlotMapKey(CLS, NAME, 'touch', 'normal');
    expect(JSON.parse(storage.getItem(touchKey) ?? 'null')).toEqual([
      { type: 'ability', id: 'sunder_armor' },
    ]);
    expect(storage.getItem(`${touchKey}_seeded`)).toBe('1');
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
    applyActionBarLayout(storage, CLS, NAME, 'touch', layout);
    const captured = captureActionBarLayout(storage, CLS, NAME, 'touch');
    expect(captured.forms.normal?.bar).toEqual(layout.forms.normal?.bar);
    expect(captured.forms.stealth?.bar).toEqual(layout.forms.stealth?.bar);
  });

  it('leaves an absent form untouched on the device (version-tolerant)', () => {
    const storage = new MemoryStorage();
    const catKey = actionBarSlotMapKey(CLS, NAME, 'desktop', 'cat');
    storage.setItem(catKey, JSON.stringify([{ type: 'ability', id: 'shred' }]));
    // A server layout that only knows about the normal bar must not clear cat.
    applyActionBarLayout(storage, CLS, NAME, 'desktop', {
      v: 1,
      forms: { normal: { bar: [{ type: 'ability', id: 'wrath' }] } },
    });
    expect(JSON.parse(storage.getItem(catKey) ?? 'null')).toEqual([
      { type: 'ability', id: 'shred' },
    ]);
  });
});

describe('planActionBarRestore (the locked merge rule)', () => {
  const local = layoutOf('x');
  const server = layoutOf('srv');
  const withDesktop: ActionBarLayoutProfiles = { v: 2, profiles: { desktop: server } };
  const withBoth: ActionBarLayoutProfiles = {
    v: 2,
    profiles: { desktop: server, touch: layoutOf('touch-srv') },
  };
  const localOnly =
    (layouts: Partial<Record<ActionBarLayoutProfile, ActionBarLayout>>) =>
    (profile: ActionBarLayoutProfile): ActionBarLayout =>
      layouts[profile] ?? EMPTY;

  it('the server copy of the same profile WINS over local', () => {
    const plan = planActionBarRestore(
      { source: 'server', profiles: withBoth },
      'touch',
      () => local,
    );
    expect(plan).toEqual({ action: 'apply-server', layout: layoutOf('touch-srv') });
    const desktop = planActionBarRestore(
      { source: 'server', profiles: withBoth },
      'desktop',
      () => local,
    );
    expect(desktop).toEqual({ action: 'apply-server', layout: server });
  });

  it('a surface with no server copy seeds locally from the desktop profile, not uploaded', () => {
    const plan = planActionBarRestore(
      { source: 'server', profiles: withDesktop },
      'touch',
      () => local,
    );
    expect(plan).toEqual({ action: 'seed-profile', layout: server, upload: false });
  });

  it('a server document with nothing usable behaves like no copy at all', () => {
    const emptyDoc: ActionBarLayoutProfiles = { v: 2, profiles: {} };
    expect(
      planActionBarRestore({ source: 'server', profiles: emptyDoc }, 'touch', () => local),
    ).toEqual({ action: 'seed-local', layout: local });
    expect(
      planActionBarRestore({ source: 'server', profiles: emptyDoc }, 'desktop', () => EMPTY),
    ).toEqual({ action: 'none' });
  });

  it('server copy absent seeds from a non-empty local layout of the same profile', () => {
    const plan = planActionBarRestore({ source: 'seed' }, 'desktop', () => local);
    expect(plan).toEqual({ action: 'seed-local', layout: local });
    const touch = planActionBarRestore(
      { source: 'seed' },
      'touch',
      localOnly({ touch: local, desktop: layoutOf('legacy') }),
    );
    expect(touch).toEqual({ action: 'seed-local', layout: local });
  });

  it('a non-desktop profile with nothing anywhere inherits the legacy desktop keys', () => {
    const legacy = layoutOf('legacy');
    // The server holds nothing: the inherited bar also becomes the first
    // server copy, so a touch-only player is backed up without an edit.
    expect(
      planActionBarRestore({ source: 'seed' }, 'touch', localOnly({ desktop: legacy })),
    ).toEqual({ action: 'seed-profile', layout: legacy, upload: true });
    expect(
      planActionBarRestore(
        { source: 'server', profiles: { v: 2, profiles: {} } },
        'touch',
        localOnly({ desktop: legacy }),
      ),
    ).toEqual({ action: 'seed-profile', layout: legacy, upload: true });
    // Offline / reconnect: local only, never an upload.
    expect(
      planActionBarRestore({ source: 'noop' }, 'touch', localOnly({ desktop: legacy })),
    ).toEqual({ action: 'seed-profile', layout: legacy, upload: false });
    expect(
      planActionBarRestore({ source: 'noop' }, 'gamepad', localOnly({ desktop: legacy })),
    ).toEqual({ action: 'seed-profile', layout: legacy, upload: false });
  });

  it('both absent seeds nothing (defaults stand)', () => {
    expect(planActionBarRestore({ source: 'seed' }, 'desktop', () => EMPTY)).toEqual({
      action: 'none',
    });
    expect(planActionBarRestore({ source: 'seed' }, 'touch', () => EMPTY)).toEqual({
      action: 'none',
    });
  });

  it('noop / undefined restore keeps a populated mirror authoritative (offline, reconnect)', () => {
    expect(planActionBarRestore({ source: 'noop' }, 'desktop', () => local)).toEqual({
      action: 'none',
    });
    expect(planActionBarRestore(undefined, 'desktop', () => local)).toEqual({ action: 'none' });
    // A touch mirror that already holds its own copy never re-inherits desktop.
    expect(
      planActionBarRestore(
        { source: 'noop' },
        'touch',
        localOnly({ touch: local, desktop: layoutOf('legacy') }),
      ),
    ).toEqual({ action: 'none' });
    expect(planActionBarRestore(undefined, 'touch', localOnly({ touch: local }))).toEqual({
      action: 'none',
    });
  });
});
