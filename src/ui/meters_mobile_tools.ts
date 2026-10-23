// Cold mobile chrome adapter. Reuses the HUD's shared, viewport-clamped menu.
import { t } from './i18n';
import type { SimpleMenuItem } from './simple_context_menu';

interface MobileMeterToolsActions {
  openMenu(
    items: readonly SimpleMenuItem[],
    x: number,
    y: number,
    onSelect: (act: string) => void,
  ): void;
  metric(x: number, y: number): void;
  history(x: number, y: number): void;
  settings(): void;
  resetCurrent(): void;
  resetAll(): void;
}

export function wireMobileMeterTools(root: HTMLElement, actions: MobileMeterToolsActions) {
  const close = root.querySelector('.mt-close');
  const controls = close?.parentElement;
  if (!controls) return null;
  controls.classList.add('mt-tools-host');
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'x-btn ui-disc mt-mobile-tools';
  button.setAttribute('aria-haspopup', 'menu');
  const dots = root.ownerDocument.createElement('span');
  dots.setAttribute('aria-hidden', 'true');
  dots.textContent = '...';
  button.append(dots);
  controls.insertBefore(button, close);
  const relocalize = () => {
    button.setAttribute('aria-label', t('hud.core.mobileMore'));
    button.title = t('hud.core.mobileMore');
  };
  relocalize();
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    button.focus({ preventScroll: true });
    const rect = button.getBoundingClientRect();
    actions.openMenu(
      [
        { act: 'metric', label: t('hud.meters.selectMode') },
        { act: 'history', label: t('hud.meters.selectSegment') },
        { act: 'settings', label: t('hudChrome.meters.settingsTitle') },
        { act: 'resetCurrent', label: t('hud.meters.resetFight') },
        { act: 'resetAll', label: t('hud.meters.resetAll') },
      ],
      rect.left,
      rect.top,
      (act) => {
        button.focus({ preventScroll: true });
        switch (act) {
          case 'metric':
            actions.metric(rect.left, rect.top);
            break;
          case 'history':
            actions.history(rect.left, rect.top);
            break;
          case 'settings':
            actions.settings();
            break;
          case 'resetCurrent':
            actions.resetCurrent();
            break;
          case 'resetAll':
            actions.resetAll();
            break;
        }
      },
    );
  });
  return { relocalize };
}
