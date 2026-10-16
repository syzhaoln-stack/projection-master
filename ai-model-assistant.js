import { AIEditError, DEEPSEEK_MODEL_LABEL, requestEditPlan, requestAiServiceStatus, validateEditPlan } from './ai-edit-protocol.js';
import './ai-model-assistant.css';

// Conversation is flexible. Only validated, reviewable changes reach the model.
// No response is evaluated as code or inserted as HTML.
export function createAiModelAssistant({ getContext, applyPlan, captureImages = null, requestPlan = requestEditPlan, checkService = requestAiServiceStatus }) {
  const launcher = document.createElement('button');
  launcher.id = 'ai-edit-launcher';
  launcher.type = 'button';
  launcher.textContent = 'AI 助手';
  launcher.setAttribute('aria-controls', 'ai-edit-panel');
  launcher.setAttribute('aria-expanded', 'false');
  document.getElementById('brand').append(launcher);
  const panel = document.createElement('aside');
  panel.id = 'ai-edit-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'ai-edit-title');
  panel.innerHTML = `
    <header class="ai-edit-header"><div><span class="ai-edit-kicker" data-ai="model-label"></span><h2 id="ai-edit-title">看图、讲解与改模型</h2></div><button type="button" data-ai="close" aria-label="关闭 AI 助手">×</button></header>
    <div class="ai-edit-body">
      <div class="ai-edit-target"><span>当前模型</span><strong data-ai="target"></strong><p data-ai="scope"></p></div>
      <section class="ai-edit-connection" data-ai="connection">
        <div data-ai="own-key-fields"><label for="ai-edit-key">DeepSeek 官方 API 密钥</label><input id="ai-edit-key" type="password" autocomplete="off" spellcheck="false" placeholder="请输入您收到的 DeepSeek API 密钥" maxlength="256">
        <p>密钥仅保存在本页内存中，刷新后清除。发送时，问题、最近对话、模型资料和所附图片直接发给 DeepSeek。</p>
        <button type="button" data-ai="clear-key">清除密钥</button></div>
        <details class="ai-edit-service-options"><summary>可选：站点共享服务</summary>
          <label class="ai-edit-check"><input type="checkbox" data-ai="use-shared-service">使用站点共享 AI 服务</label>
          <div class="ai-edit-service" data-ai="service" hidden><strong data-ai="service-status" role="status"></strong><p data-ai="service-note"></p><button type="button" data-ai="retry-service">重新检查服务</button></div>
        </details>
      </section>
      <section class="ai-edit-conversation" data-ai="conversation" hidden aria-label="与 AI 的对话"><div data-ai="messages" role="log" aria-live="polite"></div><button type="button" data-ai="clear-history">开始新对话</button></section>
      <label class="ai-edit-label" for="ai-edit-instruction">想了解什么，或怎样修改？</label>
      <textarea id="ai-edit-instruction" rows="3" maxlength="2000" placeholder="解释这座桥的构件；或告诉我想修改的地方。"></textarea>
      <div class="ai-edit-suggestions" data-ai="suggestions" aria-label="试着问问"></div>
      <div class="ai-edit-vision">
        <label class="ai-edit-check"><input type="checkbox" data-ai="include-views">附上当前模型与三视图</label>
        <div class="ai-edit-image-actions"><button type="button" data-ai="preview-images">预览当前视图</button><label class="ai-edit-upload">附图纸 / 图片<input type="file" data-ai="upload" accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label="附上图纸或图片"></label></div>
        <p class="ai-edit-hint">可附 2 张图片，每张不超过 6 MB。发送时重新截取当前视图，不包含密钥设置。</p>
        <div class="ai-edit-images" data-ai="images"></div>
      </div>
      <div class="ai-edit-request-row"><button type="button" data-ai="generate" class="ai-edit-primary">发送给 AI</button><button type="button" data-ai="cancel" hidden>取消</button></div>
      <p class="ai-edit-hint">可以先讨论，再决定是否应用修改。</p>
      <details class="ai-edit-manual" data-ai="manual"><summary>查看参数 / 手动调整</summary><div data-ai="parameters"></div><button type="button" data-ai="manual-preview">预览参数修改</button></details>
      <section class="ai-edit-plan" data-ai="plan" hidden aria-label="待应用的修改方案"><h3>核对修改</h3><p data-ai="summary"></p><table><thead><tr><th>参数</th><th>当前</th><th>修改后</th></tr></thead><tbody data-ai="changes"></tbody></table><button type="button" data-ai="apply" class="ai-edit-primary">应用到模型并重绘</button></section>
      <p data-ai="status" class="ai-edit-status" role="status" aria-live="polite"></p>
      <button type="button" data-ai="undo" disabled>撤销上一次修改</button>
      <p class="ai-edit-hint">改图结果用于制图教学；请结合实体与三视图核对。当前观察角度和包裹 / 展开状态保持不变。当前修改只在本页生效，刷新后恢复原模型。</p>
    </div>`;
  document.body.append(panel);
  const el = name => panel.querySelector(`[data-ai="${name}"]`);
  const keyInput = panel.querySelector('#ai-edit-key');
  const instruction = panel.querySelector('#ai-edit-instruction');
  el('model-label').textContent = `${DEEPSEEK_MODEL_LABEL} · 视觉`;
  el('include-views').checked = true;
  el('use-shared-service').checked = false;
  let context = null, contextKey = null, initialized = false;
  let plan = null, planKey = null, pending = null, undo = null, timer = null, applying = false;
  let conversationId = null, history = [], uploaded = [], viewImages = [];
  let imageVersion = 0, previewing = false, uploading = false;
  let serviceState = 'idle', serviceCheck = null;
  const inputs = new Map();
  const staleMessage = '模型或参数已变化，请重新生成修改方案。';
  const staleError = new Error(staleMessage);
  // Capture primitive parameter values, even if a controller reuses its objects.
  const snapshot = value => value ? {
    targetId: value.targetId, conversationId: value.conversationId || value.targetId,
    label: value.label, description: value.description,
    ...(value.modelFacts ? { modelFacts: JSON.parse(JSON.stringify(value.modelFacts)) } : {}),
    example: value.example, parameters: value.parameters?.map(p => ({
      key: p.key, label: p.label, value: p.value, min: p.min, max: p.max, step: p.step, unit: p.unit
    })) || []
  } : null;
  // Changing the selected component updates facts without invalidating undo.
  const signature = value => value ? JSON.stringify({ targetId: value.targetId,
    label: value.label, description: value.description, parameters: value.parameters?.map(p => ({
      key: p.key, label: p.label, value: p.value, min: p.min, max: p.max, step: p.step, unit: p.unit
    })) || [] }) : 'null';
  const safeMessage = (error, fallback) => error === staleError ? staleMessage
    : error instanceof AIEditError ? new AIEditError(error.code).message : fallback;
  const status = (message, error = false) => {
    el('status').textContent = message;
    el('status').classList.toggle('is-error', error);
  };
  const usesOwnKey = () => el('use-shared-service').checked !== true;
  function renderConnection() {
    const own = usesOwnKey();
    el('own-key-fields').hidden = !own;
    el('service').hidden = own;
    el('service-status').textContent = own ? ''
      : serviceState === 'ready' ? '共享 AI 服务已启用'
        : serviceState === 'checking' ? '正在检查共享 AI 服务…'
          : serviceState === 'unconfigured' ? '共享 AI 服务尚未启用' : '共享 AI 服务暂时无法连接';
    el('service-note').textContent = own ? ''
      : serviceState === 'ready' ? '无需填写密钥。点击发送后，问题、最近对话、模型资料和所附图片由网站服务转发给 DeepSeek。'
        : serviceState === 'checking' ? '正在确认服务状态，尚未发送问题或图片。'
          : '暂时不能使用共享服务。取消上方勾选后，可输入您自己的 API 密钥。';
    el('retry-service').hidden = own || serviceState === 'ready';
    el('retry-service').disabled = serviceState === 'checking';
  }
  async function refreshService() {
    if (serviceCheck) return serviceCheck.promise;
    const request = { controller: new AbortController(), promise: null };
    serviceCheck = request; serviceState = 'checking'; renderConnection(); updateButtons();
    request.promise = (async () => {
      let result;
      try { result = await checkService({ signal: request.controller.signal }); }
      catch { result = { ready: false, state: 'unavailable' }; }
      if (serviceCheck !== request || request.controller.signal.aborted) return;
      serviceState = result?.ready === true ? 'ready' : result?.state === 'unconfigured' ? 'unconfigured' : 'unavailable';
      serviceCheck = null; renderConnection(); updateButtons();
    })();
    return request.promise;
  }
  function renderConversation() {
    el('messages').replaceChildren(); el('conversation').hidden = !history.length;
    for (const message of history) {
      const article = document.createElement('article'); article.className = `ai-edit-message ai-edit-message-${message.role}`;
      const name = document.createElement('strong'); name.textContent = message.role === 'user' ? '您' : 'AI 助手';
      const body = document.createElement('p'); body.textContent = message.content;
      article.append(name, body); el('messages').append(article);
    }
  }
  function remember(...messages) {
    history.push(...messages);
    while (history.length > 8 || history.reduce((sum, item) => sum + item.content.length, 0) > 16000) history.shift();
    renderConversation();
  }
  function renderImages() {
    el('images').replaceChildren();
    for (const [index, item] of [...viewImages, ...uploaded].entries()) {
      const card = document.createElement('figure'), image = document.createElement('img');
      image.src = item.dataUrl; image.alt = item.label;
      const caption = document.createElement('figcaption'); caption.textContent = item.label;
      card.append(image, caption);
      if (index >= viewImages.length) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除';
        remove.setAttribute('aria-label', `移除${item.label}`);
        remove.addEventListener('click', () => { if (pending || uploading) return; uploaded = uploaded.filter(image => image !== item); renderImages(); });
        card.append(remove);
      }
      el('images').append(card);
    }
  }
  function discardPlan() {
    plan = null; planKey = null; el('plan').hidden = true; el('apply').disabled = true;
    el('summary').textContent = ''; el('changes').replaceChildren();
  }
  function refresh() {
    const next = snapshot(getContext());
    const nextKey = signature(next);
    if (initialized && nextKey === contextKey) { context = next; updateButtons(); return false; }
    if (pending || plan) status(staleMessage);
    if (pending) { pending.abort(); pending = null; }
    discardPlan();
    imageVersion++; previewing = false; uploading = false; viewImages = [];
    if (conversationId !== next?.conversationId) {
      history = []; uploaded = []; renderConversation(); conversationId = next?.conversationId || null;
    }
    renderImages();
    context = next; contextKey = nextKey; initialized = true;
    if (undo && undo.contextKey !== nextKey) undo = null;
    el('target').textContent = next?.label || '此页面暂不支持 AI 助手';
    el('scope').textContent = next?.parameters.some(p => p.key === 'deckWidth')
      ? '支持改主跨、桥面宽、塔高和索数。可先看图讨论，核对后再应用。'
      : next?.description || '请切换到“模型与三视图”或第5章组合体，再打开 AI 助手。';
    inputs.clear(); el('parameters').replaceChildren();
    for (const p of next?.parameters || []) {
      const label = document.createElement('label');
      label.className = 'ai-edit-parameter';
      const text = document.createElement('span'); text.textContent = p.label;
      const field = document.createElement('input');
      field.type = 'number'; field.min = String(p.min); field.max = String(p.max); field.step = String(p.step || 'any'); field.value = String(p.value);
      field.setAttribute('aria-label', p.label);
      const unit = document.createElement('span'); unit.textContent = p.unit || '';
      label.append(text, field, unit); el('parameters').append(label); inputs.set(p.key, field);
    }
    instruction.placeholder = next?.example || '解释当前模型的构件，以及三张视图分别表达什么。';
    el('suggestions').replaceChildren();
    const suggestions = next?.parameters.some(p => p.key === 'deckWidth')
      ? ['解释当前模型', '桥面加宽2米，塔高不变，索再密一点', '这样修改会影响哪张视图？']
      : ['解释当前模型', '讲解这三张视图', '可以怎样修改这个模型？'];
    for (const text of next ? suggestions : []) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.addEventListener('click', () => { instruction.value = text; instruction.focus(); }); el('suggestions').append(button);
    }
    updateButtons();
    return true;
  }
  function updateButtons() {
    const ready = Boolean(context), editable = Boolean(context?.parameters?.length);
    const busy = Boolean(pending) || applying || previewing || uploading;
    el('generate').disabled = !ready || busy || (!usesOwnKey() && serviceState !== 'ready');
    el('manual').hidden = !editable;
    el('manual-preview').disabled = !editable || busy;
    el('apply').disabled = !editable || busy || planKey !== contextKey || !plan?.changes.length;
    el('cancel').hidden = !pending;
    el('generate').textContent = pending ? '正在回答…' : '发送给 AI';
    el('undo').disabled = !undo || undo.contextKey !== contextKey || busy;
    el('preview-images').disabled = !ready || busy || !captureImages || !el('include-views').checked;
    el('upload').disabled = !ready || busy; el('include-views').disabled = busy;
    el('clear-history').disabled = busy;
    keyInput.disabled = !usesOwnKey() || busy;
  }
  function showPlan(candidate, expected) {
    const current = getContext();
    if (!current || signature(expected) !== signature(current)) throw staleError;
    plan = validateEditPlan(candidate, current);
    plan.changes = plan.changes.filter(change => current.parameters.find(p => p.key === change.key).value !== change.value);
    planKey = signature(current);
    el('summary').textContent = plan.summary;
    el('changes').replaceChildren();
    for (const change of plan.changes) {
      const p = current.parameters.find(item => item.key === change.key);
      const row = document.createElement('tr');
      for (const value of [p.label, `${p.value}${p.unit || ''}`, `${change.value}${p.unit || ''}`]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      el('changes').append(row);
    }
    el('plan').hidden = !plan.changes.length;
    updateButtons();
    status(plan.changes.length ? '修改方案已就绪，实体尚未改变。核对后点击应用，也可以继续讨论。' : '可以继续追问。');
    return plan;
  }
  async function generate() {
    refresh();
    if (!context || pending || applying || previewing || uploading) return;
    const own = usesOwnKey();
    if (!own && serviceState !== 'ready') { status(new AIEditError('SHARED_UNAVAILABLE').message, true); return; }
    if (own && !keyInput.value.trim()) {
      keyInput.focus(); status('请先输入 DeepSeek 官方 API 密钥。', true); return;
    }
    if (!instruction.value.trim()) { instruction.focus(); status('请先输入问题或修改要求。', true); return; }
    const captured = context, question = instruction.value.trim(), credential = own ? keyInput.value.trim() : undefined;
    const controller = new AbortController(); pending = controller;
    discardPlan(); updateButtons(); status('正在准备模型资料…');
    try {
      const images = [...uploaded];
      if (el('include-views').checked && captureImages) {
        const currentViews = await captureImages();
        if (pending !== controller || controller.signal.aborted) return;
        if (signature(getContext()) !== signature(captured)) throw staleError;
        viewImages = currentViews; renderImages(); images.unshift(...currentViews);
      }
      status(images.length ? `正在结合模型资料和 ${images.length} 张图片回答…` : '正在结合模型资料回答…');
      const candidate = await requestPlan({ mode: own ? 'direct' : 'shared', ...(own ? { apiKey: credential } : {}), instruction: question, context: captured,
        history: history.map(item => ({ ...item })), images, signal: controller.signal });
      if (pending !== controller || controller.signal.aborted) return;
      const checked = showPlan(candidate, captured);
      remember({ role: 'user', content: question }, { role: 'assistant', content: checked.summary });
      if (instruction.value.trim() === question) instruction.value = '';
    } catch (error) {
      if (pending === controller && !own && error instanceof AIEditError && error.code === 'SHARED_UNAVAILABLE') {
        serviceState = 'unavailable'; renderConnection();
      }
      if (pending === controller) status(safeMessage(error, '未能完成回答，请稍后再试；也可取消附图后重试。'), true);
    } finally {
      if (pending === controller) pending = null;
      refresh(); updateButtons();
    }
  }
  function cancel(message = '已取消请求。') { if (pending) pending.abort(); pending = null; status(message); updateButtons(); }
  function close() { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); if (timer) clearInterval(timer); timer = null; imageVersion++; previewing = false; uploading = false; cancel(''); launcher.focus(); }
  launcher.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; launcher.setAttribute('aria-expanded', 'true');
    refresh();
    timer = setInterval(refresh, 500);
    if (usesOwnKey()) { (keyInput.value.trim() ? instruction : keyInput).focus(); return; }
    instruction.focus(); return refreshService();
  });
  el('close').addEventListener('click', close);
  panel.addEventListener('keydown', event => {
    // Space on drawer buttons must not also trigger the model unfold shortcut.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); generate(); }
  });
  el('generate').addEventListener('click', generate);
  el('cancel').addEventListener('click', () => cancel());
  el('retry-service').addEventListener('click', refreshService);
  el('use-shared-service').addEventListener('change', () => {
    cancel(usesOwnKey() ? '已切换为自己的 API。' : '已切换为共享 AI 服务。');
    if (usesOwnKey()) { serviceCheck?.controller.abort(); serviceCheck = null; serviceState = 'idle'; }
    renderConnection(); updateButtons();
    if (!usesOwnKey()) return refreshService();
  });
  el('clear-key').addEventListener('click', () => { keyInput.value = ''; cancel('密钥已清除。'); });
  el('clear-history').addEventListener('click', () => { history = []; renderConversation(); discardPlan(); status('已开始新对话，当前模型保持不变。'); });
  el('include-views').addEventListener('change', () => { if (!el('include-views').checked) { viewImages = []; renderImages(); } updateButtons(); });
  el('preview-images').addEventListener('click', async () => {
    refresh(); if (!context || !captureImages || pending || previewing || uploading) return;
    const expected = contextKey, version = ++imageVersion; previewing = true; updateButtons();
    try {
      const images = await captureImages();
      if (version !== imageVersion) return;
      if (signature(getContext()) !== expected) throw staleError;
      viewImages = images; renderImages(); status(`已预览 ${images.length} 张当前视图，尚未发送给 AI。`);
    } catch (error) { if (version === imageVersion) status(safeMessage(error, '当前视图暂未准备好，请等待模型加载完成后重试。'), true); }
    finally { if (version === imageVersion) previewing = false; updateButtons(); }
  });
  el('upload').addEventListener('change', async () => {
    const files = Array.from(el('upload').files || []); el('upload').value = '';
    if (!files.length || pending || uploading) return;
    if (files.length + uploaded.length > 2 || files.some(file => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024 || file.size === 0)) {
      status('请附上最多 2 张 PNG、JPEG、WebP 或 GIF 图片，每张不超过 6 MB。', true); return;
    }
    const version = ++imageVersion; uploading = true; updateButtons();
    try {
      const images = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ label: `附图：${file.name.slice(0, 70)}`, dataUrl: reader.result });
        reader.onerror = () => reject(new Error('Unreadable attachment')); reader.readAsDataURL(file);
      })));
      if (version !== imageVersion) return;
      uploaded.push(...images); renderImages(); status('图片已附上，点击发送后交给 AI 阅读。');
    } catch { if (version === imageVersion) status('图片未能读取，请重新选择。', true); }
    finally { if (version === imageVersion) uploading = false; updateButtons(); }
  });
  el('manual-preview').addEventListener('click', () => {
    if (refresh()) { status(staleMessage); return; }
    if (!context?.parameters?.length || pending || applying) return;
    const captured = context;
    try {
      const changes = [...inputs].map(([key, field]) => {
        if (!field.value.trim()) throw new AIEditError('INVALID_PLAN');
        return { key, value: Number(field.value) };
      }).filter(change => change.value !== captured.parameters.find(p => p.key === change.key).value);
      showPlan({ targetId: captured.targetId, summary: '手动参数修改（未调用 DeepSeek）', changes }, captured);
      if (!changes.length) status('参数与当前模型相同。');
    } catch (error) { discardPlan(); status(safeMessage(error, '请检查参数数值、范围和步长后重试。'), true); }
  });
  el('apply').addEventListener('click', () => {
    if (!plan?.changes.length || pending || applying) return;
    applying = true; updateButtons();
    try {
      const current = getContext();
      if (signature(current) !== planKey) throw staleError;
      const checked = validateEditPlan(plan, current);
      const applied = checked.changes.map(change => { const p = current.parameters.find(p => p.key === change.key); return `${p.label}：${p.value} → ${change.value}${p.unit || ''}`; }).join('；');
      // Consume before invoking the controller, so a double click cannot reapply.
      discardPlan();
      const result = applyPlan(checked, current);
      undo = typeof result?.restore === 'function'
        ? { contextKey: signature(getContext()), context: snapshot(getContext()), action: result } : null;
      refresh();
      remember({ role: 'assistant', content: `已应用修改：${applied}。实体与三视图已同步更新。` });
      status('已修改实体并更新三视图。可关闭面板观察，也可以撤销。');
    } catch (error) { discardPlan(); refresh(); status(safeMessage(error, '修改未能完成，请检查当前模型后重新生成方案。'), true); }
    finally { applying = false; updateButtons(); }
  });
  el('undo').addEventListener('click', () => {
    if (!undo || pending || applying) return;
    const previous = undo;
    applying = true; updateButtons();
    try {
      if (signature(getContext()) !== undo.contextKey) throw staleError;
      previous.action.restore(); undo = null;
      discardPlan(); refresh(); status('已恢复修改前的实体和三视图。');
      remember({ role: 'assistant', content: '刚才的修改已撤销，实体和三视图恢复到修改前。' });
    } catch (error) {
      const current = getContext();
      const recoveredTarget = previous.action.targetId ?? previous.context?.targetId;
      // A controller can roll a failed undo back to the applied state with a new
      // revision. Retain its original action/getter only for that verified state.
      if (error !== staleError && !error?.rollbackFailed && current?.targetId === recoveredTarget
        && signature({ ...previous.context, targetId: recoveredTarget }) === signature(current)) {
        previous.context = snapshot(current); previous.contextKey = signature(current);
      } else undo = null;
      refresh(); status(safeMessage(error, '无法撤销，请检查当前模型。'), true);
    }
    finally { applying = false; updateButtons(); }
  });
  window.addEventListener('pagehide', () => {
    serviceCheck?.controller.abort(); serviceCheck = null; serviceState = 'unavailable';
    imageVersion++; previewing = false; uploading = false;
    history = []; uploaded = []; viewImages = []; renderConversation(); renderImages();
    keyInput.value = ''; el('use-shared-service').checked = false; renderConnection(); cancel(''); discardPlan();
    if (timer) clearInterval(timer); timer = null;
    panel.hidden = true; launcher.setAttribute('aria-expanded', 'false');
  });
  renderConnection(); refresh();
  return { refresh, refreshService };
}
