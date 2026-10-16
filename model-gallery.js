import { createGalleryRoom } from './model-gallery-room.js';

export function createGalleryEntries(mechanical, bridges, drawings) {
  return [
    ...mechanical.map(item => ({ ...item, category: 'mechanical', kind: 'textbook',
      sourceCaption: `《现代机械制图》第${item.chapter}章 · ${item.figure} · 第${item.page}页` })),
    ...bridges.map(item => ({ ...item, category: 'bridge', kind: 'teaching', sourceCaption: '桥梁工程 · 典型结构教学模型' })),
    ...drawings.map(item => ({ ...item, category: 'bridge', kind: 'drawing', sourceCaption: '桥梁工程 · 教材图纸重构' }))
  ];
}

export function createModelGallery({ entries, definitions, onInspect, onLeaveInspect = () => {},
  onSetView = mode => mode, onZoom = () => {}, onReset = () => {}, document = globalThis.document, roomFactory = createGalleryRoom }) {
  const mechanical = entries.filter(entry => entry.category === 'mechanical');
  const entryMap = new Map(mechanical.map(entry => [entry.id, entry]));
  const root = document.createElement('div'); root.className = 'model-gallery'; root.hidden = true;
  root.innerHTML = `
    <section class="model-gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="model-gallery-title">
      <header class="model-gallery-header"><h2 id="model-gallery-title" data-gallery="title">机械模型柜</h2><button type="button" class="model-gallery-close" data-gallery="close">返回工作台 <span aria-hidden="true">×</span></button></header>
      <div class="model-gallery-stage" data-gallery="stage">
        <div class="model-gallery-room" data-gallery="room" aria-label="机械模型陈列柜"></div>
        <div class="model-gallery-inspection" data-gallery="display-host" tabindex="-1" hidden aria-label="取下的模型与可展开三视图"></div>
        <p class="model-gallery-status" data-gallery="status" role="status" aria-live="polite" hidden></p>
      </div>
      <div class="model-gallery-controls" data-gallery="controls" hidden aria-label="模型与三视图操作">
        <button type="button" class="model-gallery-return" data-gallery="put-back">↗ 放回柜子</button>
        <div class="model-gallery-views" role="group" aria-label="显示模型与三视图"><button type="button" data-gallery="view-solid" aria-pressed="false">只看实体</button><button type="button" data-gallery="view-wrapped" aria-pressed="true">环绕三视图</button><button type="button" data-gallery="view-unfolded" aria-pressed="false">展开三视图</button></div>
        <div class="model-gallery-zoom" role="group" aria-label="缩放模型"><button type="button" data-gallery="zoom-out" aria-label="缩小模型">− <span>缩小</span></button><button type="button" data-gallery="zoom-in" aria-label="放大模型">＋ <span>放大</span></button><button type="button" data-gallery="reset" class="model-gallery-fit">适合画面</button></div>
      </div>
    </section>`;
  document.body.append(root);
  const find = key => root.querySelector(`[data-gallery="${key}"]`);
  const host = find('room'), displayHost = find('display-host'), stage = find('stage'), status = find('status');
  let room = null, phase = 'closed', selectedId = null, previousFocus = null;
  let session = 0, inspectRequest = 0, inspectionActive = false, inspectAttempt = false, inspectorAbort = null;
  const viewModes = ['solid', 'wrapped', 'unfolded'];
  let returning = false, disposed = false, viewMode = 'wrapped', viewRequest = 0, leavePromise = Promise.resolve();

  function message(value = '') { status.textContent = value; status.hidden = !value; }
  function refresh() {
    const selected = entryMap.get(selectedId);
    find('title').textContent = selected?.name || '机械模型柜';
    find('controls').hidden = !selected || !['taking', 'holding', 'returning'].includes(phase);
    find('put-back').disabled = phase !== 'holding' || returning;
    for (const key of [...viewModes.map(mode => `view-${mode}`), 'zoom-out', 'zoom-in', 'reset']) find(key).disabled = !inspectionActive || returning;
    for (const mode of viewModes) find(`view-${mode}`).setAttribute('aria-pressed', String(viewMode === mode));
    root.setAttribute('aria-busy', String(returning || phase === 'taking' || (phase === 'holding' && inspectAttempt && !inspectionActive)));
  }
  function hideInspection() {
    displayHost.hidden = true; displayHost.style.visibility = ''; displayHost.style.pointerEvents = '';
    stage.classList.remove('is-inspecting'); inspectionActive = false; viewRequest++;
  }
  function leaveInspection() {
    inspectorAbort?.abort(); inspectorAbort = null; inspectRequest++; hideInspection();
    // A pending or active main-scene inspection gets exactly one restore.
    // New inspections await this chain so an older restore cannot move their canvas.
    if (!inspectAttempt) return leavePromise;
    inspectAttempt = false; const started = session;
    leavePromise = leavePromise.catch(() => {}).then(() => onLeaveInspect({ apply: false })).catch(() => {
      if (!root.hidden && started === session) message('观察区未能恢复，请返回工作台后重试。');
    });
    return leavePromise;
  }
  async function inspect(entry, handoff) {
    const started = session, job = ++inspectRequest;
    await leavePromise;
    if (root.hidden || started !== session || job !== inspectRequest || selectedId !== entry.id || phase !== 'holding') return false;
    inspectorAbort = new AbortController(); const signal = inspectorAbort.signal;
    inspectAttempt = true; refresh(); message('正在准备观察区…');
    try {
      if (typeof onInspect !== 'function') throw new Error('三视图观察区尚未就绪');
      // Keep a measurable host for the main camera's initial framing while its
      // first render is still hidden. display:none would incorrectly fit 1×1.
      displayHost.hidden = false; displayHost.style.visibility = 'hidden'; displayHost.style.pointerEvents = 'none';
      // The room's final model/camera pose belongs to this take operation.
      // Keep it intact so the workbench can match the first visible frame.
      const result = await onInspect({ id: entry.id, host: displayHost, signal, handoff });
      if (signal.aborted || root.hidden || started !== session || job !== inspectRequest || phase !== 'holding') return false;
      if (result === false) throw new Error('三视图暂时未能载入');
      viewMode = viewModes.includes(result?.viewMode) ? result.viewMode : 'wrapped';
      room?.setInspectionActive?.(true); displayHost.hidden = false; displayHost.style.visibility = ''; displayHost.style.pointerEvents = '';
      stage.classList.add('is-inspecting'); inspectionActive = true;
      refresh(); message(); displayHost.focus(); return true;
    } catch {
      if (signal.aborted || started !== session || job !== inspectRequest || root.hidden) return false;
      await leaveInspection();
      if (started === session && !root.hidden) {
        room?.setInspectionActive?.(false); message('模型暂时未能载入，请放回后重新取下。'); refresh();
      }
      return false;
    }
  }
  function buildRoom() {
    if (room) return room;
    room = roomFactory({ host, entries: mechanical, definitions,
      onSelect(entry, handoff) {
        if (root.hidden || !entryMap.has(entry?.id)) return;
        selectedId = entry.id; phase = 'holding'; refresh(); return inspect(entry, handoff);
      },
      onStateChange(state) {
        if (root.hidden) return;
        phase = state.phase; selectedId = state.selectedId || null;
        if (phase === 'taking' || phase === 'returning') hideInspection();
        if (phase === 'wall' || phase === 'loading') message(state.readyCount < mechanical.length ? `正在布置模型 ${state.readyCount} / ${mechanical.length}…` : '');
        refresh();
      },
      onError(error) { if (!root.hidden) message(error?.message || '模型暂时未能载入，请重试。'); }
    });
    return room;
  }
  async function close() {
    if (root.hidden) return leavePromise;
    session++; root.hidden = true; phase = 'closed'; selectedId = null; returning = false;
    const restored = leaveInspection(); room?.close(); previousFocus?.focus?.(); await restored;
  }
  function open(_category = 'mechanical', trigger = document.activeElement) {
    if (disposed || !root.hidden) return;
    session++; previousFocus = trigger; selectedId = null; phase = 'loading'; returning = false; viewMode = 'wrapped';
    root.hidden = false; hideInspection(); refresh(); message('正在布置模型…');
    try { buildRoom().open('mechanical'); }
    catch { message('模型柜暂时无法打开，请重试。'); }
    find('close').focus();
  }
  async function putBack() {
    if (root.hidden || returning || phase !== 'holding') return false;
    const started = session, id = selectedId; returning = true; refresh();
    await leaveInspection();
    if (started !== session || root.hidden) return false;
    room?.setInspectionActive?.(false);
    try {
      const returned = await room.putBack();
      if (started !== session || root.hidden) return false;
      if (returned !== false) {
        const label = [...host.querySelectorAll('button')].find(button => button.dataset.model === id || button.dataset.modelId === id);
        (label || find('close')).focus(); message();
      }
      return returned !== false;
    } catch { if (started === session && !root.hidden) message('模型暂时未能归位，请返回工作台。'); return false; }
    finally { if (started === session) { returning = false; refresh(); } }
  }
  async function take(id) {
    if (root.hidden || returning || ['taking', 'returning'].includes(phase) || !entryMap.has(id)) return false;
    if (phase === 'holding') { if (selectedId === id) return true; if (!await putBack()) return false; }
    if (root.hidden) return false;
    try { return await room.take(id) !== false; }
    catch { message('模型暂时未能取下，请重试。'); return false; }
  }
  async function setView(mode) {
    if (!inspectionActive || returning || root.hidden || !viewModes.includes(mode)) return;
    const started = session, job = ++viewRequest;
    try {
      const result = await onSetView(mode);
      if (started !== session || job !== viewRequest || !inspectionActive || root.hidden) return;
      viewMode = viewModes.includes(result) ? result : mode; refresh();
    } catch {
      if (started === session && job === viewRequest && inspectionActive && !root.hidden) message('视图暂时未能切换，请重试。');
    }
  }
  find('close').addEventListener('click', close); find('put-back').addEventListener('click', putBack);
  for (const mode of viewModes) find(`view-${mode}`).addEventListener('click', () => setView(mode));
  find('zoom-out').addEventListener('click', () => { if (inspectionActive && !returning) onZoom(0.84); });
  find('zoom-in').addEventListener('click', () => { if (inspectionActive && !returning) onZoom(1.19); });
  find('reset').addEventListener('click', () => { if (inspectionActive && !returning) onReset(); });
  const onKeyDown = event => {
    if (root.hidden) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (phase === 'holding') void putBack();
      else if (!['taking', 'returning'].includes(phase)) void close();
      return;
    }
    if (event.code === 'Space' && inspectionActive && !event.repeat && !event.target?.closest?.('button, input, textarea, select, [contenteditable="true"]')) {
      event.preventDefault(); void setView(viewMode === 'unfolded' ? 'wrapped' : 'unfolded');
    }
    if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll('button, input')].filter(element => !element.disabled && !element.closest('[hidden]'));
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  // Bridge quick access keeps opening the workbench's bridge list; only the
  // generic wall and mechanical shortcut enter this mechanical-only cabinet.
  const openers = [...document.querySelectorAll('[data-open-model-gallery], .quick-more')]
    .filter(button => !['bridge', 'bridge-asset'].includes(button.dataset.cat));
  const onOpen = event => open('mechanical', event.currentTarget);
  openers.forEach(button => { button.setAttribute('aria-haspopup', 'dialog'); button.addEventListener('click', onOpen); });
  const bridgeOpeners = [...document.querySelectorAll('.quick-more')].filter(button => ['bridge', 'bridge-asset'].includes(button.dataset.cat));
  const showBridgeDirectory = () => {
    document.getElementById('tree-panel')?.classList.add('open');
    document.getElementById('props-panel')?.classList.remove('open');
    document.querySelector('.tree-group-head[data-group="bridge"]')?.parentElement.classList.add('open');
    document.getElementById('bridge-library-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  bridgeOpeners.forEach(button => { button.textContent = '桥梁目录 ▾'; button.addEventListener('click', showBridgeDirectory); });
  return { open, close, refresh, take, putBack,
    async destroy() { disposed = true; await close(); room?.dispose(); document.removeEventListener('keydown', onKeyDown, true);
      openers.forEach(button => button.removeEventListener('click', onOpen));
      bridgeOpeners.forEach(button => button.removeEventListener('click', showBridgeDirectory)); root.remove(); }
  };
}
