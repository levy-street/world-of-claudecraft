// Details!-style full options configuration dialog for World of ClaudeCraft combat meters.
// Provides live two-column settings with instant preview, customizable bar geometry,
// texture shaders, number formats, header telemetry, and one-click presets.

import { markDialogRoot } from './dialog_root';
import { t } from './i18n';
import {
  DEFAULT_METERS_SETTINGS,
  exportProfileString,
  FONT_OPTIONS,
  getActiveProfileName,
  importProfileString,
  loadProfiles,
  type MeterBarTexture,
  type MeterNumberFormat,
  type MeterOpacity,
  type MetersSettings,
  type MeterThemePreset,
  PRESETS,
  saveProfiles,
  setActiveProfileName,
} from './meters_settings';
import { svgIcon } from './ui_icons';

export type OptionsTab = 'general' | 'bars' | 'text' | 'header' | 'combat' | 'presets' | 'profiles';

export interface MetersOptionsDialogDeps {
  getSettings(): MetersSettings;
  onSettingsChanged(settings: MetersSettings): void;
  onClose?(): void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export class MetersOptionsDialog {
  private overlayEl: HTMLElement | null = null;
  private dialogEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private activeTab: OptionsTab = 'general';
  private isOpen = false;
  private keydownHandler: ((ev: KeyboardEvent) => void) | null = null;

  constructor(private readonly deps: MetersOptionsDialogDeps) {}

  get isDialogOpen(): boolean {
    return this.isOpen;
  }

  relocalize(): void {
    if (!this.dialogEl) return;
    const titleEl = this.dialogEl.querySelector('.mt-opts-title');
    if (titleEl) titleEl.textContent = t('hudChrome.meters.settingsTitle');
    const badgeEl = this.dialogEl.querySelector('.mt-opts-badge');
    if (badgeEl) badgeEl.textContent = t('hudChrome.meters.optionsEngineBadge');
    const closeBtn = this.dialogEl.querySelector('.mt-opts-close');
    if (closeBtn) {
      closeBtn.setAttribute('title', t('hudChrome.meters.closeSettings'));
      closeBtn.setAttribute('aria-label', t('hudChrome.meters.closeSettings'));
    }
    const resetBtn = this.dialogEl.querySelector('.mt-opts-btn-reset');
    if (resetBtn) resetBtn.textContent = t('hudChrome.meters.resetDefaults');
    const doneBtn = this.dialogEl.querySelector('.mt-opts-btn-done');
    if (doneBtn) doneBtn.textContent = t('hudChrome.meters.closeSettings');
    markDialogRoot(this.dialogEl, { label: t('hudChrome.meters.settingsTitle'), modal: true });
    this.renderTabs();
    this.renderActiveContent();
  }

  open(): void {
    if (this.isOpen) return;
    this.ensureDom();
    this.isOpen = true;
    this.overlayEl!.style.display = 'flex';
    this.renderTabs();
    this.renderActiveContent();

    this.keydownHandler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.deps.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  destroy(): void {
    this.close();
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
    this.dialogEl = null;
    this.contentEl = null;
  }

  private ensureDom(): void {
    if (this.overlayEl && this.overlayEl.isConnected) return;

    const existing = document.getElementById('meters-options-modal');
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'meters-options-modal';
    overlay.className = 'mt-opts-overlay';
    overlay.style.display = 'none';

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        this.close();
      }
    });

    const dialog = document.createElement('div');
    dialog.className = 'mt-opts-dialog panel';
    markDialogRoot(dialog, { label: t('hudChrome.meters.settingsTitle'), modal: true });

    // Header
    const header = document.createElement('div');
    header.className = 'mt-opts-header';
    header.innerHTML = `
      <div class="mt-opts-title-wrap">
        <span class="mt-opts-title">${t('hudChrome.meters.settingsTitle')}</span>
        <span class="mt-opts-badge">${t('hudChrome.meters.optionsEngineBadge')}</span>
      </div>
      <button type="button" class="x-btn mt-opts-close" title="${t('hudChrome.meters.closeSettings')}" aria-label="${t('hudChrome.meters.closeSettings')}">${svgIcon('close')}</button>
    `;
    const closeBtn = header.querySelector('.mt-opts-close') as HTMLElement;
    closeBtn.addEventListener('click', () => this.close());

    // Body: sidebar + content
    const body = document.createElement('div');
    body.className = 'mt-opts-body';

    const sidebar = document.createElement('div');
    sidebar.className = 'mt-opts-sidebar';

    const content = document.createElement('div');
    content.className = 'mt-opts-content';

    body.appendChild(sidebar);
    body.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'mt-opts-footer';
    footer.innerHTML = `
      <button type="button" class="mt-opts-btn mt-opts-btn-reset">${t('hudChrome.meters.resetDefaults')}</button>
      <div class="mt-opts-footer-spacer"></div>
      <button type="button" class="mt-opts-btn mt-opts-btn-primary mt-opts-btn-done">${t('hudChrome.meters.closeSettings')}</button>
    `;

    const resetBtn = footer.querySelector('.mt-opts-btn-reset') as HTMLElement;
    resetBtn.addEventListener('click', () => {
      this.deps.onSettingsChanged({ ...DEFAULT_METERS_SETTINGS });
      this.renderActiveContent();
    });

    const doneBtn = footer.querySelector('.mt-opts-btn-done') as HTMLElement;
    doneBtn.addEventListener('click', () => this.close());

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.overlayEl = overlay;
    this.dialogEl = dialog;
    this.contentEl = content;
  }

  private renderTabs(): void {
    if (!this.dialogEl) return;
    const sidebar = this.dialogEl.querySelector('.mt-opts-sidebar') as HTMLElement;
    if (!sidebar) return;

    const tabs: { id: OptionsTab; label: string; desc: string }[] = [
      {
        id: 'general',
        label: t('hudChrome.meters.tabGeneral'),
        desc: t('hudChrome.meters.tabGeneralDesc'),
      },
      { id: 'bars', label: t('hudChrome.meters.tabBars'), desc: t('hudChrome.meters.tabBarsDesc') },
      { id: 'text', label: t('hudChrome.meters.tabText'), desc: t('hudChrome.meters.tabTextDesc') },
      {
        id: 'header',
        label: t('hudChrome.meters.tabHeader'),
        desc: t('hudChrome.meters.tabHeaderDesc'),
      },
      {
        id: 'combat',
        label: t('hudChrome.meters.tabCombat'),
        desc: t('hudChrome.meters.tabCombatDesc'),
      },
      {
        id: 'presets',
        label: t('hudChrome.meters.tabPresets'),
        desc: t('hudChrome.meters.tabPresetsDesc'),
      },
      {
        id: 'profiles',
        label: t('hudChrome.meters.tabProfiles'),
        desc: t('hudChrome.meters.tabProfilesDesc'),
      },
    ];

    sidebar.innerHTML = '';
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mt-opts-tab-btn${this.activeTab === tab.id ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="mt-opts-tab-title">${tab.label}</span>
        <span class="mt-opts-tab-desc">${tab.desc}</span>
      `;
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.renderTabs();
        this.renderActiveContent();
      });
      sidebar.appendChild(btn);
    }
  }

  private renderActiveContent(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = '';

    switch (this.activeTab) {
      case 'general':
        this.renderGeneralTab();
        break;
      case 'bars':
        this.renderBarsTab();
        break;
      case 'text':
        this.renderTextTab();
        break;
      case 'header':
        this.renderHeaderTab();
        break;
      case 'combat':
        this.renderCombatTab();
        break;
      case 'presets':
        this.renderPresetsTab();
        break;
      case 'profiles':
        this.renderProfilesTab();
        break;
    }
  }

  private get s(): MetersSettings {
    return this.deps.getSettings();
  }

  private update(patch: Partial<MetersSettings>): void {
    const updated = { ...this.s, ...patch };
    this.deps.onSettingsChanged(updated);
  }

  // --- TAB 1: General (Ventana y Fondo) ---
  private renderGeneralTab(): void {
    const s = this.s;
    const group = this.createGroup(t('hudChrome.meters.groupWindow'));

    // Opacity mode
    group.appendChild(
      this.createRadioRow(
        t('hudChrome.meters.bgMode'),
        t('hudChrome.meters.bgModeDesc'),
        [
          {
            id: 'glass',
            label: t('hudChrome.meters.optGlass'),
            desc: t('hudChrome.meters.optGlassDesc'),
          },
          {
            id: 'solid',
            label: t('hudChrome.meters.optSolid'),
            desc: t('hudChrome.meters.optSolidDesc'),
          },
          {
            id: 'minimal',
            label: t('hudChrome.meters.optMinimal'),
            desc: t('hudChrome.meters.optMinimalDesc'),
          },
          {
            id: 'transparent',
            label: t('hudChrome.meters.optTransparent'),
            desc: t('hudChrome.meters.optTransparentDesc'),
          },
        ],
        s.opacity,
        (val) => {
          const op = val as MeterOpacity;
          const bgAlpha =
            op === 'transparent' ? 0 : s.backgroundAlpha === 0 ? 76 : s.backgroundAlpha;
          this.update({ opacity: op, backgroundAlpha: bgAlpha });
          const slider = this.contentEl?.querySelector<HTMLInputElement>('input[type="range"]');
          if (slider && slider.nextElementSibling) {
            slider.value = String(bgAlpha);
            slider.nextElementSibling.textContent = `${bgAlpha}%`;
          }
        },
      ),
    );

    // Custom background alpha slider
    group.appendChild(
      this.createSliderRow(
        t('hudChrome.meters.bgOpacity'),
        t('hudChrome.meters.bgOpacityDesc'),
        0,
        100,
        2,
        s.backgroundAlpha ?? 76,
        '%',
        (val) => {
          const newOp: MeterOpacity =
            val === 0 ? 'transparent' : s.opacity === 'transparent' ? 'glass' : s.opacity;
          this.update({
            backgroundAlpha: val,
            opacity: newOp,
          });
          const btnGroup = this.contentEl?.querySelector('.mt-opts-btn-group');
          if (btnGroup) {
            for (const b of btnGroup.querySelectorAll<HTMLButtonElement>('.mt-opts-choice-btn')) {
              b.classList.toggle('active', b.dataset.id === newOp);
            }
          }
        },
      ),
    );

    // Window scale
    group.appendChild(
      this.createSliderRow(
        t('hudChrome.meters.windowScale'),
        t('hudChrome.meters.windowScaleDesc'),
        80,
        130,
        5,
        s.windowScale ?? 100,
        '%',
        (val) => {
          this.update({ windowScale: val });
        },
      ),
    );

    // Lock position
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.lockPosition'),
        t('hudChrome.meters.lockPositionDesc'),
        s.locked,
        (checked) => {
          this.update({ locked: checked });
        },
      ),
    );

    this.contentEl!.appendChild(group);
  }

  // --- TAB 2: Barras y Texturas ---
  private renderBarsTab(): void {
    const s = this.s;
    const group = this.createGroup(t('hudChrome.meters.groupBars'));

    // Bar Height
    group.appendChild(
      this.createSliderRow(
        t('hudChrome.meters.barHeight'),
        t('hudChrome.meters.barHeightDesc'),
        14,
        26,
        1,
        s.barHeight,
        'px',
        (val) => {
          this.update({ barHeight: val, density: val <= 16 ? 'compact' : 'standard' });
        },
      ),
    );

    // Bar Spacing
    group.appendChild(
      this.createSliderRow(
        t('hudChrome.meters.barSpacing'),
        t('hudChrome.meters.barSpacingDesc'),
        0,
        4,
        1,
        s.barSpacing,
        'px',
        (val) => {
          this.update({ barSpacing: val });
        },
      ),
    );

    // Texture
    group.appendChild(
      this.createRadioRow(
        t('hudChrome.meters.barTexture'),
        t('hudChrome.meters.barTextureDesc'),
        [
          {
            id: 'specular',
            label: t('hudChrome.meters.texSpecular'),
            desc: t('hudChrome.meters.texSpecularDesc'),
          },
          {
            id: 'smooth',
            label: t('hudChrome.meters.texSmooth'),
            desc: t('hudChrome.meters.texSmoothDesc'),
          },
          {
            id: 'gradient',
            label: t('hudChrome.meters.texGradient'),
            desc: t('hudChrome.meters.texGradientDesc'),
          },
        ],
        s.barTexture,
        (val) => {
          this.update({ barTexture: val as MeterBarTexture });
        },
      ),
    );

    // Animation toggle
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.barAnimation'),
        t('hudChrome.meters.barAnimationDesc'),
        s.barAnimation,
        (checked) => {
          this.update({ barAnimation: checked });
        },
      ),
    );

    // Always Show Me
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.alwaysShowMe'),
        t('hudChrome.meters.alwaysShowMeDesc'),
        s.alwaysShowMe,
        (checked) => {
          this.update({ alwaysShowMe: checked });
        },
      ),
    );

    this.contentEl!.appendChild(group);
  }

  // --- TAB 3: Texto y Numeros ---
  private renderTextTab(): void {
    const s = this.s;
    const group = this.createGroup(t('hudChrome.meters.groupText'));

    // Number format
    group.appendChild(
      this.createRadioRow(
        t('hudChrome.meters.numFormat'),
        t('hudChrome.meters.numFormatDesc'),
        [
          {
            id: 'compact',
            label: t('hudChrome.meters.optNumCompact'),
            desc: t('hudChrome.meters.optNumCompactDesc'),
          },
          {
            id: 'detailed',
            label: t('hudChrome.meters.optNumDetailed'),
            desc: t('hudChrome.meters.optNumDetailedDesc'),
          },
          {
            id: 'damage_dps',
            label: t('hudChrome.meters.optNumDamageDps'),
            desc: t('hudChrome.meters.optNumDamageDpsDesc'),
          },
        ],
        s.numberFormat,
        (val) => {
          this.update({ numberFormat: val as MeterNumberFormat });
        },
      ),
    );

    // Show DPS/HPS
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.showDps'),
        t('hudChrome.meters.showDpsDesc'),
        s.showDps,
        (checked) => {
          this.update({ showDps: checked });
        },
      ),
    );

    // Show Percent
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.showPercent'),
        t('hudChrome.meters.showPercentDesc'),
        s.showPercent,
        (checked) => {
          this.update({ showPercent: checked });
        },
      ),
    );

    // Show Rank
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.showRank'),
        t('hudChrome.meters.showRankDesc'),
        s.showRank,
        (checked) => {
          this.update({ showRank: checked });
        },
      ),
    );

    // Show Class Icon
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.showClassIcon'),
        t('hudChrome.meters.showClassIconDesc'),
        s.showClassIcon,
        (checked) => {
          this.update({ showClassIcon: checked });
        },
      ),
    );

    this.contentEl!.appendChild(group);

    // Tipografia de Combate (Fuente de Letra)
    const fontGroup = this.createGroup(t('hudChrome.meters.groupFont'));
    const fontGrid = document.createElement('div');
    fontGrid.className = 'mt-opts-font-grid';

    for (const font of FONT_OPTIONS) {
      const card = document.createElement('div');
      card.className = `mt-opts-font-card${s.fontFamily === font.id ? ' active' : ''}`;
      card.innerHTML = `
        <div class="mt-opts-font-header">
          <span class="mt-opts-font-name">${font.name}</span>
        </div>
        <div class="mt-opts-font-desc">${font.desc}</div>
        <div class="mt-opts-font-preview" style="font-family: ${font.family}">${font.sample}</div>
      `;
      card.addEventListener('click', () => {
        for (const c of fontGrid.querySelectorAll('.mt-opts-font-card')) {
          c.classList.remove('active');
        }
        card.classList.add('active');
        this.update({ fontFamily: font.id });
      });
      fontGrid.appendChild(card);
    }
    fontGroup.appendChild(fontGrid);
    this.contentEl!.appendChild(fontGroup);
  }

  // --- TAB 4: Cabecera y Titulo ---
  private renderHeaderTab(): void {
    const s = this.s;
    const group = this.createGroup(t('hudChrome.meters.groupHeader'));

    // Show Title Bar
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.showTitleBar'),
        t('hudChrome.meters.showTitleBarDesc'),
        s.showTitleBar,
        (checked) => {
          this.update({ showTitleBar: checked });
        },
      ),
    );

    // Show Raid Totals
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.showRaidTotals'),
        t('hudChrome.meters.showRaidTotalsDesc'),
        s.showRaidTotals,
        (checked) => {
          this.update({ showRaidTotals: checked });
        },
      ),
    );

    this.contentEl!.appendChild(group);
  }

  // --- TAB 5: Combate y Limites ---
  private renderCombatTab(): void {
    const s = this.s;
    const group = this.createGroup(t('hudChrome.meters.groupCombat'));

    // Max Visible Rows
    const unitText =
      s.maxVisibleRows === 0 ? t('hudChrome.meters.autoRows') : t('hudChrome.meters.barsUnit');
    group.appendChild(
      this.createSliderRow(
        t('hudChrome.meters.maxRows'),
        t('hudChrome.meters.maxRowsDesc'),
        0,
        15,
        1,
        s.maxVisibleRows,
        unitText,
        (val) => {
          this.update({ maxVisibleRows: val });
        },
      ),
    );

    // Include Shields in Heal
    group.appendChild(
      this.createToggleRow(
        t('hudChrome.meters.includeShields'),
        t('hudChrome.meters.includeShieldsDesc'),
        s.includeShieldsInHeal,
        (checked) => {
          this.update({ includeShieldsInHeal: checked });
        },
      ),
    );

    this.contentEl!.appendChild(group);
  }

  // --- TAB 6: Temas y Perfiles (Presets) ---
  private renderPresetsTab(): void {
    const group = this.createGroup(t('hudChrome.meters.groupPresets'));
    const container = document.createElement('div');
    container.className = 'mt-opts-presets-grid';

    const presetsList: {
      id: Exclude<MeterThemePreset, 'custom'>;
      name: string;
      desc: string;
      badge: string;
    }[] = [
      {
        id: 'details_glass',
        name: t('hudChrome.meters.presetDetailsName'),
        desc: t('hudChrome.meters.presetDetailsDesc'),
        badge: t('hudChrome.meters.presetDetailsBadge'),
      },
      {
        id: 'classic',
        name: t('hudChrome.meters.presetClassicName'),
        desc: t('hudChrome.meters.presetClassicDesc'),
        badge: t('hudChrome.meters.presetClassicBadge'),
      },
      {
        id: 'minimal',
        name: t('hudChrome.meters.presetMinimalName'),
        desc: t('hudChrome.meters.presetMinimalDesc'),
        badge: t('hudChrome.meters.presetMinimalBadge'),
      },
      {
        id: 'raid',
        name: t('hudChrome.meters.presetRaidName'),
        desc: t('hudChrome.meters.presetRaidDesc'),
        badge: t('hudChrome.meters.presetRaidBadge'),
      },
      {
        id: 'pro_gradient',
        name: t('hudChrome.meters.presetProGradientName'),
        desc: t('hudChrome.meters.presetProGradientDesc'),
        badge: t('hudChrome.meters.presetProGradientBadge'),
      },
    ];

    for (const p of presetsList) {
      const card = document.createElement('div');
      card.className = `mt-opts-preset-card${this.s.themePreset === p.id ? ' active' : ''}`;
      card.innerHTML = `
        <div class="mt-opts-preset-header">
          <span class="mt-opts-preset-name">${p.name}</span>
          <span class="mt-opts-preset-badge">${p.badge}</span>
        </div>
        <p class="mt-opts-preset-desc">${p.desc}</p>
        <button type="button" class="mt-opts-btn mt-opts-btn-apply">${t('hudChrome.meters.applyPreset')}</button>
      `;

      const applyBtn = card.querySelector('.mt-opts-btn-apply') as HTMLElement;
      applyBtn.addEventListener('click', () => {
        const patch = PRESETS[p.id];
        if (patch) {
          this.update(patch);
          this.renderActiveContent();
        }
      });

      container.appendChild(card);
    }

    group.appendChild(container);
    this.contentEl!.appendChild(group);
  }

  // --- TAB 7: Perfiles e Importar/Exportar ---
  private renderProfilesTab(): void {
    const storage = this.deps.storage;
    const profiles = loadProfiles(storage);
    const activeProfile = getActiveProfileName(storage);

    // Group 1: Perfil Activo
    const groupManage = this.createGroup(t('hudChrome.meters.groupManageProfiles'));
    const manageWrap = document.createElement('div');
    manageWrap.className = 'mt-opts-profile-section';

    const selectorRow = document.createElement('div');
    selectorRow.className = 'mt-opts-row mt-opts-profile-row';

    const selectInfo = document.createElement('div');
    selectInfo.className = 'mt-opts-row-info';
    selectInfo.innerHTML = `
      <div class="mt-opts-row-title">${t('hudChrome.meters.activeProfile')}</div>
      <div class="mt-opts-row-desc">${t('hudChrome.meters.activeProfileDesc')}</div>
    `;

    const selectCtrl = document.createElement('div');
    selectCtrl.className = 'mt-opts-profile-controls';

    const selectEl = document.createElement('select');
    selectEl.className = 'mt-opts-select';
    for (const name of Object.keys(profiles)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === activeProfile) opt.selected = true;
      selectEl.appendChild(opt);
    }

    selectEl.addEventListener('change', () => {
      const chosen = selectEl.value;
      if (profiles[chosen]) {
        setActiveProfileName(chosen, storage);
        this.deps.onSettingsChanged({ ...profiles[chosen] });
        this.renderActiveContent();
      }
    });

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'mt-opts-btn';
    newBtn.textContent = t('hudChrome.meters.saveAs');
    newBtn.addEventListener('click', () => {
      const defaultNewName = `Profile ${Object.keys(profiles).length + 1}`;
      const name =
        typeof window !== 'undefined' && window.prompt
          ? window.prompt(t('hudChrome.meters.promptNewProfile'), defaultNewName)
          : defaultNewName;
      if (name && name.trim()) {
        const trimmed = name.trim();
        profiles[trimmed] = { ...this.s };
        saveProfiles(profiles, storage);
        setActiveProfileName(trimmed, storage);
        this.renderActiveContent();
      }
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'mt-opts-btn';
    dupBtn.textContent = t('hudChrome.meters.duplicate');
    dupBtn.addEventListener('click', () => {
      const dupName = `${activeProfile}${t('hudChrome.meters.profileCopySuffix')}`;
      profiles[dupName] = { ...this.s };
      saveProfiles(profiles, storage);
      setActiveProfileName(dupName, storage);
      this.renderActiveContent();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mt-opts-btn mt-opts-btn-danger';
    delBtn.textContent = t('hudChrome.meters.deleteProfile');
    if (activeProfile === 'Default') {
      delBtn.disabled = true;
      delBtn.title = t('hudChrome.meters.cannotDeleteDefault');
    }
    delBtn.addEventListener('click', () => {
      if (activeProfile === 'Default') return;
      delete profiles[activeProfile];
      saveProfiles(profiles, storage);
      setActiveProfileName('Default', storage);
      if (profiles.Default) {
        this.deps.onSettingsChanged({ ...profiles.Default });
      }
      this.renderActiveContent();
    });

    selectCtrl.appendChild(selectEl);
    selectCtrl.appendChild(newBtn);
    selectCtrl.appendChild(dupBtn);
    selectCtrl.appendChild(delBtn);

    selectorRow.appendChild(selectInfo);
    selectorRow.appendChild(selectCtrl);
    manageWrap.appendChild(selectorRow);
    groupManage.appendChild(manageWrap);
    this.contentEl!.appendChild(groupManage);

    // Group 2: Exportar Perfil Actual
    const groupExport = this.createGroup(t('hudChrome.meters.groupExport'));
    const exportWrap = document.createElement('div');
    exportWrap.className = 'mt-opts-profile-section';

    const exportDesc = document.createElement('div');
    exportDesc.className = 'mt-opts-row-desc';
    exportDesc.textContent = t('hudChrome.meters.exportDesc');

    const exportTextarea = document.createElement('textarea');
    exportTextarea.className = 'mt-opts-textarea';
    exportTextarea.readOnly = true;
    exportTextarea.value = exportProfileString(this.s);

    const exportActions = document.createElement('div');
    exportActions.className = 'mt-opts-profile-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'mt-opts-btn mt-opts-btn-primary';
    copyBtn.textContent = t('hudChrome.meters.copyString');

    const copyFeedback = document.createElement('span');
    copyFeedback.className = 'mt-opts-feedback';
    copyFeedback.style.display = 'none';

    copyBtn.addEventListener('click', () => {
      const text = exportTextarea.value;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      exportTextarea.select();
      copyFeedback.textContent = t('hudChrome.meters.copiedFeedback');
      copyFeedback.style.display = 'inline-block';
      setTimeout(() => {
        copyFeedback.style.display = 'none';
      }, 2500);
    });

    exportActions.appendChild(copyBtn);
    exportActions.appendChild(copyFeedback);

    exportWrap.appendChild(exportDesc);
    exportWrap.appendChild(exportTextarea);
    exportWrap.appendChild(exportActions);
    groupExport.appendChild(exportWrap);
    this.contentEl!.appendChild(groupExport);

    // Group 3: Importar Perfil
    const groupImport = this.createGroup(t('hudChrome.meters.groupImport'));
    const importWrap = document.createElement('div');
    importWrap.className = 'mt-opts-profile-section';

    const importDesc = document.createElement('div');
    importDesc.className = 'mt-opts-row-desc';
    importDesc.textContent = t('hudChrome.meters.importDesc');

    const importTextarea = document.createElement('textarea');
    importTextarea.className = 'mt-opts-textarea mt-opts-import-input';
    importTextarea.placeholder = t('hudChrome.meters.importPlaceholder');

    const importRow = document.createElement('div');
    importRow.className = 'mt-opts-profile-actions';

    const importNameInput = document.createElement('input');
    importNameInput.type = 'text';
    importNameInput.className = 'mt-opts-text-input';
    importNameInput.placeholder = t('hudChrome.meters.importNamePlaceholder');

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'mt-opts-btn mt-opts-btn-primary mt-opts-btn-import';
    importBtn.textContent = t('hudChrome.meters.importApply');

    const importFeedback = document.createElement('span');
    importFeedback.className = 'mt-opts-feedback';
    importFeedback.style.display = 'none';

    importBtn.addEventListener('click', () => {
      const raw = importTextarea.value.trim();
      if (!raw) {
        importFeedback.textContent = t('hudChrome.meters.errEmptyProfile');
        importFeedback.className = 'mt-opts-feedback mt-opts-feedback-err';
        importFeedback.style.display = 'inline-block';
        return;
      }
      const imported = importProfileString(raw);
      if (!imported) {
        importFeedback.textContent = t('hudChrome.meters.errInvalidProfile');
        importFeedback.className = 'mt-opts-feedback mt-opts-feedback-err';
        importFeedback.style.display = 'inline-block';
        return;
      }

      this.update(imported);

      const targetName =
        importNameInput.value.trim() ||
        `Imported (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      profiles[targetName] = { ...imported };
      saveProfiles(profiles, storage);
      setActiveProfileName(targetName, storage);

      importFeedback.textContent = t('hudChrome.meters.importSuccess', { name: targetName });
      importFeedback.className = 'mt-opts-feedback mt-opts-feedback-ok';
      importFeedback.style.display = 'inline-block';

      setTimeout(() => {
        this.renderActiveContent();
      }, 1000);
    });

    importRow.appendChild(importNameInput);
    importRow.appendChild(importBtn);
    importRow.appendChild(importFeedback);

    importWrap.appendChild(importDesc);
    importWrap.appendChild(importTextarea);
    importWrap.appendChild(importRow);
    groupImport.appendChild(importWrap);
    this.contentEl!.appendChild(groupImport);
  }

  // --- UI Component Builders ---

  private createGroup(title: string): HTMLElement {
    const g = document.createElement('div');
    g.className = 'mt-opts-group';
    const h = document.createElement('h3');
    h.className = 'mt-opts-group-title';
    h.textContent = title;
    g.appendChild(h);
    return g;
  }

  private createToggleRow(
    title: string,
    desc: string,
    checked: boolean,
    onChange: (val: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mt-opts-row';

    const info = document.createElement('div');
    info.className = 'mt-opts-row-info';
    info.innerHTML = `
      <div class="mt-opts-row-title">${title}</div>
      <div class="mt-opts-row-desc">${desc}</div>
    `;

    const label = document.createElement('label');
    label.className = 'mt-opts-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      onChange(input.checked);
    });

    const slider = document.createElement('span');
    slider.className = 'mt-opts-switch-slider';

    label.appendChild(input);
    label.appendChild(slider);

    row.appendChild(info);
    row.appendChild(label);
    return row;
  }

  private createSliderRow(
    title: string,
    desc: string,
    min: number,
    max: number,
    step: number,
    value: number,
    unit: string,
    onChange: (val: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mt-opts-row';

    const info = document.createElement('div');
    info.className = 'mt-opts-row-info';
    info.innerHTML = `
      <div class="mt-opts-row-title">${title}</div>
      <div class="mt-opts-row-desc">${desc}</div>
    `;

    const ctrl = document.createElement('div');
    ctrl.className = 'mt-opts-slider-wrap';

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'mt-opts-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const valBadge = document.createElement('span');
    valBadge.className = 'mt-opts-slider-val';
    valBadge.textContent = `${value}${unit}`;

    input.addEventListener('input', () => {
      const v = Number(input.value);
      valBadge.textContent = `${v}${unit}`;
      onChange(v);
    });

    ctrl.appendChild(input);
    ctrl.appendChild(valBadge);

    row.appendChild(info);
    row.appendChild(ctrl);
    return row;
  }

  private createRadioRow(
    title: string,
    desc: string,
    options: { id: string; label: string; desc?: string }[],
    selectedValue: string,
    onChange: (val: string) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mt-opts-row mt-opts-row-block';

    const info = document.createElement('div');
    info.className = 'mt-opts-row-info';
    info.innerHTML = `
      <div class="mt-opts-row-title">${title}</div>
      <div class="mt-opts-row-desc">${desc}</div>
    `;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'mt-opts-btn-group';

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = opt.id;
      btn.className = `mt-opts-choice-btn${selectedValue === opt.id ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="mt-opts-choice-title">${opt.label}</span>
        ${opt.desc ? `<span class="mt-opts-choice-desc">${opt.desc}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        for (const b of btnGroup.querySelectorAll('.mt-opts-choice-btn')) {
          b.classList.remove('active');
        }
        btn.classList.add('active');
        onChange(opt.id);
      });
      btnGroup.appendChild(btn);
    }

    row.appendChild(info);
    row.appendChild(btnGroup);
    return row;
  }
}
