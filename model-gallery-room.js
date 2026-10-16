import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COLUMN_WIDTH = 4.05, ROW_HEIGHT = 3.1, CABINET_WIDTH = COLUMN_WIDTH * 4 + 0.4;
const SHELF_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, -0.26, 0, 'YXZ'));
const clamp = THREE.MathUtils.clamp;
const categories = new Set(['all', 'mechanical', 'bridge']);
const categoryOrAll = value => categories.has(value) ? value : 'all';

/** Fixed homes never move when a model is held or the other wall is focused. */
export function createRoomLayout(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('陈列模型清单为空');
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.id || seen.has(entry.id) || !['mechanical', 'bridge'].includes(entry.category)) throw new Error('陈列模型清单无效');
    seen.add(entry.id);
  }
  const present = ['mechanical', 'bridge'].filter(category => entries.some(entry => entry.category === category));
  return present.map(category => {
    const members = entries.filter(entry => entry.category === category);
    const rows = Math.max(category === 'mechanical' ? 2 : 3, Math.ceil(members.length / 4));
    const position = new THREE.Vector3(present.length === 1 ? 0 : category === 'mechanical' ? -8.55 : 8.55, 0, -1.6);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), present.length === 1 ? 0 : category === 'mechanical' ? 0.32 : -0.32);
    const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
    const height = rows * ROW_HEIGHT + 0.7;
    return { category, rows, columns: 4, width: CABINET_WIDTH, height, position, quaternion, matrix,
      bounds: new THREE.Box3(new THREE.Vector3(-CABINET_WIDTH / 2 - 0.18, -0.05, -0.95), new THREE.Vector3(CABINET_WIDTH / 2 + 0.18, height + 0.22, 1.88)),
      titleAnchor: new THREE.Vector3(0, height - 0.23, 1.12).applyMatrix4(matrix),
      slots: members.map((entry, index) => {
        const column = index % 4, row = Math.floor(index / 4);
        const shelfY = 0.56 + (rows - row - 1) * ROW_HEIGHT;
        const x = (column - 1.5) * COLUMN_WIDTH;
        return { entry, category, index, row, column, shelfY, x,
          anchor: new THREE.Vector3(x, shelfY - 0.2, 1.83).applyMatrix4(matrix) };
      }) };
  });
}

function corners(bounds) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

/** Perspective framing uses all eight corners, including the cabinets' depth. */
export function frameRoomWall(layout, category = 'all', aspect = 1.5, fov = 38) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('陈列视口尺寸无效');
  const matching = layout.filter(wall => categoryOrAll(category) === 'all' || wall.category === category);
  const chosen = matching.length ? matching : layout;
  const points = chosen.flatMap(wall => corners(wall.bounds).map(point => point.applyMatrix4(wall.matrix)));
  const bounds = new THREE.Box3().setFromPoints(points), target = bounds.getCenter(new THREE.Vector3());
  const direction = chosen.length === 1 ? new THREE.Vector3(0, 0.12, 1).applyQuaternion(chosen[0].quaternion).normalize() : new THREE.Vector3(0, 0.13, 1).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  let distance = 0;
  for (const point of points) {
    const delta = point.clone().sub(target), depth = delta.dot(direction);
    distance = Math.max(distance, depth + Math.abs(delta.dot(right)) / (tangent * aspect), depth + Math.abs(delta.dot(up)) / tangent);
  }
  distance *= 1.12;
  return { target, position: target.clone().addScaledVector(direction, distance), bounds, fov, near: 0.1, far: Math.max(150, distance * 4) };
}

/** Reversible, bounded arc. The caller owns both endpoint poses. */
export function sampleTakePose(from, to, progress, lift = 1.15) {
  const t = clamp(progress, 0, 1), eased = t * t * (3 - 2 * t);
  const position = new THREE.Vector3().lerpVectors(from.position, to.position, eased);
  position.y += Math.sin(Math.PI * t) * lift;
  return { position, scale: THREE.MathUtils.lerp(from.scale, to.scale, eased),
    quaternion: new THREE.Quaternion().slerpQuaternions(from.quaternion, to.quaternion, eased) };
}

/** Fit the complete perspective silhouette, including the nearest corners.
 * Bounds are normalized model-local coordinates centered at the held origin.
 * Fractions describe total screen occupancy, leaving space for projection paper. */
export function fitHeldModelScale({ bounds, quaternion, camera, distance, widthFraction = 0.42, heightFraction = 0.48 }) {
  if (!bounds?.isBox3 || bounds.isEmpty() || !(distance > camera.near) || !(camera.aspect > 0)
      || !(widthFraction > 0 && widthFraction < 1) || !(heightFraction > 0 && heightFraction < 1)) throw new Error('取件观察范围无效');
  const rotation = camera.quaternion.clone().invert().multiply(quaternion);
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
  const xLimit = tangent * camera.aspect * widthFraction, yLimit = tangent * heightFraction;
  let scale = Infinity;
  for (const corner of corners(bounds)) {
    corner.applyQuaternion(rotation);
    // In camera coordinates a positive local z brings a corner closer to the
    // eye, enlarging its perspective projection; include that depth in the fit.
    const xCoefficient = Math.abs(corner.x) + xLimit * corner.z;
    const yCoefficient = Math.abs(corner.y) + yLimit * corner.z;
    if (xCoefficient > 0) scale = Math.min(scale, xLimit * distance / xCoefficient);
    if (yCoefficient > 0) scale = Math.min(scale, yLimit * distance / yCoefficient);
    if (corner.z > 0) scale = Math.min(scale, (distance - camera.near * 1.05) / corner.z);
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('取件观察范围无效');
  return scale;
}

/** Snapshot the exact display similarity, rather than guessing a new view from
 * model bounds. All values are detached from the room's disposable scene. */
export function captureGalleryHandoff({ modelId, sourceCenter, sourceUnit, mount, camera, target, viewport }) {
  mount.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  mount.matrixWorld.decompose(position, quaternion, scale);
  return { version: 1, modelId, sourceCenter: sourceCenter.toArray(), sourceUnit,
    displayPose: { position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.x },
    camera: { position: camera.getWorldPosition(new THREE.Vector3()).toArray(),
      quaternion: camera.getWorldQuaternion(new THREE.Quaternion()).toArray(), up: camera.up.toArray(), target: target.toArray(),
      fov: camera.fov, aspect: camera.aspect, zoom: camera.zoom, near: camera.near, far: camera.far },
    viewport: { left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height } };
}

/** Map the viewing camera back through the room's uniform display transform.
 * Source geometry stays untouched, including its engineering coordinate axes.
 * Viewport compensation preserves CSS-pixel positions even if controls changed
 * the receiving canvas height. Returning a new camera keeps this testable. */
export function cameraFromGalleryHandoff(handoff, viewport) {
  const array = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
  const rect = value => value && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(value[key])) && value.width > 0 && value.height > 0;
  const source = handoff?.camera, display = handoff?.displayPose;
  if (handoff?.version !== 1 || !array(handoff.sourceCenter, 3) || !array(display?.position, 3) || !array(display?.quaternion, 4)
      || !array(source?.position, 3) || !array(source?.quaternion, 4) || !rect(handoff.viewport) || !rect(viewport)
      || ![handoff.sourceUnit, display.scale, source.zoom, source.aspect].every(value => Number.isFinite(value) && value > 0)
      || !(source.fov > 0 && source.fov < 179) || !(source.near > 0 && source.far > source.near)) throw new Error('模型取放视角无效');
  const center = new THREE.Vector3().fromArray(handoff.sourceCenter);
  const inverseRotation = new THREE.Quaternion().fromArray(display.quaternion).normalize().invert();
  const scale = handoff.sourceUnit * display.scale;
  const position = new THREE.Vector3().fromArray(source.position).sub(new THREE.Vector3().fromArray(display.position))
    .applyQuaternion(inverseRotation).divideScalar(scale).add(center);
  const quaternion = inverseRotation.multiply(new THREE.Quaternion().fromArray(source.quaternion).normalize());
  const original = handoff.viewport;
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(source.fov / 2)) * viewport.height / original.height));
  const camera = new THREE.PerspectiveCamera(fov, viewport.width / viewport.height, source.near / scale, source.far / scale);
  camera.position.copy(position); camera.quaternion.copy(quaternion); camera.zoom = source.zoom;
  // Camera-local up preserves the actual roll, including a rotated display mount.
  camera.up.set(0, 1, 0).applyQuaternion(quaternion);
  const offsetX = viewport.left + viewport.width / 2 - original.left - original.width / 2;
  const offsetY = viewport.top + viewport.height / 2 - original.top - original.height / 2;
  if (Math.abs(offsetX) > 1e-8 || Math.abs(offsetY) > 1e-8) camera.setViewOffset(viewport.width, viewport.height, offsetX, offsetY, viewport.width, viewport.height);
  // CSS rectangles may contain fractions while renderer aspect was computed
  // from integer clientWidth/clientHeight. Preserve both actual focal lengths.
  camera.aspect = source.aspect * viewport.width / original.width * original.height / viewport.height;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const distance = center.clone().sub(position).dot(forward);
  const target = position.clone().addScaledVector(forward, Math.max(distance, camera.near * 2));
  return { camera, target };
}

/** Display objects own their geometry/materials; loader-cache textures do not. */
export function disposeGalleryTree(root) {
  if (!root?.traverse) return;
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function materialKey(material) {
  if (!['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshPhongMaterial', 'MeshLambertMaterial', 'MeshBasicMaterial'].includes(material.type)) return material.uuid;
  const properties = ['type', 'color', 'emissive', 'specular', 'emissiveIntensity', 'roughness', 'metalness', 'shininess', 'opacity', 'transparent', 'alphaTest',
    'side', 'vertexColors', 'flatShading', 'wireframe', 'depthWrite', 'depthTest', 'blending', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
    'normalScale', 'bumpScale', 'aoMapIntensity', 'envMapIntensity', 'clearcoat', 'clearcoatRoughness', 'transmission', 'ior', 'thickness', 'attenuationColor', 'attenuationDistance'];
  const values = properties.map(key => {
    const value = material[key]; return value?.toArray ? value.toArray() : value;
  });
  values.push(...Object.keys(material).filter(key => material[key]?.isTexture).sort().map(key => [key, material[key].uuid]));
  return JSON.stringify(values);
}

function triangleSlice(geometry, matrix, start, count, material) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  source.applyMatrix4(matrix);
  if (!source.attributes.normal) source.computeVertexNormals();
  const result = new THREE.BufferGeometry();
  const attributes = ['position', 'normal'];
  if (Object.values(material).some(value => value?.isTexture) && source.attributes.uv) attributes.push('uv');
  if (material.vertexColors && source.attributes.color) attributes.push('color');
  const reflected = matrix.determinant() < 0;
  for (const name of attributes) {
    const attribute = source.attributes[name], array = new Float32Array(count * attribute.itemSize);
    for (let i = 0; i < count; i++) for (let component = 0; component < attribute.itemSize; component++) {
      const vertex = reflected && i % 3 !== 0 ? i + (i % 3 === 1 ? 1 : -1) : i;
      array[i * attribute.itemSize + component] = attribute.getComponent(start + vertex, component);
    }
    result.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  source.dispose();
  return result;
}

/** Preserve every visible triangle and source transform, then batch equal
 * finishes. Auxiliary lines/guides never enter the copy, bounds or raycaster. */
export function makeDisplayCopy(source, id = '') {
  if (!source?.isObject3D) throw new Error('模型没有有效实体');
  source.updateWorldMatrix(true, true);
  const batches = new Map(), copy = new THREE.Group();
  const visit = (object, visible) => {
    if (!visible || !object.visible || object.userData?.projectionGuide || object.isLine || object.isPoints || object.isSprite || object.isLight || object.isCamera) return;
    if (object.isSkinnedMesh || object.morphTargetInfluences?.some(value => value !== 0)) throw new Error('陈列模型需要静态实体');
    if (object.isMesh && object.geometry?.attributes.position) {
      const geometry = object.geometry, length = geometry.index?.count || geometry.attributes.position.count;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count: length, materialIndex: 0 }];
      const matrices = [];
      if (object.isInstancedMesh) {
        for (let index = 0; index < object.count; index++) {
          const matrix = new THREE.Matrix4(); object.getMatrixAt(index, matrix); matrices.push(object.matrixWorld.clone().multiply(matrix));
        }
      } else matrices.push(object.matrixWorld);
      for (const group of groups) {
        const material = materials[group.materialIndex || 0]; if (!material || material.visible === false) continue;
        const start = Math.max(group.start, geometry.drawRange.start), end = Math.min(length, group.start + group.count, geometry.drawRange.start + geometry.drawRange.count);
        const count = Math.floor((end - start) / 3) * 3; if (count <= 0) continue;
        for (const matrix of matrices) {
          const part = triangleSlice(geometry, matrix, start, count, material);
          const key = materialKey(material) + ':' + Object.keys(part.attributes).join(',');
          if (!batches.has(key)) batches.set(key, { material, parts: [] });
          batches.get(key).parts.push(part);
        }
      }
    }
    for (const child of object.children) visit(child, true);
  };
  try {
    visit(source, true);
    for (const { material, parts } of batches.values()) {
      const geometry = mergeGeometries(parts, false); if (!geometry) throw new Error('模型展示合并失败');
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.name = `gallery:${id}`; mesh.userData.galleryModelId = id;
      mesh.castShadow = false; mesh.receiveShadow = false;
      copy.add(mesh);
    }
    const bounds = new THREE.Box3().setFromObject(copy);
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || bounds.getSize(new THREE.Vector3()).length() <= 0) throw new Error('模型没有有效实体');
    copy.userData.galleryModelId = id;
    return copy;
  } catch (error) { disposeGalleryTree(copy); throw error; }
  finally { for (const { parts } of batches.values()) for (const geometry of parts) geometry.dispose(); }
}

function makeGrain(document) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  let context; try { context = canvas.getContext('2d'); } catch { return null; }
  if (!context) return null;
  context.fillStyle = '#bda57f'; context.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 65; i++) {
    context.strokeStyle = `rgba(92,65,38,${0.025 + (i % 5) * 0.009})`; context.lineWidth = 0.55 + i % 3 * 0.25;
    context.beginPath(); context.moveTo(0, i + 0.3);
    for (let x = 0; x <= 256; x += 16) context.lineTo(x, i + Math.sin(x * 0.019 + i) * 1.1);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(5, 1);
  return texture;
}

/** One isolated renderer. `runtime` exists for deterministic lifecycle tests;
 * the application only needs the documented host/entries/definitions callbacks. */
export function createGalleryRoom({ host, entries, definitions, onSelect = () => {}, onStateChange = () => {}, onError = () => {}, runtime = {} }) {
  if (!host) throw new Error('缺少陈列室容器');
  const document = runtime.document || host.ownerDocument || globalThis.document;
  const window = runtime.window || document.defaultView || globalThis.window;
  const now = runtime.now || (() => window.performance.now());
  const requestFrame = runtime.requestFrame || (callback => window.requestAnimationFrame(callback));
  const cancelFrame = runtime.cancelFrame || (handle => window.cancelAnimationFrame(handle));
  const rendererFactory = runtime.createRenderer || (() => new THREE.WebGLRenderer({ antialias: true, alpha: false }));
  const ResizeObserverClass = runtime.ResizeObserver || window.ResizeObserver;
  const layout = createRoomLayout(entries), entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const ordered = layout.flatMap(wall => wall.slots);
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = Boolean(media?.matches), active = false, disposed = false, generation = 0;
  let renderer = null, scene = null, camera = null, labels = null, observer = null, frameId = null;
  let phase = 'wall', category = 'all', selected = null, readyCount = 0, zoom = 1;
  let motion = null, cameraMotion = null, dirty = true, loadQueue = Promise.resolve();
  let width = 1, height = 1, pinchDistance = 0, backdropAmount = 0, inspectionActive = false, handoffPending = false;
  let pendingHandoff = null, handoffSequence = 0;
  const slots = new Map(), wallTitles = [], ownedTextures = new Set(), listeners = [], pointers = new Map();
  const originalColors = new Map(), backdropColor = new THREE.Color('#e4e8e2');
  const cameraTarget = new THREE.Vector3(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();

  const getState = () => ({ phase, selectedId: selected?.entry.id || null, category, readyCount, total: entries.length });
  function notify() { onStateChange(getState()); }
  function fail(error, entry) { onError(error instanceof Error ? error : new Error(String(error)), entry); }
  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options));
  }
  function markDirty() { dirty = true; }
  function fadeBackdrop(amount) {
    backdropAmount = clamp(amount, 0, 1);
    const heldMaterials = new Set();
    selected?.mount.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) heldMaterials.add(material);
    });
    scene.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material?.color) continue;
        if (!originalColors.has(material)) originalColors.set(material, material.color.clone());
        material.color.copy(originalColors.get(material));
        if (!heldMaterials.has(material)) material.color.lerp(backdropColor, backdropAmount * 0.67);
      }
    });
    scene.background.set('#e2e7df').lerp(backdropColor, backdropAmount); markDirty();
  }
  function pose(object) { return { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.x }; }
  function setPose(object, value) { object.position.copy(value.position); object.quaternion.copy(value.quaternion); object.scale.setScalar(value.scale); }
  function cancelMotion() { if (motion) { const previous = motion; motion = null; previous.resolve(false); } }

  function addBox(parent, size, position, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  function buildCabinets() {
    const grain = makeGrain(document); if (grain) ownedTextures.add(grain);
    const wood = new THREE.MeshStandardMaterial({ color: '#c4af8d', map: grain, roughness: 0.78 });
    const edge = new THREE.MeshStandardMaterial({ color: '#967e5d', roughness: 0.65 });
    const back = new THREE.MeshStandardMaterial({ color: '#dfdfd5', roughness: 0.94 });
    const metal = new THREE.MeshStandardMaterial({ color: '#69776d', roughness: 0.65, metalness: 0.18 });
    const floor = new THREE.MeshStandardMaterial({ color: '#d8dcd4', roughness: 1 });
    addBox(scene, [41, 0.15, 23], [0, -0.24, 3.2], floor);
    for (const wall of layout) {
      const cabinet = new THREE.Group(); cabinet.position.copy(wall.position); cabinet.quaternion.copy(wall.quaternion); scene.add(cabinet);
      addBox(cabinet, [wall.width, wall.height, 0.18], [0, wall.height / 2, -0.83], back);
      addBox(cabinet, [wall.width + 0.25, 0.4, 2.8], [0, 0.12, 0.45], edge);
      addBox(cabinet, [wall.width + 0.18, 0.15, 2.72], [0, wall.height, 0.45], wood);
      for (let column = 0; column <= 4; column++) {
        const x = (column - 2) * COLUMN_WIDTH;
        addBox(cabinet, [column === 0 || column === 4 ? 0.13 : 0.055, wall.height, 0.12], [x, wall.height / 2, 1.72], metal);
        addBox(cabinet, [0.07, wall.height, 0.1], [x, wall.height / 2, -0.68], metal);
      }
      for (let row = 0; row < wall.rows; row++) {
        const shelfY = 0.56 + row * ROW_HEIGHT;
        addBox(cabinet, [wall.width, 0.13, 2.62], [0, shelfY, 0.43], wood);
        addBox(cabinet, [wall.width, 0.065, 0.08], [0, shelfY - 0.06, 1.77], edge);
      }
      for (const home of wall.slots) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'model-gallery-room-label';
        button.dataset.modelId = home.entry.id; button.disabled = true; button.setAttribute('aria-label', `正在准备${home.entry.name}`);
        const name = document.createElement('span'); name.className = 'name'; name.textContent = home.entry.name;
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '正在准备…'; button.append(name, tag);
        // Accessible keyboard controls live in the visually clipped container.
        // No DOM title or plaque paints over either the cabinet or projections.
        Object.assign(button.style, { position: 'static', transform: 'none', pointerEvents: 'none' });
        labels.append(button);
        const slot = { ...home, wall, button, tag, mount: null, home: null, displayBounds: null, failed: false };
        slots.set(home.entry.id, slot);
        listen(button, 'click', () => { void take(home.entry.id); });
      }
    }
  }

  function applyCamera(frame) {
    camera.position.copy(frame.position); cameraTarget.copy(frame.target); camera.near = frame.near; camera.far = frame.far;
    camera.lookAt(cameraTarget); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); dirty = true;
  }
  function heldPose(slot, quaternion = slot.home.quaternion) {
    const direction = cameraTarget.clone().sub(camera.position).normalize();
    const distance = clamp(camera.position.distanceTo(cameraTarget) * 0.43, 5, 16);
    const scale = fitHeldModelScale({ bounds: slot.displayBounds, quaternion, camera, distance });
    return { position: camera.position.clone().addScaledVector(direction, distance), scale: scale * zoom,
      quaternion: quaternion.clone() };
  }
  function captureHeldHandoff(slot) {
    return captureGalleryHandoff({ modelId: slot.entry.id, sourceCenter: slot.sourceCenter, sourceUnit: slot.sourceUnit,
      mount: slot.mount, camera, target: cameraTarget, viewport: renderer.domElement.getBoundingClientRect() });
  }
  function refreshPendingHandoff() {
    if (handoffPending && pendingHandoff && selected && phase === 'holding') Object.assign(pendingHandoff, captureHeldHandoff(selected));
  }
  function resize() {
    if (!active || !renderer) return;
    width = Math.max(host.clientWidth || 0, 1); height = Math.max(host.clientHeight || 0, 1);
    if (width <= 1 || height <= 1) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; cameraMotion = null;
    applyCamera(frameRoomWall(layout, category, camera.aspect, camera.fov));
    if (selected && phase === 'holding') {
      const next = heldPose(selected, selected.mount.quaternion); selected.mount.position.copy(next.position); selected.mount.scale.setScalar(next.scale);
    } else if (selected && phase === 'taking' && motion) motion.to = heldPose(selected);
    if (handoffPending) {
      // While the receiving model loads, a real viewport resize may still move
      // the held pose. Update the shared data snapshot only with a rendered frame.
      scene.updateMatrixWorld(true); renderer.render(scene, camera); refreshPendingHandoff();
    }
    markDirty();
  }
  function placeLabels() {
    for (const slot of slots.values()) slot.button.hidden = ['taking', 'holding', 'returning'].includes(phase);
  }
  function updateSlotLabel(slot) {
    const empty = selected === slot;
    slot.button.classList.toggle('empty', empty); slot.button.dataset.empty = String(empty);
    slot.button.setAttribute('aria-pressed', String(empty)); slot.button.disabled = !slot.mount || phase === 'taking' || phase === 'returning';
    slot.tag.textContent = empty ? '已取下 · 空位保留' : slot.failed ? '暂未加载' : slot.mount ? (slot.entry.figure || slot.entry.family || '点击取下') : '正在准备…';
    slot.button.setAttribute('aria-label', empty ? `${slot.entry.name}已取下，原位留空` : slot.mount ? `取下${slot.entry.name}` : `正在准备${slot.entry.name}`);
  }
  function updateLabels() { for (const slot of slots.values()) updateSlotLabel(slot); }

  async function loadModels(token) {
    for (const description of ordered) {
      if (!active || token !== generation) return;
      const slot = slots.get(description.entry.id), definition = definitions[description.entry.id];
      let source = null, copy = null;
      try {
        if (!definition?.build) throw new Error('该模型尚未注册');
        await definition.load?.();
        if (!active || token !== generation) return;
        source = await definition.build();
        if (!active || token !== generation) return;
        copy = makeDisplayCopy(source, slot.entry.id);
        const bounds = new THREE.Box3().setFromObject(copy), center = bounds.getCenter(new THREE.Vector3());
        const unit = 1 / Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
        copy.position.copy(center).negate().multiplyScalar(unit); copy.scale.setScalar(unit); copy.updateMatrixWorld(true);
        const normalized = new THREE.Box3().setFromObject(copy), rotated = normalized.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(SHELF_ROTATION));
        const size = rotated.getSize(new THREE.Vector3());
        const shelfScale = Math.min(3.48 / size.x, 2.53 / size.y, 1.96 / size.z);
        const localHome = new THREE.Vector3(slot.x, slot.shelfY + 0.075 - rotated.min.y * shelfScale, 0.44);
        const home = { position: localHome.applyMatrix4(slot.wall.matrix), scale: shelfScale,
          quaternion: slot.wall.quaternion.clone().multiply(SHELF_ROTATION) };
        const mount = new THREE.Group(); mount.name = `gallery-mount:${slot.entry.id}`; mount.add(copy); copy = null;
        setPose(mount, home); scene.add(mount);
        slot.mount = mount; slot.home = home; slot.displayBounds = normalized; slot.sourceCenter = center; slot.sourceUnit = unit; readyCount++;
        if (phase === 'loading') phase = 'wall';
        updateSlotLabel(slot); if (backdropAmount) fadeBackdrop(backdropAmount); markDirty(); notify();
      } catch (error) {
        if (active && token === generation) {
          slot.failed = true; updateSlotLabel(slot); markDirty(); fail(new Error(`${slot.entry.name}暂未放入陈列柜：${error.message || error}`), slot.entry);
        }
      } finally { if (source) disposeGalleryTree(source); if (copy) disposeGalleryTree(copy); }
      // Yield so each completed object can be seen before the next build starts.
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    if (active && token === generation && phase === 'loading') { phase = 'wall'; notify(); }
  }

  function animateSlot(slot, to, nextPhase) {
    cancelMotion();
    return new Promise(resolve => {
      motion = { slot, from: pose(slot.mount), to, start: now(), duration: reduced ? 0 : 820, nextPhase, resolve, token: generation };
      markDirty();
    });
  }
  async function take(id) {
    if (!active || disposed || !entryMap.has(id) || ['taking', 'returning'].includes(phase)) return false;
    if (selected?.entry.id === id) return phase === 'holding';
    const slot = slots.get(id); if (!slot?.mount) return false;
    const token = generation;
    if (selected && !await putBack()) return false;
    if (!active || token !== generation) return false;
    cameraMotion = null; selected = slot; zoom = 1; phase = 'taking'; updateLabels(); notify();
    if (!active || token !== generation) return false;
    const completed = await animateSlot(slot, heldPose(slot), 'holding');
    if (completed && active && token === generation && selected === slot) {
      // A final synchronous render and frozen input make this the same visible
      // pose that the receiving renderer will use, even during an async load.
      scene.updateMatrixWorld(true); renderer.render(scene, camera);
      const handoff = captureHeldHandoff(slot), sequence = ++handoffSequence;
      const result = onSelect(slot.entry, handoff);
      if (result?.then) {
        handoffPending = true; pendingHandoff = handoff; pointers.clear(); pinchDistance = 0;
        Promise.resolve(result).catch(error => { if (active && token === generation) fail(error, slot.entry); })
          .finally(() => { if (token === generation && sequence === handoffSequence) { handoffPending = false; pendingHandoff = null; } });
      }
    }
    return completed;
  }
  async function putBack() {
    if (!active || !selected || phase !== 'holding') return false;
    setInspectionActive(false);
    const slot = selected; phase = 'returning'; updateLabels(); notify();
    if (!active) return false;
    return animateSlot(slot, slot.home, 'wall');
  }
  function resetHeld() {
    if (!active || inspectionActive || handoffPending || phase !== 'holding' || !selected) return false;
    zoom = 1; setPose(selected.mount, heldPose(selected)); markDirty(); return true;
  }
  function zoomHeld(factor) {
    if (!active || inspectionActive || handoffPending || phase !== 'holding' || !selected || !Number.isFinite(factor) || factor <= 0) return false;
    zoom = clamp(zoom * factor, 0.45, 2.5);
    const next = heldPose(selected, selected.mount.quaternion); selected.mount.position.copy(next.position); selected.mount.scale.setScalar(next.scale); markDirty(); return true;
  }
  function setInspectionActive(value) {
    if (value && (!active || !selected || phase !== 'holding')) return false;
    inspectionActive = Boolean(value);
    handoffPending = false; pendingHandoff = null; handoffSequence++;
    if (selected?.mount) selected.mount.visible = !inspectionActive;
    // The workbench renders the real solid and projection planes in this area.
    // Keep its background clean; retain the cabinet only for the return motion.
    if (scene) scene.visible = !inspectionActive;
    pointers.clear(); pinchDistance = 0; markDirty(); return true;
  }
  async function focusWall(nextCategory = 'all') {
    if (!active || ['taking', 'returning'].includes(phase)) return false;
    const token = generation;
    if (selected && !await putBack()) return false;
    if (!active || token !== generation) return false;
    category = categoryOrAll(nextCategory);
    const next = frameRoomWall(layout, category, camera.aspect, camera.fov);
    cameraMotion = { from: { position: camera.position.clone(), target: cameraTarget.clone() }, to: next, start: now(), duration: reduced ? 0 : 650 };
    markDirty(); notify(); return true;
  }

  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects([...slots.values()].filter(slot => slot.mount).map(slot => slot.mount), true)[0]?.object.userData.galleryModelId || null;
  }
  function releasePointer(event, cancelled = false) {
    const start = pointers.get(event.pointerId);
    const clicked = !cancelled && start && !start.multi && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 6;
    pointers.delete(event.pointerId); pinchDistance = 0;
    if (renderer?.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (clicked && !selected && active) { const id = hit(event); if (id) void take(id); }
  }
  function bindInput() {
    const canvas = renderer.domElement;
    listen(canvas, 'pointerdown', event => {
      if (inspectionActive || handoffPending) return;
      if (event.button !== undefined && event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, multi: pointers.size > 0 });
      if (pointers.size > 1) for (const value of pointers.values()) value.multi = true;
      canvas.setPointerCapture?.(event.pointerId);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    listen(canvas, 'pointermove', event => {
      if (inspectionActive || handoffPending) return;
      const point = pointers.get(event.pointerId); if (!point) return;
      const dx = event.clientX - point.x, dy = event.clientY - point.y; point.x = event.clientX; point.y = event.clientY;
      if (!selected || phase !== 'holding') return;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0 && distance > 0) zoomHeld(distance / pinchDistance); pinchDistance = distance; return;
      }
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      selected.mount.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, dx * 0.008));
      selected.mount.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.008)); markDirty();
    });
    listen(canvas, 'pointerup', event => releasePointer(event));
    listen(canvas, 'pointercancel', event => releasePointer(event, true));
    listen(canvas, 'lostpointercapture', event => { pointers.delete(event.pointerId); pinchDistance = 0; });
    listen(canvas, 'wheel', event => { if (inspectionActive || handoffPending || phase !== 'holding') return; event.preventDefault(); zoomHeld(Math.exp(-clamp(event.deltaY, -300, 300) * 0.0015)); }, { passive: false });
    listen(canvas, 'webglcontextlost', event => { event.preventDefault(); close(); fail(new Error('三维陈列暂时中断，请重新打开模型墙。')); });
  }

  function tick(time) {
    frameId = null; if (!active || !renderer) return;
    const token = generation;
    if (cameraMotion) {
      const current = cameraMotion, t = current.duration ? clamp((time - current.start) / current.duration, 0, 1) : 1, eased = t * t * (3 - 2 * t);
      camera.position.lerpVectors(current.from.position, current.to.position, eased); cameraTarget.lerpVectors(current.from.target, current.to.target, eased);
      camera.lookAt(cameraTarget); camera.near = current.to.near; camera.far = current.to.far; camera.updateProjectionMatrix();
      if (t === 1) cameraMotion = null; dirty = true;
    }
    if (motion) {
      const current = motion, t = current.duration ? clamp((time - current.start) / current.duration, 0, 1) : 1;
      setPose(current.slot.mount, sampleTakePose(current.from, current.to, t)); dirty = true;
      const eased = t * t * (3 - 2 * t);
      fadeBackdrop(current.nextPhase === 'holding' ? eased : 1 - eased);
      if (t === 1) {
        motion = null; phase = current.nextPhase;
        if (phase === 'wall') { selected = null; zoom = 1; }
        updateLabels(); notify(); current.resolve(active && current.token === generation);
      }
    }
    if (!active || !renderer || token !== generation) return;
    if (dirty) {
      renderer.domElement.style.cursor = phase === 'holding' ? 'grab' : 'default';
      scene.updateMatrixWorld(true); renderer.render(scene, camera); refreshPendingHandoff(); placeLabels(); dirty = false;
    }
    frameId = requestFrame(tick);
  }
  function open(initialCategory = 'all') {
    if (disposed) return false;
    if (active) { void focusWall(initialCategory); return true; }
    active = true; generation++; category = categoryOrAll(initialCategory); phase = 'loading'; readyCount = 0;
    const token = generation;
    try {
      renderer = rendererFactory(); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = false; renderer.domElement.className = 'model-gallery-room-canvas';
      renderer.domElement.setAttribute('role', 'img'); renderer.domElement.setAttribute('aria-label', '三维陈列柜；点击模型取下，取下后可旋转、缩放及查看三视图');
      Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' });
      host.append(renderer.domElement);
      labels = document.createElement('div'); labels.className = 'model-gallery-room-labels';
      Object.assign(labels.style, { position: 'absolute', inset: 'auto', width: '1px', height: '1px', padding: '0', margin: '-1px',
        border: '0', clip: 'rect(0, 0, 0, 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap', pointerEvents: 'none', overflow: 'hidden' }); host.append(labels);
      scene = new THREE.Scene(); scene.background = new THREE.Color('#e2e7df');
      scene.add(new THREE.HemisphereLight('#fff9ed', '#829382', 2.1));
      const sun = new THREE.DirectionalLight('#fff3dd', 2.7); sun.position.set(-12, 18, 20); scene.add(sun);
      const fill = new THREE.DirectionalLight('#e0eeff', 1.0); fill.position.set(15, 8, 12); scene.add(fill);
      camera = new THREE.PerspectiveCamera(38, 1.5, 0.1, 300); buildCabinets(); bindInput(); resize();
      if (ResizeObserverClass) { observer = new ResizeObserverClass(resize); observer.observe(host); }
      listen(window, 'resize', resize);
      if (media?.addEventListener) listen(media, 'change', event => { reduced = event.matches; if (reduced) { if (motion) motion.duration = 0; if (cameraMotion) cameraMotion.duration = 0; } });
      notify(); if (!active || token !== generation) return false;
      frameId = requestFrame(tick);
      loadQueue = loadQueue.catch(() => {}).then(() => loadModels(token)).catch(error => { if (active && token === generation) fail(error); });
      return true;
    } catch (error) { close(); fail(new Error(`无法打开三维陈列柜：${error.message || error}`)); return false; }
  }
  function close() {
    if (!active && !renderer && !scene) return;
    active = false; generation++; cancelMotion(); cameraMotion = null;
    if (frameId !== null) cancelFrame(frameId); frameId = null;
    observer?.disconnect(); observer = null; listeners.splice(0).forEach(remove => remove());
    pointers.clear(); pinchDistance = 0;
    if (scene) { disposeGalleryTree(scene); scene.clear(); scene = null; }
    ownedTextures.forEach(texture => texture.dispose()); ownedTextures.clear();
    labels?.remove(); labels = null;
    if (renderer) { renderer.domElement.remove(); renderer.renderLists?.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; }
    camera = null; inspectionActive = false; handoffPending = false; pendingHandoff = null; handoffSequence++;
    slots.clear(); wallTitles.length = 0; originalColors.clear(); backdropAmount = 0;
    selected = null; readyCount = 0; phase = 'wall'; zoom = 1; notify();
  }
  function dispose() { disposed = true; close(); }
  return { open, close, focusWall, take, putBack, resetHeld, zoomHeld, setInspectionActive, dispose, getState };
}
