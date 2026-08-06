// Pins the parse-capture env contract (server/parse/flags.ts) to LITERAL env
// key names: renaming any key silently makes production capture inert (or
// silently on in the wrong env), and only literal pins catch that.
import { describe, expect, test } from 'vitest';
import { loadParseFlags } from '../server/parse/flags';

const BASE = {
  PARSE_CAPTURE: '1',
  PARSE_INGEST_URL: 'https://parses.example.com/ingest/v1/batch',
  PARSE_INGEST_TOKEN: 's3cret',
} as NodeJS.ProcessEnv;

describe('loadParseFlags', () => {
  test('capture stays off without PARSE_CAPTURE=1 even with a URL', () => {
    const flags = loadParseFlags({ PARSE_INGEST_URL: BASE.PARSE_INGEST_URL });

    expect(flags.enabled).toBe(false);
  });

  test('capture stays off with PARSE_CAPTURE=1 but no ingest URL', () => {
    const flags = loadParseFlags({ PARSE_CAPTURE: '1' });

    expect(flags.enabled).toBe(false);
    expect(flags.ingestUrl).toBeNull();
  });

  test('capture enables with both the flag and an https URL', () => {
    const flags = loadParseFlags({ ...BASE });

    expect(flags.enabled).toBe(true);
    expect(flags.ingestUrl).toBe('https://parses.example.com/ingest/v1/batch');
    expect(flags.ingestToken).toBe('s3cret');
  });

  test('a plain-http non-loopback URL is rejected (the secret must ride TLS)', () => {
    const flags = loadParseFlags({ ...BASE, PARSE_INGEST_URL: 'http://parses.example.com/x' });

    expect(flags.enabled).toBe(false);
    expect(flags.ingestUrl).toBeNull();
  });

  test('http to loopback is allowed for local development', () => {
    for (const host of ['localhost', '127.0.0.1']) {
      const flags = loadParseFlags({ ...BASE, PARSE_INGEST_URL: `http://${host}:8788/ingest` });
      expect(flags.enabled).toBe(true);
    }
  });

  test('a malformed URL is rejected rather than shipped to', () => {
    const flags = loadParseFlags({ ...BASE, PARSE_INGEST_URL: 'not a url' });

    expect(flags.enabled).toBe(false);
  });

  test('all five surfaces are on by default', () => {
    const flags = loadParseFlags({ ...BASE });

    expect([...flags.surfaces].sort()).toEqual([
      'arena',
      'battleground',
      'dungeon',
      'raid',
      'rift',
    ]);
  });

  test('PARSE_CAPTURE_SURFACES narrows the set and drops unknown names', () => {
    const flags = loadParseFlags({ ...BASE, PARSE_CAPTURE_SURFACES: 'arena, rift ,delve' });

    expect([...flags.surfaces].sort()).toEqual(['arena', 'rift']);
  });

  test('spool defaults: parse-spool dir and 512 MB cap', () => {
    const flags = loadParseFlags({ ...BASE });

    expect(flags.spoolDir).toBe('parse-spool');
    expect(flags.spoolMaxBytes).toBe(512 * 1024 * 1024);
  });

  test('PARSE_SPOOL_DIR and PARSE_SPOOL_MAX_MB override the spool', () => {
    const flags = loadParseFlags({
      ...BASE,
      PARSE_SPOOL_DIR: '/data/spool',
      PARSE_SPOOL_MAX_MB: '64',
    });

    expect(flags.spoolDir).toBe('/data/spool');
    expect(flags.spoolMaxBytes).toBe(64 * 1024 * 1024);
  });

  test('PARSE_ENV_LABEL accepts the four env names and falls back to dev', () => {
    for (const label of ['prod', 'qa', 'pbe', 'dev'] as const) {
      expect(loadParseFlags({ ...BASE, PARSE_ENV_LABEL: label }).envLabel).toBe(label);
    }
    expect(loadParseFlags({ ...BASE, PARSE_ENV_LABEL: 'staging' }).envLabel).toBe('dev');
    expect(loadParseFlags({ ...BASE }).envLabel).toBe('dev');
  });

  test('census rides capture by default and PARSE_CENSUS=0 opts out', () => {
    expect(loadParseFlags({ ...BASE }).censusEnabled).toBe(true);
    expect(loadParseFlags({ ...BASE, PARSE_CENSUS: '0' }).censusEnabled).toBe(false);
  });

  test('an empty token normalizes to null (fail-closed at the service)', () => {
    const flags = loadParseFlags({ ...BASE, PARSE_INGEST_TOKEN: '' });

    expect(flags.ingestToken).toBeNull();
  });
});

describe('loadParseFlags review pins', () => {
  test('bracketed IPv6 loopback http is allowed; the bare form never appears', () => {
    const flags = loadParseFlags({ ...BASE, PARSE_INGEST_URL: 'http://[::1]:8788/ingest' });

    expect(flags.enabled).toBe(true);
  });

  test('PARSE_CENSUS_HOUR sets the UTC export hour with a sane default and clamp', () => {
    expect(loadParseFlags({ ...BASE }).censusUtcHour).toBe(9);
    expect(loadParseFlags({ ...BASE, PARSE_CENSUS_HOUR: '4' }).censusUtcHour).toBe(4);
    expect(loadParseFlags({ ...BASE, PARSE_CENSUS_HOUR: '24' }).censusUtcHour).toBe(9);
    expect(loadParseFlags({ ...BASE, PARSE_CENSUS_HOUR: 'noon' }).censusUtcHour).toBe(9);
  });
});
