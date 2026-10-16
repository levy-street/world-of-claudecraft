// The build-side repair for a handoff whose re-authored tracks were bound to a
// sceneless duplicate of the rig (scripts/assets/woc_character/orphan_channels.mjs):
// the 2026-09-18 attack update shipped the female bodies that way, which would
// have kept the previous attacks playing on them.
import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import {
  reachableNodes,
  retargetOrphanChannels,
} from '../scripts/assets/woc_character/orphan_channels.mjs';

/** A rig with one in-scene `wrist.l`, a detached duplicate of it, and a clip. */
function rig() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const wrist = doc.createNode('wrist.l');
  const hips = doc.createNode('hips').addChild(wrist);
  doc.createScene('Scene').addChild(doc.createNode('WOC_Armored_Rig').addChild(hips));
  const orphanWrist = doc.createNode('wrist.l');
  doc.createNode('root').addChild(orphanWrist); // reached by no scene
  const sampler = (times: number[], values: number[]) =>
    doc
      .createAnimationSampler()
      .setInput(
        doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Float32Array(times)),
      )
      .setOutput(
        doc.createAccessor().setType('VEC4').setBuffer(buffer).setArray(new Float32Array(values)),
      );
  const stale = sampler([0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
  const fresh = sampler([0, 0.5, 1], [0, 0, 0, 1, 0, 0.5, 0, 0.866, 0, 0, 0, 1]);
  const anim = doc.createAnimation('1H_Chop').addSampler(stale).addSampler(fresh);
  const channel = (node: typeof wrist, s: typeof stale, targetPath: 'rotation' | 'translation') =>
    doc.createAnimationChannel().setTargetNode(node).setTargetPath(targetPath).setSampler(s);
  anim.addChannel(channel(wrist, stale, 'rotation'));
  anim.addChannel(channel(orphanWrist, fresh, 'rotation'));
  return { doc, anim, wrist, orphanWrist, stale, fresh, channel, sampler };
}

describe('retargetOrphanChannels', () => {
  it('moves the re-authored track onto the visible rig and drops the stale one', () => {
    const { doc, anim, wrist, orphanWrist, fresh } = rig();
    expect(retargetOrphanChannels(doc)).toEqual(['1H_Chop:wrist.l.rotation']);
    const channels = anim.listChannels();
    expect(channels.length).toBe(1);
    expect(channels[0].getTargetNode()).toBe(wrist);
    expect(channels[0].getSampler()).toBe(fresh);
    expect(channels[0].getSampler()?.getInput()?.getCount()).toBe(3);
    // The stale sampler went with its channel, and the duplicate is no longer
    // animated, so the orphan sweep may drop it.
    expect(anim.listSamplers()).toEqual([fresh]);
    const animated = orphanWrist
      .listParents()
      .some((parent) => parent.propertyType === 'AnimationChannel');
    expect(animated).toBe(false);
    expect(reachableNodes(doc.getRoot()).has(orphanWrist)).toBe(false);
  });

  it('leaves a sound file alone, and a stale track on another path in place', () => {
    const { doc, anim, wrist, orphanWrist, channel, sampler } = rig();
    const slide = sampler([0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    anim.addSampler(slide).addChannel(channel(wrist, slide, 'translation'));
    expect(retargetOrphanChannels(doc).length).toBe(1);
    expect(
      anim
        .listChannels()
        .map((c) => c.getTargetPath())
        .sort(),
    ).toEqual(['rotation', 'translation']);
    // Second pass: nothing targets an orphan any more.
    expect(retargetOrphanChannels(doc)).toEqual([]);
    expect(orphanWrist.isDisposed()).toBe(false);
  });

  it('keeps a sampler another channel still plays', () => {
    const { doc, anim, stale, channel } = rig();
    const elbow = doc.createNode('lowerarm.l');
    doc.getRoot().listScenes()[0].listChildren()[0].addChild(elbow);
    anim.addChannel(channel(elbow, stale, 'rotation'));
    retargetOrphanChannels(doc);
    expect(stale.isDisposed()).toBe(false);
    expect(anim.listChannels().length).toBe(2);
  });

  it('refuses an orphan track with no in-scene twin, an ambiguous twin, or two claimants', () => {
    const lonely = rig();
    lonely.orphanWrist.setName('wrist.l.001');
    expect(() => retargetOrphanChannels(lonely.doc)).toThrow(/0 in-scene twins/);

    const twinned = rig();
    twinned.doc
      .getRoot()
      .listScenes()[0]
      .listChildren()[0]
      .addChild(twinned.doc.createNode('wrist.l'));
    expect(() => retargetOrphanChannels(twinned.doc)).toThrow(/2 in-scene twins/);

    const doubled = rig();
    doubled.anim.addChannel(doubled.channel(doubled.orphanWrist, doubled.fresh, 'rotation'));
    expect(() => retargetOrphanChannels(doubled.doc)).toThrow(/two orphan channels claim/);
  });
});
