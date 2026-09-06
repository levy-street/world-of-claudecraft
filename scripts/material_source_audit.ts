/**
 * Read-only audit for an explicit material-source JSON dump.
 *
 * The dump is deliberately a file contract, rather than a database adapter:
 * it contains `containers` (the opening anchor and current revision),
 * `journal` (one exact movement batch per revision), and `current` (the
 * independently exported source projection). `owner_id` may be a positive
 * safe integer or its decimal JSON string. Revisions are decimal strings (a
 * safe integer is accepted for hand-authored fixtures). `opening`,
 * `movements`, and `projection` use the JSON shapes emitted by
 * server/material_source_journal_db.ts and server/material_source_ledger.ts.
 *
 * A current row may carry `deleted: true` only for a guild. It means the guild
 * book has been deleted and its retained audit is expected to have an empty
 * current projection. The row is still reported as `deleted-guild-empty`, so
 * an operator cannot mistake a deliberately empty deleted book for a clean
 * live-container reconciliation.
 *
 * This module never opens a database connection, reads environment variables,
 * mutates the supplied value, or contacts a network. Replay is delegated to
 * applyMaterialContainerDeltas, the shared source algebra; in particular,
 * count-zero re-attribution rows are replayed with both of their source legs.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  applyMaterialContainerDeltas,
  type MaterialContainerProjection,
  type MaterialMovementRow,
} from '../server/material_source_ledger';
import { materialPayloadKey } from '../src/sim/material_payload_identity';
import { materialSourceKey } from '../src/sim/material_sources';

/** Closed vocabulary from MATERIAL_SOURCE_JOURNAL_SCHEMA, kept local so this
 * offline tool has no runtime dependency on a DB module. */
export const MATERIAL_SOURCE_AUDIT_CONTAINER_KINDS = ['personal', 'vault', 'guild'] as const;
export type MaterialSourceContainerKind = (typeof MATERIAL_SOURCE_AUDIT_CONTAINER_KINDS)[number];

export const MATERIAL_SOURCE_AUDIT_DUMP_VERSION = 1 as const;

export interface MaterialSourceAuditContainerKey {
  readonly realm: string;
  readonly container: MaterialSourceContainerKind;
  readonly owner_id: number | string;
}

export interface MaterialSourceAuditContainerAnchor extends MaterialSourceAuditContainerKey {
  readonly owner_character_id?: number | string | null;
  readonly opening: MaterialContainerProjection;
  readonly current_revision: number | string;
}

export interface MaterialSourceAuditJournalRow extends MaterialSourceAuditContainerKey {
  readonly revision: number | string;
  readonly movements: readonly MaterialMovementRow[];
}

export interface MaterialSourceAuditCurrentRow extends MaterialSourceAuditContainerKey {
  readonly projection: MaterialContainerProjection;
  /** Only guild rows may use this marker. */
  readonly deleted?: boolean;
}

/**
 * Versioned offline input. This is the complete audit surface: omitting a
 * table is malformed, and extra rows are findings rather than silently
 * ignored data. The arrays may be ordered arbitrarily; revisions are sorted
 * by exact bigint value before replay.
 */
export interface MaterialSourceAuditDump {
  readonly version: typeof MATERIAL_SOURCE_AUDIT_DUMP_VERSION;
  readonly containers: readonly MaterialSourceAuditContainerAnchor[];
  readonly journal: readonly MaterialSourceAuditJournalRow[];
  readonly current: readonly MaterialSourceAuditCurrentRow[];
}

export type MaterialSourceAuditFindingCode =
  | 'malformed-input'
  | 'duplicate-container'
  | 'duplicate-journal'
  | 'duplicate-current'
  | 'orphan-journal'
  | 'orphan-current'
  | 'anchor-ownership-mismatch'
  | 'journal-gap'
  | 'revision-mismatch'
  | 'journal-replay-failed'
  | 'current-projection-invalid'
  | 'missing-current'
  | 'current-mismatch'
  | 'deleted-guild-empty'
  | 'deleted-guild-nonempty';

/** Diagnostics include bounded previews only; all rows are still validated. */
export interface MaterialSourceAuditFinding {
  readonly code: MaterialSourceAuditFindingCode;
  readonly path: string;
  readonly key?: string;
  readonly message: string;
  readonly preview?: string;
  /** Findings default to errors; an info finding is recorded but passes. */
  readonly severity?: 'error' | 'info';
}

export interface MaterialSourceAuditReport {
  readonly ok: boolean;
  readonly findings: readonly MaterialSourceAuditFinding[];
  readonly summary: {
    readonly containerRows: number;
    readonly journalRows: number;
    readonly currentRows: number;
    readonly containersChecked: number;
    readonly revisionsReplayed: number;
  };
}

interface NormalizedKey {
  readonly realm: string;
  readonly container: MaterialSourceContainerKind;
  readonly ownerId: number;
  readonly key: string;
}

interface AnchorRecord extends NormalizedKey {
  readonly ownerCharacterId: number | null;
  readonly opening: unknown;
  readonly currentRevision: bigint;
}

interface JournalRecord extends NormalizedKey {
  readonly revision: bigint;
  readonly movements: unknown;
}

interface CurrentRecord extends NormalizedKey {
  readonly projection: unknown;
  readonly deleted: boolean;
}

interface MutableSummary {
  containerRows: number;
  journalRows: number;
  currentRows: number;
  containersChecked: number;
  revisionsReplayed: number;
}

const MAX_PREVIEW_LENGTH = 240;
const DECIMAL = /^[1-9][0-9]*$/;
const KINDS = new Set<string>(MATERIAL_SOURCE_AUDIT_CONTAINER_KINDS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function preview(value: unknown): string {
  if (value instanceof Error) {
    const encoded = `${value.name}: ${value.message}`;
    return encoded.length <= MAX_PREVIEW_LENGTH
      ? encoded
      : `${encoded.slice(0, MAX_PREVIEW_LENGTH)}...`;
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(value) ?? String(value);
  } catch {
    encoded = '<unserializable>';
  }
  if (encoded.length <= MAX_PREVIEW_LENGTH) return encoded;
  return `${encoded.slice(0, MAX_PREVIEW_LENGTH)}...`;
}

function parseOwnerId(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !DECIMAL.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseRevision(value: unknown): bigint | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : undefined;
  }
  if (typeof value !== 'string' || !DECIMAL.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function identityKey(
  realm: string,
  container: MaterialSourceContainerKind,
  ownerId: number,
): string {
  return JSON.stringify([realm, container, ownerId]);
}

function readIdentity(
  value: unknown,
  path: string,
  findings: MaterialSourceAuditFinding[],
): NormalizedKey | undefined {
  if (!isRecord(value)) {
    findings.push({
      code: 'malformed-input',
      path,
      message: 'container identity must be an object',
      preview: preview(value),
    });
    return undefined;
  }
  const realm = value.realm;
  const container = value.container;
  const ownerId = parseOwnerId(value.owner_id);
  if (typeof realm !== 'string' || realm.length === 0) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.realm`,
      message: 'realm must be nonempty text',
      preview: preview(realm),
    });
    return undefined;
  }
  if (typeof container !== 'string' || !KINDS.has(container)) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.container`,
      message: 'container kind is unknown',
      preview: preview(container),
    });
    return undefined;
  }
  if (ownerId === undefined) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.owner_id`,
      message: 'owner_id must be a positive safe integer or decimal string',
      preview: preview(value.owner_id),
    });
    return undefined;
  }
  const kind = container as MaterialSourceContainerKind;
  return { realm, container: kind, ownerId, key: identityKey(realm, kind, ownerId) };
}

function readProjectionShape(
  value: unknown,
  path: string,
  findings: MaterialSourceAuditFinding[],
): unknown | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    findings.push({
      code: 'malformed-input',
      path,
      message: 'projection must be an object with an entries array',
      preview: preview(value),
    });
    return undefined;
  }
  return value;
}

function readAnchor(
  value: unknown,
  path: string,
  findings: MaterialSourceAuditFinding[],
): AnchorRecord | undefined {
  const identity = readIdentity(value, path, findings);
  if (!identity || !isRecord(value)) return undefined;
  const opening = readProjectionShape(value.opening, `${path}.opening`, findings);
  const currentRevision = parseRevision(value.current_revision);
  if (currentRevision === undefined) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.current_revision`,
      key: identity.key,
      message: 'current_revision must be a positive decimal revision',
      preview: preview(value.current_revision),
    });
    return undefined;
  }
  const ownerCharacterId =
    value.owner_character_id === null || value.owner_character_id === undefined
      ? null
      : parseOwnerId(value.owner_character_id);
  if (
    value.owner_character_id !== null &&
    value.owner_character_id !== undefined &&
    ownerCharacterId === undefined
  ) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.owner_character_id`,
      key: identity.key,
      message: 'owner_character_id must be null or a positive safe integer',
      preview: preview(value.owner_character_id),
    });
  }
  const ownsCharacter = identity.container === 'personal' || identity.container === 'vault';
  if (
    ownerCharacterId === undefined ||
    (ownsCharacter && ownerCharacterId !== identity.ownerId) ||
    (!ownsCharacter && ownerCharacterId !== null)
  ) {
    findings.push({
      code: 'anchor-ownership-mismatch',
      path,
      key: identity.key,
      message: ownsCharacter
        ? 'personal and vault anchors must name their owner character'
        : 'guild anchors must not name an owner character',
      preview: preview(value.owner_character_id),
    });
  }
  if (opening === undefined || ownerCharacterId === undefined) return undefined;
  return { ...identity, opening, currentRevision, ownerCharacterId };
}

function readJournal(
  value: unknown,
  path: string,
  findings: MaterialSourceAuditFinding[],
): JournalRecord | undefined {
  const identity = readIdentity(value, path, findings);
  if (!identity || !isRecord(value)) return undefined;
  const revision = parseRevision(value.revision);
  if (revision === undefined) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.revision`,
      key: identity.key,
      message: 'revision must be a positive decimal revision',
      preview: preview(value.revision),
    });
    return undefined;
  }
  if (!Array.isArray(value.movements)) {
    findings.push({
      code: 'malformed-input',
      path: `${path}.movements`,
      key: identity.key,
      message: 'movements must be an array',
      preview: preview(value.movements),
    });
    return undefined;
  }
  return { ...identity, revision, movements: value.movements };
}

function readCurrent(
  value: unknown,
  path: string,
  findings: MaterialSourceAuditFinding[],
): CurrentRecord | undefined {
  const identity = readIdentity(value, path, findings);
  if (!identity || !isRecord(value)) return undefined;
  const projection = readProjectionShape(value.projection, `${path}.projection`, findings);
  if (projection === undefined) return undefined;
  if (value.deleted !== undefined && typeof value.deleted !== 'boolean') {
    findings.push({
      code: 'malformed-input',
      path: `${path}.deleted`,
      key: identity.key,
      message: 'deleted must be boolean when present',
      preview: preview(value.deleted),
    });
    return undefined;
  }
  const deleted = value.deleted === true;
  if (deleted && identity.container !== 'guild') {
    findings.push({
      code: 'malformed-input',
      path: `${path}.deleted`,
      key: identity.key,
      message: 'only guild current rows may be marked deleted',
      preview: preview(value.deleted),
    });
  }
  return { ...identity, projection, deleted };
}

function projectionFingerprint(projection: MaterialContainerProjection): string {
  const entries = projection.entries
    .map((entry) => ({
      key: materialPayloadKey(entry),
      count: entry.count,
      sources: entry.sources.map((source) => ({
        key: materialSourceKey(source.source),
        count: source.count,
      })),
    }))
    .sort((a, b) => compareKeys(a.key, b.key));
  return JSON.stringify(entries);
}

function projectionCount(projection: unknown): number | undefined {
  if (!isRecord(projection) || !Array.isArray(projection.entries)) return undefined;
  return projection.entries.length;
}

function addReplayFinding(
  findings: MaterialSourceAuditFinding[],
  code: 'journal-replay-failed' | 'current-projection-invalid',
  path: string,
  key: string,
  error: unknown,
): void {
  const detailValue = isRecord(error) && 'error' in error ? error.error : error;
  const thrown = detailValue instanceof Error;
  const detail = thrown
    ? detailValue.message
    : typeof detailValue === 'string'
      ? detailValue
      : String(detailValue);
  findings.push({
    code: thrown ? 'malformed-input' : code,
    path,
    key,
    message: thrown
      ? `malformed record reached shared source algebra: ${detail}`
      : `shared source algebra refused ${detail}`,
    preview: preview(detailValue),
  });
}

/** The shared core returns explicit errors for valid-shaped records, but an
 * offline file can still contain null rows or missing fields. Keep that bad
 * row as a finding and continue auditing every other container. */
function safeApply(
  opening: unknown,
  rows: unknown,
):
  | ReturnType<typeof applyMaterialContainerDeltas>
  | { readonly ok: false; readonly error: unknown } {
  try {
    return applyMaterialContainerDeltas(
      opening as MaterialContainerProjection,
      rows as readonly MaterialMovementRow[],
    );
  } catch (error) {
    return { ok: false, error };
  }
}

function reportForInvalidRoot(input: unknown): MaterialSourceAuditReport {
  return {
    ok: false,
    findings: [
      {
        code: 'malformed-input',
        path: '$',
        message: 'dump must be a JSON object',
        preview: preview(input),
      },
    ],
    summary: {
      containerRows: 0,
      journalRows: 0,
      currentRows: 0,
      containersChecked: 0,
      revisionsReplayed: 0,
    },
  };
}

/** Audits every row in an already parsed explicit dump. */
export function auditMaterialSourceDump(input: unknown): MaterialSourceAuditReport {
  if (!isRecord(input)) return reportForInvalidRoot(input);
  const findings: MaterialSourceAuditFinding[] = [];
  const summary: MutableSummary = {
    containerRows: 0,
    journalRows: 0,
    currentRows: 0,
    containersChecked: 0,
    revisionsReplayed: 0,
  };

  if (input.version !== MATERIAL_SOURCE_AUDIT_DUMP_VERSION) {
    findings.push({
      code: 'malformed-input',
      path: '$.version',
      message: `unsupported dump version, expected ${MATERIAL_SOURCE_AUDIT_DUMP_VERSION}`,
      preview: preview(input.version),
    });
  }

  const readRows = (field: string): unknown[] => {
    const value = input[field];
    if (!Array.isArray(value)) {
      findings.push({
        code: 'malformed-input',
        path: `$.${field}`,
        message: `${field} must be an array`,
        preview: preview(value),
      });
      return [];
    }
    return value;
  };

  const containerValues = readRows('containers');
  const journalValues = readRows('journal');
  const currentValues = readRows('current');
  summary.containerRows = containerValues.length;
  summary.journalRows = journalValues.length;
  summary.currentRows = currentValues.length;

  const anchors: AnchorRecord[] = [];
  const journals: JournalRecord[] = [];
  const currents: CurrentRecord[] = [];
  const anchorKeys = new Set<string>();
  const journalKeys = new Set<string>();
  const currentKeys = new Set<string>();
  for (let i = 0; i < containerValues.length; i++) {
    const row = readAnchor(containerValues[i], `$.containers[${i}]`, findings);
    if (!row) continue;
    if (anchorKeys.has(row.key)) {
      findings.push({
        code: 'duplicate-container',
        path: `$.containers[${i}]`,
        key: row.key,
        message: 'container anchor appears more than once',
      });
    } else {
      anchorKeys.add(row.key);
      anchors.push(row);
    }
  }
  for (let i = 0; i < journalValues.length; i++) {
    const row = readJournal(journalValues[i], `$.journal[${i}]`, findings);
    if (!row) continue;
    const rowKey = `${row.key}#${row.revision.toString()}`;
    if (journalKeys.has(rowKey)) {
      findings.push({
        code: 'duplicate-journal',
        path: `$.journal[${i}]`,
        key: row.key,
        message: `journal revision ${row.revision.toString()} appears more than once`,
      });
    } else {
      journalKeys.add(rowKey);
      journals.push(row);
    }
  }
  for (let i = 0; i < currentValues.length; i++) {
    const row = readCurrent(currentValues[i], `$.current[${i}]`, findings);
    if (!row) continue;
    if (currentKeys.has(row.key)) {
      findings.push({
        code: 'duplicate-current',
        path: `$.current[${i}]`,
        key: row.key,
        message: 'current projection appears more than once',
      });
    } else {
      currentKeys.add(row.key);
      currents.push(row);
    }
  }

  const currentByKey = new Map(currents.map((row) => [row.key, row]));
  const journalsByKey = new Map<string, JournalRecord[]>();
  for (const row of journals) {
    if (!anchorKeys.has(row.key)) {
      findings.push({
        code: 'orphan-journal',
        path: '$.journal',
        key: row.key,
        message: 'journal row has no matching container anchor',
        preview: preview({ revision: row.revision.toString() }),
      });
      continue;
    }
    const rows = journalsByKey.get(row.key);
    if (rows) rows.push(row);
    else journalsByKey.set(row.key, [row]);
  }
  for (const row of currents) {
    if (!anchorKeys.has(row.key)) {
      findings.push({
        code: 'orphan-current',
        path: '$.current',
        key: row.key,
        message: 'current projection has no matching container anchor',
      });
    }
  }

  for (const anchor of anchors) {
    summary.containersChecked++;
    const path = `container(${anchor.realm},${anchor.container},${anchor.ownerId})`;
    const current = currentByKey.get(anchor.key);
    if (!current) {
      findings.push({
        code: 'missing-current',
        path,
        key: anchor.key,
        message: 'container has no current source projection',
      });
    }

    // Validate the independent snapshot even if the anchor is malformed. A
    // bad opening must not hide a second bad input row in the same container.
    const canonicalCurrent = current ? safeApply(current.projection, []) : undefined;
    if (canonicalCurrent && !canonicalCurrent.ok) {
      addReplayFinding(
        findings,
        'current-projection-invalid',
        `${path}.current`,
        anchor.key,
        canonicalCurrent,
      );
    }

    let projection: MaterialContainerProjection;
    const opening = safeApply(anchor.opening, []);
    if (!opening.ok) {
      addReplayFinding(
        findings,
        'current-projection-invalid',
        `${path}.opening`,
        anchor.key,
        opening,
      );
      continue;
    }
    projection = opening.value;

    const rows = [...(journalsByKey.get(anchor.key) ?? [])].sort((a, b) =>
      a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0,
    );
    let expected = 1n;
    let previous: bigint | undefined;
    for (const row of rows) {
      if (previous !== undefined && row.revision !== previous + 1n) {
        findings.push({
          code: row.revision > previous + 1n ? 'journal-gap' : 'revision-mismatch',
          path: '$.journal',
          key: anchor.key,
          message:
            row.revision > previous + 1n
              ? `journal revisions skip ${previous + 1n} through ${row.revision - 1n}`
              : 'journal revisions are not strictly increasing',
        });
      }
      if (row.revision !== expected) {
        if (row.revision > expected) {
          findings.push({
            code: 'journal-gap',
            path: '$.journal',
            key: anchor.key,
            message: `missing journal revisions ${expected} through ${row.revision - 1n}`,
          });
        } else {
          findings.push({
            code: 'revision-mismatch',
            path: '$.journal',
            key: anchor.key,
            message: `journal revision ${row.revision} is below the expected ${expected}`,
          });
        }
      }
      expected = row.revision + 1n;
      previous = row.revision;
      const replay = safeApply(projection, row.movements);
      if (!replay.ok) {
        addReplayFinding(
          findings,
          'journal-replay-failed',
          `${path}.journal[${row.revision}]`,
          anchor.key,
          replay,
        );
      } else {
        projection = replay.value;
      }
      summary.revisionsReplayed++;
    }
    if (rows.length === 0 || expected - 1n < anchor.currentRevision) {
      findings.push({
        code: 'journal-gap',
        path,
        key: anchor.key,
        message: `journal stops before current_revision ${anchor.currentRevision}, first missing revision ${expected}`,
      });
    } else if (expected - 1n > anchor.currentRevision) {
      findings.push({
        code: 'revision-mismatch',
        path,
        key: anchor.key,
        message: `journal reaches revision ${expected - 1n}, anchor current_revision is ${anchor.currentRevision}`,
      });
    }

    if (!current || !canonicalCurrent || !canonicalCurrent.ok) continue;
    if (current.deleted) {
      if (projectionCount(canonicalCurrent.value) !== 0) {
        findings.push({
          code: 'deleted-guild-nonempty',
          path,
          key: anchor.key,
          message: 'deleted guild current projection is not empty',
          preview: preview(canonicalCurrent.value),
        });
      } else {
        findings.push({
          code: 'deleted-guild-empty',
          path,
          key: anchor.key,
          message: 'deleted guild retains an empty current projection',
          severity: 'info',
        });
      }
    }
    if (projectionFingerprint(projection) !== projectionFingerprint(canonicalCurrent.value)) {
      findings.push({
        code: 'current-mismatch',
        path,
        key: anchor.key,
        message: 'replayed journal does not equal current source projection',
        preview: preview({ replayed: projection, current: canonicalCurrent.value }),
      });
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity !== 'info'),
    findings,
    summary,
  };
}

export function runMaterialSourceAuditCli(
  argv: readonly string[] = process.argv.slice(2),
  io: Pick<typeof process, 'stdout' | 'stderr'> = process,
): number {
  const filename = argv[0];
  if (filename === undefined || filename.length === 0) {
    const report = reportForInvalidRoot(undefined);
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8'));
    const report = auditMaterialSourceDump(parsed);
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    const report: MaterialSourceAuditReport = {
      ok: false,
      findings: [
        {
          code: 'malformed-input',
          path: '$',
          message: 'could not read or parse JSON dump',
          preview: preview(error),
        },
      ],
      summary: {
        containerRows: 0,
        journalRows: 0,
        currentRows: 0,
        containersChecked: 0,
        revisionsReplayed: 0,
      },
    };
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runMaterialSourceAuditCli();
}
