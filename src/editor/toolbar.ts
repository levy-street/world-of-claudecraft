// The left vertical tool palette: one icon button per tool with a localized
// tooltip and a single-key shortcut. Owns no editing state; the app passes the
// active tool in and receives clicks out.

import { t } from '../ui/i18n';
import { el } from './dom';

export type EditorTool =
  | 'select'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'flatten'
  | 'tunnel'
  | 'rock'
  | 'build'
  | 'paint'
  | 'eyedropper'
  | 'decal'
  | 'water'
  | 'fluid'
  | 'place'
  | 'foliage'
  | 'clutter'
  | 'meshfix'
  | 'tree'
  | 'grassclear'
  | 'blocker'
  | 'collider'
  | 'camp'
  | 'entity'
  | 'spawn'
  | 'zone'
  | 'light'
  | 'music'
  | 'sound'
  | 'region'
  | 'erase'
  | 'city'
  | 'building';

export interface ToolDef {
  tool: EditorTool;
  /** Single-key shortcut (lowercase); absent = click-only tool (X deletes the
   *  selection and E is reserved for Free-Fly height, so neither picks a tool). */
  key?: string;
  labelKey:
    | 'editor.tool.zone'
    | 'editor.tool.light'
    | 'editor.tool.music'
    | 'editor.tool.sound'
    | 'editor.tool.select'
    | 'editor.tool.move'
    | 'editor.tool.rotate'
    | 'editor.tool.scale'
    | 'editor.tool.raise'
    | 'editor.tool.lower'
    | 'editor.tool.smooth'
    | 'editor.tool.flatten'
    | 'editor.tool.tunnel'
    | 'editor.tool.rock'
    | 'editor.tool.build'
    | 'editor.tool.paint'
    | 'editor.tool.eyedropper'
    | 'editor.tool.decal'
    | 'editor.tool.water'
    | 'editor.tool.fluid'
    | 'editor.tool.place'
    | 'editor.tool.foliage'
    | 'editor.tool.clutter'
    | 'editor.tool.meshFix'
    | 'editor.tool.tree'
    | 'editor.tool.grassClear'
    | 'editor.tool.blocker'
    | 'editor.tool.collider'
    | 'editor.tool.camp'
    | 'editor.tool.entity'
    | 'editor.tool.spawn'
    | 'editor.tool.region'
    | 'editor.tool.erase'
    | 'editor.tool.city'
    | 'editor.tool.building';
  icon: string; // inline SVG path data (24x24, stroke)
}

export const TOOL_DEFS: readonly ToolDef[] = [
  {
    tool: 'building',
    labelKey: 'editor.tool.building',
    icon: 'M3 21V9l9-7 9 7v12H3zM8 21V12h8v9M3 9h18',
  },
  { tool: 'select', key: '1', labelKey: 'editor.tool.select', icon: 'M6 3l12 9-6 1-3 6z' },
  // Transform tools on the number row: 1 select, 2 move, 3 rotate, 4 scale.
  {
    tool: 'move',
    key: '2',
    labelKey: 'editor.tool.move',
    icon: 'M12 2v20M2 12h20M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l-2.5 2.5',
  },
  {
    tool: 'rotate',
    key: '3',
    labelKey: 'editor.tool.rotate',
    icon: 'M20 12a8 8 0 1 1-2.4-5.7M20 3v4.5h-4.5',
  },
  {
    tool: 'scale',
    key: '4',
    labelKey: 'editor.tool.scale',
    icon: 'M4 20L20 4M20 4h-6M20 4v6M4 20h6M4 20v-6',
  },
  {
    tool: 'raise',
    labelKey: 'editor.tool.raise',
    icon: 'M3 19h18M6 19c2-6 4-9 6-9s4 3 6 9M12 3v5M9.5 5.5L12 3l2.5 2.5',
  },
  {
    tool: 'flatten',
    labelKey: 'editor.tool.flatten',
    icon: 'M4 16h16M8 8v5M8 13l-2-2M8 13l2-2M16 8v5M16 13l-2-2M16 13l2-2',
  },
  {
    tool: 'tunnel',
    labelKey: 'editor.tool.tunnel',
    icon: 'M4 20h16M6 20v-7a6 6 0 0 1 12 0v7M10 20v-4a2 2 0 0 1 4 0v4',
  },
  {
    tool: 'paint',
    labelKey: 'editor.tool.paint',
    icon: 'M12 3c3 4.5 6 7.5 6 11a6 6 0 1 1-12 0c0-3.5 3-6.5 6-11z',
  },
  {
    tool: 'eyedropper',
    labelKey: 'editor.tool.eyedropper',
    icon: 'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z',
  },
  {
    tool: 'decal',
    labelKey: 'editor.tool.decal',
    // A stamp pressing a mark into the ground.
    icon: 'M4 20h16M7 17h10l-1-4H8zM9 13V7a3 3 0 0 1 6 0v6M10.5 4.5h3',
  },
  {
    tool: 'water',
    labelKey: 'editor.tool.water',
    icon: 'M3 9c3-3 6-3 9 0s6 3 9 0M3 15c3-3 6-3 9 0s6 3 9 0',
  },
  {
    tool: 'fluid',
    labelKey: 'editor.tool.fluid',
    icon: 'M12 3c3 4.5 6 7.5 6 11a6 6 0 1 1-12 0c0-3.5 3-6.5 6-11zM8 16c1.5 1.5 6.5 1.5 8 0',
  },
  {
    tool: 'place',
    labelKey: 'editor.tool.place',
    icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v9M4 7.5l8 4.5 8-4.5',
  },
  {
    tool: 'foliage',
    labelKey: 'editor.tool.foliage',
    icon: 'M12 2l4.5 6h-2.5l4 5h-3.5l3.5 5H6l3.5-5H6l4-5H7.5zM12 18v4',
  },
  {
    tool: 'meshfix',
    labelKey: 'editor.tool.meshFix',
    // A wire grid with one cell struck out.
    icon: 'M3 5h18M3 12h18M3 19h18M5 3v18M12 3v18M19 3v18M13.5 13.5l4 4M17.5 13.5l-4 4',
  },
  {
    tool: 'clutter',
    labelKey: 'editor.tool.clutter',
    icon: 'M3 18c0-1.7 1.6-3 3.5-3S10 16.3 10 18zM11 19c0-1.1 1.1-2 2.5-2s2.5.9 2.5 2zM14 12l5-2 2 4-5 2zM6 10l3-4 3 3-3 2z',
  },
  {
    tool: 'tree',
    labelKey: 'editor.tool.tree',
    // A broadleaf crown over a trunk, with the two limbs the generator grows from.
    icon: 'M12 3a5.5 5.5 0 0 0-4.6 8.5A4.5 4.5 0 0 0 9 20h6a4.5 4.5 0 0 0 1.6-8.5A5.5 5.5 0 0 0 12 3zM12 20v2M12 14l-2.6-2.6M12 11.5l2.6-2.6',
  },
  {
    tool: 'grassclear',
    labelKey: 'editor.tool.grassClear',
    icon: 'M5 20c0-4 1.5-6 2.5-8M10 20c0-4 1-6.5 1.5-9M15 20c0-3.5 1-5.5 1.5-7.5M3 4l18 18',
  },
  {
    tool: 'rock',
    labelKey: 'editor.tool.rock',
    icon: 'M7 19l-3-4 2-6 5-4 6 1 3 5-1 5-4 3zM9 9l3 2 4-1M12 11l-1 5',
  },
  {
    tool: 'build',
    labelKey: 'editor.tool.build',
    icon: 'M12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5M16.5 5.5l-9 5',
  },
  {
    tool: 'city',
    labelKey: 'editor.tool.city',
    icon: 'M3 21h18M5 21V9l4-3v15M9 21V6l5 3v12M14 21v-8h5v8M6.5 11h.01M6.5 14h.01M11 11h.01M11 14h.01M16.5 16h.01',
  },
  {
    tool: 'collider',
    labelKey: 'editor.tool.collider',
    icon: 'M4 10h10v10H4zM10 4h10v10h-4M10 4v6M20 4l-6 6',
  },
  {
    tool: 'blocker',
    labelKey: 'editor.tool.blocker',
    icon: 'M4 4v16M20 4v16M4 7h16M4 17h16M9 7v10M15 7v10',
  },
  {
    tool: 'camp',
    labelKey: 'editor.tool.camp',
    icon: 'M12 4L3 20h18zM12 4l4 16M12 4L8 20',
  },
  {
    tool: 'entity',
    labelKey: 'editor.tool.entity',
    icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-3a5 5 0 0 1 10 0v3M17 7v10M14 14l3 3 3-3',
  },
  {
    tool: 'spawn',
    labelKey: 'editor.tool.spawn',
    icon: 'M12 21v-8M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 21h8',
  },
  {
    tool: 'zone',
    labelKey: 'editor.tool.zone',
    icon: 'M4 6h12l4 6-4 6H4zM8 12h.01',
  },
  {
    tool: 'light',
    labelKey: 'editor.tool.light',
    icon: 'M12 3a6 6 0 0 1 3.5 10.9c-.9.7-1.5 1.6-1.5 2.6h-4c0-1-.6-1.9-1.5-2.6A6 6 0 0 1 12 3zM10 19h4M11 22h2',
  },
  {
    tool: 'music',
    labelKey: 'editor.tool.music',
    icon: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  },
  {
    tool: 'sound',
    labelKey: 'editor.tool.sound',
    icon: 'M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  },
  {
    tool: 'region',
    labelKey: 'editor.tool.region',
    icon: 'M4 4h4M10 4h4M16 4h4M4 4v4M4 10v4M4 16v4M4 20h4M10 20h4M16 20h4M20 4v4M20 10v4M20 16v4',
  },
  {
    tool: 'erase',
    labelKey: 'editor.tool.erase',
    icon: 'M4 16l8-8 6 6-6 6H8zM10 22h10M9 11l6 6',
  },
];

export const TOOL_BY_KEY: ReadonlyMap<string, EditorTool> = new Map(
  TOOL_DEFS.filter((d): d is ToolDef & { key: string } => d.key !== undefined).map((d) => [
    d.key,
    d.tool,
  ]),
);

// Crossed banners over a field line: the battleground, not a tool.
const RAVENRIFT_ICON = 'M5 21V6l6 2M19 21V6l-6 2M5 6l6-3M19 6l-6-3M3 21h18';

export function toolIconSvg(path: string): SVGSVGElement {
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
  private readonly groupButtons = new Map<EditorTool, HTMLButtonElement>();
  private readonly ravenriftBtn: HTMLButtonElement;
  private openMenu: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    onPick: (tool: EditorTool) => void,
    onRavenrift: () => void = () => undefined,
  ) {
    this.root = el('nav', 'ed-toolbar');
    this.root.setAttribute('aria-label', t('editor.tool.listLabel'));
    const groups: readonly {
      labelKey:
        | 'editor.toolGroup.terrain'
        | 'editor.toolGroup.assets'
        | 'editor.toolGroup.world'
        | 'editor.toolGroup.effects';
      tools: readonly EditorTool[];
    }[] = [
      {
        labelKey: 'editor.toolGroup.terrain',
        tools: [
          'raise',
          'flatten',
          'tunnel',
          'rock',
          'paint',
          'eyedropper',
          'decal',
          'water',
          'fluid',
          'grassclear',
          'meshfix',
        ],
      },
      {
        labelKey: 'editor.toolGroup.assets',
        tools: ['building', 'place', 'foliage', 'clutter', 'tree', 'build', 'city', 'collider'],
      },
      {
        labelKey: 'editor.toolGroup.world',
        tools: ['camp', 'entity', 'spawn', 'zone', 'region', 'blocker', 'erase'],
      },
      {
        labelKey: 'editor.toolGroup.effects',
        tools: ['light', 'music', 'sound'],
      },
    ];
    for (const group of groups) {
      const wrap = el('div', 'ed-tool-group');
      const first = TOOL_DEFS.find((definition) => definition.tool === group.tools[0]);
      if (!first) continue;
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ed-tool-group-btn';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.append(
        toolIconSvg(first.icon),
        el('span', 'ed-tool-group-label', t(group.labelKey)),
        el('span', 'ed-tool-group-caret', '›'),
      );
      const menu = el('div', 'ed-tool-menu');
      menu.style.display = 'none';
      menu.setAttribute('role', 'menu');
      for (const tool of group.tools) {
        const def = TOOL_DEFS.find((definition) => definition.tool === tool);
        if (!def) continue;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ed-tool-menu-item';
        item.dataset.tool = def.tool;
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', 'false');
        item.append(toolIconSvg(def.icon), el('span', undefined, t(def.labelKey)));
        item.addEventListener('click', () => {
          this.closeMenu();
          onPick(def.tool);
        });
        this.buttons.set(def.tool, item);
        this.groupButtons.set(def.tool, trigger);
        menu.appendChild(item);
      }
      trigger.addEventListener('click', () => {
        const opening = this.openMenu !== menu;
        this.closeMenu();
        if (opening) {
          menu.style.display = '';
          trigger.setAttribute('aria-expanded', 'true');
          trigger.classList.add('open');
          this.openMenu = menu;
        }
      });
      wrap.append(trigger, menu);
      this.root.appendChild(wrap);
    }

    // Ravenrift: not a tool - a toggle for the battleground panel, sitting
    // under the tool groups because that is where the maker looks for it.
    // First press opens the mode; after that it shows and hides the window.
    this.ravenriftBtn = document.createElement('button');
    this.ravenriftBtn.type = 'button';
    this.ravenriftBtn.className = 'ed-tool-group-btn ed-ravenrift-toggle';
    this.ravenriftBtn.setAttribute('aria-pressed', 'false');
    this.ravenriftBtn.title = 'Show or hide the Ravenrift battleground panel';
    this.ravenriftBtn.append(
      toolIconSvg(RAVENRIFT_ICON),
      el('span', 'ed-tool-group-label', 'Ravenrift'),
    );
    this.ravenriftBtn.addEventListener('click', () => {
      this.closeMenu();
      onRavenrift();
    });
    this.root.appendChild(this.ravenriftBtn);

    // The four everyday transform tools live together at the foot of the rail,
    // mirroring a modelling app's persistent tool shelf while leaving the
    // document header quiet. Number-row shortcuts remain 1 to 4.
    const transformTools = el('div', 'ed-transform-tools');
    transformTools.setAttribute('role', 'toolbar');
    transformTools.setAttribute('aria-label', t('editor.topbar.primaryTools'));
    for (const tool of ['select', 'move', 'rotate', 'scale'] as const) {
      const definition = TOOL_DEFS.find((entry) => entry.tool === tool);
      if (!definition) continue;
      const label = t(definition.labelKey);
      const toolButton = document.createElement('button');
      toolButton.type = 'button';
      toolButton.className = 'ed-transform-tool';
      toolButton.dataset.tool = tool;
      toolButton.title = definition.key
        ? t('editor.tool.keyHint', { name: label, key: definition.key })
        : label;
      toolButton.setAttribute('aria-label', toolButton.title);
      toolButton.setAttribute('aria-pressed', 'false');
      toolButton.append(toolIconSvg(definition.icon), el('kbd', undefined, definition.key ?? ''));
      toolButton.addEventListener('click', () => onPick(tool));
      this.buttons.set(tool, toolButton);
      transformTools.appendChild(toolButton);
    }
    this.root.appendChild(transformTools);
    document.addEventListener('pointerdown', (event) => {
      if (this.openMenu && !this.root.contains(event.target as Node)) this.closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeMenu();
    });
    parent.appendChild(this.root);
  }

  private closeMenu(): void {
    if (!this.openMenu) return;
    this.openMenu.style.display = 'none';
    const trigger = this.openMenu.previousElementSibling as HTMLButtonElement | null;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.classList.remove('open');
    this.openMenu = null;
  }

  /** Light the Ravenrift toggle while its panel is on screen. */
  setRavenriftOpen(open: boolean): void {
    this.ravenriftBtn.classList.toggle('active', open);
    this.ravenriftBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  }

  setActive(tool: EditorTool): void {
    for (const [tl, b] of this.buttons) {
      const active = tl === tool;
      b.classList.toggle('active', active);
      if (b.classList.contains('ed-transform-tool')) {
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      } else {
        b.setAttribute('aria-checked', active ? 'true' : 'false');
      }
    }
    const uniqueGroups = new Set(this.groupButtons.values());
    for (const groupButton of uniqueGroups) groupButton.classList.remove('active');
    this.groupButtons.get(tool)?.classList.add('active');
    const activeDef = TOOL_DEFS.find((definition) => definition.tool === tool);
    const groupButton = this.groupButtons.get(tool);
    if (activeDef && groupButton) {
      const icon = groupButton.querySelector('svg');
      icon?.replaceWith(toolIconSvg(activeDef.icon));
    }
  }
}
