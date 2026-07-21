import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getModelExtension,
  isStepExtension,
  occtResultToTriangleSoup,
  STEP_IMPORT_OPTIONS,
  SUPPORTED_MODEL_EXTENSIONS
} from '../model-import.js';

test('model extension detection includes STEP aliases', () => {
  assert.equal(getModelExtension('bearing-block.STEP'), 'step');
  assert.equal(getModelExtension('part.stp?download=1'), 'stp');
  assert.equal(isStepExtension('STEP'), true);
  assert.equal(SUPPORTED_MODEL_EXTENSIONS.includes('step'), true);
  assert.equal(STEP_IMPORT_OPTIONS.linearUnit, 'millimeter');
});

test('OCCT indexed meshes become non-indexed triangle data', () => {
  const result = occtResultToTriangleSoup({
    success: true,
    meshes: [{
      attributes: {
        position: { array: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
        normal: { array: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] }
      },
      index: { array: [[0, 1, 2]] }
    }]
  });

  assert.equal(result.meshCount, 1);
  assert.equal(result.triangleCount, 1);
  assert.deepEqual(Array.from(result.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(result.normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

test('OCCT conversion rejects failed and malformed results', () => {
  assert.throws(() => occtResultToTriangleSoup({ success: false }), /解析失败/);
  assert.throws(
    () => occtResultToTriangleSoup({
      success: true,
      meshes: [{
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
        index: { array: [0, 1, 9] }
      }]
    }),
    /无效的顶点索引/
  );
});
