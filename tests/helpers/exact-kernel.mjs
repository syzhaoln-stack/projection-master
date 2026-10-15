import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as replicad from 'replicad';

// Run the production worker with the installed WASM, without Vite or a browser.
// Only its asset imports and message transport are replaced by the test harness.
export async function loadExactKernel() {
  const moduleUrl = new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.js', import.meta.url);
  const wasmBinary = await readFile(new URL('./replicad_single.wasm', moduleUrl));
  const loader = await readFile(moduleUrl, 'utf8');
  const opencascade = vm.runInNewContext(loader.replace('export default Module;', 'Module;'), {
    require: createRequire(import.meta.url),
    __dirname: fileURLToPath(new URL('.', moduleUrl)),
    process, console, setTimeout, clearTimeout, TextDecoder, WebAssembly, performance
  });
  const OC = await opencascade({ wasmBinary });
  replicad.setOC(OC);
  let worker = await readFile(new URL('../../replicad-kernel-worker.js', import.meta.url), 'utf8');
  worker = worker.replace(/^import opencascade[^\n]*\n/gm, '')
    .replace(/import \{[\s\S]*?\} from 'replicad';/, '');
  return vm.runInNewContext(`${worker}\n({ buildExample51, buildExample55, buildExample56, auditLesson, commonFacts, addLessonChecks, projection, textbookProjectionFrame, TEXTBOOK_PROJECTION_CAMERAS, TEXTBOOK_PROJECTION_HORIZONTAL_MIRRORS });`, {
    ...replicad, console, self: { addEventListener() {} }
  });
}
