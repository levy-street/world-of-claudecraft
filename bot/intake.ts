// Pure bug-intake helpers for the Discord bot. V1 keeps message capture and
// Trello/GitHub writes out of this layer; it only decides whether a single
// Discord message is worth promoting into short-lived bug intake.

export interface IntakeAttachment {
  id: string;
  filename?: string | null;
  contentType?: string | null;
  url?: string | null;
}

export interface IntakeMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorIsBot?: boolean;
  webhookId?: string | null;
  content: string;
  attachments?: readonly IntakeAttachment[];
}

export interface IntakeOptions {
  monitoredChannelIds: ReadonlySet<string>;
  minCandidateWords?: number;
}

export type BugIntakeDecision =
  | {
      action: 'ignore';
      reason:
        | 'bot'
        | 'webhook'
        | 'unmonitored-channel'
        | 'empty'
        | 'feature-request'
        | 'low-confidence';
    }
  | {
      action: 'candidate';
      confidence: 'medium' | 'high';
      summary: string;
      evidence: {
        attachments: number;
        hasImage: boolean;
        hasVideo: boolean;
        hasReproLanguage: boolean;
        hasErrorLanguage: boolean;
      };
      needsMoreInfo: boolean;
    };

const BUG_PATTERNS: readonly RegExp[] = [
  /\bbug(?:ged)?\b/i,
  /\bcrash(?:ed|es|ing)?\b/i,
  /\berror(?:s)?\b/i,
  /\bexception\b/i,
  /\bstuck\b/i,
  /\bfrozen?\b/i,
  /\bdisconnect(?:ed|s|ing)?\b/i,
  /\bdesync(?:ed)?\b/i,
  /\bexploit\b/i,
  /\bglitch(?:ed|es|ing)?\b/i,
  /\bbroken\b/i,
  /\bnot working\b/i,
  /\bdoes(?:n'| no)t work\b/i,
  /\bcan(?:'|no)t\b/i,
  /\bwrong\b/i,
  /\bmissing\b/i,
  /\bclipp(?:ed|ing)\b/i,
  /\bduplicate(?:d)?\b/i,
  /\bfail(?:ed|s|ing)?\b/i,
];

const REPRO_PATTERNS: readonly RegExp[] = [
  /\bsteps?\b/i,
  /\brepro(?:duce|duction|s)?\b/i,
  /\bwhen i\b/i,
  /\bafter i\b/i,
  /\bevery time\b/i,
  /\bonce i\b/i,
  /\bwhile (?:i|we)\b/i,
];

const FEATURE_PATTERNS: readonly RegExp[] = [
  /\bfeature request\b/i,
  /\bsuggestion\b/i,
  /\bidea\b/i,
  /\bwould be (?:cool|nice|great)\b/i,
  /\bplease add\b/i,
  /\bcould you add\b/i,
  /\bcan you add\b/i,
  /\bi wish\b/i,
];

const URL_RE = /https?:\/\/\S+/gi;
const MAX_SUMMARY = 120;

export function classifyBugIntakeMessage(
  message: IntakeMessage,
  options: IntakeOptions,
): BugIntakeDecision {
  if (message.authorIsBot) return { action: 'ignore', reason: 'bot' };
  if (message.webhookId) return { action: 'ignore', reason: 'webhook' };
  if (!options.monitoredChannelIds.has(message.channelId)) {
    return { action: 'ignore', reason: 'unmonitored-channel' };
  }

  const content = normalizeMessage(message.content);
  const attachments = message.attachments ?? [];
  if (!content && attachments.length === 0) return { action: 'ignore', reason: 'empty' };

  const hasBugLanguage = BUG_PATTERNS.some((re) => re.test(content));
  const hasReproLanguage = REPRO_PATTERNS.some((re) => re.test(content));
  const hasFeatureLanguage = FEATURE_PATTERNS.some((re) => re.test(content));
  const hasImage = attachments.some((a) => isAttachmentType(a, 'image'));
  const hasVideo = attachments.some((a) => isAttachmentType(a, 'video'));
  const hasMediaEvidence = hasImage || hasVideo;
  const wordCount = content ? content.split(/\s+/).length : 0;
  const minWords = options.minCandidateWords ?? 4;

  if (hasFeatureLanguage && !hasBugLanguage) return { action: 'ignore', reason: 'feature-request' };
  if (!hasBugLanguage && !hasMediaEvidence) return { action: 'ignore', reason: 'low-confidence' };
  if (!hasBugLanguage && wordCount < minWords)
    return { action: 'ignore', reason: 'low-confidence' };

  const hasErrorLanguage = /\b(?:error|exception|stack|console|trace)\b/i.test(content);
  const confidence =
    hasBugLanguage && (hasReproLanguage || hasErrorLanguage || hasMediaEvidence)
      ? 'high'
      : 'medium';

  return {
    action: 'candidate',
    confidence,
    summary: summarize(content, attachments),
    evidence: {
      attachments: attachments.length,
      hasImage,
      hasVideo,
      hasReproLanguage,
      hasErrorLanguage,
    },
    needsMoreInfo: confidence === 'medium' && !hasReproLanguage && !hasMediaEvidence,
  };
}

function normalizeMessage(content: string): string {
  return content.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
}

function summarize(content: string, attachments: readonly IntakeAttachment[]): string {
  const base = content || attachmentSummary(attachments);
  return base.length > MAX_SUMMARY ? `${base.slice(0, MAX_SUMMARY - 3).trimEnd()}...` : base;
}

function attachmentSummary(attachments: readonly IntakeAttachment[]): string {
  if (attachments.length === 1)
    return `Attachment: ${attachments[0].filename || attachments[0].id}`;
  return `${attachments.length} attachments`;
}

function isAttachmentType(attachment: IntakeAttachment, kind: 'image' | 'video'): boolean {
  const contentType = attachment.contentType?.toLowerCase() ?? '';
  if (contentType.startsWith(`${kind}/`)) return true;
  const filename = attachment.filename?.toLowerCase() ?? '';
  return kind === 'image'
    ? /\.(png|jpe?g|gif|webp|avif)$/.test(filename)
    : /\.(mp4|mov|webm|m4v)$/.test(filename);
}
