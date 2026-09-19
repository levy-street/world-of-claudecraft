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
/** Wall-clock start of each in-flight opening, keyed by slot and item, so a
 *  repaint mid-show (the bank's slow-band refresh once the ledger records the
 *  opened item) resumes the choreography at its elapsed time instead of
 *  restarting it: the stage carries --vault-elapsed and every open-state
 *  animation offsets its delay by it. Entries leave on completion and expire
 *  after the reveal duration, so a later opening of the same slot starts fresh. */
const inFlight = new Map<string, number>();
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
): { dispose(): void; animate(): void } {
  const itemName = item ? itemDisplayName(item) : '';
  const original = stage.querySelector<HTMLImageElement>('img')!;
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
  const flightKey = item ? `${index}:${item.id}` : '';
  const finish = () => {
    // A torn-down tile keeps its entry for the rebuilt one to resume; any
    // other outcome (done, or the session went stale) ends the flight.
    if (disposed) return;
    inFlight.delete(flightKey);
    if (!item || !canOpen()) return;
    const hadFocus = captureFocusKey(stage) === `weekly-open:${index}`;
    stage.classList.add('vault-is-revealed');
    trigger.disabled = true;
    loot.disabled = false;
    if (hadFocus) loot.focus();
    announcement.textContent = t('hudChrome.weeklyRewards.revealedItem', { name: itemName });
    onReveal();
  };
  if (revealed && item) {
    stage.classList.add('vault-is-open', 'vault-is-revealed');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.disabled = true;
    loot.disabled = false;
  }
  const animate = () => {
    if (disposed || opening || revealed || !item || !canOpen()) return;
    opening = true;
    const now = Date.now();
    // Sweep flights that can no longer be resumed (closed mid-show and never
    // reopened), so the map only ever holds what is actually in progress.
    for (const [key, startedAt] of inFlight)
      if (now - startedAt >= WEEKLY_REVEAL_DURATION_MS) inFlight.delete(key);
    const startedAt = inFlight.get(flightKey);
    const elapsed = startedAt === undefined ? 0 : now - startedAt;
    if (!elapsed) inFlight.set(flightKey, now);
    mintBurst();
    stage.style.setProperty('--vault-elapsed', `${elapsed}ms`);
    stage.classList.add('vault-is-open');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-disabled', 'true');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else timer = setTimeout(finish, WEEKLY_REVEAL_DURATION_MS - elapsed);
  };
  trigger.addEventListener('click', () => {
    if (disposed || opening || saving || !canOpen()) return;
    if (item) animate();
    else requestOpen?.();
  });
  return {
    animate,
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
