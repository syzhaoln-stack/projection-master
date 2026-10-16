export const COMPONENT_INFO = {
  base: { label: '底板', role: '作为零件的安装基准，并把上部结构传来的作用传给安装面。' },
  plate: { label: '板件', role: '观察孔、外轮廓和厚度在三个正交视图中的不同表达。' },
  vertical: { label: '立板', role: '与底板垂直，是分析组合体叠加关系和肋板连接的基准构件。' },
  left_support: { label: '左支承板', role: '支承轴承座圆筒，并在侧视图中体现板厚。' },
  right_support: { label: '右支承板', role: '与左支承板成对布置，共同支承圆筒。' },
  barrel: { label: '轴承座圆筒', role: '容纳轴承；圆柱轴线决定圆形视图和非圆形视图的位置。' },
  hole_rim: { label: '轴承孔', role: '中心线贯穿各有关视图，用于对应孔的位置和轴线方向。' },
  front_rib: { label: '前肋板', role: '连接底板与支承结构，观察其真实形状及积聚性投影。' },
  back_rib: { label: '后肋板', role: '与前肋板对应布置，用于比较可见线与隐藏线。' },
  bolt: { label: '安装螺栓', role: '表示标准连接件的位置，可用于比较圆形和矩形投影。' },
  top_boss: { label: '上部凸台', role: '局部增加高度和厚度，适合练习组合体的叠加分析。' },
  slide: { label: '燕尾槽滑块', role: '斜面在不同投影方向呈现不同线形，用于训练斜面识读。' },
  left_v: { label: 'V形槽左斜面', role: '与右斜面共同定位圆柱，并关于中心面对称。' },
  right_v: { label: 'V形槽右斜面', role: '与左斜面共同形成V形槽，应在对应视图中保持对称。' },
  ref: { label: '定位圆柱', role: '用于比较圆柱在沿轴线与垂直轴线方向上的投影。' },
  deck: { label: '桥面板', role: '承受车辆荷载，并将荷载分配给主梁或加劲梁。' },
  girder: { label: '主梁', role: '承担桥面荷载，并把作用传向支座或索、拱体系。' },
  edge_girder: { label: '边梁', role: '位于桥面两侧，参与纵向承载和桥面边缘约束。' },
  tie_girder: { label: '系梁', role: '连接拱脚并承担水平拉力，同时支承桥面体系。' },
  main_girder: { label: '主梁', role: '节点中的纵向承重构件，与横梁共同支承桥面。' },
  cross_beam: { label: '横梁', role: '横向联系主梁，并把桥面荷载分配至纵向承重体系。' },
  pier: { label: '桥墩', role: '把上部结构反力传递至基础。' },
  pier_cap: { label: '盖梁', role: '承接支座反力，并把荷载分配至墩柱。' },
  arch_rib: { label: '拱肋', role: '以轴向受压为主，将荷载传向拱脚。' },
  arch_brace: { label: '拱肋横撑', role: '连接两片拱肋，增强横向稳定与整体性。' },
  hanger: { label: '吊杆', role: '受拉连接桥面与拱肋或主缆，传递竖向荷载。' },
  tower: { label: '桥塔', role: '承接拉索或主缆作用，并将其传递至下部结构。' },
  tower_beam: { label: '塔横梁', role: '连接塔柱并增强桥塔横向整体性。' },
  stay_cable: { label: '斜拉索', role: '受拉，把主梁荷载直接传递给桥塔。' },
  main_cable: { label: '主缆', role: '受拉汇集吊杆荷载，并传向桥塔和锚碇。' },
  anchor: { label: '索锚固区', role: '把拉索集中力可靠传入主梁或桥塔。' },
  gusset: { label: '节点板', role: '连接吊杆、横梁与主梁，完成节点内力传递。' },
  stiffener: { label: '加劲肋', role: '提高局部刚度，抑制板件屈曲和应力集中。' }
};

export const BRIDGE_VIEW_TASK = {
  model: 'cableStayedFan',
  targetComponent: 'stay_cable',
  expectedView: 'front'
};

export const INTERACTION_TYPES = new Set(['rotate-to-view', 'click-model', 'click-projection', 'mark-dimension']);

export function getComponentInfo(name) {
  const key = String(name || '').trim().toLowerCase();
  return COMPONENT_INFO[key] || {
    label: key ? `构件 ${key}` : '未命名网格',
    role: '观察该构件在三维模型中的位置及其三个正交投影。'
  };
}

function asSet(values) {
  return values instanceof Set ? values : new Set(values || []);
}

export function getQuizOptionState(answer, selectedAnswers, expectedAnswers, answered) {
  const selected = asSet(selectedAnswers).has(answer);
  const expected = asSet(expectedAnswers).has(answer);
  return {
    selected: selected && !answered,
    correct: answered && expected,
    wrong: answered && selected && !expected,
    missed: answered && expected && !selected,
    disabled: answered
  };
}

export function evaluateQuizSelection(selectedAnswers, expectedAnswers) {
  const selected = asSet(selectedAnswers);
  const expected = asSet(expectedAnswers);
  const missing = [...expected].filter(answer => !selected.has(answer));
  const unexpected = [...selected].filter(answer => !expected.has(answer));
  return { exact: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

export function directionAngleDegrees(actual, target) {
  const a = actual || [];
  const b = target || [];
  const aLength = Math.hypot(a[0] || 0, a[1] || 0, a[2] || 0);
  const bLength = Math.hypot(b[0] || 0, b[1] || 0, b[2] || 0);
  if (!aLength || !bLength) return Infinity;
  const dot = ((a[0] || 0) * (b[0] || 0) + (a[1] || 0) * (b[1] || 0) + (a[2] || 0) * (b[2] || 0)) / (aLength * bLength);
  return Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
}

export function isPointInHotspot(point, hotspot) {
  if (!point || !hotspot || !Number.isFinite(point.u) || !Number.isFinite(point.v)) return false;
  if (hotspot.shape === 'circle') {
    return Math.hypot(point.u - hotspot.u, point.v - hotspot.v) <= hotspot.radius;
  }
  if (hotspot.shape === 'rect') {
    return point.u >= hotspot.u && point.u <= hotspot.u + hotspot.width
      && point.v >= hotspot.v && point.v <= hotspot.v + hotspot.height;
  }
  return false;
}

export function getHotspotHit(point, hotspots = []) {
  return hotspots.find(hotspot => isPointInHotspot(point, hotspot)) || null;
}

export function evaluateInteractionAnswer(question, response = {}) {
  if (question.type === 'rotate-to-view') {
    const angle = directionAngleDegrees(response.direction, question.targetDirection);
    return { exact: angle <= (question.toleranceDegrees ?? 9), angle, missing: [], unexpected: [] };
  }
  if (question.type === 'click-model') {
    const selected = String(response.componentName || '').toLowerCase();
    const accepted = new Set((question.targetComponents || []).map(name => String(name).toLowerCase()));
    return { exact: accepted.has(selected), missing: accepted.has(selected) ? [] : ['target-component'], unexpected: selected ? [selected] : [] };
  }
  if (question.type === 'click-projection' || question.type === 'mark-dimension') {
    const sameView = response.view === question.targetView;
    const hotspot = getHotspotHit(response, question.hotspots);
    const targetIds = new Set(question.answer || []);
    const hitId = hotspot?.id || null;
    return {
      exact: sameView && Boolean(hitId) && targetIds.has(hitId),
      hitId,
      missing: sameView && hitId && targetIds.has(hitId) ? [] : ['target-hotspot'],
      unexpected: hitId && !targetIds.has(hitId) ? [hitId] : []
    };
  }
  return { exact: false, missing: ['unsupported-question-type'], unexpected: [] };
}

export function evaluateQuestionAnswer(question, response) {
  if (INTERACTION_TYPES.has(question.type)) return evaluateInteractionAnswer(question, response);
  return evaluateQuizSelection(response, question.answer);
}

export function formatPracticeFeedback(question, response, result = evaluateQuestionAnswer(question, response)) {
  if (result.exact) return '回答正确。';
  if (question.type === 'single' || question.type === 'multiple') {
    const labels = ids => ids.map(id => question.options.find(option => option.id === id)?.label || id).join('、');
    const parts = [];
    if (result.missing.length) parts.push(`${question.type === 'single' ? '正确答案' : '漏选'}：${labels(result.missing)}`);
    if (result.unexpected.length) parts.push(`误选：${labels(result.unexpected)}`);
    return `${parts.join('；')}。`;
  }
  if (question.type === 'rotate-to-view') {
    const view = { front: '主视', top: '俯视', side: '左视' }[question.targetView] || '目标';
    return Number.isFinite(result.angle)
      ? `距${view}方向还差 ${result.angle.toFixed(1)}°，允许偏差 ${question.toleranceDegrees}°。`
      : `请先旋转模型，对准${view}方向。`;
  }
  if (question.type === 'click-model') {
    const expected = (question.targetComponents || []).map(name => getComponentInfo(name).label).join('或');
    const actual = response?.componentName ? getComponentInfo(response.componentName).label : '空白位置';
    return `应点击${expected}；当前选中的是${actual}。`;
  }
  return `目标在${{ front: '主视图', top: '俯视图', side: '左视图' }[question.targetView] || '指定视图'}，请对照图中对应轮廓。`;
}

export function createPracticeRecord(question, response, startedAt, options = {}) {
  const evaluation = evaluateQuestionAnswer(question, response);
  const endedAt = options.endedAt ?? Date.now();
  const selectedAnswers = response instanceof Set || Array.isArray(response) ? [...asSet(response)] : [];
  return {
    questionId: question.id,
    skill: question.skill,
    difficulty: question.difficulty,
    type: question.type,
    correct: evaluation.exact,
    selectedAnswers,
    interaction: selectedAnswers.length ? null : (response && typeof response === 'object' ? { ...response } : null),
    responseTimeMs: Math.max(0, endedAt - startedAt),
    attempts: options.attempts ?? 1,
    hintUsed: Boolean(options.hintUsed),
    misconception: evaluation.exact ? null : question.misconception,
    reflection: options.reflection ?? null
  };
}

export function summarizePractice(records = []) {
  const completed = records.length;
  const correct = records.filter(record => record.correct).length;
  const misconceptions = records
    .filter(record => record.misconception)
    .reduce((summary, record) => {
      summary[record.misconception] = (summary[record.misconception] || 0) + 1;
      return summary;
    }, {});
  return { completed, correct, accuracy: completed ? correct / completed : 0, hintsUsed: records.filter(record => record.hintUsed).length, misconceptions };
}

export function isBridgeTaskTarget(componentName) {
  return String(componentName || '').toLowerCase() === BRIDGE_VIEW_TASK.targetComponent;
}
