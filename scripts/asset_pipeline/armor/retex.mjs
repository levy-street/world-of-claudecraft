// Armor-variant retexture driver: uploads a plain GLB to Tripo /models/texture
// (UV-preserving repaint) and downloads the textured GLB. Usage:
//   node tmp/asset_pipeline/armor_picker/retex.mjs <in.glb> <out.glb> "<prompt>" [quality]
import { textureModel, download, getTask } from '../lib/tripo.mjs';

const [inGlb, outGlb, prompt, quality = 'detailed'] = process.argv.slice(2);
if (!inGlb || !outGlb || !prompt) {
  console.error('usage: retex.mjs <in.glb> <out.glb> "<prompt>" [quality]');
  process.exit(2);
}
const { taskId, task } = await textureModel({
  input: inGlb,
  prompt,
  textureQuality: quality,
  onTaskCreated: (id) => console.log('task created:', id),
  onProgress: (p, s) => console.log(`progress ${p}% (${s})`),
});
const url = task.output?.model_url ?? task.output?.model_urls?.[0];
if (!url) throw new Error(`no model_url on texture task ${taskId}`);
await download(url, outGlb);
const detail = await getTask(taskId);
console.log('DONE', outGlb, 'credits_consumed:', detail?.credits_consumed ?? '?');
