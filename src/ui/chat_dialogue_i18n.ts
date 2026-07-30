import type { Entity, PlayerClass } from '../sim/types';
import { tEntity } from './entity_i18n';
import { localizeSimText } from './sim_i18n';

export interface ChatDialogueEvent {
  channel?: string;
  entityId?: number;
  classId?: PlayerClass;
  from: string;
  text: string;
}

export interface ChatDialoguePresentation {
  from: string;
  text: string;
}

/** Localize authored NPC and mob yells without ever rewriting player-authored chat. */
export function chatDialoguePresentation(
  event: ChatDialogueEvent,
  speaker: Entity | undefined,
): ChatDialoguePresentation {
  const authoredSpeaker =
    speaker !== undefined &&
    event.channel === 'yell' &&
    event.entityId === speaker.id &&
    event.classId === undefined &&
    (speaker.kind === 'npc' || (speaker.kind === 'mob' && speaker.ownerId === null));
  if (!authoredSpeaker) return { from: event.from, text: event.text };

  const from =
    speaker.kind === 'npc'
      ? tEntity({ kind: 'npc', id: speaker.templateId, field: 'name' })
      : tEntity({ kind: 'mob', id: speaker.templateId, field: 'name' });
  return {
    from,
    text: localizeSimText(event.text) ?? event.text,
  };
}
