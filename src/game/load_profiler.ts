// Boot/loading-time profiler. Thin wrappers over the native performance
// mark/measure API (usable from any area without crossing module seams; the
// renderer stamps the same 'woc:load:' prefix via src/render/load_marks.ts)
// plus a pure summarizer that turns the recorded measures into a nested,
// aggregated phase tree. The summary is published on window.__loadProfile at
// world reveal and read by scripts/load_probe.mjs; it is diagnostics-only and
// never drives gameplay or graphics decisions.

export const LOAD_MARK_PREFIX = 'woc:load:';

export interface LoadSpanEntry {
  name: string;
  startTime: number;
  duration: number;
}

export interface LoadPhaseNode {
  name: string;
  /** Total milliseconds across all occurrences of this phase at this depth. */
  ms: number;
  /** Occurrence count (zone prepare internals repeat per prepared zone). */
  count: number;
  /** First occurrence start, relative to the profile origin. */
  startMs: number;
  children: LoadPhaseNode[];
  /** Time inside this phase not covered by any child span. */
  selfMs: number;
}

export interface LoadProfileSummary {
  totalMs: number;
  phases: LoadPhaseNode[];
  /** Top-level time inside the root span not covered by any top-level phase. */
  unattributedMs: number;
}

function markName(phase: string, edge: 'start' | 'end'): string {
  return `${LOAD_MARK_PREFIX}${phase}:${edge}`;
}

export function loadPhaseStart(phase: string): void {
  try {
    performance.mark(markName(phase, 'start'));
  } catch {
    // Instrumentation must never break boot (or a Node import without marks).
  }
}

export function loadPhaseEnd(phase: string): void {
  try {
    performance.mark(markName(phase, 'end'));
    performance.measure(
      `${LOAD_MARK_PREFIX}${phase}`,
      markName(phase, 'start'),
      markName(phase, 'end'),
    );
  } catch {
    // A missing start mark (reset mid-phase) must not throw.
  }
}

export function loadSpan<T>(phase: string, fn: () => T): T {
  loadPhaseStart(phase);
  try {
    return fn();
  } finally {
    loadPhaseEnd(phase);
  }
}

export async function loadSpanAsync<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  loadPhaseStart(phase);
  try {
    return await fn();
  } finally {
    loadPhaseEnd(phase);
  }
}

/** Clear every recorded load mark/measure (a fresh entry restarts the profile). */
export function resetLoadProfile(): void {
  try {
    for (const entry of performance.getEntriesByType('mark')) {
      if (entry.name.startsWith(LOAD_MARK_PREFIX)) performance.clearMarks(entry.name);
    }
    for (const entry of performance.getEntriesByType('measure')) {
      if (entry.name.startsWith(LOAD_MARK_PREFIX)) performance.clearMeasures(entry.name);
    }
  } catch {
    // Best effort.
  }
}

export function collectLoadSpans(): LoadSpanEntry[] {
  try {
    return performance
      .getEntriesByType('measure')
      .filter((e) => e.name.startsWith(LOAD_MARK_PREFIX))
      .map((e) => ({
        name: e.name.slice(LOAD_MARK_PREFIX.length),
        startTime: e.startTime,
        duration: e.duration,
      }));
  } catch {
    return [];
  }
}

interface SpanNode {
  span: LoadSpanEntry;
  children: SpanNode[];
}

// Nesting is decided by interval containment, not by a naming convention, so a
// repeated inner span (the per-zone prepare internals) lands under whichever
// outer phase actually ran it (entry zone vs neighbor ring vs teleport).
function buildContainmentForest(spans: LoadSpanEntry[]): SpanNode[] {
  const sorted = [...spans].sort((a, b) => a.startTime - b.startTime || b.duration - a.duration);
  const roots: SpanNode[] = [];
  const stack: SpanNode[] = [];
  for (const span of sorted) {
    const node: SpanNode = { span, children: [] };
    while (stack.length > 0) {
      const top = stack[stack.length - 1].span;
      if (span.startTime + span.duration <= top.startTime + top.duration + 0.001) break;
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

function aggregate(nodes: SpanNode[], originMs: number): LoadPhaseNode[] {
  const byName = new Map<string, LoadPhaseNode & { childNodes: SpanNode[] }>();
  for (const node of nodes) {
    const existing = byName.get(node.span.name);
    if (existing) {
      existing.ms += node.span.duration;
      existing.count += 1;
      existing.startMs = Math.min(existing.startMs, node.span.startTime - originMs);
      existing.childNodes.push(...node.children);
    } else {
      byName.set(node.span.name, {
        name: node.span.name,
        ms: node.span.duration,
        count: 1,
        startMs: node.span.startTime - originMs,
        children: [],
        selfMs: 0,
        childNodes: [...node.children],
      });
    }
  }
  const out: LoadPhaseNode[] = [];
  for (const agg of byName.values()) {
    const children = aggregate(agg.childNodes, originMs);
    const childMs = children.reduce((sum, c) => sum + c.ms, 0);
    out.push({
      name: agg.name,
      ms: round2(agg.ms),
      count: agg.count,
      startMs: round2(agg.startMs),
      children,
      selfMs: round2(Math.max(0, agg.ms - childMs)),
    });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Summarize recorded spans under one root phase (its single span bounds the
 * profile). Spans outside the root (e.g. sim-build, stamped before startGame's
 * root opens) are kept as extra top-level phases.
 */
export function summarizeLoadProfile(spans: LoadSpanEntry[], rootName: string): LoadProfileSummary {
  const root = spans.find((s) => s.name === rootName);
  if (!root)
    return { totalMs: 0, phases: aggregate(buildContainmentForest(spans), 0), unattributedMs: 0 };
  const forest = buildContainmentForest(spans);
  const originMs = root.startTime;
  const rootNode = findNode(forest, rootName);
  const inside = rootNode ? aggregate(rootNode.children, originMs) : [];
  const outside = forest.filter((n) => n !== rootNode);
  const phases = [...aggregate(outside, originMs), ...inside].sort((a, b) => a.startMs - b.startMs);
  const insideMs = inside.reduce((sum, p) => sum + p.ms, 0);
  return {
    totalMs: round2(root.duration),
    phases,
    unattributedMs: round2(Math.max(0, root.duration - insideMs)),
  };
}

function findNode(forest: SpanNode[], name: string): SpanNode | null {
  for (const node of forest) {
    if (node.span.name === name) return node;
    const inner = findNode(node.children, name);
    if (inner) return inner;
  }
  return null;
}
