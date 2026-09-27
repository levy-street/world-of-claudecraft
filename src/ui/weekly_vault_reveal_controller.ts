// Requests a host opening; only a durably revealed host item can animate or display.
import type { ItemDef } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, FOCUS_KEY_ATTR } from './focus_restore';
import { t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import {
  VAULT_TIMELINE,
  vaultRayVars,
  vaultRingVars,
  vaultStarVars,
  vaultStreakVars,
  vaultTimelineVars,
  weeklyVaultBurstLayout,
} from './weekly_vault_burst_core';

/** The host marks the reveal complete once the whole show has settled. */
export const WEEKLY_REVEAL_DURATION_MS = VAULT_TIMELINE.revealMs;
/** Owned by one claim session and reward slot, surviving tile repaints.
 *  A finished or overdue opening settles immediately instead of starting over. */
export interface WeeklyVaultRevealProgress {
  startedAt?: number;
  completed?: boolean;
}
export function attachWeeklyVaultReveal(
  stage: HTMLElement,
  item: ItemDef | undefined,
  title: string,
  index: number,
  revealed: boolean,
  presentation: PainterHostPresentation,
  canOpen: () => boolean,
  onReveal: () => void,
  onSelect?: () => void,
  requestOpen?: () => void,
  saving = false,
  progress: WeeklyVaultRevealProgress = {},
): { dispose(): void; animate(): void; syncAvailability(): void } {
  const itemName = item ? itemDisplayName(item) : '';
  const original = stage.querySelector<HTMLImageElement>('img')!;
  stage.classList.remove('vault-is-open', 'vault-is-revealed');
  stage.style.removeProperty('--vault-elapsed');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'vault-reveal-trigger';
  trigger.setAttribute('aria-label', t('hudChrome.weeklyRewards.openVault', { name: title }));
  trigger.setAttribute('aria-expanded', 'false');
  const resultId = `weekly-reveal-result-${index}`;
  trigger.setAttribute('aria-controls', resultId);
  trigger.innerHTML = '<span class="vault-reveal-interior" aria-hidden="true"></span>';
  const loot = document.createElement('button');
  loot.type = 'button';
  loot.className = `vault-reveal-loot${item ? ` quality-${item.quality}` : ''}`;
  loot.disabled = true;
  loot.hidden = !item;
  if (item) {
    loot.setAttribute(
      'aria-label',
      t(onSelect ? 'hudChrome.weeklyRewards.selectItem' : 'hudChrome.weeklyRewards.inspectItem', {
        name: itemName,
      }),
    );
    loot.innerHTML = `${presentation.itemIcon(item)}<strong>${esc(itemName)}</strong><small>${esc(t('hudChrome.weeklyRewards.revealed'))}</small>`;
    presentation.attachTooltip(loot, () => presentation.itemTooltip(item));
  }
  const frame = original.cloneNode(true) as HTMLImageElement;
  frame.className = 'vault-reveal-frame';
  const door = document.createElement('span');
  door.className = 'vault-reveal-door';
  door.setAttribute('aria-hidden', 'true');
  const front = original.cloneNode(true) as HTMLImageElement;
  front.className = 'vault-door-front';
  const latch = original.cloneNode(true) as HTMLImageElement;
  latch.className = 'vault-door-latch';
  const back = original.cloneNode(true) as HTMLImageElement;
  back.className = 'vault-door-back';
  const edge = document.createElement('span');
  edge.className = 'vault-door-edge';
  const topEdge = document.createElement('span');
  topEdge.className = 'vault-door-top';
  const bottomEdge = document.createElement('span');
  bottomEdge.className = 'vault-door-bottom';
  const shade = document.createElement('span');
  shade.className = 'vault-door-shading';
  door.append(back, edge, topEdge, bottomEdge, front, shade, latch);
  // The burst: every timing, reach and drift comes from the pure core, stamped
  // as --vault-* vars the stylesheet animates. Nothing here decides a number.
  const setVars = (el: HTMLElement, vars: Record<string, string>) => {
    for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  };
  const layer = (className: string) => {
    const el = document.createElement('span');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  const particles = (className: string, vars: Record<string, string>[]) => {
    const host = layer(className);
    for (const entry of vars) {
      const el = document.createElement('i');
      setVars(el, entry);
      host.append(el);
    }
    return host;
  };
  // Light from the inside: the halo bleeds over the frame around the shut
  // door, the line is the seam itself igniting; the door covers the middle.
  // These two also carry the charging throb, so they exist from the start;
  // the burst itself (rays, rings, streaks, stars: the bulk of the DOM) is
  // minted only when this tile actually opens, never for a revealed or
  // still-shut tile that a repaint rebuilds.
  const seamGlow = layer('vault-seam-glow');
  const seamLine = layer('vault-seam-line');
  const shadow = layer('vault-door-shadow');
  // Every light layer lives in one container: it carries the hinge-side clip
  // (nothing lit ever sits behind the open door) and the one z-slot between
  // the frame and the door.
  const light = layer('vault-light');
  light.append(seamGlow, seamLine);
  trigger.append(shadow, light, frame, door);
  setVars(stage, vaultTimelineVars());
  const mintBurst = () => {
    const burst = weeklyVaultBurstLayout();
    const flash = layer('vault-opening-flash');
    const spill = layer('vault-light-spill');
    for (const entry of burst.rays) {
      const el = document.createElement('i');
      el.className = `vault-ray-${entry.tier}`;
      setVars(el, vaultRayVars(entry));
      spill.append(el);
    }
    const rings = particles('vault-opening-rings', burst.rings.map(vaultRingVars));
    const streaks = particles('vault-burst-streaks', burst.streaks.map(vaultStreakVars));
    const stars = particles('vault-burst-stars', burst.stars.map(vaultStarVars));
    // Between the halo and the seam line, inside the clipped light container.
    seamLine.before(flash, spill, rings, streaks, stars);
  };
  const announcement = document.createElement('span');
  announcement.id = resultId;
  announcement.className = 'vault-reveal-announcement';
  announcement.setAttribute('role', 'status');
  stage.replaceChildren(trigger, loot, announcement);
  trigger.setAttribute(FOCUS_KEY_ATTR, `weekly-open:${index}`);
  loot.setAttribute(FOCUS_KEY_ATTR, `weekly-inspect:${index}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let opening = false;
  let finished = false;
  let requested = false;
  // Cosmetic only: the seam glows on the click while the host saves the
  // opening; aria-busy and the announcement carry the state.
  stage.classList.toggle('vault-is-charging', saving);
  if (saving) {
    // Keep the pending control focusable across authoritative snapshot repaints.
    trigger.setAttribute('aria-disabled', 'true');
    trigger.setAttribute('aria-busy', 'true');
    announcement.textContent = t('hudChrome.weeklyRewards.openingSavedReward');
  }
  loot.addEventListener('click', () => {
    if (!disposed && !loot.disabled && canOpen()) onSelect?.();
  });
  const finish = () => {
    if (disposed || finished || !item || !canOpen()) return;
    finished = true;
    progress.completed = true;
    const hadFocus = captureFocusKey(stage) === `weekly-open:${index}`;
    stage.classList.add('vault-is-revealed');
    trigger.disabled = true;
    loot.disabled = false;
    if (hadFocus) loot.focus();
    announcement.textContent = t('hudChrome.weeklyRewards.revealedItem', { name: itemName });
    onReveal();
  };
  if (revealed && item) {
    progress.completed = true;
    stage.classList.add('vault-is-open', 'vault-is-revealed');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.disabled = true;
    loot.disabled = false;
  }
  const animate = () => {
    if (disposed || opening || revealed || !item || !canOpen()) return;
    opening = true;
    const now = performance.now();
    progress.startedAt ??= now;
    const elapsed = Math.min(WEEKLY_REVEAL_DURATION_MS, Math.max(0, now - progress.startedAt));
    stage.style.setProperty('--vault-elapsed', `${elapsed}ms`);
    stage.classList.remove('vault-is-charging');
    stage.classList.add('vault-is-open');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-disabled', 'true');
    trigger.removeAttribute('aria-busy');
    if (
      progress.completed ||
      elapsed >= WEEKLY_REVEAL_DURATION_MS ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      finish();
    else {
      mintBurst();
      timer = setTimeout(finish, WEEKLY_REVEAL_DURATION_MS - elapsed);
    }
  };
  trigger.addEventListener('click', () => {
    if (disposed || opening || saving || requested || !canOpen()) return;
    if (item) animate();
    else if (requestOpen) {
      requested = true;
      requestOpen();
    }
  });
  const syncAvailability = () => {
    if (!opening && !finished && !revealed && !saving) trigger.disabled = !canOpen();
  };
  syncAvailability();
  return {
    animate,
    syncAvailability,
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
