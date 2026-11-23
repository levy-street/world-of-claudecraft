import fs from 'node:fs';

const key = process.argv[2];
const out = `E:/woc/entregas/santuario/trash/${key}`;
const read = (name) => fs.readFileSync(name, 'utf8');
const text = [
  'Original creature geometry, textures and animations authored for World of ClaudeCraft.',
  'KayKit knight: CC0 reference only, excluded from the creature GLBs.',
  'Offline viewer: Three.js, Meshoptimizer and Basis Universal.',
  'Basis wrapper includes the existing WoC local CSP patch; see public/basis/basis_transcoder.js.',
  '\nTHREE.JS\n',
  read('node_modules/three/LICENSE'),
  '\nMESHOPTIMIZER\n',
  read('node_modules/meshoptimizer/LICENSE.md'),
  '\nBASIS UNIVERSAL\n',
  read('tmp/cultistas/basis_LICENSE.txt'),
].join('\n');
fs.writeFileSync(`${out}/THIRD_PARTY_NOTICES.txt`, text);
fs.mkdirSync(`${out}/source/reference`, { recursive: true });
fs.copyFileSync(
  'tmp/cultistas/knight_reference.glb',
  `${out}/source/reference/knight_reference.glb`,
);
console.log('NOTICES', key);
