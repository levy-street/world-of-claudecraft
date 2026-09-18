import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { prepareBeastAbilityClips } from '../src/render/characters/beast_ability_clips';

function requireClip(clips: Map<string, THREE.AnimationClip>, id: string) {
  const clip = clips.get(id);
  if (!clip) throw new Error(`Missing required beast clip: ${id}`);
  return clip;
}

function requireTrack(clip: THREE.AnimationClip, name: string) {
  const track = clip.tracks.find((candidate) => candidate.name === name);
  if (!track) throw new Error(`Missing required beast track: ${clip.name}/${name}`);
  return track;
}

function fixture(wolf: boolean) {
  const tracks = [
    wolf ? 'Head' : 'head',
    wolf ? 'Spine_4' : 'spine',
    'Chin',
    'Front_Leg_Shoulder_L',
    'Front_Leg_Shoulder_R',
    'arm',
  ].map(
    (name) =>
      new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  );
  return new Map([
    [
      'Idle',
      new THREE.AnimationClip('Idle', 1, [
        ...tracks,
        new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0]),
      ]),
    ],
  ]);
}
describe('anatomical beast actions', () => {
  it('Headbutt moves the head through anticipation and contact without a weapon swing or root teleport', () => {
    const clips = fixture(false);
    prepareBeastAbilityClips('player_druid', clips);
    const clip = requireClip(clips, 'Signature_skull_bash');
    const head = requireTrack(clip, 'head.quaternion');
    expect(head.values[4]).toBeLessThan(0);
    expect(head.values[8]).toBeGreaterThan(0);
    expect(requireTrack(clip, 'root.position').values.every((n) => n === 0)).toBe(true);
    expect(requireTrack(clip, 'arm.quaternion').values[8]).toBe(0);
    expect(clip.duration).toBeLessThan(0.75);
  });
  it('keeps world wolves untouched and preserves all nine player wolf pose families', () => {
    const world = fixture(true);
    const worldIdle = requireClip(world, 'Idle');
    const worldBefore = worldIdle.toJSON();
    prepareBeastAbilityClips('mob_wolf', world);
    expect([...world.keys()]).toEqual(['Idle']);
    expect(world.get('Idle')).toBe(worldIdle);
    expect(worldIdle.toJSON()).toEqual(worldBefore);
    const player = fixture(true);
    const playerIdle = requireClip(player, 'Idle');
    const playerBefore = playerIdle.toJSON();
    prepareBeastAbilityClips('form_cat', player);
    // Seven distinct attacks and two deliberately shared utility actions:
    // crouch and rally. Fourteen named clips do not mean fourteen poses.
    const poseFamilies = [
      ['claw'],
      ['rake'],
      ['rip'],
      ['ferocious_bite'],
      ['pounce'],
      ['redharvest'],
      ['skull_bash'],
      ['prowl', 'dash', 'primal_reflexes'],
      ['frenzied_regeneration', 'enrage', 'tigers_fury', 'feral_charge'],
    ];
    const expected = poseFamilies.flat().map((id) => `Signature_${id}`);
    expect([...player.keys()].sort()).toEqual(['Idle', ...expected].sort());
    expect(player.get('Idle')).toBe(playerIdle);
    expect(playerIdle.toJSON()).toEqual(playerBefore);
    const fingerprint = (id: string) =>
      JSON.stringify(
        requireClip(player, `Signature_${id}`).tracks.map((track) => ({
          name: track.name,
          values: [...track.values],
        })),
      );
    const familyPoses = poseFamilies.map(([first, ...rest]) => {
      const pose = fingerprint(first);
      for (const id of rest) expect(fingerprint(id), id).toBe(pose);
      return pose;
    });
    expect(new Set(familyPoses).size).toBe(poseFamilies.length);
    for (const id of expected) {
      const clip = requireClip(player, id);
      expect(clip.name).toBe(id);
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.duration).toBeLessThan(0.75);
      expect(clip.tracks.map((track) => track.name)).toEqual(
        playerIdle.tracks.map((track) => track.name),
      );
      let hasMotion = false;
      for (const [index, track] of clip.tracks.entries()) {
        expect([...track.values].every(Number.isFinite), `${id}: ${track.name}`).toBe(true);
        expect([...track.times].every(Number.isFinite)).toBe(true);
        expect(track.times.length).toBeGreaterThanOrEqual(4); // anticipation, action, recovery, rest
        expect(track.times[0]).toBe(0);
        expect(track.times.at(-1)).toBeCloseTo(clip.duration);
        const stride = track.getValueSize();
        expect(track.values.length).toBe(track.times.length * stride);
        const rest = [...playerIdle.tracks[index].values.slice(0, stride)];
        expect([...track.values.slice(0, stride)]).toEqual(rest);
        expect([...track.values.slice(-stride)]).toEqual(rest);
        for (let frame = 1; frame < track.times.length; frame++) {
          expect(track.times[frame]).toBeGreaterThan(track.times[frame - 1]);
          const pose = [...track.values.slice(frame * stride, (frame + 1) * stride)];
          if (track.name.endsWith('.quaternion')) {
            expect(Math.hypot(...pose)).toBeCloseTo(1);
            if (pose.some((value, component) => Math.abs(value - rest[component]) > 0.01))
              hasMotion = true;
          } else {
            // Movement owns translation; these actions cannot teleport the root.
            expect(pose).toEqual(rest);
          }
        }
      }
      expect(hasMotion, `${id} must actually animate between its idle endpoints`).toBe(true);
    }
  });
});
