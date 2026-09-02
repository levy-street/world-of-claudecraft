// GPU model bucketing for client_perf_reports: turns a browser
// UNMASKED_RENDERER_WEBGL string (or a WebGPU adapter description, which has the
// same vendor vocabulary) into a stable family key plus a form-factor verdict.
//
// Why this exists beside perf_report.ts bucketGpu: that bucket is VENDOR level
// by design (every NVIDIA card is the single key 'nvidia') and its coarseness is
// pinned, so the fleet cannot tell a 4070 laptop from a 3060 desktop. This
// module is the finer dimension; bucketGpu stays exactly as it is.
//
// Pure and dependency-free on purpose: no imports, no IO, no clock, so
// tests/gpu_model_bucket.test.ts exercises every string form directly. The
// inputs are attacker-controllable (any token holder can post a report), so
// every output is shape-bounded rather than derived from the input text: a key
// is lowercase [a-z0-9-] of at most GL_MODEL_MAX chars, always one of the
// recognised families or a vendor fallback, never a slice of the raw string.

/** Hard ceiling on a family key, so the column can never hold a long string. */
export const GL_MODEL_MAX = 40;
/** Unrecognised vendor and model, including an empty or farbled string. */
export const GL_MODEL_OTHER = 'other';
/** Any CPU rasterizer: SwiftShader, llvmpipe, WARP, Microsoft Basic Render. */
export const GL_MODEL_SOFTWARE = 'software';
/** Integrated Radeon parts, which ship no model number in the GL string. */
export const GL_MODEL_AMD_IGPU = 'amd-radeon-igpu';

// Registered-mark noise ("Intel(R) Iris(R) Xe", "Adreno (TM) 740") sits between
// the vendor and the model on exactly the strings this module must parse, so it
// is stripped once up front rather than in every pattern below.
const TRADEMARK_MARKS = /\((?:r|tm|c)\)/gi;

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render driver|\bwarp\b|software/i;
// Mobile SoCs and Apple silicon: one package, so "laptop" is not a question
// these strings can answer.
const UNDECIDABLE_FORM_FACTOR = /\bapple\b|\badreno\b|\bmali\b|\bpowervr\b/i;
// The markers a vendor puts in the string itself when the part is a mobile one.
const MOBILE_MARKERS = /\blaptop gpu\b|\bmax-?q\b|\bmobile\b/i;

const APPLE_CHIP = /\bapple\s+(m\d+)(?:\s+(pro|max|ultra))?/i;
// GeForce consumer and RTX A-series workstation parts, with the Ti / SUPER
// suffixes that distinguish real SKUs ("RTX 4070 Ti SUPER").
const NVIDIA_MODEL = /\b(rtx|gtx)\s*(a?\d{3,4})((?:\s*(?:ti|super))*)/i;
const INTEL_ARC = /\barc\s+([ab]\d{3,4}m?)\b/i;
const INTEL_GRAPHICS_NUMBER = /\bgraphics\s+(\d{3,4})\b/i;
// The S and M suffixes ride the number with no separator ("RX 7700S"), the
// XT / XTX / GRE ones are their own token ("RX 6700 XT").
const AMD_RX = /\brx\s*(\d{3,4})\s*(xtx|xt|gre|s|m)?\b/i;
const AMD_INTEGRATED = /\bradeon\s+graphics\b|\bvega\s+\d+\b/i;
const QUALCOMM_ADRENO = /\badreno\b\D*(\d{3,4})\b/i;
const ARM_MALI = /\bmali[-\s]*([a-z]\d{2,3})\b/i;

/** Strip trademark marks so the vendor patterns see one canonical spelling. */
function cleanRenderer(renderer: string): string {
  return typeof renderer === 'string' ? renderer.replace(TRADEMARK_MARKS, ' ').trim() : '';
}

/**
 * Join model parts into the closed key shape.
 *
 * Every key this module returns comes through here, so the [a-z0-9-] and
 * GL_MODEL_MAX guarantees hold for a hostile input too: a captured group is
 * always a bounded digit/letter run from a pattern above, and this collapses
 * anything else. The trailing-dash trim runs again AFTER the slice so a key cut
 * at the ceiling cannot end on a separator.
 */
function modelKey(parts: readonly string[]): string {
  const key = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, GL_MODEL_MAX)
    .replace(/-+$/g, '');
  return key || GL_MODEL_OTHER;
}

function nvidiaModel(clean: string): string | null {
  const m = NVIDIA_MODEL.exec(clean);
  if (!m) return null;
  // The suffix run is matched as one blob so "Ti SUPER" keeps its order; the
  // tokens are re-extracted here rather than trusted as raw text.
  const suffixes = (m[3] ?? '').toLowerCase().match(/ti|super/g) ?? [];
  return modelKey(['nvidia', m[1], m[2], ...suffixes]);
}

function intelModel(clean: string): string {
  const arc = INTEL_ARC.exec(clean);
  if (arc) return modelKey(['intel', 'arc', arc[1]]);
  const number = INTEL_GRAPHICS_NUMBER.exec(clean)?.[1];
  if (/\biris\b/i.test(clean)) {
    // Xe is the generation and carries no number ("Iris Xe Graphics"); the
    // older Plus parts carry one ("Iris Plus Graphics 655").
    const generation = /\bxe\b/i.test(clean) ? 'xe' : /\bplus\b/i.test(clean) ? 'plus' : '';
    return modelKey(['intel', 'iris', generation, generation === 'xe' ? '' : (number ?? '')]);
  }
  if (/\buhd\b/i.test(clean)) return modelKey(['intel', 'uhd', number ?? '']);
  if (/\bhd\s+graphics\b/i.test(clean)) return modelKey(['intel', 'hd', number ?? '']);
  return 'intel';
}

function amdModel(clean: string): string {
  const rx = AMD_RX.exec(clean);
  if (rx) {
    const suffix = (rx[2] ?? '').toLowerCase();
    const mobileSuffix = suffix === 's' || suffix === 'm';
    return modelKey([
      'amd',
      'rx',
      mobileSuffix ? `${rx[1]}${suffix}` : rx[1],
      mobileSuffix ? '' : suffix,
    ]);
  }
  if (AMD_INTEGRATED.test(clean)) return GL_MODEL_AMD_IGPU;
  return 'amd';
}

/**
 * The GPU family a renderer string names: `vendor-family-model`.
 *
 * Recognised families produce a stable key ('nvidia-rtx-4070', 'intel-uhd-630',
 * 'amd-rx-7700s', 'apple-m4-pro', 'qualcomm-adreno-740', 'arm-mali-g78'); a
 * recognised vendor with an unrecognised model falls back to the vendor alone
 * ('nvidia', 'intel', 'amd', 'apple'), which still segments the fleet usefully;
 * anything else, including an empty string and the randomised strings a
 * fingerprint-resistant browser reports, is GL_MODEL_OTHER.
 */
export function glModel(renderer: string): string {
  const clean = cleanRenderer(renderer);
  if (!clean) return GL_MODEL_OTHER;
  // Software first: a CPU rasterizer string can name a vendor it is emulating.
  if (SOFTWARE.test(clean)) return GL_MODEL_SOFTWARE;
  if (/\bapple\b/i.test(clean)) {
    const chip = APPLE_CHIP.exec(clean);
    return chip ? modelKey(['apple', chip[1], chip[2] ?? '']) : 'apple';
  }
  if (/\bnvidia\b|\bgeforce\b|\brtx\b|\bgtx\b/i.test(clean)) return nvidiaModel(clean) ?? 'nvidia';
  if (/\bintel\b/i.test(clean)) return intelModel(clean);
  if (/\bamd\b|\bradeon\b/i.test(clean)) return amdModel(clean);
  const adreno = QUALCOMM_ADRENO.exec(clean);
  if (adreno) return modelKey(['qualcomm', 'adreno', adreno[1]]);
  if (/\badreno\b/i.test(clean)) return 'qualcomm-adreno';
  const mali = ARM_MALI.exec(clean);
  if (mali) return modelKey(['arm', 'mali', mali[1]]);
  if (/\bmali\b/i.test(clean)) return 'arm-mali';
  return GL_MODEL_OTHER;
}

/**
 * Whether the part is a laptop GPU: true, false, or null when the string cannot
 * decide.
 *
 * null is the honest answer far more often than either bool, and it is
 * deliberately the fallback: integrated parts ship in both form factors, Apple
 * silicon and mobile SoCs are one package, and an unrecognised vendor says
 * nothing. false is claimed only for a part recognised AS a discrete desktop
 * card, so a reader can trust the two bools and treat null as "no evidence".
 */
export function glLaptop(renderer: string): boolean | null {
  const clean = cleanRenderer(renderer);
  if (!clean) return null;
  if (SOFTWARE.test(clean)) return null;
  // Checked BEFORE the mobile markers: for these the answer is undecidable even
  // if the string happens to carry a marker word.
  if (UNDECIDABLE_FORM_FACTOR.test(clean)) return null;
  if (MOBILE_MARKERS.test(clean)) return true;
  const model = glModel(renderer);
  // AMD puts the form factor in the SKU suffix, so the parsed key already
  // carries it: S and M are the mobile parts, XT / XTX / GRE and the bare
  // numbers are desktop cards.
  if (/^amd-rx-\d{3,4}[sm]$/.test(model)) return true;
  if (/^amd-rx-\d{3,4}(?:-(?:xt|xtx|gre))?$/.test(model)) return false;
  // Intel Arc M parts are mobile; the rest of Arc is a discrete desktop card.
  if (/^intel-arc-[ab]\d{3,4}m$/.test(model)) return true;
  if (/^intel-arc-[ab]\d{3,4}$/.test(model)) return false;
  // A recognised GeForce SKU with no mobile marker: the vendor writes "Laptop
  // GPU" or "Max-Q" into the string on the mobile parts, so its absence here is
  // real evidence rather than a default.
  if (/^nvidia-(?:rtx|gtx)-/.test(model)) return false;
  // Integrated Intel and Radeon, and every vendor-only fallback: no evidence.
  return null;
}
