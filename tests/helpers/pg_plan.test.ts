import { describe, expect, it } from 'vitest';
import {
  checkRelationUsesPartialIndex,
  type ExplainPlanNode,
  rootPlanFromExplainRow,
} from './pg_plan';

describe('checkRelationUsesPartialIndex', () => {
  it('passes a bitmap-indexed ledger scan joined to a sequentially scanned small table', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Hash Join',
      Plans: [
        {
          'Node Type': 'Bitmap Heap Scan',
          'Relation Name': 'bank_ledger',
          Plans: [
            { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'bank_ledger_container_recent' },
          ],
        },
        {
          'Node Type': 'Hash',
          Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'characters' }],
        },
      ],
    };
    expect(
      checkRelationUsesPartialIndex(plan, 'bank_ledger', 'bank_ledger_container_recent'),
    ).toEqual({ ok: true });
  });

  it('passes a direct Index Only Scan on the expected index', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Index Only Scan',
      'Relation Name': 'bank_ledger',
      'Index Name': 'bank_ledger_container_money_recent',
    };
    expect(
      checkRelationUsesPartialIndex(plan, 'bank_ledger', 'bank_ledger_container_money_recent'),
    ).toEqual({ ok: true });
  });

  it('fails when the ledger itself takes a Seq Scan, even if the expected index appears elsewhere', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Hash Join',
      Plans: [
        { 'Node Type': 'Seq Scan', 'Relation Name': 'bank_ledger' },
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'other_table',
          'Index Name': 'bank_ledger_container_recent',
        },
      ],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Seq Scan');
  });

  it('fails when the plan never scans the relation at all', () => {
    const plan: ExplainPlanNode = { 'Node Type': 'Seq Scan', 'Relation Name': 'characters' };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no "bank_ledger" relation node found');
  });

  it('fails when the ledger scan reaches a different, unrelated index', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Index Scan',
      'Relation Name': 'bank_ledger',
      'Index Name': 'bank_ledger_pkey',
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('fails when a Bitmap Heap Scan on the ledger never bottoms out in a Bitmap Index Scan', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Bitmap Heap Scan',
      'Relation Name': 'bank_ledger',
      Plans: [{ 'Node Type': 'Bitmap Index Scan', 'Index Name': 'some_other_index' }],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('fails a wrong-index outer ledger Index Scan even when a SubPlan child carries the expected index (P2 repro)', () => {
    // The outer node's OWN Index Name is what counts; a correlated SubPlan/
    // InitPlan attached under it is a different query context, not a scan of
    // this relation's row source, and must never launder a wrong-index scan.
    const plan: ExplainPlanNode = {
      'Node Type': 'Index Scan',
      'Relation Name': 'bank_ledger',
      'Index Name': 'bank_ledger_pkey',
      Plans: [
        {
          'Node Type': 'Index Scan',
          'Parent Relationship': 'SubPlan',
          'Relation Name': 'bank_ledger',
          'Index Name': 'bank_ledger_container_recent',
        },
      ],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('fails a wrong-index outer ledger Index Scan even when an InitPlan child carries the expected index (P2 repro)', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Index Scan',
      'Relation Name': 'bank_ledger',
      'Index Name': 'bank_ledger_pkey',
      Plans: [
        {
          'Node Type': 'Index Scan',
          'Parent Relationship': 'InitPlan',
          'Relation Name': 'bank_ledger',
          'Index Name': 'bank_ledger_container_recent',
        },
      ],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('fails a wrong-index ledger scan even with an expected-index sibling on another relation', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Hash Join',
      Plans: [
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'bank_ledger',
          'Index Name': 'bank_ledger_pkey',
        },
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'other_table',
          'Index Name': 'bank_ledger_container_recent',
        },
      ],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('fails rather than vacuously passing when the ledger Index Scan carries no Index Name at all', () => {
    const plan: ExplainPlanNode = { 'Node Type': 'Index Scan', 'Relation Name': 'bank_ledger' };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('fails a Bitmap Heap Scan whose only Bitmap Index Scan on the expected index arrives via a SubPlan (P2 repro)', () => {
    // A real Bitmap Heap Scan's OWN bitmap access plan is what must reach the
    // index. A SubPlan-attached Bitmap Index Scan sitting alongside it is a
    // correlated subquery, not the heap scan's recheck/bitmap source.
    const plan: ExplainPlanNode = {
      'Node Type': 'Bitmap Heap Scan',
      'Relation Name': 'bank_ledger',
      Plans: [
        {
          'Node Type': 'Bitmap Index Scan',
          'Parent Relationship': 'SubPlan',
          'Index Name': 'bank_ledger_container_recent',
        },
      ],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not scan expected index "bank_ledger_container_recent"');
  });

  it('walks nested BitmapAnd / BitmapOr bitmap access nodes down to the real index', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Bitmap Heap Scan',
      'Relation Name': 'bank_ledger',
      Plans: [
        {
          'Node Type': 'BitmapAnd',
          Plans: [
            { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'some_other_index' },
            {
              'Node Type': 'BitmapOr',
              Plans: [
                { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'bank_ledger_container_recent' },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkRelationUsesPartialIndex(plan, 'bank_ledger', 'bank_ledger_container_recent'),
    ).toEqual({ ok: true });
  });

  it('requires EVERY ledger node to pass when the relation is scanned more than once', () => {
    const plan: ExplainPlanNode = {
      'Node Type': 'Append',
      Plans: [
        {
          'Node Type': 'Bitmap Heap Scan',
          'Relation Name': 'bank_ledger',
          Plans: [
            { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'bank_ledger_container_recent' },
          ],
        },
        { 'Node Type': 'Seq Scan', 'Relation Name': 'bank_ledger' },
      ],
    };
    const result = checkRelationUsesPartialIndex(
      plan,
      'bank_ledger',
      'bank_ledger_container_recent',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Seq Scan');
  });
});

describe('rootPlanFromExplainRow', () => {
  it('unwraps the pg row shape node-postgres returns for EXPLAIN (FORMAT JSON)', () => {
    const row = {
      'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'characters' } }],
    };
    expect(rootPlanFromExplainRow(row)).toEqual({
      'Node Type': 'Seq Scan',
      'Relation Name': 'characters',
    });
  });

  it('throws rather than returning undefined when the row has no QUERY PLAN array', () => {
    expect(() => rootPlanFromExplainRow({})).toThrow('QUERY PLAN');
  });

  it('throws rather than returning undefined when the row has no top-level Plan node', () => {
    expect(() => rootPlanFromExplainRow({ 'QUERY PLAN': [{}] })).toThrow('Plan');
  });
});
