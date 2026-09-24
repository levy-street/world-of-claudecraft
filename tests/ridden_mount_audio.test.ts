import { describe, expect, it, vi } from 'vitest';
import { updateRiddenMountAudio } from '../src/render/ridden_mount_audio';
import { MOUNT_SKIN_IDS, mountPresentationKey } from '../src/sim/content/mount_skins';

function setup(look: string, moving = true, airborne = false, engine = false, idles = false) {
  const sink = {
    mountIdle: vi.fn(),
    mountEngine: vi.fn(() => engine),
    mountEngineIdles: vi.fn(() => idles),
    mountRun: vi.fn(),
    mountApex: vi.fn(),
  };
  const surface = vi.fn(() => 'stone' as const);
  const state = { stepAccum: 5.7, mountPivot: true };
  updateRiddenMountAudio(
    sink,
    state,
    look,
    9,
    1,
    2,
    3,
    moving,
    airborne,
    true,
    8,
    0.1,
    true,
    surface,
  );
  return { sink, state, surface };
}
describe('ridden mount audio', () => {
  it.each(MOUNT_SKIN_IDS)('uses %s movement cues over an ordinary horse', (id) => {
    const { sink } = setup(mountPresentationKey('valorsteed', id));
    expect(sink.mountEngine).toHaveBeenCalledWith(1, 2, 3, id, true, 9, true, false);
    expect(sink.mountRun).toHaveBeenCalledWith(1, 2, 3, id, 'stone', true);
  });
  it('does not add gait beats or surface samples to an engine skin', () => {
    const { sink, surface } = setup('rallycart_rxt', true, false, true);
    expect(sink.mountRun).not.toHaveBeenCalled();
    expect(surface).not.toHaveBeenCalled();
  });
  it('updates spaceship turbine audio in the air and holds ordinary engine phases', () => {
    expect(setup('goblin_rocket_sled', true, true).sink.mountEngine).toHaveBeenCalledWith(
      1,
      2,
      3,
      'goblin_rocket_sled',
      true,
      9,
      true,
      true,
      true,
    );
    expect(setup('terrorspark_groundshaker', true, true).sink.mountEngine).not.toHaveBeenCalled();
    expect(setup('rallycart_rxt', true, true, true, true).sink.mountEngine).toHaveBeenCalledWith(
      1,
      2,
      3,
      'rallycart_rxt',
      true,
      9,
      true,
      true,
      true,
    );
  });
  it('polls idle and pivot audio while stopped', () => {
    const { sink } = setup('rickshaw_mount', false);
    expect(sink.mountEngine).toHaveBeenCalledWith(
      1,
      2,
      3,
      'rickshaw_mount',
      false,
      9,
      false,
      false,
      true,
    );
    expect(sink.mountIdle).toHaveBeenCalledWith(1, 2, 3, 'rickshaw_mount', true, 9);
  });

  describe('the jump apex cue', () => {
    // Armed on the takeoff edge and spent the first frame the climb stops, so a
    // mount with a voice calls out at the top of the arc rather than on the way
    // up. The state object carries the latch between frames.
    function jump(look: string) {
      const sink = {
        mountIdle: vi.fn(),
        mountEngine: vi.fn(() => false),
        mountEngineIdles: vi.fn(() => false),
        mountRun: vi.fn(),
        mountApex: vi.fn(),
      };
      const surface = vi.fn(() => 'stone' as const);
      const state = { stepAccum: 0, mountPivot: false };
      // y is the driver: the pass takes the rise from the height it saw last
      // frame, so a jump is expressed as the arc the body actually travels.
      const frame = (airborne: boolean, y: number) =>
        updateRiddenMountAudio(
          sink,
          state,
          look,
          9,
          1,
          y,
          3,
          true,
          airborne,
          false,
          8,
          0.1,
          true,
          surface,
        );
      return { sink, frame };
    }

    it('fires once, at the frame the climb stops', () => {
      const { sink, frame } = jump('avian_strider');
      frame(false, 0); // grounded
      frame(true, 0.4); // takeoff
      expect(sink.mountApex).not.toHaveBeenCalled();
      frame(true, 0.7); // still climbing
      expect(sink.mountApex).not.toHaveBeenCalled();
      frame(true, 0.7); // the arc turns over
      expect(sink.mountApex).toHaveBeenCalledTimes(1);
      expect(sink.mountApex).toHaveBeenCalledWith(1, 0.7, 3, 'avian_strider');
      frame(true, 0.3); // falling: not a second apex
      expect(sink.mountApex).toHaveBeenCalledTimes(1);
    });

    it('re-arms for the next jump but never fires while grounded', () => {
      const { sink, frame } = jump('avian_strider');
      frame(true, 0.4);
      frame(true, 0.6);
      frame(true, 0.6); // apex
      frame(false, 0); // land
      frame(false, -0.2); // standing still, walking down a slope
      expect(sink.mountApex).toHaveBeenCalledTimes(1);
      frame(true, 0.4); // a second jump
      frame(true, 0.6);
      frame(true, 0.6);
      expect(sink.mountApex).toHaveBeenCalledTimes(2);
    });
  });
});
