// Mechanical source examples first, then the curated bridge practice.
// No fixed UV hotspots: every item is a choice, a view direction, or a real bridge mesh.
export const QUESTION_BANK = Object.freeze([
  {
    "id": "textbook-flange-first-angle",
    "modelId": "textbookFlange",
    "title": "第一角投影的位置",
    "skill": "第一角投影展开",
    "difficulty": 1,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "《现代机械制图》例7-3 · 图7-23～7-29",
    "prompt": "展开三投影面后，四肋轮盘的俯视图应位于主视图的哪一侧？",
    "options": [
      {
        "id": "above",
        "label": "上方"
      },
      {
        "id": "below",
        "label": "下方"
      },
      {
        "id": "left",
        "label": "左侧"
      },
      {
        "id": "right",
        "label": "右侧"
      }
    ],
    "answer": [
      "below"
    ],
    "evidence": "第一角投影展开后，俯视图位于主视图下方，左视图位于主视图右侧。",
    "hint": "水平投影面绕与正面投影面的交线向下展开。",
    "misconception": "first-angle-layout"
  },
  {
    "id": "textbook-flange-counterbore",
    "modelId": "textbookFlange",
    "title": "沉孔与通孔",
    "skill": "孔系识读",
    "difficulty": 2,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例7-3 · 图7-23～7-29",
    "prompt": "轮盘的四个外围安装孔在俯视图中各有两个同心圆，它们对应什么结构？",
    "options": [
      {
        "id": "counterbore",
        "label": "上部较大的柱形沉孔与下部较小的通孔"
      },
      {
        "id": "two-holes",
        "label": "两个并排的独立通孔"
      },
      {
        "id": "solid-boss",
        "label": "没有孔的实心凸台"
      }
    ],
    "answer": [
      "counterbore"
    ],
    "evidence": "每个安装孔上部有φ30、深3 mm的柱形沉孔，下部保留较小通孔，形成同轴台阶。",
    "hint": "从上方观察孔口，再检查较大圆孔下面是否有环形台阶。",
    "misconception": "counterbore-vs-through-hole"
  },
  {
    "id": "textbook-oblique-cut-front",
    "modelId": "textbookObliqueCylinder",
    "title": "正垂斜截面的投影",
    "skill": "平面积聚投影",
    "difficulty": 2,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例4-8 · 图4-9",
    "prompt": "本例顶部斜截面在主视图中积聚成什么？",
    "options": [
      {
        "id": "line",
        "label": "一条斜线"
      },
      {
        "id": "circle",
        "label": "一个圆"
      },
      {
        "id": "true-ellipse",
        "label": "截面椭圆的实形"
      }
    ],
    "answer": [
      "line"
    ],
    "evidence": "截平面垂直于正面投影面，因此斜截面在主视图中积聚为斜线。",
    "hint": "正垂面在正面投影中具有积聚性。",
    "misconception": "plane-edge-on-projection"
  },
  {
    "id": "textbook-slot-tongue-width",
    "modelId": "textbookSlotCylinder",
    "title": "槽宽与舌宽",
    "skill": "截切构造对应",
    "difficulty": 2,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例4-9 · 图4-10",
    "prompt": "顶部贯穿槽与底部中央舌的宽度有什么关系？",
    "options": [
      {
        "id": "equal",
        "label": "相等，由同一对侧平面确定"
      },
      {
        "id": "double",
        "label": "槽宽是舌宽的两倍"
      },
      {
        "id": "independent",
        "label": "两者没有共同边界位置"
      }
    ],
    "answer": [
      "equal"
    ],
    "evidence": "顶部槽两侧与底部中央舌两侧采用同一对平行侧平面，槽宽与舌宽相等。",
    "hint": "比较主视图中槽口两条侧边与中央舌两条侧边的左右位置。",
    "misconception": "slot-tongue-correspondence"
  },
  {
    "id": "textbook-keyway-blind",
    "modelId": "textbookKeyedShaft",
    "title": "键槽是否贯穿",
    "skill": "盲槽与通槽",
    "difficulty": 1,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例7-2 · 图7-21～7-22",
    "prompt": "轴上的圆头键槽是否切穿整个轴身？",
    "options": [
      {
        "id": "blind",
        "label": "没有，槽底保留材料"
      },
      {
        "id": "through",
        "label": "切穿轴身，上下相通"
      },
      {
        "id": "open-ends",
        "label": "沿轴向切通两个端面"
      }
    ],
    "answer": [
      "blind"
    ],
    "evidence": "轴径20 mm，键槽深3.5 mm；槽底有材料，且两端封闭。",
    "hint": "观察槽底，以及槽的两端与轴端面之间是否仍有材料。",
    "misconception": "blind-vs-through-slot"
  },
  {
    "id": "textbook-keyway-total-length",
    "modelId": "textbookKeyedShaft",
    "title": "圆头槽的总长",
    "skill": "尺寸关系",
    "difficulty": 2,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》图7-22",
    "prompt": "键槽宽6 mm，两端半圆的圆心距为14 mm。键槽总长是多少？",
    "options": [
      {
        "id": "14",
        "label": "14 mm"
      },
      {
        "id": "17",
        "label": "17 mm"
      },
      {
        "id": "20",
        "label": "20 mm"
      },
      {
        "id": "26",
        "label": "26 mm"
      }
    ],
    "answer": [
      "20"
    ],
    "evidence": "两端半圆各伸出一个半径3 mm，总长为14+3+3=20 mm。",
    "hint": "圆心距不包含两端伸出的两个半径。",
    "misconception": "slot-length-vs-center-distance"
  },
  {
    "id": "textbook-valve-stepped-bore",
    "modelId": "textbookValveAdapter",
    "title": "中央阶梯孔",
    "skill": "内外轮廓区分",
    "difficulty": 2,
    "type": "multiple",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》图10-42～10-43",
    "prompt": "哪些尺寸属于阀体接头的中央阶梯通孔？（可多选）",
    "options": [
      {
        "id": "25",
        "label": "φ25 主通孔"
      },
      {
        "id": "43",
        "label": "背部φ43、深6 mm的扩大孔"
      },
      {
        "id": "38",
        "label": "φ38 管颈外径"
      },
      {
        "id": "14",
        "label": "法兰四个φ14安装孔"
      }
    ],
    "answer": [
      "25",
      "43"
    ],
    "evidence": "中央孔由φ25通孔与背部φ43、深6 mm的扩大孔组成；φ38是管颈外径，φ14属于外围安装孔。",
    "hint": "区分中心轴线上的内孔、管颈外表面与外围孔系。",
    "misconception": "inner-outer-diameter"
  },
  {
    "id": "textbook51-cylinder-front",
    "modelId": "textbook51",
    "title": "圆筒孔的圆形投影",
    "skill": "轴线与投影形状",
    "difficulty": 1,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例5-1 · 图5-1～5-2",
    "prompt": "本例圆筒轴线沿前后方向，中央孔在哪个视图中呈圆形？",
    "options": [
      {
        "id": "front",
        "label": "主视图"
      },
      {
        "id": "top",
        "label": "俯视图"
      },
      {
        "id": "side",
        "label": "左视图"
      }
    ],
    "answer": [
      "front"
    ],
    "evidence": "主视方向与圆筒及中央孔的轴线平行，因此孔口投影为圆。",
    "hint": "从孔口沿轴线观察，圆形端面保持实形。",
    "misconception": "axis-orientation"
  },
  {
    "id": "textbook55-through-slot",
    "modelId": "textbook55",
    "title": "底部贯穿槽",
    "skill": "切除范围判断",
    "difficulty": 2,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例5-5 · 图5-14～5-15",
    "prompt": "当前最终实体的底部槽沿哪个方向贯通？",
    "options": [
      {
        "id": "left-right",
        "label": "沿左右方向贯通两端"
      },
      {
        "id": "front-back",
        "label": "沿前后方向贯通两侧"
      },
      {
        "id": "blind",
        "label": "不贯通，只有一端开口"
      }
    ],
    "answer": [
      "left-right"
    ],
    "evidence": "底部槽的切除长度覆盖基体全长，左右两端的槽口相通。",
    "hint": "对照主视图的长边与左视图中的槽口。",
    "misconception": "slot-cut-extent"
  },
  {
    "id": "textbook56-front-rear-slots",
    "modelId": "textbook56",
    "title": "前后槽口的区别",
    "skill": "前后遮挡关系",
    "difficulty": 2,
    "type": "single",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": true,
    "source": "《现代机械制图》例5-6 · 图5-16～5-17",
    "prompt": "空心圆柱前壁和后壁的槽口分别是什么形状？",
    "options": [
      {
        "id": "front-flat-rear-arc",
        "label": "前壁为方槽，后壁为倒置拱形槽"
      },
      {
        "id": "front-arc-rear-flat",
        "label": "前壁为倒置拱形槽，后壁为方槽"
      },
      {
        "id": "same-flat",
        "label": "前后均为方槽"
      }
    ],
    "answer": [
      "front-flat-rear-arc"
    ],
    "evidence": "切除体Ⅲ形成前壁方槽，切除体Ⅳ形成后壁倒置拱形槽，主视图须区分前后可见性。",
    "hint": "前壁槽底平直，后壁槽底带圆弧。",
    "misconception": "front-rear-slot-confusion"
  },
  {
    "id": "bridge-rotate-plan",
    "modelId": "beamBridge",
    "title": "梁桥的俯视方向",
    "skill": "空间旋转与俯视投影",
    "difficulty": 1,
    "type": "rotate-to-view",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "精选桥梁 · 单跨箱梁桥",
    "targetView": "top",
    "targetDirection": [
      0,
      1,
      0
    ],
    "toleranceDegrees": 6,
    "prompt": "拖动模型，从桥梁正上方向下观察；显示“已对正”后提交。",
    "evidence": "俯视图保留桥长与桥宽，桥高沿视线方向积聚。",
    "hint": "让竖直桥墩沿视线方向缩短。",
    "misconception": "bridge-plan-direction"
  },
  {
    "id": "bridge-rotate-elevation",
    "modelId": "cableStayedFan",
    "title": "斜拉桥的主视方向",
    "skill": "空间旋转与主视投影",
    "difficulty": 2,
    "type": "rotate-to-view",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "精选桥梁 · 扇形索斜拉桥",
    "targetView": "front",
    "targetDirection": [
      0,
      0,
      1
    ],
    "toleranceDegrees": 6,
    "prompt": "拖动模型，沿前方向后观察，使桥长与塔高保留、桥宽积聚；显示“已对正”后提交。",
    "evidence": "主视图保留桥向与竖向，能表达塔高和拉索斜率。",
    "hint": "观察前后两索面在立面方向的重合。",
    "misconception": "bridge-elevation-direction"
  },
  {
    "id": "bridge-rotate-section",
    "modelId": "beamBridge",
    "title": "梁桥的左视方向",
    "skill": "空间旋转与左视投影",
    "difficulty": 2,
    "type": "rotate-to-view",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "精选桥梁 · 单跨箱梁桥",
    "targetView": "side",
    "targetDirection": [
      -1,
      0,
      0
    ],
    "toleranceDegrees": 6,
    "prompt": "拖动模型，从桥梁左端沿桥向观察，使桥长积聚；显示“已对正”后提交。",
    "evidence": "左视方向从模型左侧向右观察，保留桥宽与高度。",
    "hint": "让桥向长边沿视线缩短，并确认观察位置在左端。",
    "misconception": "bridge-left-view-direction"
  },
  {
    "id": "bridge-click-tower",
    "modelId": "cableStayedFan",
    "title": "识别桥塔",
    "skill": "三维构件识别",
    "difficulty": 1,
    "type": "click-model",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "精选桥梁 · 扇形索斜拉桥",
    "targetComponents": [
      "tower"
    ],
    "prompt": "点击斜拉桥的一根桥塔塔柱。",
    "evidence": "桥塔高出桥面，斜拉索在塔上锚固。",
    "hint": "选择竖向塔柱，不选塔横梁或斜拉索。",
    "misconception": "bridge-tower-identification"
  },
  {
    "id": "bridge-click-stay",
    "modelId": "cableStayedFan",
    "title": "识别斜拉索",
    "skill": "三维构件识别",
    "difficulty": 1,
    "type": "click-model",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "精选桥梁 · 扇形索斜拉桥",
    "targetComponents": [
      "stay_cable"
    ],
    "prompt": "点击一根连接桥塔与桥面的斜拉索。",
    "evidence": "斜拉索从桥塔斜向连接主梁，与竖直塔柱及水平桥面不同。",
    "hint": "选择从塔上斜向桥面伸出的细长构件。",
    "misconception": "bridge-stay-identification"
  },
  {
    "id": "bridge-click-main-cable",
    "modelId": "suspension",
    "title": "识别悬索桥主缆",
    "skill": "主缆与吊杆区分",
    "difficulty": 2,
    "type": "click-model",
    "views": [
      "front",
      "top",
      "side"
    ],
    "showHidden": false,
    "source": "精选桥梁 · 地锚式悬索桥",
    "targetComponents": [
      "main_cable"
    ],
    "prompt": "点击悬索桥中跨呈下垂曲线的主缆。",
    "evidence": "主缆跨越桥塔并承接吊杆；吊杆是主缆与桥面之间的竖向细杆。",
    "hint": "选择连续弯曲的长索，不选一排竖直吊杆。",
    "misconception": "main-cable-vs-hanger"
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
