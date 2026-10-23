// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/ui/i18n';
import { wireMobileMeterTools } from '../src/ui/meters_mobile_tools';

afterEach(() => {
  document.body.innerHTML = '';
});
describe('mobile meter tools', () => {
  it('routes the shared menu actions and returns focus to its accessible trigger', () => {
    document.body.innerHTML =
      '<div id="meter"><div class="panel-title"><span><button class="mt-close"></button></span></div></div>';
    const root = document.querySelector<HTMLElement>('#meter')!;
    const actions = {
      openMenu: vi.fn(),
      metric: vi.fn(),
      history: vi.fn(),
      settings: vi.fn(),
      resetCurrent: vi.fn(),
      resetAll: vi.fn(),
    };
    const tools = wireMobileMeterTools(root, actions)!;
    const trigger = root.querySelector<HTMLButtonElement>('.mt-mobile-tools')!;
    expect(trigger.getAttribute('aria-label')).toBe(t('hud.core.mobileMore'));
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    tools.relocalize();
    trigger.click();
    const [items, x, y, select] = actions.openMenu.mock.calls[0];
    expect(items.map((item: { act: string }) => item.act)).toEqual([
      'metric',
      'history',
      'settings',
      'resetCurrent',
      'resetAll',
    ]);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      document.querySelector<HTMLButtonElement>('.mt-close')!.focus();
      select(item.act);
      expect(document.activeElement).toBe(trigger);
    }
    expect(actions.metric).toHaveBeenCalledExactlyOnceWith(x, y);
    expect(actions.history).toHaveBeenCalledExactlyOnceWith(x, y);
    expect(actions.settings).toHaveBeenCalledOnce();
    expect(actions.resetCurrent).toHaveBeenCalledOnce();
    expect(actions.resetAll).toHaveBeenCalledOnce();
    select('unknown');
    expect(actions.resetAll).toHaveBeenCalledOnce();
  });
  it('leaves templates without meter controls alone', () => {
    const root = document.createElement('div');
    expect(wireMobileMeterTools(root, {} as never)).toBeNull();
    expect(root.innerHTML).toBe('');
  });
});
