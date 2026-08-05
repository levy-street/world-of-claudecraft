// The Professions window painter (#professions-window): a cold
// identity-and-progress browser over IWorldProfessions (craftingIdentity +
// professionsState), the Book of Deeds shape, PLUS the acquisition craft's
// two action senders (slotToolEffect / rechargeToolEffect on the gathering
// rows: no longer read-only, and the outcome round-trips as the pid-scoped
// toolEffectResult event rather than a local repaint). Full innerHTML
// rebuild on open, on a real data change (refreshIfChanged diffs the pure
// professionsRefreshSig), on the toolEffectResult event, and on language
// switch; the section scroller and the focused control's identity survive
// rebuilds; nothing here runs on the per-frame hot path. The pure model
// lives in professions_view.ts (which composes the PR 2039 identity view);
// this module only paints and wires callbacks through injected deps (it
// never imports Hud and never hardcodes the window id).

import { audio } from '../game/audio';
import { GATHERING_PROFESSIONS, type GatheringProfessionId } from '../sim/content/professions';
import { ITEMS } from '../sim/data';
import type { IWorld } from '../world_api';
import { archetypeTitleText, craftNameText } from './char_window';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, focusedWithin, restoreFirstEnabled } from './focus_restore';
import { gatheringProfessionNameKey } from './gathering_profession_name';
import { formatNumber, type TranslationKey, t } from './i18n';
import { professionIconUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { archetypeImageUrl } from './profession_art';
import type { EmpowermentCeiling, ProfessionRole } from './profession_identity_view';
import {
  buildProfessionsView,
  type CraftNextUnlock,
  type ProfessionsCraftRow,
  type ProfessionsGatheringRow,
  type ProfessionsViewInput,
  type ProfessionsViewModel,
  professionsRefreshSig,
  type RingArc,
  type RingLayout,
} from './professions_view';
import { toolEffectNameKey } from './tool_effect_name';
import { hasToolEffectCard, toolEffectStandaloneTooltip } from './tool_effect_tooltip';
import { svgIcon } from './ui_icons';

// Ring node distance from the container center, in percent of the box
// (the unit-circle coords from the view core scale onto this radius).
const RING_RADIUS_PCT = 40;

// Icon backing-store sizes (2x the CSS box for crisp HiDPI).
const RING_ICON_SIZE = 64;
const ROW_ICON_SIZE = 56;

// How long a sent action button stays guarded when NO repaint answers it
// (a dropped frame: closed socket, spectate, lane refusal). Comfortably
// above a live round trip, far below "dead until reopen".
const SENT_GUARD_REARM_MS = 2000;

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

/**
 * Hud-supplied glue: the shared presentation bag plus the window surface (the
 * world reads, trapping focus capture/return, and close/teardown chrome).
 * The window SENDS two world commands (slotToolEffect / rechargeToolEffect,
 * wired in wire()); everything else is read-only, and there is still no
 * watch-change nudge.
 */
export interface ProfessionsWindowDeps extends PainterHostPresentation {
  /** The #professions-window root (Hud owns the id). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  /** The shared Hud TouchPeekGuard (the deeds/bank contract). Slot buttons and
   *  live effect rows attach hover cards, so a long press that showed one arms
   *  the guard; the slot and recharge click handlers consume it and swallow
   *  that release click, so holding a control inspects it instead of spending
   *  a charm or materials. A plain tap and every desktop click return false. */
  consumePeek(): boolean;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class ProfessionsWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // The R40 "Ask each use" choice per gathering profession: UI-local state
  // for the NEXT slot action (the mode is part of the mint, so it rides the
  // slotToolEffect command), held here so the full innerHTML rebuild cannot
  // reset a checked box. Seeded from the LIVE slots' modes at each fresh
  // open (the phase 14 QA: the toggle otherwise contradicted the chip one
  // line above it); the player's unsent choice then persists across
  // rebuilds for as long as the window stays open. The durable record of a
  // LIVE slot's mode stays the row's own chip, mirrored from the tslot
  // wire.
  private readonly slotModePrompt = new Set<string>();

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
    // Seed the toggles from the LIVE slots (the phase 14 QA): the capture
    // truth-test showed a prompt-mode slot chipping "Asks each use" beside
    // an unchecked "Ask each use" toggle, two near-identical labels
    // contradicting each other. A fresh open reflects each slot's real
    // mode; the player's unsent choice then persists across rebuilds for
    // as long as the window stays open.
    this.slotModePrompt.clear();
    for (const row of this.deps.world().toolEffectSlots) {
      if (row.confirmMode === 'prompt') this.slotModePrompt.add(row.professionId);
    }
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
    const input = this.buildInput();
    const sig = professionsRefreshSig(input);
    if (sig === this.lastSig) return;
    // render() re-latches the signature itself, so a forced repaint from
    // anywhere (the toolEffectResult arm) cannot leave a stale one behind for
    // this band to act on a second time. Handing the compared input AND its
    // signature over keeps the read and the bag-walking hash one apiece per
    // changed repaint.
    this.render(input, sig);
  }

  render(prebuilt?: ProfessionsViewInput, prebuiltSig?: string): void {
    const el = this.deps.root();
    if (!this.opened) return;
    // The focused control's own identity, carried across the rebuild through
    // the shared seam (focus_restore.ts) rather than a hand-rolled
    // activeElement read. This window is FocusManager-registered, so the
    // keyboard path is real, and it now has action buttons beside Close: a
    // repaint that parked focus on Close would make the next Enter close the
    // window instead of repeating the action (the #2377 double-fire family).
    // Close stays the FALLBACK only, for a control the rebuild removed.
    const focusKey = captureFocusKey(el);
    const hadFocus = focusedWithin(el) !== null;
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.professions.title') });
    const prevScrollTop = el.querySelector('.prof-scroll')?.scrollTop ?? 0;

    // ONE input read feeds the paint AND the signature latch below: latching
    // from a second read would record whatever the world says after the
    // paint, and any listener that moved a signature input in between would
    // leave the DOM stale behind a fresh signature the 500 ms band then
    // trusts. `prebuilt`/`prebuiltSig` let refreshIfChanged hand over the
    // input and signature it just compared (a synchronous same-tick call, so
    // the world cannot have moved in between): the input hand-over spares
    // the per-access view builders, and the signature hand-over spares the
    // one real bag walk in the pair (the sig hash itself).
    const input = prebuilt ?? this.buildInput();
    const model = buildProfessionsView(input);
    const body = model.mode === 'simplified' ? this.simplifiedHtml(model) : this.fullHtml(model);
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.professions.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.professions.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="prof-scroll">${body}</div>`;

    this.wire(el);
    const scroll = el.querySelector('.prof-scroll');
    if (scroll) scroll.scrollTop = prevScrollTop;
    // Re-latch BEFORE the refocus: restoreFirstEnabled's focus() dispatches
    // focus listeners synchronously, and the latch must describe the paint,
    // not whatever those listeners do next.
    this.lastSig = prebuiltSig ?? professionsRefreshSig(input);
    if (hadFocus) {
      // Matched by SCANNING the keyed controls rather than building an
      // attribute selector out of the key: the key embeds wire-supplied ids,
      // and a selector string is the one place those could throw
      // (querySelector SyntaxError) or escape their quotes. A comparison
      // cannot do either. Degradation rungs: the same control, then Close,
      // and deliberately NOTHING in between. Every action button this window
      // paints SPENDS (a slot burns a crafted charm, a recharge consumes
      // materials), and input.ts leaves a focused button's Enter default
      // alone, so a rung that re-parks focus on a DIFFERENT action button
      // hands an Enter activation to an action the player never aimed at
      // (with the default binds the same press also opens chat, which
      // usually absorbs the repeat stream, but the hazard is live for a
      // rebound chat key or an unavailable composer, and the rung is free
      // to drop). Close is the one control whose accidental activation
      // costs nothing. A future non-spending row control may earn a middle
      // rung, deliberately.
      const keyed = [...el.querySelectorAll<HTMLElement>('[data-focus-key]')];
      const exact =
        focusKey === null
          ? null
          : (keyed.find((node) => node.dataset.focusKey === focusKey) ?? null);
      restoreFirstEnabled([exact, el.querySelector<HTMLElement>('[data-close]')]);
    }
  }

  private buildInput(): ProfessionsViewInput {
    const world = this.deps.world();
    return {
      identity: world.craftingIdentity,
      gathering: world.professionsState.skills.map((row) => {
        // The denominator comes from the GATHERING_PROFESSIONS content table,
        // the character sheet's cure (gathering_view.ts
        // buildGatheringProficiencyRows): the wire row's maxSkill is the same
        // number on an honest server but it is per-row rather than total, so
        // a missing or malformed row must never paint a nonsense "12 / 0".
        // hasOwn because the id is wire-mirrored (the prototype-key doctrine);
        // an unknown id keeps the wire value and falls out at the view's
        // name-key guard.
        const cap = Object.hasOwn(GATHERING_PROFESSIONS, row.professionId)
          ? GATHERING_PROFESSIONS[row.professionId as GatheringProfessionId].maxSkill
          : row.maxSkill;
        return {
          professionId: row.professionId,
          skill: Number.isFinite(row.skill) ? Math.max(0, row.skill) : 0,
          maxSkill: cap,
        };
      }),
      toolEffects: world.toolEffectSlots.map((row) => ({
        professionId: row.professionId,
        effectId: row.effectId,
        charges: row.charges,
        maxCharges: row.maxCharges,
        confirmMode: row.confirmMode,
        selfCrafted: row.selfCrafted,
      })),
      inventory: world.inventory,
      viewerName: world.player.name,
      // The R40 "Ask each use" toggles (painter-local, survives rebuilds in
      // this field the way the section scroller does). Sorted for the sig.
      slotModePrompt: [...this.slotModePrompt].sort(),
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
    // The specialized-corner copy call: when the next milestone ahead of
    // the trending craft is the
    // specialization threshold rather than a plain tier, the CTA names what
    // the crossing actually unlocks instead of "the next tier".
    const cta =
      simplified.cta.kind === 'raise'
        ? t(
            simplified.nextUnlock.kind === 'specialized'
              ? 'hudChrome.professions.ctaRaiseSpecialized'
              : 'hudChrome.professions.ctaRaise',
            {
              craft: craftNameText(simplified.cta.craftId),
              points: this.fmt(simplified.cta.points),
            },
          )
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
    // The hero band pairs the identity card with the ring on its stage; the
    // craft grid, perks, nudges, and gathering follow as section cards.
    return (
      `<div class="prof-hero">${this.identityHtml(model)}${this.ringHtml(model)}</div>` +
      this.craftsHtml(model) +
      this.perksHtml(model) +
      this.nudgesHtml(model) +
      this.gatheringHtml(model)
    );
  }

  private identityHtml(model: ProfessionsViewModel): string {
    const summary = model.identity.summary;
    const crestUrl = archetypeImageUrl(summary.pairId);
    const lines =
      model.identity.state === 'attuned' && summary.majors !== null
        ? `<div class="prof-archetype-summary">` +
          `${crestUrl ? `<img class="prof-archetype-crest" src="${esc(crestUrl)}" alt="" draggable="false">` : ''}` +
          `<div class="prof-archetype-copy"><div class="prof-pair-title">${esc(archetypeTitleText(summary.pairId))}</div>` +
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
          )}</div></div></div>`
        : `<p class="prof-identity-paragraph">${esc(t('hudChrome.professions.unattunedIdentity'))}</p>`;
    // The switch-cost line renders only once the player has ever attuned
    // (model.switchCost.show, the maintainer copy call): before that there is
    // no archetype to switch from and the line is noise.
    const switchCost = model.switchCost.show
      ? `<div class="prof-switch-cost">${esc(
          t('hudChrome.professions.switchCost', {
            cost: this.fmt(model.switchCost.nextSwitchCost),
          }),
        )}</div>`
      : '';
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
    // The stage is the showcase treatment (the char-window model panel
    // lineage): an inset card with a warm haze behind the wheel, purely
    // decorative chrome around the same role="img" ring.
    return (
      `<div class="prof-ring-stage">` +
      `<div class="prof-ring" role="img" aria-label="${esc(t('hudChrome.professions.ringAria'))}">` +
      `<svg class="prof-ring-svg" viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true" focusable="false">${svgParts.join('')}</svg>${nodes}</div></div>`
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
    // Row anatomy (the text-squish fix): the name line carries ONLY the name
    // and the right-aligned skill value; the role and ceiling chips get their
    // own line below, so long localized names and wide chips can never fight
    // for one baseline.
    return (
      `<li class="prof-craft-row role-${row.identity.role}">` +
      `<img class="prof-craft-icon" src="${professionIconUrl(`prof_${row.identity.craftId}`, ROW_ICON_SIZE)}" alt="" draggable="false">` +
      `<div class="prof-craft-main">` +
      `<div class="prof-craft-head"><span class="prof-craft-name">${esc(name)}</span>` +
      `<span class="prof-skill-value">${esc(
        t('hudChrome.professions.skillValue', {
          skill: this.fmt(row.bar.skill),
          max: this.fmt(row.bar.maxSkill),
        }),
      )}</span></div>` +
      `<div class="prof-craft-chips"><span class="prof-role-badge">${esc(t(ROLE_LABEL_KEYS[row.identity.role]))}</span>` +
      `<span class="prof-ceiling">${esc(t(CEILING_LABEL_KEYS[row.identity.ceiling]))}</span></div>` +
      `<div class="prof-bar-wrap"><span class="prof-bar"><span class="prof-bar-fill" style="width:${pct}%"></span></span>` +
      `<span class="prof-pips" role="img" aria-label="${esc(
        t('hudChrome.professions.tierPipAria', { tier: this.fmt(row.bar.tierIndex) }),
      )}">${pips}</span></div>` +
      `<div class="prof-next">${esc(this.nextUnlockText(row.nextUnlock))}</div>` +
      `</div></li>`
    );
  }

  private nextUnlockText(unlock: CraftNextUnlock): string {
    if (unlock.kind === 'mastered') return t('hudChrome.professions.nextUnlockMastered');
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
        // The shared hasOwn-safe getter (one idiom for the rule): the id is
        // wire-mirrored, and a bare index on a prototype key would resolve a
        // function that passes the undefined check and reaches t().
        const key = gatheringProfessionNameKey(row.professionId);
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
          `<div class="prof-bar-wrap"><span class="prof-bar"><span class="prof-bar-fill" style="width:${pct}%"></span></span></div>` +
          this.gatherEffectHtml(row) +
          `</div></li>`
        );
      })
      .join('');
    if (rows === '') return '';
    return `<section class="prof-gathering"><h3 class="prof-section-header">${esc(t('hudChrome.professions.gatheringHeader'))}</h3><ul class="prof-list" role="list">${rows}</ul></section>`;
  }

  // The slotted tool effect, under its profession's skill bar, plus the
  // slot/recharge affordances the acquisition craft opened. The effect line
  // renders NOTHING when the profession has no slot (an always-present "no
  // effect" line would be permanent rows of absence in a window that is
  // otherwise all progress); the action buttons render exactly when the
  // model's resolver-derived flags say the command would accept.
  private gatherEffectHtml(row: ProfessionsGatheringRow): string {
    const effect = row.effect;
    let html = '';
    if (effect) {
      // The shared hasOwn-safe getter, same rule as the profession name.
      const nameKey = toolEffectNameKey(effect.effectId);
      if (nameKey !== undefined) {
        // Spent says so in words rather than showing "0 / 30", which reads
        // like a broken tool rather than a rechargeable one that has done its
        // work.
        const charges = effect.spent
          ? t('hudChrome.professions.toolEffectSpent')
          : t('hudChrome.professions.toolEffectCharges', {
              charges: this.fmt(effect.charges),
              max: this.fmt(effect.maxCharges),
            });
        // The cost preview (the UX pass): the priced material and count the
        // resolver would charge RIGHT NOW, beside the button that sends it.
        // Ceil-priced, so the blind marginal top-up reads honestly: at 49 of
        // 50 the line says one full material for the one charge. R46's deny
        // line stays the affordability surface; this is the price surface.
        const rechargeDef = effect.recharge ? ITEMS[effect.recharge.materialItemId] : undefined;
        const price =
          effect.recharge && rechargeDef
            ? `<span class="prof-effect-price">${esc(
                t('hudChrome.professions.toolEffectRechargePrice', {
                  count: this.fmt(effect.recharge.count),
                  material: itemDisplayName(rechargeDef),
                }),
              )}</span>`
            : '';
        const recharge = effect.rechargeable
          ? `${price}<button type="button" class="btn prof-effect-btn" data-recharge-profession="${esc(row.professionId)}" data-focus-key="recharge:${esc(row.professionId)}">${esc(
              t('hudChrome.professions.toolEffectRechargeButton'),
            )}</button>`
          : '';
        // The R40 mode chip: a 'prompt' slot says it asks, in words beside
        // the charges, so the per-use dialog never reads as a malfunction.
        // Not hue-gated: the chip IS the second signal.
        const modeChip =
          effect.confirmMode === 'prompt'
            ? `<span class="prof-effect-mode">${esc(t('hudChrome.professions.toolEffectModePrompt'))}</span>`
            : '';
        // data-effect-tip marks the live row for the shared attachTooltip
        // wiring below: the hover card explains the bonus and charge ladder
        // the compact line cannot fit. Minted only when the id has a full
        // card (hasToolEffectCard), so the marker, the cursor:help cue, the
        // tab stop, and the attach can never disagree. tabindex puts the row
        // in the tab order so the card is keyboard-reachable (attachTooltip's
        // focusin path): once the charm is slotted and no spare is carried,
        // this row is the only surface still explaining the bonus. The
        // focus key is the restore ladder's "non-spending middle rung" (see
        // render): without it a repaint under a focused row parks focus on
        // Close and the next Enter closes the window.
        const tipAttrs = hasToolEffectCard(effect.effectId)
          ? ` data-effect-tip="${esc(effect.effectId)}" data-focus-key="effect:${esc(row.professionId)}" tabindex="0"`
          : '';
        html +=
          `<div class="prof-effect${effect.spent ? ' prof-effect-spent' : ''}"${tipAttrs}>` +
          `<span class="prof-effect-name">${esc(t(nameKey))}</span>` +
          `<span class="prof-effect-charges">${esc(charges)}</span>${modeChip}${recharge}</div>`;
      }
    }
    const slotButtons = row.slottable
      .map((effectId) => {
        const nameKey = toolEffectNameKey(effectId);
        if (nameKey === undefined) return '';
        return `<button type="button" class="btn prof-effect-btn" data-slot-profession="${esc(row.professionId)}" data-slot-effect="${esc(effectId)}" data-focus-key="slot:${esc(row.professionId)}:${esc(effectId)}">${esc(
          t('hudChrome.professions.toolEffectSlotButton', { effect: t(nameKey) }),
        )}</button>`;
      })
      .join('');
    if (slotButtons !== '') {
      // The R40 mode toggle rides the actions row: it configures the NEXT
      // slot action (the mode is part of the mint), so it renders exactly
      // when a slot button does. A real labeled checkbox: keyboard-operable,
      // announced by its own text, and focus-keyed so the rebuild the toggle
      // triggers restores focus onto it (the exact-control rung).
      const checked = this.slotModePrompt.has(row.professionId) ? ' checked' : '';
      const toggle =
        `<label class="prof-effect-mode-toggle"><input type="checkbox" data-slot-mode="${esc(row.professionId)}" data-focus-key="slotmode:${esc(row.professionId)}"${checked}> ` +
        `${esc(t('hudChrome.professions.toolEffectModeAsk'))}</label>`;
      html += `<div class="prof-effect-actions">${slotButtons}${toggle}</div>`;
    }
    return html;
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
    // Slot/recharge senders: command only, never predicted, and NO repaint
    // here. The pid-scoped toolEffectResult event is the one repaint path
    // (Hud's arm re-renders an open professions window), which keeps this
    // handler from rebuilding the subtree mid-click and walking into the
    // refocus double-fire family (the #2377 ruling); the 500 ms
    // refreshIfChanged band backstops it either way, since the signature
    // hashes the charm and charge state these buttons derive from.
    //
    // What each button promises, exactly: the SLOT set is exact (the view
    // threads the same live slot, provenance boolean, and slotter name the
    // server resolver reads, so a rendered slot button is an action the
    // server accepts barring a race the event then reports). RECHARGEABLE
    // means the resolver accepts; affordability and the shared throttle live
    // in the command body. The PRICE surface is now split (the UX pass): the
    // .prof-effect-price line previews the resolver's material and count
    // before the click, while R46's deny line stays the AFFORDABILITY
    // surface, so the button still renders for a player who cannot afford
    // it on purpose.
    //
    // The sent-guard: one command per painted button. The repaint that
    // answers the command replaces the node (fresh dataset), and every
    // RESOLVER refusal emits the event that triggers it; until then, a
    // double-click or a held Enter's key repeats on the SAME button send
    // nothing more. Guarding beats disabling, because disabling the focused
    // button drops keyboard focus to <body> before the repaint can restore
    // it. THE RESIDUALS the one-shot timer below covers: a frame that never
    // reaches the sim (the reconnect window's closed socket, spectate's
    // command drop, a lane-refused frame) answers with nothing, and the
    // sim's PRE-RESOLVER dead gate answers on the chat line with no
    // toolEffectResult (the deliberate no-new-wire-reason choice), so both
    // leave the node for the re-arm rather than dead until a reopen; if a
    // real answer then arrives late, a duplicate send is refused server-side
    // (no_gain or already_full), so the race costs nothing.
    for (const button of el.querySelectorAll<HTMLElement>('[data-slot-effect]')) {
      const effectId = button.getAttribute('data-slot-effect');
      // Hover card: what the charm does and how slotting works, so a player
      // never has to burn a charm to learn the bonus. A retired id has no
      // card, so skip the attach rather than show an empty box. The lazy
      // closure is the attachTooltip family idiom (deeds/bank cells).
      if (effectId !== null && hasToolEffectCard(effectId)) {
        this.deps.attachTooltip(button, () => toolEffectStandaloneTooltip(effectId));
      }
      button.addEventListener('click', () => {
        // A long-press that showed the hover card peeks; its release click
        // must inspect, never spend the charm (the bags cell contract:
        // dismiss the card, fire nothing).
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        if (button.dataset.sent !== undefined) return;
        const professionId = button.getAttribute('data-slot-profession');
        const slotEffectId = button.getAttribute('data-slot-effect');
        if (professionId === null || slotEffectId === null) return;
        this.armSentGuard(button);
        // The R40 mode rides the mint: 'prompt' when the row's toggle is on,
        // OMITTED otherwise so the plain send stays byte-identical.
        if (this.slotModePrompt.has(professionId)) {
          this.deps.world().slotToolEffect(professionId, slotEffectId, 'prompt');
        } else {
          this.deps.world().slotToolEffect(professionId, slotEffectId);
        }
        audio.click();
      });
    }
    // Live effect rows: same hover card as the slot buttons, so an already-
    // slotted charm still explains its bonus without forcing the player to
    // open the bags and re-read the item. Every marked row has a card by
    // construction: the painter mints data-effect-tip only when
    // hasToolEffectCard says so (and skips retired-name rows entirely,
    // pinned by the layout rig's retired-id case).
    for (const row of el.querySelectorAll<HTMLElement>('[data-effect-tip]')) {
      const effectId = row.getAttribute('data-effect-tip');
      if (effectId === null) continue;
      this.deps.attachTooltip(row, () => toolEffectStandaloneTooltip(effectId));
    }
    // The R40 mode toggles: flip the painter-local choice and repaint (the
    // slottable set asks the resolver with the sent mode, so the button set
    // can change with the toggle). render() re-latches the signature and the
    // focus ladder restores onto the checkbox's own focus key.
    for (const box of el.querySelectorAll<HTMLInputElement>('[data-slot-mode]')) {
      box.addEventListener('change', () => {
        const professionId = box.getAttribute('data-slot-mode');
        if (professionId === null) return;
        if (box.checked) this.slotModePrompt.add(professionId);
        else this.slotModePrompt.delete(professionId);
        audio.click();
        this.render();
      });
    }
    for (const button of el.querySelectorAll<HTMLElement>('[data-recharge-profession]')) {
      button.addEventListener('click', () => {
        // The recharge button sits inside the live effect row, whose hover
        // card arms the peek guard on a long press (the pointerdown bubbles
        // to the row); the release click must dismiss the card and not
        // spend materials.
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        if (button.dataset.sent !== undefined) return;
        const professionId = button.getAttribute('data-recharge-profession');
        if (professionId === null) return;
        this.armSentGuard(button);
        this.deps.world().rechargeToolEffect(professionId);
        audio.click();
      });
    }
  }

  /** Mark a button as having sent its command, with the dropped-frame
   *  re-arm: a ONE-SHOT timer (not a repeating driver, so the cold-window
   *  contract holds) clears the guard if no repaint replaced the node,
   *  covering the paths where the frame never reaches the sim and no
   *  toolEffectResult can answer. */
  private armSentGuard(button: HTMLElement): void {
    button.dataset.sent = '1';
    // Spelled window.setTimeout so the host reach is visible to the
    // architecture sweep (UI_HOST_GLOBALS scans window.*, not bare timers),
    // which puts this module back on the UI_DOM_MODULES ledger instead of
    // arming a real host timer from the "reaches no host" bucket.
    window.setTimeout(() => {
      if (button.isConnected) delete button.dataset.sent;
    }, SENT_GUARD_REARM_MS);
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }
}
