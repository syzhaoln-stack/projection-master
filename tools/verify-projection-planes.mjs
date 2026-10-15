import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'projection-master.js'), 'utf8');
const functionSource = (name, nextName) => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  if (start < 0 || end < 0) throw new Error(`Cannot isolate ${name}`);
  return source.slice(start, end);
};
const viewStart = source.indexOf('const VIEW = {');
const viewEnd = source.indexOf('\n};', viewStart) + 3;
const VIEW = new Function('THREE', `${source.slice(viewStart, viewEnd)}\nreturn VIEW;`)(THREE);

globalThis.self = globalThis;
globalThis.document = { baseURI: pathToFileURL(resolve(root, 'index.html')).href };
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.ProgressEvent ||= class ProgressEvent extends Event {
  constructor(type, values) { super(type); Object.assign(this, values); }
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url;
  return url.startsWith('file:')
    ? new Response(await readFile(fileURLToPath(url)), { status: 200 })
    : nativeFetch(input, options);
};
const { BRIDGE_CATALOG, BRIDGE_MODELS } = await import('../bridge-models.js');
const { DETAILED_BRIDGE_CATALOG, DETAILED_BRIDGE_MODELS } = await import('../detailed-bridges.js');
const entries = [
  ...BRIDGE_CATALOG.map(entry => ({ ...entry, definition: BRIDGE_MODELS[entry.id] })),
  ...DETAILED_BRIDGE_CATALOG.map(entry => ({ ...entry, definition: DETAILED_BRIDGE_MODELS[entry.id] }))
];
const corners = box => {
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
  return points;
};
const report = { scope: 'Actual projection cameras, folded/unfolded plane transforms, projection-line endpoints and physical 1:1 component focus; no raster/visual check', models: [] };

for (const entry of entries) {
  await entry.definition.load?.();
  const model = entry.definition.build();
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const gap = 3.5;
  const S = Math.max(size.x, size.y, size.z) + 2 * gap;
  const center = bounds.getCenter(new THREE.Vector3());
  const focusCenter = center.clone().add(new THREE.Vector3(size.x * 0.23, size.y * 0.12, size.z * 0.17));
  const focus = new THREE.Box3().setFromCenterAndSize(focusCenter, size.clone().multiplyScalar(0.13));
  const state = { planeSize: S, planeGap: gap, mode: 'explore', isTiled: false, unfoldProgress: 0 };
  const cameras = Object.fromEntries(Object.keys(VIEW).map(view => [view, new THREE.OrthographicCamera()]));
  const targets = Object.fromEntries(Object.keys(VIEW).map(view => [view, { width: 1024, height: 1024, setSize(w, h) { this.width = w; this.height = h; } }]));
  const environment = {
    THREE, VIEW, state, focusBox: null, PROJ_RES: 1024, PROJ_BG: 0xf8fafc, COL: { amber: 0xf0b454 },
    camera: new THREE.PerspectiveCamera(45, 1, 0.05, 1000),
    ensureProjResources() {}, getModelBounds: () => bounds.clone(),
    projCams: cameras, projTargets: targets, projScene: new THREE.Scene(),
    renderer: {
      getRenderTarget: () => null, getClearColor: value => value.set(0xffffff),
      getClearAlpha: () => 1, setClearColor() {}, setRenderTarget() {},
      render(_scene, camera) { camera.updateMatrixWorld(true); }
    },
    projLinesGroup: new THREE.Group(), clearGroup() {},
    points: [], lines: [],
    collectTopEdgesSimple: () => ({ pts: environment.points }),
    addDashedLine: (from, to) => environment.lines.push({ from: from.clone(), to: to.clone() })
  };
  const context = vm.createContext(environment);
  vm.runInContext([
    functionSource('getPlaneLayout', 'createCanvasTexture'),
    functionSource('renderProjViews', 'drawProjections'),
    functionSource('drawProjectionLines', 'addDashedLine'),
    functionSource('fittedCameraFrame', 'fitModelCamera')
  ].join('\n'), context);
  let wholeError = 0, focusError = 0, lineError = 0;
  const sceneSizes = {};
  for (const focused of [false, true]) {
    context.focusBox = focused ? focus : null;
    context.renderProjViews();
    const points = [...corners(focused ? focus : bounds), (focused ? focus : bounds).getCenter(new THREE.Vector3())];
    environment.points = points;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const layout = context.getPlaneLayout(t);
      const angle = t * Math.PI / 2;
      const expected = (view, point) => {
        if (view === 'front') return new THREE.Vector3(point.x, point.y, -S / 2);
        if (view === 'top') return new THREE.Vector3(point.x, -gap - Math.sin(angle) * (point.z + S / 2), -S / 2 + Math.cos(angle) * (point.z + S / 2));
        return new THREE.Vector3(S / 2 + Math.sin(angle) * (point.z + S / 2), point.y, -S / 2 + Math.cos(angle) * (point.z + S / 2));
      };
      for (const point of points) {
        for (const view of Object.keys(VIEW)) {
          const projected = point.clone().project(cameras[view]);
          const local = new THREE.Vector3(
            (VIEW[view].flipX ? -projected.x : projected.x) * S / 2,
            (VIEW[view].flipY ? -projected.y : projected.y) * S / 2, 0);
          const onPlane = local.applyEuler(layout[view].rot).add(layout[view].pos);
          const error = onPlane.distanceTo(expected(view, point));
          if (focused) focusError = Math.max(focusError, error);
          else wholeError = Math.max(wholeError, error);
        }
      }
      environment.lines = [];
      context.drawProjectionLines(t, layout);
      if (environment.lines.length !== points.length * 3) throw new Error('Unexpected projection-line inventory');
      points.forEach((point, index) => Object.keys(VIEW).forEach((view, viewIndex) => {
        lineError = Math.max(lineError, environment.lines[index * 3 + viewIndex].to.distanceTo(expected(view, point)));
      }));
      if (!focused && (t === 0 || t === 1)) {
        const allBounds = bounds.clone();
        for (const view of Object.keys(VIEW)) {
          for (const u of [-S / 2, S / 2]) for (const v of [-S / 2, S / 2]) {
            allBounds.expandByPoint(new THREE.Vector3(u, v, 0).applyEuler(layout[view].rot).add(layout[view].pos));
          }
        }
        sceneSizes[t === 0 ? 'folded' : 'unfolded'] = allBounds.getSize(new THREE.Vector3()).toArray();
      }
    }
  }
  let cameraMaxNdc = 0;
  for (const aspect of [0.75, 1, 1.6, 2.3]) {
    environment.camera.aspect = aspect;
    environment.camera.updateProjectionMatrix();
    // Explicit initial framing only. Unfolding intentionally preserves the user's camera;
    // camera invariance throughout that motion is covered by unfold-camera-behavior.test.mjs.
    for (const t of [0, 1]) {
      const layout = context.getPlaneLayout(t);
      const frame = context.fittedCameraFrame(t);
      const target = frame.target;
      environment.camera.position.copy(frame.position);
      environment.camera.up.set(0, 1, 0);
      environment.camera.lookAt(target);
      environment.camera.updateMatrixWorld(true);
      const points = corners(bounds);
      for (const view of Object.keys(VIEW)) {
        for (const u of [-S / 2, S / 2]) for (const v of [-S / 2, S / 2]) {
          points.push(new THREE.Vector3(u, v, 0).applyEuler(layout[view].rot).add(layout[view].pos));
        }
      }
      for (const point of points) {
        const ndc = point.project(environment.camera);
        cameraMaxNdc = Math.max(cameraMaxNdc, Math.abs(ndc.x), Math.abs(ndc.y));
      }
    }
  }
  report.models.push({ id: entry.id, whole_projection_max_error: wholeError, focus_projection_max_error: focusError, moving_line_max_error: lineError, model_size: size.toArray(), scene_sizes: sceneSizes, explicit_camera_fit_max_ndc: cameraMaxNdc });
  model.traverse(object => {
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose();
  });
}
report.maximum_errors = {
  whole: Math.max(...report.models.map(model => model.whole_projection_max_error)),
  focus: Math.max(...report.models.map(model => model.focus_projection_max_error)),
  lines: Math.max(...report.models.map(model => model.moving_line_max_error))
};
report.pass = Object.values(report.maximum_errors).every(error => error < 1e-7);
report.explicit_camera_fit_max_ndc = Math.max(...report.models.map(model => model.explicit_camera_fit_max_ndc));
report.explicit_camera_fits = report.explicit_camera_fit_max_ndc <= 1;
report.pass &&= report.explicit_camera_fits;
if (process.argv.includes('--write')) {
  await mkdir(resolve(root, 'qa'), { recursive: true });
  await writeFile(resolve(root, 'qa/projection-plane-check.json'), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ models: report.models.length, maximum_errors: report.maximum_errors, explicit_camera_fit_max_ndc: report.explicit_camera_fit_max_ndc, pass: report.pass }, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
