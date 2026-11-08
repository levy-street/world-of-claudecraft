import type { RoutePoint } from './quest_map';

export interface ItemAcquisition {
  title: string;
  steps: string[];
  details?: string[];
  points?: RoutePoint[];
}

export function addAcquisition(
  index: Map<string, ItemAcquisition[]>,
  id: string,
  source: ItemAcquisition,
) {
  const sources = index.get(id) ?? [];
  sources.push(source);
  index.set(id, sources);
}
