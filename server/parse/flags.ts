// Parse-capture configuration, read once at boot. Capture is OFF unless
// PARSE_CAPTURE=1 AND an ingest URL is configured; the flag stays inert
// anywhere the service URL is unset (the qa-first rollout contract).
import type { ParseEnv, Surface } from './contract';

const DEFAULT_SPOOL_MAX_MB = 512;
const DEFAULT_SPOOL_DIR = 'parse-spool';
const ALL_SURFACES: readonly Surface[] = ['arena', 'raid', 'dungeon', 'rift', 'battleground'];
const ENV_LABELS = new Set<ParseEnv>(['prod', 'qa', 'pbe', 'dev']);

/**
 * The shipper attaches the shared secret to every request, so the transport
 * must be TLS: plain http is allowed only toward loopback (local dev). A
 * non-loopback http URL is rejected at boot rather than silently leaking the
 * token in the clear.
 */
function validatedIngestUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return raw;
    // Node's URL keeps IPv6 hostnames bracketed, so the loopback check must
    // compare against '[::1]', never a bare '::1'.
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'http:' && loopback) return raw;
    console.error(
      `[parse] PARSE_INGEST_URL must be https (or http to loopback), got ${url.protocol}//${url.hostname}: capture stays off`,
    );
    return null;
  } catch {
    console.error('[parse] PARSE_INGEST_URL is not a valid URL: capture stays off');
    return null;
  }
}

export interface ParseFlags {
  enabled: boolean;
  ingestUrl: string | null;
  ingestToken: string | null;
  surfaces: ReadonlySet<Surface>;
  spoolDir: string;
  spoolMaxBytes: number;
  envLabel: ParseEnv;
  /** Daily census export rides capture; PARSE_CENSUS=0 opts out. */
  censusEnabled: boolean;
  /** UTC hour of day the census export fires (PARSE_CENSUS_HOUR, 0 to 23). */
  censusUtcHour: number;
}

const DEFAULT_CENSUS_UTC_HOUR = 9;

export function loadParseFlags(env: NodeJS.ProcessEnv = process.env): ParseFlags {
  const ingestUrl = validatedIngestUrl(env.PARSE_INGEST_URL?.trim() || null);
  const requested = env.PARSE_CAPTURE === '1';
  if (requested && ingestUrl === null) {
    console.warn(
      '[parse] PARSE_CAPTURE=1 but PARSE_INGEST_URL unset or invalid: capture stays off',
    );
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
    censusEnabled: env.PARSE_CENSUS !== '0',
    censusUtcHour: censusHourFrom(env.PARSE_CENSUS_HOUR),
  };
}

function censusHourFrom(raw: string | undefined): number {
  const hour = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_CENSUS_UTC_HOUR;
}
