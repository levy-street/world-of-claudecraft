// Voice-clip key resolvers for the HUD's combat and dialogue audio. These are
// the thin bindings between the pure cue resolvers in combat_sfx.ts and the
// live sfx facade: combat_sfx.ts stays probe-injected and testable, and the
// coordinator does not restate the injection at every call site.

import { sfx } from '../game/sfx';
import { voice } from '../game/voice';
import { type MobVoiceAction, mobVoiceCue } from './combat_sfx';

/** The `hasCue` probe the gendered player-voice resolver checks its candidate
 *  key against, bound to the clips actually loaded. */
export function sfxHasCue(key: string): boolean {
  return sfx.hasVariants(key);
}

/** Mob voice cue for a template and action, or null when that mob ships no
 *  take for it. The audibility probe is read live, not captured: mobVoiceCue's
 *  `semanticVoiceEnabled` arm defaults to false, so omitting it here would
 *  silently mute the semantic boss takes (aggro/death on the scripted raid
 *  templates) that the HUD used to enable inline. */
export function availableMobVoiceCue(templateId: string, action: MobVoiceAction): string | null {
  return mobVoiceCue(templateId, action, sfxHasCue, voice.isAudible());
}

// Stable voice-clip key for a spoken yell line. MUST match the generator slug in
// scripts/voices/extra_lines.mjs (yellKey) so encounter dialogue (e.g. the
// Nythraxis raid) plays the right clip from the live chat event text.
export function yellVoiceKey(text: string): string {
  return `yell__${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)}`;
}
