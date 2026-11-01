import { esc } from './esc';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from './focus_restore';
import { t } from './i18n';
import type { StoreSubscription } from './store_subscription';

/** Change-driven membership paint, retaining focus, scroll and the live region. */
export class StoreMembershipController {
  private paintedMarkup: string | null = null;

  reset(): void {
    this.paintedMarkup = null;
  }

  paint(
    root: HTMLElement,
    body: HTMLElement,
    subscription: Pick<StoreSubscription, 'html' | 'bind'>,
    refresh: () => void,
  ): void {
    const markup =
      subscription.html() ||
      `<div class="dr-empty" role="status">${esc(t('hudChrome.wocStore.membershipsUnavailable'))}</div>`;
    if (markup === this.paintedMarkup) return;
    const focusKey = captureFocusKey(body);
    const scrollTop = body.scrollTop;
    body.innerHTML = markup;
    this.paintedMarkup = markup;
    subscription.bind(body, refresh);
    const announcement = root.querySelector<HTMLElement>('[data-membership-announcement]');
    const summary = body.querySelector('[data-membership-summary]')?.textContent ?? '';
    if (announcement && announcement.textContent !== summary) announcement.textContent = summary;
    if (focusKey)
      restoreFirstEnabled([
        findFocusKey(body, focusKey),
        findFocusKey(body, 'subscription-manage'),
        root.querySelector<HTMLButtonElement>('[data-woc-store-tab="memberships"]'),
      ]);
    body.scrollTop = scrollTop;
  }
}
