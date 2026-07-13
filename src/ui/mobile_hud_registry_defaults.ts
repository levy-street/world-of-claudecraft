import type { MobileHudPlacement, MobileHudSurfaceId } from './mobile_hud_editor_types';

function placement(
  anchor: MobileHudPlacement['anchor'],
  offsetX: number,
  offsetY: number,
  extras: Partial<Omit<MobileHudPlacement, 'anchor' | 'offsetX' | 'offsetY'>> = {},
): MobileHudPlacement {
  return { anchor, offsetX, offsetY, scale: 1, ...extras };
}

export function createMobileHudDefaultPlacements(): Readonly<{
  phone: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>;
  tablet: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>;
}> {
  const phone: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {
    'action.a1': placement('bottom-right', -88, -130),
    'action.a2': placement('bottom-right', -38, -130),
    'action.a3': placement('bottom-right', -82, -68),
    'action.a4': placement('bottom-right', -32, -68),
    'action.a5': placement('bottom-right', -156, -18),
    'action.attack': placement('bottom-right', -139, -180),
    'action.target': placement('bottom-right', -106, -18),
    'action.jump_use': placement('bottom-right', -53.6, -15.6, { scale: 0.9 }),
    'action.page': placement('top-left', 6, 108),
    'control.movement': placement('bottom-left', 12, -12.2, { scale: 0.9 }),
    'control.view': placement('top-right', 59, 39),
    'utility.consumables': placement('top-left', 6, 6, { openingDirection: 'right' }),
    'pet.commands': placement('bottom-center', 32, -18, {
      orientation: 'horizontal',
      reverse: false,
    }),
    party: placement('top-center', 80, 6, { orientation: 'horizontal', reverse: false }),
    'menu.top': placement('top-center', 48, 48, {
      orientation: 'horizontal',
      reverse: false,
    }),
    'minimap.cluster': placement('top-left', 135, 108, { scale: 0.8 }),
    'frame.target': placement('top-center', 36.4, 98, { scale: 0.8 }),
    'frame.player': placement('bottom-center', 68, -68, { scale: 0.8 }),
    'auras.player_buffs': placement('top-left', 136, 216, {
      orientation: 'horizontal',
      reverse: false,
    }),
    'auras.player_debuffs': placement('top-left', 136, 256, {
      orientation: 'horizontal',
      reverse: false,
    }),
    'status.arena.generic': placement('top-center', 0, 6),
    'status.arena.fiesta_score': placement('top-center', 0, 6),
    'status.arena.fiesta_pending': placement('top-center', 0, 68),
    'status.arena.yumi': placement('top-right', 0, 101),
    'status.vale_cup.indicator': placement('top-left', 136, 296),
    'status.vale_cup.match': placement('top-center', 0, 6),
    'status.vale_cup.charge': placement('bottom-center', 0, -128),
    'tracker.deeds': placement('top-right', -6, 6),
    'tracker.delve': placement('top-left', 6, 112),
  };

  const tablet: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {
    ...phone,
    'action.a1': placement('bottom-right', -212, -90),
    'action.a2': placement('bottom-right', -150, -90),
    'action.a3': placement('bottom-right', -270, -90),
    'action.a4': placement('bottom-right', -150, -20),
    'action.a5': placement('bottom-right', -88, -20),
    'action.attack': placement('bottom-right', -88, -90),
    'action.target': placement('bottom-right', -22, -90),
    'action.jump_use': placement('bottom-right', -18, -20),
    'action.page': placement('bottom-right', -254, -20),
    'control.movement': placement('bottom-left', 12, -12),
    'control.view': placement('top-right', -24, 80),
    'utility.consumables': placement('bottom-left', 154, -90, { openingDirection: 'right' }),
    'pet.commands': placement('bottom-right', -18, -154, {
      orientation: 'horizontal',
      reverse: false,
    }),
    party: placement('top-left', 168, 10, { orientation: 'horizontal', reverse: false }),
    'menu.top': placement('top-right', -16, 12, { orientation: 'horizontal', reverse: false }),
    'minimap.cluster': placement('top-left', 10, 10),
    'frame.target': placement('top-center', 0, 52),
    'frame.player': placement('bottom-center', 0, -20),
    'status.arena.yumi': placement('top-center', 0, 55),
    'status.vale_cup.indicator': placement('top-left', 430, 196),
    'auras.player_buffs': placement('top-left', 168, 196, {
      orientation: 'horizontal',
      reverse: false,
    }),
    'auras.player_debuffs': placement('top-left', 168, 240, {
      orientation: 'horizontal',
      reverse: false,
    }),
    'tracker.deeds': placement('top-left', 10, 150),
    'tracker.delve': placement('top-left', 342, 196),
  };

  return { phone, tablet };
}
