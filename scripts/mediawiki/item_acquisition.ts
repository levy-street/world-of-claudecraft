import type { ItemDef } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import type { ItemAcquisition } from './item_acquisition_types';
import { activityAcquisitions } from './item_activity_acquisition';
import { dropAcquisitions } from './item_drop_acquisition';
import { gatheringAcquisitions } from './item_gathering_acquisition';
import { questAcquisitions } from './item_quest_acquisition';
import { vendorCraftAcquisitions } from './item_vendor_craft';
import { questMap, type RoutePoint } from './quest_map';

export function itemAcquisitionIndex(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const all = new Map<string, ItemAcquisition[]>();
  for (const index of [
    vendorCraftAcquisitions(w),
    questAcquisitions(w),
    dropAcquisitions(w),
    gatheringAcquisitions(w),
    activityAcquisitions(w),
  ]) {
    for (const [id, rows] of index) all.set(id, [...(all.get(id) ?? []), ...rows]);
  }
  return all;
}

export function itemAcquisitionArticle(
  w: ArticleTools,
  item: ItemDef,
  entries: ItemAcquisition[],
  fallback: string[],
): string {
  if (!entries.length) {
    return w.section(
      'How to get',
      'No complete, verified acquisition route was found in this edition. ' +
        (fallback.length
          ? 'The recorded source notes are listed below.'
          : 'A drop chance, shop price or map location cannot be confirmed.'),
    );
  }
  const points: RoutePoint[] = [];
  const text = entries
    .map((source, i) => {
      for (const p of source.points ?? []) {
        const action =
          p.step === 'Start'
            ? 'start'
            : p.step === 'Hand-in' || p.step === 'Reward'
              ? 'collect'
              : 'step ' + p.step;
        points.push({ ...p, step: i + 1, label: source.title + ' · ' + action + ' · ' + p.label });
      }
      return (
        '=== Source ' +
        (i + 1) +
        ' · ' +
        source.title +
        ' ===\n' +
        (source.details ?? []).map((d) => d + '\n\n').join('') +
        source.steps.map((s) => '# ' + s).join('\n') +
        '\n\n'
      );
    })
    .join('\n');
  const unique = new Map(points.map((p) => [[p.frame, p.x, p.z, p.step, p.label].join('|'), p]));
  return (
    w.section(
      'How to get',
      (entries.length > 1
        ? 'These are alternative ways to obtain ' +
          item.name +
          '. Choose a source you can access.\n\n'
        : '') + text,
    ) + questMap({ points: [...unique.values()] }, 'item')
  );
}
