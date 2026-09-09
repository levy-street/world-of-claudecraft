// The target frame's social/badge line: a linked player's nickname (with PFP),
// their staff-role tag, Discord rank rung, developer rung, and the AI-account
// mark. Moved WHOLE out of `Hud.updateTargetDiscordLine` so the three decisions
// the line makes (is there anything to show, has anything changed, what markup)
// are drivable from a Vitest without a DOM. The coordinator keeps only the
// element handling: the class toggle, the innerHTML write, and the avatar
// fallback wiring.
//
// DOM-free by contract (registered in UI_PURE_CORES). It resolves labels through
// `t()`, which a pure core may do: the architecture guard forbids the DOM and the
// browser globals, not label selection.

import { specialRoleColor } from '../sim/discord_roles';
import { devTierByIndex, devTierDisplayName } from './dev_tier';
import { discordRoleTagLabel } from './discord_role_tag';
import { discordStatusDisplayName } from './discord_tier';
import { esc } from './esc';
import { CHROME_TONE } from './hud_tones';
import { t } from './i18n';

/**
 * Everything the flair line reads, already resolved by the caller.
 *
 * `language` is the ACTIVE locale and is a real input, not bookkeeping: four of
 * the five faces below are localized (the role tag, the rank rung, the dev rung,
 * and the AI mark plus its screen-reader label), while every other field here is
 * identity data a locale switch never moves. See `targetFlairSignature`.
 */
export interface TargetFlairLineInput {
  /** The active locale, from `getLanguage()`. */
  readonly language: string;
  /** Discord status rung index; 0 means not linked. */
  readonly tier: number;
  /** Linked Discord nickname, '' when absent. */
  readonly name: string;
  /** Special-role key, '' when the player holds none. */
  readonly role: string;
  /** Discord avatar URL, '' when absent. */
  readonly avatar: string;
  /** Developer rung index, already zeroed when the Dev Badges option is off. */
  readonly devIndex: number;
  /** Whether the account is flagged AI-operated. */
  readonly isAi: boolean;
}

/**
 * Whether the line has anything at all to show.
 *
 * The AI flag is part of this test and not only of the markup: an AI account
 * carrying no Discord or dev flair would otherwise never render the line.
 */
export function targetFlairLineVisible(input: TargetFlairLineInput): boolean {
  return (
    input.tier > 0 || input.name !== '' || input.role !== '' || input.devIndex > 0 || input.isAi
  );
}

/**
 * The repaint signature. The caller rebuilds only when this moves, because a
 * per-frame rebuild would mint a fresh `<img>` every frame, re-fetching the
 * avatar and (on a failing CDN load) flickering between the broken glyph and
 * hidden.
 *
 * THE LANGUAGE LEADS IT, and that is the load-bearing part. Everything after the
 * first field is identity data (a rung index, a role key, a nickname, a URL, a
 * flag) that a locale switch cannot move, while `targetFlairLineHtml` resolves
 * four localized faces through `t()`. Keyed on identity alone the line sat in the
 * PREVIOUS locale after a language switch until that player's flair happened to
 * change, and nothing repainted it: the line has no fan-out arm, and `hud.ts`
 * (where this used to live) carries the blanket coordinator opt-out in
 * `tests/language_fanout_registry.test.ts`, so the guard could not report it
 * either. Re-keying is the whole fix, because the rebuild already resolves every
 * label at paint time; there is nothing to relocalize, only something to notice.
 */
export function targetFlairSignature(input: TargetFlairLineInput): string {
  return `${input.language}|${input.tier}|${input.name}|${input.role}|${input.avatar}|${input.devIndex}|${input.isAi ? 1 : 0}`;
}

/** The line's inner markup. Every interpolated value passes through `esc`. */
export function targetFlairLineHtml(input: TargetFlairLineInput): string {
  const parts: string[] = [];
  const nameInner = input.avatar
    ? `<img src="${esc(input.avatar)}" referrerpolicy="no-referrer" alt="" draggable="false">${esc(input.name)}`
    : esc(input.name);
  if (input.name || input.avatar) {
    parts.push(`<span class="uf-dc-name">${nameInner}</span>`);
  }
  const roleLabel = discordRoleTagLabel(input.role);
  if (roleLabel) {
    parts.push(
      `<span class="uf-dc-chip role" style="--role:${specialRoleColor(input.role) ?? CHROME_TONE.ROLE_FALLBACK}">${esc(roleLabel)}</span>`,
    );
  }
  if (input.tier > 0) {
    parts.push(`<span class="uf-dc-chip rank">${esc(discordStatusDisplayName(input.tier))}</span>`);
  }
  const devDef = devTierByIndex(input.devIndex);
  if (devDef) {
    parts.push(`<span class="uf-dc-chip dev">${esc(devTierDisplayName(devDef))}</span>`);
  }
  if (input.isAi) {
    // The shared .ai-tag mark, and deliberately NOT a .uf-dc-chip: the chip rules
    // live UNLAYERED in index.extra.css, and unlayered CSS beats every @layer rule,
    // so the chip's own color/background would override the gradient in
    // @layer components and paint straight over it. The flair line is a flex row,
    // so a bare span sits inline beside the chips anyway.
    parts.push(
      // role=img + aria-label, not just title: this is a DISCLOSURE, and assistive
      // tech announces `title` inconsistently on a non-focusable span. Screen-reader
      // users must hear "AI-operated account", not the bare "[AI]" literal (or, if
      // the title is skipped entirely, nothing at all). Mirrors chatAiTagEl.
      `<span class="ai-tag" role="img" aria-label="${esc(t('hudChrome.playerMenu.aiTagTitle'))}" title="${esc(t('hudChrome.playerMenu.aiTagTitle'))}">${esc(t('hudChrome.playerMenu.aiTag'))}</span>`,
    );
  }
  return parts.join('');
}
