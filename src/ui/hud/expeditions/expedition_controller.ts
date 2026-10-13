import { finderActivity } from '../../../sim/content/dungeon_finder';
import type { IWorld } from '../../../world_api';
import { lockoutMinutesFor } from '../../dungeon_finder_view';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { WindowFocusBridge } from '../../window_focus';

interface ExpeditionDeps extends Partial<WindowFocusBridge> {
  world(): IWorld;
  writers: PainterHostWriters;
  openFinder(): void;
  openRecruitment?(): void;
  notify?(): void;
  maskPlayerText?(note: string): string;
}

/** A notification entry point only. Groups owns all browsing and expedition controls. */
export class ExpeditionController {
  private static mounted: ExpeditionController | null = null;
  private disposed = false;
  private lastWorld: IWorld | null = null;
  private root: HTMLElement | null = null;
  private bell: HTMLButtonElement | null = null;
  private badge: HTMLElement | null = null;
  private lastSig = '';
  private readListings = new Set<number>();
  private soundedListings = new Set<number>();
  private soundedRequests = new Set<number>();
  private readFeedbackSeq = 0;

  constructor(private readonly deps: ExpeditionDeps) {}

  private mount(): void {
    if (this.root) return;
    ExpeditionController.mounted?.dispose();
    ExpeditionController.mounted = this;
    this.root = document.createElement('section');
    this.root.id = 'expedition-hud';
    this.root.innerHTML = `<div class="expedition-tools"><button type="button" id="expedition-bell" class="ui-icon-btn" aria-controls="dungeon-finder-window" aria-haspopup="dialog">${svgIcon('bell')}<span class="ui-badge ui-badge--corner" data-badge></span></button></div>`;
    document.getElementById('ui')?.append(this.root);
    this.bell = this.root.querySelector<HTMLButtonElement>('#expedition-bell');
    this.badge = this.root.querySelector('[data-badge]');
    this.bell?.addEventListener('click', () => this.toggle());
  }

  private dispose(): void {
    this.disposed = true;
    this.root?.remove();
    this.root = null;
  }

  private compatibleListings(world: IWorld): number[] {
    const info = world.dungeonFinderInfo;
    if (!info || world.partyInfo || info.myListing || info.queue || info.proposal) return [];
    const applications = info.myApplications ?? (info.myApplication ? [info.myApplication] : []);
    const lockouts = world.raidLockouts();
    return (world.dungeonFinderBoard ?? [])
      .filter((row) => {
        const activity = finderActivity(row.activityId);
        return (
          !!activity &&
          world.player.level >= activity.minLevel &&
          world.player.level <= activity.maxLevel &&
          lockoutMinutesFor(activity, lockouts) === 0 &&
          row.size < row.capacity &&
          !applications.some((application) => application.listingId === row.id) &&
          info.eligibleRoles.some((role) => !row.needed || row.needed[role] > 0)
        );
      })
      .map((row) => row.id);
  }

  toggle(_section: 'alerts' | 'groups' = 'groups'): void {
    if (this.disposed) return;
    this.render();
    const world = this.deps.world();
    for (const id of this.compatibleListings(world)) this.readListings.add(id);
    this.readFeedbackSeq = world.dungeonFinderInfo?.applicationFeedback?.seq ?? 0;
    this.deps.openFinder();
    this.render();
  }

  // There is no second window for Hud.closeAll to dismiss.
  close(): boolean {
    return false;
  }

  relocalize(): void {
    this.lastSig = '';
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    const world = this.deps.world();
    if (this.lastWorld !== world) {
      this.readListings.clear();
      this.soundedListings.clear();
      this.soundedRequests.clear();
      this.readFeedbackSeq = 0;
      this.lastSig = '';
      this.lastWorld = world;
    }
    const info = world.dungeonFinderInfo;
    const listings = this.compatibleListings(world);
    // Prune departed rows: the book stays bounded by the authoritative board cap.
    const liveListings = new Set((world.dungeonFinderBoard ?? []).map((row) => row.id));
    this.readListings = new Set([...this.readListings].filter((id) => liveListings.has(id)));
    this.soundedListings = new Set([...this.soundedListings].filter((id) => liveListings.has(id)));
    const requests = (info?.myListing?.applicants ?? []).filter(
      (request) => request.remaining !== 0,
    );
    const freshListings = listings.filter((id) => !this.readListings.has(id));
    const feedback = info?.applicationFeedback;
    const attention =
      requests.length +
      freshListings.length +
      (feedback && feedback.seq !== this.readFeedbackSeq ? 1 : 0);
    let sound = false;
    try {
      sound = localStorage.getItem('woc_expedition_sound') === '1';
    } catch {
      /* Storage can be disabled. */
    }
    if (!world.player.inCombat) {
      const fresh =
        freshListings.some((id) => !this.soundedListings.has(id)) ||
        requests.some((request) => !this.soundedRequests.has(request.pid));
      if (fresh && sound) this.deps.notify?.();
      for (const id of listings) this.soundedListings.add(id);
      this.soundedRequests = new Set(requests.map((request) => request.pid));
    }
    const sig = `${attention}|${info?.queueRewards?.equipped ?? 'default'}`;
    if (sig === this.lastSig) {
      return;
    }
    this.lastSig = sig;
    this.mount();
    if (!this.bell || !this.badge) return;
    const count = formatNumber(attention, { maximumFractionDigits: 0 });
    this.deps.writers.setAttr(this.bell, 'aria-label', t('hudChrome.expeditions.bell', { count }));
    this.deps.writers.setText(this.badge, count);
    this.deps.writers.setStyleProp(this.badge, 'display', attention ? '' : 'none');
    this.deps.writers.toggleClass(this.bell, 'expedition-bell-alert', attention > 0);
    this.deps.writers.setAttr(this.bell, 'data-finish', info?.queueRewards?.equipped ?? 'default');
  }
}
