export const DEFAULT_DIALOGUE_MAX_WORDS = 45;

export interface DialogueNpcProfile {
  id: string;
  name: string;
  title?: string | null;
  canonicalGreeting: string;
  zone?: string | null;
  questTitles?: readonly string[];
}

export interface DialoguePlayerProfile {
  name?: string | null;
  className?: string | null;
  level?: number | null;
}

export interface DialogueRequest {
  locale: string;
  languageName?: string | null;
  npc: DialogueNpcProfile;
  player?: DialoguePlayerProfile | null;
  maxWords?: number | null;
}

export interface DialoguePrompt {
  system: string;
  user: string;
}

export interface DialogueResult {
  text: string;
  source: 'static' | 'local-model' | 'server-model';
  fallback: boolean;
  model?: string;
}

export interface DialogueProvider {
  generateNpcDialogue(request: DialogueRequest, signal?: AbortSignal): Promise<DialogueResult>;
}

export class StaticDialogueProvider implements DialogueProvider {
  async generateNpcDialogue(request: DialogueRequest): Promise<DialogueResult> {
    return staticDialogueResult(request);
  }
}

export function staticDialogueResult(request: DialogueRequest): DialogueResult {
  return {
    text: cleanOneLine(request.npc.canonicalGreeting),
    source: 'static',
    fallback: true,
  };
}

export function buildPersonaPrompt(request: DialogueRequest): DialoguePrompt {
  const npc = request.npc;
  const maxWords = clampMaxWords(request.maxWords);
  const language = cleanOneLine(request.languageName || request.locale);
  const title = cleanOneLine(npc.title ?? '');
  const zone = cleanOneLine(npc.zone ?? '');
  const questTitles = (npc.questTitles ?? []).map(cleanOneLine).filter(Boolean);
  const player = request.player ?? null;
  const playerLevel = player?.level;
  const playerBits = [
    player?.name ? `name: ${cleanOneLine(player.name)}` : null,
    player?.className ? `class: ${cleanOneLine(player.className)}` : null,
    typeof playerLevel === 'number' && Number.isFinite(playerLevel)
      ? `level: ${playerLevel}`
      : null,
  ].filter(Boolean);

  const userLines = [
    `NPC: ${cleanOneLine(npc.name)}${title ? `, ${title}` : ''}`,
    `Locale: ${request.locale}`,
    `Reply language: ${language}`,
    zone ? `Zone: ${zone}` : null,
    `Canonical greeting: ${cleanOneLine(npc.canonicalGreeting)}`,
    questTitles.length ? `Known quest topics: ${questTitles.join(', ')}` : null,
    playerBits.length ? `Player: ${playerBits.join(', ')}` : null,
    `Limit: ${maxWords} words.`,
  ].filter((line): line is string => !!line);

  return {
    system: [
      'You write optional cosmetic NPC banter for World of ClaudeCraft.',
      'The deterministic simulation, quest state, rewards, combat, and economy are already decided elsewhere.',
      'Never invent gameplay facts, rewards, coordinates, account instructions, wallet instructions, secrets, or roadmap promises.',
      'Keep the canonical greeting true. Add only harmless flavor in the requested language.',
      'Return one short in-character line, with no markdown and no speaker label.',
    ].join(' '),
    user: userLines.join('\n'),
  };
}

function clampMaxWords(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DIALOGUE_MAX_WORDS;
  return Math.max(12, Math.min(80, Math.trunc(value)));
}

function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
