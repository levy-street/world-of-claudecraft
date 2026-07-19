// The Professions window painter (#professions-window): a cold, read-only
// identity-and-progress browser over IWorldProfessions (craftingIdentity +
// professionsState), the Book of Deeds shape exactly. Full innerHTML rebuild
// on open, on a real data change (refreshIfChanged diffs the pure
// professionsRefreshSig), and on language switch; the section scroller
// survives rebuilds; nothing here runs on the per-frame hot path. The pure
// model lives in professions_view.ts (which composes the PR 2039 identity
// view); this module only paints and wires callbacks through injected deps
// (it never imports Hud and never hardcodes the window id).

import { audio } from '../game/audio';
import type { IWorld } from '../world_api';
import { archetypeTitleText, craftNameText } from './char_window';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { professionIconUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import type { EmpowermentCeiling, ProfessionRole } from './profession_identity_view';
import {
  buildProfessionsView,
  type CraftNextUnlock,
  type ProfessionsCraftRow,
  type ProfessionsViewInput,
  type ProfessionsViewModel,
  professionsRefreshSig,
  type RingArc,
  type RingLayout,
} from './professions_view';
import { svgIcon } from './ui_icons';

// Ring node distance from the container center, in percent of the box
// (the unit-circle coords from the view core scale onto this radius).
const RING_RADIUS_PCT = 40;

// Icon backing-store sizes (2x the CSS box for crisp HiDPI).
const RING_ICON_SIZE = 64;
const ROW_ICON_SIZE = 56;

const ROLE_LABEL_KEYS: Record<ProfessionRole, TranslationKey> = {
  major: 'hudChrome.professions.roleMajor',
  hobby: 'hudChrome.professions.roleHobby',
  dormant: 'hudChrome.professions.roleDormant',
  unattuned: 'hudChrome.professions.roleUnattuned',
};

const CEILING_LABEL_KEYS: Record<EmpowermentCeiling, TranslationKey> = {
  unlimited: 'hudChrome.professions.ceilingUnlimited',
  rare: 'hudChrome.professions.ceilingRare',
  common: 'hudChrome.professions.ceilingCommon',
};

// Gathering display-name keys (the char-window gathering section family).
// Phase 11's fishing row must add its id here alongside its catalog key; an
// id with no key renders no row (the view core passes every row through).
const GATHERING_NAME_KEYS: Record<string, TranslationKey> = {
  mining: 'hudChrome.gathering.mining',
  logging: 'hudChrome.gathering.logging',
  herbalism: 'hudChrome.gathering.herbalism',
};

/**
 * Hud-supplied glue: the shared presentation bag plus the window surface (the
 * world reads, trapping focus capture/return, and close/teardown chrome).
 * Read-only window: no world commands, no watch-change nudge.
 */
export interface ProfessionsWindowDeps extends PainterHostPresentation {
  /** The #professions-window root (Hud owns the id). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  /** The shared Hud TouchPeekGuard (the deeds/bank contract); this window has
   *  no activating card actions today, so it is wired but never consumed. */
  consumePeek(): boolean;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class ProfessionsWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: ProfessionsWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) {
      // Re-opening while already open re-renders in place; the open
      // bookkeeping must not re-run.
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.lastSig = '';
    this.render();
    this.deps.root().style.display = 'flex';
    // Move keyboard focus into the freshly opened window (onto the close
    // button), matching the sibling cold windows, so a keyboard user is not
    // stranded on the opener while the focus trap is active.
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
    audio.click();
  }

  close(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    el.style.display = 'none';
    this.opened = false;
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) {
      this.close();
      audio.click();
    } else {
      this.open();
    }
  }

  /** Slow-band refresh: repaint only when the compact signature moves. The
   *  signature builder is a pure professions_view export, so every repaint
   *  dimension stays unit-pinned. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    const sig = professionsRefreshSig(this.buildInput());
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  render(): void {
    const el = this.deps.root();
    if (!this.opened) return;
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = el.contains(active);
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.professions.title') });
    const prevScrollTop = el.querySelector('.prof-scroll')?.scrollTop ?? 0;

    const model = buildProfessionsView(this.buildInput());
    const body = model.mode === 'simplified' ? this.simplifiedHtml(model) : this.fullHtml(model);
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.professions.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.professions.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="prof-scroll">${body}</div>`;

    this.wire(el);
    const scroll = el.querySelector('.prof-scroll');
    if (scroll) scroll.scrollTop = prevScrollTop;
    // The close button is the only interactive control, so it is also the
    // whole stable-identity refocus story (the deeds fallback arm).
    if (hadFocus) (el.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  private buildInput(): ProfessionsViewInput {
    const world = this.deps.world();
    return {
      identity: world.craftingIdentity,
      gathering: world.professionsState.skills.map((row) => ({
        professionId: row.professionId,
        skill: row.skill,
        maxSkill: row.maxSkill,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Simplified mode (syncing / unattuned pre-first-tier): the identity
  // paragraph plus ONE call to action, tutorial line promoted.
  // -------------------------------------------------------------------------

  private simplifiedHtml(model: ProfessionsViewModel): string {
    const simplified = model.simplified;
    if (simplified === null) return '';
    const paragraph =
      model.identity.state === 'syncing'
        ? t('hudChrome.professions.syncing')
        : t('hudChrome.professions.unattunedIdentity');
    const cta =
      simplified.cta.kind === 'raise'
        ? t('hudChrome.professions.ctaRaise', {
            craft: craftNameText(simplified.cta.craftId),
            points: this.fmt(simplified.cta.points),
          })
        : t('hudChrome.professions.ctaStart');
    const tutorial = simplified.tutorial
      ? `<p class="prof-tutorial">${esc(
          t('hudChrome.professions.tutorialLine', {
            target: this.fmt(simplified.tutorial.targetSkill),
          }),
        )}</p>`
      : '';
    return (
      `<p class="prof-identity-paragraph">${esc(paragraph)}</p>` +
      `<section class="prof-cta"><h3 class="prof-section-header">${esc(t('hudChrome.professions.ctaHeader'))}</h3>` +
      `<p class="prof-cta-line">${esc(cta)}</p>${tutorial}</section>`
    );
  }

  // -------------------------------------------------------------------------
  // Full mode: identity card, ring, ten craft rows, perks, nudges, gathering.
  // -------------------------------------------------------------------------

  private fullHtml(model: ProfessionsViewModel): string {
    return (
      this.identityHtml(model) +
      this.ringHtml(model) +
      this.craftsHtml(model) +
      this.perksHtml(model) +
      this.nudgesHtml(model) +
      this.gatheringHtml(model)
    );
  }

  private identityHtml(model: ProfessionsViewModel): string {
    const summary = model.identity.summary;
    const lines =
      model.identity.state === 'attuned' && summary.majors !== null
        ? `<div class="prof-pair-title">${esc(archetypeTitleText(summary.pairId))}</div>` +
          `<div class="prof-identity-line">${esc(
            t('hudChrome.professions.majorsLabel', {
              a: craftNameText(summary.majors[0]),
              b: craftNameText(summary.majors[1]),
            }),
          )}</div>` +
          `<div class="prof-identity-line">${esc(
            t('hudChrome.professions.hobbyLabel', { craft: craftNameText(summary.hobbyCraft) }),
          )}</div>` +
          `<div class="prof-identity-line">${esc(
            t('hudChrome.professions.pairsHeld', { count: this.fmt(summary.attunedPairCount) }),
          )}</div>` +
          `<div class="prof-identity-line">${esc(
            t('hudChrome.professions.returnsLabel', { count: this.fmt(summary.returnCount) }),
          )}</div>`
        : `<p class="prof-identity-paragraph">${esc(t('hudChrome.professions.unattunedIdentity'))}</p>`;
    const switchCost = `<div class="prof-switch-cost">${esc(
      t('hudChrome.professions.switchCost', { cost: this.fmt(model.switchCost.nextSwitchCost) }),
    )}</div>`;
    return `<section class="prof-identity"><h3 class="prof-section-header">${esc(t('hudChrome.professions.identityHeader'))}</h3>${lines}${switchCost}</section>`;
  }

  /** The craft wheel: an inline SVG (base circle, attuned-pair arc, hobby
   *  chord) under ten absolutely positioned icon nodes. One decorative
   *  drawing to the accessibility tree (the craft list below carries every
   *  fact), so the container is role="img" with the ringAria label and the
   *  parts are hidden. Strokes and fills come from components.css classes
   *  (tokens), never from inline paint. */
  private ringHtml(model: ProfessionsViewModel): string {
    const ring: RingLayout = model.ring;
    const roleById = new Map(model.identity.skills.map((row) => [row.craftId, row.role]));
    // The viewBox is the unit circle, so stroke widths come from CSS pixels
    // with non-scaling-stroke (a user-unit stroke would swallow the ring).
    const svgParts: string[] = [
      `<circle class="prof-ring-circle" cx="0" cy="0" r="1" vector-effect="non-scaling-stroke"/>`,
    ];
    if (ring.pairArc !== null) {
      svgParts.push(
        `<path class="prof-ring-arc" d="${this.arcPath(ring.pairArc)}" vector-effect="non-scaling-stroke"/>`,
      );
    }
    if (ring.hobbyChord !== null) {
      const c = ring.hobbyChord;
      svgParts.push(
        `<line class="prof-ring-chord" x1="${c.x1.toFixed(4)}" y1="${c.y1.toFixed(4)}" x2="${c.x2.toFixed(4)}" y2="${c.y2.toFixed(4)}" vector-effect="non-scaling-stroke"/>`,
      );
    }
    const nodes = ring.nodes
      .map((node) => {
        const role = roleById.get(node.craftId) ?? 'unattuned';
        const left = (50 + node.x * RING_RADIUS_PCT).toFixed(2);
        const top = (50 + node.y * RING_RADIUS_PCT).toFixed(2);
        return `<span class="prof-ring-node role-${role}" style="left:${left}%;top:${top}%"><img src="${professionIconUrl(`prof_${node.craftId}`, RING_ICON_SIZE)}" alt="" draggable="false"></span>`;
      })
      .join('');
    return (
      `<div class="prof-ring" role="img" aria-label="${esc(t('hudChrome.professions.ringAria'))}">` +
      `<svg class="prof-ring-svg" viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true" focusable="false">${svgParts.join('')}</svg>${nodes}</div>`
    );
  }

  private arcPath(arc: RingArc): string {
    const x1 = Math.cos(arc.startAngle);
    const y1 = Math.sin(arc.startAngle);
    const x2 = Math.cos(arc.endAngle);
    const y2 = Math.sin(arc.endAngle);
    return `M ${x1.toFixed(4)} ${y1.toFixed(4)} A 1 1 0 0 1 ${x2.toFixed(4)} ${y2.toFixed(4)}`;
  }

  private craftsHtml(model: ProfessionsViewModel): string {
    const rows = model.crafts.map((row) => this.craftRowHtml(row)).join('');
    return `<section class="prof-crafts"><h3 class="prof-section-header">${esc(t('hudChrome.professions.skillsHeader'))}</h3><ul class="prof-list" role="list">${rows}</ul></section>`;
  }

  private craftRowHtml(row: ProfessionsCraftRow): string {
    const name = craftNameText(row.identity.craftId);
    const pct = Math.round(row.bar.fillFraction * 100);
    let pips = '';
    for (let i = 0; i < row.bar.pipSlots; i++) {
      pips += `<span class="prof-pip${i < row.bar.filledPips ? ' filled' : ''}"></span>`;
    }
    return (
      `<li class="prof-craft-row role-${row.identity.role}">` +
      `<img class="prof-craft-icon" src="${professionIconUrl(`prof_${row.identity.craftId}`, ROW_ICON_SIZE)}" alt="" draggable="false">` +
      `<div class="prof-craft-main">` +
      `<div class="prof-craft-head"><span class="prof-craft-name">${esc(name)}</span>` +
      `<span class="prof-role-badge">${esc(t(ROLE_LABEL_KEYS[row.identity.role]))}</span>` +
      `<span class="prof-ceiling">${esc(t(CEILING_LABEL_KEYS[row.identity.ceiling]))}</span>` +
      `<span class="prof-skill-value">${esc(
        t('hudChrome.professions.skillValue', {
          skill: this.fmt(row.bar.skill),
          max: this.fmt(row.bar.maxSkill),
        }),
      )}</span></div>` +
      `<div class="prof-bar-wrap"><span class="prof-bar"><span class="prof-bar-fill" style="width:${pct}%"></span></span>` +
      `<span class="prof-pips" role="img" aria-label="${esc(
        t('hudChrome.professions.tierPipAria', { tier: this.fmt(row.bar.tierIndex) }),
      )}">${pips}</span></div>` +
      `<div class="prof-next">${esc(this.nextUnlockText(row.nextUnlock))}</div>` +
      `</div></li>`
    );
  }

  private nextUnlockText(unlock: CraftNextUnlock): string {
    if (unlock.kind === 'max') return t('hudChrome.professions.nextUnlockMax');
    if (unlock.kind === 'specialized')
      return t('hudChrome.professions.nextUnlockSpecialized', {
        points: this.fmt(unlock.pointsRemaining),
      });
    return t('hudChrome.professions.nextUnlockTier', { points: this.fmt(unlock.pointsRemaining) });
  }

  /** Specialization readout: one line per specialized craft, or the single
   *  threshold explainer while none is (PERK_THRESHOLDS is uniform across the
   *  ring, so the first row's threshold speaks for all ten). */
  private perksHtml(model: ProfessionsViewModel): string {
    const specialized = model.crafts.filter((row) => row.perks.specialized);
    const body =
      specialized.length > 0
        ? `<ul class="prof-perk-list" role="list">${specialized
            .map(
              (row) =>
                `<li class="prof-perk-line">${esc(
                  t('hudChrome.professions.perkSpecializedLine', {
                    craft: craftNameText(row.identity.craftId),
                    pct: this.fmt(row.perks.materialDiscountPct * 100),
                  }),
                )}</li>`,
            )
            .join('')}</ul>`
        : `<p class="prof-perk-line">${esc(
            t('hudChrome.professions.perkSpecializedAt', {
              threshold: this.fmt(model.crafts[0].perks.specializedSkillThreshold),
            }),
          )}</p>`;
    return `<section class="prof-perks"><h3 class="prof-section-header">${esc(t('hudChrome.professions.perksHeader'))}</h3>${body}</section>`;
  }

  private nudgesHtml(model: ProfessionsViewModel): string {
    if (model.identity.nudges.length === 0) return '';
    const items = model.identity.nudges
      .map((nudge) =>
        nudge.type === 'nearTier'
          ? `<li>${esc(
              t('hudChrome.professions.nudgeNearTier', {
                craft: craftNameText(nudge.craftId),
                points: this.fmt(nudge.points),
              }),
            )}</li>`
          : `<li>${esc(
              t('hudChrome.professions.nudgeDormant', { craft: craftNameText(nudge.craftId) }),
            )}</li>`,
      )
      .join('');
    return `<ul class="prof-nudges" role="list">${items}</ul>`;
  }

  private gatheringHtml(model: ProfessionsViewModel): string {
    const rows = model.gathering
      .map((row) => {
        const key = GATHERING_NAME_KEYS[row.professionId];
        if (key === undefined) return '';
        const pct = Math.round(row.bar.fillFraction * 100);
        return (
          `<li class="prof-gather-row">` +
          `<img class="prof-craft-icon" src="${professionIconUrl(`gather_${row.professionId}`, ROW_ICON_SIZE)}" alt="" draggable="false">` +
          `<div class="prof-craft-main"><div class="prof-craft-head"><span class="prof-craft-name">${esc(t(key))}</span>` +
          `<span class="prof-skill-value">${esc(
            t('hudChrome.professions.skillValue', {
              skill: this.fmt(row.bar.skill),
              max: this.fmt(row.bar.maxSkill),
            }),
          )}</span></div>` +
          `<div class="prof-bar-wrap"><span class="prof-bar"><span class="prof-bar-fill" style="width:${pct}%"></span></span></div></div></li>`
        );
      })
      .join('');
    if (rows === '') return '';
    return `<section class="prof-gathering"><h3 class="prof-section-header">${esc(t('hudChrome.professions.gatheringHeader'))}</h3><ul class="prof-list" role="list">${rows}</ul></section>`;
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }
}
