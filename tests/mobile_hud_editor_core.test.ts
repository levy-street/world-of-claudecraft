import { describe, expect, it } from 'vitest';
import { MOBILE_HUD_GEOMETRY_MATRIX } from '../src/ui/mobile_hud_context';
import {
  COLLISION_EPSILON_CSS_PX,
  createMobileHudPreviewTransform,
  invertMobileHudAnchorTopLeft,
  isMobileHudDraftDirty,
  mapMobileHudAuthorPointToVisual,
  mapMobileHudPreviewDeltaToCanonical,
  mapMobileHudPreviewPointToCanonical,
  mapMobileHudVisualPointToAuthor,
  mapMobileHudVisualPointToPreview,
  mirrorMobileHudPlacement,
  reduceMobileHudDraft,
  resolveMobileHudAnchorTopLeft,
  resolveMobileHudSurfaceGeometry,
  validateMobileHudContext,
  validateMobileHudLayoutMatrix,
} from '../src/ui/mobile_hud_editor_core';
import type {
  MobileHudAnchor,
  MobileHudDraft,
  MobileHudPlacement,
  MobileHudSize,
  MobileHudViewportGeometry,
} from '../src/ui/mobile_hud_editor_types';
import { buildMobileHudRegistry, MOBILE_HUD_REGISTRY } from '../src/ui/mobile_hud_registry';

const geometry: MobileHudViewportGeometry = {
  id: 'asymmetric-offset-phone',
  width: 740,
  height: 360,
  visualOffsetX: 12,
  visualOffsetY: 7,
  safeAreaInsets: { top: 0, right: 10, bottom: 24, left: 50 },
};
const size: MobileHudSize = { width: 100, height: 40 };

describe('mobile HUD canonical visual anchor geometry', () => {
  it.each<[MobileHudAnchor, number, number]>([
    ['top-left', 62, 7],
    ['top-center', 352, 7],
    ['top-right', 642, 7],
    ['center-left', 62, 155],
    ['center', 352, 155],
    ['center-right', 642, 155],
    ['bottom-left', 62, 303],
    ['bottom-center', 352, 303],
    ['bottom-right', 642, 303],
  ])('resolves %s against visual offsets and asymmetric safe areas', (anchor, x, y) => {
    expect(resolveMobileHudAnchorTopLeft(anchor, 0, 0, size, geometry)).toEqual({ x, y });
  });

  it('round-trips every stable anchor and signed offset', () => {
    for (const anchor of [
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ] as const) {
      const topLeft = resolveMobileHudAnchorTopLeft(anchor, -11, 9, size, geometry);
      expect(invertMobileHudAnchorTopLeft(topLeft, size, geometry)).toEqual({
        anchor,
        offsetX: -11,
        offsetY: 9,
      });
    }
  });

  it('uses the declared stable anchor order for an exact nearest-anchor tie', () => {
    expect(invertMobileHudAnchorTopLeft({ x: 207, y: 7 }, size, geometry)).toEqual({
      anchor: 'top-left',
      offsetX: 145,
      offsetY: 0,
    });
  });

  it('keeps negative offsets instead of clamping during pure anchor conversion', () => {
    const topLeft = resolveMobileHudAnchorTopLeft('bottom-right', -720, -400, size, geometry);
    expect(topLeft).toEqual({ x: -78, y: -97 });
    expect(invertMobileHudAnchorTopLeft(topLeft, size, geometry)).toEqual({
      anchor: 'top-left',
      offsetX: -140,
      offsetY: -104,
    });
  });

  it('has no UI-scale input because canonical geometry stays in visual CSS pixels', () => {
    expect(resolveMobileHudAnchorTopLeft.length).toBe(5);
    expect(invertMobileHudAnchorTopLeft.length).toBe(3);
  });
});

describe('mobile HUD canonical handedness transform', () => {
  it.each<[MobileHudAnchor, MobileHudAnchor]>([
    ['top-left', 'top-right'],
    ['top-center', 'top-center'],
    ['top-right', 'top-left'],
    ['center-left', 'center-right'],
    ['center', 'center'],
    ['center-right', 'center-left'],
    ['bottom-left', 'bottom-right'],
    ['bottom-center', 'bottom-center'],
    ['bottom-right', 'bottom-left'],
  ])('mirrors %s to %s and negates only the horizontal offset', (anchor, mirroredAnchor) => {
    expect(
      mirrorMobileHudPlacement({ anchor, offsetX: 17, offsetY: -9, scale: 1.2 }, 'position'),
    ).toEqual({
      anchor: mirroredAnchor,
      offsetX: -17,
      offsetY: -9,
      scale: 1.2,
    });
  });

  it('flips horizontal opening direction but preserves vertical opening and orientation', () => {
    const base: MobileHudPlacement = {
      anchor: 'bottom-left',
      offsetX: 12,
      offsetY: -8,
      scale: 1.1,
      orientation: 'vertical',
      openingDirection: 'left',
    };
    expect(mirrorMobileHudPlacement(base, 'position-and-order')).toMatchObject({
      anchor: 'bottom-right',
      offsetX: -12,
      offsetY: -8,
      scale: 1.1,
      orientation: 'vertical',
      openingDirection: 'right',
    });
    expect(
      mirrorMobileHudPlacement({ ...base, openingDirection: 'up' }, 'position-and-order')
        .openingDirection,
    ).toBe('up');
  });

  it('reverses ordered composites but not position-only surfaces', () => {
    const base: MobileHudPlacement = {
      anchor: 'top-right',
      offsetX: -10,
      offsetY: 6,
      scale: 1,
      orientation: 'horizontal',
      reverse: false,
    };
    expect(mirrorMobileHudPlacement(base, 'position-and-order').reverse).toBe(true);
    expect(mirrorMobileHudPlacement(base, 'position').reverse).toBe(false);
  });

  it('leaves mirror-policy none byte-equivalent and two mirrors restore the source', () => {
    const source: MobileHudPlacement = {
      anchor: 'center-left',
      offsetX: -13,
      offsetY: 21,
      scale: 1.3,
      orientation: 'horizontal',
      reverse: true,
      openingDirection: 'right',
    };
    expect(JSON.stringify(mirrorMobileHudPlacement(source, 'none'))).toBe(JSON.stringify(source));
    expect(
      JSON.stringify(
        mirrorMobileHudPlacement(
          mirrorMobileHudPlacement(source, 'position-and-order'),
          'position-and-order',
        ),
      ),
    ).toBe(JSON.stringify(source));
  });
});

describe('mobile HUD scaled footprints and temporary viewport clamps', () => {
  const descriptor = (id: Parameters<typeof MOBILE_HUD_REGISTRY.getDescriptor>[0]) => {
    const value = MOBILE_HUD_REGISTRY.getDescriptor(id);
    if (!value) throw new Error(`missing test descriptor: ${id}`);
    return value;
  };
  const basePlacement: MobileHudPlacement = {
    anchor: 'top-left',
    offsetX: 100,
    offsetY: 50,
    scale: 1,
  };

  it('uses profile size before scale and keeps subpixel precision', () => {
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor('action.jump_use'),
      'tablet',
      { ...basePlacement, scale: 1.1 },
      geometry,
      'world.base',
    );
    expect(resolved.unscaledSize).toEqual({ width: 64, height: 64 });
    expect(resolved.scaledSize).toEqual({ width: 70.4, height: 70.4 });
    expect(resolved.canonicalRect).toEqual({ x: 162, y: 57, width: 70.4, height: 70.4 });
  });

  it('selects the worst six-slot footprint for the active opening direction', () => {
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor('utility.consumables'),
      'phone',
      { ...basePlacement, scale: 1.1, openingDirection: 'right' },
      geometry,
      'world.base',
    );
    expect(resolved.unscaledSize).toEqual({ width: 206, height: 100 });
    expect(resolved.scaledSize).toEqual({ width: 226.60000000000002, height: 110.00000000000001 });
  });

  it('protects the complete Movement capture zone and the visible View joystick', () => {
    const movement = resolveMobileHudSurfaceGeometry(
      descriptor('control.movement'),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );
    const view = resolveMobileHudSurfaceGeometry(
      descriptor('control.view'),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );

    expect(movement.canonicalRect).toEqual({ x: 162, y: 57, width: 134, height: 172 });
    expect(movement.interactiveRect).toEqual(movement.canonicalRect);
    expect(view.canonicalRect).toEqual({ x: 162, y: 57, width: 220, height: 100 });
    expect(view.interactiveRect).toEqual({ x: 231, y: 66, width: 82, height: 82 });
  });

  it('protects the complete Minimap cluster including its satellite controls', () => {
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor('minimap.cluster'),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );

    expect(resolved.canonicalRect).toEqual({ x: 162, y: 57, width: 162, height: 340 });
    expect(resolved.interactiveRect).toEqual(resolved.canonicalRect);
  });

  it('protects every slot in the expanded Consumables tray', () => {
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor('utility.consumables'),
      'phone',
      { ...basePlacement, openingDirection: 'right' },
      geometry,
      'world.base',
    );

    expect(resolved.canonicalRect).toEqual({ x: 162, y: 57, width: 206, height: 100 });
    expect(resolved.interactiveRect).toEqual(resolved.canonicalRect);
  });

  it('uses orientation-specific Party and bounded aura profile footprints', () => {
    const verticalAura = resolveMobileHudSurfaceGeometry(
      descriptor('auras.player_buffs'),
      'phone',
      { ...basePlacement, orientation: 'vertical' },
      geometry,
      'world.base',
    );
    const horizontalParty = resolveMobileHudSurfaceGeometry(
      descriptor('party'),
      'phone',
      { ...basePlacement, orientation: 'horizontal' },
      geometry,
      'world.base',
    );
    const tabletAura = resolveMobileHudSurfaceGeometry(
      descriptor('auras.player_buffs'),
      'tablet',
      { ...basePlacement, orientation: 'horizontal' },
      geometry,
      'world.base',
    );
    expect(verticalAura.unscaledSize).toEqual({ width: 40, height: 128 });
    expect(tabletAura.unscaledSize).toEqual({ width: 260, height: 40 });
    expect(horizontalParty.unscaledSize).toEqual({ width: 372, height: 40 });
  });

  it('keeps representative editor fallbacks separate from worst-case validation envelopes', () => {
    const party = resolveMobileHudSurfaceGeometry(
      descriptor('party'),
      'phone',
      { ...basePlacement, orientation: 'horizontal' },
      geometry,
      'world.base',
    );
    const verticalPet = resolveMobileHudSurfaceGeometry(
      descriptor('pet.commands'),
      'phone',
      { ...basePlacement, orientation: 'vertical' },
      geometry,
      'world.base',
    );
    const target = resolveMobileHudSurfaceGeometry(
      descriptor('frame.target'),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );
    const player = resolveMobileHudSurfaceGeometry(
      descriptor('frame.player'),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );
    const buffs = resolveMobileHudSurfaceGeometry(
      descriptor('auras.player_buffs'),
      'phone',
      { ...basePlacement, orientation: 'horizontal' },
      geometry,
      'world.base',
    );
    const menu = resolveMobileHudSurfaceGeometry(
      descriptor('menu.top'),
      'phone',
      { ...basePlacement, orientation: 'horizontal' },
      geometry,
      'world.base',
    );

    expect(party.canonicalRect.width).toBe(372);
    expect(party.editorFallbackRect).toMatchObject({ width: 28, height: 28 });
    expect(verticalPet.canonicalRect).toMatchObject({ width: 40, height: 164 });
    expect(verticalPet.editorFallbackRect).toMatchObject({ width: 32, height: 156 });
    expect(target.interactiveRect).toMatchObject({ width: 236, height: 121 });
    expect(target.editorFallbackRect).toMatchObject({ width: 239, height: 69 });
    expect(player.canonicalRect).toMatchObject({ width: 300, height: 68 });
    expect(player.interactiveRect).toEqual(player.canonicalRect);
    expect(player.editorFallbackRect).toMatchObject({ width: 285, height: 74 });
    expect(player.editorFallbackRect.x).toBe(player.canonicalRect.x - 5);
    expect(player.editorFallbackRect.y).toBe(player.canonicalRect.y - 5);
    expect(buffs.editorFallbackRect).toMatchObject({ width: 40, height: 40 });
    expect(menu.editorFallbackRect).toMatchObject({ width: 40, height: 48 });
  });

  it('reports scale-step and target-floor validity independently', () => {
    const invalidStep = resolveMobileHudSurfaceGeometry(
      descriptor('action.jump_use'),
      'phone',
      { ...basePlacement, scale: 1.03 },
      geometry,
      'world.base',
    );
    const belowFloor = resolveMobileHudSurfaceGeometry(
      descriptor('action.a1'),
      'phone',
      { ...basePlacement, scale: 0.4 },
      geometry,
      'world.base',
    );
    const undersizedViewHitbox = resolveMobileHudSurfaceGeometry(
      {
        ...descriptor('control.view'),
        minimumTargetSize: { width: 74, height: 74 },
        scaleLimits: { min: 0.9, max: 1.4, step: 0.1 },
      },
      'phone',
      { ...basePlacement, scale: 0.9 },
      geometry,
      'world.base',
    );
    expect(invalidStep.scaleValid).toBe(false);
    expect(invalidStep.targetSizeValid).toBe(true);
    expect(belowFloor.scaleValid).toBe(false);
    // Action seats compensate their touch rect below 1x, so an out-of-range
    // visual scale remains independently invalid without shrinking the hitbox.
    expect(belowFloor.targetSizeValid).toBe(true);
    expect(undersizedViewHitbox.scaleValid).toBe(true);
    expect(undersizedViewHitbox.targetSizeValid).toBe(false);
  });

  it('adds comfort padding to the collision envelope without changing artwork bounds', () => {
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor('action.a1'),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );
    expect(resolved.canonicalRect).toEqual({ x: 162, y: 57, width: 48, height: 48 });
    expect(resolved.collisionRect).toEqual({ x: 160, y: 55, width: 52, height: 52 });
  });

  it.each([
    'control.movement',
    'minimap.cluster',
  ] as const)('protects the complete interactive %s surface, not only its painted center', (surfaceId) => {
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor(surfaceId),
      'phone',
      basePlacement,
      geometry,
      'world.base',
    );

    expect(resolved.interactiveRect).toEqual(resolved.canonicalRect);
  });

  it('keeps preview geometry outside the safe viewport when the player places it there', () => {
    const source: MobileHudPlacement = {
      anchor: 'top-left',
      offsetX: 600,
      offsetY: 20,
      scale: 1,
    };
    const narrow: MobileHudViewportGeometry = {
      id: 'narrow',
      width: 400,
      height: 300,
      visualOffsetX: 0,
      visualOffsetY: 0,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const wide = { ...narrow, id: 'wide', width: 800 };
    const narrowResolved = resolveMobileHudSurfaceGeometry(
      descriptor('action.a1'),
      'phone',
      source,
      narrow,
      'world.base',
    );
    const wideResolved = resolveMobileHudSurfaceGeometry(
      descriptor('action.a1'),
      'phone',
      source,
      wide,
      'world.base',
    );
    expect(narrowResolved.canonicalRect.x).toBe(600);
    expect(narrowResolved.previewRect).toEqual(narrowResolved.interactiveRect);
    expect(narrowResolved.previewRect.x).toBe(600);
    expect(wideResolved.previewRect.x).toBe(600);
    expect(source).toEqual({ anchor: 'top-left', offsetX: 600, offsetY: 20, scale: 1 });
  });
});

describe('one canonical mobile HUD context validator', () => {
  const viewport: MobileHudViewportGeometry = {
    id: 'validator-phone',
    width: 500,
    height: 300,
    visualOffsetX: 0,
    visualOffsetY: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const get = (id: Parameters<typeof MOBILE_HUD_REGISTRY.getDescriptor>[0]) => {
    const value = MOBILE_HUD_REGISTRY.getDescriptor(id);
    if (!value) throw new Error(`missing validator descriptor: ${id}`);
    return value;
  };
  const at = (x: number, y: number, scale = 1): MobileHudPlacement => ({
    anchor: 'top-left',
    offsetX: x,
    offsetY: y,
    scale,
  });
  const validate = (
    ids: Parameters<typeof MOBILE_HUD_REGISTRY.getDescriptor>[0][],
    placements: Partial<
      Record<Parameters<typeof MOBILE_HUD_REGISTRY.getDescriptor>[0], MobileHudPlacement>
    >,
    contextId: Parameters<typeof validateMobileHudContext>[0]['contextId'] = 'world.base',
  ) =>
    validateMobileHudContext({
      registry: buildMobileHudRegistry({ descriptors: ids.map(get) }),
      profileId: 'phone',
      placements,
      geometry: viewport,
      contextId,
    });

  it('names the shared 0.5 CSS pixel collision tolerance', () => {
    expect(COLLISION_EPSILON_CSS_PX).toBe(0.5);
  });

  it('reports malformed placement and unsupported capability fields', () => {
    const malformed = validate(['action.a1'], {
      'action.a1': { ...at(100, 100), scale: Number.NaN },
    });
    const unsupported = validate(['action.a1'], {
      'action.a1': { ...at(100, 100), orientation: 'vertical' },
    });
    expect(malformed.map((failure) => failure.reason)).toEqual(['invalid-placement']);
    expect(unsupported.map((failure) => failure.reason)).toEqual(['unsupported-capability']);
  });

  it('allows positions outside the safe area while preserving scale and target validation', () => {
    const scaled = validate(['action.a1'], { 'action.a1': at(100, 100, 0.45) });
    const outside = validate(['action.a1'], { 'action.a1': at(-45, 100) });
    expect(scaled.map((failure) => failure.reason)).toEqual(['scale-out-of-range']);
    expect(outside).toEqual([]);
  });

  it('allows movable surfaces to overlap without explicit exceptions', () => {
    const overlap = validate(['action.a1', 'action.a2'], {
      'action.a1': at(100, 100),
      'action.a2': at(120, 100),
    });
    expect(overlap).toEqual([]);
  });

  it('allows Delve text, its affix pocket, and off-safe-area placement', () => {
    const delveTracker = {
      ...get('tracker.delve'),
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
    };
    const registry = buildMobileHudRegistry({
      descriptors: [get('action.a1'), delveTracker],
    });

    const textOverlap = validateMobileHudContext({
      registry,
      profileId: 'phone',
      placements: {
        'action.a1': at(100, 100),
        'tracker.delve': at(100, 100),
      },
      geometry: viewport,
      contextId: 'world.base',
    });
    const affixOverlap = validateMobileHudContext({
      registry,
      profileId: 'phone',
      placements: {
        'action.a1': at(190, 100),
        'tracker.delve': at(100, 100),
      },
      geometry: viewport,
      contextId: 'world.base',
    });
    const outside = validateMobileHudContext({
      registry,
      profileId: 'phone',
      placements: {
        'action.a1': at(100, 100),
        'tracker.delve': at(999, 100),
      },
      geometry: viewport,
      contextId: 'world.base',
    });

    expect(textOverlap).toEqual([]);
    expect(affixOverlap).toEqual([]);
    expect(outside).toEqual([]);
  });

  it('allows informational, interactive status, and protected UI to overlap controls', () => {
    const inWorld = <T extends ReturnType<typeof get>>(descriptor: T): T =>
      ({
        ...descriptor,
        visibleIn: ['world.base'],
        validateIn: ['world.base'],
        ...(descriptor.class === 'protected' ? { allowProtectedOverlapWith: undefined } : {}),
      }) as T;
    const placements = {
      'menu.top': at(100, 100),
      'status.arena.generic': at(100, 100),
      'status.vale_cup.indicator': at(100, 100),
      'action.a1': at(100, 100),
    };
    const informational = validateMobileHudContext({
      registry: buildMobileHudRegistry({
        descriptors: [get('menu.top'), inWorld(get('status.arena.generic'))],
      }),
      profileId: 'phone',
      placements,
      geometry: viewport,
      contextId: 'world.base',
    });
    const interactive = validateMobileHudContext({
      registry: buildMobileHudRegistry({
        descriptors: [get('menu.top'), inWorld(get('status.vale_cup.indicator'))],
      }),
      profileId: 'phone',
      placements,
      geometry: viewport,
      contextId: 'world.base',
    });
    const foreground = validateMobileHudContext({
      registry: buildMobileHudRegistry({
        descriptors: [get('action.a1'), inWorld(get('protected.vale_cup.betting'))],
      }),
      profileId: 'phone',
      placements,
      geometry: viewport,
      contextId: 'world.base',
    });

    expect(informational).toEqual([]);
    expect(interactive).toEqual([]);
    expect(foreground).toEqual([]);
  });

  it('allows an interactive player aura viewport to overlap the Target action', () => {
    const failures = validateMobileHudContext({
      registry: buildMobileHudRegistry({
        descriptors: [get('action.target'), get('auras.player_buffs')],
      }),
      profileId: 'phone',
      placements: {
        'action.target': at(100, 100),
        'auras.player_buffs': at(100, 100),
      },
      geometry: viewport,
      contextId: 'world.base',
    });

    expect(failures).toEqual([]);
  });

  it('reserves only the Yumi collapse toggle while its status text remains overlay content', () => {
    const descriptor = get('status.arena.yumi');
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor,
      'phone',
      at(100, 100),
      viewport,
      'arena.yumi.base',
    );

    expect(resolved.canonicalRect).toMatchObject({ x: 100, y: 100, width: 224, height: 54 });
    expect(resolved.interactiveRect).toEqual({ x: 192, y: 107, width: 40, height: 40 });
    expect(descriptor.scaleLimits?.min).toBe(0.5);
  });

  it('does not block Save for separated or intersecting physical hitboxes', () => {
    expect(
      validate(['action.a1', 'action.a2'], {
        'action.a1': at(100, 100),
        'action.a2': at(149, 100),
      }),
    ).toEqual([]);
    expect(
      validate(['action.a1', 'action.a2'], {
        'action.a1': at(100, 100),
        'action.a2': at(147.49, 100),
      }),
    ).toEqual([]);
  });

  it('allows controls to overlap every part of the expanded Consumables tray', () => {
    const expandedOnly = validate(['utility.consumables', 'action.a1'], {
      'utility.consumables': { ...at(100, 100), openingDirection: 'right' },
      'action.a1': at(170, 100),
    });
    const toggleOverlap = validate(['utility.consumables', 'action.a1'], {
      'utility.consumables': { ...at(100, 100), openingDirection: 'right' },
      'action.a1': at(110, 155),
    });

    expect(expandedOnly).toEqual([]);
    expect(toggleOverlap).toEqual([]);
  });

  it('never blocks a changed overlap between two interactive controls', () => {
    const registry = buildMobileHudRegistry({
      descriptors: [get('action.a1'), get('action.a2')],
    });
    const overlappingPlacements = {
      'action.a1': at(100, 100),
      'action.a2': at(120, 100),
    };
    const check = (a2X: number) =>
      validateMobileHudContext({
        registry,
        profileId: 'phone',
        placements: { ...overlappingPlacements, 'action.a2': at(a2X, 100) },
        geometry: viewport,
        contextId: 'world.base',
      });

    expect(check(130)).toEqual([]);
    expect(check(110)).toEqual([]);
  });

  it('allows Movement and View to overlap', () => {
    const failures = validate(['control.movement', 'control.view'], {
      'control.movement': at(100, 100),
      'control.view': at(150, 100),
    });
    expect(failures).toEqual([]);
  });

  it('allows a movable surface to overlap an active protected footprint', () => {
    const protectedRespawn = {
      ...get('protected.arena.fiesta_respawn'),
      visibleIn: ['arena.fiesta.respawn'] as const,
      validateIn: ['arena.fiesta.respawn'] as const,
      allowProtectedOverlapWith: undefined,
      overlapPolicy: undefined,
      protectedFootprint: () => ({ x: 100, y: 50, width: 100, height: 100 }),
    };
    const registry = buildMobileHudRegistry({ descriptors: [get('action.a1'), protectedRespawn] });
    expect(
      validateMobileHudContext({
        registry,
        profileId: 'phone',
        placements: { 'action.a1': at(110, 70) },
        geometry: viewport,
        contextId: 'arena.fiesta.respawn',
      }),
    ).toEqual([]);
  });

  it('allows View to overlap protected UI', () => {
    const protectedPrompt = {
      ...get('protected.arena.fiesta_respawn'),
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
      allowProtectedOverlapWith: undefined,
      overlapPolicy: undefined,
      protectedFootprint: () => ({ x: 100, y: 100, width: 180, height: 100 }),
    };
    const registry = buildMobileHudRegistry({
      descriptors: [get('control.view'), protectedPrompt],
    });
    expect(
      validateMobileHudContext({
        registry,
        profileId: 'phone',
        placements: { 'control.view': at(100, 100) },
        geometry: viewport,
        contextId: 'world.base',
      }),
    ).toEqual([]);
  });

  it('does not change validation when overlap crosses the legacy collision epsilon', () => {
    expect(
      validate(['action.a1', 'action.a2'], {
        'action.a1': at(100, 100),
        'action.a2': at(148, 100),
      }),
    ).toEqual([]);
    expect(
      validate(['action.a1', 'action.a2'], {
        'action.a1': at(100, 100),
        'action.a2': at(147.5, 100),
      }),
    ).toEqual([]);
    expect(
      validate(['action.a1', 'action.a2'], {
        'action.a1': at(100, 100),
        'action.a2': at(147.49, 100),
      }),
    ).toEqual([]);
  });
});

describe('complete mobile HUD profile matrix validator', () => {
  const requireDescriptor = (id: Parameters<typeof MOBILE_HUD_REGISTRY.getDescriptor>[0]) => {
    const value = MOBILE_HUD_REGISTRY.getDescriptor(id);
    if (!value) throw new Error(`missing matrix descriptor: ${id}`);
    return value;
  };
  const requireMatrixCase = (
    predicate: (entry: (typeof MOBILE_HUD_GEOMETRY_MATRIX)[number]) => boolean,
  ) => {
    const value = MOBILE_HUD_GEOMETRY_MATRIX.find(predicate);
    if (!value) throw new Error('missing matrix test case');
    return value;
  };

  it('accepts the shipped defaults strictly across both handedness variants of the matrix', () => {
    const failures = validateMobileHudLayoutMatrix({
      registry: MOBILE_HUD_REGISTRY,
      profiles: MOBILE_HUD_REGISTRY.defaults,
    });
    expect(failures).toEqual([]);
  });

  it('accepts the advertised 0.5x scale for every movable surface', () => {
    for (const profileId of ['phone', 'tablet'] as const) {
      const profileGeometry =
        profileId === 'phone'
          ? { ...geometry, id: 'phone-min-scale', width: 740, height: 360 }
          : { ...geometry, id: 'tablet-min-scale', width: 1024, height: 768 };
      for (const descriptor of MOBILE_HUD_REGISTRY.descriptors) {
        if (descriptor.class !== 'movable') continue;
        const placement = MOBILE_HUD_REGISTRY.defaults[profileId]?.[descriptor.id];
        if (!placement || !descriptor.scaleLimits) continue;
        const resolved = resolveMobileHudSurfaceGeometry(
          descriptor,
          profileId,
          { ...placement, scale: descriptor.scaleLimits.min },
          profileGeometry,
          descriptor.visibleIn[0],
        );
        expect(resolved.scaleValid, descriptor.id).toBe(true);
        expect(resolved.targetSizeValid, descriptor.id).toBe(true);
      }
    }
  });

  it('allows a layout that becomes overlapping only after left-handed mirroring', () => {
    const matrixCase = requireMatrixCase(
      (entry) =>
        entry.viewport.id === 'phone-740x360' &&
        entry.sideInset.id === 'side-none' &&
        entry.bottomInset.id === 'bottom-0' &&
        entry.context.id === 'world.base',
    );
    const mirrored = {
      ...requireDescriptor('action.a1'),
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
      mirrorPolicy: 'position' as const,
    };
    const fixed = {
      ...requireDescriptor('action.a2'),
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
      mirrorPolicy: 'none' as const,
    };
    const failures = validateMobileHudLayoutMatrix({
      registry: buildMobileHudRegistry({ descriptors: [mirrored, fixed] }),
      profiles: {
        phone: {
          'action.a1': { anchor: 'top-left', offsetX: 10, offsetY: 10, scale: 1 },
          'action.a2': { anchor: 'top-right', offsetX: -10, offsetY: 10, scale: 1 },
        },
      },
      matrix: [matrixCase],
    });

    expect(failures).toEqual([]);
  });

  it('allows a one-pixel nudge that remains strictly valid', () => {
    const baseline = MOBILE_HUD_REGISTRY.defaults.phone?.['action.a1'];
    if (!baseline) throw new Error('phone A1 baseline missing');
    const failures = validateMobileHudLayoutMatrix({
      registry: MOBILE_HUD_REGISTRY,
      profiles: {
        phone: {
          ...MOBILE_HUD_REGISTRY.defaults.phone,
          'action.a1': { ...baseline, offsetX: baseline.offsetX + 1 },
        },
        tablet: MOBILE_HUD_REGISTRY.defaults.tablet,
      },
    });
    expect(failures).toEqual([]);
  });

  it('ignores unavailable class-specific surfaces during validation', () => {
    const baseline = MOBILE_HUD_REGISTRY.defaults.phone?.['action.a1'];
    if (!baseline) throw new Error('phone A1 baseline missing');
    const failures = validateMobileHudLayoutMatrix({
      registry: MOBILE_HUD_REGISTRY,
      profiles: {
        phone: {
          ...MOBILE_HUD_REGISTRY.defaults.phone,
          'pet.commands': { ...baseline },
        },
      },
      isSurfaceAvailable: (surfaceId) => surfaceId !== 'pet.commands',
    });

    expect(failures.some((failure) => failure.surfaceIds.includes('pet.commands'))).toBe(false);
  });

  it('allows controls to overlap the always-front center message', () => {
    const matrixCase = requireMatrixCase(
      (entry) =>
        entry.viewport.id === 'phone-740x360' &&
        entry.sideInset.id === 'side-none' &&
        entry.bottomInset.id === 'bottom-0' &&
        entry.context.id === 'world.base',
    );
    const failures = validateMobileHudContext({
      registry: MOBILE_HUD_REGISTRY,
      profileId: 'phone',
      placements: {
        ...MOBILE_HUD_REGISTRY.defaults.phone,
        'action.a1': { anchor: 'top-center', offsetX: 0, offsetY: 90, scale: 1 },
      },
      geometry: matrixCase.geometry,
      contextId: 'world.base',
    });

    expect(failures).toEqual([]);
  });

  it('allows a default control to move outside the safe viewport', () => {
    const phone = {
      ...MOBILE_HUD_REGISTRY.defaults.phone,
      'control.movement': {
        ...MOBILE_HUD_REGISTRY.defaults.phone?.['control.movement'],
        anchor: 'bottom-left' as const,
        offsetX: -40,
        offsetY: 0,
        scale: 1,
      },
    };
    const failures = validateMobileHudLayoutMatrix({
      registry: MOBILE_HUD_REGISTRY,
      profiles: { phone, tablet: MOBILE_HUD_REGISTRY.defaults.tablet },
    });
    expect(failures).toEqual([]);
  });

  it('evaluates both hands for all 768 profile, geometry, safe-area, and context cases', () => {
    let evaluatedCases = 0;
    const failures = validateMobileHudLayoutMatrix({
      registry: buildMobileHudRegistry({ descriptors: [] }),
      profiles: { phone: {}, tablet: {} },
      onCase: () => {
        evaluatedCases += 1;
      },
    });
    expect(MOBILE_HUD_GEOMETRY_MATRIX).toHaveLength(768);
    expect(evaluatedCases).toBe(1_536);
    expect(failures).toEqual([]);
  });

  it('validates an optional hidden context even when the ordinary scene is clean', () => {
    const hiddenOnly = {
      ...requireDescriptor('action.a1'),
      visibleIn: ['world.vale_cup_indicator'] as const,
      validateIn: ['world.vale_cup_indicator'] as const,
    };
    const failures = validateMobileHudLayoutMatrix({
      registry: buildMobileHudRegistry({ descriptors: [hiddenOnly] }),
      profiles: { phone: {} },
    });
    expect(failures).toHaveLength(80);
    expect(failures.every((failure) => failure.contextId === 'world.vale_cup_indicator')).toBe(
      true,
    );
    expect(failures.every((failure) => failure.reason === 'invalid-placement')).toBe(true);
  });

  it('isolates a failing phone profile from a valid tablet profile', () => {
    const worldOnly = {
      ...requireDescriptor('action.a1'),
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
    };
    const failures = validateMobileHudLayoutMatrix({
      registry: buildMobileHudRegistry({ descriptors: [worldOnly] }),
      profiles: {
        phone: { 'action.a1': { anchor: 'top-left', offsetX: -100, offsetY: 100, scale: 0.45 } },
        tablet: { 'action.a1': { anchor: 'top-left', offsetX: 100, offsetY: 100, scale: 1 } },
      },
    });
    expect(failures.length).toBeGreaterThan(0);
    expect(new Set(failures.map((failure) => failure.profileId))).toEqual(new Set(['phone']));
  });

  it('deduplicates identical diagnostics while preserving descriptor order', () => {
    const matrixCase = requireMatrixCase(
      (entry) => entry.profileId === 'phone' && entry.context.id === 'world.base',
    );
    const failures = validateMobileHudLayoutMatrix({
      registry: buildMobileHudRegistry({
        descriptors: [requireDescriptor('action.a1'), requireDescriptor('action.a2')],
      }),
      profiles: { phone: {} },
      matrix: [matrixCase, matrixCase],
    });
    expect(failures).toMatchObject([
      { reason: 'invalid-placement', handedness: 'right', surfaceIds: ['action.a1'] },
      { reason: 'invalid-placement', handedness: 'right', surfaceIds: ['action.a2'] },
      { reason: 'invalid-placement', handedness: 'left', surfaceIds: ['action.a1'] },
      { reason: 'invalid-placement', handedness: 'left', surfaceIds: ['action.a2'] },
    ]);
  });

  it('allows active dynamic variants to extend outside the safe viewport', () => {
    const matrixCase = requireMatrixCase(
      (entry) =>
        entry.viewport.id === 'phone-740x360' &&
        entry.sideInset.id === 'side-none' &&
        entry.bottomInset.id === 'bottom-0' &&
        entry.context.id === 'world.base',
    );
    const consumables = {
      ...requireDescriptor('utility.consumables'),
      visibleIn: ['world.base'] as const,
      validateIn: ['world.base'] as const,
    };
    const failures = validateMobileHudLayoutMatrix({
      registry: buildMobileHudRegistry({ descriptors: [consumables] }),
      profiles: {
        phone: {
          'utility.consumables': {
            anchor: 'top-left',
            offsetX: 600,
            offsetY: 100,
            scale: 1,
            openingDirection: 'right',
          },
        },
        tablet: {
          'action.a1': { anchor: 'bottom-left' as const, offsetX: 42, offsetY: -20, scale: 1.2 },
        },
      },
      matrix: [matrixCase],
    });
    expect(failures).toEqual([]);
  });
});

describe('scaled failing-layout preview coordinate mapping', () => {
  const source: MobileHudViewportGeometry = {
    id: 'phone-740-offset',
    width: 740,
    height: 360,
    visualOffsetX: 12,
    visualOffsetY: 7,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const preview = { x: 0, y: 0, width: 932, height: 430 };

  it('letterboxes a 740x360 failure inside a 932x430 editor canvas', () => {
    const transform = createMobileHudPreviewTransform(source, preview);
    expect(transform.scale).toBeCloseTo(43 / 36, 12);
    expect(transform.contentRect).toEqual({
      x: (932 - 740 * (43 / 36)) / 2,
      y: 0,
      width: 740 * (43 / 36),
      height: 430,
    });
  });

  it('subtracts visualViewport offsets before mapping and round-trips points', () => {
    const transform = createMobileHudPreviewTransform(source, preview);
    expect(mapMobileHudVisualPointToPreview({ x: 12, y: 7 }, transform)).toEqual({
      x: transform.contentRect.x,
      y: 0,
    });
    const canonical = { x: 412.25, y: 197.75 };
    const mapped = mapMobileHudVisualPointToPreview(canonical, transform);
    expect(mapMobileHudPreviewPointToCanonical(mapped, transform)).toEqual(canonical);
  });

  it('inverse-maps drag and nudge deltas into unscaled canonical CSS pixels', () => {
    const transform = createMobileHudPreviewTransform(source, preview);
    expect(
      mapMobileHudPreviewDeltaToCanonical(
        { x: 10 * transform.scale, y: -4 * transform.scale },
        transform,
      ),
    ).toEqual({ x: 10, y: -4 });
  });

  it.each([0.8, 1.35])('round-trips ui-author coordinates at UI Scale %s', (uiScale) => {
    const authorPoint = { x: 100, y: 50 };
    const visualPoint = mapMobileHudAuthorPointToVisual(authorPoint, uiScale, source);
    expect(visualPoint).toEqual({
      x: source.visualOffsetX + authorPoint.x * uiScale,
      y: source.visualOffsetY + authorPoint.y * uiScale,
    });
    expect(mapMobileHudVisualPointToAuthor(visualPoint, uiScale, source)).toEqual(authorPoint);
  });
});

describe('immutable mobile HUD draft lock, selection, scene, and move actions', () => {
  const draftGeometry: MobileHudViewportGeometry = {
    id: 'draft-phone',
    width: 500,
    height: 300,
    visualOffsetX: 0,
    visualOffsetY: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const makeDraft = (overrides: Partial<MobileHudDraft> = {}): MobileHudDraft => {
    const document = {
      schemaVersion: 1 as const,
      enabled: true,
      profiles: {
        phone: {
          'action.a1': { anchor: 'top-right' as const, offsetX: -10, offsetY: 20, scale: 1 },
          'status.vale_cup.indicator': {
            anchor: 'top-center' as const,
            offsetX: 0,
            offsetY: 8,
            scale: 1,
          },
          party: {
            anchor: 'top-left' as const,
            offsetX: 100,
            offsetY: 8,
            scale: 1,
            orientation: 'horizontal' as const,
            reverse: false,
          },
          'utility.consumables': {
            anchor: 'bottom-left' as const,
            offsetX: 136,
            offsetY: -16,
            scale: 1,
            openingDirection: 'right' as const,
          },
        },
      },
    };
    return {
      document,
      entryDocument: structuredClone(document),
      activeProfileId: 'phone',
      sceneId: 'world',
      contextId: 'world.vale_cup_indicator',
      selectedSurfaceId: null,
      locked: true,
      failures: [],
      activeFailureIndex: null,
      ...overrides,
    };
  };

  it('blocks selection and movement while Locked without mutating or cloning the draft', () => {
    const source = makeDraft({ selectedSurfaceId: 'action.a1' });
    const selected = reduceMobileHudDraft(
      source,
      { type: 'select-surface', surfaceId: 'status.vale_cup.indicator' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const moved = reduceMobileHudDraft(
      source,
      {
        type: 'move-selected',
        topLeft: { x: 100, y: 50 },
        size: { width: 48, height: 48 },
        geometry: draftGeometry,
        handedness: 'right',
      },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(selected).toBe(source);
    expect(moved).toBe(source);
  });

  it('unlocks immutably and selects only visible movable surfaces', () => {
    const source = makeDraft();
    const unlocked = reduceMobileHudDraft(
      source,
      { type: 'set-locked', locked: false },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const protectedSelection = reduceMobileHudDraft(
      unlocked,
      { type: 'select-surface', surfaceId: 'protected.system.center_message' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const hiddenSelection = reduceMobileHudDraft(
      unlocked,
      { type: 'select-surface', surfaceId: 'status.arena.generic' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const visibleSelection = reduceMobileHudDraft(
      unlocked,
      { type: 'select-surface', surfaceId: 'status.vale_cup.indicator' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(source.locked).toBe(true);
    expect(unlocked.locked).toBe(false);
    expect(protectedSelection).toBe(unlocked);
    expect(hiddenSelection).toBe(unlocked);
    expect(visibleSelection.selectedSurfaceId).toBe('status.vale_cup.indicator');
  });

  it('switches canonical context and clears a selection that is no longer visible', () => {
    const source = makeDraft({ locked: false, selectedSurfaceId: 'status.vale_cup.indicator' });
    const next = reduceMobileHudDraft(
      source,
      { type: 'set-context', contextId: 'arena.standard' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(next).toMatchObject({
      sceneId: 'arena.standard',
      contextId: 'arena.standard',
      selectedSurfaceId: null,
    });
    expect(source.contextId).toBe('world.vale_cup_indicator');
  });

  it('inverse-anchors a moved final rectangle into the active profile only', () => {
    const source = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    const before = structuredClone(source);
    const next = reduceMobileHudDraft(
      source,
      {
        type: 'move-selected',
        topLeft: { x: 100, y: 50 },
        size: { width: 48, height: 48 },
        geometry: draftGeometry,
        handedness: 'right',
      },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(next.document.profiles.phone?.['action.a1']).toEqual({
      anchor: 'top-left',
      offsetX: 100,
      offsetY: 50,
      scale: 1,
    });
    expect(source).toEqual(before);
    expect(next.entryDocument).toBe(source.entryDocument);
  });

  it('inverse-mirrors a left-handed drag before updating canonical right-handed data', () => {
    const source = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    const next = reduceMobileHudDraft(
      source,
      {
        type: 'move-selected',
        topLeft: { x: 30, y: 40 },
        size: { width: 48, height: 48 },
        geometry: draftGeometry,
        handedness: 'left',
      },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(next.document.profiles.phone?.['action.a1']).toEqual({
      anchor: 'top-right',
      offsetX: -30,
      offsetY: 40,
      scale: 1,
    });
  });

  it('steps scale within descriptor limits and clamps repeated changes', () => {
    const source = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    const maximum = reduceMobileHudDraft(
      source,
      { type: 'scale-selected', steps: 20, handedness: 'right' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const minimum = reduceMobileHudDraft(
      maximum,
      { type: 'scale-selected', steps: -20, handedness: 'right' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(maximum.document.profiles.phone?.['action.a1']?.scale).toBe(1.5);
    expect(minimum.document.profiles.phone?.['action.a1']?.scale).toBe(0.5);
  });

  it('nudges in unscaled visual CSS pixels and inverse-mirrors left-handed input', () => {
    const source = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    const right = reduceMobileHudDraft(
      source,
      { type: 'nudge-selected', deltaX: 5, deltaY: -3, handedness: 'right' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const left = reduceMobileHudDraft(
      source,
      { type: 'nudge-selected', deltaX: 5, deltaY: -3, handedness: 'left' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(right.document.profiles.phone?.['action.a1']).toMatchObject({
      offsetX: -5,
      offsetY: 17,
    });
    expect(left.document.profiles.phone?.['action.a1']).toMatchObject({
      offsetX: -15,
      offsetY: 17,
    });
  });

  it('applies only capabilities declared by the selected descriptor', () => {
    const action = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    expect(
      reduceMobileHudDraft(
        action,
        { type: 'toggle-orientation', handedness: 'right' },
        { registry: MOBILE_HUD_REGISTRY },
      ),
    ).toBe(action);

    const party = makeDraft({ locked: false, selectedSurfaceId: 'party' });
    const vertical = reduceMobileHudDraft(
      party,
      { type: 'toggle-orientation', handedness: 'right' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const reversed = reduceMobileHudDraft(
      vertical,
      { type: 'toggle-reverse', handedness: 'right' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(reversed.document.profiles.phone?.party).toMatchObject({
      orientation: 'vertical',
      reverse: true,
    });
  });

  it('does not reverse vertical item order solely because handedness changes', () => {
    expect(
      mirrorMobileHudPlacement(
        {
          anchor: 'top-left',
          offsetX: 10,
          offsetY: 10,
          scale: 1,
          orientation: 'vertical',
          reverse: false,
        },
        'position-and-order',
      ).reverse,
    ).toBe(false);
  });

  it('round-trips repeated left-handed order and opening actions through canonical data', () => {
    const party = makeDraft({ locked: false, selectedSurfaceId: 'party' });
    const partyOnce = reduceMobileHudDraft(
      party,
      { type: 'toggle-reverse', handedness: 'left' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    const partyTwice = reduceMobileHudDraft(
      partyOnce,
      { type: 'toggle-reverse', handedness: 'left' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(partyTwice.document.profiles.phone?.party).toEqual(party.document.profiles.phone?.party);

    let consumables = makeDraft({ locked: false, selectedSurfaceId: 'utility.consumables' });
    for (let index = 0; index < 4; index += 1) {
      consumables = reduceMobileHudDraft(
        consumables,
        { type: 'cycle-opening-direction', handedness: 'left' },
        { registry: MOBILE_HUD_REGISTRY },
      );
    }
    expect(consumables.document.profiles.phone?.['utility.consumables']).toEqual(
      makeDraft().document.profiles.phone?.['utility.consumables'],
    );
  });

  it('resets the selected surface from deterministic defaults without touching the inactive profile', () => {
    const base = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    const source: MobileHudDraft = {
      ...base,
      document: {
        ...base.document,
        profiles: {
          ...base.document.profiles,
          phone: {
            ...base.document.profiles.phone,
            'action.a1': { anchor: 'center', offsetX: 77, offsetY: 66, scale: 1.4 },
          },
        },
      },
    };
    const tabletBefore = source.document.profiles.tablet;
    const next = reduceMobileHudDraft(
      source,
      { type: 'reset-selected' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(next.document.profiles.phone?.['action.a1']).toEqual(
      MOBILE_HUD_REGISTRY.defaults.phone?.['action.a1'],
    );
    expect(next.document.profiles.tablet).toBe(tabletBefore);
  });

  it('resets all active-profile surfaces while preserving inactive bytes and enabled state', () => {
    const base = makeDraft({ locked: false });
    const source = { ...base, document: { ...base.document, enabled: false } };
    const tabletBefore = JSON.stringify(source.document.profiles.tablet);
    const next = reduceMobileHudDraft(
      source,
      { type: 'reset-all' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(next.document.enabled).toBe(false);
    expect(next.document.profiles.phone).toEqual(MOBILE_HUD_REGISTRY.defaults.phone);
    expect(JSON.stringify(next.document.profiles.tablet)).toBe(tabletBefore);
  });

  it('cycles every ordered failure with wraparound and selects its exact context', () => {
    const failures: MobileHudDraft['failures'] = [
      {
        reason: 'invalid-placement',
        profileId: 'phone',
        contextId: 'arena.fiesta.offer',
        surfaceIds: ['action.a1'],
        viewportId: 'phone-740x360',
      },
      {
        reason: 'scale-out-of-range',
        profileId: 'tablet',
        contextId: 'vale_cup.match.charge',
        surfaceIds: ['status.vale_cup.charge'],
        viewportId: 'tablet-1024x768',
      },
      {
        reason: 'target-too-small',
        profileId: 'phone',
        contextId: 'instance.delve',
        surfaceIds: ['control.movement'],
        viewportId: 'phone-932x430',
      },
    ];
    let draft = makeDraft({ locked: false, failures });
    const visited: Array<[number | null, string, string]> = [];
    for (let index = 0; index < 4; index += 1) {
      draft = reduceMobileHudDraft(
        draft,
        { type: 'show-next-failure' },
        {
          registry: MOBILE_HUD_REGISTRY,
        },
      );
      visited.push([draft.activeFailureIndex, draft.activeProfileId, draft.contextId]);
    }
    expect(visited).toEqual([
      [0, 'phone', 'arena.fiesta.offer'],
      [1, 'tablet', 'vale_cup.match.charge'],
      [2, 'phone', 'instance.delve'],
      [0, 'phone', 'arena.fiesta.offer'],
    ]);
  });

  it('detects dirty state and restores the exact entry snapshot', () => {
    const source = makeDraft({ locked: false, selectedSurfaceId: 'action.a1' });
    const changed = reduceMobileHudDraft(
      source,
      { type: 'nudge-selected', deltaX: 1, deltaY: 0, handedness: 'right' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(isMobileHudDraftDirty(source)).toBe(false);
    expect(isMobileHudDraftDirty(changed)).toBe(true);
    const restored = reduceMobileHudDraft(
      changed,
      { type: 'restore-entry' },
      { registry: MOBILE_HUD_REGISTRY },
    );
    expect(restored.document).toBe(source.entryDocument);
    expect(restored.document.enabled).toBe(source.entryDocument.enabled);
    expect(isMobileHudDraftDirty(restored)).toBe(false);
  });
});
