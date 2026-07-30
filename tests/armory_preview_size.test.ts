import { describe, expect, it } from 'vitest';
import { armoryPreviewParkingSize } from '../src/ui/armory_inspect';

describe('Armory preview parking size', () => {
  it('matches the capped desktop inspect grid before the modal exists', () => {
    expect(armoryPreviewParkingSize(1920, 1200, false)).toEqual({ width: 544, height: 430 });
  });

  it('matches the compact landscape touch grid', () => {
    expect(armoryPreviewParkingSize(844, 390, true)).toEqual({ width: 504, height: 372 });
  });

  it('respects the details-column minimum on narrow desktop windows', () => {
    expect(armoryPreviewParkingSize(600, 500, false)).toEqual({ width: 282, height: 430 });
  });
});
