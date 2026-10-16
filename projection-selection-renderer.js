import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { createDrawingStyle, DRAWING_PAPER_STYLE } from './drawing-style.js';

const HIGHLIGHT_COLOR = 0xc06d05;
const EXCLUDED_FLAGS = [
  'booleanTool', 'pickedPointMarker', 'selectionOverlay',
  'projectionSelectionOverlay', 'projectionGuide', 'compoundEdgeOverlay'
];
const VIEW_ORIENTATIONS = {
  front: { eye: [0, 0, 1], up: [0, 1, 0] },
  top: { eye: [0, 1, 0], up: [0, 0, -1] },
  side: { eye: [-1, 0, 0], up: [0, 1, 0] }
};

// The exact-kernel surface is deliberately excluded from the normal projection
// generator, but it must still occlude selection ink. Never use that flag here.
export function isSelectionOccluder(object) {
  if (!object?.isMesh || !object.geometry?.attributes?.position) return false;
  for (let current = object; current; current = current.parent) {
    if (!current.visible || EXCLUDED_FLAGS.some(flag => current.userData?.[flag])) return false;
  }
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some(material => material && material.visible !== false);
}

function collectModelMeshes(modelRoot) {
  const meshes = [];
  modelRoot?.updateWorldMatrix(true, true);
  modelRoot?.traverse(object => {
    if (isSelectionOccluder(object)) meshes.push(object);
  });
  return meshes;
}

function selectionParts(selection) {
  if (!selection?.object) return [];
  if (selection.geometry) return [selection];
  if (Array.isArray(selection.meshes)) {
    return selection.meshes.map(item => item.isMesh ? { object: item, geometry: item.geometry } : item);
  }
  const parts = [];
  selection.object.traverse(object => {
    if (isSelectionOccluder(object)) parts.push({ object, geometry: object.geometry });
  });
  return parts;
}

function useWorldTransform(display, source) {
  source.updateWorldMatrix(true, false);
  display.matrix.copy(source.matrixWorld);
  display.matrixAutoUpdate = false;
  display.frustumCulled = false;
  display.userData.projectionSelectionOverlay = true;
  return display;
}

function worldBounds(meshes) {
  const bounds = new THREE.Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  return bounds;
}

/** Builds an overlay without taking ownership of model/selection geometries. */
export function createSelectionOverlayScene({
  selection, modelRoot, camera, showHidden = true, width = 1024, height = 1024,
  visibleLineWidth, hiddenLineWidth, boldEdges = false
}) {
  const scene = new THREE.Scene();
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const meshes = collectModelMeshes(modelRoot);
  const extent = Math.max(worldBounds(meshes).getSize(new THREE.Vector3()).length(), 1);
  const paperSpan = camera?.isOrthographicCamera
    ? Math.max(camera.right - camera.left, camera.top - camera.bottom) / camera.zoom
    : extent * 1.24;
  const style = createDrawingStyle({
    boldEdges,
    pixelsPerPaperMm: Math.max(width, height) / DRAWING_PAPER_STYLE.previewPaperSpanMm,
    drawingUnitsPerPaperMm: paperSpan / DRAWING_PAPER_STYLE.previewPaperSpanMm
  });
  const selectedVisibleWidth = visibleLineWidth ?? style.visibleWidth;
  const selectedHiddenWidth = hiddenLineWidth ?? selectedVisibleWidth / 2;
  const depthMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR, transparent: true, opacity: 0.14,
    depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide, toneMapped: false
  });
  ownedMaterials.add(depthMaterial);
  ownedMaterials.add(fillMaterial);
  for (const object of meshes) {
    const depth = useWorldTransform(new THREE.Mesh(object.geometry, depthMaterial), object);
    depth.name = 'selection-occluder';
    depth.renderOrder = 0;
    scene.add(depth);
  }
  const lineMaterial = (hidden) => {
    const material = new LineMaterial({
      color: HIGHLIGHT_COLOR, linewidth: hidden ? selectedHiddenWidth : selectedVisibleWidth,
      worldUnits: false, dashed: hidden, dashSize: style.hiddenDash[0],
      gapSize: style.hiddenDash[1], transparent: true, opacity: hidden ? 0.85 : 1,
      depthWrite: false, depthTest: true,
      depthFunc: hidden ? THREE.GreaterDepth : THREE.LessEqualDepth,
      toneMapped: false, alphaToCoverage: false
    });
    material.resolution.set(width, height);
    ownedMaterials.add(material);
    return material;
  };
  const visibleMaterial = lineMaterial(false);
  const hiddenMaterial = showHidden ? lineMaterial(true) : null;
  for (const part of selectionParts(selection)) {
    if (!part.object || !part.geometry?.attributes?.position) continue;
    const fill = useWorldTransform(new THREE.Mesh(part.geometry, fillMaterial), part.object);
    fill.name = 'selection-visible-fill';
    fill.renderOrder = 1;
    scene.add(fill);
    const edgeGeometry = part.edgeGeometry || new THREE.EdgesGeometry(part.geometry, 24);
    if (!part.edgeGeometry) ownedGeometries.add(edgeGeometry);
    const positions = edgeGeometry.attributes.position;
    if (!positions?.count) continue;
    const values = [];
    const point = new THREE.Vector3();
    part.object.updateWorldMatrix(true, false);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(part.object.matrixWorld);
      values.push(point.x, point.y, point.z);
    }
    const thickGeometry = new LineSegmentsGeometry().setPositions(values);
    ownedGeometries.add(thickGeometry);
    const addLines = (material, hidden) => {
      // Distances must be in projection-world units, even for scaled components.
      const lines = new LineSegments2(thickGeometry, material);
      lines.frustumCulled = false;
      lines.userData.projectionSelectionOverlay = true;
      lines.name = hidden ? 'selection-hidden-edges' : 'selection-visible-edges';
      lines.renderOrder = hidden ? 2 : 3;
      if (hidden) lines.computeLineDistances();
      scene.add(lines);
    };
    if (hiddenMaterial) addLines(hiddenMaterial, true);
    addLines(visibleMaterial, false);
  }
  return {
    scene,
    dispose() {
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      scene.clear();
    }
  };
}

/** Keeps the caller's camera, color image, viewport and renderer settings. */
export function renderSelectionOverlay({
  renderer, camera, target, selection, modelRoot, showHidden = true,
  width = target?.width || 1024, height = target?.height || 1024,
  clear = false, visibleLineWidth, hiddenLineWidth, boldEdges = false
}) {
  if (!selection?.object || !modelRoot || !renderer || !camera) return false;
  const overlay = createSelectionOverlayScene({
    selection, modelRoot, camera, showHidden, width, height, visibleLineWidth, hiddenLineWidth, boldEdges
  });
  const previous = {
    target: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace?.() || 0,
    mipLevel: renderer.getActiveMipmapLevel?.() || 0,
    viewport: renderer.getViewport(new THREE.Vector4()),
    scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr?.enabled
  };
  try {
    if (renderer.xr) renderer.xr.enabled = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(target || null);
    // RenderTarget.viewport is already in physical pixels. Three r160's
    // setViewport multiplies by DPR even when a target is bound, so calling it
    // here would enlarge/offset the overlay on high-density displays.
    if (!target) {
      const pixelRatio = renderer.getPixelRatio?.() || 1;
      renderer.setViewport(0, 0, width / pixelRatio, height / pixelRatio);
    }
    renderer.setScissorTest(false);
    if (clear) {
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
    } else {
      // Rebuild depth from complete visible geometry, including exact BRep
      // surfaces that the black HLR line drawing does not need to render.
      renderer.clearDepth();
    }
    renderer.render(overlay.scene, camera);
    return true;
  } finally {
    // Restore the default framebuffer's CSS-pixel state first. Binding the old
    // target last restores its physical-pixel viewport/scissor without DPR.
    renderer.setViewport(previous.viewport);
    renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest);
    renderer.setRenderTarget(previous.target, previous.cubeFace, previous.mipLevel);
    renderer.setClearColor(previous.clearColor, previous.clearAlpha);
    renderer.autoClear = previous.autoClear;
    if (renderer.xr) renderer.xr.enabled = previous.xrEnabled;
    overlay.dispose();
  }
}

/** Orthographic frame exactly matching the kernel's SVG viewBox, in mm. */
export function createExactSelectionCamera({ view, frame, modelRoot }) {
  const key = view === 'right' || view === 'left' ? 'side' : view;
  const orientation = VIEW_ORIENTATIONS[key];
  if (!orientation || !Array.isArray(frame) || frame.length !== 4
    || !frame.every(Number.isFinite) || frame[2] <= 0 || frame[3] <= 0) {
    throw new Error('Selection projection requires a valid exact HLR view and frame.');
  }
  const [x, y, width, height] = frame;
  const bounds = worldBounds(collectModelMeshes(modelRoot));
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const horizontal = (x + width / 2) * 0.1;
  const vertical = -(y + height / 2) * 0.1;
  if (key === 'front') center.set(horizontal, vertical, center.z);
  if (key === 'side') center.set(center.x, vertical, horizontal);
  // Replicad's `bottom` HLR plane gives SVG Y = -kernel Y = scene Z * 10.
  if (key === 'top') center.set(horizontal, center.y, -vertical);
  const size = bounds.isEmpty() ? 1 : bounds.getSize(new THREE.Vector3()).length();
  const distance = Math.max(size, width * 0.1, height * 0.1, 1) * 2 + 1;
  const camera = new THREE.OrthographicCamera(
    -width * 0.05, width * 0.05, height * 0.05, -height * 0.05,
    0.001, distance * 3
  );
  camera.up.fromArray(orientation.up);
  camera.position.copy(center).addScaledVector(new THREE.Vector3().fromArray(orientation.eye), distance);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/** Transparent selection PNG, composited above the unmodified exact SVG. */
export function renderSelectionDataUrl({
  renderer, camera, selection, modelRoot, showHidden = true, frame,
  width, height, maxResolution = 1024, boldEdges = false, visibleLineWidth, hiddenLineWidth
}) {
  if (!selection?.object || typeof document === 'undefined') return '';
  const frameWidth = frame?.[2] || camera.right - camera.left;
  const frameHeight = frame?.[3] || camera.top - camera.bottom;
  const longest = Math.max(frameWidth, frameHeight);
  const outputWidth = width || Math.max(1, Math.round(maxResolution * frameWidth / longest));
  const outputHeight = height || Math.max(1, Math.round(maxResolution * frameHeight / longest));
  const target = new THREE.WebGLRenderTarget(outputWidth, outputHeight, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  try {
    renderSelectionOverlay({
      renderer, camera, target, selection, modelRoot, showHidden,
      width: outputWidth, height: outputHeight, clear: true, boldEdges, visibleLineWidth, hiddenLineWidth
    });
    const pixels = new Uint8Array(outputWidth * outputHeight * 4);
    renderer.readRenderTargetPixels(target, 0, 0, outputWidth, outputHeight, pixels);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    const image = context.createImageData(outputWidth, outputHeight);
    const rowLength = outputWidth * 4;
    for (let row = 0; row < outputHeight; row++) {
      const sourceOffset = (outputHeight - row - 1) * rowLength;
      image.data.set(pixels.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
    }
    // Normal alpha blending over transparent WebGL targets stores premultiplied
    // RGB; ImageData expects straight RGB. Avoid dark fringes when SVG blends it.
    for (let i = 0; i < image.data.length; i += 4) {
      const alpha = image.data[i + 3];
      if (alpha > 0 && alpha < 255) {
        image.data[i] = Math.min(255, Math.round(image.data[i] * 255 / alpha));
        image.data[i + 1] = Math.min(255, Math.round(image.data[i + 1] * 255 / alpha));
        image.data[i + 2] = Math.min(255, Math.round(image.data[i + 2] * 255 / alpha));
      }
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    target.dispose();
  }
}
