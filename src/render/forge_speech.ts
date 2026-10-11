import { FORGE_NPC_ID, FORGE_QUEST_ID } from '../sim/content/world_quest_forging';
import type { ChatBubbleStyle } from '../ui/chat_bubble_style';
import { forgeSpeechText } from '../ui/world_quest_forge_view';
import type { IWorld } from '../world_api';

interface SpeechHost {
  showChatBubble(
    entityId: number,
    text: string,
    style?: boolean | ChatBubbleStyle,
    ttlSec?: number,
  ): void;
}

const states = new WeakMap<SpeechHost, { key: string; active: boolean }>();

/** Owner-session projection: no broadcast, wall timer, or new speech DOM. */
export function updateForgeSpeech(world: Pick<IWorld, 'worldQuestLog'>, host: SpeechHost): void {
  const progress = world.worldQuestLog.get(FORGE_QUEST_ID);
  const session = progress?.forging;
  const text = progress ? forgeSpeechText(progress) : null;
  const previous = states.get(host);
  if (!session || !text) {
    if (previous?.active) host.showChatBubble(FORGE_NPC_ID, '', false, 0);
    states.delete(host);
    return;
  }
  const active = session.phase !== 'success';
  const key = `${session.startedAt}:${session.phase}:${session.strikes}:${session.feedback}:${text}`;
  if (previous?.key === key) return;
  states.set(host, { key, active });
  // A required instruction cannot expire while the player is still choosing.
  host.showChatBubble(FORGE_NPC_ID, text, { offsetY: -32 }, active ? Infinity : 5);
}
