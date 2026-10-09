import fs from 'node:fs';
import { build } from 'esbuild';

const key = process.argv[2],
  out = `E:/woc/entregas/santuario/trash/${key}`;
const b64 = (f) => fs.readFileSync(f).toString('base64');
const result = await build({
  entryPoints: ['scripts/anim/cultistas/viewer_entry.mjs'],
  bundle: true,
  write: false,
  format: 'esm',
  minify: true,
});
const payload = {
  glb: b64(`${out}/${key}.glb`),
  knight: b64('tmp/cultistas/knight_reference.glb'),
  basisJS: b64('public/basis/basis_transcoder.js'),
  basisWasm: b64('public/basis/basis_transcoder.wasm'),
};
fs.writeFileSync(
  `${out}/viewer.html`,
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${key} | Visor 3D</title><style>body{margin:0;background:#16232d;color:#e5eff4;font:14px system-ui}header{height:80px;padding:5px 16px}select,button,input{margin:5px}canvas{display:block;width:100%}input{width:25vw}</style><header><strong>${key}</strong> <select aria-label="Animación"></select><button>Reproducir</button><input aria-label="Tiempo" type="range" min="0" step="0.01"><div id="status">Cargando modelo y texturas KTX2...</div></header><script>window.ASSET=${JSON.stringify(payload)}</script><script type="module">${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></html>`,
);
console.log('OFFLINE VIEWER', key);
