// Composition seam for the Cooldown Manager: the one call the Hud makes to stand
// it up, so hud.ts (on the monolith ratchet) spends a single line on it. The Hud
// supplies only what it alone owns (the live world, its writer facet, the aura
// overlay whose hotbar glow set this row unions with); this module attaches the
// shared sfx engine and the desktop-bar test, exactly as aura_overlay_wiring.ts
// does for the Auras panel. Wiring, not logic: every rule is in the pure cores.

import { audio } from '../../../game/audio';
import type { ResolvedAbility } from '../../../sim/sim';
import type { AurasPainterDeps } from '../../auras_painter';
import { type AurasDeps, isToggleAuraKind } from '../../auras_view';
import { esc } from '../../esc';
import type { PainterHostWriters } from '../../painter_host';
import {
  type CooldownAuraEntry,
  cooldownAuraCatalog,
  parseCooldownAuraToken,
} from './cooldown_manager_auras';
import {
  CooldownManagerController,
  type CooldownManagerWorld,
} from './cooldown_manager_controller';
import { auraEntryName } from './cooldown_manager_settings';

export interface CooldownTooltipHost {
  hideTooltip?(): void;
  abilityTooltip(ability: ResolvedAbility): string;
  aurasView: Pick<AurasDeps, 'auraName' | 'auraEffectHtml'>;
  aurasPainter: Pick<AurasPainterDeps, 'attachTooltip' | 'renderTooltip'>;
}

/** Whether the desktop action bar is the live bar: the only bar that paints a
 *  proc glow (the same body-class test the Auras panel's Hotbar Glow uses). */
function desktopActionBarLive(): boolean {
  return !document.body.classList.contains('mobile-touch');
}

export function mountCooldowns(
  world: CooldownManagerWorld,
  writers: PainterHostWriters,
  auraOverlay: { readyGlowAbilityIds(): ReadonlySet<string> },
  tooltip: CooldownTooltipHost,
): CooldownManagerController {
  return new CooldownManagerController({
    world,
    writers,
    playCue: (cueId, volume) => audio.auraCue(cueId, volume),
    hotbarGlowAvailable: desktopActionBarLive,
    auraGlowIds: () => auraOverlay.readyGlowAbilityIds(),
    attachTooltip: tooltip.aurasPainter.attachTooltip,
    hideTooltip: tooltip.hideTooltip,
    tooltipHtml: (id, entry) => cooldownTooltipHtml(world, id, tooltip, entry),
  });
}

/** Read live world state on hover, including spell replacements and aura refreshes. */
export function cooldownTooltipHtml(
  world: CooldownManagerWorld,
  id: string,
  host: CooldownTooltipHost,
  entry?: CooldownAuraEntry,
): string {
  const rule = parseCooldownAuraToken(id);
  if (!rule) {
    const ability = world.resolvedAbility(id);
    return ability ? host.abilityTooltip(ability) : '';
  }
  const aura = world.player.auras?.find((entry) =>
    rule.match === 'id' ? entry.id === rule.value : entry.kind === rule.value,
  );
  if (!aura) {
    const fallback =
      entry ??
      cooldownAuraCatalog(world.cfg.playerClass).find((candidate) => candidate.token === id);
    return fallback ? `<div class="tt-title">${esc(auraEntryName(fallback))}</div>` : '';
  }
  return host.aurasPainter.renderTooltip(
    host.aurasView.auraName(aura),
    aura.remaining,
    host.aurasView.auraEffectHtml(aura),
    isToggleAuraKind(aura.id, aura.kind),
    aura.sourceId,
  );
}
