import { describe, expect, it } from 'vitest';
import { MOBILE_HUD_GEOMETRY_MATRIX } from '../src/ui/mobile_hud_context';
import {
  decodeMobileHudLayoutV1,
  encodeMobileHudLayoutV1,
  LocalMobileHudLayoutStorage,
  loadMobileHudLayout,
  saveMobileHudLayout,
} from '../src/ui/mobile_hud_layout_store';
import { buildMobileHudRegistry, MOBILE_HUD_REGISTRY } from '../src/ui/mobile_hud_registry';

describe('mobile HUD layout version 1 codec', () => {
  it('rejects malformed JSON, invalid roots, unsupported versions, and non-boolean enabled', () => {
    expect(decodeMobileHudLayoutV1('{', MOBILE_HUD_REGISTRY)).toMatchObject({
      ok: false,
      reason: 'malformed-json',
    });
    expect(decodeMobileHudLayoutV1('[]', MOBILE_HUD_REGISTRY)).toMatchObject({
      ok: false,
      reason: 'invalid-root',
    });
    expect(
      decodeMobileHudLayoutV1(
        JSON.stringify({ schemaVersion: 2, enabled: true, profiles: {} }),
        MOBILE_HUD_REGISTRY,
      ),
    ).toMatchObject({ ok: false, reason: 'unsupported-version' });
    expect(
      decodeMobileHudLayoutV1(
        JSON.stringify({ schemaVersion: 1, enabled: 'yes', profiles: {} }),
        MOBILE_HUD_REGISTRY,
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-root' });
  });

  it('drops one invalid placement while recovering valid siblings', () => {
    const decoded = decodeMobileHudLayoutV1(
      JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        profiles: {
          phone: {
            'action.a1': { anchor: 'bottom-right', offsetX: -10, offsetY: -20, scale: 1 },
            'action.a2': { anchor: 'bottom-right', offsetX: -70, offsetY: -20, scale: 'large' },
          },
        },
      }),
      MOBILE_HUD_REGISTRY,
    );
    expect(decoded).toMatchObject({
      ok: true,
      document: {
        enabled: true,
        profiles: {
          phone: {
            'action.a1': { anchor: 'bottom-right', offsetX: -10, offsetY: -20, scale: 1 },
          },
        },
      },
      droppedPlacementIds: ['phone/action.a2'],
    });
  });

  it('ignores unknown and protected IDs instead of retaining unowned data', () => {
    const decoded = decodeMobileHudLayoutV1(
      JSON.stringify({
        schemaVersion: 1,
        enabled: false,
        profiles: {
          phone: {
            'future.surface': { anchor: 'center', offsetX: 0, offsetY: 0, scale: 1 },
            'protected.system.center_message': {
              anchor: 'center',
              offsetX: 0,
              offsetY: 0,
              scale: 1,
            },
          },
        },
      }),
      MOBILE_HUD_REGISTRY,
    );
    expect(decoded).toMatchObject({
      ok: true,
      document: { enabled: false, profiles: { phone: {} } },
      ignoredSurfaceIds: ['phone/future.surface', 'phone/protected.system.center_message'],
    });
  });

  it('serializes profiles, IDs, and placement fields deterministically', () => {
    const first = encodeMobileHudLayoutV1(
      {
        schemaVersion: 1,
        enabled: false,
        profiles: {
          tablet: {
            'action.a2': { scale: 1, offsetY: 2, anchor: 'top-left', offsetX: 1 },
          },
          phone: {
            'action.a1': { scale: 1.2, offsetY: 4, anchor: 'center', offsetX: 3 },
          },
        },
      },
      MOBILE_HUD_REGISTRY,
    );
    const second = encodeMobileHudLayoutV1(
      {
        profiles: {
          phone: {
            'action.a1': { anchor: 'center', offsetX: 3, offsetY: 4, scale: 1.2 },
          },
          tablet: {
            'action.a2': { anchor: 'top-left', offsetX: 1, offsetY: 2, scale: 1 },
          },
        },
        enabled: false,
        schemaVersion: 1,
      },
      MOBILE_HUD_REGISTRY,
    );
    expect(first).toBe(second);
    expect(JSON.parse(first).enabled).toBe(false);
    expect(first.indexOf('phone')).toBeLessThan(first.indexOf('tablet'));
    expect(first.indexOf('anchor')).toBeLessThan(first.indexOf('offsetX'));
  });
});

describe('LocalMobileHudLayoutStorage', () => {
  it('implements the async adapter contract with the versioned key', async () => {
    const values = new Map<string, string>([
      ['woc_mobile_hud_layout_v1_defaults_2', 'stale-layout'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const adapter = new LocalMobileHudLayoutStorage(storage);
    expect(await adapter.load()).toBeNull();
    await adapter.save('serialized-layout');
    expect(values.get('woc_mobile_hud_layout_v1_defaults_3')).toBe('serialized-layout');
    expect(await adapter.load()).toBe('serialized-layout');
  });
});

describe('validated mobile HUD layout loading', () => {
  const descriptor = (id: 'action.a1' | 'action.a2') => {
    const value = MOBILE_HUD_REGISTRY.getDescriptor(id);
    if (!value) throw new Error(`missing store test descriptor: ${id}`);
    return { ...value, visibleIn: ['world.base'] as const, validateIn: ['world.base'] as const };
  };
  const defaults = {
    phone: {
      'action.a1': { anchor: 'top-left' as const, offsetX: 20, offsetY: 20, scale: 1 },
      'action.a2': { anchor: 'top-left' as const, offsetX: 100, offsetY: 20, scale: 1 },
    },
    tablet: {
      'action.a1': { anchor: 'top-left' as const, offsetX: 30, offsetY: 30, scale: 1 },
      'action.a2': { anchor: 'top-left' as const, offsetX: 120, offsetY: 30, scale: 1 },
    },
  };
  const registry = buildMobileHudRegistry({
    descriptors: [descriptor('action.a1'), descriptor('action.a2')],
    defaults,
  });
  const matrix = MOBILE_HUD_GEOMETRY_MATRIX.filter(
    (entry) =>
      entry.context.id === 'world.base' &&
      entry.sideInset.id === 'side-none' &&
      entry.bottomInset.id === 'bottom-0' &&
      (entry.viewport.id === 'phone-740x360' || entry.viewport.id === 'tablet-1024x768'),
  );

  it('falls back one invalid profile without replacing its valid sibling', async () => {
    const serialized = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      profiles: {
        phone: {
          'action.a1': { anchor: 'top-left', offsetX: 720, offsetY: 20, scale: 0.45 },
        },
        tablet: {
          'action.a1': { anchor: 'top-left', offsetX: 300, offsetY: 30, scale: 1 },
        },
      },
    });
    const result = await loadMobileHudLayout({
      storage: { load: async () => serialized, save: async () => undefined },
      registry,
      matrix,
    });
    expect(result.profileFallbacks).toEqual(['phone']);
    expect(result.document.profiles.phone).toEqual(defaults.phone);
    expect(result.document.profiles.tablet?.['action.a1']).toMatchObject({ offsetX: 300 });
    expect(result.document.enabled).toBe(true);
  });

  it('loads a stored profile whose button overlaps the expanded Consumables tray', async () => {
    const phoneMatrix = MOBILE_HUD_GEOMETRY_MATRIX.filter(
      (entry) =>
        entry.viewport.id === 'phone-740x360' &&
        entry.context.id === 'world.base' &&
        entry.sideInset.id === 'side-none' &&
        entry.bottomInset.id === 'bottom-0',
    );
    const serialized = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      profiles: {
        phone: {
          ...MOBILE_HUD_REGISTRY.defaults.phone,
          'action.a1': { anchor: 'top-left', offsetX: 60, offsetY: 20, scale: 1 },
        },
        tablet: MOBILE_HUD_REGISTRY.defaults.tablet,
      },
    });

    const result = await loadMobileHudLayout({
      storage: { load: async () => serialized, save: async () => undefined },
      registry: MOBILE_HUD_REGISTRY,
      matrix: phoneMatrix,
    });

    expect(result.profileFallbacks).toEqual([]);
    expect(result.document.profiles.phone?.['action.a1']).toMatchObject({
      offsetX: 60,
      offsetY: 20,
    });
  });

  it('saves and reloads overlapping placements outside the viewport without fallback', async () => {
    const offscreenPlacement = {
      anchor: 'top-left' as const,
      offsetX: 9999,
      offsetY: -9999,
      scale: 1,
    };
    const draft = {
      schemaVersion: 1 as const,
      enabled: false,
      profiles: {
        phone: {
          'action.a1': offscreenPlacement,
          'action.a2': offscreenPlacement,
        },
        tablet: defaults.tablet,
      },
    };
    const writes: string[] = [];

    const saved = await saveMobileHudLayout({
      storage: {
        load: async () => null,
        save: async (serialized) => {
          writes.push(serialized);
        },
      },
      registry,
      matrix,
      document: draft,
    });

    expect(saved).toMatchObject({ ok: true });
    expect(writes).toHaveLength(1);

    const loaded = await loadMobileHudLayout({
      storage: { load: async () => writes[0] ?? null, save: async () => undefined },
      registry,
      matrix,
    });
    expect(loaded.profileFallbacks).toEqual([]);
    expect(loaded.document.profiles.phone).toMatchObject({
      'action.a1': offscreenPlacement,
      'action.a2': offscreenPlacement,
    });
  });

  it('inserts defaults for descriptors introduced after the stored document', async () => {
    const serialized = JSON.stringify({
      schemaVersion: 1,
      enabled: false,
      profiles: {
        phone: {
          'action.a1': { anchor: 'top-left', offsetX: 20, offsetY: 20, scale: 1 },
        },
      },
    });
    const result = await loadMobileHudLayout({
      storage: { load: async () => serialized, save: async () => undefined },
      registry,
      matrix,
    });
    expect(result.document.profiles.phone?.['action.a2']).toEqual(defaults.phone['action.a2']);
    expect(result.document.enabled).toBe(false);
  });

  it('materializes omitted optional capability fields from registry defaults', async () => {
    const phoneMatrix = MOBILE_HUD_GEOMETRY_MATRIX.filter(
      (entry) =>
        entry.profileId === 'phone' &&
        entry.context.id === 'world.base' &&
        entry.sideInset.id === 'side-none' &&
        entry.bottomInset.id === 'bottom-0',
    );
    const consumables = MOBILE_HUD_REGISTRY.defaults.phone?.['utility.consumables'];
    if (!consumables) throw new Error('missing phone Consumables default');
    const { openingDirection: _omitted, ...legacyConsumables } = consumables;
    const serialized = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      profiles: {
        phone: {
          ...MOBILE_HUD_REGISTRY.defaults.phone,
          'utility.consumables': legacyConsumables,
        },
      },
    });

    const result = await loadMobileHudLayout({
      storage: { load: async () => serialized, save: async () => undefined },
      registry: MOBILE_HUD_REGISTRY,
      matrix: phoneMatrix,
    });

    expect(result.profileFallbacks).toEqual([]);
    expect(result.document.profiles.phone?.['utility.consumables']?.openingDirection).toBe('right');
  });

  it('never rewrites stored bytes when matrix validation falls back', async () => {
    const serialized = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      profiles: {
        phone: {
          'action.a1': { anchor: 'top-left', offsetX: 9999, offsetY: 20, scale: 0.45 },
        },
      },
    });
    let writes = 0;
    const result = await loadMobileHudLayout({
      storage: {
        load: async () => serialized,
        save: async () => {
          writes += 1;
        },
      },
      registry,
      matrix,
    });
    expect(result.sourceSerialized).toBe(serialized);
    expect(result.profileFallbacks).toEqual(['phone']);
    expect(writes).toBe(0);
  });

  it('rejects an invalid draft before storage is called', async () => {
    let writes = 0;
    const draft = {
      schemaVersion: 1 as const,
      enabled: false,
      profiles: {
        phone: {
          ...defaults.phone,
          'action.a1': { anchor: 'top-left' as const, offsetX: 9999, offsetY: 20, scale: 0.45 },
        },
        tablet: defaults.tablet,
      },
    };
    const result = await saveMobileHudLayout({
      storage: {
        load: async () => null,
        save: async () => {
          writes += 1;
        },
      },
      registry,
      matrix,
      document: draft,
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-layout' });
    expect(writes).toBe(0);
    expect(draft.enabled).toBe(false);
  });

  it('activates only the serialized result after an awaited successful write', async () => {
    const draft = {
      schemaVersion: 1 as const,
      enabled: false,
      profiles: { phone: defaults.phone, tablet: defaults.tablet },
    };
    let serialized = '';
    const result = await saveMobileHudLayout({
      storage: {
        load: async () => null,
        save: async (value) => {
          await Promise.resolve();
          serialized = value;
        },
      },
      registry,
      matrix,
      document: draft,
    });
    expect(result).toMatchObject({ ok: true, document: { enabled: true } });
    expect(JSON.parse(serialized).enabled).toBe(true);
    expect(draft.enabled).toBe(false);
  });

  it('fills both required profiles before validating and serializing an incomplete draft', async () => {
    let serialized = '';
    const result = await saveMobileHudLayout({
      storage: {
        load: async () => null,
        save: async (value) => {
          serialized = value;
        },
      },
      registry,
      matrix,
      document: { schemaVersion: 1, enabled: false, profiles: {} },
    });

    expect(result).toMatchObject({
      ok: true,
      document: {
        enabled: true,
        profiles: { phone: defaults.phone, tablet: defaults.tablet },
      },
    });
    expect(JSON.parse(serialized).profiles).toEqual({
      phone: defaults.phone,
      tablet: defaults.tablet,
    });
  });

  it('returns a typed write failure without mutating the draft', async () => {
    const draft = {
      schemaVersion: 1 as const,
      enabled: false,
      profiles: { phone: defaults.phone, tablet: defaults.tablet },
    };
    const before = JSON.stringify(draft);
    const result = await saveMobileHudLayout({
      storage: {
        load: async () => null,
        save: async () => {
          throw new Error('quota');
        },
      },
      registry,
      matrix,
      document: draft,
    });
    expect(result).toEqual({ ok: false, reason: 'write-failure' });
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('does not let an unavailable class-specific surface block saving', async () => {
    const petDescriptor = MOBILE_HUD_REGISTRY.getDescriptor('pet.commands');
    if (!petDescriptor) throw new Error('missing pet.commands descriptor');
    const pet = {
      ...petDescriptor,
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
    };
    const classDefaults = {
      phone: {
        ...defaults.phone,
        'pet.commands': { ...defaults.phone['action.a1'] },
      },
      tablet: {
        ...defaults.tablet,
        'pet.commands': { ...defaults.tablet['action.a1'] },
      },
    };
    const classRegistry = buildMobileHudRegistry({
      descriptors: [descriptor('action.a1'), descriptor('action.a2'), pet],
      defaults: classDefaults,
    });
    const draft = {
      schemaVersion: 1 as const,
      enabled: false,
      profiles: {
        phone: {
          ...classDefaults.phone,
          'pet.commands': { ...classDefaults.phone['pet.commands'], scale: 0.45 },
        },
        tablet: {
          ...classDefaults.tablet,
          'pet.commands': { ...classDefaults.tablet['pet.commands'], scale: 0.45 },
        },
      },
    };
    const writes: string[] = [];

    const blocked = await saveMobileHudLayout({
      storage: { load: async () => null, save: async () => undefined },
      registry: classRegistry,
      matrix,
      document: draft,
    });
    expect(blocked).toMatchObject({ ok: false, reason: 'invalid-layout' });

    const result = await saveMobileHudLayout({
      storage: {
        load: async () => null,
        save: async (serialized) => {
          writes.push(serialized);
        },
      },
      registry: classRegistry,
      matrix,
      document: draft,
      isSurfaceAvailable: (surfaceId) => surfaceId !== 'pet.commands',
    });

    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
