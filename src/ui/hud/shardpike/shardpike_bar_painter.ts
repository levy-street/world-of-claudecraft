// The Shardpike bar's DOM half: three buttons and a balance beam.
//
// Decisions live in shardpike_bar_view.ts; this only writes. The three buttons are built
// ONCE in the constructor and then only re-stated through the shared PainterHost writers,
// never rebuilt: the beam moves every sim tick, so an innerHTML rebuild keyed on the beam
// would re-mint the row twenty times a second and throw away focus and any in-flight
// press with it.

import { t } from '../../i18n';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import type { ShardpikeBarState, ShardpikeButtonState } from './shardpike_bar_view';
import type { LeanBindingSource } from './shardpike_lean_view';
import { shardpikeTooltipHtml, shardpikeTooltipModel } from './shardpike_tooltip';

/**
 * How the bar attaches a hover card, injected rather than imported.
 *
 * The shared `#tooltip` box is the HUD coordinator's own DOM, so a painter cannot reach it
 * without reaching around the seam; every other component that wants a card takes the same
 * one-line capability. Optional because two hosts build a HUD over a narrower document and
 * neither has the box: a missing tooltip must degrade to no tooltip, not to no bar.
 */
export type ShardpikeTooltipAttach = (el: HTMLElement, html: () => string) => void;

/** The HUD capabilities the bar's buttons need beyond the writers. */
export interface ShardpikeBarDeps {
  /** See ShardpikeTooltipAttach. Absent on a host with no shared tooltip box. */
  attachTooltip?: ShardpikeTooltipAttach;
  /**
   * Whether this click is the tail of a touch long-press that showed the card, in which case
   * the verb must NOT fire (src/ui/touch_peek.ts).
   *
   * Required as soon as the buttons have a tooltip at all: on touch there is no hover, so
   * reading the card means holding the button, and the release still delivers a click. Two
   * things go wrong without it, and the second is the worse one. Inspecting the thrust would
   * spend the window it is describing. And the guard is SHARED HUD state, so a peek this bar
   * never consumes is still armed when the finger lands on an action-bar slot, which then
   * swallows that ability cast instead.
   */
  consumePeek?: () => boolean;
  /** The live key bindings, for the lean keycaps' text (shardpike_lean_view.ts). Absent on
   *  a host with no keybinds: the keycaps then show their arrows and still work. */
  keybinds?: () => LeanBindingSource;
}

/** What the painter calls when a button is pressed. */
export type ShardpikeAction = ShardpikeButtonState['action'];

/** What the painter calls as a lean keycap is pressed (-1 / 1) and released (0). */
export type ShardpikeLeanHandler = (hold: -1 | 0 | 1) => void;

interface LeanKeyParts {
  root: HTMLButtonElement;
  cap: HTMLElement;
}

interface ButtonParts {
  root: HTMLButtonElement;
  cooldown: HTMLElement;
  /** The draining availability ring. Present on every button; only drawn when it has a window. */
  window: HTMLElement;
}

export class ShardpikeBarPainter {
  private buttons = new Map<ShardpikeAction, ButtonParts>();
  private beam: HTMLElement | null = null;
  private pip: HTMLElement | null = null;
  private setFill: HTMLElement | null = null;
  private lean: HTMLElement | null = null;
  private leanKeys: { left: LeanKeyParts; right: LeanKeyParts } | null = null;
  private built = false;
  /** The most recent painted state, read by the hover card's lazily-resolved thunk. */
  private last: ShardpikeBarState | null = null;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement,
    private readonly onAction: (action: ShardpikeAction) => void,
    private readonly deps: ShardpikeBarDeps = {},
    private readonly onLean: ShardpikeLeanHandler = () => {},
  ) {}

  paint(state: ShardpikeBarState): void {
    this.writers.setDisplay(this.root, state.visible ? 'flex' : 'none');
    if (!state.visible) return;
    if (!this.built) this.build(state);
    // The card is built from whatever the bar last painted, not from the frame the button
    // was created on: the reason line is a live fact, and the buttons are built once.
    this.last = state;

    for (const spec of state.buttons) {
      const parts = this.buttons.get(spec.action);
      if (!parts) continue;
      // `disabled` rather than hidden: the row must not reflow under the player's cursor
      // mid-fight, and a greyed button still teaches what the pike can do.
      this.writers.setAttr(parts.root, 'aria-disabled', spec.enabled ? 'false' : 'true');
      this.writers.toggleClass(parts.root, 'disabled', !spec.enabled);
      this.writers.toggleClass(parts.root, 'primed', spec.primed);
      this.writers.toggleClass(parts.root, 'cooldown', spec.cooldownSeconds !== null);
      this.writers.setText(
        parts.cooldown,
        spec.cooldownSeconds !== null ? String(spec.cooldownSeconds) : '',
      );
      // The availability window: a bright ring that DRAINS, never a dark overlay that
      // fills. See the `windowFrac` doc comment for why the distinction matters.
      this.writers.toggleClass(parts.root, 'windowed', spec.windowFrac !== null);
      if (spec.windowFrac !== null) {
        this.writers.setStyleProp(parts.window, '--pike-window', spec.windowFrac.toFixed(3));
        // The seconds go in the SHARED centred slot, not inside the ring: the ring is
        // mask-composited down to its own border and a mask clips text. Same glyph position
        // as a cooldown, opposite meaning, and the `.cooldown` class is what gives that slot
        // its dark backdrop, so a window shows bright digits over live art instead.
        this.writers.setText(parts.cooldown, String(spec.windowSeconds ?? ''));
      }
    }

    if (this.lean && this.leanKeys) {
      this.writers.toggleClass(this.lean, 'active', state.bracing);
      this.paintLeanKey(this.leanKeys.left, state.leanKeys.left, 'left');
      this.paintLeanKey(this.leanKeys.right, state.leanKeys.right, 'right');
    }
    if (this.beam) this.writers.toggleClass(this.beam, 'active', state.bracing);
    if (this.beam) this.writers.toggleClass(this.beam, 'danger', state.danger);
    if (this.pip) {
      this.writers.setStyleProp(this.pip, '--pike-balance', state.balanceFrac.toFixed(3));
    }
    if (this.setFill) {
      this.writers.setStyleProp(this.setFill, '--pike-set', state.setFrac.toFixed(3));
    }
  }

  hide(): void {
    this.writers.setDisplay(this.root, 'none');
    // A hidden bar can never be holding a lean.
    this.onLean(0);
  }

  /** One keycap's text and accessible name: the bound key, or the bare arrow when none. */
  private paintLeanKey(parts: LeanKeyParts, key: string, side: 'left' | 'right'): void {
    this.writers.setText(parts.cap, key);
    this.writers.toggleClass(parts.root, 'unbound', key === '');
    const name =
      side === 'left'
        ? key
          ? t('hudChrome.shardpike.leanLeftKey', { key })
          : t('hudChrome.shardpike.leanLeft')
        : key
          ? t('hudChrome.shardpike.leanRightKey', { key })
          : t('hudChrome.shardpike.leanRight');
    this.writers.setAttr(parts.root, 'aria-label', name);
  }

  /**
   * One press-and-hold lean keycap.
   *
   * Pointer events, so one listener set serves the mouse and a finger alike, with the
   * pointer CAPTURED on press: a thumb that slides off the cap mid-lean must keep leaning
   * until it lifts, not drop the stick the instant it crosses the border. Every way the
   * press can end (release, cancel, a lost capture) releases the lean, so it can never stick.
   */
  private buildLeanKey(doc: Document, side: 'left' | 'right'): LeanKeyParts {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `ui-keycap pike-lean-key pike-lean-${side}`;
    const arrow = doc.createElement('span');
    arrow.className = 'pike-lean-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    // A build-time glyph, set once (the per-frame text is the cap).
    arrow.textContent = side === 'left' ? '←' : '→';
    const cap = doc.createElement('span');
    cap.className = 'pike-lean-cap';
    if (side === 'left') btn.append(arrow, cap);
    else btn.append(cap, arrow);
    const dir: -1 | 1 = side === 'left' ? -1 : 1;
    const release = () => {
      this.writers.toggleClass(btn, 'held', false);
      this.onLean(0);
    };
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try {
        btn.setPointerCapture(ev.pointerId);
      } catch {
        // A synthetic or already-released pointer cannot be captured; the press still leans.
      }
      this.writers.toggleClass(btn, 'held', true);
      this.onLean(dir);
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    // A long press on touch opens the context menu otherwise, which steals the hold.
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return { root: btn, cap };
  }

  /**
   * One-time DOM build.
   *
   * Deferred to the first VISIBLE paint rather than done in the constructor: almost no
   * session ever equips this quest tool, and a player who never takes the quest should not
   * pay for three buttons and a beam sitting in the document.
   */
  private build(state: ShardpikeBarState): void {
    this.built = true;
    const doc = this.root.ownerDocument;

    const beam = doc.createElement('div');
    beam.className = 'pike-beam';
    beam.setAttribute('role', 'img');
    beam.setAttribute('aria-label', t('hudChrome.shardpike.beamLabel'));
    const track = doc.createElement('div');
    track.className = 'pike-beam-track';
    const setFill = doc.createElement('div');
    setFill.className = 'pike-beam-set';
    const pip = doc.createElement('div');
    pip.className = 'pike-beam-pip';
    track.append(setFill, pip);
    beam.append(track);
    this.beam = beam;
    this.pip = pip;
    this.setFill = setFill;

    // The lean keycaps ride ABOVE the beam: the stick sits right over the thing it steers.
    const lean = doc.createElement('div');
    lean.className = 'pike-lean';
    const left = this.buildLeanKey(doc, 'left');
    const right = this.buildLeanKey(doc, 'right');
    lean.append(left.root, right.root);
    this.lean = lean;
    this.leanKeys = { left, right };

    const group = doc.createElement('div');
    group.className = 'pike-group';
    for (const spec of state.buttons) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'pike-btn';
      // Deliberately NO `data-focus-key`. That attribute is the shared identity the
      // focus-restore contract keys off (src/ui/focus_restore.ts, #2528), and it is for
      // painters that WIPE their own subtree and have to put the player's focus back on the
      // rebuilt equivalent. This bar builds once and only re-states, so nothing is ever
      // destroyed under a keyboard player and there is nothing to restore; writing a key it
      // never reads would put a dead entry in a namespace other windows query.
      const label = t(spec.labelKey);
      // No `title` attribute alongside the card. The two would race on hover, and the
      // native tooltip is the one that wins on a delay and covers the real one; the
      // accessible name is what a screen reader wants here, and it is set below.
      btn.setAttribute('aria-label', label);
      // Resolved at hover, never at build: the reason line has to describe the fight as it
      // is when the pointer arrives, and `spec` here is the state of one long-past frame.
      this.deps.attachTooltip?.(btn, () => {
        const live = this.last?.buttons.find((b) => b.action === spec.action) ?? spec;
        return shardpikeTooltipHtml(shardpikeTooltipModel(live, this.last?.bracing ?? false));
      });
      const img = doc.createElement('img');
      img.className = 'pike-btn-icon';
      img.src = iconDataUrl('ability', spec.iconId);
      img.alt = '';
      const cooldown = doc.createElement('span');
      cooldown.className = 'pike-btn-cd';
      const window = doc.createElement('span');
      window.className = 'pike-btn-window';
      btn.append(img, cooldown, window);
      // One listener per button for the life of the bar. The handler re-reads the live
      // disabled state off the DOM rather than closing over this frame's spec, so a stale
      // closure can never fire a verb the sim would refuse.
      btn.addEventListener('click', () => {
        // Before the disabled check, not after: a peek has to be consumed even on a greyed
        // button, or it stays armed and eats the next tap on some other control entirely.
        if (this.deps.consumePeek?.()) return;
        if (btn.getAttribute('aria-disabled') === 'true') return;
        this.onAction(spec.action);
      });
      group.append(btn);
      this.buttons.set(spec.action, { root: btn, cooldown, window });
    }

    this.root.append(lean, beam, group);
  }
}
