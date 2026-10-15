# 虎钳拆装实验集成副本

此目录包含虎钳独立网页的原样生产包，供综合教学平台通过同源 iframe 打开。

- 来源：`D:/claude_work/20260721现代机械制图/02虎钳_解析工作/web_demo/dist`
- 复制日期：2026-10-15
- 来源仓库 HEAD：`8b120c3c8e7675b206c8fa5e3778cb9e7099f709`，2026-09-17，`拆卸完成后隐藏零件并排除点选`
- 原在线页面：https://syzhaoln-stack.github.io/vice-disassembly-lab/
- 保留功能：夹紧原理、拆装训练、自由取件。
- 此次集成未更改生产包的 HTML、JavaScript、CSS、GLB、机构参数或清单。

平台根目录的 `vice-lab.js` 导出 `createViceLab()`，返回 `enter()` 和 `leave()`。创建控制器只插入空的实验区；首次进入该栏目时才创建 iframe。离开时卸载 iframe，停止该文档的动画并释放它使用的 WebGL 资源。再次进入恢复初始状态，界面上已明确提示这一行为。

嵌入时，控制器为桌面窄高度窗口补充三行布局规则，避免原网页的手机横屏规则挤压模型画布；原生产包文件保持不变。

在平台主页面加载 `vice-lab.css`，导航按钮使用 `data-mode="vice"`。主程序切换模式时同步 `body.mode-vice` 并调用上述控制器。平台自身的渲染循环也应在此模式跳过渲染。

这里的资源路径全部是相对路径，兼容本地服务器、GitHub Pages 子路径以及现有 `tools/sites-vite-plugin.ts` 将整个 `assets` 目录复制进发布包的方式。

## 复制校验

复制后逐文件核对 SHA-256，以下六个文件与源目录完全一致：

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `index.html` | 7672 | `0A55768787EE08AE4E6A9A59346A7B0302742C2346EBAC4AE4611305ABB97C3A` |
| `manifest.webmanifest` | 369 | `4F92D7A64D952BF45DC9E86CBF8A35BB4D614DFB0114EFF99970CE5D8FBA68B8` |
| `assets/虎钳_assembled.glb` | 2319040 | `3C587B9C62ED43574A29CCB26BD2A99179315B0413B99F5B316996641B158E9B` |
| `assets/index-BTxU4EvJ.js` | 645750 | `1898C26EE93E2A57066AD4BEBBE108F07CF90AF86542F34356B9382C28883AEC` |
| `assets/index-CpqBsHik.css` | 15625 | `89B48A625FCE1765654134F6D5DD33AF5E6E73252AB2FA537384BD45BDF64C8F` |
| `assets/mechanism.json` | 11180 | `A61A2B14F18147F9FE15E2E0B2E01390BC0D0637DB71D42A99DCB89FDC9B7293` |

后续更新应先在原虎钳项目完成生产构建和交互验证，再整体替换这六个文件，更新来源版本与校验记录。
