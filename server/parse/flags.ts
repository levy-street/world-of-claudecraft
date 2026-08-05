// Parse-capture configuration, read once at boot. Capture is OFF unless
// PARSE_CAPTURE=1 AND an ingest URL is configured; the flag stays inert
// anywhere the service URL is unset (the qa-first rollout contract).
import type { ParseEnv, Surface } from './contract';

const DEFAULT_SPOOL_MAX_MB = 512;
const DEFAULT_SPOOL_DIR = 'parse-spool';
const ALL_SURFACES: readonly Surface[] = ['arena', 'raid', 'dungeon', 'rift', 'battleground'];
const ENV_LABELS = new Set<ParseEnv>(['prod', 'qa', 'pbe', 'dev']);

export interface ParseFlags {
  enabled: boolean;
  ingestUrl: string | null;
  ingestToken: string | null;
  surfaces: ReadonlySet<Surface>;
  spoolDir: string;
  spoolMaxBytes: number;
  envLabel: ParseEnv;
}

export function loadParseFlags(env: NodeJS.ProcessEnv = process.env): ParseFlags {
  const ingestUrl = env.PARSE_INGEST_URL?.trim() || null;
  const requested = env.PARSE_CAPTURE === '1';
  if (requested && ingestUrl === null) {
    console.warn('[parse] PARSE_CAPTURE=1 but PARSE_INGEST_URL unset: capture stays off');
  }
  const surfaceRaw = env.PARSE_CAPTURE_SURFACES?.trim();
  const surfaces = new Set<Surface>();
  if (surfaceRaw) {
    for (const part of surfaceRaw.split(',')) {
      const name = part.trim() as Surface;
      if ((ALL_SURFACES as readonly string[]).includes(name)) surfaces.add(name);
      else console.warn(`[parse] unknown surface in PARSE_CAPTURE_SURFACES: ${part.trim()}`);
    }
  } else {
    for (const s of ALL_SURFACES) surfaces.add(s);
  }
  const spoolMaxMb = Number.parseInt(env.PARSE_SPOOL_MAX_MB ?? '', 10);
  const envLabelRaw = env.PARSE_ENV_LABEL?.trim() as ParseEnv | undefined;
  return {
    enabled: requested && ingestUrl !== null,
    ingestUrl,
    ingestToken: env.PARSE_INGEST_TOKEN?.trim() || null,
    surfaces,
    spoolDir: env.PARSE_SPOOL_DIR?.trim() || DEFAULT_SPOOL_DIR,
    spoolMaxBytes:
      (Number.isFinite(spoolMaxMb) && spoolMaxMb > 0 ? spoolMaxMb : DEFAULT_SPOOL_MAX_MB) *
      1024 *
      1024,
    envLabel: envLabelRaw !== undefined && ENV_LABELS.has(envLabelRaw) ? envLabelRaw : 'dev',
  };
}
