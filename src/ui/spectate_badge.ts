import { t } from './i18n';

export interface SpectateBadge {
  update(name: string | null): void;
}

/**
 * Optional battleground-spectate glue. When wired, the badge grows a small
 * "Stop watching" button shown ONLY while the world reports a battleground
 * spectate (bgInfo.spectating). The moderator /spectate flow stays untouched:
 * moderators exit via /unspectate, and for them isBgSpectate() is false so the
 * button never appears.
 */
export interface SpectateBadgeDeps {
  isBgSpectate(): boolean;
  onStop(): void;
}

export function createSpectateBadge(deps?: SpectateBadgeDeps): SpectateBadge {
  const element = document.createElement('div');
  element.id = 'spectate-badge';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;
  const textEl = document.createElement('span');
  textEl.className = 'spectate-text';
  element.appendChild(textEl);
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'spectate-stop';
  stopBtn.hidden = true;
  stopBtn.addEventListener('click', () => deps?.onStop());
  element.appendChild(stopBtn);
  document.body.appendChild(element);

  let currentName: string | null = null;
  let currentStop = false;
  const render = (): void => {
    element.hidden = currentName === null;
    textEl.textContent =
      currentName === null ? '' : t('hudChrome.spectate.banner', { name: currentName });
    stopBtn.hidden = !currentStop;
    stopBtn.textContent = t('hudChrome.bg.spectate.stop');
    stopBtn.setAttribute('aria-label', t('hudChrome.bg.spectate.stop'));
  };
  document.addEventListener('woc:languagechange', render);

  return {
    update(name) {
      const stop = name !== null && (deps?.isBgSpectate() ?? false);
      if (name === currentName && stop === currentStop) return;
      currentName = name;
      currentStop = stop;
      render();
    },
  };
}
