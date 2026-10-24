// Live runtime for the Spell & VFX Review Lab (`?spells=on`, or `Alt+Shift+S`
// in dev builds).
//
// Connects the pure spell catalog (`spell_lab_catalog_core.ts`) and floating UI
// panel (`spell_lab_panel.ts`) to `window.__game`, enabling:
// - Live class switching across all 9 classes on the player entity
// - Live Male / Female WOC body-fit switching
// - Live weapon-loadout switching (1H+Shield, 2H, Dual, Staff, Wand, Ranged)
// - Automatic practice target dummy staging at each spell's optimal distance
// - Full end-to-end execution of every spell's WOC animation + VFX combination
// - Slow-motion mixer playback (`1x`, `0.5x`, `0.25x`) and automated spec sequence playback

import { ABILITIES, CLASSES } from '../../sim/content/classes';
import type { AbilityDef, Entity, PlayerClass } from '../../sim/types';
import { DEFAULT_LOOK } from '../characters/modular';
import {
  buildClassSpellCatalog,
  type ClassSpellCatalog,
  filterSpellCatalogEntries,
  optimalDummyDistanceForSpell,
  type SpellLabEntry,
  type SpellLabFilterTab,
  type SpellLabLoadoutPresetId,
} from './spell_lab_catalog_core';
import { spellLabAutoOpen } from './spell_lab_flag';
import {
  mountSpellLabPanel,
  type SpellLabLiveTelemetry,
  type SpellLabPanel,
} from './spell_lab_panel';

interface LabVisualHandle {
  activeClipName?: string | null;
  isMidOneShot?: boolean;
  loadout?: string | null;
  mixer?: { timeScale: number };
  playAttack(abilityId?: string, gestureOnly?: boolean, kind?: 'melee' | 'wand'): number;
  playHit(): void;
  setCombat(inCombat: boolean): void;
}

interface LabViewHandle {
  visual: LabVisualHandle | null;
  formVisual?: LabVisualHandle | null;
}

interface LabRendererHandle {
  views?: Map<number, LabViewHandle>;
  triggerAttack(
    entityId: number,
    abilityId?: string,
    gestureOnly?: boolean,
    kind?: 'melee' | 'wand',
  ): number;
  triggerHit(entityId: number): void;
  handleEvent(ev: Record<string, unknown>): void;
  abilityVfxAttackCount(): number;
}

interface LabPlayerMeta {
  known: unknown[];
  talentMods?: {
    spec: string | null;
    grants: { ability: string; rank?: number }[];
  };
}

interface LabSimHandle {
  time: number;
  playerId: number;
  player: Entity;
  entities: Map<number, Entity>;
  players?: Map<number, LabPlayerMeta>;
  targetEntity(id: number | null): void;
  castAbility(abilityId: string, pid?: number, aim?: { x: number; z: number }): void;
  refreshKnownAbilities?(meta: LabPlayerMeta, notify?: boolean): void;
}

interface GameDebugHandle {
  sim?: LabSimHandle;
  world?: LabSimHandle;
  renderer?: LabRendererHandle;
  abilityVfxStats?: () => Record<string, { claimed: number; primitives: number }>;
  abilityVfxProbe?: {
    specs: Record<string, { a: string }>;
    abilities: Record<string, AbilityDef>;
  };
}

// The staged dummy's health floor: enough to soak a whole spec sequence without dying,
// and below the storage price guard's distinctive-literal range.
const DUMMY_MIN_HP = 90_000;

export interface SpellLabApi {
  open(): void;
  close(): void;
  toggle(): void;
  selectClass(cls: PlayerClass): void;
  selectTab(tab: SpellLabFilterTab): void;
  selectLoadout(presetId: SpellLabLoadoutPresetId): void;
  selectBodyFit(fit: 'male' | 'female'): void;
  playSpell(id: string): void;
}

function game(): GameDebugHandle | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __game?: GameDebugHandle }).__game ?? null;
}

function activeSim(): LabSimHandle | null {
  const g = game();
  return g?.sim ?? g?.world ?? null;
}

class SpellLabRuntime implements SpellLabApi {
  private panel: SpellLabPanel | null = null;
  private cls: PlayerClass = 'warrior';
  private loadoutPresetId: SpellLabLoadoutPresetId = 'default';
  private bodyFit: 'male' | 'female' = 'male';
  private activeTab: SpellLabFilterTab = 'all';
  private specExclusiveOnly = false;
  private hidePassives = true;
  private query = '';
  private selectedId: string | null = null;
  private timeScale = 1;
  private autoPlaying = false;
  private nextAutoPlayAt = 0;
  private status = 'Ready';
  private lastPlayedMode: 'sim' | 'direct' | 'idle' = 'idle';
  private dummyId: number | null = null;
  private dummyDistanceYd = 3.5;
  private catalog: ClassSpellCatalog = buildClassSpellCatalog('warrior', 'default');
  private syncedInitialPlayer = false;

  start(): void {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    const tick = (now: number): void => {
      this.onFrame(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  open(): void {
    this.ensurePanel();
    this.panel?.setVisible(true);
    this.syncFromLivePlayerOnce();
    this.stageDummy(this.dummyDistanceYd);
    this.renderPanel();
  }

  close(): void {
    this.autoPlaying = false;
    this.restoreTimeScale();
    this.panel?.setVisible(false);
  }

  toggle(): void {
    if (this.panel?.isVisible()) {
      this.close();
    } else {
      this.open();
    }
  }

  selectClass(cls: PlayerClass): void {
    this.cls = cls;
    this.activeTab = 'all';
    this.catalog = buildClassSpellCatalog(this.cls, this.loadoutPresetId);
    const filtered = this.filteredEntries();
    this.selectedId = filtered[0]?.id ?? null;
    this.applyCharacterStateToLivePlayer();
    this.status = `Switched to ${this.catalog.className}`;
    this.renderPanel();
  }

  selectTab(tab: SpellLabFilterTab): void {
    this.activeTab = tab;
    const filtered = this.filteredEntries();
    if (!filtered.some((e) => e.id === this.selectedId)) {
      this.selectedId = filtered[0]?.id ?? null;
    }
    this.renderPanel();
  }

  selectLoadout(presetId: SpellLabLoadoutPresetId): void {
    this.loadoutPresetId = presetId;
    this.catalog = buildClassSpellCatalog(this.cls, this.loadoutPresetId);
    this.applyCharacterStateToLivePlayer();
    this.status = `Loadout: ${presetId}`;
    this.renderPanel();
  }

  selectBodyFit(fit: 'male' | 'female'): void {
    this.bodyFit = fit;
    this.applyCharacterStateToLivePlayer();
    this.status = `Body fit: ${fit}`;
    this.renderPanel();
  }

  playSpell(id: string): void {
    const entry = this.catalog.entries.find((e) => e.id === id);
    if (!entry) return;
    this.selectedId = entry.id;
    this.executeEntry(entry);
    this.renderPanel();
  }

  private ensurePanel(): void {
    if (this.panel) return;
    this.panel = mountSpellLabPanel({
      onSelectClass: (cls) => this.selectClass(cls),
      onSelectTab: (tab) => this.selectTab(tab),
      onToggleSpecExclusive: (ex) => {
        this.specExclusiveOnly = ex;
        this.renderPanel();
      },
      onToggleHidePassives: (hide) => {
        this.hidePassives = hide;
        this.renderPanel();
      },
      onSearch: (q) => {
        this.query = q;
        this.renderPanel();
      },
      onSelectLoadout: (presetId) => this.selectLoadout(presetId),
      onSelectBodyFit: (fit) => this.selectBodyFit(fit),
      onSelectTimeScale: (scale) => {
        this.timeScale = scale;
        this.applyTimeScaleToVisual();
        this.status = `Speed: ${scale}x`;
        this.renderPanel();
      },
      onPlayEntry: (id) => {
        this.autoPlaying = false;
        this.playSpell(id);
      },
      onStep: (delta) => {
        this.autoPlaying = false;
        this.stepSelection(delta);
      },
      onReplay: () => {
        if (this.selectedId) this.playSpell(this.selectedId);
      },
      onToggleAutoPlay: () => {
        this.autoPlaying = !this.autoPlaying;
        if (this.autoPlaying) {
          this.nextAutoPlayAt = performance.now();
          this.status = 'Auto-playing sequence...';
        } else {
          this.status = 'Stopped sequence';
        }
        this.renderPanel();
      },
      onFrameCamera: () => {
        const current = this.catalog.entries.find((e) => e.id === this.selectedId);
        const dist = current ? optimalDummyDistanceForSpell(current) : 4;
        this.stageDummy(dist);
        this.status = `Dummy staged at ${dist.toFixed(1)}yd`;
        this.renderPanel();
      },
      onClose: () => this.close(),
    });
  }

  private syncFromLivePlayerOnce(): void {
    if (this.syncedInitialPlayer) return;
    const sim = activeSim();
    const p = sim?.player;
    if (!p) return;
    this.syncedInitialPlayer = true;
    const liveCls = p.templateId as PlayerClass;
    if (liveCls && CLASSES[liveCls]) {
      this.cls = liveCls;
    }
    this.bodyFit = p.modularAppearance?.bodyType === 'female' ? 'female' : 'male';
    this.catalog = buildClassSpellCatalog(this.cls, this.loadoutPresetId);
    this.selectedId = this.filteredEntries()[0]?.id ?? null;
  }

  private filteredEntries(): SpellLabEntry[] {
    return filterSpellCatalogEntries(this.catalog.entries, {
      tab: this.activeTab,
      specExclusiveOnly: this.specExclusiveOnly,
      hidePassives: this.hidePassives,
      query: this.query,
    });
  }

  private stepSelection(delta: -1 | 1): void {
    const list = this.filteredEntries();
    if (list.length === 0) return;
    const idx = list.findIndex((e) => e.id === this.selectedId);
    const nextIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
    this.playSpell(list[nextIdx].id);
  }

  private applyCharacterStateToLivePlayer(): void {
    const sim = activeSim();
    const p = sim?.player;
    if (!sim || !p) return;

    const cdef = CLASSES[this.cls];
    p.templateId = this.cls;
    p.resourceType = cdef.resourceType;
    p.weaponStowed = false;

    // Clear action-locking forms when switching class/rig so the WOC body is visible.
    p.auras = p.auras.filter(
      (a) =>
        a.kind !== 'form_bear' &&
        a.kind !== 'form_cat' &&
        a.kind !== 'form_travel' &&
        a.kind !== 'form_lich' &&
        a.kind !== 'affliction_possession',
    );

    const baseApp = p.modularAppearance ?? { ...DEFAULT_LOOK };
    p.modularAppearance = {
      ...baseApp,
      bodyType: this.bodyFit,
    };

    p.mainhandItemId = this.catalog.mainhandItemId;
    p.offhandItemId = this.catalog.offhandItemId;

    if (p.equippedItems) {
      p.equippedItems.mainhand = this.catalog.mainhandItemId ?? undefined;
      p.equippedItems.offhand = this.catalog.offhandItemId ?? undefined;
    }
  }

  private stageDummy(distanceYd: number): Entity | null {
    const sim = activeSim();
    const p = sim?.player;
    if (!sim || !p) return null;

    this.dummyDistanceYd = distanceYd;

    let dummy: Entity | null =
      this.dummyId !== null ? (sim.entities.get(this.dummyId) ?? null) : null;
    if (!dummy || dummy.dead || dummy.kind !== 'mob') {
      let bestDist = Number.POSITIVE_INFINITY;
      for (const e of sim.entities.values()) {
        if (e.kind === 'mob' && !e.dead && e.ownerId === null && e.hostile !== false) {
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (d < bestDist) {
            bestDist = d;
            dummy = e;
          }
        }
      }
    }

    if (!dummy) return null;
    this.dummyId = dummy.id;

    const yaw = p.facing ?? 0;
    const targetX = p.pos.x + Math.sin(yaw) * distanceYd;
    const targetZ = p.pos.z + Math.cos(yaw) * distanceYd;
    dummy.pos.x = targetX;
    dummy.pos.z = targetZ;
    dummy.pos.y = p.pos.y;
    dummy.facing = yaw + Math.PI;
    dummy.maxHp = Math.max(dummy.maxHp, DUMMY_MIN_HP);
    dummy.hp = dummy.maxHp;
    dummy.dead = false;
    dummy.inCombat = false;
    dummy.castingAbility = null;
    dummy.castRemaining = 0;

    sim.targetEntity(dummy.id);
    return dummy;
  }

  private executeEntry(entry: SpellLabEntry): void {
    const g = game();
    const sim = activeSim();
    const renderer = g?.renderer;
    const p = sim?.player;
    if (!sim || !renderer || !p) {
      this.status = 'Waiting for live world...';
      return;
    }

    this.applyCharacterStateToLivePlayer();
    const dist = optimalDummyDistanceForSpell(entry);
    const dummy = this.stageDummy(dist);
    const targetId = dummy ? dummy.id : p.id;
    const vis = this.playerVisual(renderer, p.id);
    vis?.setCombat(true);
    this.applyTimeScaleToVisual();

    // 1. Basic combat actions
    if (entry.kind === 'basic') {
      if (entry.id === '__auto_melee') {
        renderer.triggerAttack(p.id, undefined, false, 'melee');
        if (dummy) renderer.triggerHit(dummy.id);
      } else if (entry.id === '__auto_ranged') {
        renderer.handleEvent({
          type: 'spellfx',
          sourceId: p.id,
          targetId,
          school: 'physical',
          fx: 'projectile',
          attackAnimation: 'ranged-shot',
        });
      } else if (entry.id === '__auto_wand') {
        renderer.handleEvent({
          type: 'spellfx',
          sourceId: p.id,
          targetId,
          school: entry.school,
          fx: 'projectile',
          wand: true,
        });
      } else if (entry.id === '__pose_hit') {
        renderer.triggerHit(p.id);
      } else if (entry.id === '__pose_combat_idle') {
        vis?.setCombat(true);
      }
      this.lastPlayedMode = 'direct';
      this.status = `Played ${entry.name} (${entry.resolvedClip})`;
      return;
    }

    // 2. Class / Spec / Talent Abilities
    const def = ABILITIES[entry.id];
    if (!def) return;

    // Pre-stage player level, spec, known abilities, resources, cooldowns, and required auras.
    p.level = 40;
    p.dead = false;
    p.maxHp = Math.max(p.maxHp, 50000);
    p.hp = p.maxHp;
    p.maxResource = Math.max(p.maxResource, 50000);
    p.resource = p.maxResource;
    p.savedMana = 50000;
    p.comboPoints = 5;
    p.overpowerUntil = sim.time + 15;
    p.gcdRemaining = 0;
    p.castingAbility = null;
    p.castRemaining = 0;
    p.channeling = false;
    p.cooldowns.clear();

    if (entry.requiresShield && p.equippedItems) {
      p.offhandItemId = 'eastbrook_buckler';
      p.equippedItems.offhand = 'eastbrook_buckler';
    }

    if (entry.requiresForm === 'cat') {
      if (!p.auras.some((a) => a.kind === 'form_cat')) {
        p.auras.push({
          id: 'cat_form',
          name: 'Cat Form',
          kind: 'form_cat',
          school: 'nature',
          remaining: 600,
          duration: 600,
          value: 1,
          sourceId: p.id,
        });
      }
    } else if (entry.requiresForm === 'bear') {
      if (!p.auras.some((a) => a.kind === 'form_bear')) {
        p.auras.push({
          id: 'bear_form',
          name: 'Bruin Form',
          kind: 'form_bear',
          school: 'nature',
          remaining: 600,
          duration: 600,
          value: 1,
          sourceId: p.id,
        });
      }
    }

    if (entry.requiresStealth) {
      p.inCombat = false;
      if (!p.auras.some((a) => a.kind === 'stealth')) {
        p.auras.push({
          id: 'stealth',
          name: 'Stealth',
          kind: 'stealth',
          school: 'physical',
          remaining: 60,
          duration: 60,
          value: 1,
          sourceId: p.id,
        });
      }
    }

    if (def.requiresAuraKind) {
      const existing = p.auras.find((a) => a.kind === def.requiresAuraKind);
      if (existing) {
        existing.remaining = 30;
        existing.stacks = Math.max(existing.stacks ?? 1, def.requiresAuraStacks ?? 5);
      } else {
        p.auras.push({
          id: `lab_${def.requiresAuraKind}`,
          name: def.requiresAuraKind,
          kind: def.requiresAuraKind,
          school: def.school,
          remaining: 30,
          duration: 30,
          value: 1,
          stacks: def.requiresAuraStacks ?? 5,
          sourceId: p.id,
        });
      }
    }

    if (dummy) {
      dummy.hp = entry.requiresExecute ? Math.max(1, Math.floor(dummy.maxHp * 0.1)) : dummy.maxHp;
    }

    // Ensure the player knows the ability in the live Sim.
    const meta = sim.players?.get?.(p.id);
    if (meta?.talentMods) {
      if (entry.specIds.length > 0) {
        meta.talentMods.spec = entry.specIds[0];
      }
      if (!meta.talentMods.grants.some((gr) => gr.ability === entry.id)) {
        meta.talentMods.grants.push({ ability: entry.id, rank: 1 });
      }
      sim.refreshKnownAbilities?.(meta, false);
    }

    if (def.targetType === 'friendly') {
      sim.targetEntity(p.id);
    } else if (dummy) {
      sim.targetEntity(dummy.id);
    }

    const aimedPos =
      def.targetMode === 'position'
        ? def.selfCentered
          ? { x: p.pos.x, z: p.pos.z }
          : { x: dummy?.pos.x ?? p.pos.x, z: dummy?.pos.z ?? p.pos.z }
        : undefined;

    const attacksBefore = renderer.abilityVfxAttackCount();
    const vfxBefore = g?.abilityVfxStats?.()[entry.id]?.claimed ?? 0;

    if (!def.passive) {
      sim.castAbility(entry.id, p.id, aimedPos);
    }

    const castStarted = p.castingAbility === entry.id || p.channeling;
    const attackFired = renderer.abilityVfxAttackCount() > attacksBefore;
    const vfxClaimed = (g?.abilityVfxStats?.()[entry.id]?.claimed ?? 0) > vfxBefore;

    if (castStarted || attackFired || vfxClaimed) {
      // Ensure instant self-buffs/toggles that succeeded in the sim also play their WOC gesture clip.
      if (!castStarted && !attackFired) {
        renderer.triggerAttack(p.id, entry.id, true);
      }
      this.lastPlayedMode = 'sim';
      this.status = `Cast ${entry.name} -> ${entry.resolvedClip}`;
      return;
    }

    // 3. Direct presentation fallback (for passives, proc-only transforms, or unmet encounter state):
    // Always triggers both the WOC ability animation and the registered spellfx pipeline.
    renderer.triggerAttack(p.id, entry.id, true);
    const fallbackFx =
      def.projectileFx ??
      def.castFx ??
      (def.castTime > 0
        ? 'projectile'
        : entry.vfxArchetype === 'nova' || entry.vfxArchetype === 'shout'
          ? 'nova'
          : 'tick');
    const selfCentered =
      fallbackFx === 'nova' || !def.requiresTarget || def.targetType === 'friendly';
    renderer.handleEvent({
      type: 'spellfx',
      sourceId: p.id,
      targetId: selfCentered ? p.id : targetId,
      school: def.school,
      fx: fallbackFx,
      ability: entry.id,
      x: (selfCentered ? p : (dummy ?? p)).pos.x,
      z: (selfCentered ? p : (dummy ?? p)).pos.z,
      radius: 6,
      duration: def.channel?.duration ?? 2,
    });
    this.lastPlayedMode = 'direct';
    this.status = `Previewed ${entry.name} -> ${entry.resolvedClip}`;
  }

  private playerVisual(renderer: LabRendererHandle, playerId: number): LabVisualHandle | null {
    const v = renderer.views?.get(playerId);
    if (!v) return null;
    return v.formVisual ?? v.visual ?? null;
  }

  private applyTimeScaleToVisual(): void {
    const sim = activeSim();
    const renderer = game()?.renderer;
    if (!sim || !renderer) return;
    const vis = this.playerVisual(renderer, sim.playerId);
    if (vis?.mixer) {
      vis.mixer.timeScale = this.timeScale;
    }
  }

  private restoreTimeScale(): void {
    this.timeScale = 1;
    this.applyTimeScaleToVisual();
  }

  private collectTelemetry(): SpellLabLiveTelemetry {
    const sim = activeSim();
    const renderer = game()?.renderer;
    const p = sim?.player;
    const vis = sim && renderer ? this.playerVisual(renderer, sim.playerId) : null;
    const dummy = sim && this.dummyId !== null ? (sim.entities.get(this.dummyId) ?? null) : null;
    const dist =
      p && dummy ? Math.hypot(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z).toFixed(1) : '--';
    return {
      activeClip: vis?.activeClipName ?? 'idle',
      isMidOneShot: Boolean(vis?.isMidOneShot),
      loadout: vis?.loadout ?? this.catalog.resolvedLoadout ?? 'default',
      bodyFit: this.bodyFit,
      dummyDistanceYd: dist,
      lastPlayedMode: this.lastPlayedMode,
    };
  }

  private onFrame(now: number): void {
    const sim = activeSim();
    if (!sim?.player) return;

    if (!this.panel && spellLabAutoOpen()) {
      this.open();
    }

    if (!this.panel?.isVisible()) return;

    this.syncFromLivePlayerOnce();
    this.applyTimeScaleToVisual();

    // Keep player and staged dummy healthy while the review lab is open.
    sim.player.hp = sim.player.maxHp;
    if (this.dummyId !== null) {
      const dummy = sim.entities.get(this.dummyId);
      if (dummy && !dummy.dead) {
        dummy.inCombat = false;
        dummy.castingAbility = null;
      }
    }

    if (this.autoPlaying && now >= this.nextAutoPlayAt) {
      const list = this.filteredEntries();
      if (list.length === 0) {
        this.autoPlaying = false;
      } else {
        const idx = list.findIndex((e) => e.id === this.selectedId);
        const nextIdx = (idx + 1) % list.length;
        const entry = list[nextIdx];
        this.selectedId = entry.id;
        this.executeEntry(entry);
        const waitSec =
          Math.max(1.8, (entry.castTime || entry.channelDuration || 1.2) + 1.1) /
          Math.max(0.25, this.timeScale);
        this.nextAutoPlayAt = now + waitSec * 1000;
        this.status = `Auto (${nextIdx + 1}/${list.length}): ${entry.name}`;
        this.renderPanel();
      }
    } else {
      this.panel.updateTelemetry(this.collectTelemetry());
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.altKey && e.shiftKey && e.code === 'KeyS') {
      e.preventDefault();
      this.toggle();
      return;
    }
    if (!this.panel?.isVisible()) return;

    if (e.altKey && e.code === 'BracketLeft') {
      e.preventDefault();
      this.autoPlaying = false;
      this.stepSelection(-1);
    } else if (e.altKey && e.code === 'BracketRight') {
      e.preventDefault();
      this.autoPlaying = false;
      this.stepSelection(1);
    } else if (e.altKey && e.code === 'KeyR') {
      e.preventDefault();
      if (this.selectedId) this.playSpell(this.selectedId);
    }
  }

  private renderPanel(): void {
    if (!this.panel) return;
    this.panel.render({
      catalog: this.catalog,
      filteredEntries: this.filteredEntries(),
      activeTab: this.activeTab,
      specExclusiveOnly: this.specExclusiveOnly,
      hidePassives: this.hidePassives,
      query: this.query,
      selectedId: this.selectedId,
      bodyFit: this.bodyFit,
      timeScale: this.timeScale,
      autoPlaying: this.autoPlaying,
      status: this.status,
      telemetry: this.collectTelemetry(),
    });
  }
}

let started: SpellLabRuntime | null = null;

/** Start the Spell & VFX Review Lab runtime once (idempotent) and expose `window.__spellLab`. */
export function startSpellLab(): SpellLabApi {
  if (!started) {
    started = new SpellLabRuntime();
    started.start();
    (window as unknown as { __spellLab?: SpellLabApi }).__spellLab = started;
  }
  return started;
}
