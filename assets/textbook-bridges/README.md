# 教材桥梁模型接入

本目录保存当前桥梁教材的 20 种米制教学模型；几何版本为 2026-09-26，接入日期为 2026-10-15。源文件来自：

`D:/claude_work/20260727_桥梁工程教材/申报数字化教材/数字教材全书初稿/interactive/bridge-office`

`model.js` 和 `mobility.js` 原样复制，指纹在 `source-manifest.json` 中。模型属于原创教学变体及注明来源的教学重建，不是统一精度的实桥竣工模型。来源书页、概念依据与模型假设分别保留；未复制书籍图片或外部材质。

## 接口

项目根目录 `bridge-models.js` 导出：

- `BRIDGE_CATALOG`：20 项 `{id, name, family, note, sourceId}`，供模型树和入口生成。
- `BRIDGE_MODELS[id]`：`{name, note, build}`，`build()` 返回新的 Three.js `Group`。
- `buildTextbookBridge(sourceId, options)`：按源模型编号生成，可接受空间斜拉桥原有参数。

旧入口对应关系：`beamBridge → girder_reference`、`archBridge → arch_basket`、`cableStayedFan → stayed_fan`、`cableStayedHarp → stayed_harp`、`suspension → suspension_ground`。其余入口为 `textbook_<sourceId>`；旧节点模型独立保留。

## 几何和语义

物理坐标为米制，X 顺桥、Y 横桥、Z 向上。仅通过 `bridgePointToThree(x,y,z) → (x,z,-y)` 转换一次，源坐标不修改。完成态结构在外层 Group 上统一缩放，使最大包围盒尺寸为 5，居中并落在显示基面。缩放值和缩放前包围盒分别保存在 `root.userData.displayScale` 与 `physicalBoundsThree_m`。三个方向比例一致，未放大索径。

每个构件保留一个独立网格，`mesh.userData.component_id` 是源唯一 ID，`label` 为中文源名称，`category`、`stage`、`sourceIds` 和 `sourcePart` 保留语义及原始米制数据。`mesh.name` 使用已有题库支持的类别，如 `stay_cable`、`main_cable`、`arch_rib`；无法准确对应旧类别的钢带、撑杆等保留中文名称。不要通过显示名称代替稳定 ID。

只显示完成态桥梁结构、永久支承锚固及原有栏杆。人物、车辆、环境、道路家具和临时施工构件不进入显示网格。圆管采用六边环截面，完整保留每个源中心线采样点、半径和连接布置；没有合并不同构件、减少中心线站点或改变工程尺度。

## 核验

执行 `node --test tests/textbook-bridges.test.mjs`。测试覆盖 20 模型的实际顶点与法线有限性、源构件完整性、唯一 ID、完成态过滤、统一缩放、坐标映射、全部管线站点、直杆端点、箱体尺寸与方向、旧斜拉索问答、源文件指纹及重复生成的状态独立性。

`dimension-contract.json` 只保留本模块需要的桥型尺寸和参数合同。`source-manifest.json` 保留源目录、指纹、模型假设和概念来源。数值测试不替代主平台中的实际视图、构件点选和投影显示验收；模型不包含结构承载力验算。
