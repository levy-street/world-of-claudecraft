// DOM file I/O for CustomMap documents: download to a .json file and pick one back
// in. Kept apart from persist.ts so the (de)serializer stays DOM-free and testable.

import type { CustomMap } from './custom_map';
import { parseMap, serializeMap } from './persist';

export function downloadMap(map: CustomMap): void {
  const blob = new Blob([serializeMap(map)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = map.meta.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'map';
  a.download = `woc-map-${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Open a file picker and resolve with the parsed map, or null if cancelled/invalid.
export function pickMapFile(): Promise<CustomMap | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => resolve(parseMap(text)))
        .catch(() => resolve(null));
    };
    input.click();
  });
}
