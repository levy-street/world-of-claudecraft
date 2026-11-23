// Floating DOM review panel for the Spell & VFX Lab (`?spells=on`, or toggle
// with `Alt+Shift+S` in dev builds).
//
// Lets the reviewer browse all 9 classes, 27 specializations, base kits,
// talent-granted spells, body fits (Male/Female), and weapon loadouts,
// playing each spell's full WOC animation + VFX combination on demand or in
// an automated sequence.

import { ALL_CLASSES, type PlayerClass } from '../../sim/types';
import {
  CLASS_ACCENT_HEX,
  type ClassSpellCatalog,
  SPELL_LAB_LOADOUT_PRESETS,
  type SpellLabEntry,
  type SpellLabFilterTab,
  type SpellLabLoadoutPresetId,
} from './spell_lab_catalog_core';

export interface SpellLabLiveTelemetry {
  activeClip: string;
  isMidOneShot: boolean;
  loadout: string;
  bodyFit: 'male' | 'female';
  dummyDistanceYd: string;
  lastPlayedMode: 'sim' | 'direct' | 'idle';
}

export interface SpellLabPanelState {
  catalog: ClassSpellCatalog;
  filteredEntries: readonly SpellLabEntry[];
  activeTab: SpellLabFilterTab;
  specExclusiveOnly: boolean;
  hidePassives: boolean;
  query: string;
  selectedId: string | null;
  bodyFit: 'male' | 'female';
  timeScale: number;
  autoPlaying: boolean;
  status: string;
  telemetry: SpellLabLiveTelemetry;
}

export interface SpellLabPanelCallbacks {
  onSelectClass(cls: PlayerClass): void;
  onSelectTab(tab: SpellLabFilterTab): void;
  onToggleSpecExclusive(exclusive: boolean): void;
  onToggleHidePassives(hide: boolean): void;
  onSearch(query: string): void;
  onSelectLoadout(presetId: SpellLabLoadoutPresetId): void;
  onSelectBodyFit(fit: 'male' | 'female'): void;
  onSelectTimeScale(scale: number): void;
  onPlayEntry(entryId: string): void;
  onStep(delta: -1 | 1): void;
  onReplay(): void;
  onToggleAutoPlay(): void;
  onFrameCamera(): void;
  onClose(): void;
}

export interface SpellLabPanel {
  render(state: SpellLabPanelState): void;
  updateTelemetry(telemetry: SpellLabLiveTelemetry, status?: string): void;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  dispose(): void;
}

const SCHOOL_COLORS: Readonly<Record<string, string>> = {
  physical: '#d4b88c',
  fire: '#ff7a3d',
  frost: '#5fd4ff',
  arcane: '#c78cff',
  shadow: '#a575ff',
  holy: '#ffe27a',
  nature: '#6ee07b',
};

const PANEL_CSS = `
.woc-spell-lab {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 9998;
  width: 440px;
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 224, 166, 0.24);
  background: rgba(13, 15, 22, 0.92);
  backdrop-filter: blur(10px);
  color: #f3ead8;
  font: 12px/1.35 system-ui, -apple-system, Segoe UI, sans-serif;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.62);
  user-select: none;
  pointer-events: auto;
}
.woc-spell-lab.is-hidden {
  display: none;
}
.woc-spell-lab.is-minimized .woc-sl-body {
  display: none;
}
.woc-sl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.woc-sl-title {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #ffd992;
}
.woc-sl-head-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}
.woc-sl-status {
  font-size: 11px;
  color: #8ce4a6;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.woc-sl-icon-btn {
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: #e6dcc8;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.woc-sl-icon-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.woc-sl-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  min-height: 0;
  flex: 1;
}
.woc-sl-classes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.woc-sl-class-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.04);
  color: #e9dfd0;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.woc-sl-class-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.woc-sl-class-btn.is-active {
  border-color: #f3c46b;
  background: rgba(243, 196, 107, 0.16);
  color: #fff6e3;
}
.woc-sl-class-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.woc-sl-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.woc-sl-tab {
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #d8cebe;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.woc-sl-tab:hover {
  background: rgba(255, 255, 255, 0.1);
}
.woc-sl-tab.is-active {
  border-color: #f3c46b;
  background: rgba(243, 196, 107, 0.2);
  color: #ffe2a4;
  font-weight: 600;
}
.woc-sl-rig-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.woc-sl-seg {
  display: inline-flex;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.woc-sl-seg button {
  padding: 3px 7px;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  color: #cfc4b4;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.woc-sl-seg button.is-active {
  background: rgba(243, 196, 107, 0.24);
  color: #ffe2a4;
  font-weight: 600;
}
.woc-sl-select {
  width: 100%;
  padding: 4px 6px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: #171a24;
  color: #f3ead8;
  font: inherit;
  font-size: 11px;
}
.woc-sl-controls {
  display: flex;
  align-items: center;
  gap: 5px;
}
.woc-sl-btn {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #f3ead8;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.woc-sl-btn:hover {
  background: rgba(255, 255, 255, 0.13);
}
.woc-sl-btn.is-primary {
  border-color: rgba(124, 224, 152, 0.55);
  background: rgba(66, 168, 98, 0.22);
  color: #b8f7c8;
  font-weight: 600;
}
.woc-sl-btn.is-active {
  border-color: #ff9c59;
  background: rgba(255, 132, 56, 0.24);
  color: #ffd1b0;
  font-weight: 600;
}
.woc-sl-inspector {
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.34);
  border: 1px solid rgba(255, 224, 166, 0.14);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.woc-sl-insp-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.woc-sl-insp-name {
  font-weight: 700;
  font-size: 12.5px;
  color: #fff3db;
}
.woc-sl-insp-id {
  font: 10.5px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9e9689;
}
.woc-sl-insp-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d6cbb8;
}
.woc-sl-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  font: 10.5px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(255, 255, 255, 0.08);
  color: #e7decb;
}
.woc-sl-badge.is-clip {
  background: rgba(95, 212, 255, 0.15);
  color: #9be5ff;
  border: 1px solid rgba(95, 212, 255, 0.28);
}
.woc-sl-badge.is-loop {
  background: rgba(199, 140, 255, 0.15);
  color: #dfbaff;
  border: 1px solid rgba(199, 140, 255, 0.28);
}
.woc-sl-badge.is-vfx {
  background: rgba(255, 214, 110, 0.14);
  color: #ffe094;
  border: 1px solid rgba(255, 214, 110, 0.28);
}
.woc-sl-filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.woc-sl-search {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.35);
  color: #f3ead8;
  font: inherit;
  font-size: 11.5px;
}
.woc-sl-search::placeholder {
  color: #8f877a;
}
.woc-sl-chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #c8beae;
  cursor: pointer;
  white-space: nowrap;
}
.woc-sl-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  max-height: 360px;
  padding-right: 3px;
}
.woc-sl-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(255, 255, 255, 0.035);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.woc-sl-card:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 224, 166, 0.28);
}
.woc-sl-card.is-selected {
  border-color: #f3c46b;
  background: rgba(243, 196, 107, 0.15);
}
.woc-sl-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.woc-sl-card-title {
  font-weight: 600;
  font-size: 12px;
  color: #f9f1e2;
  display: flex;
  align-items: center;
  gap: 5px;
}
.woc-sl-card-meta {
  font-size: 10.5px;
  color: #b7ad9c;
}
.woc-sl-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.woc-sl-foot {
  font-size: 10.5px;
  color: #9e9587;
  display: flex;
  justify-content: space-between;
  padding-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
`;

function formatEntryOrigin(entry: SpellLabEntry, catalog: ClassSpellCatalog): string {
  if (entry.category === 'basic') return 'Basic Action';
  const specNames = entry.specIds.map((id) => catalog.specs.find((s) => s.id === id)?.name ?? id);
  if (entry.isSpecSignature && specNames.length > 0) {
    return `${specNames.join('/')} Signature`;
  }
  if (entry.talentRowLevel !== null) {
    return `Row Lv${entry.talentRowLevel}${specNames.length > 0 ? ` (${specNames.join('/')})` : ''}`;
  }
  if (specNames.length > 0) {
    return `${specNames.join('/')} Spec`;
  }
  return 'Base Kit';
}

function formatTimingTag(entry: SpellLabEntry): string {
  if (entry.passive) return 'Passive';
  if (entry.channeled) return `Channel ${entry.channelDuration}s`;
  if (entry.castTime > 0) return `Cast ${entry.castTime}s`;
  return 'Instant';
}

export function mountSpellLabPanel(cb: SpellLabPanelCallbacks): SpellLabPanel {
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  const root = document.createElement('aside');
  root.className = 'woc-spell-lab';
  root.setAttribute('aria-label', 'Spell and VFX Review Lab');
  for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'wheel']) {
    root.addEventListener(ev, (e) => e.stopPropagation());
  }

  let minimized = false;
  let visible = true;
  let lastClass: PlayerClass | null = null;
  let lastTab: SpellLabFilterTab | null = null;
  let liveLineEl: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let searchInputEl: HTMLInputElement | null = null;

  // Header
  const head = document.createElement('div');
  head.className = 'woc-sl-head';
  const title = document.createElement('div');
  title.className = 'woc-sl-title';
  title.textContent = 'Spell & VFX Lab';
  statusEl = document.createElement('div');
  statusEl.className = 'woc-sl-status';
  const headActions = document.createElement('div');
  headActions.className = 'woc-sl-head-actions';

  const minBtn = document.createElement('button');
  minBtn.type = 'button';
  minBtn.className = 'woc-sl-icon-btn';
  minBtn.textContent = '_';
  minBtn.title = 'Minimize / Expand';
  minBtn.addEventListener('click', () => {
    minimized = !minimized;
    root.classList.toggle('is-minimized', minimized);
    minBtn.textContent = minimized ? '+' : '_';
    minBtn.blur();
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'woc-sl-icon-btn';
  closeBtn.textContent = 'x';
  closeBtn.title = 'Hide panel (Alt+Shift+S to reopen)';
  closeBtn.addEventListener('click', () => {
    closeBtn.blur();
    cb.onClose();
  });

  headActions.append(statusEl, minBtn, closeBtn);
  head.append(title, headActions);

  const body = document.createElement('div');
  body.className = 'woc-sl-body';

  const classesWrap = document.createElement('div');
  classesWrap.className = 'woc-sl-classes';

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'woc-sl-tabs';

  const rigBar = document.createElement('div');
  rigBar.className = 'woc-sl-rig-bar';

  const controlsBar = document.createElement('div');
  controlsBar.className = 'woc-sl-controls';

  const inspectorBox = document.createElement('div');
  inspectorBox.className = 'woc-sl-inspector';

  const filterRow = document.createElement('div');
  filterRow.className = 'woc-sl-filter-row';

  searchInputEl = document.createElement('input');
  searchInputEl.type = 'search';
  searchInputEl.className = 'woc-sl-search';
  searchInputEl.placeholder = 'Filter spell, clip (Woc_...), or VFX arch...';
  searchInputEl.addEventListener('keydown', (e) => e.stopPropagation());
  searchInputEl.addEventListener('input', () => {
    cb.onSearch(searchInputEl?.value ?? '');
  });

  const specOnlyLabel = document.createElement('label');
  specOnlyLabel.className = 'woc-sl-chk';
  const specOnlyChk = document.createElement('input');
  specOnlyChk.type = 'checkbox';
  specOnlyChk.addEventListener('change', () => {
    cb.onToggleSpecExclusive(specOnlyChk.checked);
    specOnlyChk.blur();
  });
  const specOnlyText = document.createElement('span');
  specOnlyText.textContent = 'Spec only';
  specOnlyLabel.append(specOnlyChk, specOnlyText);

  const hidePassivesLabel = document.createElement('label');
  hidePassivesLabel.className = 'woc-sl-chk';
  const hidePassivesChk = document.createElement('input');
  hidePassivesChk.type = 'checkbox';
  hidePassivesChk.addEventListener('change', () => {
    cb.onToggleHidePassives(hidePassivesChk.checked);
    hidePassivesChk.blur();
  });
  const hidePassivesText = document.createElement('span');
  hidePassivesText.textContent = 'Active only';
  hidePassivesLabel.append(hidePassivesChk, hidePassivesText);

  filterRow.append(searchInputEl, specOnlyLabel, hidePassivesLabel);

  const listWrap = document.createElement('div');
  listWrap.className = 'woc-sl-list';

  const foot = document.createElement('div');
  foot.className = 'woc-sl-foot';

  body.append(classesWrap, tabsWrap, rigBar, controlsBar, inspectorBox, filterRow, listWrap, foot);
  root.append(head, body);
  document.body.appendChild(root);

  function renderInspector(
    selected: SpellLabEntry | undefined,
    catalog: ClassSpellCatalog,
    telemetry: SpellLabLiveTelemetry,
  ): void {
    inspectorBox.replaceChildren();
    if (!selected) {
      const empty = document.createElement('div');
      empty.className = 'woc-sl-insp-row';
      empty.textContent = 'Click any spell below to play its WOC animation + VFX.';
      inspectorBox.appendChild(empty);
      return;
    }

    const top = document.createElement('div');
    top.className = 'woc-sl-insp-top';
    const nameEl = document.createElement('div');
    nameEl.className = 'woc-sl-insp-name';
    nameEl.textContent = `${selected.name} (${formatEntryOrigin(selected, catalog)})`;
    const idEl = document.createElement('div');
    idEl.className = 'woc-sl-insp-id';
    idEl.textContent = `${selected.id} \u00b7 ${formatTimingTag(selected)}`;
    top.append(nameEl, idEl);

    const clipRow = document.createElement('div');
    clipRow.className = 'woc-sl-insp-row';
    const clipBadge = document.createElement('span');
    clipBadge.className = 'woc-sl-badge is-clip';
    clipBadge.textContent =
      selected.resolvedClip !== selected.baseClip
        ? `Clip: ${selected.baseClip} -> ${selected.resolvedClip}`
        : `Clip: ${selected.resolvedClip}`;
    clipRow.appendChild(clipBadge);

    if (selected.castLoopClip) {
      const loopBadge = document.createElement('span');
      loopBadge.className = 'woc-sl-badge is-loop';
      loopBadge.textContent = `Loop: ${selected.castLoopClip}`;
      clipRow.appendChild(loopBadge);
    }

    const vfxBadge = document.createElement('span');
    vfxBadge.className = 'woc-sl-badge is-vfx';
    const motifs = selected.vfxMotifs.length > 0 ? ` [${selected.vfxMotifs.join(', ')}]` : '';
    vfxBadge.textContent = `VFX: ${selected.vfxArchetype} (${selected.vfxSchool})${motifs}`;
    clipRow.appendChild(vfxBadge);

    liveLineEl = document.createElement('div');
    liveLineEl.className = 'woc-sl-insp-row';
    liveLineEl.textContent = formatTelemetryText(telemetry);

    inspectorBox.append(top, clipRow, liveLineEl);
  }

  function formatTelemetryText(t: SpellLabLiveTelemetry): string {
    const stateTag = t.isMidOneShot ? 'ONE-SHOT' : 'LOOP';
    return `Live Rig: ${t.activeClip} (${stateTag}) \u00b7 Fit: ${t.bodyFit} \u00b7 Loadout: ${t.loadout} \u00b7 Dummy: ${t.dummyDistanceYd}yd`;
  }

  return {
    render(state: SpellLabPanelState): void {
      if (statusEl) statusEl.textContent = state.status;

      // 1. Class buttons
      classesWrap.replaceChildren();
      for (const cls of ALL_CLASSES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `woc-sl-class-btn${cls === state.catalog.cls ? ' is-active' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'woc-sl-class-dot';
        dot.style.background = CLASS_ACCENT_HEX[cls];
        const label = document.createElement('span');
        label.textContent = cls.charAt(0).toUpperCase() + cls.slice(1);
        btn.append(dot, label);
        btn.addEventListener('click', () => {
          btn.blur();
          cb.onSelectClass(cls);
        });
        classesWrap.appendChild(btn);
      }

      // 2. Spec & category filter tabs
      tabsWrap.replaceChildren();
      const tabDefs: { id: SpellLabFilterTab; label: string }[] = [
        { id: 'all', label: `All (${state.catalog.entries.length})` },
        ...state.catalog.specs.map((s) => ({
          id: s.id,
          label: `* ${s.name}`,
        })),
        { id: 'base', label: 'Base Kit' },
        { id: 'talents', label: 'Talents' },
        { id: 'basic', label: 'Basics' },
      ];
      for (const t of tabDefs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `woc-sl-tab${state.activeTab === t.id ? ' is-active' : ''}`;
        btn.textContent = t.label;
        btn.addEventListener('click', () => {
          btn.blur();
          cb.onSelectTab(t.id);
        });
        tabsWrap.appendChild(btn);
      }

      // 3. Rig bar (Body Fit + Weapon Loadout + Speed)
      rigBar.replaceChildren();
      const fitSeg = document.createElement('div');
      fitSeg.className = 'woc-sl-seg';
      for (const fit of ['male', 'female'] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = state.bodyFit === fit ? 'is-active' : '';
        b.textContent = fit === 'male' ? 'Male' : 'Female';
        b.addEventListener('click', () => {
          b.blur();
          cb.onSelectBodyFit(fit);
        });
        fitSeg.appendChild(b);
      }

      const loadoutSelect = document.createElement('select');
      loadoutSelect.className = 'woc-sl-select';
      loadoutSelect.title = 'Weapon Loadout (updates held weapons and WOC clip swaps live)';
      for (const preset of SPELL_LAB_LOADOUT_PRESETS) {
        const opt = document.createElement('option');
        opt.value = preset.id;
        opt.textContent = preset.label;
        opt.selected = preset.id === state.catalog.loadoutPresetId;
        loadoutSelect.appendChild(opt);
      }
      loadoutSelect.addEventListener('change', () => {
        loadoutSelect.blur();
        cb.onSelectLoadout(loadoutSelect.value as SpellLabLoadoutPresetId);
      });

      const speedSeg = document.createElement('div');
      speedSeg.className = 'woc-sl-seg';
      for (const spd of [1, 0.5, 0.25]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = Math.abs(state.timeScale - spd) < 0.01 ? 'is-active' : '';
        b.textContent = `${spd}x`;
        b.title = `Animation speed ${spd}x`;
        b.addEventListener('click', () => {
          b.blur();
          cb.onSelectTimeScale(spd);
        });
        speedSeg.appendChild(b);
      }
      rigBar.append(fitSeg, loadoutSelect, speedSeg);

      // 4. Playback controls
      controlsBar.replaceChildren();
      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.className = `woc-sl-btn ${state.autoPlaying ? 'is-active' : 'is-primary'}`;
      autoBtn.textContent = state.autoPlaying ? '[Stop Sequence]' : '[Play Spec Sequence]';
      autoBtn.addEventListener('click', () => {
        autoBtn.blur();
        cb.onToggleAutoPlay();
      });

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'woc-sl-btn';
      prevBtn.textContent = '< Prev';
      prevBtn.title = 'Previous spell (Alt+[)';
      prevBtn.addEventListener('click', () => {
        prevBtn.blur();
        cb.onStep(-1);
      });

      const replayBtn = document.createElement('button');
      replayBtn.type = 'button';
      replayBtn.className = 'woc-sl-btn';
      replayBtn.textContent = 'Replay';
      replayBtn.title = 'Replay selected spell (Alt+R)';
      replayBtn.addEventListener('click', () => {
        replayBtn.blur();
        cb.onReplay();
      });

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'woc-sl-btn';
      nextBtn.textContent = 'Next >';
      nextBtn.title = 'Next spell (Alt+])';
      nextBtn.addEventListener('click', () => {
        nextBtn.blur();
        cb.onStep(1);
      });

      const camBtn = document.createElement('button');
      camBtn.type = 'button';
      camBtn.className = 'woc-sl-btn';
      camBtn.textContent = 'Frame Dummy';
      camBtn.title = 'Stage practice target dummy in front of player';
      camBtn.addEventListener('click', () => {
        camBtn.blur();
        cb.onFrameCamera();
      });

      controlsBar.append(autoBtn, prevBtn, replayBtn, nextBtn, camBtn);

      // 5. Filter checkboxes & search sync
      specOnlyChk.checked = state.specExclusiveOnly;
      hidePassivesChk.checked = state.hidePassives;
      if (searchInputEl && document.activeElement !== searchInputEl) {
        searchInputEl.value = state.query;
      }

      // 6. Selected entry inspector
      const selected =
        state.filteredEntries.find((e) => e.id === state.selectedId) ??
        state.catalog.entries.find((e) => e.id === state.selectedId);
      renderInspector(selected, state.catalog, state.telemetry);

      // 7. Spell cards list
      const classOrTabChanged = lastClass !== state.catalog.cls || lastTab !== state.activeTab;
      lastClass = state.catalog.cls;
      lastTab = state.activeTab;

      listWrap.replaceChildren();
      for (const entry of state.filteredEntries) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `woc-sl-card${entry.id === state.selectedId ? ' is-selected' : ''}`;
        card.dataset.spellId = entry.id;

        const top = document.createElement('div');
        top.className = 'woc-sl-card-top';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'woc-sl-card-title';
        const schoolDot = document.createElement('span');
        schoolDot.className = 'woc-sl-class-dot';
        schoolDot.style.background = SCHOOL_COLORS[entry.school] ?? '#d4b88c';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = entry.name;
        titleWrap.append(schoolDot, nameSpan);

        const metaSpan = document.createElement('span');
        metaSpan.className = 'woc-sl-card-meta';
        metaSpan.textContent = `${formatEntryOrigin(entry, state.catalog)} \u00b7 ${formatTimingTag(entry)}`;
        top.append(titleWrap, metaSpan);

        const badges = document.createElement('div');
        badges.className = 'woc-sl-card-badges';

        const clipBadge = document.createElement('span');
        clipBadge.className = 'woc-sl-badge is-clip';
        clipBadge.textContent = entry.resolvedClip;
        badges.appendChild(clipBadge);

        if (entry.castLoopClip) {
          const loopBadge = document.createElement('span');
          loopBadge.className = 'woc-sl-badge is-loop';
          loopBadge.textContent = `loop: ${entry.castLoopClip}`;
          badges.appendChild(loopBadge);
        }

        const vfxBadge = document.createElement('span');
        vfxBadge.className = 'woc-sl-badge is-vfx';
        vfxBadge.textContent = `${entry.vfxArchetype} \u00b7 ${entry.vfxSchool}`;
        badges.appendChild(vfxBadge);

        if (entry.requiresForm) {
          const formBadge = document.createElement('span');
          formBadge.className = 'woc-sl-badge';
          formBadge.textContent = `form: ${entry.requiresForm}`;
          badges.appendChild(formBadge);
        }

        card.append(top, badges);
        card.addEventListener('click', () => {
          card.blur();
          cb.onPlayEntry(entry.id);
        });
        listWrap.appendChild(card);
      }

      if (classOrTabChanged) {
        listWrap.scrollTop = 0;
      } else if (state.selectedId) {
        const activeEl = listWrap.querySelector(
          `[data-spell-id="${CSS.escape(state.selectedId)}"]`,
        ) as HTMLElement | null;
        activeEl?.scrollIntoView({ block: 'nearest' });
      }

      foot.textContent = `${state.filteredEntries.length} spells shown \u00b7 Alt+[ / Alt+] step \u00b7 Alt+R replay \u00b7 Alt+Shift+S toggle`;
    },

    updateTelemetry(telemetry: SpellLabLiveTelemetry, status?: string): void {
      if (liveLineEl) {
        liveLineEl.textContent = formatTelemetryText(telemetry);
      }
      if (status !== undefined && statusEl) {
        statusEl.textContent = status;
      }
    },

    setVisible(next: boolean): void {
      visible = next;
      root.classList.toggle('is-hidden', !visible);
    },

    isVisible(): boolean {
      return visible;
    },

    dispose(): void {
      root.remove();
      style.remove();
    },
  };
}
