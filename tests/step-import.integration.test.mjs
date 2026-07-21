import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import occtImport from 'occt-import-js';

import {
  occtResultToTriangleSoup,
  STEP_IMPORT_OPTIONS
} from '../model-import.js';

test('generated bearing block STEP is parsed into displayable triangles', { timeout: 30_000 }, async () => {
  const [occt, file] = await Promise.all([
    occtImport(),
    readFile(new URL('../assets/step_bearing_block.step', import.meta.url))
  ]);
  const parsed = occt.ReadStepFile(file, { ...STEP_IMPORT_OPTIONS });
  const geometry = occtResultToTriangleSoup(parsed);

  assert.equal(parsed.success, true);
  assert.ok(geometry.meshCount >= 1);
  assert.ok(geometry.triangleCount > 100);
  assert.equal(geometry.positions.length, geometry.triangleCount * 9);
});
