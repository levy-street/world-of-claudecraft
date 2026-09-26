import { localPartyMemberIds } from '../game/corpse_loot_availability';
import { nonSelfRepaintDue } from '../game/ui_tier_knobs';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';
import { focusedWithin } from './focus_restore';
import { FocusTargetSlots } from './focus_targets_core';
import type { FrameContextAction } from './frame_context_menu';
import { isPvpHostileTarget } from './hud/action_bar/attack_on_ability';
import { formatNumber, t } from './i18n';
import { type MouseoverCastAbility, mouseoverCastTargetPid } from './mouseover_cast_core';
import type { PainterHostWriters } from './painter_host';
import { fillTargetOfTargetDescriptor } from './target_frame_descriptor';
import { newUnitFrameBuffer, type UnitFrameDescriptor, unitFrameViewInto } from './unit_frame';
import { UnitFramePainter } from './unit_frame_painter';

export interface FocusTargetsDeps {
  document: Document;
  world(): IWorld;
  writers: PainterHostWriters;
  keybinds: { primaryLabel(id: string): string };
  showEmpty?(): boolean;
}

export class FocusTargetsController {
  private readonly slots = new FocusTargetSlots();
  private readonly rows: Array<{
    root: HTMLElement;
    assign: HTMLButtonElement;
    frame: HTMLButtonElement;
    hint: HTMLElement;
    key: HTMLElement;
    reaction: HTMLElement;
    painter: UnitFramePainter;
    descriptor: UnitFrameDescriptor;
    view: ReturnType<typeof newUnitFrameBuffer>;
    chrome: string;
    lastPaintAt: number;
  }> = [];

  constructor(private readonly deps: FocusTargetsDeps) {
    const doc = deps.document;
    const root = doc.createElement('div');
    root.id = 'focus-targets';
    root.className = 'focus-targets';
    doc.getElementById('ui')?.appendChild(root);
    for (let slot = 0; slot < this.slots.ids.length; slot++) {
      const row = doc.createElement('div');
      row.className = 'focus-target-row ui-panel focus-empty';
      row.classList.toggle('focus-hide-empty', !deps.showEmpty?.());
      row.id = `focus-target-${slot + 1}`;
      const assign = doc.createElement('button');
      assign.type = 'button';
      assign.className = 'ui-btn focus-assign';
      assign.addEventListener('click', () => this.action(slot, true));
      const frame = doc.createElement('button');
      frame.type = 'button';
      frame.className = 'focus-unit unitframe';
      frame.addEventListener('click', () => this.action(slot, false));
      const bars = doc.createElement('span');
      bars.className = 'uf-bars';
      const header = doc.createElement('span');
      header.className = 'uf-name-header ui-ribbon ui-ribbon--mirror';
      const name = doc.createElement('span');
      name.className = 'uf-name';
      const level = doc.createElement('span');
      const hp = this.bar(doc);
      const resource = this.bar(doc);
      resource.container.classList.add('resource', 'ui-bevel--res');
      resource.container.classList.remove('hp');
      header.append(name, level);
      bars.append(header, hp.container, resource.container);
      frame.append(bars);
      row.append(assign, frame);
      row.addEventListener('mouseenter', () => {
        this.hoveredSlot = slot;
      });
      row.addEventListener('mouseleave', () => {
        if (this.hoveredSlot === slot) this.hoveredSlot = null;
      });
      const hint = doc.createElement('div');
      hint.className = 'focus-target-hint';
      row.appendChild(hint);
      const key = doc.createElement('span');
      key.className = 'focus-target-key ui-keycap';
      const reaction = doc.createElement('span');
      reaction.className = 'focus-target-reaction';
      row.append(key, reaction);
      root.appendChild(row);
      this.rows.push({
        root: row,
        assign,
        frame,
        hint,
        key,
        reaction,
        painter: new UnitFramePainter(
          deps.writers,
          {
            frame,
            name,
            level,
            hpFill: hp.fill,
            hpText: hp.text,
            resource,
          },
          { shownDisplay: 'flex' },
        ),
        descriptor: {
          present: false,
          hpFrac: 0,
          hpText: '',
          resourceKind: 'none',
          resFrac: 0,
          resText: '',
          levelText: null,
          name: '',
          portraitKey: '',
          absorb: null,
          dead: false,
          outOfRange: false,
        },
        view: newUnitFrameBuffer(),
        chrome: '',
        lastPaintAt: -Infinity,
      });
    }
    this.relocalize();
  }

  private bar(doc: Document): { container: HTMLElement; fill: HTMLElement; text: HTMLElement } {
    const container = doc.createElement('span');
    container.className = 'bar hp ui-bevel ui-bevel--mirror';
    const fill = doc.createElement('span');
    fill.className = 'bar-fill ui-bevel-fill';
    const text = doc.createElement('span');
    text.className = 'bar-text ui-bevel-text';
    const ticks = doc.createElement('span');
    ticks.className = 'ui-bevel-ticks';
    const edge = doc.createElement('span');
    edge.className = 'ui-bevel-edge';
    container.append(fill, ticks, edge, text);
    return { container, fill, text };
  }

  private hoveredSlot: number | null = null;
  get hoveredEntityId(): number | null {
    const world = this.deps.world();
    return this.hoveredSlot === null || world.actionBarReadOnly
      ? null
      : this.slots.target(this.hoveredSlot, (id) => world.entities.has(id));
  }
  castTarget(
    ability: MouseoverCastAbility,
    partyHover: number | null,
    enabled: boolean,
  ): number | null {
    const world = this.deps.world();
    const focus = this.hoveredEntityId;
    return mouseoverCastTargetPid(focus ?? partyHover, ability, {
      enabled,
      hasEntity: (id) => world.entities.has(id),
      partyMemberPids: () => localPartyMemberIds(world.partyInfo),
    });
  }
  clear(slot: number): void {
    if (this.deps.world().actionBarReadOnly) return;
    const row = this.rows[slot];
    const restoreFocus = row && focusedWithin(row.root);
    this.slots.assign(slot, null);
    this.update();
    if (restoreFocus) {
      if (this.deps.showEmpty?.() || row.root.classList.contains('tf-unlocked')) row.assign.focus();
      else row.frame.blur();
    }
  }
  contextActions(id: string): readonly FrameContextAction[] {
    const slot = Number(id.match(/^focusTarget([123])$/)?.[1]) - 1;
    return this.slots.ids[slot] != null && !this.deps.world().actionBarReadOnly
      ? [{ labelKey: 'hudChrome.focusTargets.unset', run: () => this.clear(slot) }]
      : [];
  }

  action(slot: number, assign: boolean): void {
    const world = this.deps.world();
    if (world.actionBarReadOnly) return;
    const row = this.rows[slot];
    const restoreFocus = row && focusedWithin(row.root);
    if (assign) {
      const id = world.player.targetId;
      if (id !== null && world.entities.get(id)?.kind !== 'object' && world.entities.has(id)) {
        this.slots.assign(slot, id);
      }
    } else {
      const id = this.slots.target(slot, (id) => world.entities.has(id));
      if (id !== null) world.targetEntity(id);
    }
    this.update();
    if (assign && restoreFocus && this.slots.ids[slot] !== null) row.frame.focus();
  }

  reset(): void {
    this.hoveredSlot = null;
    for (let slot = 0; slot < this.rows.length; slot++) this.slots.assign(slot, null);
    this.relocalize();
    this.update();
  }

  relocalize(): void {
    for (let slot = 0; slot < this.rows.length; slot++) {
      const row = this.rows[slot];
      row.chrome = '';
      const number = formatNumber(slot + 1, { maximumFractionDigits: 0 });
      row.assign.textContent = t('hudChrome.focusTargets.assign', { slot: number });
    }
  }

  private hostile(entity: Entity, world: IWorld): boolean {
    const owner = entity.ownerId == null ? undefined : world.entities.get(entity.ownerId);
    const player = entity.kind === 'player' ? entity : owner?.kind === 'player' ? owner : null;
    return player
      ? isPvpHostileTarget(player.id, world.duelInfo, world.arenaInfo, world.bgInfo)
      : !!entity.hostile;
  }

  update(now = 0, intervalMs = 0): void {
    const world = this.deps.world();
    const writers = this.deps.writers;
    for (let slot = 0; slot < this.rows.length; slot++) {
      const row = this.rows[slot];
      const id = this.slots.ids[slot];
      const key = this.deps.keybinds.primaryLabel(
        `${id === null ? 'set' : 'target'}Focus${slot + 1}`,
      );
      const entity = id === null ? undefined : world.entities.get(id);
      const hostile = entity ? this.hostile(entity, world) : false;
      const chrome = `${id}/${!!entity}/${key}/${hostile}/${!!this.deps.showEmpty?.()}`;
      const changed = row.chrome !== chrome;
      if (changed) {
        row.chrome = chrome;
        writers.setText(
          row.hint,
          id === null
            ? t(
                key
                  ? 'hudChrome.focusTargets.assignHint'
                  : 'hudChrome.focusTargets.assignClickHint',
                {
                  key,
                  button: t('hudChrome.focusTargets.assign', {
                    slot: formatNumber(slot + 1, { maximumFractionDigits: 0 }),
                  }),
                },
              )
            : '',
        );
        writers.setDisplay(row.assign, id === null ? '' : 'none');
        writers.setStyleProp(row.hint, 'display', id === null ? '' : 'none');
        writers.setText(row.key, key);
        writers.setStyleProp(row.key, 'display', key ? '' : 'none');
        writers.setText(
          row.reaction,
          entity ? t(hostile ? 'hudChrome.focusTargets.enemy' : 'hudChrome.focusTargets.ally') : '',
        );
        writers.toggleClass(row.root, 'focus-hostile', !!entity && hostile);
        writers.toggleClass(row.root, 'focus-friendly', !!entity && !hostile);
        writers.toggleClass(row.root, 'focus-hide-empty', !this.deps.showEmpty?.());
        writers.toggleClass(row.root, 'focus-empty', !entity);
      }
      if (!changed && (!entity || !nonSelfRepaintDue(false, row.lastPaintAt, now, intervalMs)))
        continue;
      row.lastPaintAt = now;
      if (entity) fillTargetOfTargetDescriptor(row.descriptor, entity, 3);
      else row.descriptor.present = false;
      row.painter.paint(unitFrameViewInto(row.view, row.descriptor));
    }
  }
}
