// The target / boss cast bar (#tf-castbar): one CastBarPainter instance wired for
// the target, plus the reused paint input it fills from the target entity each
// frame. Lifted out of hud.ts so the coordinator keeps one call. The TARGET instance:
//   - resolves every cast id to its visible name through targetCastDisplayName
//     (hoard and rift boss wind-ups, then abilityDisplayNameFromSource, so a cave
//     boss never shows its raw cast id: cast_display_name.ts);
//   - fills the bar's icon slot with the boss ability painting the Adventure
//     Journal shows for that cast, keyed by the caster's mob template so no player
//     or trash cast borrows it (hud/journal/journal_cast_icons.ts); a cast with no
//     painting keeps the slot hidden;
//   - never eats or drinks (its input has no `consume`) and hides with only
//     display:none (no clearOnHide).
// Every write goes through the PainterHost elided writers inside CastBarPainter, so
// an unchanged frame costs no DOM mutation. The icon is cosmetic: it never hides or
// delays the bar, its fill or its label.

import { castBarState } from '../render/cast_bar';
import type { Entity } from '../sim/types';
import { CastBarPainter, type CastBarPaintInput } from './cast_bar_painter';
import { targetCastDisplayName } from './cast_display_name';
import { journalCastArtUrl } from './hud/journal/journal_cast_icons';
import type { PainterHostWriters } from './painter_host';

export class TargetCastBar {
  private readonly painter: CastBarPainter;
  // Reused every frame: the painter reads it, nothing keeps it.
  private readonly input: CastBarPaintInput = {
    cast: { visible: false, channel: false, fill: 0, label: '', fishing: false },
    castRemaining: 0,
  };

  constructor(writers: PainterHostWriters, bar: HTMLElement) {
    this.painter = new CastBarPainter(
      writers,
      {
        bar,
        fill: bar.querySelector('.fill') as HTMLElement,
        label: bar.querySelector('.label') as HTMLElement,
        timer: bar.querySelector('.timer') as HTMLElement,
        icon: (bar.querySelector('.ui-cast-icon') as HTMLElement | null) ?? undefined,
      },
      {
        resolveCastLabel: (s) => targetCastDisplayName(s.label),
        resolveCastIcon: journalCastArtUrl,
      },
    );
  }

  /** Paint the target's cast (or hide the bar when it casts nothing). */
  paint(target: Entity): void {
    this.input.cast = castBarState(target);
    this.input.castRemaining = target.castRemaining;
    this.input.casterTemplateId = target.templateId;
    this.painter.paint(this.input);
  }
}
