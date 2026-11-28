// Thin painter for the overhead cast bars. The pure fill/discriminator logic lives
// in src/render/cast_bar.ts (castBarState + consumeBarState, both i18n-free); this
// turns those states into DOM, resolving the visible LABEL via i18n in the PAINTER
// (the core emits a stable discriminator only) and routing EVERY write through the
// host's elided writers so a no-op frame costs no DOM mutation. The
// `.channel` class goes through toggleClass (the multi-slot writer): the
// four single-slot writers cannot express a classList toggle, and a raw classList
// write would silently collapse the skip-rate (Top risk 1).
//
// It is INSTANCE-PARAMETERIZED, not bespoke: the same class drives the
// PLAYER bar (#castbar) and the TARGET bar (#tf-castbar) from their own element
// sets. The two differ only in their options, never in a branch on "which bar":
//   - `resolveCastLabel` localizes the cast id. The player resolves it through
//     castDisplayName (the ability's localized name); the target resolves through
//     abilityDisplayNameFromSource (hud.ts).
//   - the eat/drink overlay is PLAYER-ONLY: the target never eats/drinks, so its
//     paint input simply omits `consume` and the consume branch is unreachable for
//     it (the generic-Entity cast path stays the target's whole story).
//   - `resolveCastIcon` (TARGET-ONLY) fills the bar's icon slot with a boss
//     ability painting: the caster's template and cast id resolve through the
//     journal cast index (hud/journal/journal_cast_icons.ts). The resolve reruns
//     only when (caster, cast) changes and the slot writes go through the elided
//     writers, so an unchanged frame costs nothing; the player passes no resolver.
//   - `clearOnHide` clears the inner fill/label/timer + channel class when hidden.
//     The player's inline block did this; the target's hidden path only set
//     display:none, so the target leaves it off and stays byte-faithful.
//
// No magic values: the cast-vs-channel-vs-eat/drink fill color is the
// `.channel` CSS class, never a hex in TS; the percent precision and the consume
// label keys are named constants; CONSUME_DURATION lives in the core, not here.

import type {
  CastBarState,
  ConsumeBarState,
  ConsumeMode,
  MountSummonBarState,
} from '../render/cast_bar';
import { formatNumber, type TranslationKey, t } from './i18n';
import { mountDisplayName } from './mount_labels';
import type { PainterHostWriters } from './painter_host';

// The channel class drives the draining (vs filling) fill color via CSS; a channel,
// a fishing channel, and the eat/drink overlay all use it.
const CHANNEL_CLASS = 'channel';
const UI_CHANNEL_CLASS = 'ui-cast--channel';
const UI_CONSUME_CLASS = 'ui-cast--consume';
type CastBarStyle = 'cast' | 'channel' | 'consume';
// The display value when the bar is shown, and the hidden value.
const SHOWN_DISPLAY = 'block';
const HIDDEN_DISPLAY = 'none';
// The fill width written on the player's hidden-clear path.
const EMPTY_FILL = '0%';
// Width percent precision (e.g. "62.5%") and the cast/consume timer precision
// (e.g. "1.5"), both one decimal, matching the inline blocks this replaced.
const PERCENT_FRACTION_DIGITS = 1;
// The icon slot's painting rides background-image; the slot hides with the
// boolean hidden attribute (present = hidden, the markup's default).
const BACKGROUND_IMAGE_PROP = 'background-image';
const HIDDEN_ATTR = 'hidden';
const HIDDEN_ATTR_ON = '';
const TIMER_FRACTION_DIGITS = 1;

// The eat/drink mode -> the EXISTING localized label keys (reused, no new keys).
const CONSUME_LABEL_KEYS: Record<ConsumeMode, TranslationKey> = {
  eat: 'hud.core.eating',
  drink: 'hud.core.drinking',
  eatdrink: 'hud.core.eatingDrinking',
};

/** The four DOM nodes one cast-bar instance paints into. */
export interface CastBarElements {
  /** The bar container (#castbar / #tf-castbar): shown/hidden + the channel class. */
  bar: HTMLElement;
  /** The fill (width percent). */
  fill: HTMLElement;
  /** The label node (the localized ability / fishing / eat-drink text). */
  label: HTMLElement;
  /** The timer node (the localized seconds-remaining). */
  timer: HTMLElement;
  /** The bar's icon slot (`.ui-cast-icon`), painted only with `resolveCastIcon`. */
  icon?: HTMLElement;
}

/** Per-instance options that are not DOM element refs. */
export interface CastBarOptions {
  /** Resolve the cast id into the visible label. The player localizes it
   *  (castDisplayName); the target through abilityDisplayNameFromSource. */
  resolveCastLabel: (state: CastBarState) => string;
  /** Clear the inner fill/label/timer + channel class when the bar is hidden (the
   *  player's inline block did; the target only set display:none). */
  clearOnHide?: boolean;
  /** Display value when shown (default 'block'; the crafting window's cast
   *  strip is a flex row). */
  shownDisplay?: string;
  /** The painted icon URL for a cast (the caster's mob template, the cast id),
   *  or null to leave the icon slot hidden. TARGET-ONLY: the boss cast bar. */
  resolveCastIcon?: (casterTemplateId: string | undefined, castId: string) => string | null;
}

/** The per-frame source the painter draws from. */
export interface CastBarPaintInput {
  /** The cast/channel state from castBarState(entity). */
  cast: CastBarState;
  /** The entity's castRemaining, for the cast timer text. */
  castRemaining: number;
  /** The player's eat/drink overlay from consumeBarState; the target OMITS it, so
   *  the target instance can never render eat/drink. */
  consume?: ConsumeBarState;
  /** The player's mount summon channel from mountSummonBarState; the target OMITS
   *  it. Shown only when a summon is in progress (mountCastKey non-empty). Priority:
   *  below cast but above eat/drink, since you cannot cast while mounting. */
  mountSummon?: MountSummonBarState;
  /** The caster's mob template id, for `resolveCastIcon` (the target only). */
  casterTemplateId?: string;
}

export class CastBarPainter {
  // The icon resolve's key and result: rerun only when (caster, cast) changes.
  private iconCaster: string | undefined = undefined;
  private iconCast = '';
  private iconCss: string | null = null;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: CastBarElements,
    private readonly opts: CastBarOptions,
  ) {}

  paint(input: CastBarPaintInput): void {
    if (input.cast.visible) {
      this.paintBar(
        input.cast.channel ? 'channel' : 'cast',
        input.cast.fill,
        this.opts.resolveCastLabel(input.cast),
        input.castRemaining,
      );
      this.paintIcon(input.casterTemplateId, input.cast.label);
    } else if (input.mountSummon?.visible) {
      // PLAYER-ONLY: mount summon channel uses the channel styling (draining bar).
      // The label is the localized mount name (mountDisplayName), which resolves
      // the mount key through the i18n name map; falls back to the raw key.
      this.paintBar(
        'channel',
        input.mountSummon.fill,
        mountDisplayName(input.mountSummon.mountKey),
        input.mountSummon.remaining,
      );
    } else if (input.consume?.visible) {
      // PLAYER-ONLY: the consume overlay uses the channel styling and the localized
      // eat/drink label resolved from the core's stable mode discriminator.
      this.paintBar(
        'consume',
        input.consume.fill,
        t(CONSUME_LABEL_KEYS[input.consume.mode]),
        input.consume.remaining,
      );
    } else {
      this.writers.setDisplay(this.el.bar, HIDDEN_DISPLAY);
      if (this.opts.clearOnHide) {
        this.writers.toggleClass(this.el.bar, CHANNEL_CLASS, false);
        this.writers.toggleClass(this.el.bar, UI_CHANNEL_CLASS, false);
        this.writers.toggleClass(this.el.bar, UI_CONSUME_CLASS, false);
        this.writers.setWidth(this.el.fill, EMPTY_FILL);
        this.writers.setText(this.el.label, '');
        this.writers.setText(this.el.timer, '');
      }
    }
  }

  // Show the bar with a fill/label/timer. State classes are written before the
  // progress and text values so every painter instance follows the same order.
  private paintBar(style: CastBarStyle, fill: number, label: string, remaining: number): void {
    this.writers.setDisplay(this.el.bar, this.opts.shownDisplay ?? SHOWN_DISPLAY);
    this.writers.toggleClass(this.el.bar, CHANNEL_CLASS, style !== 'cast');
    this.writers.toggleClass(this.el.bar, UI_CHANNEL_CLASS, style === 'channel');
    this.writers.toggleClass(this.el.bar, UI_CONSUME_CLASS, style === 'consume');
    this.writers.setWidth(this.el.fill, `${(fill * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`);
    this.writers.setText(this.el.label, label);
    this.writers.setText(this.el.timer, this.timerText(remaining));
    // Report the progress value: the bar is role="progressbar" with static
    // aria-valuemin/max but never exposed a value. Numeric, so no i18n key and no
    // hardcoded literal; routes through the elided setAttr so an unchanged percent does not write.
    this.writers.setAttr(this.el.bar, 'aria-valuenow', String(Math.round(fill * 100)));
  }

  // The boss ability painting in the icon slot (TARGET-ONLY). The hide path
  // leaves the slot alone: the bar itself is display:none, and the next shown
  // cast rewrites it.
  private paintIcon(caster: string | undefined, castId: string): void {
    const icon = this.el.icon;
    const resolve = this.opts.resolveCastIcon;
    if (!icon || !resolve) return;
    if (caster !== this.iconCaster || castId !== this.iconCast) {
      this.iconCaster = caster;
      this.iconCast = castId;
      const url = resolve(caster, castId);
      this.iconCss = url ? `url("${url}")` : null;
    }
    if (this.iconCss) {
      this.writers.setStyleProp(icon, BACKGROUND_IMAGE_PROP, this.iconCss);
      this.writers.setAttr(icon, HIDDEN_ATTR, null);
    } else {
      this.writers.setAttr(icon, HIDDEN_ATTR, HIDDEN_ATTR_ON);
    }
  }

  private timerText(remaining: number): string {
    return formatNumber(Math.max(0, remaining), {
      minimumFractionDigits: TIMER_FRACTION_DIGITS,
      maximumFractionDigits: TIMER_FRACTION_DIGITS,
    });
  }
}
