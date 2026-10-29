// The server half of the Stealth Rework footprints: the per-viewer `sfp`
// snapshot suffix.
//
// Cost model. beginBroadcast does the viewer-independent work once per pass:
// it finds the trails with a readable print (footprintSourceViews walks the
// player roster; with none, which is the common case, it allocates nothing and
// every viewer's suffix is free) and serializes each readable print's row ONE
// time. Readable historical print cells form one shared candidate index. Each
// viewer lazily merges its nine cells in original source order, then the exact
// radius/hostility filter joins pre-built rows (capped at FOOTPRINT_VIEW_CAP).
// Far realm trails cost no per-viewer bounds walk; teleport gaps cost no cells.
//
// Bandwidth. A row is [x, y, z, facing, bornAt, foot]: the print's birth time,
// never its age, so a row is immutable once written. The joined list is sent
// only when it differs from what this session last received (the session's
// lastSent cache under `sfp`); an absent key means "unchanged" and the client
// re-ages what it holds from the snapshot clock, and an explicit [] clears it.
// So the list re-ships when a print enters or leaves the viewer's readable
// set, a few times a second near a moving stealther, never every snapshot.

import {
  type FootprintRoster,
  type FootprintSourceView,
  type FootprintWorld,
  footprintSourceViews,
  forEachVisibleFootprint,
} from '../src/sim/stealth_footprints';
import type { Entity } from '../src/sim/types';
import { StealthFootprintCandidates } from './stealth_footprint_candidates';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export const FOOTPRINT_WIRE_KEY = 'sfp';

export class StealthFootprintWire {
  private views: readonly FootprintSourceView[] = [];
  private candidates = new StealthFootprintCandidates([]);
  /** Pre-serialized rows, parallel to each view's prints. */
  private rows = new Map<FootprintSourceView, string[]>();
  private readonly picked: string[] = [];

  constructor(private readonly world: FootprintWorld & FootprintRoster) {}

  /** Refresh the readable prints and their rows; call once per broadcast pass. */
  beginBroadcast(): this {
    this.views = footprintSourceViews(this.world);
    this.candidates = new StealthFootprintCandidates(this.views);
    this.rows = new Map();
    for (const view of this.views) {
      this.rows.set(
        view,
        view.prints.map(
          (p) =>
            `[${round1(p.x)},${round1(p.y)},${round1(p.z)},${round2(p.facing)},${round2(p.t)},${p.foot}]`,
        ),
      );
    }
    return this;
  }

  /** The viewer's suffix: '' when nothing changed since `lastSent` (and when
   *  there was never anything to send). */
  suffixFor(viewer: Entity, lastSent: Record<string, string>): string {
    this.picked.length = 0;
    forEachVisibleFootprint(
      this.world,
      viewer,
      this.candidates.forViewer(viewer),
      (_p, view, index) => {
        this.picked.push((this.rows.get(view) as string[])[index]);
      },
    );
    const json = `[${this.picked.join(',')}]`;
    const prior = lastSent[FOOTPRINT_WIRE_KEY];
    if (json === (prior ?? '[]')) return '';
    lastSent[FOOTPRINT_WIRE_KEY] = json;
    return `,"${FOOTPRINT_WIRE_KEY}":${json}`;
  }
}
