let worker = null;
let nextRequestId = 1;
const requests = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./replicad-kernel-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', event => {
    const message = event.data || {};
    const request = requests.get(message.id);
    if (!request) return;
    if (message.type === 'progress') {
      request.onProgress?.(message.stage);
      return;
    }
    requests.delete(message.id);
    clearTimeout(request.timeout);
    if (message.type === 'result') request.resolve(message.result);
    else request.reject(new Error(message.error || 'Exact CAD kernel failed.'));
  });
  worker.addEventListener('error', event => {
    const error = new Error(event.message || 'Exact CAD kernel worker crashed.');
    requests.forEach(request => {
      clearTimeout(request.timeout);
      request.reject(error);
    });
    requests.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function auditLessonWithExactKernel({
  lessonId,
  slotLength = 50,
  appliedCutters = [],
  visibleComponents = [],
  cutterValues = {},
  onProgress
} = {}) {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      requests.delete(id);
      reject(new Error('精确CAD内核校核超时。'));
    }, 90000);
    requests.set(id, { resolve, reject, onProgress, timeout });
    getWorker().postMessage({
      id,
      action: 'audit-lesson',
      payload: { lessonId, slotLength, appliedCutters, visibleComponents, cutterValues }
    });
  });
}

export function auditExample55WithExactKernel(options = {}) {
  return auditLessonWithExactKernel({ ...options, lessonId: 'example-5-5' });
}
