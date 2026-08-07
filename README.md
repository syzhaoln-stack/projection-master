# Projection Master v8.2 · 工图投影大师

开发者：赵诗宇（大连交通大学） · szhao@djtu.edu.cn

在线访问：https://syzhaoln-stack.github.io/projection-master/

Do not open `index.html` by double-clicking it directly. This page uses JavaScript ES modules and Three.js imports, so it should be served through a local web server.

## What's new in v8.2

Chapter 5 is now a focused Boolean-cutting workbench with three representative
examples taken directly from the textbook:

- 例5-1（图5-1～图5-2）：按教材顺序叠加前角圆滑底板、拱顶立板、水平圆筒和矩形肋板；肋板只与圆筒下缘相切，中心孔与两个底板孔可分别显示、拖动和贯穿切除。
- 例5-5（图5-14～图5-15）：从完整四棱柱开始，依次完成正垂面 P 斜切、前后侧垂面 Q 切除及切除体Ⅲ开槽；B3 默认沿 X 向全长贯穿，也可用长度滑杆改为局部槽。
- 例5-6（图5-16～图5-17）：Ⅰ+Ⅱ叠加后，用Ⅲ形成前部方形槽、用“直槽+半圆底”刀具Ⅳ形成后部倒置拱形槽、用Ⅴ形成底板方形槽。

The Boolean workbench exposes the actual operands as `A − B`: choose a yellow cutter,
drag it directly in the 3D viewport or position it with sliders, execute/undo the
subtraction, hide the cutter, and compare the live result with synchronized first-angle
views. Mesh subtraction uses `three-bvh-csg`; textbook feature guides keep the generated
views free of CSG triangulation noise. Each example also supports reversible stages,
component isolation, exploded view, textbook parameters, and an evidence question.
Example 5-5 additionally provides shadow, bold-edge, transparency and hidden-line
switches, plus one-click 3D point picking linked to the front, left and top views.

The header keeps the Chapter 13.5 teaching chain visible: AI recognizes the feature
semantics and dimensions, CAD/SOLIDWORKS executes the corresponding feature operation,
and the platform reprojects the result for checking.

## Earlier workbench update

Professional CAD-style workbench UI (AutoCAD / SolidWorks feel): light-gray chrome,
Ribbon toolbar (文件 / 视图 / 投影 / 测评), left model tree, right properties panel,
and a bottom command/status bar. The 3D engine, projection logic and quiz scaffold
are unchanged — only the interface was rebuilt.

The model tree reserves a "桥梁结构" group (拱桥 / 斜拉桥 / 悬索桥 / 节点) as
placeholders for the next iteration, which will bring the bridge-engineering question
bank (per the 4 spatial dimensions in the research design).

## Features

- CAD-style Ribbon + model tree + properties panel layout.
- Built-in engineering drawing solids (mechanical, as the entry-level set).
- First-angle three-view unfold/merge.
- Hidden-line projection rendering.
- STEP / STP / OBJ / STL / GLB / GLTF local import, followed by automatic three-view generation.
- Light model space and light engineering-view sheets; distance fog is disabled so zoomed-out models keep their contrast.
- Responsive: narrow screens collapse the side panels into floating drawers.
- Spatial quiz mode: students select and submit before explanations and the next view are revealed.
- Semantic component picking: highlight a named bridge component and generate its own three views.
- Active cable-stayed bridge task: identify a stay cable in 3D, then judge its most informative orthographic view.

## Recommended

Double-click:

```text
start-projection-master.bat
```

It will start a local server and open:

```text
http://127.0.0.1:5181/index.html
```

Keep the server window open while using the page.

## Tests

```text
npm install
npm test
```

The tests cover Chapter 3 projection logic, the three Chapter 5 textbook cases,
parameter defaults, draggable cutter contracts and Boolean order, quiz answer-state
disclosure, bridge component semantics, format detection, OCCT mesh conversion,
and a real STEP import of the generated bearing-block fixture.

The fixture can be regenerated with CadQuery:

```text
python tools/generate-step-sample.py
```

STEP files are parsed locally in the browser with OpenCascade WebAssembly and then
triangulated for display and orthographic projection. This preserves the imported
shape for teaching and checking, but it does not recover a SolidWorks-style feature
tree or native parametric editing history.
