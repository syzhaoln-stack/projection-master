import opencascade from 'replicad-opencascadejs/src/replicad_single.js';
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url';
import { setOC } from 'replicad';
import { auditTextbookMechanicalShape } from './textbook-mechanical-geometry.js';

let ready;
function initialize() {
  ready ||= opencascade({ locateFile: () => opencascadeWasm }).then(setOC).catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

self.addEventListener('message', async ({ data }) => {
  const { id, modelId } = data || {};
  try {
    await initialize();
    self.postMessage({ id, type: 'result', result: auditTextbookMechanicalShape(modelId) });
  } catch {
    self.postMessage({ id, type: 'error' });
  }
});
