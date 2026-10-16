let worker;
let nextId = 0;
const requests = new Map();

function rejectPending(error) {
  for (const pending of requests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  requests.clear();
  worker?.terminate();
  worker = null;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./textbook-mechanical-kernel-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', ({ data }) => {
    const pending = requests.get(data?.id);
    if (!pending) return;
    requests.delete(data.id);
    clearTimeout(pending.timeout);
    if (data.type === 'result') pending.resolve(data.result);
    else pending.reject(new Error('教材模型精确构建失败，请重新选择模型。'));
  });
  worker.addEventListener('error', () => rejectPending(new Error('教材模型内核加载失败，请刷新重试。')));
  return worker;
}

export function auditTextbookMechanicalModel(modelId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      requests.delete(id);
      reject(new Error('教材模型构建超时，请重新选择模型。'));
    }, 90000);
    requests.set(id, { resolve, reject, timeout });
    try {
      getWorker().postMessage({ id, modelId });
    } catch (error) {
      clearTimeout(timeout);
      requests.delete(id);
      reject(error);
    }
  });
}
