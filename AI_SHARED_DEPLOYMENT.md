# 共享 AI 后台部署

**当前正式版本默认个人 API 模式，密钥输入框为空，由访客自行填写。共享后台未启用。** 按所有者最后的发布要求，已停止本机临时代理并移除正式构建中的共享接口地址。这里保留的是可选后台的部署说明，不表示正式网页依赖或启用了该服务。

GitHub Pages 继续托管静态网页。后台有两种运行方式：免登录的本机临时共享，以及需要登录的长期 Cloudflare Worker。两者复用 `wrangler.ai.jsonc` 和同一份安全代理、SQLite 配额逻辑。真实密钥只在后台加载，前端的 `VITE_AI_PROXY_URL` 只包含公开接口地址，不能包含密钥。

## 免登录：本机临时共享

需要临时共享体验时，启动器可从指定的项目外 TXT 读取官方密钥。无需 Cloudflare 账号或服务器登录，但电脑必须联网且后台进程持续运行；临时域名会随重新启动隧道改变。这不是长期服务器，也没有在线时长保证。该方式曾完成一次真实文本回应验证，随后按所有者要求停止，正式版本不使用它。[Cloudflare Quick Tunnels 官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

在项目目录启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-local-shared.ps1
```

也可用 `-KeyFile '其他项目外密钥文件路径'` 替换默认文件。启动器在后台运行，不弹出终端窗口。首次从 Cloudflare 官方 GitHub Release 下载固定的 Windows x64 `2026.10.1` 便携工具到 ignored `.cache/local-shared`，并按官方发布 API 已核验的 SHA-256 校验；不安装系统服务或设置自动启动。固定版本与校验值写在启动器中，重新启动不依赖 GitHub API 剩余额度。

启动器只在进程内读取密钥，再写入 ignored `.wrangler/local-shared/private/.dev.vars`，Windows 目录权限限定当前用户。该目录中的临时配置只引用原来的后台源文件，不包含静态资产。`.dev.vars` 是 Wrangler 官方支持的本地 secret 方式，不能提交到 Git。[本地 secret 配置](https://developers.cloudflare.com/workers/configuration/secrets/)

Worker、调试端口和网关均只绑定 `127.0.0.1`。临时隧道只连接网关；网关只放行两个精确路径 `/api/ai/status`、`/api/ai/chat`，其他路径、文件和 WebSocket 升级均拒绝。网关沿用配置中的精确网页 Origin 白名单，后台继续校验载荷、官方上游、Cloudflare IP 和持久配额；不建立绕过限额的第二套代理。网关在读取正文前限制最多 4 个在途请求；正文超过 30 秒会终止读取并释放名额。

查看 `.wrangler/local-shared/status.json`：`status: "running"`、`publicUrl`、`proxyUrl` 和进程号表示公网状态端点已确认 `ready:true`。状态文件不包含密钥。若 Node 的本机 DNS 无法解析新域名，启动器会用遵循本机 HTTP 代理设置的 PowerShell 做同一个公网只读探测。这个检查不请求 DeepSeek，**不能证明真实密钥余额或一次对话成功**。发布前把 `proxyUrl` 作为 `VITE_AI_PROXY_URL` 构建前端；每次临时域名变化后，需要重新构建并发布网页。

停止与重启：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-local-shared.ps1 -Stop
# 等 status.json 变为 stopped 后，用上面的启动命令重新运行。
```

停止入口让启动器关闭隧道、网关和本次启动的 Worker 子进程，然后删除临时 `.dev.vars`。配额数据库保留在 ignored `.wrangler/local-shared/state`，重启不重置当天限额。不要通过删除该目录重置额度。若电脑断电或强制结束进程，正常清理无法执行；再次启动会在同一私有目录覆盖临时 secret，正常停止会删除它。原项目外密钥文件始终保留。

## 接口约定

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| `GET /api/ai/status` | 无 Authorization、无密钥 | `{ready, model:"deepseek-flash", mode:"shared", limits:{perMinute:3,perDay:20}}` |
| `POST /api/ai/chat` | 现有 `model/messages/stream/thinking/response_format/max_tokens` 格式；不发 Authorization | 兼容 `choices[0].message.content` 的 JSON completion |

服务端固定访问 `https://api.deepseek.com/chat/completions`，固定 `deepseek-flash`，关闭流式和思考，要求 JSON 输出，最多 4096 输出 token。客户端不能传递其他地址、工具、自己的 key 或放大输出上限。跳转使用 `manual` 并拒绝任何非 2xx 响应，服务器密钥不会跟随重定向。错误仅返回本地的通用中文提示，不回传上游错误正文、请求或凭证。

请求限制：最多 10 条消息（首条 system、末条 user）；单条文本最多 65,536 字符，合计 131,072 字符；仅最后一条 user 可附图，最多 6 张 PNG/JPEG/GIF/WebP 内嵌图片，验证 MIME 与文件头；单张 data URL 最多 12 MiB 字符、总计 24 MiB 字符；整个请求最多 26 MiB。远程图片地址、SVG 和工具调用不接收。上游等待上限 45 秒。

## 共享额度和隐私

默认每 IP 每分钟 3 次、每日 20 次，全站每日 300 次。分钟按固定分钟窗口计算，每日在 **UTC 00:00（北京时间 08:00）** 重置。可在独立 Wrangler 配置调整 `AI_IP_PER_MINUTE`、`AI_IP_PER_DAY`、`AI_GLOBAL_PER_DAY`；这些是请求次数上限，不是货币预算。每次调用还受输入大小和 4096 输出 token 上限约束。

所有调用先通过同一个 SQLite Durable Object 的事务持久预占额度，再请求 DeepSeek。失败或取消的上游请求仍计一次；多实例、并发或 Worker 重启不会清空当日计数。缺失 secret、缺失 DO、存储故障或配置错误时停止转发，不回退到无限制代理。超过额度返回 429 和 Retry-After；就绪检查不调用 DeepSeek、不消耗共享请求额度。

额度标识来自 Cloudflare 提供的 `CF-Connecting-IP`，存储中只保留地址的 SHA-256 摘要和计数，不保存原始 IP、问题、图片或密钥。摘要用于限流，不是不可逆匿名化保证。程序不记录提示词，Worker observability 默认关闭；旧日计数由 alarm 清理。

允许同源与 `AI_ALLOWED_ORIGINS` 中的精确 Origin；当前允许 `https://syzhaoln-stack.github.io`、`http://127.0.0.1:5186` 和 `http://localhost:5186`，不匹配其他本地端口。**CORS 不是身份认证**，其他客户端可以伪造 Origin；匿名服务仍可能被他人消耗共享额度，同一公网 IP 下的访客也共享 IP 额度。持久的全站额度用于限制模型调用总量。它不构成 Cloudflare 全部网络/计算费用的硬预算；扩大开放范围前按实际使用量评估额度，必要时再增加登录或人机验证。

## 长期方案：部署到 Cloudflare

以下是未来需要长期共享服务时的可选流程。当前发布仅需访客填写个人密钥。长期后台需要 Cloudflare 登录和项目外密钥文件；账户权限由所有者在登录页面确认，密钥文件的存在本身不代表账户已授权。

1. 在本项目目录运行登录，并由所有者在浏览器确认 Cloudflare 权限：

   ```powershell
   node node_modules/wrangler/bin/wrangler.js login
   node node_modules/wrangler/bin/wrangler.js whoami
   ```

   此命令来自本地已安装 Wrangler 4.92.0 的 `login --help`；默认打开浏览器。若显示多个账户，确认预期账户后再在独立配置中指定对应 `account_id`。不要输出或复制 OAuth token。

2. 本地检查及部署 API（必须显式指定独立配置）：

   ```powershell
   node --test tests/ai-shared-backend.test.mjs tests/ai-shared-runtime.test.mjs
   node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.ai.jsonc
   node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.ai.jsonc
   ```

   首次部署还没有密钥时，status 的 `ready` 为 false，不会请求 DeepSeek。保存部署结果中的真实 Worker HTTPS 地址；不要猜账户的 workers.dev 子域名。配置采用 `new_sqlite_classes` 迁移创建 `AiQuota`，保留 `shared-ai-v1` 迁移记录。兼容日期固定为已装本地运行时支持的 `2026-05-22`，确保本地和部署 API 行为一致。

3. 在项目以外保存只含密钥的文件，例如 `C:/Users/zhaos/.codex/secrets/deepseek-api.txt`。账户登录与文件均就绪后，在已有部署授权范围内用辅助程序通过 **stdin** 上传：

   ```powershell
   node worker/upload-secret-from-file.mjs --confirmed-upload --secret-file C:/Users/zhaos/.codex/secrets/deepseek-api.txt
   node node_modules/wrangler/bin/wrangler.js secret list --config wrangler.ai.jsonc
   ```

   辅助程序只接受项目外文件，密钥不出现在命令参数中，不打印文件内容或 Wrangler 原始输出；`--confirmed-upload` 表示执行已有部署授权，不要求再次向所有者确认。`secret list` 只核验名称。也可以由所有者直接运行 `secret put DEEPSEEK_API_KEY --config wrangler.ai.jsonc`，在隐藏输入提示里粘贴。**`secret put` 会创建并立即部署一个新的 Worker 版本**，因此同样属于上线操作。根 `.gitignore` 已忽略 `.env` / `.env.*` 和 `.dev.vars` / `.dev.vars.*`，仍不要把真实密钥文件放在项目内。

4. 对真实 Worker `/api/ai/status` 发只读 GET，并带 `Origin: https://syzhaoln-stack.github.io`。确认 `ready:true`、正确的 Access-Control-Allow-Origin、无 secret 内容。该检查不会产生 DeepSeek 调用。随后在最终静态构建前设置公开地址：

   ```powershell
   $env:VITE_AI_PROXY_URL = 'https://实际Worker地址/api/ai/chat'
   npm run build
   ```

   将新的 `dist/client` 按现有流程发布到 gh-pages。不要以默认 `/api/ai/chat` 构建发布共享服务版本：GitHub Pages 没有后端，无法处理此路径。该环境变量需要在每次正式构建时提供。

5. 在公开 Pages 网页确认共享状态、发送按钮和“使用自己的 API 密钥”切换，并在已有授权范围内执行一次真实对话验收。该对话会消耗少量 DeepSeek 额度，不需要为必要的单次验收重复确认。不要把纯 mock 测试当作真实密钥或模型可用性验收。

## 本地验证记录与依据

后台单元测试覆盖请求边界、CORS、脱敏、超时、并发额度、重启持久性、跨日重置及失败关闭；本地 Miniflare/workerd 测试实际使用 SQLite Durable Object，禁用外网并模拟 DeepSeek，验证并发和进程重启。静态网页构建保留原有 ASSETS 回退；独立 API Worker 的其他路径返回 404。

当前安装版本的 `secret put` 实现会在非交互模式从 stdin 读取，在交互模式使用隐藏输入。本地 `--help` 和 `--dry-run` 均已核验，不需要为这些本地检查登录。Cloudflare 官方说明支持 [SQLite Durable Objects 的 Free 计划](https://developers.cloudflare.com/durable-objects/platform/pricing/)，并给出 [`new_sqlite_classes` 配置](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)。secret 的存储与立即部署行为见 [Cloudflare Secrets 文档](https://developers.cloudflare.com/workers/configuration/secrets/)。Free 计划有平台资源上限，超限会失败；本实现随即停止模型转发。
