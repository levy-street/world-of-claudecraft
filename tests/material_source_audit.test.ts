// Offline material-source dump audit: the suite feeds explicit JSON-shaped
// rows to the pure replay runner. It never opens Postgres, reads credentials,
// or contacts a network.

import { describe, expect, it } from 'vitest';
import {
  auditMaterialSourceDump,
  MATERIAL_SOURCE_AUDIT_DUMP_VERSION,
  type MaterialSourceAuditDump,
} from '../scripts/material_source_audit';
import type {
  MaterialContainerProjection,
  MaterialMovementRow,
} from '../server/material_source_ledger';
import type { MaterialSource } from '../src/sim/material_sources';

const A: MaterialSource = { gatherer: { kind: 'character', id: 1, name: 'Ayla' } };
const B: MaterialSource = { gatherer: { kind: 'character', id: 2, name: 'Bran' } };

const projection = (
  ...entries: MaterialContainerProjection['entries']
): MaterialContainerProjection => ({ entries });

const movement = (
  count: number,
  sourceDeltas: MaterialMovementRow['sourceDeltas'],
): MaterialMovementRow => ({
  itemId: 'ore',
  count,
  sourceDeltas,
});

function healthyDump(): MaterialSourceAuditDump {
  const opening = projection({ itemId: 'ore', count: 2, sources: [{ source: A, count: 2 }] });
  const afterSwap = projection({
    itemId: 'ore',
    count: 3,
    sources: [
      { source: A, count: 1 },
      { source: B, count: 2 },
    ],
  });
  return {
    version: MATERIAL_SOURCE_AUDIT_DUMP_VERSION,
    containers: [
      {
        realm: 'woc-1',
        container: 'personal',
        owner_id: 7,
        owner_character_id: 7,
        opening,
        current_revision: '2',
      },
    ],
    journal: [
      {
        realm: 'woc-1',
        container: 'personal',
        owner_id: 7,
        revision: '1',
        movements: [movement(1, [{ source: B, count: 1 }])],
      },
      {
        realm: 'woc-1',
        container: 'personal',
        owner_id: 7,
        revision: '2',
        // Net total is zero, but the source composition changes. This must
        // remain visible to the replay rather than being dropped as a no-op.
        movements: [
          movement(0, [
            { source: A, count: -1 },
            { source: B, count: 1 },
          ]),
        ],
      },
    ],
    current: [{ realm: 'woc-1', container: 'personal', owner_id: 7, projection: afterSwap }],
  };
}

const codes = (dump: unknown): string[] =>
  auditMaterialSourceDump(dump).findings.map((finding) => finding.code);

describe('auditMaterialSourceDump', () => {
  it('replays exact batches, including a zero-net source swap', () => {
    const report = auditMaterialSourceDump(healthyDump());

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.summary).toEqual({
      containerRows: 1,
      journalRows: 2,
      currentRows: 1,
      containersChecked: 1,
      revisionsReplayed: 2,
    });
  });

  it('reports current projection drift', () => {
    const base = healthyDump();
    const dump: MaterialSourceAuditDump = {
      ...base,
      current: [
        {
          ...base.current[0],
          projection: projection({ itemId: 'ore', count: 3, sources: [{ source: A, count: 3 }] }),
        },
      ],
    };

    expect(codes(dump)).toContain('current-mismatch');
  });

  it('reports missing revisions, duplicate rows, and anchor revision mismatch', () => {
    const base = healthyDump();
    const dump: MaterialSourceAuditDump = {
      ...base,
      containers: [{ ...base.containers[0], current_revision: '2' }],
      journal: [
        { ...base.journal[0] },
        { ...base.journal[1], revision: '3' },
        { ...base.journal[0], revision: '3' },
      ],
    };

    const report = auditMaterialSourceDump(dump);
    expect(report.findings.some((finding) => finding.code === 'journal-gap')).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'duplicate-journal')).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'revision-mismatch')).toBe(true);
  });

  it('reports malformed rows without aborting validation of other rows', () => {
    const base = healthyDump();
    const dump: MaterialSourceAuditDump = {
      ...base,
      containers: [...base.containers, null as never],
      journal: [{ ...base.journal[0], movements: [null as never] }, base.journal[1]],
      current: [...base.current, { ...base.current[0], owner_id: 8 }],
    };

    const report = auditMaterialSourceDump(dump);
    expect(report.ok).toBe(false);
    expect(report.findings.some((finding) => finding.code === 'malformed-input')).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'duplicate-current')).toBe(false);
    expect(report.findings.some((finding) => finding.code === 'orphan-current')).toBe(true);
    expect(report.summary.containersChecked).toBe(1);
  });

  it('reports malformed projection records instead of allowing a thrown core error', () => {
    const base = healthyDump();
    const dump: MaterialSourceAuditDump = {
      ...base,
      containers: [{ ...base.containers[0], opening: { entries: [null as never] } }],
      current: [{ ...base.current[0], projection: { entries: [null as never] } }],
    };

    const report = auditMaterialSourceDump(dump);
    expect(report.ok).toBe(false);
    expect(report.findings.filter((finding) => finding.code === 'malformed-input')).toHaveLength(2);

    const movementDump: MaterialSourceAuditDump = {
      ...base,
      journal: [{ ...base.journal[0], movements: [null as never] }, base.journal[1]],
    };
    const movementReport = auditMaterialSourceDump(movementDump);
    const movementFinding = movementReport.findings.find((finding) =>
      finding.path.includes('.journal[1]'),
    );
    expect(movementFinding?.message).toMatch(/malformed record reached shared source algebra/);
    expect(movementFinding?.preview).toMatch(/Error:/);
  });

  it('reports orphan journal and current rows', () => {
    const base = healthyDump();
    const dump: MaterialSourceAuditDump = {
      ...base,
      journal: [...base.journal, { ...base.journal[0], owner_id: 99 }],
      current: [...base.current, { ...base.current[0], owner_id: 99 }],
    };

    expect(codes(dump)).toEqual(expect.arrayContaining(['orphan-journal', 'orphan-current']));
  });

  it('surfaces a deleted guild whose retained current projection is empty', () => {
    const opening = projection({ itemId: 'ore', count: 1, sources: [{ source: A, count: 1 }] });
    const dump: MaterialSourceAuditDump = {
      version: MATERIAL_SOURCE_AUDIT_DUMP_VERSION,
      containers: [
        {
          realm: 'woc-1',
          container: 'guild',
          owner_id: 42,
          owner_character_id: null,
          opening,
          current_revision: '1',
        },
      ],
      journal: [
        {
          realm: 'woc-1',
          container: 'guild',
          owner_id: 42,
          revision: '1',
          movements: [movement(-1, [{ source: A, count: -1 }])],
        },
      ],
      current: [
        {
          realm: 'woc-1',
          container: 'guild',
          owner_id: 42,
          projection: projection(),
          deleted: true,
        },
      ],
    };

    const report = auditMaterialSourceDump(dump);
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'deleted-guild-empty', severity: 'info' }),
    ]);
  });

  it('does not mutate the parsed dump', () => {
    const dump = healthyDump();
    const before = JSON.stringify(dump);

    auditMaterialSourceDump(dump);

    expect(JSON.stringify(dump)).toBe(before);
  });
});
