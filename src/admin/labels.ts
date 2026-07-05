import { t } from './i18n';

// Report-reason code (server enum) -> localized label. Unknown codes fall through to
// the raw code. Ported from the old tables.ts reasonLabel.
export function reasonLabel(reason: string): string {
  return (
    (
      {
        harassment: t('reason.harassment'),
        spam: t('reason.spam'),
        cheating: t('reason.cheating'),
        offensive_name_or_chat: t('reason.offensiveName'),
        other: t('reason.other'),
      } as Record<string, string>
    )[reason] ?? reason
  );
}
