import type { PainterHostWriters } from '../../painter_host';
import { TideOrbsPainter } from './tide_orbs_painter';
import {
  createTideOrbsView,
  TIDE_BANK_MAX,
  type TideOrbsFormatters,
  type TideOrbsPlayer,
} from './tide_orbs_view';

export interface TideOrbsStrings extends TideOrbsFormatters {
  sunLabel(): string;
  moonLabel(): string;
  sunTooltip(): string;
  moonTooltip(): string;
}

/** The Moonwing Tidewheel banks: three Suntide orbs, the window gem, three
 *  Moontide orbs, on the warlock resource strip's footprint (300 by 48). */
export function createTideOrbsMeter(
  doc: Document,
  parent: HTMLElement,
  writers: PainterHostWriters,
  strings: TideOrbsStrings,
  attachTooltip: (element: HTMLElement, html: () => string) => void,
): {
  paint(player: TideOrbsPlayer, spec: string | null): void;
  relocalize(): void;
} {
  const node = (tag: string, className: string): HTMLElement => {
    const el = doc.createElement(tag);
    el.className = className;
    return el;
  };
  const frame = node('div', 'druid-tide-frame');
  frame.id = 'druid-tide-frame';
  const bank = (school: 'sun' | 'moon'): { root: HTMLElement; orbs: HTMLElement[] } => {
    const root = node('div', `druid-tide-bank ${school}`);
    root.setAttribute('role', 'meter');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(TIDE_BANK_MAX));
    root.tabIndex = 0;
    const orbs: HTMLElement[] = [];
    for (let i = 0; i < TIDE_BANK_MAX; i++) {
      const orb = node('span', 'druid-tide-orb');
      orb.setAttribute('aria-hidden', 'true');
      orbs.push(orb);
      root.append(orb);
    }
    return { root, orbs };
  };
  const sun = bank('sun');
  const moon = bank('moon');
  const gem = node('span', 'druid-tide-gem');
  gem.setAttribute('role', 'img');
  frame.append(sun.root, gem, moon.root);
  // Independent class-resource seat, like the Shadow priest medallion.
  parent.append(frame);
  attachTooltip(sun.root, strings.sunTooltip);
  attachTooltip(moon.root, strings.moonTooltip);
  const painter = new TideOrbsPainter(writers, {
    frame,
    sunRoot: sun.root,
    sunOrbs: sun.orbs,
    moonRoot: moon.root,
    moonOrbs: moon.orbs,
    gem,
  });
  const view = createTideOrbsView(strings);
  const relocalize = (): void => {
    view.invalidateLabels();
    writers.setAttr(sun.root, 'aria-label', strings.sunLabel());
    writers.setAttr(moon.root, 'aria-label', strings.moonLabel());
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
