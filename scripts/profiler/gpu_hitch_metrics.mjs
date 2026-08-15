// Pure validation and attribution for the GPU hitch capture protocol.
// Browser orchestration belongs in gpu_hitch_capture.mjs; this module has no
// DOM, Puppeteer, or application imports so its temporal rules stay testable.

// Schema 2 adds per-program Three identity (timeline.programs), the value each
// program query returned, a draw context on the two reflection queries, and the
// scene-root census. A schema 1 artifact is REJECTED rather than read on a
// best-effort basis: its queries carry no completion-status return value, so
// the reflection families below cannot be derived from it at all, and a mixed
// pair must never look comparable. The schema 1 meaning is unchanged.
// Schema 3 adds timeline.programs[].variantDiff: when a material that was
// already compiled links a SECOND program, the differing cache-key segment.
// Schema 2 artifacts have no such field, and a missing field is not the same
// claim as "this program had no variant", so schema 2 is rejected rather than
// read with the field treated as absent.
// Schema 4 rewrites the upload byte estimator to read the texImage2D /
// texSubImage2D overload that was actually called, and adds
// timeline.uploadBuckets[].unsized. A schema 3 upload artifact sized every
// DOM-source upload from two GL enums read as width and height (about 131 MB
// per image upload), so its byte totals are not a smaller version of the same
// claim, and its missing `unsized` count is not the same claim as "every
// upload in this bucket was sized".
export const GPU_HITCH_SCHEMA_VERSION = 4;
export const GPU_HITCH_PROBE_VERSION = 4;

/**
 * The order three r165 pushes into the program cache key, from
 * getProgramCacheKeyParameters. Counting from the END of the parameter block is
 * what makes a position nameable: the preceding `defines` section is variable
 * length, while everything after these is fixed (the boolean mask, then the
 * renderer output colour space, then customProgramCacheKey).
 * Pinned against the installed build by tests/three_reflection_contract.test.ts.
 */
export const THREE_CACHE_KEY_PARAMETERS = Object.freeze([
  'precision',
  'outputColorSpace',
  'envMapMode',
  'envMapCubeUVHeight',
  'mapUv',
  'alphaMapUv',
  'lightMapUv',
  'aoMapUv',
  'bumpMapUv',
  'normalMapUv',
  'displacementMapUv',
  'emissiveMapUv',
  'metalnessMapUv',
  'roughnessMapUv',
  'anisotropyMapUv',
  'clearcoatMapUv',
  'clearcoatNormalMapUv',
  'clearcoatRoughnessMapUv',
  'iridescenceMapUv',
  'iridescenceThicknessMapUv',
  'sheenColorMapUv',
  'sheenRoughnessMapUv',
  'specularMapUv',
  'specularColorMapUv',
  'specularIntensityMapUv',
  'transmissionMapUv',
  'thicknessMapUv',
  'combine',
  'fogExp2',
  'sizeAttenuation',
  'morphTargetsCount',
  'morphAttributeCount',
  'numDirLights',
  'numPointLights',
  'numSpotLights',
  'numSpotLightMaps',
  'numHemiLights',
  'numRectAreaLights',
  'numDirLightShadows',
  'numPointLightShadows',
  'numSpotLightShadows',
  'numSpotLightShadowsWithMaps',
  'numLightProbes',
  'shadowMapType',
  'toneMapping',
  'numClippingPlanes',
  'numClipIntersection',
  'depthPacking',
]);

/**
 * The fixed segments three appends after the parameter block, in push order.
 * getProgramCacheKeyBooleans pushes the layer mask TWICE (two 32-bit boolean
 * sets), then getProgramCacheKey appends the renderer output colour space.
 */
export const THREE_CACHE_KEY_TRAILERS = Object.freeze([
  'programLayersMask1',
  'programLayersMask2',
  'outputColorSpace',
]);
export const GPU_HITCH_UPLOAD_BUCKET_MS = 100;

const MEASUREMENT_KEYS = Object.freeze([
  'linkmode',
  'linkrate',
  'linkburst',
  'compileroots',
  'prewarmdeadline',
  'modular',
  'modularpeers',
  'gfx',
]);

/**
 * Every dimension that has to match for two legs to be one another's control.
 *
 * Exported so the suite can pin it: the refusal is a headline claim of the
 * capture workflow, and a dimension deleted here would silently start accepting
 * drifted pairs while every other test stayed green.
 */
export const COMPARABILITY_KEYS = Object.freeze([
  'sourceBuildId',
  'servedBuildId',
  'probeSha256',
  'analyzerSha256',
  'schemaVersion',
  'profile',
  'browserVersion',
  'browserFlags',
  'shaderDiskCache',
  'glVendor',
  'glRenderer',
  'viewport',
  'devicePixelRatio',
  'gfx',
  'scenario',
  'zone',
  'observer',
  'groupId',
  'fixture',
  'durationMs',
  'requested.linkmode',
  'requested.linkrate',
  'requested.linkburst',
  'requested.compileroots',
  'requested.prewarmdeadline',
  'requested.modular',
  'requested.modularpeers',
  'effective.prewarmPacing',
  'effective.modular',
  'rendererTier',
]);

const SAFE_GFX_VALUES = new Set(['low', 'medium', 'high', 'ultra', 'insane']);

/**
 * The adapter-name tokens that mark a software rasterizer.
 *
 * Kept EXACTLY in step with `SOFTWARE_RENDERER_PATTERN` in
 * `src/render/software_renderer.ts`, the repo's single source of truth; this
 * module is plain Node and cannot import the TS one, so the suite pins the two
 * together instead. The earlier local pattern here had already drifted: it
 * missed WARP, so a Windows no-GPU machine (whose renderer string is
 * "Microsoft Basic Render Driver") passed as performance evidence. A bare
 * "warp" token stays out on purpose, being a substring of real adapter names.
 */
export const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|basic render|softpipe|microsoft basic|software/i;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function own(object, key) {
  return Object.hasOwn(object ?? {}, key);
}

function numericQueryValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function flagQueryValue(value) {
  if (value == null) return null;
  return value === 'off' || value === 'on' ? value : null;
}

function gfxQueryValue(value) {
  return SAFE_GFX_VALUES.has(value) ? value : null;
}

function linkModeQueryValue(value) {
  return value === 'adaptive' ? value : null;
}

/** Return only measurement knobs, never the full URL or its credentials. */
export function measurementParams(search = '') {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => {
      const raw = params.get(key);
      if (key === 'linkmode') return [key, linkModeQueryValue(raw)];
      if (key === 'modular' || key === 'modularpeers') return [key, flagQueryValue(raw)];
      if (key === 'gfx') return [key, gfxQueryValue(raw)];
      return [key, numericQueryValue(raw)];
    }),
  );
}

/** Keep a safe origin and allowlisted knobs, dropping paths, fragments, and tokens. */
export function sanitizeCaptureUrl(input) {
  try {
    const url = new URL(input);
    if (url.origin === 'null') return null;
    const params = measurementParams(url.search);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) query.set(key, String(value));
    }
    const encodedQuery = query.toString();
    return `${url.origin}/${encodedQuery ? `?${encodedQuery}` : ''}`;
  } catch {
    return null;
  }
}

function queryRequestedValue(value) {
  if (value === null || value === undefined) return null;
  return value;
}

/**
 * Count events launched in the half-open interval [startMs, endMs).
 * The start, not the completion timestamp, is the causal attribution point.
 */
export function countEventsInWindow(events, startMs, endMs) {
  if (!Array.isArray(events) || !finite(startMs) || !finite(endMs) || endMs < startMs) return 0;
  return events.reduce(
    (count, event) =>
      finite(event?.startMs) && event.startMs >= startMs && event.startMs < endMs
        ? count + 1
        : count,
    0,
  );
}

/** Exact link pressure before a query starts. */
export function linksBeforeQuery(query, links, windowMs = 8_000) {
  if (!finite(query?.startMs) || !finite(windowMs) || windowMs < 0) {
    return { startMs: null, endMs: null, count: 0 };
  }
  const endMs = query.startMs;
  const startMs = Math.max(0, endMs - windowMs);
  return { startMs, endMs, count: countEventsInWindow(links, startMs, endMs) };
}

/**
 * Aggregate sparse upload buckets with honest boundary bounds. A bucket is
 * exact only when the complete bucket lies inside the requested interval.
 *
 * `unsized` travels alongside the byte totals rather than being folded into
 * them: an upload whose overload states neither dimensions nor a source size
 * contributes zero bytes, and a byte total is only readable next to how many
 * uploads it could not describe.
 */
export function uploadBucketsBeforeQuery(
  query,
  buckets,
  windowMs = 8_000,
  bucketWidthMs = GPU_HITCH_UPLOAD_BUCKET_MS,
) {
  if (
    !finite(query?.startMs) ||
    !finite(windowMs) ||
    windowMs < 0 ||
    !finite(bucketWidthMs) ||
    bucketWidthMs <= 0
  ) {
    return {
      startMs: null,
      endMs: null,
      bucketWidthMs,
      certain: 0,
      possible: 0,
      bytesCertain: 0,
      bytesPossible: 0,
      unsizedCertain: 0,
      unsizedPossible: 0,
    };
  }
  const endMs = query.startMs;
  const startMs = Math.max(0, endMs - windowMs);
  let certain = 0;
  let possible = 0;
  let bytesCertain = 0;
  let bytesPossible = 0;
  let unsizedCertain = 0;
  let unsizedPossible = 0;
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    if (!finite(bucket?.startMs) || !finite(bucket?.count) || bucket.count < 0) continue;
    const bucketStart = bucket.startMs;
    const bucketEnd = bucketStart + bucketWidthMs;
    if (bucketEnd <= startMs || bucketStart >= endMs) continue;
    possible += bucket.count;
    const bytes = finite(bucket.bytes) && bucket.bytes >= 0 ? bucket.bytes : 0;
    const unsized = finite(bucket.unsized) && bucket.unsized >= 0 ? bucket.unsized : 0;
    bytesPossible += bytes;
    unsizedPossible += unsized;
    if (bucketStart >= startMs && bucketEnd <= endMs) {
      certain += bucket.count;
      bytesCertain += bytes;
      unsizedCertain += unsized;
    }
  }
  return {
    startMs,
    endMs,
    bucketWidthMs,
    certain,
    possible,
    bytesCertain,
    bytesPossible,
    unsizedCertain,
    unsizedPossible,
  };
}

function error(errors, message) {
  errors.push(message);
}

function validateNumber(errors, value, label, { integer = false, nonNegative = false } = {}) {
  if (!finite(value)) {
    error(errors, `${label} must be a finite number`);
    return;
  }
  if (integer && !Number.isInteger(value)) error(errors, `${label} must be an integer`);
  if (nonNegative && value < 0) error(errors, `${label} must be non-negative`);
}

function validateEventArray(errors, events, label, { requireEnd = true } = {}) {
  if (!Array.isArray(events)) {
    error(errors, `${label} must be an array`);
    return;
  }
  let previous = -Infinity;
  events.forEach((event, index) => {
    const prefix = `${label}[${index}]`;
    validateNumber(errors, event?.startMs, `${prefix}.startMs`, { nonNegative: true });
    if (finite(event?.startMs) && event.startMs < previous)
      error(errors, `${prefix}.startMs is not monotonic`);
    if (finite(event?.startMs)) previous = event.startMs;
    if (!requireEnd) return;
    validateNumber(errors, event?.endMs, `${prefix}.endMs`, { nonNegative: true });
    if (finite(event?.startMs) && finite(event?.endMs) && event.endMs < event.startMs)
      error(errors, `${prefix}.endMs precedes startMs`);
    if (own(event, 'durationMs')) {
      validateNumber(errors, event.durationMs, `${prefix}.durationMs`, { nonNegative: true });
      if (
        finite(event?.durationMs) &&
        finite(event?.startMs) &&
        finite(event?.endMs) &&
        Math.abs(event.durationMs - (event.endMs - event.startMs)) > 0.01
      )
        error(errors, `${prefix}.durationMs disagrees with timestamps`);
    }
  });
}

function validateCompileUnitArray(errors, units, label) {
  if (!Array.isArray(units)) {
    error(errors, `${label} must be an array`);
    return;
  }
  const statuses = new Set(['settled', 'pending', 'deferred', 'failed', 'post-reveal']);
  units.forEach((unit, index) => {
    const prefix = `${label}[${index}]`;
    if (typeof unit?.id !== 'string' || unit.id === '') error(errors, `${prefix}.id is missing`);
    if (typeof unit?.lane !== 'string' || unit.lane === '')
      error(errors, `${prefix}.lane is missing`);
    for (const key of ['submittedAtMs', 'syncEndAtMs', 'settledAtMs', 'failedAtMs']) {
      if (unit?.[key] !== null && unit?.[key] !== undefined)
        validateNumber(errors, unit[key], `${prefix}.${key}`, { nonNegative: true });
    }
    if (
      finite(unit?.submittedAtMs) &&
      finite(unit?.syncEndAtMs) &&
      unit.syncEndAtMs < unit.submittedAtMs
    )
      error(errors, `${prefix}.syncEndAtMs precedes submittedAtMs`);
    if (
      finite(unit?.syncEndAtMs) &&
      finite(unit?.settledAtMs) &&
      unit.settledAtMs < unit.syncEndAtMs
    )
      error(errors, `${prefix}.settledAtMs precedes syncEndAtMs`);
    if (unit?.statusAtReveal !== null && !statuses.has(unit?.statusAtReveal))
      error(errors, `${prefix}.statusAtReveal is invalid`);
  });
}

/**
 * A program identity row carries only technical fields: an ordinal, three's own
 * program id, the material class and name, and a HASH of the cache key. The raw
 * cache key never appears, because three's default customProgramCacheKey is an
 * onBeforeCompile source string.
 */
/**
 * Upload buckets, with `unsized` required rather than defaulted.
 *
 * Same rule the program rows follow: an absent `unsized` is not the claim
 * "every upload in this bucket was sized", it is the producer not saying, and
 * uploadBucketsBeforeQuery would read that silence as a zero and hand back a
 * byte total that looks complete.
 */
function validateUploadBucketArray(errors, buckets, label) {
  if (!Array.isArray(buckets)) {
    error(errors, `${label} must be an array`);
    return;
  }
  buckets.forEach((bucket, index) => {
    const prefix = `${label}[${index}]`;
    for (const key of ['startMs', 'count', 'bytes', 'unsized']) {
      validateNumber(errors, bucket?.[key], `${prefix}.${key}`, {
        integer: key !== 'startMs',
        nonNegative: true,
      });
    }
    if (
      Number.isInteger(bucket?.unsized) &&
      Number.isInteger(bucket?.count) &&
      bucket.unsized > bucket.count
    )
      error(errors, `${prefix}.unsized exceeds the bucket's own upload count`);
  });
}

function validateProgramIdentityArray(errors, programs, label) {
  if (!Array.isArray(programs)) {
    error(errors, `${label} must be an array`);
    return;
  }
  const seen = new Set();
  programs.forEach((program, index) => {
    const prefix = `${label}[${index}]`;
    if (!Number.isInteger(program?.programId) || program.programId <= 0)
      error(errors, `${prefix}.programId must be a positive integer`);
    else if (seen.has(program.programId)) error(errors, `${prefix}.programId is duplicated`);
    else seen.add(program.programId);
    if (typeof program?.cacheKeyHash !== 'string')
      error(errors, `${prefix}.cacheKeyHash must be a string`);
    else if (program.cacheKeyHash !== '' && !/^[0-9a-f]{8}$/.test(program.cacheKeyHash))
      error(errors, `${prefix}.cacheKeyHash must be an 8 character hex digest`);
    if (own(program ?? {}, 'cacheKeyLength'))
      validateNumber(errors, program.cacheKeyLength, `${prefix}.cacheKeyLength`, {
        integer: true,
        nonNegative: true,
      });
    for (const key of ['materialType', 'materialName']) {
      if (typeof program?.[key] !== 'string') error(errors, `${prefix}.${key} must be a string`);
    }
    // Required present, on the same rule as variantDiff below: an absent flag
    // is not the claim "no family key collided here", it is the producer not
    // saying, and cacheKeyVariance would read the silence as a zero.
    if (typeof program?.variantAmbiguous !== 'boolean')
      error(errors, `${prefix}.variantAmbiguous must be a boolean`);
    if (!own(program ?? {}, 'variantDiff')) {
      error(errors, `${prefix}.variantDiff must be present (null when the program had no variant)`);
    } else if (program.variantDiff !== null) {
      const diff = program.variantDiff;
      // A claimed variant is a SINGLE render condition: one segment replaced,
      // or one appearing or disappearing (which makes the key a segment
      // longer). A wider difference means the two keys belong to different
      // materials that shared a family key, which the probe records as
      // variantAmbiguous instead. Required present too: without them the
      // rejection below never runs.
      for (const key of ['spanBefore', 'spanAfter']) {
        if (!(Number.isInteger(diff?.[key]) && diff[key] >= 0))
          error(errors, `${prefix}.variantDiff.${key} must be a non-negative integer`);
      }
      if (
        Number.isInteger(diff?.spanBefore) &&
        Number.isInteger(diff?.spanAfter) &&
        !(
          Math.min(diff.spanBefore, diff.spanAfter) <= 1 &&
          Math.abs(diff.spanAfter - diff.spanBefore) <= 1
        )
      )
        error(errors, `${prefix}.variantDiff claims a variant spanning several segments`);
      for (const key of ['segmentIndex', 'segmentsBefore', 'segmentsAfter']) {
        validateNumber(errors, diff?.[key], `${prefix}.variantDiff.${key}`, {
          integer: true,
          nonNegative: true,
        });
      }
      for (const key of ['before', 'after']) {
        if (typeof diff?.[key] !== 'string')
          error(errors, `${prefix}.variantDiff.${key} must be a string`);
        else if (diff[key].length > 40)
          error(errors, `${prefix}.variantDiff.${key} is longer than a bounded segment`);
      }
      if (
        Number.isInteger(diff?.segmentIndex) &&
        Number.isInteger(diff?.segmentsBefore) &&
        diff.segmentIndex >= diff.segmentsBefore
      )
        error(errors, `${prefix}.variantDiff.segmentIndex is outside the key`);
    }
  });
}

function validateQueryValues(errors, queries, label) {
  if (!Array.isArray(queries)) return;
  queries.forEach((query, index) => {
    const prefix = `${label}[${index}]`;
    if (query?.kind === 'completion-status') {
      if (typeof query.value !== 'boolean')
        error(errors, `${prefix}.value must be the boolean completion status`);
      return;
    }
    if (query?.kind !== 'active-uniforms' && query?.kind !== 'active-attributes') return;
    if (query.value !== null && !finite(query.value))
      error(errors, `${prefix}.value must be the active cardinality or null`);
  });
}

function validateReceipt(errors, capture) {
  const receipt = capture.effective;
  if (!receipt || typeof receipt !== 'object') {
    error(errors, 'effective runtime receipt is missing');
    return;
  }
  if (receipt.schemaVersion !== GPU_HITCH_SCHEMA_VERSION)
    error(errors, 'effective runtime receipt schemaVersion mismatch');
  for (const key of ['prewarmPacing', 'modular']) {
    if (!receipt[key] || typeof receipt[key] !== 'object')
      error(errors, `effective.${key} is missing`);
  }
}

function validateRequestedEffective(errors, capture) {
  const requested = capture.requested;
  const effective = capture.effective;
  if (!requested || typeof requested !== 'object') {
    error(errors, 'requested knobs are missing');
    return;
  }
  const pacing = effective?.prewarmPacing;
  if (requested.linkmode !== null) {
    if (requested.linkmode !== 'adaptive') {
      error(errors, 'requested linkmode is invalid');
    } else if (pacing?.available !== true) {
      error(errors, 'adaptive linkmode was requested but link pacing is unavailable');
    } else if (pacing.mode !== 'adaptive') {
      error(errors, 'requested adaptive linkmode did not produce adaptive pacing');
    } else if (pacing.linksPerSecond !== null) {
      error(errors, 'adaptive pacing must not claim a fixed linksPerSecond');
    }
  }
  if (requested.linkrate !== null) {
    if (pacing?.available !== true) {
      error(errors, 'linkrate was requested but link pacing is unavailable');
    } else if (requested.linkrate === 0 && pacing.mode !== 'unlimited') {
      error(errors, 'requested linkrate=0 did not produce unlimited pacing');
    } else if (requested.linkrate > 0 && pacing.linksPerSecond !== requested.linkrate) {
      error(errors, 'effective linksPerSecond does not match requested linkrate');
    }
  }
  if (
    requested.linkburst !== null &&
    pacing?.available === true &&
    pacing.burst !== requested.linkburst
  )
    error(errors, 'effective burst does not match requested linkburst');
  if (
    requested.compileroots !== null &&
    pacing?.available === true &&
    pacing.compileBatchRoots !== requested.compileroots
  )
    error(errors, 'effective compileBatchRoots does not match requested compileroots');
  if (
    requested.prewarmdeadline !== null &&
    pacing?.available === true &&
    pacing.hardMaxMs !== requested.prewarmdeadline
  )
    error(errors, 'effective hardMaxMs does not match requested prewarmdeadline');
  const modular = effective?.modular;
  for (const [key, field] of [
    ['modular', 'self'],
    ['modularpeers', 'peers'],
  ]) {
    const value = requested[key];
    if (value === null) continue;
    if (modular?.available !== true) {
      error(errors, `${key} was requested but modular flags are unavailable`);
    } else if ((value === 'off') === modular[field]) {
      error(errors, `effective modular ${field} does not match requested ${key}`);
    }
  }
}

function captureEvidence(capture) {
  const captureInfo = capture?.capture ?? {};
  const environment = capture?.environment ?? {};
  const flags = Array.isArray(environment.browserFlags) ? environment.browserFlags : [];
  const headless =
    captureInfo.headless === true ||
    environment.headless === true ||
    flags.some((flag) => typeof flag === 'string' && /^--headless(?:=|$)/.test(flag));
  const rendererText = [
    environment.glVendor,
    environment.glRenderer,
    capture?.effective?.renderer?.glVendor,
    capture?.effective?.renderer?.glRenderer,
    capture?.diagnostics?.rendererStats?.glVendor,
    capture?.diagnostics?.rendererStats?.glRenderer,
    environment.softwareRendering,
    environment.softwareRenderer,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ');
  const swiftShader =
    /swiftshader/i.test(rendererText) ||
    flags.some((flag) => typeof flag === 'string' && /swiftshader/i.test(flag));
  const softwareRenderer =
    swiftShader ||
    environment.softwareRendering === true ||
    environment.softwareRenderer === true ||
    SOFTWARE_RENDERER_PATTERN.test(rendererText);
  return {
    headless,
    swiftShader,
    softwareRenderer,
    performanceEvidence: !headless && !softwareRenderer,
  };
}

/** Validate a raw capture before any derived metric is trusted. */
export function validateCapture(capture, expected = {}) {
  const errors = [];
  const warnings = [];
  if (!capture || typeof capture !== 'object')
    return {
      valid: false,
      errors: ['capture is not an object'],
      warnings,
      performanceEvidence: false,
      evidenceKind: 'invalid',
    };
  const evidence = captureEvidence(capture);
  if (evidence.headless)
    warnings.push('headless capture is smoke-only and cannot be used as performance evidence');
  if (evidence.swiftShader)
    warnings.push(
      'SwiftShader software renderer is smoke-only and cannot be used as performance evidence',
    );
  else if (evidence.softwareRenderer)
    warnings.push('software renderer is smoke-only and cannot be used as performance evidence');
  const requiresPerformanceEvidence =
    expected.performanceEvidence === true ||
    expected.requirePerformanceEvidence === true ||
    expected.evidenceKind === 'performance' ||
    capture.capture?.performanceEvidence === true;
  if (requiresPerformanceEvidence && evidence.headless)
    error(errors, 'headless capture cannot be used as performance evidence');
  if (requiresPerformanceEvidence && evidence.swiftShader)
    error(errors, 'SwiftShader software renderer cannot be used as performance evidence');
  else if (requiresPerformanceEvidence && evidence.softwareRenderer)
    error(errors, 'software renderer cannot be used as performance evidence');
  if (capture.schemaVersion !== GPU_HITCH_SCHEMA_VERSION)
    error(
      errors,
      `capture schemaVersion ${capture.schemaVersion} is not the supported version ${GPU_HITCH_SCHEMA_VERSION}`,
    );
  if (capture.capture?.complete !== true) error(errors, 'capture is incomplete');
  const campaign = capture.capture ?? {};
  if (own(campaign, 'durationMs'))
    validateNumber(errors, campaign.durationMs, 'capture.durationMs', { nonNegative: true });
  if (own(campaign, 'totalElapsedMs')) {
    validateNumber(errors, campaign.totalElapsedMs, 'capture.totalElapsedMs', {
      nonNegative: true,
    });
    if (
      finite(campaign.totalElapsedMs) &&
      finite(campaign.durationMs) &&
      campaign.totalElapsedMs < campaign.durationMs
    )
      error(errors, 'capture.totalElapsedMs precedes durationMs');
  }
  const campaignFields = [campaign.groupId, campaign.leg, campaign.repetition, campaign.order];
  if (campaignFields.some((value) => value !== null && value !== undefined)) {
    if (typeof campaign.groupId !== 'string' || campaign.groupId === '')
      error(errors, 'capture.groupId is missing');
    if (typeof campaign.leg !== 'string' || campaign.leg === '')
      error(errors, 'capture.leg is missing');
    for (const key of ['repetition', 'order']) {
      if (!Number.isInteger(campaign[key]) || campaign[key] <= 0)
        error(errors, `capture.${key} must be a positive integer`);
    }
  }
  if (!capture.provenance || typeof capture.provenance !== 'object') {
    error(errors, 'provenance is missing');
  } else {
    for (const key of [
      'gitHead',
      'sourceBuildId',
      'servedBuildId',
      'probeSha256',
      'analyzerSha256',
    ]) {
      if (typeof capture.provenance[key] !== 'string' || capture.provenance[key] === '')
        error(errors, `provenance.${key} is missing`);
    }
    for (const key of [
      'sourceBuildId',
      'servedBuildId',
      'probeSha256',
      'analyzerSha256',
      'worktreeName',
    ]) {
      if (expected[key] !== undefined && capture.provenance[key] !== expected[key])
        error(errors, `provenance.${key} does not match expected value`);
    }
  }
  validateReceipt(errors, capture);
  validateRequestedEffective(errors, capture);
  const timeline = capture.timeline;
  if (!timeline || typeof timeline !== 'object') {
    error(errors, 'timeline is missing');
  } else {
    validateEventArray(errors, timeline.links, 'timeline.links');
    validateEventArray(errors, timeline.queries, 'timeline.queries');
    validateQueryValues(errors, timeline.queries, 'timeline.queries');
    validateProgramIdentityArray(errors, timeline.programs, 'timeline.programs');
    validateCompileUnitArray(errors, timeline.compileUnits ?? [], 'timeline.compileUnits');
    validateUploadBucketArray(errors, timeline.uploadBuckets, 'timeline.uploadBuckets');
    if (!Array.isArray(timeline.sceneRoots)) error(errors, 'timeline.sceneRoots must be an array');
  }
  if (capture.environment?.contextLost > 0) error(errors, 'WebGL context was lost');
  if (capture.environment?.visible !== true) error(errors, 'capture page was not visible');
  const visibilityTransitions = capture.environment?.visibilityTransitions;
  if (!Array.isArray(visibilityTransitions)) {
    error(errors, 'environment.visibilityTransitions must be an array');
  } else {
    let previousVisibilityAt = -Infinity;
    visibilityTransitions.forEach((transition, index) => {
      validateNumber(errors, transition?.atMs, `environment.visibilityTransitions[${index}].atMs`, {
        nonNegative: true,
      });
      if (finite(transition?.atMs) && transition.atMs < previousVisibilityAt)
        error(errors, `environment.visibilityTransitions[${index}].atMs is not monotonic`);
      if (finite(transition?.atMs)) previousVisibilityAt = transition.atMs;
    });
  }
  if (
    visibilityTransitions?.some((transition) => transition?.state && transition.state !== 'visible')
  )
    error(errors, 'capture page became hidden');
  const valid = errors.length === 0;
  return {
    valid,
    errors,
    warnings,
    performanceEvidence: valid && evidence.performanceEvidence,
    evidenceKind: valid ? (evidence.performanceEvidence ? 'performance' : 'smoke') : 'invalid',
  };
}

function comparableValue(capture, key, varying = new Set()) {
  const provenance = capture?.provenance ?? {};
  const environment = capture?.environment ?? {};
  const requested = capture?.requested ?? {};
  const captureInfo = capture?.capture ?? {};
  switch (key) {
    case 'sourceBuildId':
      return provenance.sourceBuildId;
    case 'servedBuildId':
      return provenance.servedBuildId;
    case 'probeSha256':
      return provenance.probeSha256;
    case 'analyzerSha256':
      return provenance.analyzerSha256;
    case 'schemaVersion':
      return capture?.schemaVersion;
    case 'profile':
      return captureInfo.profile;
    case 'browserVersion':
      return environment.browserVersion;
    case 'browserFlags':
      return JSON.stringify(environment.browserFlags ?? []);
    case 'shaderDiskCache':
      return environment.shaderDiskCache;
    case 'glVendor':
      return environment.glVendor;
    case 'glRenderer':
      return environment.glRenderer;
    case 'viewport':
      return environment.viewport;
    case 'devicePixelRatio':
      return environment.devicePixelRatio;
    case 'gfx':
      return requested.gfx;
    case 'scenario':
      return captureInfo.scenario ?? null;
    case 'zone':
      return (
        captureInfo.zone ??
        captureInfo.zoneId ??
        capture?.environment?.zone ??
        capture?.environment?.zoneId ??
        capture?.diagnostics?.zone ??
        capture?.diagnostics?.zoneId ??
        capture?.diagnostics?.currentZoneId ??
        capture?.diagnostics?.rendererStats?.currentZoneId ??
        capture?.environment?.currentZoneId ??
        null
      );
    case 'observer':
      // Two legs at different world spots stream different content, so they are
      // not one another's control however well every other key matches.
      return captureInfo.observer ?? null;
    case 'groupId':
      return captureInfo.groupId ?? null;
    case 'fixture':
      return captureInfo.fixture ?? null;
    case 'durationMs':
      return captureInfo.durationMs ?? null;
    case 'requested.linkmode':
    case 'requested.linkrate':
    case 'requested.linkburst':
    case 'requested.compileroots':
    case 'requested.prewarmdeadline':
    case 'requested.modular':
    case 'requested.modularpeers':
      return requested[key.slice('requested.'.length)] ?? null;
    case 'effective.prewarmPacing':
      return effectivePacingForComparison(capture?.effective?.prewarmPacing, requested, varying);
    case 'effective.modular':
      return effectiveModularForComparison(capture?.effective?.modular, requested, varying);
    case 'rendererTier':
      return (
        capture?.effective?.renderer?.tier ??
        capture?.environment?.rendererTier ??
        capture?.diagnostics?.rendererStats?.tier ??
        null
      );
    default:
      return undefined;
  }
}

function effectivePacingForComparison(pacing, requested, varying) {
  if (!pacing || typeof pacing !== 'object') return null;
  const varyingMode = varying.has('linkmode');
  return {
    available: pacing.available ?? null,
    mode: varying.has('linkrate') || varyingMode ? null : (pacing.mode ?? null),
    linksPerSecond:
      varying.has('linkrate') || varyingMode
        ? null
        : requested.linkrate === null
          ? (pacing.linksPerSecond ?? null)
          : null,
    burst:
      varying.has('linkburst') || varyingMode
        ? null
        : requested.linkburst === null
          ? (pacing.burst ?? null)
          : null,
    compileBatchRoots: varying.has('compileroots')
      ? null
      : requested.compileroots === null
        ? (pacing.compileBatchRoots ?? null)
        : null,
    hardMaxMs: varying.has('prewarmdeadline')
      ? null
      : requested.prewarmdeadline === null
        ? (pacing.hardMaxMs ?? null)
        : null,
    scope: varyingMode ? null : (pacing.scope ?? null),
    reason: pacing.reason ?? null,
  };
}

function effectiveModularForComparison(modular, requested, varying) {
  if (!modular || typeof modular !== 'object') return null;
  return {
    available: modular.available ?? null,
    self: varying.has('modular')
      ? null
      : requested.modular === null
        ? (modular.self ?? null)
        : null,
    peers: varying.has('modularpeers')
      ? null
      : requested.modularpeers === null
        ? (modular.peers ?? null)
        : null,
    reason: modular.reason ?? null,
  };
}

/** Return all fields that make two A/B legs incomparable. */
export function comparabilityMismatches(left, right, { varying = [] } = {}) {
  const varyingSet = new Set(varying);
  const mismatches = [];
  for (const key of COMPARABILITY_KEYS) {
    if (
      varyingSet.has(key) ||
      (key.startsWith('requested.') && varyingSet.has(key.slice('requested.'.length))) ||
      (key === 'durationMs' &&
        (varyingSet.has('durationMs') || varyingSet.has('capture.durationMs'))) ||
      (key === 'effective.prewarmPacing' && varyingSet.has('effective.prewarmPacing')) ||
      (key === 'effective.modular' && varyingSet.has('effective.modular')) ||
      (key === 'rendererTier' && varyingSet.has('effective.renderer.tier'))
    )
      continue;
    if (
      JSON.stringify(comparableValue(left, key, varyingSet)) !==
      JSON.stringify(comparableValue(right, key, varyingSet))
    )
      mismatches.push(key);
  }
  return mismatches;
}

export function areComparable(left, right, options = {}) {
  return comparabilityMismatches(left, right, options).length === 0;
}

/**
 * Best-effort name for the cache-key segment a variant changed.
 *
 * Position is counted from the END, because the `defines` block before the
 * parameters is variable length. The tail is
 * `... parameters(48), programLayersMask, outputColorSpace, customProgramCacheKey`.
 *
 * The catch, stated rather than hidden: `array.join()` uses a comma and
 * `customProgramCacheKey` is the onBeforeCompile SOURCE for a patched material,
 * so it contributes its own commas and shifts the count. A name is therefore
 * returned only when the position lands inside the parameter block under the
 * assumption of a single trailing segment (a material with no hook). Otherwise
 * the caller gets `null` and must read the before/after VALUES, which are not
 * affected by the shift.
 */
export function variantDiffParameter(diff) {
  if (!diff || !Number.isInteger(diff.segmentIndex) || !Number.isInteger(diff.segmentsBefore))
    return null;
  const trailers = THREE_CACHE_KEY_TRAILERS.length;
  const fromEnd = diff.segmentsBefore - diff.segmentIndex;
  if (fromEnd === 1) return 'customProgramCacheKey';
  if (fromEnd >= 2 && fromEnd <= trailers + 1)
    return THREE_CACHE_KEY_TRAILERS[trailers + 1 - fromEnd];
  const parameterIndex = THREE_CACHE_KEY_PARAMETERS.length + trailers + 1 - fromEnd;
  if (parameterIndex < 0 || parameterIndex >= THREE_CACHE_KEY_PARAMETERS.length) return null;
  return THREE_CACHE_KEY_PARAMETERS[parameterIndex];
}

/**
 * Group every observed variant by what actually changed. A condition that flips
 * globally shows up as ONE before/after pair shared by many materials, which is
 * what separates it from content arriving one subsystem at a time.
 */
export function cacheKeyVariance(capture) {
  const programs = Array.isArray(capture?.timeline?.programs) ? capture.timeline.programs : [];
  const linkAt = new Map();
  for (const link of Array.isArray(capture?.timeline?.links) ? capture.timeline.links : []) {
    const previous = linkAt.get(link.programId);
    if (previous === undefined || link.startMs < previous.startMs) linkAt.set(link.programId, link);
  }
  const groups = new Map();
  let variantPrograms = 0;
  // Programs whose family key collided rather than varying: the probe's
  // retention key is the material class plus name, so it reports a difference
  // spanning several cache-key segments as ambiguous instead of as a variant.
  let ambiguousPrograms = 0;
  for (const program of programs) {
    if (program?.variantAmbiguous === true) ambiguousPrograms++;
    const diff = program.variantDiff;
    if (!diff) continue;
    variantPrograms++;
    const parameter = variantDiffParameter(diff);
    const key = `${parameter ?? `segment@-${diff.segmentsBefore - diff.segmentIndex}`}|${diff.before}->${diff.after}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        parameter,
        fromEnd: diff.segmentsBefore - diff.segmentIndex,
        before: diff.before,
        after: diff.after,
        programs: 0,
        materials: new Set(),
        firstLinkAtMs: null,
        lastLinkAtMs: null,
      };
      groups.set(key, row);
    }
    row.programs++;
    row.materials.add(program.materialName || program.materialType || '(unnamed)');
    const link = linkAt.get(program.programId);
    if (link) {
      if (row.firstLinkAtMs === null || link.startMs < row.firstLinkAtMs)
        row.firstLinkAtMs = link.startMs;
      if (row.lastLinkAtMs === null || link.startMs > row.lastLinkAtMs)
        row.lastLinkAtMs = link.startMs;
    }
  }
  return {
    programsAttributed: programs.length,
    variantPrograms,
    ambiguousPrograms,
    groups: [...groups.values()]
      .map((row) => ({ ...row, materials: [...row.materials].sort() }))
      .sort((left, right) => right.programs - left.programs),
  };
}

export const REFLECTION_FAMILIES = Object.freeze([
  // Never submitted to compileAsync: linkProgram and the first use happen in
  // the same instruction stream, so the query absorbs the whole link.
  'never-compiled',
  // Submitted, but drawn before any completion poll returned true. The draw
  // raced its own pending link and pays whatever link time remained.
  'raced-pending-link',
  // A completion poll had already returned true when the first use arrived.
  // This is the only family that measures reflection itself.
  'settled-first',
]);

const REFLECTION_KINDS = Object.freeze(['active-uniforms', 'active-attributes']);

function emptyFamilyRow() {
  return { calls: 0, totalMs: 0, maxMs: 0, programs: 0 };
}

/**
 * Classify every reflection query by what the program's link had actually done
 * by the time the query was issued.
 *
 * The discriminator is the completion-status RETURN VALUE, not a timestamp
 * ordering: a program can be polled again after it is ready, so "the query came
 * before the last poll" would misclassify. A program counts as settled only
 * once a poll observed true strictly before the reflection query started.
 */
export function reflectionAttribution(capture) {
  const timeline = capture?.timeline ?? {};
  const queries = Array.isArray(timeline.queries) ? timeline.queries : [];
  const links = Array.isArray(timeline.links) ? timeline.links : [];
  const identities = new Map(
    (Array.isArray(timeline.programs) ? timeline.programs : []).map((program) => [
      program.programId,
      program,
    ]),
  );
  const revealAtMs =
    (Array.isArray(timeline.phases) ? timeline.phases : []).find(
      (phase) => phase?.event === 'reveal',
    )?.atMs ?? null;

  const polls = new Map();
  for (const query of queries) {
    if (query?.kind !== 'completion-status') continue;
    let row = polls.get(query.programId);
    if (!row) {
      row = { first: null, readyAt: null };
      polls.set(query.programId, row);
    }
    if (row.first === null || query.startMs < row.first) row.first = query.startMs;
    if (query.value === true && (row.readyAt === null || query.startMs < row.readyAt))
      row.readyAt = query.startMs;
  }

  const firstLink = new Map();
  for (const link of links) {
    if (!finite(link?.startMs)) continue;
    const previous = firstLink.get(link.programId);
    if (previous === undefined || link.startMs < previous.startMs)
      firstLink.set(link.programId, link);
  }

  // A completion poll EXISTS only for a program three submitted through
  // compileAsync: WebGLProgram.isReady is the sole COMPLETION_STATUS_KHR caller
  // in r165 and only the compileAsync poll pass calls it. So a poll that starts
  // AFTER the query still proves submission, and the program was drawn in the
  // same frame it was submitted, before its first poll: that is a raced pending
  // link, not a program that was never compiled asynchronously. Only the total
  // absence of a poll says never-compiled.
  //
  // Two limits of that reading, stated rather than assumed. Without
  // KHR_parallel_shader_compile three flags a program ready on construction and
  // never queries at all, so EVERY program looks never-compiled: `polledPrograms`
  // travels with the result and a capture reporting zero is not evidence about
  // these families, it is evidence the extension was missing. And a program
  // first linked synchronously at a draw, then swept up by a LATER compileAsync
  // pass over the same cached program, reads as raced rather than
  // never-compiled; the families are a population readout, not a per-program
  // verdict.
  const familyOf = (query) => {
    const poll = polls.get(query.programId);
    if (!poll || !finite(poll.first)) return 'never-compiled';
    if (poll.readyAt !== null && poll.readyAt < query.startMs) return 'settled-first';
    return 'raced-pending-link';
  };

  const families = {};
  for (const family of REFLECTION_FAMILIES) {
    families[family] = { cover: emptyFamilyRow(), live: emptyFamilyRow(), all: emptyFamilyRow() };
  }
  const seenPrograms = { cover: new Set(), live: new Set(), all: new Set() };
  const rows = [];
  for (const query of queries) {
    if (!REFLECTION_KINDS.includes(query?.kind)) continue;
    const family = familyOf(query);
    const phase = query.phaseAtStart === 'live' ? 'live' : 'cover';
    for (const bucket of [phase, 'all']) {
      const row = families[family][bucket];
      row.calls++;
      row.totalMs += query.durationMs;
      row.maxMs = Math.max(row.maxMs, query.durationMs);
      const key = `${family}:${query.programId}`;
      if (!seenPrograms[bucket].has(key)) {
        seenPrograms[bucket].add(key);
        row.programs++;
      }
    }
    if (query.kind !== 'active-uniforms') continue;
    const identity = identities.get(query.programId) ?? null;
    const link = firstLink.get(query.programId) ?? null;
    rows.push({
      programId: query.programId,
      family,
      phase,
      kind: query.kind,
      startMs: query.startMs,
      durationMs: query.durationMs,
      activeCount: finite(query.value) ? query.value : null,
      preControlMs: finite(query.preControlMs) ? query.preControlMs : null,
      materialType: identity?.materialType ?? '',
      materialName: identity?.materialName ?? '',
      cacheKeyHash: identity?.cacheKeyHash ?? '',
      linkAtMs: link?.startMs ?? null,
      linkLane: link?.lane ?? null,
      linkPhase: link?.phaseAtStart ?? null,
      linkToReflectionMs: link && finite(link.startMs) ? query.startMs - link.startMs : null,
      draw: query.draw ?? null,
    });
  }

  // A live variant whose cache key was already linked under the curtain is a
  // DUPLICATE the prewarm dedupe missed; one that never appears under cover is
  // a variant prewarm never built. The two need different fixes, so they are
  // counted apart rather than lumped into one "missed by prewarm" number.
  const coverCacheKeys = new Set();
  for (const link of links) {
    if (link.phaseAtStart === 'live') continue;
    const hash = identities.get(link.programId)?.cacheKeyHash;
    if (hash) coverCacheKeys.add(hash);
  }
  let liveLinkedKnownKey = 0;
  let liveLinkedNewKey = 0;
  let liveLinkedUnattributed = 0;
  for (const link of links) {
    if (link.phaseAtStart !== 'live') continue;
    const hash = identities.get(link.programId)?.cacheKeyHash;
    if (!hash) liveLinkedUnattributed++;
    else if (coverCacheKeys.has(hash)) liveLinkedKnownKey++;
    else liveLinkedNewKey++;
  }

  return {
    revealAtMs,
    families,
    // Zero here means no program was ever polled for completion, which on this
    // renderer means KHR_parallel_shader_compile was unavailable rather than
    // that nothing compiled asynchronously. The families below are unreadable
    // in that case, so the count travels with them.
    polledPrograms: polls.size,
    programsAttributed: identities.size,
    linksTotal: links.length,
    linksCover: links.filter((link) => link.phaseAtStart !== 'live').length,
    linksLive: links.filter((link) => link.phaseAtStart === 'live').length,
    liveLinkedKnownKey,
    liveLinkedNewKey,
    liveLinkedUnattributed,
    rows: rows.sort((left, right) => right.durationMs - left.durationMs),
  };
}

/** Derive a compact summary only after raw validation has succeeded. */
export function summarizeCapture(
  capture,
  { slowMs = 100, windowMs = 8_000, reflectionRows = 40 } = {},
) {
  const validation = validateCapture(capture);
  if (!validation.valid)
    throw new Error(`cannot summarize invalid capture: ${validation.errors.join('; ')}`);
  const links = capture.timeline.links;
  const queries = capture.timeline.queries;
  const slowQueries = queries
    .filter((query) => query.durationMs >= slowMs)
    .map((query) => ({
      ...query,
      linksBefore: linksBeforeQuery(query, links, windowMs),
      uploadsBefore: uploadBucketsBeforeQuery(
        query,
        capture.timeline.uploadBuckets,
        windowMs,
        capture.timeline.uploadBucketWidthMs ?? GPU_HITCH_UPLOAD_BUCKET_MS,
      ),
    }));
  const queriesByKind = {};
  for (const query of queries) {
    let row = queriesByKind[query.kind];
    if (!row) {
      row = { calls: 0, totalMs: 0, maxMs: 0 };
      queriesByKind[query.kind] = row;
    }
    row.calls++;
    row.totalMs += query.durationMs;
    row.maxMs = Math.max(row.maxMs, query.durationMs);
  }
  const attribution = reflectionAttribution(capture);
  return {
    schemaVersion: GPU_HITCH_SCHEMA_VERSION,
    // The full per-program rows stay derivable from the raw timeline; the
    // summary keeps only the most expensive ones so the artifact does not carry
    // a second copy of the reflection timeline.
    reflection: {
      ...attribution,
      rows: attribution.rows.slice(0, reflectionRows),
      rowsTotal: attribution.rows.length,
    },
    cacheKeyVariance: cacheKeyVariance(capture),
    linksTotal: links.length,
    linksByLane: links.reduce((out, link) => {
      out[link.lane] = (out[link.lane] ?? 0) + 1;
      return out;
    }, {}),
    queriesByKind,
    compileUnits: capture.timeline.compileUnits,
    compileUnitsAtReveal: capture.timeline.compileUnits.reduce((out, unit) => {
      const status = unit.statusAtReveal ?? 'unknown';
      out[status] = (out[status] ?? 0) + 1;
      return out;
    }, {}),
    slowQueries: slowQueries.sort((a, b) => b.durationMs - a.durationMs),
    phaseTransitions: capture.timeline.phases ?? [],
  };
}

/** Build a host-side provenance object without exposing an absolute path. */
export function makeProvenance({
  gitHead,
  branch,
  sourceBuildId,
  servedBuildId,
  probeSha256,
  analyzerSha256,
  worktreeName,
  dirty,
}) {
  return {
    gitHead: String(gitHead ?? ''),
    branch: String(branch ?? ''),
    sourceBuildId: String(sourceBuildId ?? ''),
    servedBuildId: String(servedBuildId ?? ''),
    probeSha256: String(probeSha256 ?? ''),
    analyzerSha256: String(analyzerSha256 ?? ''),
    worktreeName: String(worktreeName ?? ''),
    dirty: dirty === true,
  };
}

export function requestedValueForKey(requested, key) {
  return queryRequestedValue(requested?.[key]);
}
