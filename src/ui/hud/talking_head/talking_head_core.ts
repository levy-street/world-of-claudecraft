// Pure decisions for NPC speech delivery: whether a line rides a world chat
// bubble over the speaker or the Talking Head panel, and how long a panel line
// stays up. No DOM; the controller and the coach consume these.

/** Where a speaker's anchor landed on screen, from Renderer.worldToScreen. */
export interface SpeakerScreenAnchor {
  x: number;
  y: number;
  behind: boolean;
}

export interface SpeakerViewInput {
  anchor: SpeakerScreenAnchor;
  viewportWidth: number;
  viewportHeight: number;
  /** Ground distance from the player to the speaker, in world yards. */
  distanceYd: number;
}

/** Beyond this the rig is culled and a bubble would hang over empty terrain. */
export const SPEAKER_BUBBLE_RANGE_YD = 45;
/** A bubble whose anchor sits this close to the screen edge is clipped or off. */
export const SPEAKER_EDGE_MARGIN_PX = 40;

export type SpeechRoute = 'bubble' | 'panel';

/** True when the speaker is on screen close enough for a bubble to be read. */
export function speakerInView(input: SpeakerViewInput): boolean {
  const { anchor, viewportWidth, viewportHeight, distanceYd } = input;
  if (anchor.behind) return false;
  if (distanceYd > SPEAKER_BUBBLE_RANGE_YD) return false;
  const m = SPEAKER_EDGE_MARGIN_PX;
  return (
    anchor.x >= m &&
    anchor.x <= viewportWidth - m &&
    anchor.y >= m &&
    anchor.y <= viewportHeight - m
  );
}

/** Bubble over a speaker the player can see; the panel when they cannot. */
export function routeSpeech(speakerVisible: boolean): SpeechRoute {
  return speakerVisible ? 'bubble' : 'panel';
}

const PANEL_MIN_SEC = 4;
const PANEL_MAX_SEC = 12;
const PANEL_SEC_PER_CHAR = 0.055;

/** Reading time for a panel line: the bubble ladder with a longer floor, since
 *  a panel line is a full sentence the player did not look for. */
export function panelLineDurationMs(text: string): number {
  return (
    1000 * Math.min(PANEL_MAX_SEC, Math.max(PANEL_MIN_SEC, 2.5 + text.length * PANEL_SEC_PER_CHAR))
  );
}

export interface TalkingHeadLine {
  speakerId: string;
  speakerName: string;
  text: string;
}

export interface TalkingHeadModel {
  line: TalkingHeadLine | null;
  /** Wall-clock ms when the current line should clear. */
  until: number;
}

export const EMPTY_TALKING_HEAD: TalkingHeadModel = { line: null, until: 0 };

/** Show `line` from `now`, replacing whatever is up: guidance lines are rare
 *  and the newest one is the one that matters. */
export function showLine(line: TalkingHeadLine, now: number): TalkingHeadModel {
  return { line, until: now + panelLineDurationMs(line.text) };
}

/** Clear the model once its line has been up long enough. */
export function expireLine(model: TalkingHeadModel, now: number): TalkingHeadModel {
  if (!model.line || now < model.until) return model;
  return EMPTY_TALKING_HEAD;
}
