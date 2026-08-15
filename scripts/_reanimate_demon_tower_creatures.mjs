// Replace the duplicated Tripo takes in the Demon Tower Hellhound and Cinder
// Crawler. Their source GLBs shipped five differently named clips backed by the
// exact same samplers, so Attack replayed the locomotion pose and Death ended
// standing. This deterministic pass preserves the model, skin and textures and
// authors only the two gameplay one-shots the source failed to provide.
//
//   node scripts/_reanimate_demon_tower_creatures.mjs
//
// Safe to re-run: Attack and Death are dropped with their orphaned accessors,
// then recreated in the same order from bind-pose transforms.
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const FILES = [
  {
    path: 'public/models/creatures/tower_hellhound.glb',
    attack: {
      root: 'tripo::Root',
      lunge: [0, 0.02, 0.08, 0.14, 0.05, 0],
      rotations: [
        ['tripo::Spine_0', 'z', [0, 0.12, 0.32, -0.42, -0.15, 0]],
        ['tripo::Head_0', 'z', [0, -0.08, -0.18, 0.32, 0.1, 0]],
        ['tripo::0_Right_Limb_2', 'z', [0, -0.2, -0.65, 0.75, 0.25, 0]],
        ['bone_21', 'z', [0, 0.2, 0.55, -0.65, -0.2, 0]],
      ],
    },
    death: {
      root: 'tripo::Root',
      fallAxis: 'z',
      fall: [0, 0.05, 0.3, 0.85, 1.48, 1.52],
      sink: [0, 0, -0.04, -0.14, -0.25, -0.27],
      rotations: [
        ['tripo::Spine_0', 'z', [0, -0.02, -0.1, -0.2, -0.28, -0.3]],
        ['tripo::Head_0', 'x', [0, 0.02, 0.08, 0.18, 0.28, 0.3]],
        ['tripo::0_Right_Limb_2', 'x', [0, 0.02, 0.12, 0.3, 0.42, 0.45]],
        ['bone_21', 'x', [0, -0.02, -0.1, -0.26, -0.38, -0.4]],
      ],
    },
  },
  {
    path: 'public/models/creatures/tower_cinder_crawler.glb',
    attack: {
      root: 'tripo::Root',
      lunge: [0, 0.01, 0.06, 0.12, 0.04, 0],
      rotations: [
        ['tripo::0_Left_Limb_0', 'z', [0, 0.08, 0.22, -0.3, -0.1, 0]],
        ['tripo::0_Left_Limb_1', 'x', [0, -0.1, -0.35, 0.42, 0.12, 0]],
        ['tripo::0_Left_Limb_2', 'x', [0, 0.12, 0.4, -0.5, -0.14, 0]],
        ['tripo::0_Left_Limb_3', 'x', [0, -0.08, -0.3, 0.38, 0.1, 0]],
      ],
    },
    death: {
      root: 'tripo::Root',
      fallAxis: 'x',
      fall: [0, 0.04, 0.22, 0.65, 1.18, 1.24],
      sink: [0, 0, -0.03, -0.12, -0.22, -0.24],
      rotations: [
        ['tripo::0_Left_Limb_0', 'z', [0, 0.02, 0.08, 0.18, 0.28, 0.3]],
        ['bone_4', 'z', [0, -0.03, -0.12, -0.28, -0.45, -0.48]],
        ['bone_7', 'z', [0, 0.03, 0.1, 0.25, 0.4, 0.43]],
        ['bone_10', 'z', [0, -0.02, -0.1, -0.24, -0.38, -0.4]],
        ['bone_13', 'z', [0, 0.02, 0.1, 0.24, 0.38, 0.4]],
        ['bone_16', 'z', [0, -0.02, -0.08, -0.2, -0.34, -0.36]],
        ['bone_19', 'z', [0, 0.02, 0.08, 0.2, 0.34, 0.36]],
        ['bone_22', 'z', [0, -0.02, -0.08, -0.2, -0.32, -0.34]],
        ['bone_24', 'z', [0, 0.02, 0.08, 0.2, 0.32, 0.34]],
      ],
    },
  },
];

const ATTACK_TIMES = [0, 0.16, 0.34, 0.5, 0.76, 1.05];
const DEATH_TIMES = [0, 0.18, 0.48, 0.82, 1.22, 1.55];

const AXES = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qAxis(axisName, angle) {
  const axis = AXES[axisName];
  const sine = Math.sin(angle / 2);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle / 2)];
}

function addChannel(doc, buffer, animation, node, path, times, values, tag) {
  const input = doc
    .createAccessor(`${tag}_t`)
    .setType('SCALAR')
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  const output = doc
    .createAccessor(`${tag}_v`)
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
    .setArray(new Float32Array(values))
    .setBuffer(buffer);
  const sampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  animation
    .addSampler(sampler)
    .addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
}

function dropAnimations(root, names) {
  const dropped = root.listAnimations().filter((animation) => names.has(animation.getName()));
  const retainedAccessors = new Set();
  for (const animation of root.listAnimations()) {
    if (dropped.includes(animation)) continue;
    for (const sampler of animation.listSamplers()) {
      retainedAccessors.add(sampler.getInput());
      retainedAccessors.add(sampler.getOutput());
    }
  }
  const droppedAccessors = new Set();
  for (const animation of dropped) {
    for (const sampler of animation.listSamplers()) {
      if (!retainedAccessors.has(sampler.getInput())) droppedAccessors.add(sampler.getInput());
      if (!retainedAccessors.has(sampler.getOutput())) droppedAccessors.add(sampler.getOutput());
    }
    animation.dispose();
  }
  for (const accessor of droppedAccessors) accessor?.dispose();
}

function addRotationChannels(doc, buffer, animation, nodes, times, specs, tag) {
  for (const [name, axis, angles] of specs) {
    const node = nodes.get(name);
    if (!node) throw new Error(`${tag}: missing joint ${name}`);
    const rest = node.getRotation();
    addChannel(
      doc,
      buffer,
      animation,
      node,
      'rotation',
      times,
      angles.flatMap((angle) => qMul(rest, qAxis(axis, angle))),
      `${tag}_${name}`,
    );
  }
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const spec of FILES) {
  const bytesBefore = statSync(spec.path).size;
  const document = await io.read(spec.path);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0];
  const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
  dropAnimations(root, new Set(['Attack', 'Death']));

  const attackRoot = nodes.get(spec.attack.root);
  if (!attackRoot) throw new Error(`${spec.path}: missing root ${spec.attack.root}`);
  const attack = document.createAnimation('Attack');
  const attackRest = attackRoot.getTranslation();
  addChannel(
    document,
    buffer,
    attack,
    attackRoot,
    'translation',
    ATTACK_TIMES,
    spec.attack.lunge.flatMap((forward) => [attackRest[0] + forward, attackRest[1], attackRest[2]]),
    'towerCreatureAttackRoot',
  );
  addRotationChannels(
    document,
    buffer,
    attack,
    nodes,
    ATTACK_TIMES,
    spec.attack.rotations,
    'towerCreatureAttack',
  );

  const deathRoot = nodes.get(spec.death.root);
  if (!deathRoot) throw new Error(`${spec.path}: missing root ${spec.death.root}`);
  const death = document.createAnimation('Death');
  const deathRestTranslation = deathRoot.getTranslation();
  const deathRestRotation = deathRoot.getRotation();
  addChannel(
    document,
    buffer,
    death,
    deathRoot,
    'translation',
    DEATH_TIMES,
    spec.death.sink.flatMap((down) => [
      deathRestTranslation[0],
      deathRestTranslation[1] + down,
      deathRestTranslation[2],
    ]),
    'towerCreatureDeathRootPos',
  );
  addChannel(
    document,
    buffer,
    death,
    deathRoot,
    'rotation',
    DEATH_TIMES,
    spec.death.fall.flatMap((angle) => qMul(deathRestRotation, qAxis(spec.death.fallAxis, angle))),
    'towerCreatureDeathRootRot',
  );
  addRotationChannels(
    document,
    buffer,
    death,
    nodes,
    DEATH_TIMES,
    spec.death.rotations,
    'towerCreatureDeath',
  );

  await io.write(spec.path, document);
  console.log(`wrote ${spec.path} (${bytesBefore} -> ${statSync(spec.path).size} bytes)`);
}
