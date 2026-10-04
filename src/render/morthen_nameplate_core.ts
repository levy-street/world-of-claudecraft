// The overhead plate of a player covering Morthen's shift (the Graveyard
// Shift): to every viewer, the owner's own included, it reads as the boss the
// way his mob plate does (his name, the boss frame and the elite mark) with
// the boss's "??" level, and none of the player's own lines (guild, deed
// title and border, tags, badges). The painter calls it only for a player who
// holds the identity, after its reset pass; it writes the plate state and
// reaches no DOM.
import { hasMorthenIdentity } from '../sim/graveyard_shift/morthen_identity';
import type { Entity } from '../sim/types';
import { BOSS_LEVEL_TEXT, playerFrameName } from '../ui/graveyard_shift_text_core';
import type { NameplateCanvasState } from './nameplate_canvas';
import { mobNameColor } from './reaction';

// The con colour of a boss far above the viewer, whoever is looking.
const BOSS_LEVEL_DIFF = 99;

export function isMorthenPlate(entity: Pick<Entity, 'kind' | 'auras'>): boolean {
  return entity.kind === 'player' && hasMorthenIdentity(entity);
}

export function applyMorthenNameplate(
  state: NameplateCanvasState,
  entity: Pick<Entity, 'auras' | 'name' | 'dead'>,
): void {
  state.name = playerFrameName(entity);
  state.nameColor = '#fff';
  state.level = BOSS_LEVEL_TEXT;
  state.levelColor = mobNameColor(BOSS_LEVEL_DIFF, false, false);
  state.marker = entity.dead ? '' : '◆';
  state.markerTone = 'none';
  state.frame = entity.dead ? '' : 'boss';
  state.hpVisible = !entity.dead;
  state.badges.length = 0;
}
