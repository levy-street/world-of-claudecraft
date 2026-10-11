import { SPIRIT_BOMB_REQUIRED_GENERATION } from '../../../sim/combat/priest/spirit_bomb';
import type { PainterHostWriters } from '../../painter_host';
import { ShadowChargePainter } from './shadow_charge_painter';
import {
  createShadowChargeView,
  GLOOMTITHE_MAX,
  type ShadowChargeFormatters,
  type ShadowChargePlayer,
} from './shadow_charge_view';

export interface ShadowChargeStrings extends ShadowChargeFormatters {
  gloomLabel(): string;
  bombLabel(): string;
  readyLabel(): string;
  gloomTooltip(): string;
  bombTooltip(): string;
}

export function createShadowChargeMeter(
  doc: Document,
  parent: HTMLElement,
  writers: PainterHostWriters,
  strings: ShadowChargeStrings,
  attachTooltip: (element: HTMLElement, html: () => string) => void,
): {
  paint(player: ShadowChargePlayer, spec: string | null): void;
  relocalize(): void;
} {
  const node = (tag: string, className: string): HTMLElement => {
    const el = doc.createElement(tag);
    el.className = className;
    return el;
  };
  const frame = node('div', 'priest-charge-frame');
  frame.id = 'priest-charge-frame';
  const meter = (className: string, max: number): HTMLElement => {
    const el = node('div', className);
    el.setAttribute('role', 'meter');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(max));
    el.tabIndex = 0;
    return el;
  };
  const gloomRoot = meter('priest-gloom-meter', GLOOMTITHE_MAX);
  const gloomLabel = node('span', 'priest-charge-name');
  const gloomCount = node('span', 'priest-charge-count ui-num');
  const gloomRail = node('span', 'priest-gloom-pips');
  gloomRail.setAttribute('aria-hidden', 'true');
  const gloomPips: HTMLElement[] = [];
  for (let i = 0; i < GLOOMTITHE_MAX; i++) {
    const pip = node('span', 'priest-gloom-pip');
    gloomPips.push(pip);
    gloomRail.append(pip);
  }
  gloomRoot.append(gloomLabel, gloomCount, gloomRail);

  const bombRoot = meter('priest-bomb-meter', SPIRIT_BOMB_REQUIRED_GENERATION);
  const bombCrown = node('span', 'priest-bomb-crown');
  const bombBezel = node('span', 'priest-bomb-bezel');
  const bombOrbit = node('span', 'priest-bomb-orbit');
  const bombOrb = node('span', 'priest-bomb-orb ui-disc');
  bombOrb.setAttribute('aria-hidden', 'true');
  const bombOrbFill = node('span', 'priest-bomb-orb-fill');
  const bombSigil = node('span', 'priest-bomb-sigil');
  bombOrb.append(bombOrbFill, bombSigil);
  const bombBody = node('span', 'priest-bomb-body');
  const bombHeader = node('span', 'priest-bomb-header');
  const bombLabel = node('span', 'priest-charge-name');
  const bombCount = node('span', 'priest-charge-count ui-num');
  const readyLabel = node('span', 'priest-bomb-ready');
  const bombBar = node('span', 'priest-bomb-bar');
  bombBar.setAttribute('aria-hidden', 'true');
  const bombFill = node('span', 'priest-bomb-fill');
  bombBar.append(bombFill);
  bombHeader.append(bombLabel, bombCount);
  bombBody.append(bombHeader, readyLabel);
  for (const ornament of [bombCrown, bombBezel, bombOrbit])
    ornament.setAttribute('aria-hidden', 'true');
  bombRoot.append(bombOrbit, bombCrown, bombOrb, bombBezel, bombBar, bombBody);
  frame.append(bombRoot, gloomRoot);
  // Independent class-resource seat, like the Paladin medallion and Hexcraft rail.
  parent.append(frame);
  attachTooltip(gloomRoot, strings.gloomTooltip);
  attachTooltip(bombRoot, strings.bombTooltip);
  const painter = new ShadowChargePainter(writers, {
    frame,
    gloomRoot,
    gloomCount,
    gloomPips,
    bombRoot,
    bombFill,
    bombOrbFill,
    bombCount,
    readyLabel,
  });
  const view = createShadowChargeView(strings);
  const relocalize = (): void => {
    view.invalidateLabels();
    writers.setText(gloomLabel, strings.gloomLabel());
    writers.setText(bombLabel, strings.bombLabel());
    writers.setText(readyLabel, strings.readyLabel());
    writers.setAttr(gloomRoot, 'aria-label', strings.gloomLabel());
    writers.setAttr(bombRoot, 'aria-label', strings.bombLabel());
  };
  relocalize();
  writers.setDisplay(frame, 'none');
  return {
    paint(player, spec) {
      painter.paint(view.tick(player, spec));
    },
    relocalize,
  };
}
