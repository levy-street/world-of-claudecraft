// Resolve the ffmpeg/ffprobe binaries for the gate preflight and the SFX Studio
// playback/encode spawns (audio_io.mjs): prefer the pinned
// ffmpeg-static/ffprobe-static npm packages, falling back to the bare PATH names
// when the static binary is absent (the packages download their binary via an
// allowlisted install script, so a scripts-skipped install leaves the import
// pointing at a missing file).
// WOC_FFMPEG_PATH / WOC_FFPROBE_PATH override the resolution outright, with no
// existence check: callers probe by execution, and silently falling back would
// mask an operator's explicit choice. The overrides are NOT universal: the
// conformance-measuring call sites (scripts/sfx_conform.mjs, and the Studio
// export validation in scripts/sfx_studio/export_bundle.mjs, PR #1930) prefer
// the static packages without operator overrides so the published-conformance
// verdict is measured with the exact toolchain that gates the checked-in assets
// when that static binary exists. ffprobe-static@3.1.0 does not ship a Linux
// arm64 ffprobe, so those conformance paths fall back to PATH ffprobe on that
// platform instead of importing a known-missing package path.
import { existsSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export function resolveSfxTool({ overridePath, staticPath, fallback }) {
  if (overridePath) return overridePath;
  if (staticPath && existsSync(staticPath)) return staticPath;
  return fallback;
}

export const FFMPEG_PATH = resolveSfxTool({
  overridePath: process.env.WOC_FFMPEG_PATH,
  staticPath: ffmpegStatic,
  fallback: 'ffmpeg',
});

export const FFPROBE_PATH = resolveSfxTool({
  overridePath: process.env.WOC_FFPROBE_PATH,
  staticPath: ffprobeStatic.path,
  fallback: 'ffprobe',
});

export const SFX_CONFORMANCE_FFMPEG_PATH = resolveSfxTool({
  staticPath: ffmpegStatic,
  fallback: 'ffmpeg',
});

export const SFX_CONFORMANCE_FFPROBE_PATH = resolveSfxTool({
  staticPath: ffprobeStatic.path,
  fallback: 'ffprobe',
});
