// The owner-session speech bubbles the renderer projects with no sim event:
// the forge master's instructions (forge_speech.ts) and the Graveyard Shift
// grave's whisper. Client only, no broadcast, no wire, no sim state; the
// renderer's chat-bubble update calls this once per frame.
import { GRAVE_ENTITY_ID } from '../sim/graveyard_shift/grave_entry';
import type { ChatBubbleStyle } from '../ui/chat_bubble_style';
import { t } from '../ui/i18n';
import type { IWorld } from '../world_api';
import { updateForgeSpeech } from './forge_speech';
import {
  freshGraveWhisperState,
  type GraveWhisperState,
  graveWhisperDue,
} from './grave_whisper_core';

interface SpeechHost {
  showChatBubble(
    entityId: number,
    text: string,
    style?: boolean | ChatBubbleStyle,
    ttlSec?: number,
  ): void;
}

// Each renderer session keeps its own whisper state (grave_whisper_core.ts).
const whisperStates = new WeakMap<SpeechHost, GraveWhisperState>();
const GRAVE_WHISPER_TTL_SEC = 4;

export function updateWorldSpeech(
  world: Pick<IWorld, 'worldQuestLog' | 'entities' | 'player'>,
  host: SpeechHost,
  nowMs = performance.now(),
): void {
  updateForgeSpeech(world, host);
  // No grave (the common case, and a world still loading) reads nothing else.
  const grave = world.entities.get(GRAVE_ENTITY_ID);
  if (!grave || !world.player) return;
  let state = whisperStates.get(host);
  if (!state) {
    state = freshGraveWhisperState();
    whisperStates.set(host, state);
  }
  if (!graveWhisperDue(grave.pos, world.player.pos, state, nowMs)) return;
  host.showChatBubble(
    GRAVE_ENTITY_ID,
    t('graveyardShift.tibbs.whisper'),
    undefined,
    GRAVE_WHISPER_TTL_SEC,
  );
}
