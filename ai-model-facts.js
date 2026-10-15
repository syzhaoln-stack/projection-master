import { COMPONENT_INFO } from './learning-logic.js';
import drawingContracts from './assets/drawing-bridges/dimension-contract.json' with { type: 'json' };

// An explicit public-data projection, never a serialization of Object3D/userData.
const LIMITS = { components: 24, dimensions: 24, projectionNotes: 12 };
const LABELS = {
  ...Object.fromEntries(Object.entries(COMPONENT_INFO).map(([key, value]) => [key, value.label])),
  lower_block: '下层台阶块', middle_block: '中层台阶块', top_block: '上层台阶块',
  slotted: '开槽实体', rear_wall: '后立板', side_pad: '侧凸台', boss: '圆柱凸台',
  slot_left: '槽左侧实体', slot_right: '槽右侧实体', compound_rib: '连接肋板',
  bracing: '联系与支撑构件', railing: '栏杆构件', cable: '索构件', tower: '塔构件'
};
const DRAWING_DIMENSIONS = {
  modeled_length: '建模范围长度', deck_width: '桥面宽度', deck_outer_width: '桥面外缘宽度',
  tower_height_above_deck: '桥面以上塔高', box_depth: '箱梁高度',
  arch_span: '拱跨径', arch_rise: '拱矢高', arch_plane_spacing: '双拱肋中心间距',
  main_cable_sag: '主缆垂度', main_truss_spacing: '主桁架间距', main_truss_depth: '主桁架高度'
};
const PHYSICAL_UNITS = new Set(['m', 'mm', 'cm']);
const number = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, max = 200) => typeof value === 'string' ? value
  .replace(/\bsk-[a-z\d_-]+/gi, '[已隐去]')
  .replace(/\bBearer\s+\S+/gi, '[已隐去]')
  .replace(/(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+/gi, '[已隐去]')
  .replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
const point = value => Array.isArray(value) && value.length === 3 && value.every(number);

function inventory(root) {
  const nodes = [], entries = [], seen = new Set(), seenObjects = new Set();
  function visit(object, visible = true, owner = null) {
    if (!object || seenObjects.has(object) || object.isCamera || object.isLight) return;
    seenObjects.add(object);
    const data = object.userData || {};
    nodes.push(object);
    const shown = visible && object.visible !== false;
    const component = data.chapter5Id ? object : owner;
    const excluded = data.booleanTool || data.pickedPointMarker || data.compoundEdgeOverlay
      || data.projectionGuide || data.category === 'temporary'
      || (number(data.end_stage) && data.end_stage < 99);
    if (shown && object.isMesh && !excluded) {
      const entity = component || object, meta = entity.userData || {};
      const identity = component || meta.component_id || entity;
      if (!seen.has(identity)) {
        seen.add(identity);
        entries.push({ object: entity, data: meta, part: meta.sourcePart,
          id: text(meta.component_id || meta.chapter5Id || entity.name, 120) });
      }
    }
    for (const child of object.children || []) visit(child, shown && !excluded, component);
  }
  visit(root);
  return { nodes, entries };
}

function entryLabel(entry) {
  const { object, data, part, id } = entry;
  if (/^SteelTower_\d+_\d+$/.test(id) || /^Tower_\d+_\d+_\d+$/.test(id)) return '塔柱分节';
  if (/^Stay_/i.test(id) || /斜拉索/.test(part?.label || '')) return '斜拉索';
  if (/^Hanger_/i.test(id)) return '吊杆';
  if (/^MainCable/i.test(id)) return '主缆构件';
  if (part?.category === 'tower' && /索塔|塔柱|独塔|倾塔/.test(part.label || '') && !/横梁|支承|分叉/.test(part.label)) return '塔柱';
  const label = text(data.label || data.componentLabel || part?.label, 100);
  // Detailed GLB nodes sometimes use their unique ID as the label.
  if (label && label !== id) return label;
  if (LABELS[object.name]) return LABELS[object.name];
  if (label && /[\u3400-\u9fff]/.test(label)) return label;
  if (LABELS[data.category]) return LABELS[data.category];
  return '其他实体构件';
}

function towerCounts(entries) {
  const stations = new Set(), columns = new Set();
  for (const entry of entries) {
    let match = /^SteelTower_(\d+)_\d+$/.exec(entry.id);
    if (match) { stations.add(`drawing:${match[1]}`); columns.add(`drawing:${match[1]}`); continue; }
    match = /^Tower_(\d+)_(\d+)_\d+$/.exec(entry.id);
    if (match) { stations.add(`drawing:${match[1]}`); columns.add(`drawing:${match[1]}:${match[2]}`); continue; }
    if (entryLabel(entry) !== '塔柱') continue;
    const points = entry.part?.points;
    if (point(points?.[0])) {
      stations.add(points[0][0].toFixed(5));
      columns.add(entry.id || entry.object);
    }
  }
  return { groups: stations.size, columns: columns.size };
}

function addDimension(list, label, value, unit = 'm', reference = false) {
  if (!number(value) || !text(label) || !unit || list.length >= LIMITS.dimensions) return;
  const safeLabel = `${reference && PHYSICAL_UNITS.has(unit) ? '原型参考·' : ''}${text(label, 100)}`;
  if (list.some(item => item.label === safeLabel)) return;
  list.push({ label: safeLabel, value, unit });
}

function partDimensions(entry, units, reference) {
  const output = [], part = entry?.part;
  if (!PHYSICAL_UNITS.has(units)) return output;
  if (part?.shape === 'box' && point(part.size)) {
    ['构件局部长', '构件局部宽', '构件局部厚/高'].forEach((label, i) => addDimension(output, label, part.size[i], units, reference));
  }
  if (number(part?.radius)) addDimension(output, '截面半径', part.radius, units, reference);
  if (Array.isArray(part?.points) && part.points.length > 1 && part.points.every(point)) {
    const length = part.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - part.points[i][k])), 0);
    addDimension(output, '构件中心线长度', length, units, reference);
  }
  // Explicit engineering dimensions are accepted; display bounds and mesh scales are not.
  for (const item of Array.isArray(entry?.data.dimensions) ? entry.data.dimensions : []) {
    if (PHYSICAL_UNITS.has(item?.unit)) addDimension(output, item.label, item.value, item.unit, reference);
  }
  return output;
}

/** Current public model facts, suitable for the assistant's bounded context. */
export function collectModelFacts({ modelRoot, modelId, label, note, selectedComponent, mode, compoundContext } = {}) {
  const { nodes, entries } = inventory(modelRoot);
  const sourceNode = nodes.find(node => node.userData?.sourceModel);
  const source = sourceNode?.userData.sourceModel;
  const contract = source?.geometryContract || nodes.find(node => node.userData?.geometryContract)?.userData.geometryContract || {};
  const drawingNode = nodes.find(node => node.userData?.sourceBridgeId && node.userData?.sourceUnit === 'm');
  const drawing = drawingContracts.bridges.find(item => item.id === drawingNode?.userData.sourceBridgeId);
  const physicalUnits = source?.units || drawingNode?.userData.sourceUnit
    || nodes.find(node => PHYSICAL_UNITS.has(node.userData?.units))?.userData.units;
  const variation = nodes.find(node => node.userData?.geometryVariation)?.userData.geometryVariation;
  const reference = Boolean(variation);
  const compound = mode === 'compound' || Boolean(compoundContext) || nodes.some(node => node.userData?.chapter5Lesson);
  const bridge = Boolean(source || drawing || contract.mainSpan);
  const type = compound ? 'compound' : bridge ? 'bridge' : modelId === 'imported' ? 'imported' : 'mechanical';
  const title = text(label || source?.title || compoundContext?.lesson?.label || sourceNode?.userData.label, 120) || '当前模型';
  const counts = new Map();
  for (const entry of entries) {
    const name = entryLabel(entry);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const towers = towerCounts(entries);
  const components = [];
  if (towers.groups) components.push({ label: '主塔组', count: towers.groups, description: '按纵向塔位分组；一组可包含多根塔柱。' });
  if (towers.columns) components.push({ label: '塔柱', count: towers.columns, description: '连续塔柱数量；分节网格合并计数，不等同桥塔组数。' });
  for (const [name, count] of counts) {
    if (name === '塔柱' && towers.columns) continue;
    components.push({ label: name, count, description: '当前实体层级中的构件或建模分段数量。' });
  }
  const facts = {
    type,
    summary: `${title}。${bridge ? '桥梁教学模型' : compound ? '组合体构建教学模型' : '形体与三视图教学模型'}；当前实体层级统计 ${entries.length} 个构件或建模分段。`,
    components: components.slice(0, LIMITS.components), dimensions: [],
    projectionNotes: [
      '三视图对应规则：主视与俯视长对正，主视与左视高平齐，俯视与左视宽相等。',
      '正投影中，与投影面平行的平面呈真实形状；垂直的平面积聚成线，倾斜平面呈缩短形状。',
      '这些说明来自模型实体与投影规则；未读取当前图纸截图，不能据此断言某条线当前可见或被遮挡。'
    ]
  };
  const dim = (name, value, unit = 'm') => addDimension(facts.dimensions, name, value, unit, reference);
  if (source?.units === 'm') {
    dim('主跨跨径', contract.mainSpan ?? source.span);
    dim('桥面总长', source.length);
    dim('桥面宽度', contract.deckWidth ?? source.width);
    dim('主梁高度', source.girderDepth);
    dim('桥面板厚度', source.deckThickness);
    const spans = contract.spanArrangement || source.spanArrangement;
    if (Array.isArray(spans)) spans.slice(0, 6).forEach((span, i) => dim(`第${i + 1}跨跨径`, span));
    const towerParts = entries.filter(entry => entryLabel(entry) === '塔柱').flatMap(entry => entry.part?.points || []).filter(point);
    const towerHeight = contract.towerHeight ?? (towerParts.length && number(source.deckZ) ? Math.max(...towerParts.map(p => p[2])) - source.deckZ : undefined);
    dim('桥面以上塔高', towerHeight);
    dim('主缆垂度', contract.mainCableSag ?? source.cableSag);
    dim('索面数量', contract.cablePlanes, '面');
    if (counts.has('斜拉索')) dim('斜拉索数量', counts.get('斜拉索'), '根');
  } else if (drawing) {
    for (const parameter of drawing.parameters) {
      if (DRAWING_DIMENSIONS[parameter.key]) dim(DRAWING_DIMENSIONS[parameter.key], parameter.value, parameter.unit);
      if (parameter.key === 'span_layout' && Array.isArray(parameter.value)) {
        parameter.value.forEach((span, i) => dim(`第${i + 1}跨跨径`, span));
        dim('主跨跨径', Math.max(...parameter.value));
      }
    }
    if (counts.has('斜拉索')) dim('斜拉索数量', counts.get('斜拉索'), '根');
    facts.projectionNotes.push('图纸重构模型的尺寸来自随模型保存的尺寸约定；构件细节包含教学简化，不等同竣工测量。');
  } else if (bridge && PHYSICAL_UNITS.has(physicalUnits)) {
    dim('主跨跨径', contract.mainSpan, physicalUnits);
    dim('桥面宽度', contract.deckWidth, physicalUnits);
    dim('桥面以上塔高', contract.towerHeight, physicalUnits);
  }
  if (compound) {
    const step = compoundContext?.currentStep || compoundContext?.stage;
    if (text(step?.label)) {
      facts.currentStep = { label: text(step.label, 120) };
      if (text(step.description)) facts.currentStep.description = text(step.description, 300);
    }
    for (const parameter of compoundContext?.parameters || []) {
      if (parameter.applied === false) continue;
      const unit = ['格', '°', '%', 'm', 'mm', 'cm'].includes(parameter.unit) ? parameter.unit : '格';
      dim(parameter.label, parameter.value, unit);
    }
    facts.projectionNotes.push('组合体参数中的“格”是教学坐标单位，不代表原图毫米；按当前构建步骤解释已加入和已切除的实体。');
  }
  if (!bridge && !compound) {
    facts.projectionNotes.push('未声明实际工程单位；归一化显示范围和网格坐标不能当作米或毫米尺寸。');
    // Notes are model descriptions, not observations of the current rendered drawing.
    if (text(note)) facts.projectionNotes.push(`模型教学说明：${text(note, 300)}`);
  }
  if (bridge) facts.projectionNotes.push('桥梁立面表达纵向与高度，平面表达纵向与横向，沿桥向端视图表达横向与高度；端视投影不等于实体剖切。');
  if (counts.has('斜拉索') || counts.has('主缆构件')) facts.projectionNotes.push('索构件在不同视向可能重合；投影线条数量不能直接当作空间中的索根数。');
  if (reference) {
    facts.summary += ' 当前存在整体比例变体；列出的实体尺寸仅作原型参考，不是变体的精确工程尺寸。';
    facts.projectionNotes.push('整体比例同时改变构件位置与截面；原型参考尺寸不能直接用于当前变体的尺寸标注或工程验算。');
    for (const [key, name] of Object.entries({ lengthPercent: '纵向整体比例', widthPercent: '横向整体比例', heightPercent: '竖向整体比例' })) {
      dim(name, variation.parameters?.[key], '%');
    }
  }
  if (components.length > LIMITS.components) facts.projectionNotes.push('构件分类超过摘要上限；仅列前24类，摘要不是完整构件清单。');
  if (selectedComponent && nodes.includes(selectedComponent)) {
    let selected = entries.find(entry => entry.object === selectedComponent);
    for (let parent = selectedComponent.parent; !selected && parent && nodes.includes(parent); parent = parent.parent) selected = entries.find(entry => entry.object === parent);
    if (selected) {
      facts.selectedComponent = { label: text(selected.data.label || selected.part?.label, 120) || entryLabel(selected),
        type: text(selected.part?.category || selected.data.category || selected.data.operation || '实体构件', 60),
        description: '当前选中的实体构件；可比较其在三个正交投影中的对应位置。' };
      const dimensions = partDimensions(selected, source?.units || selected.data.units, reference);
      if (dimensions.length) facts.selectedComponent.dimensions = dimensions;
    }
  }
  facts.projectionNotes = facts.projectionNotes.slice(0, LIMITS.projectionNotes);
  return facts;
}
