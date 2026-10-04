// The overhead plate of a player covering Morthen's shift (the Graveyard
// Shift): to every viewer, the owner's own included, it reads as the boss the
// way his mob plate does (his name, the boss frame, the elite mark and his
// "10+" level, conned against the viewer), and none of the player's own lines (guild, deed
// title and border, tags, badges). The painter calls it only for a player who
// holds the identity, after its reset pass; it writes the plate state and
// reaches no DOM.
import { hasMorthenIdentity } from '../sim/graveyard_shift/morthen_identity';
import type { Entity } from '../sim/types';
import { bossLevelText, playerFrameName } from '../ui/graveyard_shift_text_core';
import type { NameplateCanvasState } from './nameplate_canvas';
import { mobNameColor } from './reaction';

export function isMorthenPlate(entity: Pick<Entity, 'kind' | 'auras'>): boolean {
  return entity.kind === 'player' && hasMorthenIdentity(entity);
}

export function applyMorthenNameplate(
  state: NameplateCanvasState,
  entity: Pick<Entity, 'auras' | 'name' | 'dead' | 'level'>,
  viewerLevel: number,
): void {
  state.name = playerFrameName(entity);
  state.nameColor = '#fff';
  state.level = bossLevelText(entity.level);
  state.levelColor = mobNameColor(entity.level - viewerLevel, false, false);
  state.marker = entity.dead ? '' : '◆';
  state.markerTone = 'none';
  state.frame = entity.dead ? '' : 'boss';
  state.hpVisible = !entity.dead;
  state.badges.length = 0;
}
