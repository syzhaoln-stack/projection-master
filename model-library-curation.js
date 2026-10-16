import { BRIDGE_CATALOG } from './bridge-models.js';
import { DETAILED_BRIDGE_CATALOG } from './detailed-bridges.js';

// Select for drawing instruction; keep the complete registries for old links.
const bridgeSelection = [
  ['beamBridge', '单跨箱梁桥', '从整体轮廓辨认箱梁、桥台与支承'],
  ['textbook_girder_tree', '树形支承梁桥', '观察分叉支承在三个方向的重合'],
  ['archBridge', '提篮拱桥', '立面看拱轴，端视看双拱内收'],
  ['textbook_arch_inclined', '单侧倾拱桥', '从俯视与端视辨认拱的横向倾斜'],
  ['textbook_hybrid_arch', '上承式梁—拱桥', '比较桥面在拱上、拱下的位置关系'],
  ['cableStayedFan', '扇形索斜拉桥', '与竖琴形同尺度，比较索的斜率与重合'],
  ['cableStayedHarp', '竖琴形索斜拉桥', '平行索与扇形索的投影对照'],
  ['suspension', '地锚式悬索桥', '区分曲线主缆、竖直吊杆与桥塔'],
  ['textbook_stayed_spatial', '空间曲线斜拉桥', '进阶：曲线桥面、偏置塔与空间索']
];
const drawingSelection = [
  ['drawing_bago', 'Bago 河桥 · 斜拉桥', '单索面、独柱塔与三室箱梁；含教学简化'],
  ['drawing_nrg', '新河峡谷桥 · 上承式拱桥', '双拱桁架与拱上立柱；拱轴为图面采样'],
  ['drawing_forth', 'Forth 公路桥 · 悬索桥', '进阶：密集吊杆与加劲桁架，宜放大单件观察']
];
function select(catalog, rows) {
  return Object.freeze(rows.map(([id, name, focus]) => {
    const source = catalog.find(item => item.id === id);
    if (!source) throw new Error(`未注册的精选模型：${id}`);
    return Object.freeze({ ...source, name, focus });
  }));
}
export const CURATED_BRIDGE_CATALOG = select(BRIDGE_CATALOG, bridgeSelection);
export const CURATED_DRAWING_CATALOG = select(DETAILED_BRIDGE_CATALOG, drawingSelection);
export const ARCHIVED_BRIDGE_IDS = Object.freeze(BRIDGE_CATALOG
  .filter(item => !CURATED_BRIDGE_CATALOG.some(selected => selected.id === item.id)).map(item => item.id));
