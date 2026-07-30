import type { Entity, PlayerClass } from '../sim/types';
import { tEntity } from './entity_i18n';
import { localizeSimText } from './sim_i18n';

export interface ChatDialogueEvent {
  channel?: string;
  entityId?: number;
  classId?: PlayerClass;
  authoredSpeaker?: { kind: 'npc' | 'mob'; templateId: string };
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
  const authoredIdentity =
    event.authoredSpeaker ??
    (speaker &&
    event.entityId === speaker.id &&
    event.classId === undefined &&
    (speaker.kind === 'npc' || (speaker.kind === 'mob' && speaker.ownerId === null))
      ? { kind: speaker.kind, templateId: speaker.templateId }
      : undefined);
  const authoredSpeaker =
    event.channel === 'yell' && event.classId === undefined && authoredIdentity !== undefined;
  if (!authoredSpeaker) return { from: event.from, text: event.text };

  const from =
    authoredIdentity.kind === 'npc'
      ? tEntity({ kind: 'npc', id: authoredIdentity.templateId, field: 'name' })
      : tEntity({ kind: 'mob', id: authoredIdentity.templateId, field: 'name' });
  return {
    from,
    text: localizeSimText(event.text) ?? event.text,
  };
}
