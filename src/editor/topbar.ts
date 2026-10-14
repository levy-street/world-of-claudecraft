// The editor top bar: app title, inline-editable map name, dirty dot + save
// state, undo depth, the primary actions, the 3D/2D toggle, and the offline
// badge with a sign-in deep link. Pure chrome: every mutation flows through the
// injected callbacks; the app pushes state back via the set* methods.

import { t } from '../ui/i18n';
import { button, el } from './dom';
import { STUDIO_NAME } from './studio_brand';

const CAM_FOCUS_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

// A quaver: the area-soundtrack toggle, which lives in the always-visible
// icon cluster rather than a menu, hearing where you are is a glance, not a
// setting you go looking for.
const MUSIC_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';

/** One camera view toggle mirrored into the top bar (same state as the
 *  inspector's Camera tab; the app keeps the two in sync). */
export interface CameraToggle {
  /** Stable key, doubles as the button class suffix. */
  key: string;
  /** Tooltip (reuses the Camera tab's own i18n strings). */
  title: string;
  /** Inline SVG markup for the 24x24 icon (stroke follows currentColor). */
  icon: string;
  get(): boolean;
  set(on: boolean): void;
}

export interface TopbarDeps {
  onNameChange(name: string): void;
  onNew(): void;
  onNewFlat(): void;
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  onAutosaveToggle(): void;
  /** Ask "save as preset?" after a Collision Master Lock In (on/off). */
  onPresetPromptToggle(): void;
  onFork(): void;
  onImport(): void;
  onExport(): void;
  onUploadAsset(): void;
  onImportModel(): void;
  onWorldLink(): void;
  onGenerateTerrain(): void;
  onEvenBuildings(): void;
  onSettings(): void;
  onPlaytest(): void;
  /** Absent while no authored dungeon is registered: the entry is hidden. */
  onDungeonMode?: () => void;
  onBattlegroundMode(): void;
  /** Write the open REGION map back to its generated module (dev only). */
  onRegionExport(): void;
  /** Publish the open map into the local repo as game content (dev only). */
  onPublishMap(): void;
  /** Uninstall this map from the local game, restoring the standard world. */
  onUnpublishMap(): void;
  onViewMode(mode: '3d' | '2d'): void;
  onProjectionToggle(): void;
  onAxisGimbalToggle(): void;
  onMinimapToggle(): void;
  /** Play/stop the soundtrack for the area under the camera. */
  onMusicToggle(): void;
  onOpenMap(): void;
  onPreviewToggle(): void;
  /** Full Build ⇄ Zone: isolate the camera's zone (view state, not the doc). */
  onZoneIsolateToggle(): void;
  /** Show/hide the collision hitbox overlay over the whole map. */
  onHitboxToggle(): void;
  /** Camera: frame the current selection (the Camera tab's Focus button). */
  onCameraFocus(): void;
  /** Camera view toggles rendered as icon buttons in the bar. */
  cameraToggles: readonly CameraToggle[];
  /** Stream every zone of the document with a progress toast. */
  onFullBuildPreview(): void;
  onUndo(): void;
  onRedo(): void;
  onHelp(): void;
}

export class Topbar {
  readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly dirtyDot: HTMLElement;
  private readonly saveState: HTMLElement;
  private readonly undoBadge: HTMLElement;
  private readonly offlineBadge: HTMLElement;
  private readonly forkBtn: HTMLButtonElement;
  private readonly camToggleBtns: [HTMLButtonElement, CameraToggle][] = [];
  private readonly uploadBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly autosaveBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly viewButtons = new Map<'3d' | '2d', HTMLButtonElement>();
  private readonly projectionBtn: HTMLButtonElement;
  private readonly axisGimbalBtn: HTMLButtonElement;
  private readonly minimapBtn: HTMLButtonElement;
  private readonly musicBtn: HTMLButtonElement;
  private readonly previewBtn: HTMLButtonElement;
  private readonly zoneIsolateBtn: HTMLButtonElement;
  private readonly hitboxBtn: HTMLButtonElement;
  private readonly regionExportBtn: HTMLButtonElement;
  private publishBtn!: HTMLButtonElement;
  private unpublishBtn!: HTMLButtonElement;
  private moreBtn!: HTMLButtonElement;
  private moreMenu!: HTMLElement;
  private presetPromptBtn!: HTMLButtonElement;

  constructor(parent: HTMLElement, deps: TopbarDeps) {
    this.root = el('header', 'ed-topbar');
    this.root.setAttribute('aria-label', t('editor.topbar.label'));

    const brand = el('div', 'ed-brand');
    brand.setAttribute('aria-label', STUDIO_NAME);
    brand.tabIndex = 0;
    const brandMark = document.createElement('img');
    brandMark.className = 'ed-brand-mark';
    brandMark.src = '/cc-studio-icon.png';
    brandMark.alt = '';
    brandMark.draggable = false;
    brandMark.decoding = 'async';
    brand.append(brandMark, el('span', 'ed-brand-name', STUDIO_NAME));
    this.root.appendChild(brand);

    // Inline-editable map name + dirty dot + save state.
    const nameWrap = el('div', 'ed-name-wrap');
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.className = 'ed-name';
    this.nameInput.maxLength = 60;
    this.nameInput.setAttribute('aria-label', t('editor.topbar.mapNameLabel'));
    this.nameInput.addEventListener('change', () => {
      const v = this.nameInput.value.trim() || t('editor.untitledMap');
      this.nameInput.value = v;
      deps.onNameChange(v);
    });
    this.nameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.nameInput.blur();
      ev.stopPropagation(); // typing a tool key in the name must not switch tools
    });
    this.dirtyDot = el('span', 'ed-dirty-dot');
    this.dirtyDot.title = t('editor.topbar.dirtyDot');
    this.dirtyDot.style.display = 'none';
    this.saveState = el('span', 'ed-save-state', t('editor.topbar.neverSaved'));
    nameWrap.append(this.nameInput, this.dirtyDot, this.saveState);
    this.root.appendChild(nameWrap);

    // Undo/redo buttons: keyboard has Ctrl+Z / Ctrl+Y, touch needs these.
    const undoWrap = el('div', 'ed-undo-actions');
    this.undoBtn = button(
      t('editor.topbar.undo'),
      deps.onUndo,
      undefined,
      t('editor.topbar.undoTitle'),
    );
    this.redoBtn = button(
      t('editor.topbar.redo'),
      deps.onRedo,
      undefined,
      t('editor.topbar.redoTitle'),
    );
    this.undoBtn.disabled = true;
    this.redoBtn.disabled = true;
    undoWrap.append(this.undoBtn, this.redoBtn);
    this.root.appendChild(undoWrap);

    this.undoBadge = el('span', 'ed-undo-badge');
    this.undoBadge.style.display = 'none';
    this.root.appendChild(this.undoBadge);

    const spacer = el('div', 'ed-topbar-spacer');
    this.root.appendChild(spacer);

    this.offlineBadge = el('span', 'ed-offline');
    this.offlineBadge.style.display = 'none';
    const offLabel = el('span', undefined, t('editor.topbar.offline'));
    offLabel.title = t('editor.topbar.offlineTitle');
    const signIn = document.createElement('a');
    signIn.href = '/index.html';
    signIn.target = '_blank';
    signIn.rel = 'noopener';
    signIn.textContent = t('editor.topbar.signIn');
    signIn.title = t('editor.topbar.signInTitle');
    this.offlineBadge.append(offLabel, signIn);
    this.root.appendChild(this.offlineBadge);

    // Actions: only the everyday pair stays visible (Open, Save); document
    // creation lives in the More menu (New = the standard world, Blank Map =
    // nothing from the base game) and Import Model moved into the asset
    // browser, so the bar stays uncluttered at common window widths.
    const actions = el('div', 'ed-actions');
    actions.appendChild(
      button(t('editor.topbar.open'), deps.onOpen, undefined, t('editor.topbar.openTitle')),
    );
    this.saveBtn = button(
      t('editor.topbar.save'),
      deps.onSave,
      undefined,
      t('editor.topbar.saveTitle'),
    );
    actions.appendChild(this.saveBtn);

    // The More menu: secondary document, save, and exchange actions.
    const moreWrap = el('div', 'ed-more-wrap');
    this.moreBtn = button(
      t('editor.topbar.more'),
      () => this.toggleMore(),
      'ed-more-btn',
      t('editor.topbar.moreTitle'),
    );
    this.moreBtn.setAttribute('aria-haspopup', 'true');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    this.moreMenu = el('div', 'ed-more-menu');
    this.moreMenu.style.display = 'none';
    this.moreMenu.setAttribute('role', 'menu');
    const item = (b: HTMLButtonElement): HTMLButtonElement => {
      b.addEventListener('click', () => this.closeMore());
      this.moreMenu.appendChild(b);
      return b;
    };
    const menuSep = (): void => {
      const s = el('span', 'ed-more-sep');
      s.setAttribute('aria-hidden', 'true');
      this.moreMenu.appendChild(s);
    };
    // New (the standard current main map) with Blank Map (a fresh world with
    // none of the base game) directly below it.
    item(button(t('editor.topbar.new'), deps.onNew, undefined, t('editor.topbar.newTitle')));
    item(
      button(
        t('editor.topbar.newFlat'),
        deps.onNewFlat,
        undefined,
        t('editor.topbar.newFlatTitle'),
      ),
    );
    menuSep();
    item(
      button(t('editor.topbar.saveAs'), deps.onSaveAs, undefined, t('editor.topbar.saveAsTitle')),
    );
    // Autosave toggle: default off; the app flips it and pushes state back via
    // setAutosave (it also turns itself off after a save error).
    this.autosaveBtn = button(
      t('editor.topbar.autosave'),
      deps.onAutosaveToggle,
      'ed-autosave',
      t('editor.topbar.autosaveTitle'),
    );
    this.autosaveBtn.setAttribute('aria-pressed', 'false');
    this.moreMenu.appendChild(this.autosaveBtn); // stays open: it is a toggle
    // Collision Master preset prompt: the "Save as preset?" box after Lock In.
    // Its "don't ask again" tick lands here, so the maker can find it again.
    this.presetPromptBtn = button(
      t('editor.topbar.presetPrompt'),
      deps.onPresetPromptToggle,
      'ed-autosave',
      t('editor.topbar.presetPromptTitle'),
    );
    this.presetPromptBtn.setAttribute('aria-pressed', 'true');
    this.moreMenu.appendChild(this.presetPromptBtn); // stays open: it is a toggle
    this.forkBtn = button(
      t('editor.topbar.fork'),
      deps.onFork,
      undefined,
      t('editor.topbar.forkTitle'),
    );
    item(this.forkBtn);
    menuSep();
    item(
      button(t('editor.topbar.import'), deps.onImport, undefined, t('editor.topbar.importTitle')),
    );
    item(
      button(t('editor.topbar.export'), deps.onExport, undefined, t('editor.topbar.exportTitle')),
    );
    this.uploadBtn = button(
      t('editor.topbar.uploadAsset'),
      deps.onUploadAsset,
      undefined,
      t('editor.topbar.uploadAssetTitle'),
    );
    item(this.uploadBtn);
    menuSep();
    // Link to World: place an authored map inside the base game world (drag
    // its outline on the world map; playtest embeds it there).
    item(
      button(
        t('editor.topbar.worldLink'),
        deps.onWorldLink,
        undefined,
        t('editor.topbar.worldLinkTitle'),
      ),
    );
    // Generate Terrain: source an authored map's base heightfield from a
    // dragged region of the old world layout.
    item(
      button(
        t('editor.topbar.generateTerrain'),
        deps.onGenerateTerrain,
        undefined,
        t('editor.topbar.generateTerrainTitle'),
      ),
    );
    // Even Out Buildings: repair promoted world buildings whose horizontal axes
    // were fitted independently to their plot (world_prop_placements.ts), which
    // leaves the kit models visibly squashed.
    item(
      button(
        t('editor.topbar.evenBuildings'),
        deps.onEvenBuildings,
        undefined,
        t('editor.topbar.evenBuildingsTitle'),
      ),
    );
    // Publish to Game: writes the map into the local repo as real content
    // (data/maps + src/sim/maps), and its undo. Dev-server only: the app shows
    // them via setPublishEnabled. They live HERE, in More, where the other
    // file actions are (SPACEY went looking for it under More, 2026-09-07).
    menuSep();
    this.publishBtn = item(
      button(
        t('editor.topbar.publishMap'),
        deps.onPublishMap,
        'ed-publish-map',
        t('editor.topbar.publishMapTitle'),
      ),
    );
    this.publishBtn.style.display = 'none';
    this.unpublishBtn = item(
      button(
        t('editor.topbar.unpublishMap'),
        deps.onUnpublishMap,
        'ed-unpublish-map',
        t('editor.topbar.unpublishMapTitle'),
      ),
    );
    this.unpublishBtn.style.display = 'none';
    menuSep();
    // In-game settings (graphics + sound): tweak the same persisted settings the
    // playtest boots with, straight from the editor.
    item(
      button(
        t('editor.topbar.settings'),
        deps.onSettings,
        undefined,
        t('editor.topbar.settingsTitle'),
      ),
    );
    moreWrap.append(this.moreBtn, this.moreMenu);
    actions.appendChild(moreWrap);
    // A press anywhere outside the open menu closes it.
    document.addEventListener('pointerdown', (ev) => {
      if (this.moreMenu.style.display !== 'none' && !moreWrap.contains(ev.target as Node)) {
        this.closeMore();
      }
    });

    // Help: the guide modal + tutorial entry (also the tour's last anchor).
    actions.appendChild(
      button(t('editor.topbar.help'), deps.onHelp, 'ed-help', t('editor.topbar.helpTitle')),
    );
    this.root.appendChild(actions);

    // View and workspace commands stay together in one compact menu. These
    // are important but not constant-click actions, so the transform quartet
    // and document actions keep the header readable at laptop widths.
    const workspaceWrap = el('div', 'ed-workspace-wrap');
    const workspaceMenu = el('div', 'ed-workspace-menu');
    workspaceMenu.style.display = 'none';
    workspaceMenu.setAttribute('role', 'menu');
    const workspaceBtn = button(
      t('editor.topbar.workspace'),
      () => {
        const open = workspaceMenu.style.display === 'none';
        workspaceMenu.style.display = open ? '' : 'none';
        workspaceBtn.classList.toggle('active', open);
        workspaceBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      },
      'ed-workspace-btn',
      t('editor.topbar.workspaceTitle'),
    );
    workspaceBtn.setAttribute('aria-haspopup', 'true');
    workspaceBtn.setAttribute('aria-expanded', 'false');

    // 3D / 2D segmented toggle.
    const viewWrap = el('div', 'ed-view-toggle');
    viewWrap.setAttribute('role', 'group');
    viewWrap.setAttribute('aria-label', t('editor.topbar.viewLabel'));
    for (const mode of ['3d', '2d'] as const) {
      const b = button(
        mode === '3d' ? t('editor.topbar.view3d') : t('editor.topbar.view2d'),
        () => deps.onViewMode(mode),
        undefined,
        mode === '3d' ? t('editor.topbar.view3dTitle') : t('editor.topbar.view2dTitle'),
      );
      this.viewButtons.set(mode, b);
      viewWrap.appendChild(b);
    }
    workspaceMenu.appendChild(viewWrap);

    // Blender-style lens switch: parallel lines stay parallel in orthographic
    // mode, which makes silhouette, scale, and mesh alignment easier to judge.
    this.projectionBtn = button(
      t('editor.topbar.projectionPerspective'),
      deps.onProjectionToggle,
      'ed-projection',
      t('editor.topbar.projectionTitle'),
    );
    this.projectionBtn.setAttribute('aria-pressed', 'false');
    workspaceMenu.appendChild(this.projectionBtn);

    this.axisGimbalBtn = button(
      t('editor.topbar.axisGimbal'),
      deps.onAxisGimbalToggle,
      'ed-axis-gimbal-toggle',
      t('editor.topbar.axisGimbalTitle'),
    );
    this.axisGimbalBtn.setAttribute('aria-pressed', 'true');
    workspaceMenu.appendChild(this.axisGimbalBtn);

    // Minimap toggle + Map window (current zone, with a full-world button).
    const mapWrap = el('div', 'ed-map-actions');
    this.minimapBtn = button(
      t('editor.topbar.minimap'),
      deps.onMinimapToggle,
      'ed-minimap-btn',
      t('editor.topbar.minimapTitle'),
    );
    this.minimapBtn.setAttribute('aria-pressed', 'false');
    mapWrap.appendChild(this.minimapBtn);
    mapWrap.appendChild(
      button(
        t('editor.topbar.mapWindow'),
        deps.onOpenMap,
        undefined,
        t('editor.topbar.mapWindowTitle'),
      ),
    );
    workspaceMenu.appendChild(mapWrap);

    // Dungeon-layout mode: edits an authored interior instead of the map.
    if (deps.onDungeonMode) {
      workspaceMenu.appendChild(
        button(
          t('editor.topbar.dungeon'),
          deps.onDungeonMode,
          'ed-dungeon',
          t('editor.topbar.dungeonTitle'),
        ),
      );
    }
    // Ravenrift mode: edits the battleground placements instead of the map.
    // Fork-local authoring tool, English-only like the rest of the editor.
    workspaceMenu.appendChild(
      button(
        'Ravenrift',
        deps.onBattlegroundMode,
        'ed-ravenrift',
        'Edit the Ravenrift battleground layout (src/sim/battleground_layout.ts)',
      ),
    );
    // Region maps: the open document IS a shipped region (Open -> Shipped ->
    // Ravenrift). Exporting writes its generated module, so the edit ships.
    // Hidden until such a map is open; the app calls setRegionExport.
    this.regionExportBtn = button(
      'Export to production',
      deps.onRegionExport,
      'ed-region-export',
      'Write this region back to its generated module so the game ships it',
    );
    this.regionExportBtn.style.display = 'none';
    workspaceMenu.appendChild(this.regionExportBtn);
    // Preview mode: in-game look, editor overlays hidden. A toggle, so the
    // app pushes its state back via setPreview.
    this.previewBtn = button(
      t('editor.topbar.preview'),
      deps.onPreviewToggle,
      'ed-preview',
      t('editor.topbar.previewTitle'),
    );
    this.previewBtn.setAttribute('aria-pressed', 'false');
    workspaceMenu.appendChild(this.previewBtn);
    // Full Build Preview: stream every zone of the document (progress toast).
    workspaceMenu.appendChild(
      button(
        t('editor.topbar.fullBuildPreview'),
        deps.onFullBuildPreview,
        'ed-full-build',
        t('editor.topbar.fullBuildPreviewTitle'),
      ),
    );
    workspaceWrap.append(workspaceBtn, workspaceMenu);
    this.root.appendChild(workspaceWrap);
    document.addEventListener('pointerdown', (event) => {
      if (workspaceMenu.style.display !== 'none' && !workspaceWrap.contains(event.target as Node)) {
        workspaceMenu.style.display = 'none';
        workspaceBtn.classList.remove('active');
        workspaceBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Camera view toggles: the Camera tab's switches, surfaced as icon
    // buttons so view state is one click and always visible. Focus first
    // (an action, not a toggle), then the toggles; state mirrors the
    // inspector via syncCameraToggles().
    const camCluster = el('div', 'ed-cam-cluster');
    const focusBtn = el('button', 'ed-cam-btn2') as HTMLButtonElement;
    focusBtn.type = 'button';
    focusBtn.title = t('editor.camera.focusTitle');
    focusBtn.innerHTML = CAM_FOCUS_ICON;
    focusBtn.onclick = () => deps.onCameraFocus();
    camCluster.appendChild(focusBtn);
    for (const tog of deps.cameraToggles) {
      const b = el('button', `ed-cam-btn2 ed-cam-${tog.key}`) as HTMLButtonElement;
      b.type = 'button';
      b.title = tog.title;
      b.innerHTML = tog.icon;
      b.onclick = () => tog.set(!tog.get());
      b.setAttribute('aria-pressed', tog.get() ? 'true' : 'false');
      b.classList.toggle('active', tog.get());
      this.camToggleBtns.push([b, tog]);
      camCluster.appendChild(b);
    }
    // Area soundtrack: the track the game would play where the camera stands,
    // so a maker can hear a music area without launching a playtest.
    this.musicBtn = el('button', 'ed-cam-btn2 ed-music-btn') as HTMLButtonElement;
    this.musicBtn.type = 'button';
    this.musicBtn.title = t('editor.topbar.musicTitle');
    this.musicBtn.innerHTML = MUSIC_ICON;
    this.musicBtn.onclick = () => deps.onMusicToggle();
    this.musicBtn.setAttribute('aria-pressed', 'false');
    camCluster.appendChild(this.musicBtn);
    this.root.appendChild(camCluster);

    // Full Build ⇄ Zone: first-class in the bar, residency mode is the kind
    // of state a maker must SEE, not discover through a hidden menu.
    this.zoneIsolateBtn = button(
      t('editor.topbar.zoneIsolateOff'),
      deps.onZoneIsolateToggle,
      'ed-zone-isolate',
      t('editor.topbar.zoneIsolateTitle'),
    );
    this.zoneIsolateBtn.setAttribute('aria-pressed', 'false');
    this.root.appendChild(this.zoneIsolateBtn);

    // Collision overlay: the authored/baked shapes the sim actually blocks
    // with. It was only reachable from an inspector checkbox, so "where are my
    // hitboxes" was a fair question, the state belongs where it is visible.
    this.hitboxBtn = button(
      t('editor.topbar.hitboxes'),
      deps.onHitboxToggle,
      'ed-hitboxes',
      t('editor.topbar.hitboxesTitle'),
    );
    this.hitboxBtn.setAttribute('aria-pressed', 'false');
    this.root.appendChild(this.hitboxBtn);

    const play = button(
      t('editor.topbar.playtest'),
      deps.onPlaytest,
      'primary ed-playtest',
      t('editor.topbar.playtestTitle'),
    );
    this.root.appendChild(play);

    parent.appendChild(this.root);
  }

  /** Re-read every camera toggle's state (called by the app after any
   *  camera setting changes, from the bar or the Camera tab alike). */
  syncCameraToggles(): void {
    for (const [b, tog] of this.camToggleBtns) {
      const on = tog.get();
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    }
  }

  private toggleMore(): void {
    const open = this.moreMenu.style.display === 'none';
    this.moreMenu.style.display = open ? '' : 'none';
    this.moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.moreBtn.classList.toggle('active', open);
  }

  private closeMore(): void {
    this.moreMenu.style.display = 'none';
    this.moreBtn.setAttribute('aria-expanded', 'false');
    this.moreBtn.classList.remove('active');
  }

  setMapName(name: string): void {
    this.nameInput.value = name;
  }

  setDirty(dirty: boolean): void {
    this.dirtyDot.style.display = dirty ? '' : 'none';
    // The Save button quietly asks for attention while there are unsaved edits.
    this.saveBtn.classList.toggle('attn', dirty);
  }

  setSaveState(text: string): void {
    this.saveState.textContent = text;
  }

  setAutosave(on: boolean): void {
    this.autosaveBtn.classList.toggle('active', on);
    this.autosaveBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setPresetPrompt(on: boolean): void {
    this.presetPromptBtn.classList.toggle('active', on);
    this.presetPromptBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setSaving(saving: boolean): void {
    this.saveBtn.disabled = saving;
    if (saving) this.saveState.textContent = t('editor.topbar.saving');
  }

  setUndoDepth(depth: number): void {
    this.undoBadge.style.display = depth > 0 ? '' : 'none';
    this.undoBadge.textContent = t('editor.topbar.undoCount', { count: depth });
    this.undoBadge.title = t('editor.topbar.undoCountTitle', { count: depth });
  }

  setUndoState(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  setViewMode(mode: '3d' | '2d'): void {
    for (const [m, b] of this.viewButtons) b.classList.toggle('active', m === mode);
    this.projectionBtn.disabled = mode !== '3d';
    this.axisGimbalBtn.disabled = mode !== '3d';
  }

  setProjectionMode(orthographic: boolean): void {
    this.projectionBtn.textContent = orthographic
      ? t('editor.topbar.projectionOrthographic')
      : t('editor.topbar.projectionPerspective');
    this.projectionBtn.classList.toggle('active', orthographic);
    this.projectionBtn.setAttribute('aria-pressed', orthographic ? 'true' : 'false');
  }

  setAxisGimbalVisible(on: boolean): void {
    this.axisGimbalBtn.classList.toggle('active', on);
    this.axisGimbalBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** Show the region export action only while a region map is open. */
  setRegionExport(available: boolean): void {
    this.regionExportBtn.style.display = available ? '' : 'none';
  }

  /** Show Publish to Game only on the dev server (the endpoint is dev-only). */
  setPublishEnabled(available: boolean): void {
    this.publishBtn.style.display = available ? '' : 'none';
    this.unpublishBtn.style.display = available ? '' : 'none';
  }

  setPreview(on: boolean): void {
    this.previewBtn.classList.toggle('active', on);
    this.previewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setHitboxes(on: boolean): void {
    this.hitboxBtn.classList.toggle('active', on);
    this.hitboxBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** Zone isolate state: on = show the isolated zone's name on the toggle. */
  setZoneIsolate(zoneName: string | null): void {
    const on = zoneName !== null;
    this.zoneIsolateBtn.classList.toggle('active', on);
    this.zoneIsolateBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.zoneIsolateBtn.textContent = on
      ? t('editor.topbar.zoneIsolateOn', { zone: zoneName })
      : t('editor.topbar.zoneIsolateOff');
  }

  setMinimap(on: boolean): void {
    this.minimapBtn.classList.toggle('active', on);
    this.minimapBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setMusic(on: boolean): void {
    this.musicBtn.classList.toggle('active', on);
    this.musicBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setOffline(offline: boolean): void {
    this.offlineBadge.style.display = offline ? '' : 'none';
    this.uploadBtn.disabled = offline;
    this.uploadBtn.title = offline
      ? t('editor.topbar.uploadAssetDisabledTitle')
      : t('editor.topbar.uploadAssetTitle');
  }

  setForkEnabled(enabled: boolean): void {
    this.forkBtn.disabled = !enabled;
    this.forkBtn.title = enabled
      ? t('editor.topbar.forkTitle')
      : t('editor.topbar.forkDisabledTitle');
  }
}
