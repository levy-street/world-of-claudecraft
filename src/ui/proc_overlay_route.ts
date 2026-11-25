// Which art the proc overlay (#proc-overlay, beside the character) paints this
// frame, out of the Hud coordinator: one nameable choice. The Quench's frost
// marks win while the player carries its cold (the fight's survival read
// outranks any class proc for those minutes); otherwise the active spec picks
// its own art. Each painter route clears the others' classes, so a swap never
// strands a half-lit bank.

import type { Aura } from '../sim/types';
import { QUENCH_COLD_MARKS, quenchColdMarks } from './hud/dungeon/quench_cold_view';
import { destructionRuinPips } from './hud/warlock';
import { t } from './i18n';
import type { ProcOverlayPainter } from './proc_overlay_painter';
import {
  chronoOverlayCharges,
  combustionOverlayActive,
  frostOverlayCharges,
  necromancyOverlayCharges,
  procOverlayState,
} from './proc_overlay_view';

export function paintProcOverlayRoute(
  painter: ProcOverlayPainter,
  spec: string | null,
  auras: readonly Aura[],
): void {
  const coldMarks = quenchColdMarks(auras);
  if (coldMarks !== null) {
    painter.paintDestructionMarks(
      coldMarks,
      t('hudChrome.procOverlay.quenchColdMeter'),
      t('hudChrome.procOverlay.quenchColdStatus', { value: coldMarks, max: QUENCH_COLD_MARKS }),
      true,
    );
  } else if (spec === 'demonology') {
    const soulFragments = necromancyOverlayCharges(auras);
    painter.paintNecromancyCharges(
      soulFragments,
      t('hudChrome.procOverlay.soulFragmentsMeter'),
      t('hudChrome.auraEffect.resourceCount', { value: soulFragments, max: 5 }),
    );
  } else if (spec === 'destruction') {
    const ruinPips = destructionRuinPips(spec, auras);
    painter.paintDestructionMarks(
      ruinPips,
      t('hudChrome.procOverlay.ruinMeter'),
      t('hudChrome.procOverlay.ruinStatus', { value: ruinPips, max: 5 }),
    );
  } else if (spec === 'arcane') {
    painter.paintChronoCharges(chronoOverlayCharges(auras));
  } else if (spec === 'frost') {
    painter.paintFrostCharges(frostOverlayCharges(auras));
  } else {
    painter.paint(procOverlayState(auras), combustionOverlayActive(auras));
  }
}
