import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordBuildSpan, setBuildSpanSink, timeBuildSpan } from '../src/render/build_spans';

type Span = { kind: string; ms: number; atMs: number };

const capture = (): Span[] => {
  const spans: Span[] = [];
  setBuildSpanSink((kind, ms, atMs) => spans.push({ kind, ms, atMs }));
  return spans;
};

afterEach(() => {
  setBuildSpanSink(null);
  vi.restoreAllMocks();
});

describe('build_spans', () => {
  it('is a no-op without a sink and still runs the timed work', () => {
    setBuildSpanSink(null);
    let ran = 0;
    expect(() => recordBuildSpan('view-part:assemble', 3, 1)).not.toThrow();
    expect(
      timeBuildSpan('view-part:assemble', () => {
        ran++;
        return 'result';
      }),
    ).toBe('result');
    expect(ran).toBe(1);
  });

  it('records the kind, the elapsed ms and the start time around the work', () => {
    const spans = capture();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1012.5);
    const value = timeBuildSpan('view-part:materials', () => 42);
    expect(value).toBe(42);
    expect(spans).toEqual([{ kind: 'view-part:materials', ms: 12.5, atMs: 1000 }]);
  });

  it('records the span when the work throws, then rethrows', () => {
    const spans = capture();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(50).mockReturnValueOnce(58);
    const boom = new Error('weapon GLB not resident');
    expect(() =>
      timeBuildSpan('view-part:assemble:props', () => {
        throw boom;
      }),
    ).toThrow(boom);
    expect(spans).toEqual([{ kind: 'view-part:assemble:props', ms: 8, atMs: 50 }]);
  });

  it('passes recordBuildSpan through to the sink verbatim and stops after the sink is cleared', () => {
    const spans = capture();
    recordBuildSpan('view-part:mixer', 0.4, 7);
    setBuildSpanSink(null);
    recordBuildSpan('view-part:mixer', 9, 8);
    expect(spans).toEqual([{ kind: 'view-part:mixer', ms: 0.4, atMs: 7 }]);
  });
});
