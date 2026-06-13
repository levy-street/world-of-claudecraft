import { formatMoney, ResolvedAbility } from '../sim/sim';
import type { IWorld } from '../world_api';
import { Renderer } from '../render/renderer';
import {
  ABILITIES, CLASSES, DUNGEON_LIST, DUNGEON_X_THRESHOLD, ITEMS, MOBS, NPCS, QUESTS,
  WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES, dungeonAt, zoneAt,
} from '../sim/data';
import type { ZoneDef } from '../sim/data';
import type { InvSlot } from '../sim/types';
import { AbilityEffect, CONSUME_DURATION, Entity, GCD, ItemDef, SimEvent, dist2d, xpForLevel, MAX_LEVEL, MELEE_RANGE } from '../sim/types';
import { terrainHeight, WATER_LEVEL, roadDistance } from '../sim/world';
import { Meters } from './meters';
import { audio } from '../game/audio';
import { music } from '../game/music';
import { iconDataUrl, QUALITY_COLOR } from './icons';
import { Keybinds, BIND_ACTIONS, BIND_CATEGORIES, isReservedCode, keyLabel } from '../game/keybinds';
import { Settings, GameSettings, SETTING_RANGES } from '../game/settings';

// hooks main wires after Input exists (the options menu drives input, audio,
// graphics, and logout, all of which live outside the HUD)
export interface OptionsHooks {
  logout(): void;
  captureKey(cb: (code: string | null) => void): void;
  settings: Settings;
  onSettingChange(key: keyof GameSettings, value: number): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const FAMILY_GLYPH: Record<string, string> = {
  beast: '🐾', humanoid: '🗡️', murloc: '🐟', spider: '🕷️', kobold: '⛏️', undead: '💀',
  troll: '🦴', ogre: '👊', elemental: '🌀', dragonkin: '🐉',
};
const CLASS_GLYPH: Record<string, string> = {
  warrior: '⚔️', paladin: '🔨', hunter: '🏹', rogue: '🗡️', priest: '✝️',
  shaman: '🌩️', mage: '🔮', warlock: '🕯️', druid: '🐻',
};

// yards past a zone boundary before the crossing banner/welcome commits
const ZONE_BANNER_DEADBAND = 5;
const IGNORED_CHAT_NAMES_KEY = 'woc_ignored_chat_names';

export class Hud {
  private static readonly BAR_ABILITY_SLOTS = 11; // bar slots 1..11; slot 0 is the fixed Attack toggle
  private abilityButtons: { btn: HTMLButtonElement; label: HTMLSpanElement; keybindEl: HTMLSpanElement; cdOverlay: HTMLDivElement; cdText: HTMLDivElement; lastIcon: string }[] = [];
  private slotMap: (string | null)[] = []; // index = barSlot-1, value = ability id
  private dragFromSlot: number | null = null;
  private optionsHooks: OptionsHooks | null = null;
  private optionsView: 'main' | 'keybinds' | 'graphics' | 'audio' = 'main';
  private capturingKey: { action: string; index: number } | null = null; // binding awaiting a key
  private keybindNote = '';
  private chatLogEl = $('#chatlog');
  private combatLogEl = $('#combatlog');
  private errorEl = $('#error-msg');
  private bannerEl = $('#banner');
  private tooltipEl = $('#tooltip');
  private errorTimer: number | undefined;
  private bannerTimer: number | undefined;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapBg: HTMLCanvasElement;
  private mapBg: HTMLCanvasElement | null = null;
  private openLootMobId: number | null = null;
  private openVendorNpcId: number | null = null;
  private openGossipNpcId: number | null = null;
  private selectedQuestLogId: string | null = null;
  private lastPortraitTarget = -999;
  // trading: locally staged offer, pushed to the server on change
  private stagedTrade: { items: InvSlot[]; copper: number } = { items: [], copper: 0 };
  private tradeWasOpen = false;
  private lastTradeSig = '';
  private lastPartySig = '';
  private lastCombatEventAt = 0;
  private lastZoneId = '';
  private mapZoneId = ''; // zone the cached map-window canvas was rendered for
  private ignoredChatNames = new Set<string>();

  private meters: Meters;

  constructor(private sim: IWorld, private renderer: Renderer, private keybinds: Keybinds) {
    this.ignoredChatNames = this.loadIgnoredChatNames();
    this.meters = new Meters(sim);
    this.bindLogTabs();
    this.loadSlotMap();
    this.buildActionBar();
    this.refreshKeybindLabels();
    this.buildXpTicks();
    $('#pf-name').textContent = sim.player.name;
    this.drawPortrait($('#pf-portrait') as unknown as HTMLCanvasElement, CLASS_GLYPH[sim.cfg.playerClass], CLASSES[sim.cfg.playerClass].color);
    const mm = $('#minimap') as unknown as HTMLCanvasElement;
    this.minimapCtx = mm.getContext('2d')!;
    this.minimapBg = this.renderTerrainCanvas(140, { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z });
    $('#release-btn').addEventListener('click', () => { this.sim.releaseSpirit(); });
    // classic WoW: the player interaction menu opens from the target portrait
    $('#target-frame').addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const tid = this.sim.player.targetId;
      const t = tid !== null ? this.sim.entities.get(tid) : null;
      if (t && t.kind === 'player' && t.id !== this.sim.playerId) {
        this.openContextMenu(t.id, t.name, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      }
    });
    $('#mm-char').addEventListener('click', () => this.toggleChar());
    $('#mm-spell').addEventListener('click', () => this.toggleSpellbook());
    $('#mm-quest').addEventListener('click', () => this.toggleQuestLog());
    $('#mm-map').addEventListener('click', () => this.toggleMap());
    $('#mm-bag').addEventListener('click', () => this.toggleBags());
    const musicBtn = $('#mm-music');
    const styleMusicBtn = () => { musicBtn.style.color = music.enabled ? '#ffd100' : '#666'; };
    styleMusicBtn();
    musicBtn.addEventListener('click', () => {
      music.setEnabled(!music.enabled);
      styleMusicBtn();
    });
    const startZone = zoneAt(sim.player.pos.z);
    this.lastZoneId = startZone.id;
    this.showBanner(startZone.name);
    this.log(`Welcome to ${startZone.name}!`, '#ffd100');
    this.log(startZone.welcome, '#ffd100');
  }

  private bindLogTabs(): void {
    const tabs = document.querySelectorAll<HTMLButtonElement>('.chat-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.logTab;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        $('#chatlog').classList.toggle('active', which === 'chat');
        $('#combatlog').classList.toggle('active', which === 'combat');
      });
    });
  }

  // -------------------------------------------------------------------------
  // Portraits, icons, tooltips, money
  // -------------------------------------------------------------------------

  private drawPortrait(canvas: HTMLCanvasElement, glyph: string, tint: number): void {
    const ctx = canvas.getContext('2d')!;
    const s = canvas.width;
    const g = ctx.createRadialGradient(s * 0.38, s * 0.32, 2, s / 2, s / 2, s * 0.62);
    const c = '#' + tint.toString(16).padStart(6, '0');
    g.addColorStop(0, shade(c, 0.45));
    g.addColorStop(1, shade(c, -0.65));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.font = `${Math.floor(s * 0.58)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, s / 2, s / 2 + 2);
  }

  private itemIcon(item: ItemDef): string {
    const q = item.quality ?? 'common';
    return `<img class="item-icon q-${q}" src="${iconDataUrl('item', item.id)}" alt="" draggable="false">`;
  }

  moneyHtml(copper: number): string {
    const g = Math.floor(copper / 10000);
    const s = Math.floor((copper % 10000) / 100);
    const c = copper % 100;
    let html = '';
    if (g > 0) html += `${g}<span class="coin g"></span>`;
    if (s > 0 || g > 0) html += `${s}<span class="coin s"></span>`;
    html += `${c}<span class="coin c"></span>`;
    return html;
  }

  attachTooltip(el: HTMLElement, html: () => string): void {
    el.addEventListener('mouseenter', () => {
      this.tooltipEl.innerHTML = html();
      this.tooltipEl.style.display = 'block';
    });
    el.addEventListener('mousemove', (e) => {
      const tw = this.tooltipEl.offsetWidth, th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.min(window.innerWidth - tw - 8, e.clientX + 14)}px`;
      this.tooltipEl.style.top = `${Math.max(8, e.clientY - th - 10)}px`;
    });
    el.addEventListener('mouseleave', () => { this.tooltipEl.style.display = 'none'; });
  }

  hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private itemTooltip(item: ItemDef): string {
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    let html = `<div class="tt-title" style="color:${qColor}">${item.name}</div>`;
    if (item.slot) {
      const slotNames: Record<string, string> = { mainhand: 'Main Hand', chest: 'Chest', legs: 'Legs', feet: 'Feet' };
      html += `<div class="tt-sub">${slotNames[item.slot]}</div>`;
    }
    if (item.weapon) {
      const dps = ((item.weapon.min + item.weapon.max) / 2 / item.weapon.speed).toFixed(1);
      html += `<div class="tt-stat">${item.weapon.min} - ${item.weapon.max} Damage&nbsp;&nbsp;Speed ${item.weapon.speed.toFixed(1)}</div>`;
      html += `<div class="tt-stat">(${dps} damage per second)</div>`;
      if (item.weapon.dagger) html += `<div class="tt-sub">Dagger</div>`;
    }
    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        if (k === 'armor') html += `<div class="tt-stat">${v} Armor</div>`;
        else html += `<div class="tt-green">+${v} ${k[0].toUpperCase()}${k.slice(1)}</div>`;
      }
    }
    if (item.foodHp) html += `<div class="tt-desc">Use: Restores ${item.foodHp} health over 18 sec. Must remain seated while eating.</div>`;
    if (item.drinkMana) html += `<div class="tt-desc">Use: Restores ${item.drinkMana} mana over 18 sec. Must remain seated while drinking.</div>`;
    if (item.kind === 'quest') html += `<div class="tt-desc">Quest Item</div>`;
    if (item.requiredClass) html += `<div class="tt-sub">Classes: ${item.requiredClass.map((c) => CLASSES[c].name).join(', ')}</div>`;
    if (item.sellValue > 0) html += `<div class="tt-sub">Sell price: ${formatMoney(item.sellValue)}</div>`;
    return html;
  }

  private abilityTooltip(res: ResolvedAbility): string {
    const a = res.def;
    const resName = this.sim.player.resourceType === 'rage' ? 'Rage' : this.sim.player.resourceType === 'energy' ? 'Energy' : 'Mana';
    let dmgText = '';
    for (const eff of res.effects) {
      if (eff.type === 'directDamage') dmgText = eff.min === eff.max ? `${eff.min}` : `${eff.min} to ${eff.max}`;
      if (eff.type === 'weaponDamage' || eff.type === 'weaponStrike') dmgText = `${eff.bonus}`;
      if (eff.type === 'dot') dmgText = `${eff.total}`;
      if (eff.type === 'aoeDamage' || eff.type === 'aoeRoot') dmgText = `${eff.min} to ${eff.max}`;
    }
    let html = `<div class="tt-title">${a.name}</div>`;
    html += `<div class="tt-sub">Rank ${res.rank}</div>`;
    const costLine: string[] = [];
    if (res.cost > 0) costLine.push(`${res.cost} ${resName}`);
    if (a.range > 0) costLine.push(`${a.minRange ? a.minRange + '-' : ''}${a.range} yd range`);
    if (costLine.length) html += `<div class="tt-stat">${costLine.join(' &nbsp; ')}</div>`;
    const castLine: string[] = [];
    castLine.push(a.channel ? `Channeled (${a.channel.duration} sec)` : res.castTime > 0 ? `${res.castTime} sec cast` : 'Instant');
    if (a.cooldown > 0) castLine.push(`${a.cooldown} sec cooldown`);
    html += `<div class="tt-stat">${castLine.join(' &nbsp; ')}</div>`;
    html += `<div class="tt-desc">${a.description.replace('$d', dmgText)}</div>`;
    return html;
  }

  // -------------------------------------------------------------------------
  // Action bar
  // -------------------------------------------------------------------------

  // The hotbar layout is a client-side remap over the learned abilities,
  // keyed by ability id (known is class-ordered and shifts on level-up, so
  // indices would not survive). Persisted per class+character.
  private slotMapKey(): string {
    return `woc_hotbar_${this.sim.cfg.playerClass}_${this.sim.player.name}`;
  }

  private loadSlotMap(): void {
    let arr: unknown = null;
    try { arr = JSON.parse(localStorage.getItem(this.slotMapKey()) ?? 'null'); } catch { /* corrupt */ }
    const seen = new Set<string>();
    this.slotMap = Array.from({ length: Hud.BAR_ABILITY_SLOTS }, (_, i) => {
      const v = Array.isArray(arr) ? arr[i] : null;
      if (typeof v !== 'string' || !ABILITIES[v] || seen.has(v)) return null;
      seen.add(v);
      return v;
    });
  }

  private saveSlotMap(): void {
    try { localStorage.setItem(this.slotMapKey(), JSON.stringify(this.slotMap)); } catch { /* storage unavailable */ }
  }

  // Drop unlearned ids; place newly learned abilities in the first empty
  // slot. With empty storage this reproduces the default class-order layout.
  private syncSlotMap(): void {
    const ids = new Set(this.sim.known.map((k) => k.def.id));
    let dirty = false;
    for (let i = 0; i < this.slotMap.length; i++) {
      const id = this.slotMap[i];
      if (id !== null && !ids.has(id)) { this.slotMap[i] = null; dirty = true; }
    }
    for (const k of this.sim.known) {
      if (this.slotMap.includes(k.def.id)) continue;
      const empty = this.slotMap.indexOf(null);
      if (empty !== -1) { this.slotMap[empty] = k.def.id; dirty = true; }
    }
    if (dirty) this.saveSlotMap();
  }

  abilityForSlot(barSlot: number): ResolvedAbility | null { // barSlot 1..11
    const id = this.slotMap[barSlot - 1];
    return id ? this.sim.known.find((k) => k.def.id === id) ?? null : null;
  }

  // Shared entry point for hotbar clicks and the 1..0-= keybinds.
  castSlot(barSlot: number): void {
    if (barSlot === 0) {
      if (this.sim.player.autoAttack) this.sim.stopAutoAttack();
      else this.sim.startAutoAttack();
      return;
    }
    const known = this.abilityForSlot(barSlot);
    // cast by ability id: the server validates against its own known list,
    // so the client-side slot remap never desyncs slot semantics
    if (known) this.sim.castAbility(known.def.id);
  }

  private buildActionBar(): void {
    const bar = $('#actionbar');
    for (let i = 0; i < 12; i++) {
      const btn = document.createElement('button');
      btn.className = 'action-btn empty';
      const label = document.createElement('span');
      label.className = 'icon-label';
      const kb = document.createElement('span');
      kb.className = 'keybind';
      kb.textContent = this.keybinds.primaryLabel(`slot${i}`); // rebindable; refreshKeybindLabels keeps it current
      const cdOverlay = document.createElement('div');
      cdOverlay.className = 'cd-overlay';
      const cdText = document.createElement('div');
      cdText.className = 'cdtext';
      btn.append(label, kb, cdOverlay, cdText);
      const slot = i;
      // slot 0 is Attack for every class (auto-attack toggle — players
      // without right-click need a way in); the kit fills slots 1+
      btn.addEventListener('click', () => {
        audio.click();
        this.castSlot(slot);
      });
      this.attachTooltip(btn, () => {
        if (slot === 0) {
          return '<div class="tt-title">Attack</div><div class="tt-sub">Toggle auto-attack on your target.<br>Right-clicking an enemy also attacks.</div>';
        }
        const known = this.abilityForSlot(slot);
        return known ? this.abilityTooltip(known) : '<div class="tt-sub">Empty slot</div>';
      });
      if (slot >= 1) {
        // drag an ability onto another slot to swap the two keybinds;
        // slot 0 (Attack) stays fixed
        btn.draggable = true;
        btn.addEventListener('dragstart', (e) => {
          const known = this.abilityForSlot(slot);
          if (!known) { e.preventDefault(); return; }
          this.dragFromSlot = slot;
          e.dataTransfer!.setData('text/plain', known.def.id);
          e.dataTransfer!.effectAllowed = 'move';
          this.hideTooltip();
        });
        btn.addEventListener('dragover', (e) => {
          if (this.dragFromSlot === null || this.dragFromSlot === slot) return;
          e.preventDefault(); // required to permit the drop
          e.dataTransfer!.dropEffect = 'move';
          btn.classList.add('drop-target');
        });
        btn.addEventListener('dragleave', () => btn.classList.remove('drop-target'));
        btn.addEventListener('drop', (e) => {
          e.preventDefault();
          btn.classList.remove('drop-target');
          const from = this.dragFromSlot;
          this.dragFromSlot = null;
          if (from === null || from === slot) return;
          const a = from - 1, b = slot - 1;
          [this.slotMap[a], this.slotMap[b]] = [this.slotMap[b], this.slotMap[a]]; // swap; empty target = move
          this.saveSlotMap();
        });
        btn.addEventListener('dragend', () => {
          this.dragFromSlot = null;
          bar.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
        });
      }
      bar.appendChild(btn);
      this.abilityButtons.push({ btn, label, keybindEl: kb, cdOverlay, cdText, lastIcon: '' });
    }
  }

  // Repaint the keycap on every action button from the current bindings.
  private refreshKeybindLabels(): void {
    for (let i = 0; i < this.abilityButtons.length; i++) {
      this.abilityButtons[i].keybindEl.textContent = this.keybinds.primaryLabel(`slot${i}`);
    }
  }

  private buildXpTicks(): void {
    const ticks = $('#xpbar .ticks');
    for (let i = 0; i < 20; i++) ticks.appendChild(document.createElement('i'));
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(): void {
    const sim = this.sim;
    const p = sim.player;
    this.meters.update();
    this.syncSlotMap(); // picks up newly learned abilities mid-session

    // player frame
    $('#pf-level').textContent = String(p.level);
    ($('#pf-hp') as HTMLElement).style.transform = `scaleX(${p.hp / Math.max(1, p.maxHp)})`;
    $('#pf-hp-text').textContent = `${p.hp} / ${p.maxHp}`;
    const resFrac = p.resource / Math.max(1, p.maxResource);
    ($('#pf-res') as HTMLElement).style.transform = `scaleX(${resFrac})`;
    $('#pf-res-text').textContent = `${Math.round(p.resource)} / ${p.maxResource}`;
    $('#pf-resource').className = 'bar ' + (p.resourceType === 'rage' ? 'rage' : p.resourceType === 'energy' ? 'energy' : 'mana');

    // buff bar (player buffs + debuffs)
    this.renderAuras($('#buff-bar'), p, 'all');

    // target frame
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    const tf = $('#target-frame');
    if (target && target.kind !== 'object') {
      tf.style.display = 'flex';
      tf.classList.toggle('elite', !!MOBS[target.templateId]?.elite);
      $('#tf-elite-tag').textContent = MOBS[target.templateId]?.boss ? 'BOSS' : 'ELITE';
      $('#tf-name').textContent = target.name;
      $('#tf-level').textContent = MOBS[target.templateId]?.boss ? '☠' : String(target.level);
      ($('#tf-hp') as HTMLElement).style.transform = `scaleX(${target.hp / Math.max(1, target.maxHp)})`;
      $('#tf-hp-text').textContent = target.dead ? 'Dead' : `${target.hp} / ${target.maxHp}`;
      ($('#tf-name') as HTMLElement).style.color = target.hostile ? '#ff6b5e' : '#9fdc7f';
      if (this.lastPortraitTarget !== target.id) {
        this.lastPortraitTarget = target.id;
        const glyph = target.kind === 'npc' ? '💬' : FAMILY_GLYPH[MOBS[target.templateId]?.family ?? 'humanoid'] ?? '🗡️';
        this.drawPortrait($('#tf-portrait') as unknown as HTMLCanvasElement, glyph, target.color);
      }
      this.renderAuras($('#tf-debuffs'), target, 'debuffs');
      // combo points
      const comboRow = $('#combo-row');
      if (p.resourceType === 'energy') {
        comboRow.style.display = 'flex';
        if (comboRow.children.length !== 5) {
          comboRow.innerHTML = '';
          for (let i = 0; i < 5; i++) {
            const pip = document.createElement('div');
            pip.className = 'combo-pip';
            comboRow.appendChild(pip);
          }
        }
        const points = p.comboTargetId === target.id ? p.comboPoints : 0;
        [...comboRow.children].forEach((pip, i) => pip.classList.toggle('on', i < points));
      } else {
        comboRow.style.display = 'none';
      }
    } else {
      tf.style.display = 'none';
      this.lastPortraitTarget = -999;
    }

    // cast bar
    const cb = $('#castbar');
    if (p.castingAbility) {
      cb.style.display = 'block';
      cb.classList.toggle('channel', p.channeling);
      const frac = p.channeling
        ? p.castRemaining / Math.max(0.01, p.castTotal)
        : 1 - p.castRemaining / Math.max(0.01, p.castTotal);
      (cb.querySelector('.fill') as HTMLElement).style.width = `${(frac * 100).toFixed(1)}%`;
      (cb.querySelector('.label') as HTMLElement).textContent = ABILITIES[p.castingAbility].name;
    } else if (p.eating || p.drinking) {
      cb.style.display = 'block';
      cb.classList.add('channel');
      const c = p.eating && p.drinking
        ? (p.eating.remaining >= p.drinking.remaining ? p.eating : p.drinking)
        : (p.eating ?? p.drinking)!;
      (cb.querySelector('.fill') as HTMLElement).style.width = `${((c.remaining / CONSUME_DURATION) * 100).toFixed(1)}%`;
      (cb.querySelector('.label') as HTMLElement).textContent =
        p.eating && p.drinking ? 'Eating & Drinking…' : p.eating ? 'Eating…' : 'Drinking…';
    } else {
      cb.style.display = 'none';
    }

    // action bar
    const tgtDist = target && !target.dead ? dist2d(p.pos, target.pos) : null;
    for (let i = 0; i < this.abilityButtons.length; i++) {
      const ab = this.abilityButtons[i];
      if (i === 0) {
        // Attack button: glows while auto-attacking, red-edged out of range
        ab.btn.classList.remove('empty', 'unusable');
        if (ab.lastIcon !== '__attack') {
          ab.lastIcon = '__attack';
          ab.label.style.backgroundImage = `url(${iconDataUrl('ability', 'attack')})`;
        }
        ab.cdOverlay.style.height = '0%';
        ab.cdText.textContent = '';
        ab.btn.classList.toggle('queued', !!p.autoAttack);
        ab.btn.classList.toggle('oor', tgtDist !== null && tgtDist > MELEE_RANGE);
        continue;
      }
      const known = this.abilityForSlot(i);
      if (!known) {
        ab.btn.classList.add('empty');
        if (ab.lastIcon !== '') {
          ab.lastIcon = '';
          ab.label.style.backgroundImage = '';
        }
        ab.cdOverlay.style.height = '0%';
        ab.cdText.textContent = '';
        continue;
      }
      const a = known.def;
      ab.btn.classList.remove('empty');
      // set the painted icon once per slot change, not every frame
      if (ab.lastIcon !== a.id) {
        ab.lastIcon = a.id;
        ab.label.style.backgroundImage = `url(${iconDataUrl('ability', a.id)})`;
      }
      const cd = p.cooldowns.get(a.id) ?? 0;
      const gcdActive = !a.offGcd && p.gcdRemaining > 0;
      const shown = Math.max(cd, gcdActive ? p.gcdRemaining : 0);
      const denom = cd > 0 ? a.cooldown : GCD;
      ab.cdOverlay.style.height = shown > 0 ? `${Math.min(100, (shown / Math.max(0.01, denom)) * 100)}%` : '0%';
      ab.cdText.textContent = cd > 1 ? Math.ceil(cd).toString() : '';
      ab.btn.classList.toggle('unusable', p.resource < known.cost);
      const oor = a.requiresTarget && tgtDist !== null && tgtDist > (a.range > 0 ? a.range : MELEE_RANGE);
      ab.btn.classList.toggle('oor', !!oor);
      ab.btn.classList.toggle('queued', p.queuedOnSwing === a.id);
    }

    // xp bar
    const xpNeed = xpForLevel(p.level);
    const xpFrac = p.level >= MAX_LEVEL ? 1 : sim.xp / xpNeed;
    ($('#xpbar .fill') as HTMLElement).style.width = `${(xpFrac * 100).toFixed(1)}%`;
    $('#xpbar .label').textContent = p.level >= MAX_LEVEL ? 'MAX LEVEL' : `${sim.xp} / ${xpNeed} XP (${Math.floor(xpFrac * 100)}%)`;

    $('#death-overlay').style.display = p.dead ? 'flex' : 'none';

    // zone transitions: banner + welcome hint when crossing into a new band.
    // A ~5yd dead-band past the boundary stops a player straddling the border
    // from re-triggering the banner/log (and the map canvas regen) every step.
    const inDungeon = p.pos.x > DUNGEON_X_THRESHOLD;
    const currentZone = zoneAt(p.pos.z);
    if (!inDungeon && currentZone.id !== this.lastZoneId) {
      const lastZone = ZONES.find((z) => z.id === this.lastZoneId);
      const pastDeadBand = !lastZone
        || p.pos.z < lastZone.zMin - ZONE_BANNER_DEADBAND
        || p.pos.z >= lastZone.zMax + ZONE_BANNER_DEADBAND;
      if (pastDeadBand) {
        if (this.lastZoneId !== '') {
          this.showBanner(currentZone.name);
          this.log(`Entering ${currentZone.name}.`, '#ffd100');
          this.log(currentZone.welcome, '#ffd100');
        }
        this.lastZoneId = currentZone.id;
      }
    }

    // soundtrack: pick the zone theme and layer in combat percussion.
    // Combat = a mob is on us, or we traded blows in the last few seconds
    // (the wire protocol doesn't ship the inCombat flag).
    let aggroed = false;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.aggroTargetId === sim.playerId) { aggroed = true; break; }
    }
    const inCombat = aggroed || performance.now() - this.lastCombatEventAt < 5000;
    const hub = currentZone.hub;
    const zone = inDungeon ? 'dungeon'
      : Math.hypot(p.pos.x - hub.x, p.pos.z - hub.z) < hub.radius + 10 ? 'town' : currentZone.biome;
    music.update(zone, inCombat);

    this.updateQuestTracker();
    this.updatePartyFrames();
    this.updateTradeWindow();
    this.updateMinimap();
    if ($('#map-window').style.display === 'block') this.updateMapWindow();
    if (this.openLootMobId !== null) {
      const mob = sim.entities.get(this.openLootMobId);
      if (!mob || !mob.lootable || dist2d(p.pos, mob.pos) > 7) this.closeLoot();
    }
    if (this.openVendorNpcId !== null) {
      const npc = sim.entities.get(this.openVendorNpcId);
      if (!npc || dist2d(p.pos, npc.pos) > 8) this.closeVendor();
    }
  }

  private renderAuras(el: HTMLElement, e: Entity, mode: 'all' | 'debuffs'): void {
    // cheap diff: rebuild only when the aura set changes
    const sig = e.auras.map((a) => a.id + Math.ceil(a.remaining)).join('|');
    if ((el as any).__sig === sig) return;
    (el as any).__sig = sig;
    el.innerHTML = '';
    for (const a of e.auras) {
      const isDebuff = ['dot', 'slow', 'root', 'stun', 'incapacitate', 'polymorph', 'attackspeed'].includes(a.kind);
      if (mode === 'debuffs' && !isDebuff) continue;
      const d = document.createElement('div');
      d.className = 'buff' + (isDebuff ? ' debuff' : '');
      d.style.backgroundImage = `url(${iconDataUrl('aura', ABILITIES[a.id] ? a.id : `aura_${a.kind}`)})`;
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = a.remaining < 99 ? `${Math.ceil(a.remaining)}s` : '';
      d.appendChild(dur);
      this.attachTooltip(d, () => `<div class="tt-title">${a.name}</div><div class="tt-sub">${Math.ceil(a.remaining)} seconds remaining</div>`);
      el.appendChild(d);
    }
  }

  private updateQuestTracker(): void {
    const el = $('#quest-tracker');
    let html = this.sim.questLog.size > 0 ? '<div class="qt-header">Quests</div>' : '';
    for (const qp of this.sim.questLog.values()) {
      const quest = QUESTS[qp.questId];
      html += `<div class="qt-title">${quest.name}${qp.state === 'ready' ? ' <span style="color:#7fdc4f">(Complete)</span>' : ''}</div>`;
      quest.objectives.forEach((obj, i) => {
        const done = qp.counts[i] >= obj.count;
        html += `<div class="qt-obj${done ? ' done' : ''}">- ${obj.label}: ${qp.counts[i]}/${obj.count}</div>`;
      });
    }
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // -------------------------------------------------------------------------
  // Minimap & world map
  // -------------------------------------------------------------------------

  // Render a region of the heightfield to a canvas; width W px, height
  // derived from the region's aspect so a yard is square on screen.
  private renderTerrainCanvas(W: number, region: { minX: number; maxX: number; minZ: number; maxZ: number }): HTMLCanvasElement {
    const spanX = region.maxX - region.minX;
    const spanZ = region.maxZ - region.minZ;
    const H = Math.round(W * spanZ / spanX);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const seed = this.sim.cfg.seed;
    for (let iy = 0; iy < H; iy++) {
      for (let ix = 0; ix < W; ix++) {
        // +Z up, +X LEFT: facing 0 is +Z ("north") and turning right
        // decreases facing, so the world's east is -X — drawing +X to the
        // right mirrored the whole map east-west
        const x = region.maxX - (ix / W) * spanX;
        const z = region.maxZ - (iy / H) * spanZ;
        const h = terrainHeight(x, z, seed);
        const biome = zoneAt(z).biome;
        let r = 58, g = 105, b = 48;
        if (biome === 'marsh') { r = 64; g = 86; b = 48; }
        else if (biome === 'peaks') { r = 92; g = 100; b = 82; }
        if (h < WATER_LEVEL) { r = 38; g = 84; b = 138; }
        else if (h > 26) { r = 168; g = 172; b = 178; } // ridge / peak rock+snow
        else if (h > 11) { r = 112; g = 110; b = 102; }
        else if (h > 6) { r = 88; g = 102; b = 62; }
        let nearHub = false;
        for (const zn of ZONES) {
          if (Math.hypot(x - zn.hub.x, z - zn.hub.z) < 14) { nearHub = true; break; }
        }
        if (nearHub) { r = 125; g = 100; b = 66; }
        else if (h >= WATER_LEVEL && roadDistance(x, z) < 2.4) { r = 138; g = 111; b = 71; }
        const k = (iy * W + ix) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private updateMinimap(): void {
    const ctx = this.minimapCtx;
    const S = 162;
    const p = this.sim.player;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    const pxPerYard = 1.7;
    const bg = this.minimapBg;
    const bgPxPerYard = bg.width / (WORLD_MAX_X - WORLD_MIN_X);
    const sw = S / (pxPerYard / bgPxPerYard);
    const sx = (WORLD_MAX_X - p.pos.x) * bgPxPerYard - sw / 2; // bg is +X-left
    const sy = (WORLD_MAX_Z - p.pos.z) * bgPxPerYard - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);

    for (const e of this.sim.entities.values()) {
      if (e.id === p.id) continue;
      const dx = -(e.pos.x - p.pos.x) * pxPerYard; // +X is map-left
      const dz = -(e.pos.z - p.pos.z) * pxPerYard;
      const mx = S / 2 + dx, my = S / 2 + dz;
      if ((mx - S / 2) ** 2 + (my - S / 2) ** 2 > (S / 2 - 7) ** 2) continue;
      if (e.kind === 'npc') {
        const hasAvail = e.questIds.some((q) => QUESTS[q].giverNpcId === e.templateId && this.sim.questState(q) === 'available');
        const hasReady = e.questIds.some((q) => QUESTS[q].turnInNpcId === e.templateId && this.sim.questState(q) === 'ready');
        ctx.fillStyle = '#ffd100';
        ctx.font = 'bold 11px Georgia';
        ctx.fillText(hasReady ? '?' : hasAvail ? '!' : '•', mx - 2, my + 3);
      } else if (e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')) {
        ctx.fillStyle = '#c084ff';
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'object' && e.lootable) {
        ctx.fillStyle = '#ffe97a';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else if (e.kind === 'mob' && !e.dead) {
        ctx.fillStyle = e.aggroTargetId === p.id ? '#ff8800' : '#e74c3c';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else if (e.kind === 'mob' && e.lootable) {
        ctx.fillStyle = '#ffd100';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }
    // party members as bright blue blips
    const party = this.sim.partyInfo;
    if (party) {
      ctx.fillStyle = '#5fa8ff';
      for (const m of party.members) {
        if (m.pid === p.id) continue;
        const mx = S / 2 - (m.x - p.pos.x) * pxPerYard;
        const my = S / 2 - (m.z - p.pos.z) * pxPerYard;
        if ((mx - S / 2) ** 2 + (my - S / 2) ** 2 > (S / 2 - 7) ** 2) continue;
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-p.facing); // canvas rotates clockwise; facing increases turning left
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(4.5, 5.5); ctx.lineTo(-4.5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  toggleMeters(): void {
    this.meters.toggle();
  }

  toggleMap(): void {
    const el = $('#map-window');
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    this.updateMapWindow();
  }

  // The map window shows the zone band the player is standing in (each band
  // is a square); POIs and dungeon portals come from the zone/dungeon data.
  private updateMapWindow(): void {
    const canvas = $('#map-canvas') as unknown as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const S = canvas.width;
    const p = this.sim.player;
    // inside an instance, show the zone the dungeon's door is in (dungeonAt
    // owns the instance x-band layout); outdoors, follow the committed zone
    // so border-straddling can't thrash the 280px canvas regen below
    const dungeon = dungeonAt(p.pos.x);
    const zone: ZoneDef = dungeon
      ? zoneAt(dungeon.doorPos.z)
      : ZONES.find((z) => z.id === this.lastZoneId) ?? zoneAt(p.pos.z);
    const region = { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: zone.zMin, maxZ: zone.zMax };
    if (!this.mapBg || this.mapZoneId !== zone.id) {
      this.mapBg = this.renderTerrainCanvas(280, region);
      this.mapZoneId = zone.id;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapBg, 0, 0, S, S);
    const spanX = region.maxX - region.minX;
    const spanZ = region.maxZ - region.minZ;
    const toMap = (x: number, z: number) => ({
      mx: ((region.maxX - x) / spanX) * S, // +X is map-left (east = -X)
      my: ((region.maxZ - z) / spanZ) * S,
    });
    // zone title
    ctx.font = 'bold 16px Georgia';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#ffe9a0';
    ctx.strokeText(zone.name, S / 2, 20);
    ctx.fillText(zone.name, S / 2, 20);
    // labels
    ctx.font = 'bold 13px Georgia';
    const label = (x: number, z: number, text: string) => {
      const { mx, my } = toMap(x, z);
      ctx.strokeText(text, mx, my);
      ctx.fillText(text, mx, my);
    };
    for (const poi of zone.pois) label(poi.x, poi.z, poi.label);
    // dungeon entrance portals in this zone
    for (const dungeon of DUNGEON_LIST) {
      if (dungeon.doorPos.z < zone.zMin || dungeon.doorPos.z >= zone.zMax) continue;
      const { mx, my } = toMap(dungeon.doorPos.x, dungeon.doorPos.z);
      ctx.fillStyle = '#c084ff';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0c0ff';
      ctx.font = 'bold 12px Georgia';
      ctx.strokeText(dungeon.name, mx, my - 9);
      ctx.fillText(dungeon.name, mx, my - 9);
      ctx.font = 'bold 13px Georgia';
      ctx.fillStyle = '#ffe9a0';
    }
    // npcs
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'npc') continue;
      if (e.pos.z < zone.zMin || e.pos.z >= zone.zMax) continue;
      const { mx, my } = toMap(e.pos.x, e.pos.z);
      const hasAvail = e.questIds.some((q) => QUESTS[q].giverNpcId === e.templateId && this.sim.questState(q) === 'available');
      const hasReady = e.questIds.some((q) => QUESTS[q].turnInNpcId === e.templateId && this.sim.questState(q) === 'ready');
      if (hasAvail || hasReady) {
        ctx.fillStyle = '#ffd100';
        ctx.font = 'bold 15px Georgia';
        ctx.strokeText(hasReady ? '?' : '!', mx, my);
        ctx.fillText(hasReady ? '?' : '!', mx, my);
      }
    }
    // player
    if (p.pos.z >= zone.zMin && p.pos.z < zone.zMax && p.pos.x <= WORLD_MAX_X) {
      const { mx, my } = toMap(p.pos.x, p.pos.z);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-p.facing); // matches the flipped map (see toMap)
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Events -> log, FCT, audio, banners
  // -------------------------------------------------------------------------

  handleEvents(events: SimEvent[]): void {
    const sim = this.sim;
    for (const ev of events) {
      // visual effects (swings, projectiles, glows) — for everyone nearby,
      // not just events involving this player
      this.renderer.handleEvent(ev);
      this.meters.onEvent(ev);
      switch (ev.type) {
        case 'damage': {
          const src = sim.entities.get(ev.sourceId);
          const tgt = sim.entities.get(ev.targetId);
          if (!tgt) break;
          const isPlayerSource = ev.sourceId === sim.playerId;
          const isPlayerTarget = ev.targetId === sim.playerId;
          if (isPlayerSource || isPlayerTarget) this.lastCombatEventAt = performance.now();
          if (ev.kind === 'miss' || ev.kind === 'dodge') {
            this.fct(tgt, ev.kind === 'miss' ? 'Miss' : 'Dodge', isPlayerTarget ? '#bbb' : '#fff', false);
            if (isPlayerSource) {
              this.combatLog(`Your ${ev.ability ?? 'attack'} ${ev.kind === 'miss' ? 'misses' : 'is dodged by'} ${tgt.name}.`, '#ccc');
              audio.meleeMiss();
            }
            break;
          }
          if (isPlayerSource && !isPlayerTarget) {
            const color = ev.ability ? '#ffe97a' : '#fff';
            this.fct(tgt, `${ev.amount}${ev.crit ? '!' : ''}`, color, ev.crit);
            this.combatLog(`Your ${ev.ability ?? 'attack'} hits ${tgt.name} for ${ev.amount}${ev.crit ? ' (Critical)' : ''}.`, ev.ability ? '#ffe97a' : '#eee');
            if (ev.school === 'fire') audio.fire();
            else if (ev.school === 'frost') audio.frost();
            else if (ev.school === 'arcane') audio.arcane();
            else audio.meleeHit(ev.crit);
          } else if (isPlayerTarget) {
            this.fct(tgt, `-${ev.amount}`, '#ff5544', ev.crit);
            this.combatLog(`${src?.name ?? 'Something'} hits you for ${ev.amount}${ev.crit ? ' (Critical)' : ''}.`, '#ff8877');
            audio.hitTaken();
          }
          break;
        }
        case 'heal': {
          if (ev.targetId === sim.playerId && ev.amount > 0) {
            this.fct(sim.player, `+${ev.amount}`, '#3ce63c', false);
          }
          break;
        }
        case 'death': {
          const e = sim.entities.get(ev.entityId);
          if (e && ev.entityId !== sim.playerId) this.combatLog(`${e.name} dies.`, '#aaa');
          break;
        }
        case 'xp': {
          this.fct(sim.player, `+${ev.amount} XP`, '#b974ff', false);
          this.log(`You gain ${ev.amount} experience.`, '#a980d8');
          break;
        }
        case 'levelup': {
          this.showBanner(`Level ${ev.level}!`);
          this.log(`You have reached level ${ev.level}!`, '#ffd100');
          audio.levelUp();
          break;
        }
        case 'learnAbility': break; // logged by sim
        case 'comboPoint': break;
        case 'loot': {
          this.log(ev.text, '#7fdc4f');
          if (ev.text.includes('loot') || ev.text.includes('Sold')) audio.coin();
          else audio.lootItem();
          if ($('#bags').style.display === 'block') this.renderBags();
          break;
        }
        case 'vendor': {
          if ($('#bags').style.display === 'block') this.renderBags();
          if (this.openVendorNpcId !== null) this.renderVendor();
          break;
        }
        case 'error': this.showError(ev.text); break;
        case 'questAccepted':
          audio.questAccept();
          this.refreshGossip();
          break;
        case 'questProgress': this.log(ev.text, '#dcd29f'); break;
        case 'questReady': {
          const q = QUESTS[ev.questId];
          this.showBanner(`${q.name} (Complete)`);
          audio.questDone();
          break;
        }
        case 'questDone':
          audio.questDone();
          this.refreshGossip();
          break;
        case 'chat': {
          if (this.isChatIgnored(ev.from)) break;
          switch (ev.channel) {
            case 'party': this.log(`[Party] ${ev.from}: ${ev.text}`, '#7fd4ff'); break;
            case 'yell': this.log(`${ev.from} yells: ${ev.text}`, '#ff5040'); break;
            case 'whisper':
              if (ev.to) this.log(`To ${ev.to}: ${ev.text}`, '#ff80ff');
              else { this.log(`${ev.from} whispers: ${ev.text}`, '#ff80ff'); audio.whisper(); }
              break;
            case 'general': this.log(`[General] ${ev.from}: ${ev.text}`, '#ffc864'); break;
            default: this.log(`${ev.from} says: ${ev.text}`, '#f0ead8'); break;
          }
          if ((ev.channel === 'say' || ev.channel === 'yell') && ev.entityId !== undefined) {
            this.renderer.showChatBubble(ev.entityId, ev.text, ev.channel === 'yell');
          }
          break;
        }
        case 'tradeDone':
          if ($('#bags').style.display === 'block') this.renderBags();
          audio.coin();
          break;
        case 'heal2': {
          const tgt = sim.entities.get(ev.targetId);
          if (tgt && ev.amount > 0) {
            this.fct(tgt, `+${ev.amount}${ev.crit ? '!' : ''}`, '#3ce63c', ev.crit);
            if (ev.sourceId === sim.playerId) {
              this.combatLog(`Your ${ev.ability} heals ${ev.targetId === sim.playerId ? 'you' : tgt.name} for ${ev.amount}${ev.crit ? ' (Critical)' : ''}.`, '#7fdc4f');
            }
          }
          break;
        }
        case 'partyInvite':
          audio.questAccept();
          this.showPrompt(`<b>${ev.fromName}</b> invites you to join their party.`, 'Join Party',
            () => this.sim.partyAccept(), () => this.sim.partyDecline());
          break;
        case 'tradeRequest':
          audio.click();
          this.showPrompt(`<b>${ev.fromName}</b> wants to trade with you.`, 'Open Trade',
            () => this.sim.tradeAccept(), () => { /* let it expire */ });
          break;
        case 'duelRequest':
          audio.duelChallenge();
          this.showPrompt(`<b>${ev.fromName}</b> has challenged you to a duel!`, 'Accept Duel',
            () => this.sim.duelAccept(), () => this.sim.duelDecline());
          break;
        case 'duelCountdown':
          this.showBanner(`Duel begins in ${ev.seconds}…`);
          audio.duelCountdownTick();
          break;
        case 'duelStart':
          audio.duelStart();
          break;
        case 'duelEnd':
          this.showBanner(`${ev.winnerName} has defeated ${ev.loserName} in a duel!`);
          this.combatLog(`${ev.winnerName} has defeated ${ev.loserName} in a duel.`, '#fa6');
          audio.duelEnd();
          break;
        case 'log': this.log(ev.text, ev.color ?? '#ccc'); break;
        case 'playerDeath': {
          this.log('You have died.', '#ff4444');
          audio.death();
          break;
        }
        case 'respawn': this.log('You feel rested and whole again.', '#7fdc4f'); break;
        case 'castStart': {
          const a = ABILITIES[ev.ability];
          if (a?.school === 'fire') audio.castStart();
          else if (a?.school === 'frost') audio.castStart();
          else audio.castStart();
          break;
        }
        case 'castStop': break;
        case 'aura': {
          const tgt = sim.entities.get(ev.targetId);
          if (ev.name === 'Polymorph' && ev.gained) audio.sheep();
          if (ev.targetId === sim.playerId) {
            this.combatLog(ev.gained ? `You gain ${ev.name}.` : `${ev.name} fades from you.`, '#d8a0d8');
          } else if (tgt && ev.gained) {
            this.combatLog(`${tgt.name} is afflicted by ${ev.name}.`, '#d8a0d8');
          }
          break;
        }
      }
    }
  }

  log(text: string, color = '#ccc'): void {
    this.appendLog(this.chatLogEl, text, color);
  }

  private combatLog(text: string, color = '#ccc'): void {
    this.appendLog(this.combatLogEl, text, color);
  }

  private appendLog(el: HTMLElement, text: string, color: string): void {
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    const div = document.createElement('div');
    div.textContent = text;
    div.style.color = color;
    el.appendChild(div);
    while (el.children.length > 200) el.removeChild(el.firstChild!);
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
  }

  private fct(target: Entity, text: string, color: string, crit: boolean): void {
    const v = this.renderer.worldToScreen(target.pos.x, target.pos.y + 2.2 * target.scale, target.pos.z);
    if (v.behind) return;
    const el = document.createElement('div');
    el.className = 'fct' + (crit ? ' crit' : '');
    el.style.color = color;
    el.style.left = `${v.x + (Math.random() * 30 - 15)}px`;
    el.style.top = `${v.y}px`;
    el.textContent = text;
    document.getElementById('ui')!.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  }

  showError(text: string): void {
    this.errorEl.textContent = text;
    this.errorEl.style.opacity = '1';
    clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => { this.errorEl.style.opacity = '0'; }, 1600);
    audio.error();
  }

  showBanner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.opacity = '1';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => { this.bannerEl.style.opacity = '0'; }, 2600);
  }

  // -------------------------------------------------------------------------
  // Quest dialog (gossip)
  // -------------------------------------------------------------------------

  openQuestDialog(npcId: number): void {
    const npc = this.sim.entities.get(npcId);
    if (!npc || npc.kind !== 'npc') return;
    this.renderGossip(npc);
  }

  private renderGossip(npc: Entity): void {
    this.openGossipNpcId = npc.id;
    const el = $('#quest-dialog');
    const def = NPCS[npc.templateId];
    // accepted-but-unfinished quests are tracked in the quest log; the NPC
    // only offers new quests (at the giver) and turn-ins (at the turn-in NPC)
    const interesting = npc.questIds.filter((q) => {
      const st = this.sim.questState(q);
      return (st === 'available' && QUESTS[q].giverNpcId === npc.templateId)
        || (st === 'ready' && QUESTS[q].turnInNpcId === npc.templateId);
    });
    let html = `<div class="panel-title"><span>${npc.name}<span style="color:#998d6a;font-size:11px"> &lt;${def?.title ?? ''}&gt;</span></span><span class="x-btn" data-close>✕</span></div>`;
    html += `<div class="qd-text">"${(def?.greeting ?? 'Greetings.').replace('$C', CLASSES[this.sim.cfg.playerClass].name.toLowerCase())}"</div>`;
    if (interesting.length > 0) {
      for (const qid of interesting) {
        const st = this.sim.questState(qid);
        const icon = st === 'ready' ? '<span class="gold">?</span> ' : '<span class="gold">!</span> ';
        html += `<div class="qd-list-item" data-quest="${qid}">${icon}${QUESTS[qid].name}</div>`;
      }
    }
    if (npc.vendorItems.length > 0) {
      html += `<div class="qd-list-item" data-vendor="1"><span style="color:#9fdc7f">$</span> Let me browse your goods.</div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-quest]').forEach((item) => {
      item.addEventListener('click', () => this.renderQuestDetail(npc, (item as HTMLElement).dataset.quest!));
    });
    el.querySelector('[data-vendor]')?.addEventListener('click', () => {
      this.closeQuestDialog();
      this.openVendor(npc.id);
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
  }

  private renderQuestDetail(npc: Entity, questId: string): void {
    const el = $('#quest-dialog');
    const quest = QUESTS[questId];
    const state = this.sim.questState(questId);
    const text = (state === 'ready' ? quest.completionText : quest.text).replace(/\$N/g, this.sim.player.name);
    let html = `<div class="panel-title"><span>${quest.name}${quest.suggestedPlayers ? ` <span style="color:#f96;font-size:11px">(Suggested players: ${quest.suggestedPlayers})</span>` : ''}</span><span class="x-btn" data-close>✕</span></div>`;
    html += `<div class="qd-text">${text}</div>`;
    if (state !== 'ready') {
      const qp = this.sim.questLog.get(questId);
      html += `<div class="qd-sub">Objectives</div>`;
      html += quest.objectives.map((o, i) => `<div class="qd-obj">&bull; ${o.label}: ${qp ? Math.min(qp.counts[i], o.count) : 0}/${o.count}</div>`).join('');
    }
    html += `<div class="qd-sub">Rewards</div>`;
    html += `<div class="qd-obj">${quest.xpReward} experience &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
    const rewardItem = quest.itemRewards[this.sim.cfg.playerClass];
    if (rewardItem) {
      const item = ITEMS[rewardItem];
      html += `<div class="qd-reward-row" data-reward>${this.itemIcon(item)}<span style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'};font-size:12px">${item.name}</span></div>`;
    }
    el.innerHTML = html;
    const rewardRow = el.querySelector('[data-reward]') as HTMLElement | null;
    if (rewardRow && rewardItem) this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));

    if (state === 'available') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Accept';
      btn.addEventListener('click', () => { this.sim.acceptQuest(questId); this.renderGossip(npc); });
      el.appendChild(btn);
    } else if (state === 'ready') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Complete Quest';
      btn.addEventListener('click', () => { this.sim.turnInQuest(questId); this.renderGossip(npc); });
      el.appendChild(btn);
    }
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => this.renderGossip(npc));
    el.appendChild(back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
  }

  closeQuestDialog(): void {
    $('#quest-dialog').style.display = 'none';
    this.openGossipNpcId = null;
    this.hideTooltip();
  }

  // Re-render the open gossip dialog after quest state changes so completed
  // quests can never be accepted again from a stale dialog.
  private refreshGossip(): void {
    if (this.openGossipNpcId === null || $('#quest-dialog').style.display !== 'block') return;
    const npc = this.sim.entities.get(this.openGossipNpcId);
    if (npc) this.renderGossip(npc);
    else this.closeQuestDialog();
  }

  // -------------------------------------------------------------------------
  // Loot window
  // -------------------------------------------------------------------------

  openLoot(mobId: number, screenX: number, screenY: number): void {
    const mob = this.sim.entities.get(mobId);
    if (!mob?.loot) return;
    this.openLootMobId = mobId;
    const el = $('#loot-window');
    let html = `<div class="panel-title"><span>${mob.name}</span><span class="x-btn" data-close>✕</span></div>`;
    if (mob.loot.copper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${iconDataUrl('item', 'coin_gold')}" alt="" draggable="false"><span>${this.moneyHtml(mob.loot.copper)}</span></div>`;
    }
    for (const s of mob.loot.items) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${item.name}${s.count > 1 ? ' x' + s.count : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item!;
      this.attachTooltip(row as HTMLElement, () => this.itemTooltip(ITEMS[itemId]));
    });
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Take All';
    btn.addEventListener('click', () => { this.sim.lootCorpse(mobId); this.closeLoot(); });
    el.appendChild(btn);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeLoot());
    el.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, screenX - 115))}px`;
    el.style.top = `${Math.min(window.innerHeight - 280, Math.max(10, screenY - 30))}px`;
    el.style.display = 'block';
  }

  closeLoot(): void {
    $('#loot-window').style.display = 'none';
    this.openLootMobId = null;
    this.hideTooltip();
  }

  // -------------------------------------------------------------------------
  // Vendor
  // -------------------------------------------------------------------------

  openVendor(npcId: number): void {
    this.openVendorNpcId = npcId;
    this.renderVendor();
    this.renderBags();
    $('#bags').style.display = 'block';
  }

  private renderVendor(): void {
    if (this.openVendorNpcId === null) return;
    const npc = this.sim.entities.get(this.openVendorNpcId);
    if (!npc) return;
    const el = $('#vendor-window');
    // the rebuild replaces the hovered row (its mouseleave never fires) and
    // collapses the scrolled list — drop the tooltip and restore the scroll
    this.hideTooltip();
    const scrollTop = el.scrollTop;
    let html = `<div class="panel-title"><span>${npc.name} — Goods</span><span class="x-btn" data-close>✕</span></div>`;
    el.innerHTML = html;
    for (const itemId of npc.vendorItems) {
      const item = ITEMS[itemId];
      if (!item?.buyValue) continue;
      const row = document.createElement('div');
      row.className = 'vendor-item';
      row.innerHTML = `${this.itemIcon(item)}<span class="vi-name">${item.name}</span><span class="vi-price">${this.moneyHtml(item.buyValue)}</span>`;
      row.addEventListener('click', () => {
        this.sim.buyItem(npc.id, itemId);
      });
      this.attachTooltip(row, () => this.itemTooltip(item) + '<div class="tt-sub">Click to buy</div>');
      el.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'vendor-hint';
    hint.textContent = 'Click an item in your bags to sell it while this window is open.';
    el.appendChild(hint);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeVendor());
    el.style.display = 'block';
    el.scrollTop = scrollTop;
  }

  closeVendor(): void {
    $('#vendor-window').style.display = 'none';
    this.openVendorNpcId = null;
    this.hideTooltip();
    if ($('#bags').style.display === 'block') this.renderBags();
  }

  get vendorOpen(): boolean {
    return this.openVendorNpcId !== null;
  }

  // -------------------------------------------------------------------------
  // Bags
  // -------------------------------------------------------------------------

  toggleBags(): void {
    const el = $('#bags');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); audio.bagClose(); return; }
    this.renderBags();
    el.style.display = 'block';
    audio.bagOpen();
  }

  // Called when an authoritative inventory delta lands (online snapshots
  // carry inventory separately from the event frames that normally redraw).
  onInventoryChanged(): void {
    if ($('#bags').style.display === 'block') this.renderBags();
  }

  renderBags(): void {
    const el = $('#bags');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>Bags</span><span class="x-btn" data-close>✕</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    if (sim.inventory.length === 0) {
      grid.innerHTML = `<div style="font-size:12px;color:#887c5c;padding:6px">Your bags are empty.</div>`;
    }
    for (const s of [...sim.inventory]) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const row = document.createElement('div');
      row.className = 'bag-item';
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      row.innerHTML = `${this.itemIcon(item)}<span style="color:${qColor}">${item.name}</span><span class="bi-count">${s.count > 1 ? 'x' + s.count : ''}</span>`;
      row.addEventListener('click', () => {
        if (this.tradeOpen) {
          this.addItemToTrade(s.itemId);
        } else if (this.vendorOpen) {
          this.sim.sellItem(s.itemId);
        } else {
          this.sim.useItem(s.itemId);
          this.renderBags();
        }
      });
      this.attachTooltip(row, () => {
        let extra = '';
        if (this.tradeOpen) extra = '<div class="tt-sub">Click to offer in trade</div>';
        else if (this.vendorOpen) extra = '<div class="tt-sub">Click to sell</div>';
        else if (item.kind === 'weapon' || item.kind === 'armor') extra = '<div class="tt-sub">Click to equip</div>';
        else if (item.kind === 'food' || item.kind === 'drink') extra = '<div class="tt-sub">Click to consume</div>';
        return this.itemTooltip(item) + extra;
      });
      grid.appendChild(row);
    }
    el.appendChild(grid);
    const money = document.createElement('div');
    money.className = 'money';
    money.innerHTML = this.moneyHtml(sim.copper);
    el.appendChild(money);
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  // -------------------------------------------------------------------------
  // Character window
  // -------------------------------------------------------------------------

  toggleChar(): void {
    const el = $('#char-window');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.renderChar();
    el.style.display = 'block';
  }

  renderChar(): void {
    const el = $('#char-window');
    const sim = this.sim;
    const p = sim.player;
    const cls = CLASSES[sim.cfg.playerClass];
    let html = `<div class="panel-title"><span>${p.name} <span style="color:#998d6a;font-size:11px">Level ${p.level} ${cls.name}</span></span><span class="x-btn" data-close>✕</span></div>`;
    html += `<div class="paperdoll"><div class="equip-col" id="equip-col"></div></div>`;
    const wpn = sim.equipment.mainhand ? ITEMS[sim.equipment.mainhand] : null;
    const dps = wpn?.weapon ? ((wpn.weapon.min + wpn.weapon.max) / 2 + (p.attackPower / 14) * wpn.weapon.speed) / wpn.weapon.speed : 0;
    html += `<div class="char-stats">
      <span>Strength: <b>${p.stats.str}</b></span><span>Armor: <b>${p.stats.armor}</b></span>
      <span>Agility: <b>${p.stats.agi}</b></span><span>Attack Power: <b>${p.attackPower}</b></span>
      <span>Stamina: <b>${p.stats.sta}</b></span><span>Damage/sec: <b>${dps.toFixed(1)}</b></span>
      <span>Intellect: <b>${p.stats.int}</b></span><span>Crit Chance: <b>${(p.critChance * 100).toFixed(1)}%</b></span>
      <span>Spirit: <b>${p.stats.spi}</b></span><span>Dodge: <b>${(p.dodgeChance * 100).toFixed(1)}%</b></span>
    </div>`;
    el.innerHTML = html;
    const col = el.querySelector('#equip-col')!;
    const slots: { key: 'mainhand' | 'chest' | 'legs' | 'feet'; name: string }[] = [
      { key: 'mainhand', name: 'Main Hand' },
      { key: 'chest', name: 'Chest' },
      { key: 'legs', name: 'Legs' },
      { key: 'feet', name: 'Feet' },
    ];
    for (const slot of slots) {
      const itemId = sim.equipment[slot.key];
      const item = itemId ? ITEMS[itemId] : null;
      const row = document.createElement('div');
      row.className = 'equip-slot';
      const qColor = !item ? '#666' : QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      row.innerHTML = `${item ? this.itemIcon(item) : `<img class="item-icon" style="border-color:#444" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`}
        <div><div class="slot-name">${slot.name}</div><div class="slot-item" style="color:${qColor}">${item ? item.name : 'Empty'}</div></div>`;
      if (item) this.attachTooltip(row, () => this.itemTooltip(item));
      col.appendChild(row);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  // -------------------------------------------------------------------------
  // Spellbook
  // -------------------------------------------------------------------------

  toggleSpellbook(): void {
    const el = $('#spellbook');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.renderSpellbook();
    el.style.display = 'block';
  }

  renderSpellbook(): void {
    const el = $('#spellbook');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>Spellbook</span><span class="x-btn" data-close>✕</span></div>`;
    const cls = CLASSES[sim.cfg.playerClass];
    for (const abilityId of cls.abilities) {
      const def = ABILITIES[abilityId];
      const known = sim.known.find((k) => k.def.id === abilityId) ?? null;
      const row = document.createElement('div');
      row.className = 'spell-row';
      const locked = !known;
      row.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', abilityId)});${locked ? 'filter:grayscale(1) brightness(0.5)' : ''}"></div>
        <div><div class="spell-name" style="${locked ? 'color:#777' : ''}">${def.name}${known && known.rank > 1 ? ` <span style="color:#998d6a;font-size:11px">Rank ${known.rank}</span>` : ''}</div>
        <div class="spell-sub">${locked ? `Trainable at level ${def.learnLevel}` : describeCost(known!, sim)}</div></div>`;
      if (known) this.attachTooltip(row, () => this.abilityTooltip(known));
      else this.attachTooltip(row, () => `<div class="tt-title" style="color:#999">${def.name}</div><div class="tt-sub">You will learn this at level ${def.learnLevel}.</div>`);
      el.appendChild(row);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  // -------------------------------------------------------------------------
  // Quest log window
  // -------------------------------------------------------------------------

  toggleQuestLog(): void {
    const el = $('#quest-log-window');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.renderQuestLog();
    el.style.display = 'block';
  }

  renderQuestLog(): void {
    const el = $('#quest-log-window');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>Quest Log <span style="color:#998d6a;font-size:11px">${sim.questLog.size} active &middot; ${sim.questsDone.size} completed</span></span><span class="x-btn" data-close>✕</span></div>`;
    const cols = document.createElement('div');
    cols.className = 'ql-cols';
    const list = document.createElement('div');
    list.className = 'ql-list';
    const detail = document.createElement('div');
    detail.className = 'ql-detail';
    cols.append(list, detail);
    el.appendChild(cols);

    const quests = [...sim.questLog.values()];
    if (quests.length === 0) {
      list.innerHTML = '<div style="color:#887c5c;font-size:12px;padding:4px">No active quests.</div>';
      detail.innerHTML = '<div class="qd-text">Seek out townsfolk marked with <span class="gold">!</span> to find work.</div>';
    }
    if (!this.selectedQuestLogId || !sim.questLog.has(this.selectedQuestLogId)) {
      this.selectedQuestLogId = quests[0]?.questId ?? null;
    }
    for (const qp of quests) {
      const quest = QUESTS[qp.questId];
      const item = document.createElement('div');
      item.className = 'ql-item' + (qp.questId === this.selectedQuestLogId ? ' sel' : '');
      item.textContent = `${quest.name}${qp.state === 'ready' ? ' ✓' : ''}`;
      item.addEventListener('click', () => { this.selectedQuestLogId = qp.questId; this.renderQuestLog(); });
      list.appendChild(item);
    }
    if (this.selectedQuestLogId) {
      const qp = sim.questLog.get(this.selectedQuestLogId)!;
      const quest = QUESTS[this.selectedQuestLogId];
      let html = `<div class="qd-sub" style="font-size:15px">${quest.name}${quest.suggestedPlayers ? ` <span style="color:#f96;font-size:11px">(Suggested players: ${quest.suggestedPlayers})</span>` : ''}</div>`;
      html += quest.objectives.map((o, i) => `<div class="qd-obj" style="color:${qp.counts[i] >= o.count ? '#7fdc4f' : '#cfc6a8'}">&bull; ${o.label}: ${qp.counts[i]}/${o.count}</div>`).join('');
      html += `<div class="qd-text" style="margin-top:8px">${quest.text.replace(/\$N/g, sim.player.name)}</div>`;
      html += `<div class="qd-sub">Rewards</div><div class="qd-obj">${quest.xpReward} experience &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
      const giver = NPCS[quest.turnInNpcId];
      html += `<div class="qd-obj" style="margin-top:6px;color:#998d6a">Return to ${giver?.name ?? '?'}</div>`;
      detail.innerHTML = html;
      const abandon = document.createElement('button');
      abandon.className = 'btn';
      abandon.textContent = 'Abandon Quest';
      abandon.addEventListener('click', () => { sim.abandonQuest(this.selectedQuestLogId!); this.renderQuestLog(); });
      detail.appendChild(abandon);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });
  }

  // -------------------------------------------------------------------------
  // Party frames
  // -------------------------------------------------------------------------

  private updatePartyFrames(): void {
    const el = $('#party-frames');
    const info = this.sim.partyInfo;
    if (!info) {
      if (el.innerHTML !== '') el.innerHTML = '';
      this.lastPartySig = '';
      return;
    }
    const others = info.members.filter((m) => m.pid !== this.sim.playerId);
    const sig = others.map((m) => `${m.pid}:${m.hp}/${m.mhp}:${m.res}:${m.dead}:${m.level}`).join('|') + `L${info.leader}`;
    if (sig === this.lastPartySig) return;
    this.lastPartySig = sig;
    el.innerHTML = '';
    for (const m of others) {
      const frame = document.createElement('div');
      frame.className = 'party-frame panel' + (m.dead ? ' dead' : '');
      const resClass = m.rtype === 'rage' ? 'rage' : m.rtype === 'energy' ? 'energy' : 'mana';
      frame.innerHTML = `
        <div class="pfm-name"><span>${CLASS_GLYPH[m.cls] ?? ''} ${m.name}</span><span class="lead">${info.leader === m.pid ? '★' : ''} ${m.level}</span></div>
        <div class="bar hp"><div class="bar-fill" style="transform:scaleX(${(m.hp / Math.max(1, m.mhp)).toFixed(3)})"></div></div>
        <div class="bar ${resClass}"><div class="bar-fill" style="transform:scaleX(${(m.res / Math.max(1, m.mres)).toFixed(3)})"></div></div>`;
      frame.addEventListener('click', () => this.sim.targetEntity(m.pid));
      frame.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.openContextMenu(m.pid, m.name, ev.clientX, ev.clientY);
      });
      el.appendChild(frame);
    }
    const leave = document.createElement('button');
    leave.className = 'btn';
    leave.id = 'party-leave';
    leave.textContent = 'Leave Party';
    leave.addEventListener('click', () => this.sim.partyLeave());
    el.appendChild(leave);
  }

  // -------------------------------------------------------------------------
  // Context menu on players
  // -------------------------------------------------------------------------

  openContextMenu(pid: number, name: string, x: number, y: number): void {
    const el = $('#ctx-menu');
    const party = this.sim.partyInfo;
    const isLeader = party?.leader === this.sim.playerId;
    const isMember = !!party?.members.some((m) => m.pid === pid);
    const ignored = this.isChatIgnored(name);
    let html = `<div class="ctx-title">${name}</div>`;
    if (!isMember) html += `<div class="ctx-item" data-act="invite">Invite to Party</div>`;
    html += `<div class="ctx-item" data-act="trade">Trade</div>`;
    html += `<div class="ctx-item" data-act="duel">Challenge to a Duel</div>`;
    html += `<div class="ctx-item" data-act="ignore">${ignored ? 'Unignore' : 'Ignore'} Chat</div>`;
    if (isLeader && isMember && pid !== this.sim.playerId) html += `<div class="ctx-item" data-act="kick">Remove from Party</div>`;
    html += `<div class="ctx-item" data-act="close">Cancel</div>`;
    el.innerHTML = html;
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 200, y)}px`;
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        if (act === 'invite') this.sim.partyInvite(pid);
        else if (act === 'trade') this.sim.tradeRequest(pid);
        else if (act === 'duel') this.sim.duelRequest(pid);
        else if (act === 'ignore') this.toggleChatIgnore(name);
        else if (act === 'kick') this.sim.partyKick(pid);
      });
    });
  }

  private chatIgnoreKey(name: string): string {
    return name.trim().toLowerCase();
  }

  private isChatIgnored(name: string): boolean {
    return this.ignoredChatNames.has(this.chatIgnoreKey(name));
  }

  private loadIgnoredChatNames(): Set<string> {
    try {
      const raw = localStorage.getItem(IGNORED_CHAT_NAMES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private saveIgnoredChatNames(): void {
    localStorage.setItem(IGNORED_CHAT_NAMES_KEY, JSON.stringify([...this.ignoredChatNames]));
  }

  private toggleChatIgnore(name: string): void {
    const key = this.chatIgnoreKey(name);
    if (!key) return;
    if (this.ignoredChatNames.has(key)) {
      this.ignoredChatNames.delete(key);
      this.log(`No longer ignoring ${name}.`, '#aaf');
    } else {
      this.ignoredChatNames.add(key);
      this.log(`Ignoring chat from ${name}.`, '#aaf');
    }
    this.saveIgnoredChatNames();
  }

  closeContextMenu(): void {
    $('#ctx-menu').style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Prompts (party invite / trade request / duel challenge)
  // -------------------------------------------------------------------------

  private showPrompt(text: string, acceptLabel: string, onAccept: () => void, onDecline: () => void): void {
    const stack = $('#prompt-stack');
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel';
    prompt.innerHTML = `<div class="prompt-text">${text}</div>`;
    const accept = document.createElement('button');
    accept.className = 'btn';
    accept.textContent = acceptLabel;
    const decline = document.createElement('button');
    decline.className = 'btn';
    decline.textContent = 'Decline';
    accept.addEventListener('click', () => { prompt.remove(); onAccept(); });
    decline.addEventListener('click', () => { prompt.remove(); onDecline(); });
    prompt.append(accept, decline);
    stack.appendChild(prompt);
    window.setTimeout(() => { if (prompt.isConnected) { prompt.remove(); onDecline(); } }, 28000);
  }

  // -------------------------------------------------------------------------
  // Trade window
  // -------------------------------------------------------------------------

  get tradeOpen(): boolean {
    return this.sim.tradeInfo !== null;
  }

  addItemToTrade(itemId: string): void {
    if (!this.tradeOpen || this.stagedTrade.items.length >= 6) return;
    const existing = this.stagedTrade.items.find((s) => s.itemId === itemId);
    const have = this.sim.inventory.find((s) => s.itemId === itemId)?.count ?? 0;
    if (existing) {
      if (existing.count < have) existing.count++;
    } else {
      this.stagedTrade.items.push({ itemId, count: 1 });
    }
    this.pushTradeOffer();
  }

  private pushTradeOffer(): void {
    this.sim.tradeSetOffer(this.stagedTrade.items, this.stagedTrade.copper);
  }

  private updateTradeWindow(): void {
    const el = $('#trade-window');
    const info = this.sim.tradeInfo;
    if (!info) {
      if (this.tradeWasOpen) {
        el.style.display = 'none';
        this.tradeWasOpen = false;
        this.stagedTrade = { items: [], copper: 0 };
        this.lastTradeSig = '';
      }
      return;
    }
    if (!this.tradeWasOpen) {
      this.tradeWasOpen = true;
      this.stagedTrade = { items: [], copper: 0 };
      this.renderBags();
      $('#bags').style.display = 'block';
    }
    const sig = JSON.stringify([info.myOffer, info.theirOffer, info.myAccepted, info.theirAccepted, this.stagedTrade]);
    if (sig === this.lastTradeSig) return;
    this.lastTradeSig = sig;

    const itemRow = (s: InvSlot, mine: boolean) => {
      const item = ITEMS[s.itemId];
      return `<div class="trade-item${mine ? ' mine' : ''}" data-item="${mine ? s.itemId : ''}">${this.itemIcon(item)}<span>${item?.name ?? s.itemId}${s.count > 1 ? ' x' + s.count : ''}</span></div>`;
    };
    el.innerHTML = `
      <div class="panel-title"><span>Trade with ${info.otherName}</span><span class="x-btn" data-close>✕</span></div>
      <div class="trade-cols">
        <div class="trade-col ${info.myAccepted ? 'accepted' : ''}">
          <h4>Your offer</h4>
          <div class="trade-items">${info.myOffer.items.map((s) => itemRow(s, true)).join('') || '<div style="color:#665c40;font-size:11px;padding:4px">Click items in your bags to add them</div>'}</div>
          <div class="trade-money">Money: <input id="trade-copper" type="number" min="0" value="${this.stagedTrade.copper}" /> copper</div>
        </div>
        <div class="trade-col ${info.theirAccepted ? 'accepted' : ''}">
          <h4>${info.otherName}'s offer</h4>
          <div class="trade-items">${info.theirOffer.items.map((s) => itemRow(s, false)).join('') || '<div style="color:#665c40;font-size:11px;padding:4px">Nothing offered yet</div>'}</div>
          <div class="trade-money">Money: <span class="gold">${formatMoney(info.theirOffer.copper)}</span></div>
        </div>
      </div>
      <div class="trade-hint">Click an offered item to remove it. Both sides must press Accept Trade.</div>`;
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn';
    acceptBtn.textContent = info.myAccepted ? 'Waiting…' : 'Accept Trade';
    acceptBtn.disabled = info.myAccepted;
    acceptBtn.addEventListener('click', () => this.sim.tradeConfirm());
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.sim.tradeCancel());
    el.append(acceptBtn, cancelBtn);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.sim.tradeCancel());
    el.querySelectorAll('.trade-item.mine').forEach((row) => {
      row.addEventListener('click', () => {
        const itemId = (row as HTMLElement).dataset.item!;
        const idx = this.stagedTrade.items.findIndex((s) => s.itemId === itemId);
        if (idx >= 0) {
          this.stagedTrade.items[idx].count--;
          if (this.stagedTrade.items[idx].count <= 0) this.stagedTrade.items.splice(idx, 1);
          this.pushTradeOffer();
        }
      });
    });
    const copperInput = el.querySelector('#trade-copper') as HTMLInputElement;
    copperInput?.addEventListener('change', () => {
      this.stagedTrade.copper = Math.max(0, Math.floor(Number(copperInput.value) || 0));
      this.pushTradeOffer();
    });
    el.style.display = 'block';
  }

  // -------------------------------------------------------------------------
  // Options menu (Esc) + hotkey rebinding
  // -------------------------------------------------------------------------

  attachOptions(hooks: OptionsHooks): void {
    this.optionsHooks = hooks;
  }

  get optionsOpen(): boolean {
    return $('#options-menu').style.display === 'block';
  }

  // True while a menu that should pause character movement is up.
  isModalOpen(): boolean {
    return this.optionsOpen;
  }

  toggleOptionsMenu(): void {
    if (this.optionsOpen) { this.closeOptions(); return; }
    this.optionsView = 'main';
    this.capturingKey = null;
    this.keybindNote = '';
    this.renderOptions();
    $('#options-menu').style.display = 'block';
    audio.click();
  }

  closeOptions(): void {
    $('#options-menu').style.display = 'none';
    this.capturingKey = null;
    this.hideTooltip();
  }

  private renderOptions(): void {
    if (this.optionsView === 'keybinds') { this.renderKeybinds(); return; }
    if (this.optionsView === 'graphics') { this.renderGraphics(); return; }
    if (this.optionsView === 'audio') { this.renderAudio(); return; }
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>Game Menu</span><span class="x-btn" data-close>✕</span></div>`;
    const list = document.createElement('div');
    list.className = 'opt-list';
    const add = (text: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn opt-btn';
      b.textContent = text;
      b.addEventListener('click', () => { audio.click(); onClick(); });
      list.appendChild(b);
    };
    const goto = (view: 'keybinds' | 'graphics' | 'audio') => { this.optionsView = view; this.keybindNote = ''; this.renderOptions(); };
    add('Key Bindings', () => goto('keybinds'));
    add('Graphics', () => goto('graphics'));
    add('Audio', () => goto('audio'));
    add('Logout', () => this.optionsHooks?.logout());
    add('Return to Game', () => this.closeOptions());
    el.appendChild(list);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  // A labelled slider bound to a numeric setting; live-applies via the hook.
  private settingSlider(parent: HTMLElement, label: string, key: keyof GameSettings): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const r = SETTING_RANGES[key];
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'set-slider';
    slider.min = String(r.min);
    slider.max = String(r.max);
    slider.step = '0.05';
    slider.value = String(hooks.settings.get(key));
    const val = document.createElement('span');
    val.className = 'set-val';
    const pct = () => `${Math.round(hooks.settings.get(key) * 100)}%`;
    val.textContent = pct();
    slider.addEventListener('input', () => {
      hooks.onSettingChange(key, Number(slider.value));
      val.textContent = pct();
    });
    row.append(name, slider, val);
    parent.appendChild(row);
  }

  private settingsViewShell(title: string): HTMLElement {
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>${title}</span><span class="x-btn" data-close>✕</span></div>`;
    const body = document.createElement('div');
    body.className = 'set-rows';
    el.appendChild(body);
    return body;
  }

  private settingsViewFooter(): void {
    const el = $('#options-menu');
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = 'Reset to Defaults';
    reset.addEventListener('click', () => {
      audio.click();
      this.optionsHooks?.settings.reset();
      // re-apply every setting to its subsystem, then redraw the view
      const all = this.optionsHooks?.settings.all();
      if (all) for (const k of Object.keys(all) as (keyof GameSettings)[]) this.optionsHooks?.onSettingChange(k, all[k]);
      this.renderOptions();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => { audio.click(); this.optionsView = 'main'; this.renderOptions(); });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private renderGraphics(): void {
    const body = this.settingsViewShell('Graphics');
    this.settingSlider(body, 'Camera Speed', 'cameraSpeed');
    this.settingSlider(body, 'Brightness', 'brightness');
    this.settingSlider(body, 'Render Quality', 'renderScale');
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = 'Lower Camera Speed for a calmer mouselook. Render Quality below 100% boosts FPS on weaker machines.';
    $('#options-menu').appendChild(note);
    this.settingsViewFooter();
  }

  private renderAudio(): void {
    const body = this.settingsViewShell('Audio');
    this.settingSlider(body, 'Sound Effects', 'sfxVolume');
    this.settingSlider(body, 'Music Volume', 'musicVolume');
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = 'Music';
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => { toggle.textContent = music.enabled ? 'On' : 'Off'; toggle.classList.toggle('off', !music.enabled); };
    sync();
    toggle.addEventListener('click', () => { audio.click(); music.setEnabled(!music.enabled); sync(); });
    row.append(name, toggle);
    body.appendChild(row);
    this.settingsViewFooter();
  }

  // Display name for an action row. Action-bar slots show the ability that
  // currently occupies them (slot 0 is always Attack); everything else uses
  // its registry label.
  private actionDisplayName(actionId: string, fallback: string): string {
    if (!actionId.startsWith('slot')) return fallback;
    const slot = Number(actionId.slice(4));
    if (slot === 0) return 'Attack';
    const known = this.abilityForSlot(slot);
    return known ? known.def.name : fallback;
  }

  private renderKeybinds(): void {
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>Key Bindings</span><span class="x-btn" data-close>✕</span></div>`;
    const note = document.createElement('div');
    note.className = 'kb-note';
    note.textContent = this.keybindNote || 'Click a key cell, then press a key to bind it. Esc cancels. Each action has a primary and an alternate key.';
    el.appendChild(note);
    const rows = document.createElement('div');
    rows.className = 'kb-rows';
    for (const category of BIND_CATEGORIES) {
      const header = document.createElement('div');
      header.className = 'kb-cat';
      header.textContent = category;
      rows.appendChild(header);
      for (const action of BIND_ACTIONS.filter((a) => a.category === category)) {
        const row = document.createElement('div');
        row.className = 'kb-row';
        const name = document.createElement('span');
        name.className = 'kb-name';
        name.textContent = this.actionDisplayName(action.id, action.label);
        row.appendChild(name);
        for (let index = 0; index < 2; index++) {
          const capturing = this.capturingKey?.action === action.id && this.capturingKey?.index === index;
          const key = document.createElement('button');
          key.className = 'btn kb-key' + (capturing ? ' capturing' : '');
          key.textContent = capturing ? '…' : (this.keybinds.labelAt(action.id, index) || '—');
          key.title = index === 0 ? 'Primary' : 'Alternate';
          key.addEventListener('click', () => this.beginCapture(action.id, index, action.label));
          row.appendChild(key);
        }
        rows.appendChild(row);
      }
    }
    el.appendChild(rows);
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = 'Reset to Defaults';
    reset.addEventListener('click', () => {
      audio.click();
      this.keybinds.reset();
      this.capturingKey = null;
      this.keybindNote = 'Bindings reset to defaults.';
      this.refreshKeybindLabels();
      this.renderKeybinds();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => { audio.click(); this.optionsView = 'main'; this.capturingKey = null; this.renderOptions(); });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private beginCapture(actionId: string, index: number, fallbackLabel: string): void {
    if (!this.optionsHooks) return;
    const name = this.actionDisplayName(actionId, fallbackLabel);
    this.capturingKey = { action: actionId, index };
    this.keybindNote = `Press a key for "${name}"…`;
    this.renderKeybinds();
    this.optionsHooks.captureKey((code) => {
      this.capturingKey = null;
      if (code === null) {
        this.keybindNote = 'Rebinding cancelled.';
      } else if (isReservedCode(code)) {
        this.keybindNote = `${keyLabel(code)} is reserved and can't be bound.`;
      } else if (this.keybinds.bind(actionId, index, code)) {
        this.keybindNote = `Bound "${name}" to ${keyLabel(code)}.`;
        this.refreshKeybindLabels();
      }
      // re-render only if the menu is still open (player may have closed it)
      if (this.optionsOpen) this.renderKeybinds();
    });
  }

  // -------------------------------------------------------------------------

  // Closes the topmost UI. Returns true if something was closed.
  closeAll(): boolean {
    let closed = false;
    this.closeContextMenu();
    if (this.optionsOpen) { this.closeOptions(); return true; }
    if (this.tradeOpen) {
      this.sim.tradeCancel();
      closed = true;
    }
    for (const id of ['#quest-dialog', '#loot-window', '#vendor-window', '#bags', '#char-window', '#spellbook', '#quest-log-window', '#map-window']) {
      const el = $(id);
      if (el.style.display === 'block') {
        el.style.display = 'none';
        closed = true;
      }
    }
    if (closed) {
      this.openLootMobId = null;
      this.openVendorNpcId = null;
      this.hideTooltip();
    }
    return closed;
  }
}

function describeCost(known: ResolvedAbility, sim: IWorld): string {
  const resName = sim.player.resourceType === 'rage' ? 'Rage' : sim.player.resourceType === 'energy' ? 'Energy' : 'Mana';
  const parts: string[] = [];
  if (known.cost > 0) parts.push(`${known.cost} ${resName}`);
  parts.push(known.def.channel ? 'Channeled' : known.castTime > 0 ? `${known.castTime}s cast` : 'Instant');
  if (known.def.cooldown > 0) parts.push(`${known.def.cooldown}s cooldown`);
  return parts.join(' · ');
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
  } else {
    r = Math.round(r * (1 + amt));
    g = Math.round(g * (1 + amt));
    b = Math.round(b * (1 + amt));
  }
  return `rgb(${r},${g},${b})`;
}
