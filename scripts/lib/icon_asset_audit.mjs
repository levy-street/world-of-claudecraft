// Manifest-driven, deterministic audit and contact-sheet primitives for painted
// UI icons. The CLI wrapper is intentionally thin; validation, grouping, image
// measurements, duplicate decisions, and sheet layout live here so fixtures can
// exercise them without touching the repository's real art.

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const KIND_ORDER = Object.freeze(['ability', 'item', 'deed']);
const KIND_SET = new Set(KIND_ORDER);
const SHA256_RE = /^[0-9a-f]{64}$/;

export const ICON_AUDIT_LIMITS = Object.freeze({
  maxAssets: 500,
  maxSourceBytes: 32 * 1024 * 1024,
  maxDecodedPixels: 4096 * 4096,
  maxContactSheets: 1000,
  maxSheetPixels: 4 * 1024 * 1024,
  perceptualHashSize: 8,
  perceptualStructureSize: 24,
  perceptualCropFractions: Object.freeze([0, 0.03, 0.06]),
  perceptualLuminanceWeight: 0.55,
  perceptualEdgeWeight: 0.45,
  perceptualMinStructuralSimilarity: 0.8,
});

const SHEET_SPECS = Object.freeze({
  ability: Object.freeze([
    Object.freeze({ size: 128, grayscale: false }),
    Object.freeze({ size: 48, grayscale: false }),
    Object.freeze({ size: 32, grayscale: false }),
  ]),
  item: Object.freeze([
    Object.freeze({ size: 128, grayscale: false }),
    Object.freeze({ size: 28, grayscale: false }),
  ]),
  deed: Object.freeze([
    Object.freeze({ size: 512, grayscale: false }),
    Object.freeze({ size: 512, grayscale: true }),
    Object.freeze({ size: 128, grayscale: false }),
    Object.freeze({ size: 128, grayscale: true }),
    Object.freeze({ size: 40, grayscale: false }),
    Object.freeze({ size: 40, grayscale: true }),
    Object.freeze({ size: 24, grayscale: false }),
    Object.freeze({ size: 24, grayscale: true }),
  ]),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function valueFrom(asset, names) {
  const holders = [asset, asset.metadata, asset.group];
  for (const holder of holders) {
    if (!isRecord(holder)) continue;
    for (const name of names) {
      if (nonEmptyString(holder[name])) return holder[name].trim();
    }
  }
  return null;
}

function acceptanceFor(asset, contract) {
  const accepted = isRecord(asset.accepted) ? asset.accepted : {};
  const expected = isRecord(asset.expected) ? asset.expected : {};
  return {
    width: asset.width ?? accepted.width ?? expected.width ?? contract.width,
    height: asset.height ?? accepted.height ?? expected.height ?? contract.height,
    maxBytes: asset.maxBytes ?? accepted.maxBytes ?? expected.maxBytes ?? contract.maxBytes,
    alpha: asset.alpha ?? accepted.alpha ?? expected.alpha ?? contract.alpha,
    geometry: {
      ...(isRecord(contract.geometry) ? contract.geometry : {}),
      ...(isRecord(expected.geometry) ? expected.geometry : {}),
      ...(isRecord(accepted.geometry) ? accepted.geometry : {}),
      ...(isRecord(asset.geometry) ? asset.geometry : {}),
    },
  };
}

function acceptedSha256(asset) {
  const accepted = isRecord(asset.accepted) ? asset.accepted : {};
  return asset.acceptedSha256 ?? accepted.sha256 ?? null;
}

function acceptedBytes(asset) {
  const accepted = isRecord(asset.accepted) ? asset.accepted : {};
  return asset.acceptedBytes ?? accepted.bytes ?? null;
}

function alphaMode(value) {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.mode === 'string') return value.mode;
  return null;
}

function validateGeometry(value, at) {
  if (!isRecord(value)) return;
  if (
    value.alphaThreshold != null &&
    (!Number.isInteger(value.alphaThreshold) ||
      value.alphaThreshold < 1 ||
      value.alphaThreshold > 255)
  ) {
    throw new Error(`${at}.alphaThreshold must be an integer from 1 through 255`);
  }
  if (value.minPadding != null && (!Number.isInteger(value.minPadding) || value.minPadding < 0)) {
    throw new Error(`${at}.minPadding must be a non-negative integer`);
  }
  if (
    value.maxCenterOffset != null &&
    (!Number.isFinite(value.maxCenterOffset) || value.maxCenterOffset < 0)
  ) {
    throw new Error(`${at}.maxCenterOffset must be a non-negative finite number`);
  }
  for (const name of ['coverageMin', 'coverageMax']) {
    if (
      value[name] != null &&
      (!Number.isFinite(value[name]) || value[name] < 0 || value[name] > 1)
    ) {
      throw new Error(`${at}.${name} must be a finite number from 0 through 1`);
    }
  }
  if (
    Number.isFinite(value.coverageMin) &&
    Number.isFinite(value.coverageMax) &&
    value.coverageMin > value.coverageMax
  ) {
    throw new Error(`${at}.coverageMin must not exceed coverageMax`);
  }
  const bounds = value.alphaBounds ?? value.bounds;
  if (
    bounds != null &&
    (!Array.isArray(bounds) ||
      bounds.length !== 4 ||
      bounds.some((entry) => !Number.isInteger(entry)))
  ) {
    throw new Error(`${at}.alphaBounds must contain four integers`);
  }
  if (value.visiblePixels != null && !positiveInteger(value.visiblePixels)) {
    throw new Error(`${at}.visiblePixels must be a positive integer`);
  }
}

function assetKey(asset) {
  return `${asset.kind}:${asset.id}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAssets(left, right) {
  const byKind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
  return byKind || compareText(left.id, right.id) || compareText(left.runtimeUrl, right.runtimeUrl);
}

/** Validate the final accepted-art manifest's structural and exact-pin contract. */
export function validateAcceptedArtManifest(value) {
  if (!isRecord(value)) throw new Error('accepted-art manifest must be a JSON object');
  if (value.schemaVersion !== 1) {
    throw new Error(`accepted-art manifest schemaVersion must be 1, got ${value.schemaVersion}`);
  }
  if (!isRecord(value.contracts))
    throw new Error('accepted-art manifest contracts must be an object');
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new Error('accepted-art manifest assets must be a non-empty array');
  }
  if (value.assets.length > ICON_AUDIT_LIMITS.maxAssets) {
    throw new Error(
      `accepted-art manifest has ${value.assets.length} assets; maximum is ${ICON_AUDIT_LIMITS.maxAssets}`,
    );
  }

  const keys = new Set();
  const runtimeUrls = new Set();
  for (const [index, asset] of value.assets.entries()) {
    const at = `assets[${index}]`;
    if (!isRecord(asset)) throw new Error(`${at} must be an object`);
    if (!KIND_SET.has(asset.kind)) {
      throw new Error(`${at}.kind must be ability, item, or deed`);
    }
    if (!nonEmptyString(asset.id)) throw new Error(`${at}.id must be a non-empty string`);
    if (
      !nonEmptyString(asset.runtimeUrl) ||
      !asset.runtimeUrl.startsWith('/') ||
      asset.runtimeUrl.includes('\\') ||
      asset.runtimeUrl.includes('?') ||
      asset.runtimeUrl.includes('#')
    ) {
      throw new Error(`${at}.runtimeUrl must be an absolute query-free public URL path`);
    }

    const key = assetKey(asset);
    if (keys.has(key)) throw new Error(`duplicate accepted-art asset key ${key}`);
    keys.add(key);
    if (runtimeUrls.has(asset.runtimeUrl)) {
      throw new Error(`duplicate accepted-art runtimeUrl ${asset.runtimeUrl}`);
    }
    runtimeUrls.add(asset.runtimeUrl);

    const sha256 = acceptedSha256(asset);
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
      throw new Error(`${at}.acceptedSha256 must be a lowercase 64-character SHA-256`);
    }
    const bytes = acceptedBytes(asset);
    if (!positiveInteger(bytes)) throw new Error(`${at}.acceptedBytes must be a positive integer`);

    const contract = value.contracts[asset.kind];
    if (!isRecord(contract)) throw new Error(`contracts.${asset.kind} must be an object`);
    const acceptance = acceptanceFor(asset, contract);
    if (!positiveInteger(acceptance.width) || !positiveInteger(acceptance.height)) {
      throw new Error(`${at} needs positive integer width and height acceptance pins`);
    }
    if (!positiveInteger(acceptance.maxBytes)) {
      throw new Error(`${at} needs a positive integer maxBytes acceptance pin`);
    }
    if (
      !['opaque', 'transparent-subject', 'has-alpha', 'any'].includes(alphaMode(acceptance.alpha))
    ) {
      throw new Error(
        `${at} alpha contract must be opaque, transparent-subject, has-alpha, or any`,
      );
    }
    validateGeometry(acceptance.geometry, `${at}.geometry`);
    if (asset.kind === 'ability' && !valueFrom(asset, ['class', 'abilityClass'])) {
      throw new Error(`${at} ability needs class metadata for contact-sheet grouping`);
    }
  }
  return value;
}

function groupName(manifest, asset) {
  if (asset.kind === 'ability') {
    return valueFrom(asset, ['class', 'abilityClass']) ?? 'unclassified';
  }
  if (asset.kind === 'item') {
    const zone = valueFrom(asset, ['zone', 'itemZone']);
    const family = valueFrom(asset, ['family', 'itemFamily']);
    if (zone && family) return `${zone} / ${family}`;
    return zone ?? family ?? valueFrom(asset, ['batch', 'batchId']) ?? 'ungrouped';
  }
  return (
    valueFrom(asset, ['batch', 'batchId', 'deedBatch']) ??
    (isRecord(manifest.batch) && nonEmptyString(manifest.batch.id)
      ? manifest.batch.id.trim()
      : 'ungrouped')
  );
}

/** Stable grouping for human review sheets. */
export function groupManifestAssets(value) {
  const manifest = validateAcceptedArtManifest(value);
  const groups = new Map();
  for (const asset of manifest.assets) {
    const group = groupName(manifest, asset);
    const key = `${asset.kind}\0${group}`;
    if (!groups.has(key)) groups.set(key, { kind: asset.kind, group, assets: [] });
    groups.get(key).assets.push(asset);
  }
  for (const group of groups.values()) {
    group.assets.sort(compareAssets);
  }
  return [...groups.values()].sort((left, right) => {
    const byKind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
    return byKind || compareText(left.group, right.group);
  });
}

function resolvePublicAssetPath(repoRoot, runtimeUrl) {
  let decoded;
  try {
    decoded = decodeURIComponent(runtimeUrl);
  } catch {
    throw new Error(`runtimeUrl is not valid percent-encoding: ${runtimeUrl}`);
  }
  if (decoded.includes('\\') || decoded.includes('?') || decoded.includes('#')) {
    throw new Error(`runtimeUrl contains an encoded path delimiter: ${runtimeUrl}`);
  }
  const publicRoot = path.resolve(repoRoot, 'public');
  const resolved = path.resolve(publicRoot, `.${decoded}`);
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`runtimeUrl escapes public/: ${runtimeUrl}`);
  }
  return resolved;
}

async function resolveRepoSourcePath(repoRoot, sourcePath) {
  if (
    !nonEmptyString(sourcePath) ||
    sourcePath !== sourcePath.trim() ||
    path.isAbsolute(sourcePath) ||
    sourcePath.includes('\\') ||
    sourcePath.includes('\0')
  ) {
    throw new Error(`source.path must be a repository-relative filesystem path: ${sourcePath}`);
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, sourcePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`source.path escapes repository root: ${sourcePath}`);
  }

  let canonicalRoot;
  let canonicalSource;
  try {
    [canonicalRoot, canonicalSource] = await Promise.all([realpath(root), realpath(resolved)]);
  } catch (error) {
    throw new Error(
      `cannot resolve source.path ${sourcePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (
    canonicalSource !== canonicalRoot &&
    !canonicalSource.startsWith(`${canonicalRoot}${path.sep}`)
  ) {
    throw new Error(`source.path escapes repository root through a symbolic link: ${sourcePath}`);
  }
  return resolved;
}

function relativePublicPath(runtimeUrl) {
  return `public${runtimeUrl}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function utf16BigEndian(bytes) {
  let value = '';
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    value += String.fromCharCode(bytes.readUInt16BE(offset));
  }
  return value.replace(/\0+$/g, '').trim();
}

function iccProfileDescription(profile) {
  if (!Buffer.isBuffer(profile) || profile.length < 132) return null;
  const tagCount = profile.readUInt32BE(128);
  if (tagCount > 256 || 132 + tagCount * 12 > profile.length) return null;
  for (let index = 0; index < tagCount; index++) {
    const entry = 132 + index * 12;
    if (profile.toString('ascii', entry, entry + 4) !== 'desc') continue;
    const offset = profile.readUInt32BE(entry + 4);
    const size = profile.readUInt32BE(entry + 8);
    if (size < 12 || offset + size > profile.length) return null;
    const type = profile.toString('ascii', offset, offset + 4);
    if (type === 'desc') {
      const length = profile.readUInt32BE(offset + 8);
      if (length < 1 || offset + 12 + length > profile.length) return null;
      return profile.toString('ascii', offset + 12, offset + 11 + length).trim() || null;
    }
    if (type !== 'mluc' || size < 28) return null;
    const recordCount = profile.readUInt32BE(offset + 8);
    const recordSize = profile.readUInt32BE(offset + 12);
    if (recordCount < 1 || recordCount > 256 || recordSize < 12) return null;
    let selected = offset + 16;
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
      const record = offset + 16 + recordIndex * recordSize;
      if (record + 12 > offset + size) return null;
      if (profile.toString('ascii', record, record + 4) === 'enUS') {
        selected = record;
        break;
      }
    }
    const length = profile.readUInt32BE(selected + 4);
    const relativeOffset = profile.readUInt32BE(selected + 8);
    if (length < 2 || relativeOffset + length > size) return null;
    return utf16BigEndian(
      profile.subarray(offset + relativeOffset, offset + relativeOffset + length),
    );
  }
  return null;
}

function isSrgbProfile(profile) {
  const description = iccProfileDescription(profile);
  return {
    description,
    isSrgb:
      description
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .includes('srgb') === true,
  };
}

function rounded(value, places = 6) {
  return Number(value.toFixed(places));
}

/** Pure alpha-channel geometry used by both contracts and report rows. */
export function measureAlpha(alphaBytes, width, height, threshold = 8) {
  if (!positiveInteger(width) || !positiveInteger(height)) {
    throw new Error('alpha plane width and height must be positive integers');
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255) {
    throw new Error('alpha threshold must be an integer from 1 through 255');
  }
  if (!(alphaBytes instanceof Uint8Array) || alphaBytes.length !== width * height) {
    throw new Error(`alpha plane must contain exactly ${width * height} bytes`);
  }
  let min = 255;
  let max = 0;
  let transparentPixels = 0;
  let translucentPixels = 0;
  let opaquePixels = 0;
  let visiblePixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < alphaBytes.length; index++) {
    const alpha = alphaBytes[index];
    min = Math.min(min, alpha);
    max = Math.max(max, alpha);
    if (alpha === 0) transparentPixels++;
    else if (alpha === 255) opaquePixels++;
    else translucentPixels++;
    if (alpha >= threshold) {
      visiblePixels++;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const bounds = visiblePixels > 0 ? [minX, minY, maxX, maxY] : null;
  const padding = bounds
    ? [bounds[0], bounds[1], width - 1 - bounds[2], height - 1 - bounds[3]]
    : null;
  const centerOffset = bounds
    ? [
        rounded((bounds[0] + bounds[2]) / 2 - (width - 1) / 2, 3),
        rounded((bounds[1] + bounds[3]) / 2 - (height - 1) / 2, 3),
      ]
    : null;
  return {
    min,
    max,
    transparentPixels,
    translucentPixels,
    opaquePixels,
    visiblePixels,
    coverage: rounded(visiblePixels / (width * height)),
    threshold,
    bounds,
    padding,
    centerOffset,
  };
}

function classifyAlpha(alpha) {
  if (alpha.min === 255 && alpha.max === 255) return 'opaque';
  if (alpha.min === 0 && alpha.max === 255) return 'transparent-subject';
  return 'translucent';
}

function compareGeometry(issues, geometry, expected) {
  if (!isRecord(expected)) return;
  if (positiveInteger(expected.minPadding)) {
    if (!geometry.padding || geometry.padding.some((value) => value < expected.minPadding)) {
      issues.push(
        `alpha padding ${JSON.stringify(geometry.padding)} is below minPadding ${expected.minPadding}`,
      );
    }
  }
  if (typeof expected.maxCenterOffset === 'number' && Number.isFinite(expected.maxCenterOffset)) {
    if (
      !geometry.centerOffset ||
      geometry.centerOffset.some((value) => Math.abs(value) > expected.maxCenterOffset)
    ) {
      issues.push(
        `alpha centerOffset ${JSON.stringify(geometry.centerOffset)} exceeds ${expected.maxCenterOffset}`,
      );
    }
  }
  if (typeof expected.coverageMin === 'number' && geometry.coverage < expected.coverageMin) {
    issues.push(`alpha coverage ${geometry.coverage} is below ${expected.coverageMin}`);
  }
  if (typeof expected.coverageMax === 'number' && geometry.coverage > expected.coverageMax) {
    issues.push(`alpha coverage ${geometry.coverage} exceeds ${expected.coverageMax}`);
  }
  const acceptedBounds = expected.alphaBounds ?? expected.bounds;
  if (
    Array.isArray(acceptedBounds) &&
    JSON.stringify(geometry.bounds) !== JSON.stringify(acceptedBounds)
  ) {
    issues.push(
      `alpha bounds ${JSON.stringify(geometry.bounds)} do not match ${JSON.stringify(acceptedBounds)}`,
    );
  }
  if (
    positiveInteger(expected.visiblePixels) &&
    geometry.visiblePixels !== expected.visiblePixels
  ) {
    issues.push(
      `alpha visiblePixels ${geometry.visiblePixels} do not match ${expected.visiblePixels}`,
    );
  }
}

function perceptualBits(rgb) {
  const pixels = rgb.length / 3;
  const luminance = new Array(pixels);
  let total = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 3;
    const value = rgb[offset] * 0.2126 + rgb[offset + 1] * 0.7152 + rgb[offset + 2] * 0.0722;
    luminance[pixel] = value;
    total += value;
  }
  const mean = total / pixels;
  let hex = '';
  for (let offset = 0; offset < pixels; offset += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (luminance[offset + bit] >= mean) nibble |= 1 << (3 - bit);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

function popcountHexPair(left, right) {
  let count = 0;
  for (let index = 0; index < left.length; index++) {
    let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (value) {
      count += value & 1;
      value >>= 1;
    }
  }
  return count;
}

function standardized(values) {
  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;
  let squaredDifference = 0;
  for (const value of values) squaredDifference += (value - mean) ** 2;
  const standardDeviation = Math.sqrt(squaredDifference / values.length) || 1;
  return Float32Array.from(values, (value) => (value - mean) / standardDeviation);
}

// Z-normalized luminance preserves the painted subject while discarding global
// brightness changes. Color Sobel magnitude adds contour and internal-detail evidence,
// so the common dark vignette is not sufficient to make two icons candidates.
function perceptualStructure(rgb, size) {
  if (rgb.length !== size * size * 3) {
    throw new Error(`perceptual RGB sample must contain exactly ${size * size * 3} bytes`);
  }
  const luminance = new Float64Array(size * size);
  for (let pixel = 0; pixel < luminance.length; pixel++) {
    const offset = pixel * 3;
    luminance[pixel] = rgb[offset] * 0.2126 + rgb[offset + 1] * 0.7152 + rgb[offset + 2] * 0.0722;
  }

  const edgeMagnitude = new Float64Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const pixel = y * size + x;
      let squaredMagnitude = 0;
      for (let channel = 0; channel < 3; channel++) {
        const topLeft = ((y - 1) * size + (x - 1)) * 3 + channel;
        const top = ((y - 1) * size + x) * 3 + channel;
        const topRight = ((y - 1) * size + (x + 1)) * 3 + channel;
        const middleLeft = (y * size + (x - 1)) * 3 + channel;
        const middleRight = (y * size + (x + 1)) * 3 + channel;
        const bottomLeft = ((y + 1) * size + (x - 1)) * 3 + channel;
        const bottom = ((y + 1) * size + x) * 3 + channel;
        const bottomRight = ((y + 1) * size + (x + 1)) * 3 + channel;
        const gradientX =
          -rgb[topLeft] +
          rgb[topRight] -
          2 * rgb[middleLeft] +
          2 * rgb[middleRight] -
          rgb[bottomLeft] +
          rgb[bottomRight];
        const gradientY =
          -rgb[topLeft] -
          2 * rgb[top] -
          rgb[topRight] +
          rgb[bottomLeft] +
          2 * rgb[bottom] +
          rgb[bottomRight];
        squaredMagnitude += gradientX ** 2 + gradientY ** 2;
      }
      edgeMagnitude[pixel] = Math.sqrt(squaredMagnitude);
    }
  }
  return {
    luminance: standardized(luminance),
    edgeMagnitude: standardized(edgeMagnitude),
  };
}

function downsampleRgb(rgb, inputSize, outputSize) {
  if (inputSize % outputSize !== 0) {
    throw new Error('perceptual RGB sample sizes must divide evenly');
  }
  const scale = inputSize / outputSize;
  const output = new Uint8Array(outputSize * outputSize * 3);
  for (let outputY = 0; outputY < outputSize; outputY++) {
    for (let outputX = 0; outputX < outputSize; outputX++) {
      const totals = [0, 0, 0];
      for (let sourceY = 0; sourceY < scale; sourceY++) {
        for (let sourceX = 0; sourceX < scale; sourceX++) {
          const inputPixel =
            ((outputY * scale + sourceY) * inputSize + outputX * scale + sourceX) * 3;
          for (let channel = 0; channel < 3; channel++) {
            totals[channel] += rgb[inputPixel + channel];
          }
        }
      }
      const outputPixel = (outputY * outputSize + outputX) * 3;
      for (let channel = 0; channel < 3; channel++) {
        output[outputPixel + channel] = Math.round(totals[channel] / (scale * scale));
      }
    }
  }
  return output;
}

async function perceptualSignature(image, width, height) {
  const size = ICON_AUDIT_LIMITS.perceptualStructureSize;
  const variants = [];
  let baseRgb = null;
  for (const cropFraction of ICON_AUDIT_LIMITS.perceptualCropFractions) {
    const insetX = Math.round(width * cropFraction);
    const insetY = Math.round(height * cropFraction);
    let sampleImage = image.clone().flatten({ background: { r: 16, g: 16, b: 20 } });
    if (insetX > 0 || insetY > 0) {
      sampleImage = sampleImage.extract({
        left: insetX,
        top: insetY,
        width: width - insetX * 2,
        height: height - insetY * 2,
      });
    }
    const sample = await sampleImage
      .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rgb = Uint8Array.from(sample.data);
    if (cropFraction === 0) baseRgb = rgb;
    variants.push({ cropFraction, ...perceptualStructure(rgb, size) });
  }
  if (!baseRgb) throw new Error('perceptual signature requires an uncropped sample');
  const rgb = downsampleRgb(baseRgb, size, ICON_AUDIT_LIMITS.perceptualHashSize);
  return { hash: perceptualBits(rgb), rgb, variants };
}

function normalizedCorrelation(left, right) {
  if (left.length !== right.length || left.length === 0) {
    throw new Error('perceptual descriptor channels must have equal positive dimensions');
  }
  let dotProduct = 0;
  for (let index = 0; index < left.length; index++) {
    dotProduct += left[index] * right[index];
  }
  return dotProduct / left.length;
}

/** Pure diagnostics for two normalized Sharp perceptual signatures. */
export function perceptualDistance(left, right) {
  if (
    left.hash.length !== right.hash.length ||
    left.rgb.length !== right.rgb.length ||
    left.variants.length !== right.variants.length ||
    left.variants.length === 0
  ) {
    throw new Error('perceptual signatures must have equal dimensions');
  }
  let best = null;
  const compare = (leftVariant, rightVariant, cropDirection) => {
    const luminanceSimilarity = normalizedCorrelation(
      leftVariant.luminance,
      rightVariant.luminance,
    );
    const edgeSimilarity = normalizedCorrelation(
      leftVariant.edgeMagnitude,
      rightVariant.edgeMagnitude,
    );
    const structuralSimilarity =
      ICON_AUDIT_LIMITS.perceptualLuminanceWeight * luminanceSimilarity +
      ICON_AUDIT_LIMITS.perceptualEdgeWeight * edgeSimilarity;
    if (!best || structuralSimilarity > best.structuralSimilarity) {
      best = {
        structuralSimilarity,
        luminanceSimilarity,
        edgeSimilarity,
        cropFraction:
          cropDirection === 'left-cropped' ? leftVariant.cropFraction : rightVariant.cropFraction,
        cropDirection,
      };
    }
  };

  for (let index = 0; index < left.variants.length; index++) {
    const leftVariant = left.variants[index];
    const rightVariant = right.variants[index];
    if (leftVariant.cropFraction !== rightVariant.cropFraction) {
      throw new Error('perceptual signature crop fractions must match');
    }
    compare(leftVariant, right.variants[0], index === 0 ? 'none' : 'left-cropped');
    if (index > 0) compare(left.variants[0], rightVariant, 'right-cropped');
  }

  let absolute = 0;
  for (let index = 0; index < left.rgb.length; index++) {
    absolute += Math.abs(left.rgb[index] - right.rgb[index]);
  }
  return {
    hammingDistance: popcountHexPair(left.hash, right.hash),
    meanAbsoluteDifference: rounded(absolute / (left.rgb.length * 255)),
    structuralSimilarity: rounded(best.structuralSimilarity),
    luminanceSimilarity: rounded(best.luminanceSimilarity),
    edgeSimilarity: rounded(best.edgeSimilarity),
    cropFraction: best.cropFraction,
    cropDirection: best.cropDirection,
  };
}

async function inspectAsset(manifest, asset, repoRoot) {
  const key = assetKey(asset);
  const issues = [];
  const contract = manifest.contracts[asset.kind];
  const acceptance = acceptanceFor(asset, contract);
  const expectedSha256 = acceptedSha256(asset);
  const expectedBytes = acceptedBytes(asset);
  const record = {
    kind: asset.kind,
    id: asset.id,
    group: groupName(manifest, asset),
    runtimeUrl: asset.runtimeUrl,
    sourcePath: relativePublicPath(asset.runtimeUrl),
    width: null,
    height: null,
    format: null,
    colourspace: null,
    bytes: null,
    sha256: null,
    acceptedBytes: expectedBytes,
    acceptedSha256: expectedSha256,
    expected: {
      width: acceptance.width,
      height: acceptance.height,
      maxBytes: acceptance.maxBytes,
      alpha: alphaMode(acceptance.alpha),
      geometry: acceptance.geometry,
    },
    hasAlpha: null,
    alphaMode: null,
    alpha: null,
    perceptualHash: null,
    issues,
  };
  let bytes;
  try {
    bytes = await readFile(resolvePublicAssetPath(repoRoot, asset.runtimeUrl));
  } catch (error) {
    issues.push(
      `cannot read ${record.sourcePath}: ${error instanceof Error ? error.message : error}`,
    );
    return { key, record, signature: null };
  }
  record.bytes = bytes.length;
  record.sha256 = sha256(bytes);
  if (bytes.length !== expectedBytes) {
    issues.push(`acceptedBytes ${expectedBytes} do not match actual ${bytes.length}`);
  }
  if (record.sha256 !== expectedSha256) {
    issues.push(`acceptedSha256 ${expectedSha256} does not match actual ${record.sha256}`);
  }
  if (bytes.length > acceptance.maxBytes) {
    issues.push(`file weight ${bytes.length} exceeds maxBytes ${acceptance.maxBytes}`);
  }
  if (bytes.length > ICON_AUDIT_LIMITS.maxSourceBytes) {
    issues.push(
      `file weight ${bytes.length} exceeds audit decode bound ${ICON_AUDIT_LIMITS.maxSourceBytes}`,
    );
    return { key, record, signature: null };
  }

  try {
    const image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: ICON_AUDIT_LIMITS.maxDecodedPixels,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    record.width = metadata.width ?? null;
    record.height = metadata.height ?? null;
    record.format = metadata.format ?? null;
    record.colourspace = metadata.space ?? null;
    record.hasAlpha = metadata.hasAlpha ?? false;
    if (record.format !== 'webp') {
      issues.push(`shipping format ${record.format ?? 'unknown'} does not match required WebP`);
    }
    if (record.colourspace !== 'srgb') {
      issues.push(
        `shipping colourspace ${record.colourspace ?? 'unknown'} does not match required sRGB`,
      );
    }
    if (metadata.icc) {
      const profile = isSrgbProfile(metadata.icc);
      if (!profile.isSrgb) {
        issues.push(
          `embedded ICC profile ${profile.description ?? 'unknown'} does not match required sRGB`,
        );
      }
    }
    if (record.width !== acceptance.width || record.height !== acceptance.height) {
      issues.push(
        `dimensions ${record.width}x${record.height} do not match ${acceptance.width}x${acceptance.height}`,
      );
    }
    if (!positiveInteger(record.width) || !positiveInteger(record.height)) {
      throw new Error('decoder returned no positive image dimensions');
    }

    const raw = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaPlane = new Uint8Array(record.width * record.height);
    for (let pixel = 0; pixel < alphaPlane.length; pixel++) {
      alphaPlane[pixel] = raw.data[pixel * raw.info.channels + (raw.info.channels - 1)];
    }
    const threshold = positiveInteger(acceptance.geometry.alphaThreshold)
      ? acceptance.geometry.alphaThreshold
      : 8;
    record.alpha = measureAlpha(alphaPlane, record.width, record.height, threshold);
    record.alphaMode = classifyAlpha(record.alpha);
    const wantedAlpha = alphaMode(acceptance.alpha);
    if (wantedAlpha === 'opaque' && record.alphaMode !== 'opaque') {
      issues.push(`alpha mode ${record.alphaMode} does not match opaque`);
    } else if (
      wantedAlpha === 'transparent-subject' &&
      record.alphaMode !== 'transparent-subject'
    ) {
      issues.push(`alpha mode ${record.alphaMode} does not match transparent-subject`);
    } else if (wantedAlpha === 'has-alpha' && !metadata.hasAlpha) {
      issues.push('image has no encoded alpha channel');
    }
    compareGeometry(issues, record.alpha, acceptance.geometry);

    const signature = await perceptualSignature(image, record.width, record.height);
    record.perceptualHash = signature.hash;
    return { key, record, signature };
  } catch (error) {
    issues.push(
      `cannot decode ${record.sourcePath}: ${error instanceof Error ? error.message : error}`,
    );
    return { key, record, signature: null };
  }
}

/** Group byte-identical assets by their measured shipping SHA. */
export function findExactDuplicates(records) {
  const byHash = new Map();
  for (const record of records) {
    if (!SHA256_RE.test(record.sha256 ?? '')) continue;
    if (!byHash.has(record.sha256)) byHash.set(record.sha256, []);
    byHash.get(record.sha256).push(`${record.kind}:${record.id}`);
  }
  return [...byHash.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([hash, keys]) => ({ sha256: hash, assetKeys: keys.sort() }))
    .sort((left, right) => compareText(left.assetKeys[0], right.assetKeys[0]));
}

function findPerceptualCandidates(inspections) {
  const candidates = [];
  for (let leftIndex = 0; leftIndex < inspections.length; leftIndex++) {
    const left = inspections[leftIndex];
    if (!left.signature) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < inspections.length; rightIndex++) {
      const right = inspections[rightIndex];
      if (!right.signature || left.record.sha256 === right.record.sha256) continue;
      const distance = perceptualDistance(left.signature, right.signature);
      if (distance.structuralSimilarity >= ICON_AUDIT_LIMITS.perceptualMinStructuralSimilarity) {
        candidates.push({ left: left.key, right: right.key, ...distance });
      }
    }
  }
  return candidates.sort((left, right) => {
    const byLeft = compareText(left.left, right.left);
    return byLeft || compareText(left.right, right.right);
  });
}

/** Audit accepted files without writing outputs. */
export async function auditIconAssets({ manifest: value, repoRoot }) {
  const manifest = validateAcceptedArtManifest(value);
  const root = path.resolve(repoRoot);
  const sorted = [...manifest.assets].sort(compareAssets);
  const inspections = [];
  for (const asset of sorted) inspections.push(await inspectAsset(manifest, asset, root));
  const assets = inspections.map(({ record }) => record);
  const exactDuplicates = findExactDuplicates(assets);
  const perceptualCandidates = findPerceptualCandidates(inspections);
  const issueCount = assets.reduce((total, asset) => total + asset.issues.length, 0);
  return {
    schemaVersion: 1,
    summary: {
      ok: issueCount === 0 && exactDuplicates.length === 0,
      assetCount: assets.length,
      issueCount,
      exactDuplicateGroupCount: exactDuplicates.length,
      perceptualCandidateCount: perceptualCandidates.length,
      contactSheetCount: 0,
    },
    assets,
    exactDuplicates,
    perceptualCandidates,
    contactSheets: [],
  };
}

function slug(value) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'ungrouped';
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value, characters) {
  if (value.length <= characters) return value;
  return `${value.slice(0, Math.max(1, characters - 1))}…`;
}

function textSvg(width, height, text, { fontSize = 13, background = '#222733' } = {}) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${background}"/>
  <text x="8" y="${Math.round(height / 2)}" dominant-baseline="middle" fill="#f2eee5" font-family="DejaVu Sans Mono, monospace" font-size="${fontSize}">${xml(text)}</text>
</svg>`);
}

function checkerSvg(size) {
  const tile = Math.max(4, Math.min(16, Math.round(size / 8)));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs><pattern id="c" width="${tile * 2}" height="${tile * 2}" patternUnits="userSpaceOnUse">
    <rect width="${tile * 2}" height="${tile * 2}" fill="#333945"/>
    <rect width="${tile}" height="${tile}" fill="#555d6c"/>
    <rect x="${tile}" y="${tile}" width="${tile}" height="${tile}" fill="#555d6c"/>
  </pattern></defs><rect width="100%" height="100%" fill="url(#c)"/>
</svg>`);
}

function sheetBounds(size) {
  if (size >= 512) return { columns: 2, rows: 6 };
  if (size >= 128) return { columns: 6, rows: 8 };
  return { columns: 8, rows: 10 };
}

async function reviewIcon(asset, repoRoot, size, grayscale) {
  const acceptedSource = asset.kind === 'deed' && size === 512;
  let inputPath;
  if (acceptedSource) {
    if (!isRecord(asset.source) || !nonEmptyString(asset.source.path)) {
      throw new Error(`deed ${asset.id} needs source.path for its 512px contact sheet`);
    }
    inputPath = await resolveRepoSourcePath(repoRoot, asset.source.path);
  } else {
    inputPath = resolvePublicAssetPath(repoRoot, asset.runtimeUrl);
  }
  try {
    let pipeline = sharp(inputPath, {
      failOn: 'warning',
      limitInputPixels: ICON_AUDIT_LIMITS.maxDecodedPixels,
      sequentialRead: true,
    }).resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    });
    if (grayscale) pipeline = pipeline.grayscale();
    return await pipeline.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  } catch (error) {
    if (acceptedSource) {
      throw new Error(
        `cannot render accepted source ${asset.source.path}: ${error instanceof Error ? error.message : error}`,
      );
    }
    return textSvg(size, size, 'MISSING', {
      fontSize: Math.max(8, Math.floor(size / 8)),
      background: '#6b2028',
    });
  }
}

async function renderSheet({ assets, kind, group, size, grayscale, page, pageCount, repoRoot }) {
  const bounds = sheetBounds(size);
  const actualColumns = Math.min(bounds.columns, assets.length);
  const actualRows = Math.ceil(assets.length / actualColumns);
  const cellWidth = Math.max(size + 16, 192);
  const labelHeight = 32;
  const cellHeight = size + labelHeight + 16;
  const headerHeight = 48;
  const width = Math.max(640, actualColumns * cellWidth);
  const height = headerHeight + actualRows * cellHeight;
  if (width * height > ICON_AUDIT_LIMITS.maxSheetPixels) {
    throw new Error(
      `contact sheet ${kind}/${group}/${size}px would contain ${width * height} pixels; maximum is ${ICON_AUDIT_LIMITS.maxSheetPixels}`,
    );
  }
  const header = `${kind} / ${group} / ${size}px${grayscale ? ' / grayscale' : ''} / page ${page} of ${pageCount}`;
  const composites = [
    {
      input: textSvg(width, headerHeight, truncate(header, Math.floor((width - 16) / 9)), {
        fontSize: 15,
        background: '#151922',
      }),
      left: 0,
      top: 0,
    },
  ];
  for (const [index, asset] of assets.entries()) {
    const column = index % actualColumns;
    const row = Math.floor(index / actualColumns);
    const left = column * cellWidth + Math.floor((cellWidth - size) / 2);
    const top = headerHeight + row * cellHeight + 8;
    composites.push({ input: checkerSvg(size), left, top });
    composites.push({ input: await reviewIcon(asset, repoRoot, size, grayscale), left, top });
    const label = truncate(asset.id, Math.max(12, Math.floor((cellWidth - 16) / 7)));
    composites.push({
      input: textSvg(cellWidth, labelHeight, label, { fontSize: 12 }),
      left: column * cellWidth,
      top: top + size + 4,
    });
  }
  return sharp({
    create: { width, height, channels: 4, background: '#1b202a' },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function resetContactSheetRoot(outputDir) {
  const destination = path.resolve(outputDir);
  const sheetRoot = path.resolve(destination, 'contact-sheets');
  if (!sheetRoot.startsWith(`${destination}${path.sep}`)) {
    throw new Error(`contact-sheet directory escapes output directory: ${sheetRoot}`);
  }
  await rm(sheetRoot, { recursive: true, force: true });
  return sheetRoot;
}

/** Render bounded, paginated review sheets and return their deterministic index. */
export async function renderIconContactSheets({ manifest: value, repoRoot, outputDir }) {
  const sheetRoot = await resetContactSheetRoot(outputDir);
  const manifest = validateAcceptedArtManifest(value);
  const root = path.resolve(repoRoot);
  const index = [];
  const groups = groupManifestAssets(manifest);
  const sheetCount = groups.reduce(
    (total, grouped) =>
      total +
      SHEET_SPECS[grouped.kind].reduce((subtotal, spec) => {
        const bounds = sheetBounds(spec.size);
        return subtotal + Math.ceil(grouped.assets.length / (bounds.columns * bounds.rows));
      }, 0),
    0,
  );
  if (sheetCount > ICON_AUDIT_LIMITS.maxContactSheets) {
    throw new Error(
      `contact-sheet plan contains ${sheetCount} sheets; maximum is ${ICON_AUDIT_LIMITS.maxContactSheets}`,
    );
  }
  await mkdir(sheetRoot, { recursive: true });
  const slugCounts = new Map();
  for (const grouped of groups) {
    const key = `${grouped.kind}\0${slug(grouped.group)}`;
    slugCounts.set(key, (slugCounts.get(key) ?? 0) + 1);
  }
  for (const grouped of groups) {
    const plainSlug = slug(grouped.group);
    const slugKey = `${grouped.kind}\0${plainSlug}`;
    const groupSlug =
      slugCounts.get(slugKey) === 1
        ? plainSlug
        : `${plainSlug}-${sha256(Buffer.from(grouped.group, 'utf8')).slice(0, 8)}`;
    for (const spec of SHEET_SPECS[grouped.kind]) {
      const bounds = sheetBounds(spec.size);
      const pageSize = bounds.columns * bounds.rows;
      const pageCount = Math.ceil(grouped.assets.length / pageSize);
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const page = pageIndex + 1;
        const assets = grouped.assets.slice(pageIndex * pageSize, page * pageSize);
        const gray = spec.grayscale ? '-grayscale' : '';
        const filename = `${grouped.kind}-${groupSlug}-${spec.size}${gray}-p${String(page).padStart(2, '0')}.png`;
        const relative = path.posix.join('contact-sheets', filename);
        const png = await renderSheet({
          assets,
          kind: grouped.kind,
          group: grouped.group,
          size: spec.size,
          grayscale: spec.grayscale,
          page,
          pageCount,
          repoRoot: root,
        });
        await writeFile(path.join(sheetRoot, filename), png);
        index.push({
          path: relative,
          kind: grouped.kind,
          group: grouped.group,
          size: spec.size,
          grayscale: spec.grayscale,
          page,
          pageCount,
          assetKeys: assets.map(assetKey),
        });
      }
    }
  }
  return index;
}

/** Read a manifest, audit it, optionally render sheets, and persist stable JSON evidence. */
export async function runIconAssetAudit({
  manifestPath,
  outputDir,
  repoRoot = process.cwd(),
  sheets = true,
}) {
  const manifestFile = path.resolve(manifestPath);
  const destination = path.resolve(outputDir);
  await resetContactSheetRoot(destination);
  const manifest = validateAcceptedArtManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
  const report = await auditIconAssets({ manifest, repoRoot });
  if (sheets) {
    report.contactSheets = await renderIconContactSheets({
      manifest,
      repoRoot,
      outputDir: destination,
    });
  }
  report.summary.contactSheetCount = report.contactSheets.length;
  await mkdir(destination, { recursive: true });
  await writeFile(
    path.join(destination, 'icon-asset-audit.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
