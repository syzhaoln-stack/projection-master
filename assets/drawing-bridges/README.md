# 教材桥梁模型：工程制图入口

复制日期：2026-10-15。

本目录复用当前桥梁工程数字教材主源中的三座桥梁教学重构模型。GLB 文件完整原样复制；构件筛选和显示缩放仅发生在平台的 `detailed-bridges.js` 中。

| 平台编号 | 模型 | 主源文件 | 保留构件实例 | 排除构件实例 |
| --- | --- | --- | ---: | ---: |
| `drawing_bago` | Bago River Bridge，中央单索面斜拉桥 | `cable_stayed.glb` | 1626 | 156 |
| `drawing_forth` | Forth Road Bridge，悬索桥 | `suspension.glb` | 4329 | 420 |
| `drawing_nrg` | New River Gorge Bridge，上承式拱桥 | `arch.glb` | 1719 | 124 |

GLB 来源目录：

`D:/claude_work/20260727_桥梁工程教材/申报数字化教材/数字教材全书初稿/assets/bridge-lab/assets/models`

尺寸契约原样复制自：

`D:/claude_work/20260727_桥梁工程教材/申报数字化教材/三类桥梁_Blender_Godot_20260908/docs/dimension-contract.json`

尺寸契约保留原工程图纸/报告来源、页码、推导关系和教学假设。其 `local_file`、`model_file`、`blender_file` 相对路径指向原项目结构，相关原始 PDF 与 Blender 文件没有在本目录重复打包。模型用于教学重构，不等同完整竣工模型。例如 Forth 的外露锚固外形及部分细部保留原教学简化。

## 成桥筛选与坐标

- 保留原始米制几何、装配坐标、旋转、材质、纹理、`component_id` 和 `label`。
- GLB 已由 Blender 导出为 Y-up；不再进行 Z→Y 旋转。
- 本源项目的 `end_stage=99` 表示最终保留；`end_stage<99` 或 `08_Temporary` 施工临时件全部排除。
- `91_Traffic` 车辆配景及其他 9x 配景分类排除，不进入三视图。三份源文件没有单列人物分类。
- 桥面、加劲构造、栏杆、路灯、铺装等永久细节保留。
- 仅在最外层 Group 进行等比例缩放：包围盒最大边为平台 5 个显示单位，X/Z 居中，底面 Y=0。该显示比例不改写原始米制尺寸。
- `mesh.name` 采用现有选择系统识别的语义类型，例如 `stay_cable`、`hanger`、`arch_rib`；唯一编号仍在 `userData.component_id`，原节点名称在 `userData.sourceNodeName`。

## 加载接口

`detailed-bridges.js` 导出 `DETAILED_BRIDGE_CATALOG` 和 `DETAILED_BRIDGE_MODELS`。调用顺序：

```js
const definition = DETAILED_BRIDGE_MODELS.drawing_bago;
await definition.load();
const instance = definition.build();
```

首次 `load()` 从相对页面地址的 `assets/drawing-bridges/` 加载 GLB，并缓存原始 scene；并发调用复用同一请求，失败可重试。`build()` 创建独立场景、几何和材质副本；同一实例内部复用相同几何/材质的副本，避免重复占用内存。不可变纹理与源场景共享，平台现有清理只销毁实例几何和材质，因此不会破坏缓存。后续显示状态不得改写共享纹理。

异步模型选择的竞争控制由主程序处理：用户再次切换选择后，不应让较早请求覆盖当前选择。

## 检查记录

运行：

```text
node --check detailed-bridges.js
node tools/verify-detailed-bridges.mjs --write
```

实测记录见 `geometry-check.json`。检查覆盖：

- 三个 GLB 与原教材文件的 SHA-256 一致，尺寸契约与原文件一致。
- 使用真实 Three.js GLTFLoader 导入几何、构件元数据和场景层级。
- 源构件编号完整且无重复；原标签、米制位置、旋转、尺寸保持一致。
- 成桥筛选数量、三类结构语义构件、显示包围盒及底面位置正确。
- 并发加载只请求一次；清理实例不销毁缓存资源，重建包围盒无漂移。

Node 检查对图片解码使用占位对象，只验证几何与接口，不验证材质像素、三视图可读性、浏览器性能或鼠标交互。上述视觉与交互检查须在集成页面完成。
