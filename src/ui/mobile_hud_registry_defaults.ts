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
    'action.a1': placement('bottom-right', -178, -70),
    'action.a2': placement('bottom-right', -126, -70),
    'action.a3': placement('bottom-right', -178, -10),
    'action.a4': placement('bottom-right', -126, -10),
    'action.a5': placement('bottom-right', -74, -10),
    'action.attack': placement('bottom-right', -74, -70),
    'action.target': placement('bottom-right', -18, -70),
    'action.jump_use': placement('bottom-right', -14, -10),
    'action.page': placement('bottom-right', -230, -10),
    'control.movement': placement('bottom-left', 0, 0),
    'control.view': placement('top-right', -18, 64),
    'utility.consumables': placement('bottom-left', 136, -68, { openingDirection: 'right' }),
    'pet.commands': placement('bottom-right', -14, -126, {
      orientation: 'horizontal',
      reverse: false,
    }),
    party: placement('top-left', 101, 6, { orientation: 'horizontal', reverse: false }),
    'menu.top': placement('top-right', -12, 8, { orientation: 'horizontal', reverse: false }),
    'minimap.cluster': placement('top-left', 6, 6, { scale: 0.6 }),
    'frame.target': placement('top-center', 0, 8, { scale: 0.65 }),
    'frame.player': placement('bottom-center', 0, -10, { scale: 0.7 }),
    'auras.player_buffs': placement('top-right', -172, 8, {
      scale: 0.75,
      orientation: 'horizontal',
      reverse: false,
    }),
    'auras.player_debuffs': placement('top-right', -172, 40, {
      scale: 0.75,
      orientation: 'horizontal',
      reverse: false,
    }),
    'status.arena.generic': placement('top-center', 0, 6),
    'status.arena.fiesta_score': placement('top-center', 0, 6),
    'status.arena.fiesta_pending': placement('top-center', 0, 68),
    'status.arena.yumi': placement('top-center', 0, 6),
    'status.vale_cup.indicator': placement('top-center', 0, 6),
    'status.vale_cup.match': placement('top-center', 0, 6),
    'status.vale_cup.charge': placement('bottom-center', 0, -128),
    'tracker.deeds': placement('top-right', -12, 56),
    'tracker.delve': placement('top-right', -12, 96),
  };

  const tablet: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {
    ...phone,
    'action.a1': placement('bottom-right', -212, -90),
    'action.a2': placement('bottom-right', -150, -90),
    'action.a3': placement('bottom-right', -212, -20),
    'action.a4': placement('bottom-right', -150, -20),
    'action.a5': placement('bottom-right', -88, -20),
    'action.attack': placement('bottom-right', -88, -90),
    'action.target': placement('bottom-right', -22, -90),
    'action.jump_use': placement('bottom-right', -18, -20),
    'action.page': placement('bottom-right', -274, -20),
    'control.movement': placement('bottom-left', 0, 0),
    'control.view': placement('top-right', -24, 80),
    'utility.consumables': placement('bottom-left', 154, -16, { openingDirection: 'right' }),
    'pet.commands': placement('bottom-right', -18, -154, {
      orientation: 'horizontal',
      reverse: false,
    }),
    party: placement('top-left', 101, 6, { orientation: 'horizontal', reverse: false }),
    'menu.top': placement('top-right', -12, 8, { orientation: 'horizontal', reverse: false }),
    'minimap.cluster': placement('top-left', 6, 6, { scale: 0.6 }),
    'frame.target': placement('top-center', 0, 8),
    'frame.player': placement('bottom-center', 0, -10, { scale: 1.1 }),
    'auras.player_buffs': placement('top-right', -276, 8, {
      scale: 0.75,
      orientation: 'horizontal',
      reverse: false,
    }),
    'auras.player_debuffs': placement('top-right', -276, 40, {
      scale: 0.75,
      orientation: 'horizontal',
      reverse: false,
    }),
    'tracker.deeds': placement('top-right', -16, 66),
    'tracker.delve': placement('top-right', -16, 116),
  };

  return { phone, tablet };
}
