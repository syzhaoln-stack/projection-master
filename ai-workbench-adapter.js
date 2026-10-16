import { GEOMETRY_VARIATION_PARAMETERS } from './ai-geometry-variation.js';
import { validateEditPlan } from './ai-edit-protocol.js';

export function createAiWorkbenchAdapter({ getMode, getModelId, getModelLabel, getRevision,
  getCompound, getVariation, setVariation, rebuild, getEditContext = () => null, getFacts = () => undefined }) {
  function getContext() {
    const mode = getMode();
    if (mode === 'compound') {
      const context = getCompound()?.getAiContext();
      if (!context?.active) return null;
      return { ...context, conversationId: `compound:${context.lesson.id}`, modelFacts: getFacts(context),
        description: context.parameters.length
          ? '调整本步骤已经作用于实体的孔、槽或切割参数。“格”为教学模型坐标单位，不代表原图实际毫米尺寸。'
          : '请先选择含切割的构建步骤，再修改对应的孔、槽或切割参数。',
        example: context.parameters.length ? `例如：把“${context.parameters[0].label}”改为 ${context.parameters[0].min}${context.parameters[0].unit}。` : '先选择含切割的构建步骤。'
      };
    }
    const modelId = getModelId();
    if (mode !== 'explore') return null;
    const values = getVariation(modelId) || {};
    const editContext = getEditContext(modelId, values);
    const readOnly = ['imported', 'chapter5'].includes(modelId);
    return {
      targetId: `explore:${modelId}:${getRevision()}`,
      conversationId: `explore:${modelId}`,
      label: getModelLabel(),
      modelFacts: getFacts(),
      description: editContext?.description || (readOnly ? '可以结合当前模型与三视图讲解、识别和提出建模建议；此模型暂未开放可执行尺寸修改。' : '可以讲解当前模型与三视图。整体几何比例练习：纵向、横向、竖向分别缩放，会一起改变构件截面。原图纸尺寸仅供对照；暂不支持单独改桥面、索塔或新增构件。'),
      parameters: editContext?.parameters || (readOnly ? [] : GEOMETRY_VARIATION_PARAMETERS.map(p => ({ ...p, value: values[p.key] ?? p.value }))),
      example: editContext?.example || (editContext?.parameters?.length
        ? '桥面加宽 2 米，塔高保持不变，索再密一些。也可以先解释这座桥的三视图。'
        : '解释当前模型的孔槽、三视图对应关系，以及教材中的表达方法。')
    };
  }
  function applyPlan(plan) {
    const mode = getMode();
    const modelId = getModelId();
    const compound = mode === 'compound' ? getCompound() : null;
    const sameScope = () => getMode() === mode && (mode === 'compound'
      ? getCompound() === compound : getModelId() === modelId);
    const currentContext = () => sameScope() ? getContext() : null;
    const context = getContext();
    const checked = validateEditPlan(plan, context);
    const changes = checked.changes.filter(c => context.parameters.find(p => p.key === c.key).value !== c.value);
    if (!changes.length) throw new Error('没有参数变化，实体保持原状。');
    if (currentContext()?.targetId !== checked.targetId) throw new Error('模型或步骤已变化，请重新生成修改方案。');
    let restore;
    if (mode === 'compound') {
      const result = compound.applyAiParameters({ contextKey: context.contextKey, targetId: context.targetId, lessonId: context.lesson.id, changes });
      if (!result.changed || !result.snapshot) throw new Error('没有参数变化，实体保持原状。');
      restore = () => compound.restoreAiSnapshot(result.snapshot);
    } else {
      const previous = { ...(getVariation(modelId) || {}) };
      const next = { ...previous, ...Object.fromEntries(changes.map(c => [c.key, c.value])) };
      function replace(values, rollback) {
        try {
          setVariation(modelId, { ...values });
          // This callback only rebuilds geometry/projections; it must not fit the camera.
          rebuild();
        } catch (error) {
          try {
            setVariation(modelId, { ...rollback });
            if (sameScope()) rebuild();
          } catch (rollbackError) {
            const failure = new AggregateError([error, rollbackError], '模型重建失败，恢复也未完成。请重新选择模型后再试。');
            failure.rollbackFailed = true;
            throw failure;
          }
          throw error;
        }
      }
      replace(next, previous);
      restore = () => replace(previous, next);
    }
    const appliedContext = currentContext();
    let afterTarget = appliedContext?.targetId;
    const valuesKey = value => JSON.stringify(value?.parameters.map(({ key, value }) => [key, value]));
    const appliedValues = valuesKey(appliedContext);
    let used = false;
    return {
      get targetId() { return afterTarget; },
      restore() {
        const current = currentContext();
        if (used || !current || current.targetId !== afterTarget || valuesKey(current) !== appliedValues) {
          throw new Error('模型或步骤已变化，请勿在其他状态下撤销。');
        }
        try {
          restore();
          used = true;
        } catch (error) {
          const rolledBack = currentContext();
          if (!error.rollbackFailed && rolledBack && valuesKey(rolledBack) === appliedValues) {
            // A successful rollback may increment the model revision. Keep this
            // unconsumed undo valid for exactly that recovered model state.
            afterTarget = rolledBack.targetId;
          } else used = true;
          throw error;
        }
      }
    };
  }
  return { getContext, applyPlan };
}
