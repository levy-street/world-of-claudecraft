import { describe, expect, it } from 'vitest';
import { assembleSnapshotJson } from '../server/snapshot_frame';

describe('snapshot JSON frame assembly', () => {
  it('preserves the established field order and optional fragments', () => {
    expect(
      assembleSnapshotJson({
        head: '{"t":"snap","tick":7,"time":1.25,"tickHz":20',
        timerWireJson: ',"tw":2',
        selfJson: '{"id":1,"hp":50}',
        entityJson: ['{"id":2,"x":3}', '{"id":4,"x":5}'],
        rings: [{ id: 'frost', x: 1, z: 2, r: 3, i: 1, dur: 8, rem: 4 }],
        hourglasses: [{ id: 'time', x: 6, z: 7, r: 2, dur: 5, rem: 3 }],
        keep: [8, 9],
      }),
    ).toBe(
      '{"t":"snap","tick":7,"time":1.25,"tickHz":20,"tw":2,"self":{"id":1,"hp":50},' +
        '"ents":[{"id":2,"x":3},{"id":4,"x":5}],"rings":[{"id":"frost","x":1,"z":2,' +
        '"r":3,"i":1,"dur":8,"rem":4}],"hourglasses":[{"id":"time","x":6,"z":7,"r":2,' +
        '"dur":5,"rem":3}],"keep":[8,9]}',
    );
  });

  it('omits empty optional collections', () => {
    expect(
      assembleSnapshotJson({
        head: '{"t":"snap","tick":1,"time":0.05',
        timerWireJson: '',
        selfJson: '{"id":1}',
        entityJson: [],
        rings: [],
        hourglasses: [],
        keep: [],
      }),
    ).toBe('{"t":"snap","tick":1,"time":0.05,"self":{"id":1},"ents":[]}');
  });
});
