// Client mirror of the server's suspicion-flag workflow vocabulary
// (server/suspicion_flag_workflow.ts), the permissions.ts precedent: admin
// client code never imports server modules, and parity is pinned by
// tests/suspicion_flags.test.ts. Used to render the workflow controls; the
// server re-validates every transition.

export const FLAG_STATUSES = ['new', 'under_review', 'cleared', 'actioned'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

export const FLAG_ACTIVE_STATUSES = ['new', 'under_review'] as const;

const TRANSITIONS: Record<FlagStatus, readonly FlagStatus[]> = {
  new: ['under_review', 'cleared', 'actioned'],
  under_review: ['cleared', 'actioned'],
  cleared: ['under_review'],
  actioned: ['under_review'],
};

export function allowedFlagTransitions(from: FlagStatus): readonly FlagStatus[] {
  return TRANSITIONS[from];
}

export function isFlagStatus(value: unknown): value is FlagStatus {
  return typeof value === 'string' && (FLAG_STATUSES as readonly string[]).includes(value);
}

/** i18n key for a status label (flags.statusNew, flags.statusUnderReview, ...). */
export function flagStatusLabelKey(status: FlagStatus): string {
  switch (status) {
    case 'new':
      return 'flags.statusNew';
    case 'under_review':
      return 'flags.statusUnderReview';
    case 'cleared':
      return 'flags.statusCleared';
    case 'actioned':
      return 'flags.statusActioned';
  }
}

/** i18n key for a severity label. */
export function flagSeverityLabelKey(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'low':
      return 'flags.severityLow';
    case 'medium':
      return 'flags.severityMedium';
    case 'high':
      return 'flags.severityHigh';
  }
}

/** i18n key for a flag source label. */
export function flagSourceLabelKey(source: string): string {
  switch (source) {
    case 'bot_detector':
      return 'flags.sourceBotDetector';
    case 'registration_burst':
      return 'flags.sourceRegistrationBurst';
    case 'economy_watch':
      return 'flags.sourceEconomyWatch';
    default:
      return 'flags.sourceOther';
  }
}

/** Badge variant for a status (the shared Badge component's vocabulary). */
export function flagStatusBadgeVariant(status: FlagStatus): 'warn' | 'bad' | 'neutral' | 'success' {
  switch (status) {
    case 'new':
      return 'bad';
    case 'under_review':
      return 'warn';
    case 'cleared':
      return 'success';
    case 'actioned':
      return 'neutral';
  }
}

/** Badge variant for a severity. */
export function flagSeverityBadgeVariant(
  severity: 'low' | 'medium' | 'high',
): 'warn' | 'bad' | 'neutral' {
  switch (severity) {
    case 'high':
      return 'bad';
    case 'medium':
      return 'warn';
    case 'low':
      return 'neutral';
  }
}

/** Gold delta since flagging, or null when either side is unknown. */
export function flagGoldTrendCopper(row: {
  copperAtFlag: number | null;
  copperNow: number | null;
}): number | null {
  if (row.copperAtFlag === null || row.copperNow === null) return null;
  return row.copperNow - row.copperAtFlag;
}
