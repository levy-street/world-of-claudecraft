import { iconDataUrl } from '../../icons';
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

/** The Moonwing Tidewheel banks in the Eclipse layout (108 by 100): the window
 *  gem in the middle with five Suntide and five Moontide orbs around it,
 *  plus the screen-edge glow overlay. The gem shows the icon of the spell the
 *  open window favors: Skyfall during Sunrise, Wildbolt during Moonrise. The
 *  bank being charged sits in an arc of full-size orbs above the gem and the
 *  other in an arc of small orbs below it (see tideTopBank and tidePlace in
 *  tide_orbs_view.ts). */
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
  const gemIcon = node('span', 'druid-tide-gem-icon');
  gemIcon.setAttribute('aria-hidden', 'true');
  gem.append(gemIcon);
  // Resolved once: the art is static per ability (the procedural fallback is
  // cached by iconDataUrl itself).
  gem.style.setProperty('--tide-icon-moon', `url("${iconDataUrl('ability', 'starfire')}")`);
  gem.style.setProperty('--tide-icon-sun', `url("${iconDataUrl('ability', 'wrath')}")`);
  // The gem goes last so it paints over orbs gliding past it when the banks
  // swap.
  frame.append(sun.root, moon.root, gem);
  // Independent class-resource seat, like the Shadow priest medallion.
  parent.append(frame);
  // The screen-edge glow: a full-screen, click-through overlay under the HUD.
  const edge = node('div', 'druid-tide-edge');
  edge.id = 'druid-tide-edge';
  edge.setAttribute('aria-hidden', 'true');
  // The strong flash at a capped bank (the overlay's ::before and ::after
  // already carry the attunement tint and the ready flash).
  edge.append(node('span', 'druid-tide-edge-max'));
  parent.append(edge);
  attachTooltip(sun.root, strings.sunTooltip);
  attachTooltip(moon.root, strings.moonTooltip);
  const painter = new TideOrbsPainter(writers, {
    frame,
    sunRoot: sun.root,
    sunOrbs: sun.orbs,
    moonRoot: moon.root,
    moonOrbs: moon.orbs,
    gem,
    edge,
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
