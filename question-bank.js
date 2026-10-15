export const QUESTION_BANK = Object.freeze([
  {
    id: 'first-angle-step-top', modelId: 'step', title: '第一角投影的位置', skill: '第一角投影展开', difficulty: 1, type: 'single',
    views: ['front', 'top', 'side'], showHidden: false,
    prompt: '展开投影面后，俯视图相对于主视图应位于什么位置？',
    options: [{ id: 'top', label: '主视图上方' }, { id: 'bottom', label: '主视图下方' }, { id: 'left', label: '主视图左侧' }, { id: 'right', label: '主视图右侧' }],
    answer: ['bottom'], evidence: '第一角投影中，水平投影面向下翻转后，俯视图位于主视图下方。', hint: '先观察水平投影面绕交线翻转的方向，再看它停在主视图的哪一侧。', misconception: 'first-angle-layout', reflection: '哪一个动作帮助你确定了俯视图的位置？'
  },
  {
    id: 'through-hole-axis', modelId: 'throughHolePlate', title: '孔轴与圆形投影', skill: '轴线方向与投影形状', difficulty: 1, type: 'single',
    views: ['front', 'top', 'side'], showHidden: false,
    prompt: '要把通孔直接看成圆，观察方向应当怎样？',
    options: [{ id: 'along-axis', label: '沿孔轴线方向观察' }, { id: 'perpendicular-axis', label: '垂直孔轴线方向观察' }, { id: 'any-direction', label: '任意方向都能看成圆' }],
    answer: ['along-axis'], evidence: '圆孔的端面只有在视线与孔轴线平行时才呈圆形；垂直孔轴线观察时，孔表现为轮廓或隐藏线。', hint: '先在三维模型中找到孔的中心线，再让视线与这条线比较。', misconception: 'axis-orientation', reflection: '你用孔轴线、圆轮廓还是中心线作出了判断？'
  },
  {
    id: 'slot-hidden-line', modelId: 'slottedBlock', title: '槽底的线型', skill: '隐藏线判断', difficulty: 2, type: 'single',
    views: ['front', 'top', 'side'], showHidden: false,
    prompt: '关闭隐藏线后，请预测：槽底在被实体遮挡的视图中恢复显示时应采用什么线型？',
    options: [{ id: 'visible', label: '粗实线或细实线' }, { id: 'hidden', label: '虚线' }, { id: 'center', label: '中心线' }],
    answer: ['hidden'], evidence: '槽底是真实边，但在该观察方向被外部实体遮挡；工程图用虚线表达不可见轮廓。', hint: '先旋转模型确认槽底是否真实存在，再判断从该方向是否能直接看见它。', misconception: 'hidden-vs-visible-line', revealHiddenAfterSubmit: true, reflection: '决定线型的是边是否存在，还是该方向能否看见它？'
  },
  {
    id: 'bearing-seat-barrel', modelId: 'bearingSeat', focusComponent: 'barrel', title: '圆筒的表达方向', skill: '构件—视图对应', difficulty: 2, type: 'single',
    views: ['front', 'top', 'side'], showHidden: true,
    prompt: '已高亮轴承座圆筒。哪个信息最能帮助你确定它在不同视图中为何有时是圆、有时是矩形轮廓？',
    options: [{ id: 'axis', label: '圆筒轴线的方向' }, { id: 'color', label: '圆筒在三维模型中的颜色' }, { id: 'shadow', label: '三维模型表面的明暗' }],
    answer: ['axis'], evidence: '圆筒的投影形状由观察方向与轴线的关系决定，而非模型颜色或渲染明暗。', hint: '点击或观察高亮圆筒，比较它的轴线与三个投影方向。', misconception: 'feature-correspondence', reflection: '你在哪一个视图中最先确认了圆筒轴线的方向？'
  },
  {
    id: 'view-insufficiency-hole', modelId: 'throughHolePlate', title: '单视图的信息边界', skill: '图样信息充分性', difficulty: 2, type: 'single',
    views: ['front'], showHidden: false,
    prompt: '只看到一个圆形轮廓时，能否确定它一定是通孔？',
    options: [{ id: 'yes', label: '能，圆形一定表示通孔' }, { id: 'no', label: '不能，还需其他视图、剖视或尺寸' }, { id: 'irrelevant', label: '不能，圆形与三维结构无关' }],
    answer: ['no'], evidence: '同心圆或圆形轮廓还可能表示凸台、沉孔或回转体端面；必须结合其他视图、剖视和尺寸判断。', hint: '想一想：除了通孔，哪些机械特征也可能在一个方向投影为圆？', misconception: 'insufficient-evidence', reflection: '若要确认该圆代表通孔，你还会请求哪一类图样信息？'
  },
  {
    id: 'parameter-hole-change', modelId: 'throughHolePlate', title: '局部参数修改后的核对', skill: '参数变化与保持条件', difficulty: 3, type: 'multiple',
    views: ['front', 'top', 'side'], showHidden: true,
    prompt: '孔径增大、孔中心位置不变。下列哪些项目应随之更新？（可多选）',
    options: [{ id: 'hole-outline', label: '有关视图中的孔轮廓或隐藏线' }, { id: 'diameter-dimension', label: '孔的直径尺寸' }, { id: 'centerline-position', label: '孔中心线的位置' }, { id: 'outer-profile', label: '未关联的外轮廓尺寸' }],
    answer: ['hole-outline', 'diameter-dimension'], evidence: '孔的几何轮廓和直径标注随孔径改变；孔中心位置与未关联外轮廓应保持不变，修改后还需复查所有相关视图。', hint: '把“孔径改变”和“中心不变”分别转化为应改变与应保持的对象。', misconception: 'parameter-propagation', reflection: '除工程图外，你还会在模型或装配中检查什么？'
  },
  {
    id: 'rotate-to-front', modelId: 'throughHolePlate', title: '旋转至主视方向', skill: '空间旋转与视图匹配', difficulty: 1, type: 'rotate-to-view',
    views: ['front', 'top', 'side'], showHidden: true, targetView: 'front', targetDirection: [0, 0, 1], toleranceDegrees: 7,
    prompt: '拖动三维模型，将视线旋至与主视图一致的正交方向；出现“已对正”后提交。', evidence: '正交视图由固定观察方向决定。模型外形与主视图卡片匹配时，说明视线已与主视方向一致。', hint: '不要找标准视图按钮。先追踪孔轴线和外轮廓，观察哪一个方向正在缩短并最终积聚。', misconception: 'view-direction-rotation', reflection: '你用外轮廓、孔轴线还是高度关系确认了主视方向？'
  },
  {
    id: 'bridge-rotate-plan', modelId: 'beamBridge', title: '把梁桥转到平面方向', skill: '桥梁坐标与平面投影', difficulty: 1, type: 'rotate-to-view',
    views: ['front', 'top', 'side'], showHidden: false, targetView: 'top', targetDirection: [0, 1, 0], toleranceDegrees: 6,
    prompt: '不使用标准视图按钮，拖动梁桥直到视线沿竖向观察，桥高被积聚，只留下桥向与横桥向的平面关系。', evidence: '平面图保留桥向与横桥向，竖向高度在投影方向上被压缩；能主动对准说明学生把坐标方向与视图联系了起来。', hint: '先找桥墩的竖向，再让这条方向在画面里逐渐缩短；不要靠背诵“俯视图在上面”。', misconception: 'bridge-plan-direction', reflection: '你用桥墩、桥面宽度还是桥跨方向确认了平面？'
  },
  {
    id: 'bridge-rotate-elevation', modelId: 'cableStayedFan', title: '把斜拉桥转到立面方向', skill: '桥梁坐标与立面投影', difficulty: 2, type: 'rotate-to-view',
    views: ['front', 'top', 'side'], showHidden: false, targetView: 'front', targetDirection: [0, 0, 1], toleranceDegrees: 6,
    prompt: '换成斜拉桥后再次无提示旋转：让横桥向被积聚，在画面中保留桥向与竖向，能够直接看见塔高和拉索斜率。', evidence: '立面图保留桥向与竖向，因此塔高、跨径和拉索斜率可直接比较；横桥向宽度不能由这一张图单独确定。', hint: '观察双索面是否逐渐重合；当横桥向积聚时，桥塔和同一纵向位置的拉索会落到立面关系中。', misconception: 'bridge-elevation-direction', reflection: '哪一个构件的重合最能证明你已经沿横桥向观察？'
  },
  {
    id: 'bridge-rotate-section', modelId: 'beamBridge', title: '把梁桥转到横断面方向', skill: '桥梁坐标与横断面投影', difficulty: 2, type: 'rotate-to-view',
    views: ['front', 'top', 'side'], showHidden: false, targetView: 'side', targetDirection: [1, 0, 0], toleranceDegrees: 6,
    prompt: '再次换目标：让桥向长度被积聚，在画面中保留横桥向与竖向，形成桥面、主梁和桥墩的横断面关系。', evidence: '横断面保留横桥向和竖向，桥长在视线方向上被压缩；这一视图负责核对桥宽、梁间距、横坡和断面构件关系。', hint: '先追踪最长的桥向边，让它在画面中逐渐缩短；真正对准时，远近两个桥墩会趋于重合。', misconception: 'bridge-section-direction', reflection: '你通过哪一条长边或哪一组重合关系确认了横断面？'
  },
  {
    id: 'click-model-barrel', modelId: 'bearingSeat', title: '点击圆筒构件', skill: '三维构件识别', difficulty: 1, type: 'click-model',
    views: ['front', 'top', 'side'], showHidden: true, targetComponents: ['barrel'],
    prompt: '在左侧三维模型上点击轴承座中部的圆筒构件。', evidence: '圆筒构件的轴线方向决定其在三视图中是圆形端面还是矩形轮廓；先准确识别实体构件，才能建立视图对应。', hint: '圆筒位于两块支承板之间，具有连续的圆柱形外表面。', misconception: 'component-identification', reflection: '你通过形状、位置还是相邻构件识别出该圆筒？'
  },
  {
    id: 'click-hidden-line', modelId: 'slottedBlock', title: '图上找隐藏线', skill: '不可见轮廓识读', difficulty: 2, type: 'click-projection',
    views: ['front', 'top', 'side'], showHidden: true, targetView: 'front',
    hotspots: [{ id: 'hidden-region', shape: 'rect', u: 0.36, v: 0.42, width: 0.28, height: 0.16 }, { id: 'outer-profile', shape: 'rect', u: 0.05, v: 0.72, width: 0.22, height: 0.12 }], answer: ['hidden-region'],
    prompt: '在右侧主视图中点击表示槽底不可见轮廓的虚线区域。', evidence: '槽底边真实存在，但被实体遮挡时必须用虚线表达；外轮廓则用可见实线。', hint: '先从三维模型确认槽底位置，再在主视图中寻找位于外轮廓内部的断续线。', misconception: 'hidden-line-location', reflection: '你如何区分了内部隐藏轮廓与外部可见轮廓？'
  },
  {
    id: 'mark-hole-diameter', modelId: 'throughHolePlate', title: '定位孔径标注', skill: '尺寸标注定位', difficulty: 2, type: 'mark-dimension',
    views: ['front', 'top', 'side'], showHidden: true, targetView: 'top', dimensionKind: 'diameter',
    hotspots: [{ id: 'hole-dimension', shape: 'circle', u: 0.50, v: 0.50, radius: 0.18 }, { id: 'outer-size', shape: 'rect', u: 0.08, v: 0.06, width: 0.24, height: 0.13 }], answer: ['hole-dimension'],
    prompt: '在右侧俯视图中点击应放置孔径尺寸标注的圆孔特征。', evidence: '直径尺寸应指向圆孔的圆形投影，并以直径符号表达；外轮廓尺寸不能替代孔径尺寸。', hint: '沿孔轴线方向观察时，通孔呈圆形；先在三维模型中确认这一观察方向。', misconception: 'diameter-dimension-placement', reflection: '为什么孔径尺寸应关联圆形投影，而不是外轮廓？'
  }
]);

export function getQuestionById(id) {
  return QUESTION_BANK.find(question => question.id === id) || null;
}

const CHOICE_TYPES = new Set(['single', 'multiple']);

function hasHotspotShape(hotspot) {
  if (!hotspot?.id || !Number.isFinite(hotspot.u) || !Number.isFinite(hotspot.v)) return false;
  if (hotspot.shape === 'circle') return Number.isFinite(hotspot.radius) && hotspot.radius > 0;
  return hotspot.shape === 'rect' && Number.isFinite(hotspot.width) && Number.isFinite(hotspot.height) && hotspot.width > 0 && hotspot.height > 0;
}

export function validateQuestion(question) {
  const errors = [];
  if (!question?.id) errors.push('题目缺少 id');
  if (!question?.modelId) errors.push('题目缺少 modelId');
  if (!question?.prompt) errors.push('题目缺少题干');
  if (!Array.isArray(question?.views) || question.views.length === 0) errors.push('题目缺少可用视图');
  if (!question?.evidence) errors.push('题目缺少图学证据说明');
  if (!question?.misconception) errors.push('题目缺少常见误判代码');

  if (CHOICE_TYPES.has(question?.type)) {
    if (!Array.isArray(question?.options) || question.options.length < 2) errors.push('题目至少需要两个选项');
    if (!Array.isArray(question?.answer) || question.answer.length === 0) errors.push('题目缺少答案');
    const optionIds = new Set((question?.options || []).map(option => option.id));
    if (optionIds.size !== (question?.options || []).length) errors.push('选项 id 重复');
    (question?.answer || []).forEach(answer => { if (!optionIds.has(answer)) errors.push(`答案 ${answer} 不在选项中`); });
    if (question?.type === 'single' && question.answer?.length !== 1) errors.push('单选题只能有一个答案');
    return errors;
  }

  if (question?.type === 'rotate-to-view') {
    if (!Array.isArray(question.targetDirection) || question.targetDirection.length !== 3) errors.push('旋转题缺少目标观察方向');
    if (!Number.isFinite(question.toleranceDegrees) || question.toleranceDegrees <= 0 || question.toleranceDegrees > 45) errors.push('旋转题缺少有效角度容差');
  } else if (question?.type === 'click-model') {
    if (!Array.isArray(question.targetComponents) || question.targetComponents.length === 0) errors.push('三维点击题缺少目标构件');
  } else if (question?.type === 'click-projection' || question?.type === 'mark-dimension') {
    if (!question.targetView) errors.push('投影视图点击题缺少目标视图');
    if (!Array.isArray(question.hotspots) || question.hotspots.length === 0 || question.hotspots.some(hotspot => !hasHotspotShape(hotspot))) errors.push('投影视图点击题缺少有效热点');
    if (!Array.isArray(question.answer) || question.answer.length === 0) errors.push('投影视图点击题缺少答案');
    const hotspotIds = new Set((question.hotspots || []).map(hotspot => hotspot.id));
    (question.answer || []).forEach(answer => { if (!hotspotIds.has(answer)) errors.push(`答案 ${answer} 不在热点中`); });
  } else {
    errors.push('题目类型不受支持');
  }
  return errors;
}

export function validateQuestionBank(questionBank = QUESTION_BANK) {
  const ids = new Set();
  const errors = [];
  questionBank.forEach(question => {
    if (ids.has(question.id)) errors.push(`题目 id 重复：${question.id}`);
    ids.add(question.id);
    validateQuestion(question).forEach(error => errors.push(`${question.id}：${error}`));
  });
  return errors;
}
