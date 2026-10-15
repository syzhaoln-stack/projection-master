import { AIEditError, requestEditPlan, validateEditPlan } from './ai-edit-protocol.js';
import './ai-model-assistant.css';

// The drawer only handles a constrained parameter plan. Model operations stay in
// the teaching controllers; no response is evaluated as code or inserted as HTML.
export function createAiModelAssistant({ getContext, applyPlan, requestPlan = requestEditPlan }) {
  const launcher = document.createElement('button');
  launcher.id = 'ai-edit-launcher';
  launcher.type = 'button';
  launcher.textContent = 'AI 改图';
  launcher.setAttribute('aria-controls', 'ai-edit-panel');
  launcher.setAttribute('aria-expanded', 'false');
  document.getElementById('brand').append(launcher);
  const panel = document.createElement('aside');
  panel.id = 'ai-edit-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'ai-edit-title');
  panel.innerHTML = `
    <header class="ai-edit-header"><div><span class="ai-edit-kicker">DEEPSEEK · 工程制图</span><h2 id="ai-edit-title">用文字修改模型</h2></div><button type="button" data-ai="close" aria-label="关闭 AI 改图">×</button></header>
    <div class="ai-edit-body">
      <div class="ai-edit-target"><span>当前模型</span><strong data-ai="target"></strong><p data-ai="scope"></p></div>
      <details class="ai-edit-connection" data-ai="connection"><summary>连接 DeepSeek 官方 API</summary>
        <label for="ai-edit-key">API 密钥</label><input id="ai-edit-key" type="password" autocomplete="off" spellcheck="false" placeholder="在这里输入您的 API 密钥" maxlength="256">
        <p>密钥仅在本页内存中使用，刷新后清除。请求直接发送给 DeepSeek，仅包含您的指令、模型名称和可修改参数。</p>
        <button type="button" data-ai="clear-key">清除密钥</button>
      </details>
      <label class="ai-edit-label" for="ai-edit-instruction">想怎样修改？</label>
      <textarea id="ai-edit-instruction" rows="3" maxlength="2000" placeholder="例如：把横向整体比例改为 120%，其余不变。"></textarea>
      <div class="ai-edit-request-row"><button type="button" data-ai="generate" class="ai-edit-primary">生成修改方案</button><button type="button" data-ai="cancel" hidden>取消</button></div>
      <p class="ai-edit-hint">先核对参数，再应用到实体。三视图会同步重绘。</p>
      <details class="ai-edit-manual"><summary>查看参数 / 手动调整</summary><div data-ai="parameters"></div><button type="button" data-ai="manual-preview">预览参数修改</button></details>
      <section class="ai-edit-plan" data-ai="plan" hidden aria-label="待应用的修改方案"><h3>核对修改</h3><p data-ai="summary"></p><table><thead><tr><th>参数</th><th>当前</th><th>修改后</th></tr></thead><tbody data-ai="changes"></tbody></table><button type="button" data-ai="apply" class="ai-edit-primary">应用到模型并重绘</button></section>
      <p data-ai="status" class="ai-edit-status" role="status" aria-live="polite"></p>
      <button type="button" data-ai="undo" disabled>撤销上一次修改</button>
      <p class="ai-edit-hint">改图结果用于制图教学；请结合实体与三视图核对。当前观察角度和包裹 / 展开状态保持不变。当前修改只在本页生效，刷新后恢复原模型。</p>
    </div>`;
  document.body.append(panel);
  const el = name => panel.querySelector(`[data-ai="${name}"]`);
  const keyInput = panel.querySelector('#ai-edit-key');
  const instruction = panel.querySelector('#ai-edit-instruction');
  let context = null, contextKey = null, initialized = false;
  let plan = null, planKey = null, pending = null, undo = null, timer = null, applying = false;
  const inputs = new Map();
  const staleMessage = '模型或参数已变化，请重新生成修改方案。';
  const staleError = new Error(staleMessage);
  // Capture primitive parameter values, even if a controller reuses its objects.
  const snapshot = value => value ? {
    targetId: value.targetId, label: value.label, description: value.description,
    example: value.example, parameters: value.parameters?.map(p => ({
      key: p.key, label: p.label, value: p.value, min: p.min, max: p.max, step: p.step, unit: p.unit
    })) || []
  } : null;
  const signature = value => JSON.stringify(snapshot(value));
  const safeMessage = (error, fallback) => error === staleError ? staleMessage
    : error instanceof AIEditError ? new AIEditError(error.code).message : fallback;
  const status = (message, error = false) => {
    el('status').textContent = message;
    el('status').classList.toggle('is-error', error);
  };
  function discardPlan() {
    plan = null; planKey = null; el('plan').hidden = true; el('apply').disabled = true;
    el('summary').textContent = ''; el('changes').replaceChildren();
  }
  function refresh() {
    const next = snapshot(getContext());
    const nextKey = signature(next);
    if (initialized && nextKey === contextKey) { updateButtons(); return false; }
    if (pending || plan) status(staleMessage);
    if (pending) { pending.abort(); pending = null; }
    discardPlan();
    context = next; contextKey = nextKey; initialized = true;
    if (undo && undo.contextKey !== nextKey) undo = null;
    el('target').textContent = next?.label || '此页面暂不支持文字改图';
    el('scope').textContent = next?.description || '请切换到“模型与三视图”或第5章组合体，再打开 AI 改图。';
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
    instruction.placeholder = next?.example || '例如：把横向整体比例改为 120%，其余不变。';
    updateButtons();
    return true;
  }
  function updateButtons() {
    const ready = Boolean(context?.parameters?.length);
    const busy = Boolean(pending) || applying;
    el('generate').disabled = !ready || busy;
    el('manual-preview').disabled = !ready || busy;
    el('apply').disabled = !ready || busy || planKey !== contextKey || !plan?.changes.length;
    el('cancel').hidden = !pending;
    el('generate').textContent = pending ? '正在生成…' : '生成修改方案';
    el('undo').disabled = !undo || undo.contextKey !== contextKey || busy;
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
    el('plan').hidden = false;
    updateButtons();
    status(plan.changes.length ? '方案已就绪，核对后点击应用。实体尚未改变。' : '没有可应用的参数变化。');
  }
  async function generate() {
    refresh();
    if (!context?.parameters?.length || pending || applying) return;
    if (!keyInput.value.trim()) {
      el('connection').open = true; keyInput.focus(); status('请先在连接设置中输入 DeepSeek 官方 API 密钥。', true); return;
    }
    if (!instruction.value.trim()) { instruction.focus(); status('请先描述想修改的内容。', true); return; }
    const captured = context;
    const controller = new AbortController(); pending = controller;
    discardPlan(); updateButtons(); status('正在生成参数方案…');
    try {
      const candidate = await requestPlan({ apiKey: keyInput.value.trim(), instruction: instruction.value.trim(), context: captured, signal: controller.signal });
      if (pending !== controller || controller.signal.aborted) return;
      showPlan(candidate, captured);
    } catch (error) {
      if (pending === controller) status(safeMessage(error, '未能生成方案，请稍后再试。'), true);
    } finally {
      if (pending === controller) pending = null;
      refresh(); updateButtons();
    }
  }
  function cancel(message = '已取消请求。') { if (pending) pending.abort(); pending = null; status(message); updateButtons(); }
  function close() { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); if (timer) clearInterval(timer); timer = null; cancel(''); launcher.focus(); }
  launcher.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; launcher.setAttribute('aria-expanded', 'true');
    refresh();
    if (!keyInput.value) el('connection').open = true;
    timer = setInterval(refresh, 500); instruction.focus();
  });
  el('close').addEventListener('click', close);
  panel.addEventListener('keydown', event => {
    // Space on drawer buttons must not also trigger the model unfold shortcut.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  el('generate').addEventListener('click', generate);
  el('cancel').addEventListener('click', () => cancel());
  el('clear-key').addEventListener('click', () => { keyInput.value = ''; cancel('密钥已清除。'); });
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
    } catch (error) { discardPlan(); status(safeMessage(error, '请检查参数数值、范围和步长后重试。'), true); }
  });
  el('apply').addEventListener('click', () => {
    if (!plan?.changes.length || pending || applying) return;
    applying = true; updateButtons();
    try {
      const current = getContext();
      if (signature(current) !== planKey) throw staleError;
      const checked = validateEditPlan(plan, current);
      // Consume before invoking the controller, so a double click cannot reapply.
      discardPlan();
      const result = applyPlan(checked, current);
      undo = typeof result?.restore === 'function'
        ? { contextKey: signature(getContext()), context: snapshot(getContext()), action: result } : null;
      refresh();
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
    keyInput.value = ''; cancel(''); discardPlan();
    if (timer) clearInterval(timer); timer = null;
    panel.hidden = true; launcher.setAttribute('aria-expanded', 'false');
  });
  refresh();
  return { refresh };
}
