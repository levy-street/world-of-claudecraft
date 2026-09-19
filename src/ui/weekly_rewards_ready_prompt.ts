import { esc } from './esc';
import { t } from './i18n';
import { installPromptDialog } from './prompt_dialog';

/** A visit-local invitation; opening this prompt never claims or rolls an item. */
export function showWeeklyRewardsReadyPrompt(
  root: HTMLElement,
  openRewards: () => void,
  returnFocus: () => void,
): (() => void) | null {
  const stack = document.getElementById('prompt-stack');
  if (!stack) return null;
  const prompt = document.createElement('div');
  prompt.className = 'prompt panel ui-window weekly-ready-prompt';
  prompt.innerHTML = `<h3 class="prompt-text">${esc(t('hudChrome.weeklyRewards.readyTitle'))}</h3><p class="weekly-ready-description">${esc(t('hudChrome.weeklyRewards.readyDescription'))}</p><div class="weekly-ready-actions"><button type="button" class="btn weekly-ready-open">${esc(t('hudChrome.weeklyRewards.openRewards'))}</button><button type="button" class="btn weekly-ready-cancel">${esc(t('hudChrome.weeklyRewards.notNow'))}</button></div>`;
  const open = prompt.querySelector<HTMLButtonElement>('.weekly-ready-open')!;
  let silent = false;
  let dismissed = false;
  const handle = installPromptDialog(
    prompt,
    null,
    () => {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(focusTimer);
      prompt.remove();
      if (!silent) returnFocus();
    },
    { inertRoot: root, idPrefix: 'weekly-ready-title' },
  );
  const description = prompt.querySelector<HTMLElement>('.weekly-ready-description')!;
  description.id = `${prompt.getAttribute('aria-labelledby')}-description`;
  prompt.setAttribute('aria-describedby', description.id);
  open.classList.remove('ui-btn--red');
  open.classList.add('ui-btn--gold');
  const dismiss = () => {
    if (dismissed) return;
    silent = true;
    handle.dismiss();
  };
  open.addEventListener('click', () => {
    if (dismissed) return;
    dismiss();
    openRewards();
  });
  prompt.querySelector('.weekly-ready-cancel')!.addEventListener('click', () => {
    if (!dismissed) handle.dismiss();
  });
  stack.append(prompt);
  // The containing bank window becomes visible after its initial render.
  const focusTimer = setTimeout(() => {
    if (!dismissed && prompt.isConnected) open.focus();
  }, 0);
  return dismiss;
}
