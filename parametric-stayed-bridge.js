import { buildModel } from './assets/textbook-bridges/model.js';
import { decorateMobility } from './assets/textbook-bridges/mobility.js';

/** Owned teaching generator. Canonical metres: x along bridge, y across, z up.
 * The vendor supplies source identity, stages and the unchanged default model.
 * Changed dimensions rebuild constituents; no presentation scale is applied.
 */
export const STAYED_PARAMETER_DEFINITIONS = Object.freeze([
  { key: 'mainSpan', label: '主跨（两塔轴线间距）', unit: 'm', min: 72, max: 144, step: 0.1, default: 96 },
  { key: 'deckWidth', label: '桥面总宽', unit: 'm', min: 6, max: 16, step: 0.1, default: 8 },
  { key: 'towerHeight', label: '桥面以上塔高', unit: 'm', min: 18, max: 45, step: 0.1, default: 28 },
  { key: 'cablesPerSide', label: '每塔每侧每索面索数', unit: '根', min: 4, max: 12, step: 1, default: 7 }
].map(Object.freeze));

export function isParametricStayedBridge(sourceId) {
  return sourceId === 'stayed_fan' || sourceId === 'stayed_harp';
}

export function normalizeStayedParameters(sourceId, values = {}) {
  if (!isParametricStayedBridge(sourceId)) throw new RangeError('仅扇形索与竖琴形索教学桥支持这些构件参数。');
  if (!values || typeof values !== 'object' || Array.isArray(values)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(values))) throw new TypeError('桥梁参数须为键值对象。');
  const keys = new Set(STAYED_PARAMETER_DEFINITIONS.map(definition => definition.key));
  for (const key of Reflect.ownKeys(values)) if (!keys.has(key)) throw new RangeError(`不支持的桥梁参数：${String(key)}`);
  return Object.fromEntries(STAYED_PARAMETER_DEFINITIONS.map(definition => {
    const value = Object.hasOwn(values, definition.key) ? values[definition.key] : definition.default;
    const steps = (value - definition.min) / definition.step;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < definition.min || value > definition.max
      || Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw new RangeError(`${definition.label}须为 ${definition.min} 至 ${definition.max} ${definition.unit}，步长 ${definition.step}。`);
    }
    return [definition.key, Number(value.toFixed(6))];
  }));
}

export function getStayedParameterContext(sourceId, values = {}) {
  const parameters = normalizeStayedParameters(sourceId, values);
  return {
    targetId: `stayed:${sourceId}:${Object.values(parameters).join(':')}`,
    label: sourceId === 'stayed_fan' ? '扇形索斜拉桥' : '竖琴形索斜拉桥',
    description: '可修改实际构件：主跨、桥面总宽、桥面以上塔高，以及每塔每侧每索面的索数。两塔、每塔两侧、双索面，总索数为该索数的 8 倍。边跨各为主跨的一半；桥面高程 7 m 与箱梁高 1.30 m 不变。加宽会同步移动索面、塔柱和锚点并重建横梁与支承；改塔高只改变塔柱、塔顶横梁及拉索塔端。截面厚度、索径和锚块尺寸保持原值。索型由当前模型决定；这是原教学桥的构件几何变体，参数范围不是工程设计许可。',
    parameters: STAYED_PARAMETER_DEFINITIONS.map(definition => ({ ...definition, value: parameters[definition.key] })),
    example: '例如：桥面改为 12 米宽，塔高改为桥面以上 35 米，每塔每侧每索面改为 9 根索。'
  };
}

const clone = value => structuredClone(value);
const sample = (fn, n) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
const DECK_Z = 7, DEPTH = 1.30, TOP = 0.18, BOTTOM = 0.12, WEB = 0.12;

export function buildParametricStayedBridge(sourceId, values = {}) {
  const parameters = normalizeStayedParameters(sourceId, values);
  const model = buildModel(sourceId);
  const unchanged = STAYED_PARAMETER_DEFINITIONS.every(definition => parameters[definition.key] === definition.default);
  const { mainSpan: main, deckWidth: width, towerHeight: height, cablesPerSide: count } = parameters;
  const length = main * 2, cableY = width / 2 - 0.5, towerOffset = 0.46;
  const spacing = main * (7 / 16) / count; // Keep a 1/16 main-span closure at both outer ends of each fan.
  const fan = sourceId === 'stayed_fan';
  const sourceSignature = model.geometrySignature;

  if (!unchanged) {
    const prototypes = new Map(model.parts.map(part => [part.id, part]));
    model.parts = []; model.members = []; model.panels = []; model.people = [];
    delete model.mobility;
    const stageAt = x => Math.min(...[-main / 2, main / 2].map(tower => Math.abs(x - tower))) < 5
      ? 1 : (Math.abs(x) < 5 || Math.abs(x) > length / 2 - 5 ? 3 : 2);
    const box = (id, label, category, material, stage, center, size, extra = {}) => {
      const part = { id, label, category, material, stage, shape: 'box', center, size, ...extra };
      model.parts.push(part); return part;
    };
    const tube = (id, label, category, material, stage, points, radius, extra = {}) => {
      const part = { id, label, category, material, stage, shape: 'tube', points, radius, ...extra };
      model.parts.push(part); return part;
    };
    const member = (part, kind, points = part.points, extra = {}) => {
      model.members.push({ id: part.id, label: part.label, kind, points, category: part.category, stage: part.stage, ...extra });
      return part;
    };
    const rod = (id, label, category, points, radius, stage, kind = 'beam', material = 'steel', extra = {}) =>
      member(tube(id, label, category, material, stage, points, radius, extra), kind, points, extra);

    // Straight box girder: change its spans/width, retaining each physical plate thickness.
    const n = Math.ceil(length / 3), dx = length / n, innerWidth = width - 0.8, clear = DEPTH - TOP - BOTTOM;
    model.deckPath = sample(t => [(t - 0.5) * length, 0, DECK_Z], n);
    for (let i = 0; i < n; i++) {
      const xa = -length / 2 + i * dx, xb = xa + dx, x = (xa + xb) / 2;
      const stage = stageAt(x), id = `deck-${String(i).padStart(3, '0')}`, axis = [1, 0, 0];
      box(id, '桥面板', 'deck', 'deck', stage, [x, 0, DECK_Z - TOP / 2], [dx + 0.015, width, TOP], { axis });
      model.panels.push({ id, label: '桥面板单元', corners: [[xa, -width / 2, DECK_Z], [xb, -width / 2, DECK_Z], [xb, width / 2, DECK_Z], [xa, width / 2, DECK_Z]], stage });
      box(`${id}-bottom`, '箱梁底板', 'girder', 'steel', stage, [x, 0, DECK_Z - DEPTH + BOTTOM / 2], [dx + 0.015, innerWidth, BOTTOM], { axis });
      for (const side of [-1, 1]) {
        const y = side * (innerWidth / 2 - WEB / 2);
        member(box(`${id}-web-${side}`, '箱梁腹板', 'girder', 'steel', stage,
          [x, y, DECK_Z - TOP - clear / 2], [dx + 0.015, WEB, clear], { axis }), 'beam', [[xa, y, DECK_Z - DEPTH / 2], [xb, y, DECK_Z - DEPTH / 2]]);
      }
    }
    let crossbeam = 0;
    for (let x = -length / 2; x <= length / 2 + 0.01; x += Math.max(4, length / 18)) {
      rod(`crossbeam-${crossbeam++}`, '箱梁横隔 / 锚固横梁', 'bracing', [[x, -innerWidth / 2, DECK_Z - DEPTH * 0.55], [x, innerWidth / 2, DECK_Z - DEPTH * 0.55]], 0.14, stageAt(x));
    }
    const towers = [-main / 2, main / 2], breaks = [-length / 2, ...towers.flatMap(x => [x - 0.8, x + 0.8]), length / 2];
    for (const side of [-1, 1]) {
      const y = side * (width / 2 - 0.1);
      for (const lift of [0.48, 1.1]) for (let j = 0; j < breaks.length - 1; j += 2) {
        const xa = breaks[j], xb = breaks[j + 1];
        tube(`handrail-${side}-${lift}-${j}`, '栏杆横杆 / 索塔处避让', 'railing', 'steel', 4,
          sample(t => [xa + (xb - xa) * t, y, DECK_Z + lift], Math.max(2, Math.ceil((xb - xa) / dx))), 0.034);
      }
      for (let i = 0; i <= n; i++) {
        const x = -length / 2 + i * dx;
        if (towers.some(tower => Math.abs(x - tower) < 0.8)) continue;
        tube(`railpost-${side}-${i}`, '栏杆立柱', 'railing', 'steel', 4, [[x, y, DECK_Z], [x, y, DECK_Z + 1.1]], 0.027);
      }
      for (const x of towers.flatMap(tower => [tower - 0.8, tower + 0.8])) {
        tube(`railpost-tower-${side}-${x}`, '索塔旁收口栏杆柱', 'railing', 'steel', 4, [[x, y, DECK_Z], [x, y, DECK_Z + 1.1]], 0.027);
      }
    }
    const support = (id, x) => {
      for (const suffix of ['-foot', '', '-bearing']) {
        const part = clone(prototypes.get(id + suffix));
        part.center[0] = x;
        // Keep source transverse margins, including bearing overlap with both tower feet.
        // Multiplying the source bearing width by W/8 would lose that overlap at W=16.
        part.size[1] += width - 8;
        model.parts.push(part);
      }
    };
    for (const side of [-1, 1]) support(`abutment-${side}`, side * length / 2);

    const groups = [];
    for (const tower of [-1, 1]) {
      const tx = tower * main / 2;
      support(`comparison-tower-pier-${tower}`, tx);
      for (const plane of [-1, 1]) {
        rod(`comparison-tower-${tower}-${plane}`, '同尺度双柱索塔', 'tower', [[tx, plane * cableY, DECK_Z - DEPTH], [tx, plane * cableY, DECK_Z + height]], 0.62, 1, 'beam', 'concrete');
        for (const side of [-1, 1]) {
          const cableIds = [];
          for (let j = 1; j <= count; j++) {
            const x = tx + side * j * spacing, bx = tx + side * towerOffset;
            const z = fan ? DECK_Z + height - 0.35 - (count - j) * 0.50
              : DECK_Z + 0.30 + (j * spacing - towerOffset) * (height - 0.65) / (count * spacing - towerOffset);
            const id = `stay-comparison-${tower}-${plane}-${side}-${j}`, a = [x, plane * cableY, DECK_Z + 0.30], b = [bx, plane * cableY, z];
            const stage = stageAt(x), extra = { plane, tower, side, fanIndex: j };
            rod(id, '斜拉索', 'cable', [a, b], 0.044, stage, 'cable', 'cable', extra);
            const seatId = `${id}-deck-anchor-seat`, seatBottom = DECK_Z - 0.08, seatTop = Math.max(DECK_Z + 0.10, a[2] - 0.44 / 2 + 0.06);
            box(`${id}-deck-anchor`, '梁端索锚块', 'anchor', 'steel', stage, a, [0.44, 0.44, 0.44], { deckAttachment: { surfaceZ: DECK_Z, seatId } });
            box(seatId, '索锚短座 / 连至桥面横梁', 'anchor', 'steel', stage, [a[0], a[1], (seatBottom + seatTop) / 2], [0.44 * 1.16, 0.44 * 1.16, seatTop - seatBottom]);
            box(`${id}-tower-anchor`, '塔端索锚区', 'anchor', 'steel', stage, b, [0.40, 0.40, 0.40]);
            cableIds.push(id);
            if (plane === -1) rod(`comparison-anchor-crossbeam-${tower}-${side}-${j}`, '成对索锚横梁', 'bracing', [[x, -cableY, DECK_Z - 0.50], [x, cableY, DECK_Z - 0.50]], 0.20, stage);
          }
          groups.push({ tower, plane, side, cableIds });
        }
      }
      rod(`comparison-tower-head-${tower}`, '塔顶横梁', 'tower', [[tx, -cableY, DECK_Z + height - 4.2], [tx, cableY, DECK_Z + height - 4.2]], 0.38, 1, 'beam', 'concrete');
      rod(`comparison-deck-link-${tower}`, '塔梁横向支承联系', 'bracing', [[tx, -cableY, DECK_Z - 0.7], [tx, cableY, DECK_Z - 0.7]], 0.30, 1, 'beam', 'concrete');
      for (const suffix of ['-base', '', '-brace']) {
        const part = clone(prototypes.get(`comparison-starter-${tower}${suffix}`));
        const shift = tower * (main - 96) / 2;
        if (part.center) part.center[0] += shift;
        if (part.points) part.points.forEach(point => { point[0] += shift; });
        model.parts.push(part);
      }
    }
    model.geometryContract.groups = groups;
    model.length = length; model.width = width;
    model.transverseBudget = { leftEdge: 0.7, pedestrianSpace: width - 1.4, rightEdge: 0.7, total: width };
    // Refresh source mobility at the new deck stations, then retain its 0.8 m
    // tower-to-walkway centreline allowance on either side of the clear corridor.
    model.assumptions = model.assumptions.filter(text => !/人物为原创圆润|连续通行包络用于观察/.test(text));
    decorateMobility(model);
    model.mobility.walkways[0].width = width - 2.6;
    model.assumptions = model.assumptions.filter(text => !/扇形与竖琴形比较共用|扇形索在塔顶|竖琴索按实际/.test(text));
    model.assumptions.push(`本构件参数变体采用 ${main / 2}+${main}+${main / 2} m 分跨、${width} m 桥宽、桥面以上 ${height} m 塔高；每塔每侧每索面 ${count} 根，总计 ${8 * count} 根斜拉索。`,
      fan ? `塔顶扇形锚固区高 ${(count - 1) * 0.5} m，独立锚具竖向间隔 0.50 m，增减索数时重建全部配套锚固。`
        : `每一方向的 ${count} 根竖琴索按塔端实际纵向偏置配置高度，严格平行；两侧在索塔不同纵向表面锚固。`,
      '主跨变化时两边跨各取其一半，主梁板厚、索径与锚具尺寸保留源模型值；支承横向保留源模型外伸与塔脚搭接。参数变化只验证几何连接，不重新设计截面或计算承载力。');
  }

  model.span = main; model.width = width; model.height = height; model.length = length;
  model.spanArrangement = [main / 2, main, main / 2];
  model.parameters = { ...parameters };
  model.parameterSchema = STAYED_PARAMETER_DEFINITIONS.map(definition => ({ ...definition }));
  model.optionsUsed = { ...parameters };
  model.geometryContract = {
    ...model.geometryContract, comparisonGroup: `fan-harp-${main}m`, mainSpan: main, sideSpan: main / 2,
    towerHeight: height, deckWidth: width, cableCount: 8 * count, cablePlanes: 2, cableAnchorY: cableY,
    railY: width / 2 - 0.1, towerAnchorOffset: towerOffset, fanAnchorZoneHeight: fan ? (count - 1) * 0.5 : null,
    cablesPerTowerPerSidePerPlane: count, cableStationSpacing: spacing,
    deckElevation: DECK_Z, girderDepth: DEPTH, spanDefinition: '主跨为两塔轴线间距；两端边跨各为主跨的一半。',
    parameterScope: 'owned constituent teaching geometry; no structural analysis'
  };
  model.sourceGeometrySignature = sourceSignature;
  model.revision = `1:parametric-stayed-1:${Object.values(parameters).join(':')}`;
  model.geometrySignature = `${sourceId}@${model.revision}`;
  return model;
}
