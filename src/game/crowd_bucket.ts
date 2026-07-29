// Crowd-size bucketing for fleet perf reports (packet 0 ruling R3). Pure and
// host-agnostic: the label is computed from the renderer's activeViews (the
// draw-band count, consistent across the offline Sim and the online
// ClientWorld), and the raw simEntities/activeViews/visibleViews numbers ship
// beside it in the payload. The server keeps its OWN copy of this label list
// (server/ cannot import src/game); tests/perf_report.test.ts pins the two
// catalogs equal so they cannot drift.

export const CROWD_BUCKET_LABELS = [
  'lt10',
  '10-24',
  '25-49',
  '50-99',
  '100plus',
  'unknown',
] as const;

export type CrowdBucketLabel = (typeof CROWD_BUCKET_LABELS)[number];

// A missing renderer frame (first report before any sync) or a nonsensical
// count folds to 'unknown' rather than polluting the lt10 bucket.
export function crowdBucketLabel(activeViews: number | null | undefined): CrowdBucketLabel {
  if (activeViews === null || activeViews === undefined) return 'unknown';
  if (!Number.isFinite(activeViews) || activeViews < 0) return 'unknown';
  if (activeViews < 10) return 'lt10';
  if (activeViews < 25) return '10-24';
  if (activeViews < 50) return '25-49';
  if (activeViews < 100) return '50-99';
  return '100plus';
}
