import { audio } from '../../../game/audio';
import type { IWorld } from '../../../world_api';
import { DungeonFinderProposalPopup } from '../../dungeon_finder_proposal_popup';
import { DungeonFinderWindow } from '../../dungeon_finder_window';
import type { PainterHostPresentation, PainterHostWriters } from '../../painter_host';
import type { WindowFocusBridge } from '../../window_focus';
import { ExpeditionController } from './expedition_controller';

interface FinderSurfaceHost {
  world(): IWorld;
  root(selector: string): HTMLElement;
  focus(selector: string): WindowFocusBridge;
  closeOthers(selector: string): void;
  hideTooltip(): void;
  showOnMap(x: number, z: number): void;
  openFinder(): void;
  maskPlayerText(note: string): string;
  presentation: PainterHostPresentation;
  writers: PainterHostWriters;
}

/** Compose the shared Groups window, queue proposal and notification bell with one world and shared focus/writer seams. */
export function createFinderSurfaces(host: FinderSurfaceHost) {
  const window = new DungeonFinderWindow({
    ...host.presentation,
    world: host.world,
    root: () => host.root('#dungeon-finder-window'),
    closeOthers: () => host.closeOthers('#dungeon-finder-window'),
    hideTooltip: host.hideTooltip,
    showOnMap: host.showOnMap,
    maskPlayerText: host.maskPlayerText,
    ...host.focus('#dungeon-finder-window'),
  });
  return {
    window,
    proposal: new DungeonFinderProposalPopup({
      world: host.world,
      root: () => host.root('#dfinder-proposal-popup'),
    }),
    expeditions: new ExpeditionController({
      world: host.world,
      writers: host.writers,
      openFinder: () => window.open(),
      openRecruitment: () => window.open('board'),
      notify: () => audio.duelChallenge(),
      maskPlayerText: host.maskPlayerText,
    }),
  };
}
