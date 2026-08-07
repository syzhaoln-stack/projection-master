export const COMPOUND_LESSONS = Object.freeze([
  {
    id: 'example-5-1',
    modelKey: 'example51',
    label: '例5-1',
    shortTitle: '圆筒与矩形肋板',
    title: '叠加型组合体：底板、立板、圆筒与矩形肋板',
    source: '第5章 · 例5-1，图5-1～图5-2',
    objective: '严格按图5-2的作图次序，由底板开始，依次叠加立板、圆筒和矩形肋板，最后切出中心圆柱孔与两个底板小孔。',
    aiInput: '从图5-1识别底板、拱顶立板、水平圆筒、矩形肋板及三个贯穿孔',
    operations: ['底板定基准', '立板叠加', '圆筒与矩形肋板叠加', '3孔贯穿切除'],
    components: [
      { id: 'base', label: 'A0·底板', operation: 'base', step: 0 },
      { id: 'upright', label: 'A1·拱顶立板', operation: 'add', step: 1 },
      { id: 'barrel', label: 'A2·圆筒', operation: 'add', step: 2 },
      { id: 'rib', label: 'A3·矩形肋板', operation: 'add', step: 2 },
      { id: 'bore', label: 'B1·中心圆柱孔', operation: 'subtract', step: 3 },
      { id: 'base-hole-left', label: 'B2·左底板孔', operation: 'subtract', step: 3 },
      { id: 'base-hole-right', label: 'B3·右底板孔', operation: 'subtract', step: 3 }
    ],
    assembly: {
      title: '图5-1四构件装配',
      note: '依次拿开或装回立板、圆筒、矩形肋板；归位时肋板上表面只与圆筒下缘相切，不穿入圆筒。',
      parts: [
        { id: 'base', symbol: 'A0', label: '底板', fixed: true, dragPlane: 'xz', parkOffset: [0, 0, 0] },
        { id: 'upright', symbol: 'A1', label: '拱顶立板', dragPlane: 'xy', parkOffset: [-1.65, 0.85, -0.75] },
        { id: 'barrel', symbol: 'A2', label: '水平圆筒', dragPlane: 'xy', parkOffset: [1.45, 1.45, 0.95] },
        { id: 'rib', symbol: 'A3', label: '矩形肋板', dragPlane: 'xy', parkOffset: [0.8, 0.8, -1.45] }
      ],
      axes: [
        { id: 'x', label: '左右 X', min: -2.2, max: 2.2, step: 0.05 },
        { id: 'y', label: '升降 Y', min: -0.6, max: 2.8, step: 0.05 },
        { id: 'z', label: '前后 Z', min: -2.2, max: 2.2, step: 0.05 }
      ]
    },
    cutters: [
      { id: 'bore', symbol: 'B1', label: '中心圆柱孔', toolType: '沿前后方向贯穿的圆柱刀具', dragPlane: 'xy', target: '圆筒A2', defaults: { x: 0, y: 2.05 }, axes: [
        { id: 'x', label: '孔中心 X', min: -0.4, max: 0.4, step: 0.02, unit: '格' },
        { id: 'y', label: '孔中心 Y', min: 1.75, max: 2.35, step: 0.02, unit: '格' }
      ] },
      { id: 'base-hole-left', symbol: 'B2', label: '左底板孔', toolType: '竖直贯穿圆柱刀具', dragPlane: 'xz', target: '底板A0', defaults: { x: -1.55, z: 1.05 }, axes: [
        { id: 'x', label: '孔中心 X', min: -1.85, max: -0.85, step: 0.02, unit: '格' },
        { id: 'z', label: '孔中心 Z', min: 0.7, max: 1.3, step: 0.02, unit: '格' }
      ] },
      { id: 'base-hole-right', symbol: 'B3', label: '右底板孔', toolType: '竖直贯穿圆柱刀具', dragPlane: 'xz', target: '底板A0', defaults: { x: 1.55, z: 1.05 }, axes: [
        { id: 'x', label: '孔中心 X', min: 0.85, max: 1.85, step: 0.02, unit: '格' },
        { id: 'z', label: '孔中心 Z', min: 0.7, max: 1.3, step: 0.02, unit: '格' }
      ] }
    ],
    stages: [
      { label: '画底板三面投影', action: '确定左右、前后和高度基准 → 建立前角圆滑的底板A0', note: '对应图5-2a：先画底板轮廓，两个小孔留到最后统一处理。', visible: ['base'], appliedCutters: [], activeCutter: 'base-hole-left', showCutter: false },
      { label: '叠加拱顶立板', action: '在底板后部定位立板A1 → 拉伸成薄板', note: '对应图5-2b：先由正面投影确定拱顶外形，再投影到另外两面。', visible: ['base', 'upright'], appliedCutters: [], activeCutter: 'bore', showCutter: false },
      { label: '叠加圆筒与矩形肋板', action: '圆柱A2沿前后方向拉伸 + 矩形肋板A3贴到圆筒下缘', note: '对应图5-2c：肋板是独立长方体，上表面只与圆筒下缘相切；其俯视投影被圆筒遮挡，应画细虚线。', visible: ['base', 'upright', 'barrel', 'rib'], appliedCutters: [], activeCutter: 'bore', showCutter: false },
      { label: '切出三个贯穿孔', action: '圆筒A2−B1；底板A0−B2−B3', note: '对应图5-2d：中心孔和两个底板小孔一次补齐；默认隐藏刀具，点击B1～B3即可显示、拖动并观察投影同步变化。', visible: ['base', 'upright', 'barrel', 'rib'], appliedCutters: ['bore', 'base-hole-left', 'base-hole-right'], activeCutter: 'bore', showCutter: false }
    ],
    parameters: [],
    question: {
      prompt: '图5-2c中，矩形肋板的俯视投影为什么应画细虚线？',
      options: [
        { id: 'occluded-by-barrel', label: '肋板位于圆筒下方，被圆筒遮挡' },
        { id: 'inside-barrel', label: '肋板穿入圆筒内部' },
        { id: 'construction-only', label: '肋板只是辅助线，并非实体' }
      ],
      answer: 'occluded-by-barrel',
      evidence: '教材图5-2的作图说明明确指出“肋板的水平投影不可见，画细虚线”；这来自遮挡关系，不表示肋板穿入圆筒。'
    }
  },
  {
    id: 'example-5-5',
    modelKey: 'example55',
    label: '例5-5',
    shortTitle: '斜切与开槽',
    title: '切割型平面立体：P、Q斜切与Ⅲ开槽',
    source: '第5章 · 例5-5，图5-14～图5-15',
    objective: '从完整四棱柱出发，依次用正垂面P、前后侧垂面Q和切除体Ⅲ形成教材中的切割型平面立体。',
    aiInput: '由两面投影识别正垂面P、侧垂面Q及底部槽体Ⅲ',
    displayDefaults: { shadows: false, boldEdges: true, transparent: false, showHidden: true },
    operations: ['P面斜切', 'Q面对称切除', 'B3全长贯穿槽'],
    components: [
      { id: 'body', label: 'A·完整四棱柱/结果', operation: 'base', step: 0 },
      { id: 'cut-p', label: 'B1·切除体Ⅰ（P）', operation: 'subtract', step: 1 },
      { id: 'cut-q', label: 'B2·前后切除体Ⅱ（Q）', operation: 'subtract', step: 2 },
      { id: 'cut-slot', label: 'B3·开槽体Ⅲ', operation: 'subtract', step: 3 }
    ],
    cutters: [
      { id: 'cut-p', symbol: 'B1 / P', label: '正垂面P斜切', dragPlane: 'xy', target: '四棱柱A', defaults: { x: 0, y: 0 }, axes: [
        { id: 'x', label: 'P面水平移', min: -0.45, max: 0.45, step: 0.01, unit: '格' },
        { id: 'y', label: 'P面高度移', min: -0.25, max: 0.25, step: 0.01, unit: '格' }
      ] },
      { id: 'cut-q', symbol: 'B2 / Q', label: '前后侧垂面Q', dragPlane: 'yz', target: 'P切后实体', defaults: { z: 0, y: 0 }, axes: [
        { id: 'z', label: 'Q面对称移', min: -0.3, max: 0.3, step: 0.02, unit: '格' },
        { id: 'y', label: 'Q面高度移', min: -0.2, max: 0.2, step: 0.02, unit: '格' }
      ] },
      { id: 'cut-slot', symbol: 'B3 / Ⅲ', label: '底部贯穿槽', dragPlane: 'xz', target: 'P、Q切后实体', defaults: { x: 0, z: 0 }, axes: [
        { id: 'x', label: 'B3中心 X', min: -1.2, max: 1.2, step: 0.02, unit: '格' },
        { id: 'z', label: '槽位置 Z', min: -0.45, max: 0.45, step: 0.01, unit: '格' }
      ] }
    ],
    stages: [
      { label: '完整四棱柱A', action: '建立完整四棱柱作为被切基体A', note: '教材先假定完整四棱柱，再反向分析被切去的实体。', visible: ['body'], appliedCutters: [], activeCutter: 'cut-p' },
      { label: 'P面切除Ⅰ', action: '正垂面P定义楔形刀具B1 → A−B1', note: 'P面在主视图中积聚为斜线，切去左上方立体Ⅰ。', visible: ['body', 'cut-p'], appliedCutters: ['cut-p'], activeCutter: 'cut-p' },
      { label: 'Q面切除Ⅱ', action: '侧垂面Q镜像为前、后两个刀具 → 连续差集', note: 'Q面切去前、后两个对称立体Ⅱ；B2包含一对刀具。', visible: ['body', 'cut-q'], appliedCutters: ['cut-p', 'cut-q'], activeCutter: 'cut-q' },
      { label: '切除Ⅲ贯穿槽', action: '正平面+水平面定义长方体B3 → 默认沿全长贯穿差集', note: 'B3默认穿过完整四棱柱全长，形成图5-14b的U形贯穿槽；可用下方长度参数改为局部切槽。', visible: ['body', 'cut-slot'], appliedCutters: ['cut-p', 'cut-q', 'cut-slot'], activeCutter: 'cut-slot' }
    ],
    parameters: [
      { id: 'slotLength', label: 'B3切槽长度', unit: '格', min: 1.4, max: 5.4, step: 0.1, default: 5, textbook: 5, referenceLabel: '默认：贯穿全长' }
    ],
    question: {
      prompt: '例5-5中切除体Ⅱ为什么要成对出现？',
      options: [
        { id: 'front-back', label: '侧垂面Q分别切去前、后两个立体' },
        { id: 'four-holes', label: '用于生成四个圆孔' },
        { id: 'union', label: '用于把两个实体相加' }
      ],
      answer: 'front-back',
      evidence: '教材明确指出：由侧垂面Q切去前、后两个立体Ⅱ，因此B2在模型中表现为前后对称的一对楔形刀具。'
    }
  },
  {
    id: 'example-5-6',
    modelKey: 'example56',
    label: '例5-6',
    shortTitle: '方槽与拱形槽',
    title: '空心圆柱Ⅰ与底板Ⅱ：方形槽和倒置拱形槽',
    source: '第5章 · 例5-6，图5-16～图5-17',
    objective: '先把空心圆柱Ⅰ与底板Ⅱ合并成一个封闭整体，再用Ⅲ、Ⅳ、Ⅴ依次切出前部方形槽、后部倒置拱形槽和底板方形槽。',
    aiInput: '由两面投影识别Ⅰ+Ⅱ，并反推Ⅲ、Ⅳ、Ⅴ三个封闭切除体',
    operations: ['Ⅰ+Ⅱ并集', 'Ⅲ方槽差集', 'Ⅳ倒置拱形槽差集', 'Ⅴ底板方槽差集'],
    components: [
      { id: 'body', label: 'A·Ⅰ+Ⅱ并集整体', operation: 'base', step: 0 },
      { id: 'cut-iii', label: 'B1·前部方槽Ⅲ', operation: 'subtract', step: 1 },
      { id: 'cut-iv', label: 'B2·后部倒置拱形槽Ⅳ', operation: 'subtract', step: 2 },
      { id: 'cut-v', label: 'B3·底板方形槽Ⅴ', operation: 'subtract', step: 3 }
    ],
    cutters: [
      { id: 'cut-iii', symbol: 'B1 / Ⅲ', label: '前部方槽', toolType: '长方体刀具', dragPlane: 'xy', target: '整体A的圆柱区', defaults: { x: 0.55, y: 2.55 }, axes: [
        { id: 'x', label: '槽中心 X', min: 0.25, max: 0.85, step: 0.02, unit: '格' },
        { id: 'y', label: '槽深位置 Y', min: 2.35, max: 2.72, step: 0.02, unit: '格' }
      ] },
      { id: 'cut-iv', symbol: 'B2 / Ⅳ', label: '后部倒置拱形槽', toolType: '直边＋半圆底的倒置拱形棱柱', dragPlane: 'xy', target: '整体A的圆柱区', defaults: { x: 0.55, y: 2.43 }, axes: [
        { id: 'x', label: '圆弧槽 X', min: 0.25, max: 0.85, step: 0.02, unit: '格' },
        { id: 'y', label: '圆弧底 Y', min: 2.28, max: 2.58, step: 0.02, unit: '格' }
      ] },
      { id: 'cut-v', symbol: 'B3 / Ⅴ', label: '底板方形槽', toolType: '薄长方体刀具', dragPlane: 'xy', target: '整体A的底板区', defaults: { x: -1.62, y: 0.36 }, axes: [
        { id: 'x', label: '槽止端 X', min: -1.9, max: -1.25, step: 0.02, unit: '格' },
        { id: 'y', label: '槽中心 Y', min: 0.28, max: 0.44, step: 0.01, unit: '格' }
      ] }
    ],
    stages: [
      { label: 'Ⅰ+Ⅱ整体并集', action: '空心圆柱Ⅰ + 底板Ⅱ → 合并为封闭实体A', note: '圆柱与底板先做实体并集，接触处不保留重叠面和内部壳层。', visible: ['body'], appliedCutters: [], activeCutter: 'cut-iii', showCutter: false },
      { label: '切除Ⅲ前方槽', action: '方形刀具B1从前方进入整体A → A−B1', note: '主视图顶部的矩形缺口由前部方形刀具Ⅲ形成。', visible: ['body', 'cut-iii'], appliedCutters: ['cut-iii'], activeCutter: 'cut-iii' },
      { label: '切除Ⅳ倒置拱形槽', action: '直槽+半圆底刀具B2从后方进入 → A−B2', note: '教材称其为“后部倒置的拱形槽”：上部为直边、底部为半圆弧，二者组成一个封闭刀具。', visible: ['body', 'cut-iv'], appliedCutters: ['cut-iii', 'cut-iv'], activeCutter: 'cut-iv' },
      { label: '切除Ⅴ底板方槽', action: '薄方体B3从底板左端进入 → A−B3', note: 'Ⅴ作用于同一个整体A的底板区域，形成向左开口的水平方槽。', visible: ['body', 'cut-v'], appliedCutters: ['cut-iii', 'cut-iv', 'cut-v'], activeCutter: 'cut-v' },
      { label: '整体重投影', action: '隐藏刀具 → 对单一差集实体重新生成三视图', note: '最终只保留一个封闭结果实体，三视图不再混入相交壳层和多余接缝。', visible: ['body'], appliedCutters: ['cut-iii', 'cut-iv', 'cut-v'], showCutter: false }
    ],
    question: {
      prompt: '例5-6的“后部倒置拱形槽Ⅳ”应使用哪一种刀具体？',
      options: [
        { id: 'rounded-slot', label: '上部直槽与下部半圆弧组成的封闭刀具' },
        { id: 'cylinder-only', label: '只有一个横向圆柱' },
        { id: 'plate-only', label: '只切底板的薄方体' }
      ],
      answer: 'rounded-slot',
      evidence: '图5-16c及图5-17d显示Ⅳ形成倒圆形槽：槽口上部保持直边，底部才是圆弧，不能用单独圆柱代替。'
    }
  }
]);

export function getCompoundLesson(id) {
  return COMPOUND_LESSONS.find(lesson => lesson.id === id) || COMPOUND_LESSONS[0];
}

function initialCutterValues(lesson) {
  return Object.fromEntries((lesson.cutters || []).map(cutter => [cutter.id, { ...cutter.defaults }]));
}

function initialAssemblyOffsets(lesson) {
  return Object.fromEntries((lesson.assembly?.parts || []).map(part => [part.id, { x: 0, y: 0, z: 0 }]));
}

export function createCompoundLessonState(lesson = COMPOUND_LESSONS[0]) {
  const firstStage = lesson.stages[0];
  const displayDefaults = lesson.displayDefaults || {};
  return {
    lessonId: lesson.id,
    stageIndex: 0,
    explode: 0,
    isolatedComponent: null,
    selectedAnswer: null,
    evaluated: false,
    parameters: Object.fromEntries((lesson.parameters || []).map(parameter => [parameter.id, parameter.default])),
    cutterValues: initialCutterValues(lesson),
    activeCutterId: firstStage.activeCutter || lesson.cutters?.[0]?.id || null,
    appliedCutters: [...(firstStage.appliedCutters || [])],
    showCutter: firstStage.showCutter !== false,
    assemblyOffsets: initialAssemblyOffsets(lesson),
    detachedComponents: [],
    activeAssemblyId: lesson.assembly?.parts?.find(part => !part.fixed)?.id || null,
    display: {
      shadows: displayDefaults.shadows !== false,
      boldEdges: Boolean(displayDefaults.boldEdges),
      transparent: Boolean(displayDefaults.transparent),
      showHidden: displayDefaults.showHidden !== false
    },
    pointPickEnabled: false,
    pickedPoint: null
  };
}

export function clampStageIndex(lesson, index) {
  return Math.max(0, Math.min(lesson.stages.length - 1, Number(index) || 0));
}

export function visibleIdsForState(lesson, state) {
  if (state.isolatedComponent) return [state.isolatedComponent];
  const ids = new Set(lesson.stages[clampStageIndex(lesson, state.stageIndex)].visible);
  if (!state.showCutter) {
    (lesson.cutters || []).forEach(cutter => ids.delete(cutter.id));
  }
  if (state.showCutter && state.activeCutterId) ids.add(state.activeCutterId);
  return [...ids];
}

export function evaluateCompoundAnswer(lesson, selectedAnswer) {
  return {
    exact: selectedAnswer === lesson.question.answer,
    expected: lesson.question.answer,
    selected: selectedAnswer || null
  };
}

export function validateCompoundLessons(lessons = COMPOUND_LESSONS) {
  const errors = [];
  const ids = new Set();
  lessons.forEach((lesson, lessonIndex) => {
    if (!lesson.id || !lesson.label || !lesson.title || !lesson.source || !lesson.aiInput) errors.push(`第${lessonIndex + 1}个例题定义不完整`);
    if (!lesson.source.includes('第5章')) errors.push(`${lesson.id}没有引用第5章来源`);
    if (ids.has(lesson.id)) errors.push(`例题id重复：${lesson.id}`);
    ids.add(lesson.id);
    if (!Array.isArray(lesson.components) || lesson.components.length < 2) errors.push(`${lesson.id}缺少组合体构件`);
    if (!Array.isArray(lesson.stages) || lesson.stages.length < 2) errors.push(`${lesson.id}缺少形成步骤`);
    if (!Array.isArray(lesson.cutters) || lesson.cutters.length < 1) errors.push(`${lesson.id}缺少可交互切除体`);
    const componentIds = new Set();
    (lesson.components || []).forEach(component => {
      if (componentIds.has(component.id)) errors.push(`${lesson.id}构件id重复：${component.id}`);
      componentIds.add(component.id);
    });
    const cutterIds = new Set((lesson.cutters || []).map(cutter => cutter.id));
    cutterIds.forEach(cutterId => {
      if (!componentIds.has(cutterId)) errors.push(`${lesson.id}切除体${cutterId}没有对应构件`);
    });
    (lesson.stages || []).forEach((stage, stageIndex) => {
      if (!stage.label || !stage.action || !Array.isArray(stage.visible) || stage.visible.length === 0) errors.push(`${lesson.id}第${stageIndex + 1}步不完整`);
      stage.visible.forEach(componentId => {
        if (!componentIds.has(componentId)) errors.push(`${lesson.id}第${stageIndex + 1}步引用未知构件${componentId}`);
      });
      (stage.appliedCutters || []).forEach(cutterId => {
        if (!cutterIds.has(cutterId)) errors.push(`${lesson.id}第${stageIndex + 1}步应用未知切除体${cutterId}`);
      });
    });
    (lesson.cutters || []).forEach(cutter => {
      if (!cutter.defaults || !cutter.dragPlane || !cutter.axes?.length) errors.push(`${lesson.id}切除体${cutter.id}缺少拖动参数`);
      cutter.axes?.forEach(axis => {
        if (!(axis.id in cutter.defaults)) errors.push(`${lesson.id}切除体${cutter.id}缺少${axis.id}默认值`);
        if (cutter.defaults[axis.id] < axis.min || cutter.defaults[axis.id] > axis.max) errors.push(`${lesson.id}切除体${cutter.id}的${axis.id}默认值越界`);
      });
    });
    (lesson.parameters || []).forEach(parameter => {
      if (parameter.default < parameter.min || parameter.default > parameter.max) errors.push(`${lesson.id}参数${parameter.id}默认值越界`);
      if (parameter.textbook !== parameter.default) errors.push(`${lesson.id}参数${parameter.id}未以教材值为默认值`);
    });
    if (lesson.assembly) {
      const assemblyIds = new Set();
      lesson.assembly.parts?.forEach(part => {
        if (assemblyIds.has(part.id)) errors.push(`${lesson.id}装配构件id重复：${part.id}`);
        assemblyIds.add(part.id);
        if (!componentIds.has(part.id)) errors.push(`${lesson.id}装配构件${part.id}没有对应模型构件`);
        if (!part.fixed && (!Array.isArray(part.parkOffset) || part.parkOffset.length !== 3)) errors.push(`${lesson.id}装配构件${part.id}缺少拿开位置`);
      });
      if (!lesson.assembly.axes?.length) errors.push(`${lesson.id}装配台缺少位移轴`);
    }
    if (!lesson.question?.prompt || !lesson.question?.answer || lesson.question.options?.length < 2) errors.push(`${lesson.id}缺少例题判断`);
    if (!lesson.question?.options?.some(option => option.id === lesson.question.answer)) errors.push(`${lesson.id}答案不在选项中`);
  });
  return errors;
}
