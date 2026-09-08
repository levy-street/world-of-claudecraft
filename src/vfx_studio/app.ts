import { type AbilityVfxDraft, parseAbilityVfxDraftPack } from '../render/ability_vfx_draft_core';
import {
  abilityVfxFullSpec,
  abilityVfxSpec,
  setAbilityVfxDraft,
} from '../render/ability_vfx_registry';
import { GFX } from '../render/gfx';
import { rowTreeFor, TALENTS } from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import type { PlayerClass, SimEvent } from '../sim/types';
import { tEntity } from '../ui/entity_i18n';
import { formatNumber, type TranslationKey, t } from '../ui/i18n';
import { tTalent } from '../ui/talent_i18n';
import { studioAbilityInfo } from './ability_library';
import { downloadStudioFile } from './file_io';
import { StudioRuntime } from './runtime';
import { DEFAULT_STUDIO_CONFIG, type StudioConfig } from './session';
import { openStudioWorkspace } from './workspace';

declare const __APP_BUILD_ID__: string;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}
function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  key: TranslationKey,
  className = '',
): HTMLElementTagNameMap[K] {
  const element = node(tag, className);
  element.textContent = t(key);
  return element;
}
function button(key: TranslationKey, action: () => void, className = ''): HTMLButtonElement {
  const element = text('button', key, className);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}
function field(key: TranslationKey, control: HTMLElement): HTMLLabelElement {
  const label = text('label', key, 'vfx-field');
  label.append(control);
  return label;
}
const CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

export class VfxStudioApp {
  readonly runtime: StudioRuntime;
  private readonly workspace = openStudioWorkspace();
  private config: StudioConfig = { ...DEFAULT_STUDIO_CONFIG };
  private selected = 'chain_heal';
  private targetId = 0;
  private drafts = new Map<string, AbilityVfxDraft>();
  private readonly talentRows = node('div', 'vfx-talent-rows');
  private readonly list = node('div', 'vfx-ability-list');
  private readonly inspector = node('div', 'vfx-inspector-body');
  private readonly status = text('span', 'editor.vfx.loading', 'vfx-runtime-status');
  private readonly timeline = node('div', 'vfx-events');
  private readonly clock = node('output', 'vfx-clock');
  private readonly targets = node('select');
  private readonly search = node('input');
  private readonly loading = text('div', 'editor.vfx.loading', 'vfx-loading');
  private readonly pauseButton: HTMLButtonElement;
  private readonly castButton: HTMLButtonElement;
  private readonly controls = node('fieldset', 'vfx-playback');
  private readonly speed = node('select');
  private readonly runButton: HTMLButtonElement;
  private readonly favouriteButton: HTMLButtonElement;
  private readonly artButton: HTMLButtonElement;
  private readonly repeat = node('input');
  private readonly favouritesOnly = node('input');
  private nextRepeat = 0;
  private lastClock = '';
  private eventCount = 0;
  private log: { tick: number; event: SimEvent }[] = [];
  private bootGeneration = 0;
  private moved = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(private root: HTMLElement) {
    const remembered = this.workspace.builds.get(this.config.cls);
    if (remembered) {
      this.config = { ...this.config, spec: remembered.spec, rows: { ...remembered.rows } };
      this.selected = remembered.selected;
    }
    const canvas = node('canvas', 'vfx-canvas');
    const plates = node('div', 'vfx-nameplates');
    this.runtime = new StudioRuntime(
      canvas,
      plates,
      () => this.frame(),
      (events) => this.events(events),
    );
    this.runtime.setAudio(false);
    const header = node('header', 'vfx-header');
    const brand = node('div', 'vfx-brand');
    brand.append(text('small', 'guide.brand'), text('h1', 'editor.vfx.title'));
    const hide = button('editor.vfx.hide', () => {
      const hidden = root.classList.toggle('vfx-panels-hidden');
      hide.textContent = t(hidden ? 'editor.vfx.show' : 'editor.vfx.hide');
    });
    this.artButton = button('editor.vfx.artView', () => this.toggleArtView());
    header.append(brand, this.status, this.artButton, hide);
    root.dataset.mobilePanel = 'none';
    const tabs = node('nav', 'vfx-mobile-tabs');
    for (const panel of ['library', 'inspector'] as const)
      tabs.append(
        button(`editor.vfx.${panel}`, () => {
          root.dataset.mobilePanel = root.dataset.mobilePanel === panel ? 'none' : panel;
          root.classList.remove('vfx-panels-hidden');
        }),
      );
    header.append(tabs);
    const library = node('aside', 'vfx-panel vfx-library');
    library.append(text('h2', 'editor.vfx.library'));
    const classes = node('select');
    for (const cls of CLASSES) {
      const option = node('option');
      option.value = cls;
      option.textContent = t(`classes.${cls}`);
      classes.append(option);
    }
    classes.value = this.config.cls;
    const specs = node('select');
    const populateSpecs = () => {
      specs.replaceChildren();
      for (const spec of TALENTS[this.config.cls].specs) {
        const option = node('option');
        option.value = spec.id;
        option.textContent = tTalent({ kind: 'talentSpec', spec, field: 'name' });
        specs.append(option);
      }
      specs.value = this.config.spec ?? '';
    };
    populateSpecs();
    this.renderTalentRows();
    specs.addEventListener('change', () => {
      this.config.spec = specs.value;
      void this.load(false, true);
    });
    classes.addEventListener('change', () => {
      this.workspace.remember(this.config, this.selected);
      this.config.cls = classes.value as PlayerClass;
      const build = this.workspace.builds.get(this.config.cls);
      this.config.rows = { ...build?.rows };
      this.renderTalentRows();
      this.config.spec = build?.spec ?? TALENTS[this.config.cls].specs[0]?.id ?? null;
      this.selected = build?.selected ?? '';
      populateSpecs();
      void this.load(false, true);
    });
    const scene = node('select');
    for (const value of ['sandbox', 'duel', 'raid'] as const) {
      const option = text('option', `editor.vfx.${value}`);
      option.value = value;
      scene.append(option);
    }
    scene.addEventListener('change', () => {
      this.config.scene = scene.value as StudioConfig['scene'];
      void this.load(false, true);
    });
    this.search.type = 'search';
    this.search.placeholder = t('editor.vfx.search');
    this.search.setAttribute('aria-label', t('editor.vfx.search'));
    this.search.addEventListener('input', () => this.renderLibrary());
    const buildTools = node('details', 'vfx-build-tools');
    buildTools.append(text('summary', 'editor.vfx.buildTools'), this.talentRows);
    const seed = node('input');
    seed.type = 'number';
    seed.min = '0';
    seed.max = '4294967295';
    seed.step = '1';
    seed.value = String(this.config.seed);
    seed.addEventListener('change', () => {
      if (!seed.validity.valid || !Number.isSafeInteger(seed.valueAsNumber)) {
        seed.value = String(this.config.seed);
        return;
      }
      this.config.seed = seed.valueAsNumber;
      void this.load(false, true);
    });
    const graphics = node('select');
    graphics.append(text('option', 'editor.vfx.savedGraphics'));
    graphics.options[0].value = '';
    for (const [value, label] of [
      [1, 'low'],
      [2, 'medium'],
      [3, 'high'],
      [4, 'ultra'],
      [6, 'cinematic'],
    ] as const) {
      const option = text('option', `editor.vfx.${label}`);
      option.value = String(value);
      graphics.append(option);
    }
    graphics.addEventListener('change', () => {
      this.config.graphicsPreset = graphics.value ? Number(graphics.value) : undefined;
      void this.load(false, true);
    });
    const environment = node('select');
    for (const value of ['studio', 'world'] as const) {
      const option = text('option', `editor.vfx.${value}Environment`);
      option.value = value;
      environment.append(option);
    }
    environment.value = this.config.environment ?? 'studio';
    environment.addEventListener('change', () => {
      this.config.environment = environment.value as StudioConfig['environment'];
      void this.load(false, true);
    });
    const lighting = node('select');
    for (const value of ['neutral', 'bright', 'dark'] as const) {
      const option = text('option', `editor.vfx.${value}Lighting`);
      option.value = value;
      lighting.append(option);
    }
    lighting.addEventListener('change', () => {
      this.runtime.setLighting(lighting.value as 'neutral' | 'bright' | 'dark');
    });
    const motion = node('input');
    motion.type = 'checkbox';
    motion.checked = this.runtime.reduceMotion;
    motion.addEventListener('change', () => this.runtime.setReducedMotion(motion.checked));
    const cinematic = node('input');
    cinematic.type = 'checkbox';
    cinematic.addEventListener('change', () => {
      this.runtime.cinematicResponse = cinematic.checked;
    });
    buildTools.append(
      field('editor.vfx.scene', scene),
      field('editor.vfx.environment', environment),
      field('editor.vfx.lighting', lighting),
      field('editor.vfx.seed', seed),
      field('editor.vfx.reduceMotion', motion),
      field('editor.vfx.cinematicResponse', cinematic),
    );
    this.favouritesOnly.type = 'checkbox';
    this.favouritesOnly.addEventListener('change', () => this.renderLibrary());
    library.append(
      field('editor.vfx.class', classes),
      field('game.talents.specTab', specs),
      field('editor.vfx.graphics', graphics),
      buildTools,
      this.search,
      field('editor.vfx.favourites', this.favouritesOnly),
      this.list,
    );
    const inspector = node('aside', 'vfx-panel vfx-inspector');
    inspector.append(text('h2', 'editor.vfx.inspector'), this.inspector);
    const camera = node('div', 'vfx-camera');
    camera.setAttribute('aria-label', t('editor.vfx.controls'));
    camera.append(
      button('editor.vfx.orbitLeft', () => this.orbit(-0.25)),
      button('editor.vfx.orbitRight', () => this.orbit(0.25)),
      button('editor.vfx.closer', () => this.zoom(-2)),
      button('editor.vfx.farther', () => this.zoom(2)),
    );
    const footer = node('footer', 'vfx-footer');
    this.pauseButton = button('editor.vfx.pause', () => {
      this.runtime.pause();
      this.syncPause();
    });
    this.castButton = button('editor.vfx.cast', () => this.cast(), 'vfx-primary');
    this.favouriteButton = button('editor.vfx.favourite', () => this.toggleFavourite());
    this.repeat.type = 'checkbox';
    this.repeat.addEventListener('change', () => {
      this.nextRepeat = this.runtime.session?.time ?? 0;
    });
    this.targets.setAttribute('aria-label', t('editor.vfx.target'));
    this.targets.addEventListener('change', () => {
      const id = Number(this.targets.value);
      if (this.runtime.command({ kind: 'target', targetId: id })) this.targetId = id;
      else this.targets.value = String(this.targetId);
    });
    const speed = this.speed;
    speed.setAttribute('aria-label', t('editor.vfx.speed'));
    for (const value of [0.25, 0.5, 1, 2]) {
      const option = node('option');
      option.value = String(value);
      option.textContent = formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });
      speed.append(option);
    }
    speed.value = '1';
    speed.addEventListener('change', () => {
      this.runtime.playback.speed = Number(speed.value);
    });
    const run = button('editor.vfx.move', () => {
      if (this.runtime.command({ kind: 'move', active: !this.moved })) {
        this.moved = !this.moved;
        run.textContent = t(this.moved ? 'editor.vfx.stop' : 'editor.vfx.move');
      }
    });
    this.runButton = run;
    const audio = node('input');
    audio.type = 'checkbox';
    audio.addEventListener('change', () => this.runtime.setAudio(audio.checked));
    this.controls.append(
      button('editor.vfx.previous', () => this.selectAdjacent(-1)),
      this.castButton,
      button('editor.vfx.next', () => this.selectAdjacent(1)),
      field('editor.vfx.repeat', this.repeat),
      this.favouriteButton,
      this.targets,
      this.pauseButton,
      button('editor.vfx.step', () => this.runtime.step()),
      speed,
      run,
      button('editor.vfx.recover', () => this.runtime.command({ kind: 'recover' })),
      button('editor.vfx.reset', () => {
        void this.load();
      }),
      button('editor.vfx.replay', () => {
        void this.load(true);
      }),
      field('editor.vfx.audio', audio),
    );
    const timelineHeader = node('div', 'vfx-timeline-heading');
    timelineHeader.append(
      text('strong', 'editor.vfx.timeline'),
      this.clock,
      button('editor.vfx.snapshot', () => {
        void this.capture();
      }),
      button('editor.vfx.exportTake', () => this.exportSession()),
    );
    footer.append(this.controls, timelineHeader, this.timeline);
    const help = text('p', 'editor.vfx.help', 'vfx-help');
    help.append(text('span', 'editor.vfx.shortcuts', 'vfx-shortcuts'));
    this.loading.setAttribute('role', 'status');
    this.status.setAttribute('role', 'status');
    root.append(canvas, plates, header, library, inspector, camera, help, footer, this.loading);
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize[0]?.blockSize;
        if (height && height > 0)
          root.style.setProperty(
            entry.target === footer ? '--vfx-footer-height' : '--vfx-header-height',
            `${height}px`,
          );
      }
    });
    this.resizeObserver.observe(header);
    this.resizeObserver.observe(footer);
    this.bindCamera(canvas);
    window.addEventListener('keydown', this.keydown);
    void this.load();
  }

  private async load(replay = false, configure = false): Promise<void> {
    const generation = ++this.bootGeneration;
    const recording = replay
      ? this.runtime.session?.commands.map((row) => ({
          tick: row.tick,
          command: { ...row.command },
        }))
      : undefined;
    const endTick = this.runtime.session?.ticks ?? 0;
    this.loading.hidden = false;
    this.loading.classList.toggle('vfx-loading-update', configure && !!this.runtime.renderer);
    this.loading.textContent = t(configure ? 'editor.vfx.updating' : 'editor.vfx.loading');
    this.controls.disabled = true;
    this.status.textContent = t('editor.vfx.loading');
    this.log = [];
    this.eventCount = 0;
    this.timeline.replaceChildren(text('span', 'editor.vfx.empty'));
    try {
      const config =
        replay && this.runtime.session
          ? this.runtime.session.config
          : { ...this.config, rows: { ...this.config.rows } };
      if (configure) await this.runtime.configure(config);
      else await this.runtime.load(config, recording, endTick);
      if (generation !== this.bootGeneration) return;
      this.loading.hidden = true;
      this.controls.disabled = false;
      this.status.textContent = t('editor.vfx.ready');
      this.moved = false;
      this.runButton.textContent = t('editor.vfx.move');
      this.speed.value = String(this.runtime.playback.speed);
      const session = this.runtime.session!;
      this.targets.replaceChildren();
      for (const id of session.targetIds) {
        const e = session.sim.entities.get(id)!;
        const option = node('option');
        option.value = String(id);
        option.textContent =
          e.kind === 'player' ? e.name : tEntity({ kind: 'mob', id: e.templateId, field: 'name' });
        this.targets.append(option);
      }
      this.targetId = session.targetIds[0];
      if (!session.abilities.includes(this.selected)) this.selected = session.abilities[0] ?? '';
      this.workspace.remember(this.config, this.selected);
      this.nextRepeat = session.time + 0.4;
      this.renderLibrary();
      this.renderInspector();
      this.syncPause();
    } catch (error) {
      console.error('VFX studio boot failed', error);
      if (generation !== this.bootGeneration) return;
      this.loading.textContent = t('editor.vfx.failed');
      this.status.textContent = t('editor.vfx.failed');
    }
  }

  private renderTalentRows(): void {
    this.talentRows.replaceChildren();
    for (const row of rowTreeFor(this.config.cls) ?? []) {
      const select = node('select');
      const empty = text('option', 'editor.vfx.noTalent');
      empty.value = '';
      select.append(empty);
      for (const choice of row.options) {
        const option = node('option');
        option.value = choice.id;
        option.textContent = tTalent({ kind: 'talentChoice', choice, field: 'name' });
        select.append(option);
      }
      select.value = this.config.rows?.[row.level] ?? '';
      select.addEventListener('change', () => {
        const rows = { ...this.config.rows };
        if (select.value) rows[row.level] = select.value;
        else delete rows[row.level];
        this.config.rows = rows;
        void this.load(false, true);
      });
      const label = node('label', 'vfx-field');
      label.textContent = t('editor.vfx.talentLevel', { level: formatNumber(row.level) });
      label.append(select);
      this.talentRows.append(label);
    }
  }

  private renderLibrary(): void {
    const search = this.search.value.toLocaleLowerCase();
    const ids = this.runtime.session?.abilities ?? [];
    this.list.replaceChildren();
    for (const id of ids) {
      if (this.favouritesOnly.checked && !this.workspace.favourites.has(id)) continue;
      const name = tEntity({ kind: 'ability', id, field: 'name' });
      if (!`${name} ${id}`.toLocaleLowerCase().includes(search)) continue;
      const row = node('button', 'vfx-ability');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(id === this.selected));
      const title = node('strong');
      title.textContent = name;
      row.append(title);
      if (this.workspace.favourites.has(id)) row.append(text('small', 'editor.vfx.saved'));
      row.addEventListener('click', () => {
        this.selected = id;
        for (const child of this.list.children)
          child.setAttribute('aria-pressed', String(child === row));
        this.renderInspector();
        this.rememberSelection();
        this.root.dataset.mobilePanel = 'none';
      });
      this.list.append(row);
    }
  }
  private renderInspector(): void {
    const id = this.selected;
    const saved = this.workspace.favourites.has(id);
    this.favouriteButton.textContent = t(saved ? 'editor.vfx.unfavourite' : 'editor.vfx.favourite');
    this.favouriteButton.setAttribute('aria-pressed', String(saved));
    this.inspector.replaceChildren();
    const name = node('h3');
    name.textContent = id ? tEntity({ kind: 'ability', id, field: 'name' }) : '';
    this.inspector.append(name);
    const def = this.runtime.session ? studioAbilityInfo(this.runtime.session.sim, id) : null;
    if (def) {
      const info = node('dl', 'vfx-facts');
      for (const [key, value] of [
        ['editor.vfx.castTime', def.castTime],
        ['editor.vfx.cooldown', def.cooldown],
      ] as const) {
        const dt = text('dt', key),
          dd = node('dd');
        dd.textContent = t('editor.vfx.seconds', {
          value: formatNumber(value, { maximumFractionDigits: 2 }),
        });
        info.append(dt, dd);
      }
      this.inspector.append(info);
    }
    const full = abilityVfxFullSpec(id),
      compact = abilityVfxSpec(id);
    if (!full || !compact) {
      this.inspector.append(text('p', 'editor.vfx.noSpec'));
      return;
    }
    const tint = node('input');
    tint.type = 'color';
    tint.value = full.tint ?? compact.c;
    const accent = node('input');
    accent.type = 'color';
    accent.value =
      typeof full.accent === 'number'
        ? `#${full.accent.toString(16).padStart(6, '0')}`
        : (full.accent ?? tint.value);
    const power = node('input');
    power.type = 'range';
    power.min = '0.25';
    power.max = '2';
    power.step = '0.05';
    power.value = String(full.power ?? 1);
    const sparks = node('input');
    sparks.type = 'range';
    sparks.min = '0';
    sparks.max = '60';
    sparks.step = '1';
    sparks.value = String(full.impact?.sparks ?? compact.sp ?? 12);
    this.inspector.append(
      field('editor.vfx.tint', tint),
      field('editor.vfx.accent', accent),
      field('editor.vfx.power', power),
      field('editor.vfx.sparks', sparks),
    );
    this.inspector.append(
      button(
        'editor.vfx.apply',
        () => {
          const draft = {
            tint: tint.value,
            accent: accent.value,
            power: Number(power.value),
            sparks: Number(sparks.value),
          };
          if (setAbilityVfxDraft(id, draft)) {
            this.drafts.set(id, draft);
            this.status.textContent = t('editor.vfx.applied');
          }
        },
        'vfx-primary',
      ),
      button('editor.vfx.original', () => {
        setAbilityVfxDraft(id, null);
        this.drafts.delete(id);
        this.renderInspector();
      }),
    );
    this.inspector.append(text('p', 'editor.vfx.draftNote', 'vfx-muted'));
    const file = node('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const pack = chosen.size <= 256_000 ? parseAbilityVfxDraftPack(await chosen.text()) : null;
      if (
        !pack ||
        !Object.keys(pack.abilities).every(
          (ability) => !!abilityVfxFullSpec(ability) && !!abilityVfxSpec(ability),
        )
      ) {
        this.status.textContent = t('editor.vfx.invalid');
        return;
      }
      for (const [ability, draft] of Object.entries(pack.abilities)) {
        setAbilityVfxDraft(ability, draft);
        this.drafts.set(ability, draft);
      }
      this.renderInspector();
      this.status.textContent = t('editor.vfx.applied');
    });
    this.inspector.append(
      button('editor.vfx.export', () =>
        downloadStudioFile(
          'vfx-draft.json',
          JSON.stringify(
            { format: 'woc-vfx-draft', version: 1, abilities: Object.fromEntries(this.drafts) },
            null,
            2,
          ),
        ),
      ),
      button('editor.vfx.import', () => file.click()),
      file,
      text('p', 'editor.vfx.note', 'vfx-muted'),
    );
  }
  private cast(): void {
    const selected = this.runtime.session
      ? studioAbilityInfo(this.runtime.session.sim, this.selected)
      : null;
    if (
      this.runtime.command({
        kind: 'cast',
        abilityId: this.selected,
        targetId: this.targetId,
        prepare: true,
      })
    )
      this.nextRepeat =
        (this.runtime.session?.time ?? 0) +
        Math.max(5, Math.max(selected?.castTime ?? 0, selected?.def.channel?.duration ?? 0) + 3);
  }
  private rememberSelection(): void {
    this.workspace.remember(this.config, this.selected);
    this.nextRepeat = (this.runtime.session?.time ?? 0) + 0.4;
  }
  private selectAdjacent(direction: number): void {
    const search = this.search.value.toLocaleLowerCase();
    const ids = (this.runtime.session?.abilities ?? []).filter(
      (id) =>
        (!this.favouritesOnly.checked || this.workspace.favourites.has(id)) &&
        `${tEntity({ kind: 'ability', id, field: 'name' })} ${id}`
          .toLocaleLowerCase()
          .includes(search),
    );
    if (!ids.length) return;
    const index = Math.max(0, ids.indexOf(this.selected));
    this.selected = ids[(index + direction + ids.length) % ids.length];
    this.renderLibrary();
    this.renderInspector();
    this.rememberSelection();
  }
  private toggleFavourite(): void {
    this.workspace.toggleFavourite(this.selected);
    this.renderLibrary();
    this.renderInspector();
  }
  private toggleArtView(): void {
    const active = this.root.classList.toggle('vfx-art-view');
    this.runtime.artView = active;
    if (this.runtime.renderer) this.runtime.renderer.studioArtView = active;
    this.artButton.textContent = t(active ? 'editor.vfx.exitArtView' : 'editor.vfx.artView');
    this.artButton.setAttribute('aria-pressed', String(active));
    this.runtime.requestDraw();
  }
  private keydown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.repeat ||
      (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, select, textarea, button, summary')))
    )
      return;
    if (!this.runtime.ready) return;
    if (event.key === ' ') this.cast();
    else if (event.key === '[') this.selectAdjacent(-1);
    else if (event.key === ']') this.selectAdjacent(1);
    else if (event.key.toLowerCase() === 'f') this.toggleFavourite();
    else if (event.key.toLowerCase() === 'a') this.toggleArtView();
    else if (event.key.toLowerCase() === 'r') {
      this.repeat.checked = !this.repeat.checked;
      this.nextRepeat = this.runtime.session?.time ?? 0;
    } else return;
    event.preventDefault();
  };
  private events(events: SimEvent[]): void {
    let changed = false;
    for (const event of events) {
      if (!['spellfx', 'spellfxAt', 'damage', 'heal2', 'aura', 'error'].includes(event.type))
        continue;
      this.log.push({ tick: this.runtime.session?.ticks ?? 0, event });
      changed = true;
      if (this.log.length > 512) this.log.shift();
      this.eventCount++;
      if (event.type === 'error') this.status.textContent = t('editor.vfx.castFailed');
    }
    if (!changed) return;
    // Event-driven diagnostic transcript; raw payload is exported, not HTML.
    const last = this.log.slice(-6);
    if (!last.length) return;
    this.timeline.replaceChildren();
    for (const row of last) {
      const chip = node('span', 'vfx-event');
      const event = row.event as SimEvent & { abilityId?: string; ability?: string };
      const name = event.abilityId ?? event.ability;
      chip.textContent = `${formatNumber(row.tick / 20, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}  ${name && ABILITIES[name] ? tEntity({ kind: 'ability', id: name, field: 'name' }) : t('editor.vfx.events', { count: formatNumber(this.eventCount) })}`;
      this.timeline.append(chip);
    }
  }
  private frame(): void {
    if (
      this.repeat.checked &&
      this.runtime.ready &&
      !this.runtime.playback.paused &&
      !this.runtime.isReplaying &&
      (this.runtime.session?.time ?? 0) >= this.nextRepeat
    )
      this.cast();
    const value = t('editor.vfx.current', {
      value: formatNumber(this.runtime.session?.time ?? 0, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    });
    if (value !== this.lastClock) {
      this.clock.textContent = value;
      this.lastClock = value;
    }
    this.syncPause();
  }
  private syncPause(): void {
    const label = t(this.runtime.playback.paused ? 'editor.vfx.resume' : 'editor.vfx.pause');
    if (this.pauseButton.textContent !== label) this.pauseButton.textContent = label;
    const disabled =
      !this.runtime.ready || this.runtime.playback.paused || this.runtime.isReplaying;
    if (this.castButton.disabled !== disabled) this.castButton.disabled = disabled;
    if (this.runButton.disabled !== disabled) this.runButton.disabled = disabled;
    if (this.targets.disabled !== disabled) this.targets.disabled = disabled;
  }
  private orbit(delta: number): void {
    if (this.runtime.renderer) this.runtime.renderer.camYaw += delta;
    this.runtime.requestDraw();
  }
  private zoom(delta: number): void {
    const renderer = this.runtime.renderer;
    if (renderer) renderer.camDist = Math.max(3, Math.min(45, renderer.camDist + delta));
    this.runtime.requestDraw();
  }
  private bindCamera(canvas: HTMLCanvasElement): void {
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (event) => {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag || !this.runtime.renderer) return;
      this.orbit((drag.x - event.clientX) * 0.006);
      this.runtime.renderer.camPitch = Math.max(
        0.15,
        Math.min(1.35, this.runtime.renderer.camPitch + (event.clientY - drag.y) * 0.004),
      );
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
    const release = () => {
      drag = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.zoom(Math.sign(event.deltaY));
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  private exportSession(): void {
    downloadStudioFile(
      'vfx-session.json',
      JSON.stringify(
        {
          format: 'woc-vfx-session',
          version: 1,
          build: __APP_BUILD_ID__,
          graphics: {
            tier: GFX.tier,
            reducedMotion: this.runtime.reduceMotion,
            osReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              dpr: window.devicePixelRatio,
            },
          },
          config: this.runtime.session?.config,
          ticks: this.runtime.session?.ticks,
          commands: this.runtime.session?.commands,
          events: this.log,
          drafts: Object.fromEntries(this.drafts),
          camera: {
            yaw: this.runtime.renderer?.camYaw,
            pitch: this.runtime.renderer?.camPitch,
            distance: this.runtime.renderer?.camDist,
          },
        },
        null,
        2,
      ),
    );
  }
  private async capture(): Promise<void> {
    if (!this.runtime.ready) return;
    const data = await this.runtime.renderer?.captureScreenshot(3840, 0.95);
    if (!data) return;
    const link = node('a');
    link.href = data;
    link.download = 'vfx-frame.jpg';
    link.click();
  }
  dispose(): Promise<void> {
    this.bootGeneration++;
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.keydown);
    return this.runtime.dispose();
  }
}
