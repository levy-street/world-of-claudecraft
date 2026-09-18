import { sfx } from '../../../game/sfx';
import type { WorldQuestProgress } from '../../../sim/types';
import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { createWispMazeHudView } from '../../world_quest_wisp_maze_view';

/** Owner-only instruments. Movement and collection remain in the physical maze. */
export class WispMazeHudController {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly lives: HTMLElement;
  private readonly powerLabel: HTMLElement;
  private readonly power: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly cue: HTMLElement;
  private readonly leave: HTMLButtonElement;
  private active = false;
  private readonly view = createWispMazeHudView();

  constructor(
    document: Document,
    private readonly writers: PainterHostWriters,
    private readonly play: (key: string, gain: number) => void = (key, gain) =>
      sfx.playUi(key, { gain }),
    leaveMaze: () => void = () => {},
  ) {
    const element = (tag: string, className: string) => {
      const node = document.createElement(tag);
      node.className = className;
      return node;
    };
    this.root = element('section', 'wisp-maze-hud');
    this.root.id = 'wisp-maze-hud';
    this.title = element('div', 'wisp-maze-title');
    this.progress = element('div', 'wisp-maze-progress');
    this.lives = element('div', 'wisp-maze-lives');
    this.powerLabel = element('div', 'wisp-maze-power-label');
    this.power = element('div', 'wisp-maze-power');
    this.fill = element('span', 'wisp-maze-power-fill');
    this.cue = element('div', 'wisp-maze-cue');
    this.leave = document.createElement('button');
    this.leave.type = 'button';
    this.leave.className = 'wisp-maze-leave';
    this.leave.addEventListener('click', () => {
      if (this.active) leaveMaze();
    });
    this.power.append(this.fill);
    this.root.append(
      this.title,
      this.progress,
      this.lives,
      this.powerLabel,
      this.power,
      this.cue,
      this.leave,
    );
    writers.setAttr(this.root, 'role', 'region');
    writers.setAttr(this.power, 'role', 'meter');
    writers.setAttr(this.power, 'aria-valuemin', '0');
    writers.setAttr(this.power, 'aria-valuemax', '100');
    writers.setAttr(this.cue, 'role', 'status');
    writers.setAttr(this.cue, 'aria-live', 'polite');
    writers.setDisplay(this.root, 'none');
    document.getElementById('ui')?.append(this.root);
  }

  update(progress?: WorldQuestProgress, ownsControls?: boolean): void {
    const view = this.view.tick(progress);
    const w = this.writers;
    this.active = view.active;
    w.toggleClass(this.root.ownerDocument.body, 'playing-wisp-maze', ownsControls ?? view.active);
    w.setDisplay(this.root, view.visible ? 'grid' : 'none');
    if (!view.visible) return;
    w.setAttr(this.root, 'aria-label', view.title);
    w.setText(this.title, view.title);
    w.setText(this.progress, view.progress);
    w.setText(this.lives, view.lives);
    w.setText(this.powerLabel, view.powerLabel);
    w.setAttr(this.power, 'aria-label', view.powerLabel);
    w.setAttr(this.power, 'aria-valuenow', String(view.powerPercent));
    w.setStyleProp(this.fill, 'width', `${view.powerPercent}%`);
    w.setText(this.cue, view.cue);
    w.setText(this.leave, t('questUi.worldQuest.wispMaze.leave'));
    w.setStyleProp(this.leave, 'display', view.active ? '' : 'none');
    if (view.sound) this.play(view.sound, view.sound === 'ui_coin' ? 0.2 : 0.45);
  }
}

export function buildWispMazeHud(
  writers: PainterHostWriters,
  leaveMaze?: () => void,
): WispMazeHudController | null {
  return typeof document === 'undefined' || !document.getElementById('ui')
    ? null
    : new WispMazeHudController(document, writers, undefined, leaveMaze);
}
