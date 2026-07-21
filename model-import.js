export const SUPPORTED_MODEL_EXTENSIONS = Object.freeze([
  'obj', 'stl', 'glb', 'gltf', 'step', 'stp'
]);

export const STEP_IMPORT_OPTIONS = Object.freeze({
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5
});

export function getModelExtension(name = '') {
  const clean = String(name).split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

export function isStepExtension(extension) {
  const ext = String(extension || '').toLowerCase();
  return ext === 'step' || ext === 'stp';
}

function flattenNumbers(value, output = []) {
  if (value == null) return output;
  if (ArrayBuffer.isView(value)) {
    for (const item of value) output.push(Number(item));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenNumbers(item, output);
    return output;
  }
  output.push(Number(value));
  return output;
}

/**
 * Convert occt-import-js output to non-indexed triangle data.
 * Keeping this conversion independent from Three.js makes it easy to test.
 */
export function occtResultToTriangleSoup(result) {
  if (!result?.success) throw new Error('STEP 文件解析失败。');
  if (!Array.isArray(result.meshes) || result.meshes.length === 0) {
    throw new Error('STEP 文件中没有可显示的实体网格。');
  }

  const positions = [];
  const normals = [];
  let normalsComplete = true;
  let meshCount = 0;

  for (const mesh of result.meshes) {
    const sourcePositions = flattenNumbers(mesh?.attributes?.position?.array);
    if (!sourcePositions.length || sourcePositions.length % 3 !== 0) continue;

    const sourceNormals = flattenNumbers(mesh?.attributes?.normal?.array);
    const hasNormals = sourceNormals.length === sourcePositions.length;
    const sourceIndices = flattenNumbers(mesh?.index?.array);
    const vertexCount = sourcePositions.length / 3;
    const indices = sourceIndices.length
      ? sourceIndices
      : Array.from({ length: vertexCount }, (_, index) => index);

    for (const rawIndex of indices) {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new Error('STEP 网格包含无效的顶点索引。');
      }
      const offset = index * 3;
      positions.push(
        sourcePositions[offset],
        sourcePositions[offset + 1],
        sourcePositions[offset + 2]
      );
      if (hasNormals) {
        normals.push(
          sourceNormals[offset],
          sourceNormals[offset + 1],
          sourceNormals[offset + 2]
        );
      } else {
        normalsComplete = false;
      }
    }
    meshCount += 1;
  }

  if (!positions.length || positions.length % 9 !== 0) {
    throw new Error('STEP 文件未生成有效的三角网格。');
  }

  return {
    positions: new Float32Array(positions),
    normals: normalsComplete && normals.length === positions.length
      ? new Float32Array(normals)
      : null,
    meshCount,
    triangleCount: positions.length / 9
  };
}
