// Real WebGL regression for finite subpixel fragments. Requires npm run dev.
// node scripts/warrior_impact_raster_probe.mjs [fresh-output.json]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const output = process.argv[2] ?? 'tmp/warrior-impact-raster.json';
if (fs.existsSync(output)) throw new Error('Use a fresh evidence output path');
const errors = [];
const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true });
const report = { cases: [], errors };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on('request', (r) =>
    r.url().endsWith('/warrior-raster-probe.html')
      ? r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' })
      : r.continue(),
  );
  await page.goto('http://127.0.0.1:5173/warrior-raster-probe.html');
  report.cases = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { ImpactFlipbooks } = await import('/src/render/ability_vfx/flipbooks.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.debug.checkShaderErrors = true;
    const scene = new THREE.Scene(),
      pool = new ImpactFlipbooks(scene);
    const mesh = scene.children[0],
      source = mesh.material;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    mesh.visible = true;
    mesh.scale.setScalar(2);
    const cases = [];
    try {
      for (const resolution of [128, 256])
        for (const angle of [0, 0.63]) {
          renderer.setSize(resolution, resolution);
          const target = new THREE.WebGLRenderTarget(resolution, resolution);
          renderer.setRenderTarget(target);
          for (const kind of ['sliver', 'droplet']) {
            const material = source.clone();
            const axis = `vec2(${Math.cos(angle).toFixed(8)},${Math.sin(angle).toFixed(8)})`;
            const expression =
              kind === 'sliver'
                ? `warriorSliver(vUv-.5,${axis},0.,.04,.0004)`
                : `warriorDroplet(vUv-.5,${axis},.04,.0004)`;
            const anchor = 'warriorFlash(vUv, uWarriorPhase, uTint, uHdr)';
            if (material.fragmentShader.split(anchor).length !== 2)
              throw new Error('Expected exactly one production impact shader call');
            material.fragmentShader = material.fragmentShader.replace(
              anchor,
              `vec4(vec3(${expression}),1.)`,
            );
            material.uniforms.uWarriorStyle.value = 1;
            mesh.material = material;
            renderer.setClearColor(0, 1);
            renderer.clear();
            renderer.render(scene, camera);
            const pixels = new Uint8Array(resolution * resolution * 4);
            renderer.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels);
            let visible = 0,
              escaped = 0;
            for (let y = 0; y < resolution; y++)
              for (let x = 0; x < resolution; x++) {
                if (pixels[(y * resolution + x) * 4] <= 3) continue;
                visible++;
                const px = (x + 0.5) / resolution - 0.5,
                  py = (y + 0.5) / resolution - 0.5;
                const along = px * Math.cos(angle) + py * Math.sin(angle);
                if (Math.abs(along) > 0.04 + 2 / resolution) escaped++;
              }
            cases.push({ kind, resolution, angle, visible, escaped });
            material.dispose();
            if (!visible || escaped) throw new Error(JSON.stringify(cases.at(-1)));
          }
          target.dispose();
        }
    } finally {
      mesh.material = source;
      pool.dispose();
      renderer.dispose();
    }
    return cases;
  });
} catch (e) {
  errors.push(e.stack ?? e.message);
} finally {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
if (errors.length) process.exitCode = 1;
