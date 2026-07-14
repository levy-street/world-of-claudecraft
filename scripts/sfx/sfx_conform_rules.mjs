// Pure classification logic for sfx_conform.mjs. No I/O, no side effects.

export const TARGET_BITRATE = 192;
export const MIN_SOURCE_BITRATE = 112;
export const TARGET_SAMPLE_RATE = 44100;
export const DURATION_THRESHOLD = 1.0; // clips below this use peak norm; at/above use LUFS
export const TARGET_PEAK_DBFS = -6;
export const TARGET_LUFS = -14;
export const NORM_TOLERANCE = 0.5; // dB/LU tolerance window for loudness checks

// Lossless formats always get transcoded to 192kbps MP3. Their bitrate is
// meaningless for the quality gate and is never flagged as a problem.
export const LOSSLESS_EXTENSIONS = new Set(['.wav', '.flac', '.aiff', '.aif']);

export const TARGET_MONO_CHANNELS = 1;
export const TARGET_STEREO_CHANNELS = 2;

// Channel policy. Stereo is retained ONLY for catalog entries explicitly flagged
// `stereo: true` (global ambience beds, where L/R width is audible and the loop is
// not positioned through a panner). Every other cue is mono: `playAt` routes through
// an equalpower PannerNode that downmixes to mono before positioning, and
// `playUi` sums to the mono master, so a second channel is decoded into the
// shared AudioBuffer and then discarded. Encoding those cues mono halves their
// decoded footprint, which is the binding constraint on the iOS WKWebView build.
// Standard: docs/design/sound_effects.md.
export function expectedChannelsForEntry(entry) {
  return entry?.stereo ? TARGET_STEREO_CHANNELS : TARGET_MONO_CHANNELS;
}

// Return a human-readable channel problem, or null when the file matches policy.
// `channels` is the measured stream channel count; `expected` is the policy
// target from expectedChannelsForEntry. A non-positive value on either side means
// the metadata cannot decide the question, so no violation is invented.
export function channelProblem(channels, expected) {
  if (!(channels > 0) || !(expected > 0) || channels === expected) return null;
  const want = expected === TARGET_MONO_CHANNELS ? 'mono' : 'stereo';
  const got = channels === TARGET_MONO_CHANNELS ? 'mono' : `${channels}ch`;
  return `${got} (want ${want})`;
}

/**
 * Classify a file's measured stats and return what problems need fixing.
 *
 * For lossless sources (isLossless=true):
 *   - The reject gate is skipped (lossless is always acceptable quality).
 *   - The bitrate check is skipped (lossless bitrate is irrelevant).
 *   - 'lossless source' is always present in problems so the file is always processed.
 *   - Sample rate and loudness checks still apply.
 *
 * @param {{ duration: number, bitrate: number, sampleRate: number, peakDb?: number|null, lufs?: number|null, isLossless?: boolean, isMp3?: boolean }} stats
 * @returns {{ reject: boolean, problems: string[], normBranch: 'peak'|'lufs'|null }}
 */
export function classify({
  duration,
  bitrate,
  sampleRate,
  peakDb = null,
  lufs = null,
  isLossless = false,
  isMp3 = true,
}) {
  if (!isLossless && bitrate < MIN_SOURCE_BITRATE) {
    return { reject: true, problems: [], normBranch: null };
  }

  const problems = [];

  if (isLossless) {
    problems.push('lossless source');
  } else {
    if (!isMp3) problems.push('non-MP3 source');
    if (bitrate < TARGET_BITRATE) {
      problems.push(`${bitrate}kbps (want ${TARGET_BITRATE}kbps)`);
    } else if (bitrate > TARGET_BITRATE + 8) {
      problems.push(`${bitrate}kbps (want ${TARGET_BITRATE}kbps)`);
    }
  }

  if (sampleRate !== TARGET_SAMPLE_RATE) {
    problems.push(`${sampleRate}Hz (want ${TARGET_SAMPLE_RATE}Hz)`);
  }

  const normBranch = duration < DURATION_THRESHOLD ? 'peak' : 'lufs';

  if (normBranch === 'peak' && peakDb !== null) {
    if (Math.abs(peakDb - TARGET_PEAK_DBFS) > NORM_TOLERANCE) {
      problems.push(`peak ${peakDb.toFixed(1)}dBFS (want ${TARGET_PEAK_DBFS}dBFS)`);
    }
  }
  if (normBranch === 'lufs' && lufs !== null) {
    if (Math.abs(lufs - TARGET_LUFS) > NORM_TOLERANCE) {
      problems.push(`${lufs.toFixed(1)} LUFS (want ${TARGET_LUFS} LUFS)`);
    }
  }

  return { reject: false, problems, normBranch };
}
