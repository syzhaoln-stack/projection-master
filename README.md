# Projection Master v8.5.0 · 工图投影大师

开发者：赵诗宇（大连交通大学） · szhao@djtu.edu.cn

公网入口：[工图投影大师](https://syzhaoln-stack.github.io/projection-master/?mode=explore&model=cableStayedFan)（2026-10-15 修订）。

## v8.5 · 看图、连续问答与构件改图

顶部“AI 助手”默认使用 **DeepSeek V4.1 Flash**。官方接口别名为 `deepseek-flash`，支持文本与视觉输入（[官方视觉说明](https://api-docs.deepseek.com/guides/vision/)，2026-10-15 核验）。

- 可讲解当前模型、构件和三视图，连续追问修改的影响。普通回答直接显示对话，不再出现空参数表。最近最多 8 条文字对话随请求发送；切换模型或例题开始新对话。以本轮实体事实和参数为准，不把尚未应用的方案当成已完成修改。
- 扇形索、竖琴形索两座斜拉桥支持真实构件参数：主跨 72–144 m、桥面总宽 6–16 m、桥面以上塔高 18–45 m、每塔每侧每索面 4–12 根索（全桥索数为该值的 8 倍）。默认分别为 96 m、8 m、28 m、7 根。桥面、塔柱、索面、锚点、横梁与支承按关联关系重建，保留截面厚度与索径。原始默认模型及教材来源文件保持原样。
- 例如“桥面加宽 2 米，塔高不变，索再密一些”：AI 可组合提出具体参数建议，解释假设和三视图变化，用户核对后应用。修改和撤销都保留相机及包裹/展开状态。
- 默认附上当前模型与三张正投影图，可先预览或取消勾选。第5章使用界面当前显示的精确 BRep/HLR 图；尚处在交互预览时明确标注。可另附 2 张 PNG/JPEG/WebP/GIF 图纸，每张不超过 6 MB；图片仅随本轮发送，不加入文字历史。
- AI 获得模型名称、可编辑参数、已有构件与尺寸事实、投影约定及选中构件。支持解释导入模型，但不会虚构其真实尺寸。图片可用于看图、讨论和辅助现有参数修改；尚不支持从任意图纸自动重建完整 CAD 或自由新增构件。
- 第5章仍使用已切入当前实体的孔、槽和刀具参数；其他模型保留整体比例操作。修改方案经目标、范围和步长校验后才能应用，AI 文本不作为代码执行。
- API 密钥只在页面内存中使用，刷新/离开时清除，不写入 Git、URL 或浏览器存储。发送时直接向 DeepSeek 官方接口提交问题、最近对话、模型事实及勾选/附上的图片；截图只取模型画布和投影图，不包含设置面板。

完整回归 244 项通过，包括模拟 API 响应、真实桥梁重建和三视投影、视觉附件与过期请求、连续问答和撤销，以及原有精确内核回归。最后增强导出图线宽与虚线清晰度后，相关界面/截图专项 35 项通过。浏览器核验了桥面/塔高/索数组合修改与撤销、四张当前视图预览、例5-6精确三视图栅格化。没有使用真实 API 密钥发起收费调用，服务实际回答仍需用户连接后验证。

## v8.4 · 初版文字改图记录

新增顶部“AI 改图”：输入 DeepSeek 官方 API 密钥与修改要求 → 生成参数方案 → 核对修改前后数值 → 应用到实体并重绘三视图 → 可撤销一次。模型与三视图的包裹/展开方式、当前相机方向和缩放保留。也可在“查看参数 / 手动调整”中走同一预览、应用、撤销流程，无需 API。

- 模型库：纵向、横向、竖向整体几何比例，范围 50%–150%。这是全体构件一起缩放的教学变体，会改变截面；不等同于单独修改桥面宽、索塔高或孔径。原图尺寸仅作对照。
- 第5章：仅修改当前步骤已经切入实体的孔、槽和刀具位置参数；由原布尔几何与精确投影流程同步更新。单位“格”为教学模型坐标，不承诺原图实际毫米尺寸。
- 第一版不支持凭图片重建、任意新增构件、虎钳零件改造或修改本地导入模型。超出参数范围的要求应返回说明，不直接改图。
- API 固定连接 `https://api.deepseek.com/chat/completions`，使用 `deepseek-flash` 与 JSON 输出。密钥只在当前页面内存中使用，刷新/离开后清除；不写入源码、Git、URL、浏览器存储或公共服务器。发给 DeepSeek 的内容仅为用户指令、当前模型名称、修改范围和参数表。
- AI 返回内容只按白名单数值校验，不能执行 JavaScript。参数越界、未知字段、模型/步骤变化会拒绝应用。AI 方案在点击应用前不会改变模型。

接入前源码检查点：[961fa5e](https://github.com/syzhaoln-stack/projection-master/commit/961fa5e88076ba8884a489f0cae49e07e8460f29)。未经实际 API 密钥验证的环境只运行模拟响应测试，不能据此声称真实调用成功。

本版验证：185 项测试通过，含真实几何变体、界面状态、API 模拟响应、例5-6全部128种参数边界组合和实际 OpenCascade/HLR。浏览器核验了预览、应用、撤销、保留展开状态，以及偏移拱形槽后的精确三视图；未进行带真实密钥的 API 调用。修复了原精确审计使用保守曲面包围盒和固定探针造成的误报，保留真实尺寸错误与前后槽交换的拒绝检查。

桥梁工程专项分支的构件接口、训练序列与测评边界见 [BRIDGE_SPATIAL_LAB.md](BRIDGE_SPATIAL_LAB.md)。

Do not open `index.html` by double-clicking it directly. This page uses JavaScript ES modules and Three.js imports, so it should be served through a local web server.

## v8.3 整合发布 · 2026-10-15

本轮 v8.3.1 修订：展开/合并只翻转投影面，保留用户的相机方向、目标与缩放；调整窗口及平铺切换也不自动归位。投影连线、中心线、坐标轴默认关闭，虚线与中心线分别控制。桥梁坐标按 X 纵桥、Y 横桥、Z 竖向标注，只绘制明确的特征中心轴。

第5章统一内核与显示坐标转换，修复例5-6前方槽和后拱槽交换、偏移后内壁残留台阶，并同步修复例5-5槽的深度位移、例5-1前孔与后立板方向。例5-5和例5-6的即时投影直接取自当前布尔实体；精算完成后由同一 BRep 接管实体和 HLR 三视图。103 项测试通过，其中新增检查实际运行 OpenCascade/WASM，而非仅匹配源码文本。

模型与三视图默认保持三个投影面包裹实体；按空格或“展开三视图”翻开，再按空格或“合并三视图”合回。单构件保持原位、同一比例，投影线随投影面翻转。平铺三视图仅作为手动选择的辅助方式。

发布分支为 `gh-pages`；v8.3.1 提交为 `237339391245de8236f4447158800fcb6b3729b3`，父提交为 v8.3 的 `b68de9f56fcb7feff574f5137908f5a71604b1e4`。本次仅更换首页、主程序和精确内核 worker 三项资源，复用模型与其他资源。主分支与原有开发分支的远端提交未改动。

当前版本在原有工图工作台内保留第3章投影基础、第5章组合体构形与空间练习，并接入以下模型：

- **20 种新版桥梁模型**：来自当前桥梁教材 `interactive/bridge-office`，几何源版本为 **2026-09-26**。桥型包括梁、拱、斜拉、悬索及组合体系；原米制坐标、中文构件名称与唯一 ID 保留，仅在显示根节点等比缩放。来源与尺寸见 `assets/textbook-bridges/`。
- **3 座按图纸重构的桥梁**：Bago 斜拉桥、Forth Road 悬索桥、New River Gorge 拱桥。可编辑工程与 GLB 建模源日期为 **2026-09-08**，网页优化资源形成于 2026-09-09；保持各自教学重构的尺寸来源与简化边界。
- **虎钳拆装**：嵌入 **2026-09-17** 交付网页，包含夹紧、14 步拆装、自动演示和自由取件。切换栏目后再次进入会重置虎钳实验；模型页提供独立打开入口。
- **第5章最新核心**：沿用原 `Projection-master` 的 Git 基线 **ff1c8a0244090f854c34443aaef1aeaa950815c7**，接入精确 BRep / HLR 重建和关联投影；第3章原有教学模块继续保留。第5章是组合体构形与切除实验，不把桥梁端视图当作已完成的实体剖切。

双击 **`start-projection-master.bat`** 打开 `http://127.0.0.1:5186/index.html`。启动器仅服务 **`dist/client`**；目录中已有构建就直接使用，缺少构建时执行 `npm run build`。首次构建前需安装项目依赖（`npm ci`）。修改源码后应先重新执行 `npm run build`，再打开启动器。

启动器会核对 5186 端口已有服务与本项目构建首页是否一致：一致时直接复用；不一致时提示端口冲突，不关闭其他服务。新服务只绑定 `127.0.0.1`，不会部署或发布到公网。服务由当前启动器创建时，在启动窗口按回车可停止；复用已有服务时不改变其生命周期。

不能再用旧方式把源目录直接交给普通静态服务器：新版精确内核包含需要 Vite 构建的包导入和 WASM 资源。`start-projection-master.ps1 -CheckOnly` 只核对现有构建与端口，不构建、不打开浏览器、不启动服务。

下列 v8.2 说明保留作为原功能和教材例题的记录；当前整合范围及启动方式以上述 v8.3 说明为准。

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
http://127.0.0.1:5186/index.html
```

The launcher serves `dist/client`, building it first if absent. Keep its window open when it starts a new server; press Enter there to stop that server. An already running matching preview is reused.

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
