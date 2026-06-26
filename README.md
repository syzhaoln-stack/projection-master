# Projection Master v6

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
- OBJ / STL local import.
- Responsive: narrow screens collapse the side panels into floating drawers.
- Spatial quiz mode: one view -> two views -> three views, candidates gradually reduce to one answer.

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
