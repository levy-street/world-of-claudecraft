// Thin painter for the instance-transition veil. The trigger detection and
// the cover/hold/reveal phase machine live in zone_veil_view.ts; this turns
// that state into DOM, routing every write through the host's elided writers
// over elements resolved once by the composing Hud. The destination label is
// resolved only when a new veil starts (the core's gen counter), never per
// frame. The fade durations are published as CSS custom properties from the
// core's constants, so the class toggle and the opacity transition share one
// source; reduced motion is handled by the CSS multiplying those durations by
// --motion-scale (the repo's single motion authority), not here.

import { dungeonDisplayName, tEntity, zoneDisplayName } from './entity_i18n';
import { t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { VEIL_COVER_MS, VEIL_REVEAL_MS, type VeilDest, type ZoneVeilState } from './zone_veil_view';

export class ZoneVeilPainter {
  private lastGen = 0;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement, // #zone-veil
    private readonly sub: HTMLElement, // #zone-veil .veil-sub
    private readonly name: HTMLElement, // #zone-veil .veil-name
  ) {
    writers.setStyleProp(root, '--veil-cover-ms', `${VEIL_COVER_MS}ms`);
    writers.setStyleProp(root, '--veil-reveal-ms', `${VEIL_REVEAL_MS}ms`);
  }

  paint(state: ZoneVeilState): void {
    if (state.dest && state.gen !== this.lastGen) {
      this.lastGen = state.gen;
      this.writers.setText(this.sub, t('hudChrome.veil.entering'));
      this.writers.setText(this.name, destName(state.dest));
    }
    // cover + hold keep the curtain up; reveal/idle let the CSS fade it out
    this.writers.toggleClass(this.root, 'show', state.phase === 'cover' || state.phase === 'hold');
  }
}

// Localize the core's destination discriminator through the existing entity
// resolvers; only the arena needs its own chrome key (it is not an entity).
function destName(dest: VeilDest): string {
  switch (dest.kind) {
    case 'zone':
      return zoneDisplayName(dest.id);
    case 'dungeon':
      return dungeonDisplayName(dest.id);
    case 'delve':
      return tEntity({ kind: 'delve', id: dest.id, field: 'name' });
    case 'arena':
      return t('hudChrome.veil.arenaName');
  }
}
