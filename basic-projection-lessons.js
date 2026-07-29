export const LAB_LESSONS = Object.freeze([
  {
    id: 'projection',
    shortLabel: '投影',
    label: '投影形成',
    title: '投影是怎样形成的',
    kicker: '3.1 投影法的基本知识',
    status: '比较中心投影、斜投影与正投影'
  },
  {
    id: 'point',
    shortLabel: '点',
    label: '点的投影',
    title: '一个空间点的三个投影',
    kicker: '3.2.1 点的投影',
    status: '验证长对正、高平齐、宽相等'
  },
  {
    id: 'line',
    shortLabel: '线',
    label: '直线的投影',
    title: '直线方位与投影长度',
    kicker: '3.2.2 直线的投影',
    status: '判断实长、缩短与积聚'
  },
  {
    id: 'plane',
    shortLabel: '面',
    label: '平面的投影',
    title: '平面方位与投影形状',
    kicker: '3.2.3 平面的投影',
    status: '判断实形、类似形与积聚'
  },
  {
    id: 'relation',
    shortLabel: '关系',
    label: '相对位置',
    title: '点、线、面的相对位置',
    kicker: '3.3 基本几何元素的相对位置',
    status: '用多个视图共同判断空间关系'
  }
]);

export const PROJECTION_TYPES = Object.freeze([
  { id: 'central', label: '中心投影' },
  { id: 'oblique', label: '平行投影·斜投影' },
  { id: 'orthographic', label: '平行投影·正投影' }
]);

export const LINE_PRESETS = Object.freeze([
  { id: 'general', label: '一般位置线' },
  { id: 'front-parallel', label: '正平线' },
  { id: 'front-perpendicular', label: '正垂线' }
]);

export const PLANE_PRESETS = Object.freeze([
  { id: 'general', label: '一般位置面' },
  { id: 'horizontal', label: '水平面' },
  { id: 'front-perpendicular', label: '正垂面' }
]);

export const RELATION_PRESETS = Object.freeze([
  { id: 'point-on-line', label: '点在线上' },
  { id: 'line-in-plane', label: '直线在平面内' },
  { id: 'skew-lines', label: '两直线交叉' }
]);

export function createLabState() {
  return {
    lessonId: 'projection',
    projectionType: 'orthographic',
    point: { x: 1.35, y: 0.85, z: 1.25 },
    linePreset: 'general',
    planePreset: 'general',
    relationPreset: 'point-on-line',
    selectedAnswers: [],
    evaluated: false,
    resultExact: null,
    variant: 0
  };
}

export function getLabLesson(id) {
  return LAB_LESSONS.find(lesson => lesson.id === id) || LAB_LESSONS[0];
}

function viewLabel(view) {
  return view === 'front' ? '主视图' : view === 'top' ? '俯视图' : '左视图';
}

function viewChoices(extra = []) {
  return [
    { id: 'front', label: '主视图' },
    { id: 'top', label: '俯视图' },
    { id: 'side', label: '左视图' },
    ...extra
  ];
}

export function getLabQuestion(state, analysis = {}) {
  if (state.lessonId === 'projection') {
    if (state.projectionType === 'central') {
      return {
        type: 'single',
        prompt: '观察投射线：它们是否相互平行？',
        choices: [{ id: 'yes', label: '相互平行' }, { id: 'no', label: '汇聚于投影中心' }],
        answer: ['no'],
        evidence: '中心投影的投射线都通过同一个投影中心，因此不会相互平行。'
      };
    }
    const orthographic = state.projectionType === 'orthographic';
    return {
      type: 'single',
      prompt: '当前平行投射线与投影面是否垂直？',
      choices: [{ id: 'yes', label: '垂直' }, { id: 'no', label: '倾斜' }],
      answer: [orthographic ? 'yes' : 'no'],
      evidence: orthographic
        ? '正投影中，平行投射线垂直于投影面。'
        : '斜投影中，投射线彼此平行，但与投影面倾斜。'
    };
  }

  if (state.lessonId === 'point') {
    return {
      type: 'multiple',
      prompt: '只增大点 A 的高度 z，哪些投影的竖向位置会改变？',
      choices: viewChoices(),
      answer: ['front', 'side'],
      evidence: '主视图和左视图的竖向坐标都来自高度 z；俯视图只表达 x 与 y，因此不随高度改变。'
    };
  }

  if (state.lessonId === 'line') {
    const entries = Object.entries(analysis.lineViews || {});
    const accumulated = entries.filter(([, value]) => value.classification === 'collapsed').map(([view]) => view);
    if (accumulated.length) {
      return {
        type: 'multiple',
        prompt: '哪一个视图中的直线投影积聚为点？',
        choices: viewChoices(),
        answer: accumulated,
        evidence: `${accumulated.map(viewLabel).join('、')}的观察方向与直线方向平行，所以直线投影积聚为点。`
      };
    }
    const trueLength = entries.filter(([, value]) => value.classification === 'true-length').map(([view]) => view);
    return {
      type: 'multiple',
      prompt: trueLength.length ? '哪些视图反映了直线实长？' : '当前直线的三个投影中，是否有视图反映实长？',
      choices: viewChoices([{ id: 'none', label: '都不反映实长' }]),
      answer: trueLength.length ? trueLength : ['none'],
      evidence: trueLength.length
        ? `${trueLength.map(viewLabel).join('、')}所在投影面与直线平行，因此投影长度等于实长。`
        : '一般位置直线同时倾斜于三个投影面，三个投影都比实长短。'
    };
  }

  if (state.lessonId === 'plane') {
    const entries = Object.entries(analysis.planeViews || {});
    const trueShape = entries.filter(([, value]) => value.classification === 'true-shape').map(([view]) => view);
    const accumulated = entries.filter(([, value]) => value.classification === 'collapsed').map(([view]) => view);
    if (trueShape.length) {
      return {
        type: 'multiple',
        prompt: '哪一个视图反映了平面的实形？',
        choices: viewChoices(),
        answer: trueShape,
        evidence: `${trueShape.map(viewLabel).join('、')}的投影面与该平面平行，因此投影保留真实形状和大小。`
      };
    }
    return {
      type: 'multiple',
      prompt: accumulated.length ? '哪些视图中的平面投影积聚为线？' : '当前平面的三个投影具有什么共同特征？',
      choices: accumulated.length
        ? viewChoices()
        : [{ id: 'similar', label: '均为缩小的类似形' }, { id: 'true', label: '均反映实形' }, { id: 'line', label: '均积聚为线' }],
      answer: accumulated.length ? accumulated : ['similar'],
      evidence: accumulated.length
        ? `${accumulated.map(viewLabel).join('、')}所在投影面与该平面垂直，所以平面投影积聚为线。`
        : '一般位置平面对三个投影面都倾斜，三个投影均为缩小的类似形。'
    };
  }

  const relation = analysis.relation?.kind || state.relationPreset;
  const relationContent = {
    'point-on-line': {
      prompt: '综合三个视图判断：点 A 是否在直线 BC 上？',
      choices: [{ id: 'yes', label: '点 A 在线 BC 上' }, { id: 'no', label: '点 A 不在线 BC 上' }],
      answer: ['yes'],
      evidence: '点 A 的三个投影分别位于直线 BC 的三个同名投影上，且对应参数一致，因此点 A 在线 BC 上。'
    },
    'line-in-plane': {
      prompt: '综合三个视图判断：直线 DE 是否位于平面 α 内？',
      choices: [{ id: 'yes', label: '直线在平面内' }, { id: 'no', label: '直线不在平面内' }],
      answer: ['yes'],
      evidence: '直线 DE 的两个端点都位于平面 α 内，因此整条直线位于该平面内。'
    },
    'skew-lines': {
      prompt: '主视图中看似相交的两条直线，在空间中是什么关系？',
      choices: [{ id: 'intersect', label: '相交' }, { id: 'parallel', label: '平行' }, { id: 'skew', label: '交叉' }],
      answer: ['skew'],
      evidence: '主视图中的交点在俯视图和左视图中没有同一对应点；两直线既不平行也不共面，因此是交叉直线。'
    }
  };
  return { type: 'single', ...relationContent[relation] };
}

export function validateLabLessons() {
  const errors = [];
  const ids = new Set();
  LAB_LESSONS.forEach((lesson, index) => {
    if (!lesson.id || !lesson.label || !lesson.title || !lesson.kicker) errors.push(`第 ${index + 1} 个实验定义不完整`);
    if (ids.has(lesson.id)) errors.push(`实验 id 重复：${lesson.id}`);
    ids.add(lesson.id);
  });
  return errors;
}
