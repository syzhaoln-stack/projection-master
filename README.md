# Projection Master v7 · 工图投影大师

开发者：赵诗宇（大连交通大学） · szhao@djtu.edu.cn

在线访问：https://syzhaoln-stack.github.io/projection-master/

Do not open `index.html` by double-clicking it directly. This page uses JavaScript ES modules and Three.js imports, so it should be served through a local web server.

## What's new in v6

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

The tests cover quiz answer-state disclosure, answer evaluation, bridge component
semantics, format detection, OCCT mesh conversion, and a real STEP import of the
generated bearing-block fixture.

The fixture can be regenerated with CadQuery:

```text
python tools/generate-step-sample.py
```

STEP files are parsed locally in the browser with OpenCascade WebAssembly and then
triangulated for display and orthographic projection. This preserves the imported
shape for teaching and checking, but it does not recover a SolidWorks-style feature
tree or native parametric editing history.
