import sharp from 'sharp';

export const ITEM_ICON_MASTER_MIN_SIZE = 512;

export function itemIconOwnershipIndex(mapping) {
  const owners = new Map();
  const add = (itemId, owner) => {
    if (typeof itemId !== 'string' || itemId.length === 0) return;
    const current = owners.get(itemId) ?? [];
    current.push(owner);
    owners.set(itemId, current);
  };

  for (const [index, entry] of (mapping.entries ?? []).entries()) {
    add(entry?.itemId, `entries[${index}]`);
  }
  for (const [batchIndex, batch] of (mapping.generatedBatches ?? []).entries()) {
    for (const [itemIndex, itemId] of (batch?.itemIds ?? []).entries()) {
      add(itemId, `generatedBatches[${batchIndex}].itemIds[${itemIndex}]`);
    }
  }
  return owners;
}

export function assertExactlyOneItemIconOwner(itemId, owners) {
  const matches = owners.get(itemId) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `${itemId} must have exactly one current provenance owner in mapping.json; found ${matches.length}`,
    );
  }
}

export async function inspectItemIconMaster(source) {
  const image = sharp(source, { failOn: 'error' });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  // Animated formats report their stacked frame height. Reject them before the square check so
  // intake identifies the real defect instead of misclassifying animation as a crop problem.
  if ((metadata.pages ?? 1) !== 1) {
    throw new Error(`${source} must be a single-frame still image`);
  }
  if (width < ITEM_ICON_MASTER_MIN_SIZE || height < ITEM_ICON_MASTER_MIN_SIZE) {
    throw new Error(
      `${source} must be at least ${ITEM_ICON_MASTER_MIN_SIZE}x${ITEM_ICON_MASTER_MIN_SIZE}; found ${width}x${height}`,
    );
  }
  if (width !== height) {
    throw new Error(`${source} must be square; found ${width}x${height}`);
  }
  if (metadata.space !== 'srgb') {
    throw new Error(`${source} must decode as sRGB; found ${metadata.space ?? 'unknown'}`);
  }

  if (metadata.hasAlpha) {
    const alphaStats = await image.clone().rotate().stats();
    const alpha = alphaStats.channels[3];
    if (alpha?.min !== 255 || alpha.max !== 255) {
      throw new Error(`${source} must be fully opaque`);
    }
  }

  return { width, height, space: metadata.space };
}
