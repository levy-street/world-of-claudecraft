import { t } from './i18n';

export interface SpectateBadge {
  update(name: string | null): void;
}

export function createSpectateBadge(): SpectateBadge {
  const element = document.createElement('div');
  element.id = 'spectate-badge';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;
  document.body.appendChild(element);

  let currentName: string | null = null;
  const render = (): void => {
    element.hidden = currentName === null;
    element.textContent =
      currentName === null ? '' : t('hudChrome.spectate.banner', { name: currentName });
  };
  document.addEventListener('woc:languagechange', render);

  return {
    update(name) {
      if (name === currentName) return;
      currentName = name;
      render();
    },
  };
}
