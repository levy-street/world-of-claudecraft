import { PrewarmCompletionError } from '../render/prewarm_completion';
import { technicalErrorMessage } from '../ui/api_error_i18n';
import { t } from '../ui/i18n';

/** Complete desktop preparation is an entry contract; offer the existing reload
 * recovery instead of silently moving unfinished shader links into gameplay. */
export function handlePrewarmEntryFailure(
  error: unknown,
  showFatal: (message: string) => void,
): boolean {
  console.warn('Renderer prewarm failed', error);
  if (!(error instanceof PrewarmCompletionError)) return false;
  showFatal(t('loading.rendererFailed', { error: technicalErrorMessage(error) }));
  return true;
}
