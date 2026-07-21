// The left vertical tool palette: one icon button per tool with a localized
// tooltip and a single-key shortcut. Owns no editing state; the app passes the
// active tool in and receives clicks out.

import { t } from '../ui/i18n';
import { el } from './dom';

export type EditorTool =
  | 'select'
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'flatten'
  | 'paint'
  | 'water'
  | 'place'
  | 'blocker'
  | 'camp'
  | 'spawn'
  | 'region'
  | 'erase';

export interface ToolDef {
  tool: EditorTool;
  /** Single-key shortcut (lowercase). */
  key: string;
  labelKey:
    | 'editor.tool.select'
    | 'editor.tool.raise'
    | 'editor.tool.lower'
    | 'editor.tool.smooth'
    | 'editor.tool.flatten'
    | 'editor.tool.paint'
    | 'editor.tool.water'
    | 'editor.tool.place'
    | 'editor.tool.blocker'
    | 'editor.tool.camp'
    | 'editor.tool.spawn'
    | 'editor.tool.region'
    | 'editor.tool.erase';
  icon: string; // inline SVG path data (24x24, stroke)
}

export const TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', key: 'v', labelKey: 'editor.tool.select', icon: 'M6 3l12 9-6 1-3 6z' },
  {
    tool: 'raise',
    key: 'r',
    labelKey: 'editor.tool.raise',
    icon: 'M3 19h18M6 19c2-6 4-9 6-9s4 3 6 9M12 3v5M9.5 5.5L12 3l2.5 2.5',
  },
  {
    tool: 'lower',
    key: 'l',
    labelKey: 'editor.tool.lower',
    icon: 'M3 19h18M6 19c2-4 4-6 6-6s4 2 6 6M12 3v6M9.5 6.5L12 9l2.5-2.5',
  },
  {
    tool: 'smooth',
    key: 'm',
    labelKey: 'editor.tool.smooth',
    icon: 'M3 15c3-4 6-4 9 0s6 4 9 0M5 8h14',
  },
  {
    tool: 'flatten',
    key: 'f',
    labelKey: 'editor.tool.flatten',
    icon: 'M4 16h16M8 8v5M8 13l-2-2M8 13l2-2M16 8v5M16 13l-2-2M16 13l2-2',
  },
  {
    tool: 'paint',
    key: 'b',
    labelKey: 'editor.tool.paint',
    icon: 'M12 3c3 4.5 6 7.5 6 11a6 6 0 1 1-12 0c0-3.5 3-6.5 6-11z',
  },
  {
    tool: 'water',
    key: 'w',
    labelKey: 'editor.tool.water',
    icon: 'M3 9c3-3 6-3 9 0s6 3 9 0M3 15c3-3 6-3 9 0s6 3 9 0',
  },
  {
    tool: 'place',
    key: 'p',
    labelKey: 'editor.tool.place',
    icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v9M4 7.5l8 4.5 8-4.5',
  },
  {
    tool: 'blocker',
    key: 'k',
    labelKey: 'editor.tool.blocker',
    icon: 'M3 7h18v10H3zM3 12h18M9 7v5M15 12v5',
  },
  {
    tool: 'camp',
    key: 'c',
    labelKey: 'editor.tool.camp',
    icon: 'M12 4L3 20h18zM12 4l4 16M12 4L8 20',
  },
  {
    tool: 'spawn',
    key: 's',
    labelKey: 'editor.tool.spawn',
    icon: 'M12 21v-8M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 21h8',
  },
  {
    tool: 'region',
    key: 'g',
    labelKey: 'editor.tool.region',
    icon: 'M4 4h4M10 4h4M16 4h4M4 4v4M4 10v4M4 16v4M4 20h4M10 20h4M16 20h4M20 4v4M20 10v4M20 16v4',
  },
  {
    tool: 'erase',
    key: 'e',
    labelKey: 'editor.tool.erase',
    icon: 'M4 16l8-8 6 6-6 6H8zM10 22h10M9 11l6 6',
  },
];

export const TOOL_BY_KEY: ReadonlyMap<string, EditorTool> = new Map(
  TOOL_DEFS.map((d) => [d.key, d.tool]),
);

function iconSvg(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

export class Toolbar {
  readonly root: HTMLElement;
  private readonly buttons = new Map<EditorTool, HTMLButtonElement>();

  constructor(parent: HTMLElement, onPick: (tool: EditorTool) => void) {
    this.root = el('nav', 'ed-toolbar');
    this.root.setAttribute('aria-label', t('editor.tool.listLabel'));
    // Visual grouping: a thin separator before the first tool of each family
    // (sculpt, surface, world content, utility). Decoration only, no text.
    const groupStarts = new Set<EditorTool>(['raise', 'paint', 'place', 'region']);
    for (const def of TOOL_DEFS) {
      if (groupStarts.has(def.tool)) {
        const sep = el('span', 'ed-toolbar-sep');
        sep.setAttribute('aria-hidden', 'true');
        this.root.appendChild(sep);
      }
      const name = t(def.labelKey);
      const tip = t('editor.tool.keyHint', { name, key: def.key.toUpperCase() });
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-tool';
      b.dataset.tool = def.tool;
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(iconSvg(def.icon));
      const kbd = el('span', 'ed-tool-key', def.key.toUpperCase());
      kbd.setAttribute('aria-hidden', 'true');
      b.appendChild(kbd);
      b.addEventListener('click', () => onPick(def.tool));
      this.buttons.set(def.tool, b);
      this.root.appendChild(b);
    }
    parent.appendChild(this.root);
  }

  setActive(tool: EditorTool): void {
    for (const [tl, b] of this.buttons) {
      b.classList.toggle('active', tl === tool);
      b.setAttribute('aria-pressed', tl === tool ? 'true' : 'false');
    }
  }
}
