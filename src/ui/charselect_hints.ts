// The hint lines under a character-select roster row's level line: the zone
// the character stands in (so the owner can see where every character is
// without logging each one in), the raid lockouts it still carries (named and
// timed through the same rule as the in-world minimap badge), and the in-world
// notice for a character another session holds. Pure string builder, no DOM:
// main.ts drops the markup into the row it composes.
//
// The countdown subtracts the caller's clock from the server's absolute unlock
// epoch, exactly as the in-world badge does (online.ts raidLockouts()), so a
// skewed client clock misreads both surfaces identically. It is stamped once
// per roster paint (refreshCharacters); a player parked on character select
// keeps that reading until the roster refetches (realm, sort or language
// change, or re-entry), which the minute granularity makes harmless.
import { LOCKOUT_KIND_ORDER, lockoutKind, type RaidLockoutKind } from '../sim/raid_lockout_state';
import { zoneDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { formatLockoutDuration, raidLockoutDisplayName } from './raid_lockout_format';

/** Structural (the char-select `CharacterSummary` satisfies it) so this module
 *  does not import the net layer for a type. */
export interface CharselectHintSource {
  online: boolean;
  zoneId?: string | null;
  /** Lockout id -> absolute unlock epoch ms (the server already dropped expired
   *  entries; the row drops any that lapse between the fetch and the paint). */
  raidLockouts?: Record<string, number> | null;
}

/** One roster-row lockout, ready to render: the localized raid name and the
 *  countdown text for the time left at `nowMs`. */
export interface CharselectLockoutRow {
  id: string;
  kind: RaidLockoutKind;
  name: string;
  time: string;
  msRemaining: number;
}

/** The group heading key for each lockout kind, in the order the list shows
 *  them: raids, then dungeons, then world bosses. */
const LOCKOUT_GROUP_KEY: Record<
  RaidLockoutKind,
  'character.lockoutRaids' | 'character.lockoutDungeons' | 'character.lockoutWorldBosses'
> = {
  raid: 'character.lockoutRaids',
  dungeon: 'character.lockoutDungeons',
  worldBoss: 'character.lockoutWorldBosses',
};

/** The localized zone name for a roster row, or null when the server sent no
 *  zone (an older server, or a save that resumes at the world start). */
export function charselectZoneLabel(c: CharselectHintSource): string | null {
  return c.zoneId ? zoneDisplayName(c.zoneId) : null;
}

/** The still-locked raids of a roster row, soonest to unlock first (ties by
 *  id, like the minimap panel). Empty when the server sent none (an older
 *  server) or every entry has already lapsed. */
export function charselectLockoutRows(
  c: CharselectHintSource,
  nowMs: number,
): CharselectLockoutRow[] {
  const src = c.raidLockouts;
  if (!src || typeof src !== 'object') return [];
  const rows: CharselectLockoutRow[] = [];
  for (const id of Object.keys(src)) {
    const until = src[id];
    if (typeof until !== 'number' || !Number.isFinite(until)) continue;
    const msRemaining = until - nowMs;
    if (msRemaining <= 0) continue;
    rows.push({
      id,
      kind: lockoutKind(id),
      name: raidLockoutDisplayName(id),
      time: formatLockoutDuration(msRemaining),
      msRemaining,
    });
  }
  return rows.sort(
    (a, b) => a.msRemaining - b.msRemaining || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The lockout block: a native details/summary disclosure (closed by default,
 *  the news panel's pattern, so no JS wiring) whose summary carries the label
 *  and the locked count, and whose body groups the rows under Raids, Dungeons
 *  and World bosses (a group renders only when it has a row), one row per
 *  lockout (name and countdown, the in-world "locked to" sentence as its
 *  tooltip). '' when none are locked. */
export function charselectLockoutsHtml(c: CharselectHintSource, nowMs: number): string {
  const rows = charselectLockoutRows(c, nowMs);
  if (rows.length === 0) return '';
  const count = formatNumber(rows.length, { maximumFractionDigits: 0, useGrouping: false });
  const summary = t('character.lockouts', { count });
  const item = (r: CharselectLockoutRow) =>
    `<span class="char-lockout-item" title="${esc(
      t('hudChrome.raidLockout.lockedToast', { raid: r.name, time: r.time }),
    )}"><span class="char-lockout-name">${esc(r.name)}</span> <span class="char-lockout-time ui-num">${esc(r.time)}</span></span>`;
  const groups = LOCKOUT_KIND_ORDER.map((kind) => {
    const inKind = rows.filter((r) => r.kind === kind);
    if (inKind.length === 0) return '';
    return `<span class="char-lockout-group" data-kind="${kind}"><span class="char-lockout-group-name">${esc(t(LOCKOUT_GROUP_KEY[kind]))}</span>${inKind.map(item).join('')}</span>`;
  }).join('');
  return `<details class="char-lockout-hint"><summary class="char-lockout-label">${esc(summary)}</summary>${groups}</details>`;
}

/** The slice of a DOM event the row wiring reads. Duck-typed (with the row
 *  host below) so this module stays host-agnostic: no DOM globals, and a test
 *  passes fakes. */
export interface CharselectRowEvent {
  target: unknown;
  key?: string;
  preventDefault(): void;
}
export interface CharselectRowHost {
  addEventListener(
    type: 'click' | 'dblclick' | 'keydown',
    listener: (e: CharselectRowEvent) => void,
  ): void;
}
export interface CharselectRowActions {
  /** Select the row: the stage, the Enter World button and the name label follow. */
  select(): void;
  /** Enter the world with the selected character (the double-click path). */
  enter(): void;
}

/** True when an activation landed inside the lockout disclosure: its summary
 *  toggles natively, and a toggle must neither select the row, nor enter the
 *  world, nor have its native Enter/Space activation swallowed. */
export function inLockoutDisclosure(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(el?.closest?.('.char-lockout-hint'));
}

/** The roster row's own activations: click and Enter/Space select, double
 *  click selects then enters. Each handler returns early for an event from
 *  inside the lockout disclosure instead of stopping propagation there, so the
 *  document-level listeners (the realm and sort dropdowns' outside-click
 *  closers) still see every click on the row. */
export function wireCharselectRow(row: CharselectRowHost, actions: CharselectRowActions): void {
  row.addEventListener('click', (e) => {
    if (!inLockoutDisclosure(e.target)) actions.select();
  });
  row.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || inLockoutDisclosure(e.target)) return;
    e.preventDefault();
    actions.select();
  });
  row.addEventListener('dblclick', (e) => {
    if (inLockoutDisclosure(e.target)) return;
    actions.select();
    actions.enter();
  });
}

/** `nowMs` is the caller's wall clock (main.ts passes Date.now()): this module
 *  stays host-agnostic so tests can pin a countdown. */
export function charselectHintsHtml(c: CharselectHintSource, nowMs: number): string {
  const zone = charselectZoneLabel(c);
  const zoneHint = zone
    ? `<span class="char-zone-hint">${esc(t('character.currentLocation', { zone }))}</span>`
    : '';
  // Lockouts sit between the zone and the in-world notice: both state lines
  // first, the warning that explains the Take Over button last, nearest the
  // row's actions.
  const lockoutHint = charselectLockoutsHtml(c, nowMs);
  // Online characters explain themselves on their own hint line (below the
  // class) instead of a terse "(in world)" suffix, so the reason for the Take
  // Over button is unmissable.
  const inWorldHint = c.online
    ? `<span class="char-inworld-hint">${esc(t('character.inWorldHint'))}</span>`
    : '';
  return `${zoneHint}${lockoutHint}${inWorldHint}`;
}
