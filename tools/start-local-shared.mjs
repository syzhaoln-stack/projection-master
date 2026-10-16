import { createServer } from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, '.wrangler', 'local-shared');
const STATE = join(LOCAL, 'status.json');
const STOP = join(LOCAL, 'stop.request');
const DEFAULT_KEY_FILE = 'D:\\claude_work\\20260721现代机械制图\\deepseek-api.txt';
const API_PATHS = new Set(['/api/ai/status', '/api/ai/chat']);
const MAX_BODY = 26 * 1024 * 1024;
const execFileAsync = promisify(execFile);
// Published Cloudflare release asset and SHA-256, verified against the official
// release API on 2026-10-16. A pinned download also works without GitHub API quota.
const CLOUDFLARED_VERSION = '2026.10.1';
const CLOUDFLARED_SHA256 = '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6';

// Parsing failures never include source text. Accept a bare official key or a
// note containing exactly one distinct key; ambiguous files need manual cleanup.
export function extractApiKey(content) {
  const keys = [...new Set(String(content).match(/\bsk-[A-Za-z0-9_-]{12,}\b/g) || [])];
  if (keys.length !== 1 || keys[0].length > 512) throw new Error('KEY_FILE_FORMAT');
  return keys[0];
}

export function localWorkerConfig(source) {
  return {
    name: source.name,
    main: resolve(ROOT, source.main),
    compatibility_date: source.compatibility_date,
    compatibility_flags: source.compatibility_flags,
    observability: { enabled: false },
    vars: { ...source.vars },
    durable_objects: source.durable_objects,
    migrations: source.migrations
  };
}

const jsonReply = (response, status, code) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error: { code, message: '共享 AI 暂时无法处理此请求。' } }));
};

// This gateway is the only tunnel target. Wrangler's debugger, dev metadata,
// arbitrary paths and WebSocket upgrades never reach the public tunnel.
export function createApiGateway({ workerUrl, allowedOrigins, fetchImpl = fetch, maxConcurrent = 4, bodyTimeoutMs = 30000, totalTimeoutMs = 80000 }) {
  const allowed = new Set(allowedOrigins);
  let inFlight = 0;
  const server = createServer(async (request, response) => {
    const rawPath = request.url || '/';
    if (!API_PATHS.has(rawPath)) return jsonReply(response, 404, 'NOT_FOUND');
    const method = request.method;
    if (!(method === 'OPTIONS' || (rawPath.endsWith('/status') && method === 'GET') || (rawPath.endsWith('/chat') && method === 'POST'))) return jsonReply(response, 405, 'METHOD_NOT_ALLOWED');
    const origin = request.headers.origin;
    if ((origin && !allowed.has(origin)) || (method === 'POST' && !origin)) return jsonReply(response, 403, 'ORIGIN_NOT_ALLOWED');
    const claimed = request.headers['content-length'];
    if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > MAX_BODY)) return jsonReply(response, 413, 'REQUEST_TOO_LARGE');
    if (inFlight >= maxConcurrent) return jsonReply(response, 429, 'BUSY');
    inFlight++;
    const controller = new AbortController();
    const abort = () => { controller.abort(); if (!request.complete) request.destroy(); };
    const timeout = setTimeout(abort, totalTimeoutMs), bodyTimeout = setTimeout(abort, bodyTimeoutMs);
    request.on('aborted', abort); response.on('close', abort);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) return jsonReply(response, 413, 'REQUEST_TOO_LARGE');
        chunks.push(chunk);
      }
      clearTimeout(bodyTimeout);
      const headers = new Headers();
      for (const name of ['origin', 'content-type', 'authorization', 'cf-connecting-ip']) {
        const value = request.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      // No X-Forwarded-For or user-selected destination is trusted. Cloudflare
      // supplies CF-Connecting-IP; the existing Worker validates and hashes it.
      const upstream = await fetchImpl(`${workerUrl}${rawPath}`, { method, headers, signal: controller.signal,
        redirect: 'manual', ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const replyHeaders = {};
      for (const name of ['content-type', 'cache-control', 'vary', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age', 'retry-after']) {
        const value = upstream.headers.get(name); if (value) replyHeaders[name] = value;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length > 128 * 1024 || !/^application\/json/i.test(upstream.headers.get('content-type') || '') && upstream.status !== 204) return jsonReply(response, 502, 'SERVICE_UNAVAILABLE');
      response.writeHead(upstream.status, replyHeaders); response.end(body);
    } catch { if (!response.headersSent && !response.destroyed) jsonReply(response, 503, 'SERVICE_UNAVAILABLE'); }
    finally { inFlight--; clearTimeout(timeout); clearTimeout(bodyTimeout); request.removeListener('aborted', abort); response.removeListener('close', abort); }
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  return server;
}

async function ensureCloudflared(signal) {
  signal?.throwIfAborted();
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('WINDOWS_X64_REQUIRED');
  const folder = join(ROOT, '.cache', 'local-shared'); await mkdir(folder, { recursive: true });
  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`;
  const expected = CLOUDFLARED_SHA256, path = join(folder, 'cloudflared.exe');
  let binary; try { binary = await readFile(path); } catch {}
  if (!binary || createHash('sha256').update(binary).digest('hex') !== expected) {
    console.log('正在下载并校验 Cloudflare 官方临时隧道工具…');
    const download = await fetch(downloadUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(180000)].filter(Boolean)) });
    if (!download.ok) throw new Error('DOWNLOAD_FAILED');
    binary = Buffer.from(await download.arrayBuffer());
    if (createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('DOWNLOAD_HASH_MISMATCH');
    signal?.throwIfAborted(); await writeFile(path, binary);
  }
  await writeFile(join(folder, 'release.json'), JSON.stringify({ version: CLOUDFLARED_VERSION, sha256: expected }, null, 2));
  return path;
}

function childProcess(command, args) {
  // Neither command arguments nor logs carry the secret. Suppress raw child
  // output because dev tools may print their loaded bindings on startup.
  return spawn(command, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
}
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else child.kill('SIGTERM');
}
async function systemStatusProbe(url, signal) {
  if (process.platform !== 'win32' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return false;
  let shell = 'powershell.exe';
  const pwsh = join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  try { await access(pwsh); shell = pwsh; } catch {}
  const result = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-File', join(ROOT, 'tools', 'probe-local-shared.ps1'), '-Url', url],
    { windowsHide: true, timeout: 18000, signal, maxBuffer: 4096 });
  return JSON.parse(result.stdout.trim()).ready === true;
}
async function waitForStatus(url, alive = () => true, timeout = 45000, onProbe = () => {}, requestTimeout = 2000, signal) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    signal?.throwIfAborted(); if (!alive()) throw new Error('PROCESS_EXITED');
    try {
      const result = await fetch(`${url}/api/ai/status`, { signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeout)].filter(Boolean)) });
      onProbe({ status: result.status });
      if (result.ok && (await result.json()).ready === true) return;
    } catch (error) { onProbe({ error: /^[A-Z_0-9]+$/.test(error.cause?.code || '') ? error.cause.code : error.name }); }
    // PowerShell honors this computer's configured HTTP proxy when raw Node DNS
    // cannot resolve a newly issued tunnel hostname. Only a public, non-billable
    // status GET is delegated; credentials and prompts never enter this process.
    try { if (await systemStatusProbe(url, signal)) { onProbe({ status: 200, via: 'system-http' }); return; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('STATUS_NOT_READY');
}
function option(args, name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
async function stopExisting() {
  await mkdir(LOCAL, { recursive: true });
  let state; try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
  if (!state || state.status === 'stopped') { console.log('本机共享 AI 未运行。'); return; }
  await writeFile(STOP, 'stop\n');
  console.log('已请求停止本机共享 AI；启动器会关闭隧道并删除临时密钥。');
}

export async function startLocalShared(args = process.argv.slice(2)) {
  if (args.includes('--stop')) return stopExisting();
  const keyFile = option(args, '--key-file', DEFAULT_KEY_FILE);
  const workerPort = Number(option(args, '--worker-port', '8798'));
  const gatewayPort = Number(option(args, '--gateway-port', '8799'));
  const inspectorPort = Number(option(args, '--inspector-port', '9239'));
  for (const port of [workerPort, gatewayPort, inspectorPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  if (new Set([workerPort, gatewayPort, inspectorPort]).size !== 3) throw new Error('PORTS_MUST_DIFFER');
  await mkdir(LOCAL, { recursive: true });
  let previous; try { previous = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
  if (previous?.status === 'running' || previous?.status === 'starting') {
    try { process.kill(previous.pid, 0); throw new Error('ALREADY_RUNNING'); } catch (error) { if (error.message === 'ALREADY_RUNNING') throw error; }
  }
  const privateDir = join(LOCAL, 'private'); await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const secretPath = join(privateDir, '.dev.vars'), configPath = join(privateDir, 'wrangler.json');
  execFileSync('git', ['check-ignore', '-q', secretPath], { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
  if (process.platform === 'win32') {
    const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    execFileSync('icacls.exe', [privateDir, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true, stdio: 'ignore' });
  }
  await unlink(STOP).catch(() => {});
  let worker, tunnel, gateway, timer, stopped = false, publicUrl, stage = 'preparing';
  const lifecycle = new AbortController();
  let resolveStop; const untilStopped = new Promise(resolve => { resolveStop = resolve; });
  const requestStop = () => {
    if (lifecycle.signal.aborted) return;
    lifecycle.abort(); gateway?.closeAllConnections(); gateway?.close();
    void stopChild(tunnel); void stopChild(worker); resolveStop();
  };
  const checkpoint = () => lifecycle.signal.throwIfAborted();
  const diagnostics = { tunnelConnected: false, tunnelError: null, publicProbe: null };
  const state = status => ({ status, pid: process.pid, workerPid: worker?.pid || null, tunnelPid: tunnel?.pid || null,
    workerUrl: `http://127.0.0.1:${workerPort}`, gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
    publicUrl: publicUrl || null, proxyUrl: publicUrl ? `${publicUrl}/api/ai/chat` : null, stage, diagnostics, updatedAt: new Date().toISOString() });
  const cleanup = async () => {
    if (stopped) return; stopped = true; clearInterval(timer);
    process.removeListener('SIGINT', requestStop); process.removeListener('SIGTERM', requestStop);
    await stopChild(tunnel); gateway?.closeAllConnections(); gateway?.close(); await stopChild(worker);
    await unlink(secretPath).catch(() => {}); await unlink(STOP).catch(() => {});
    await writeFile(STATE, JSON.stringify(state('stopped'), null, 2));
  };
  process.once('SIGINT', requestStop); process.once('SIGTERM', requestStop);
  timer = setInterval(() => { void access(STOP).then(requestStop).catch(() => {}); }, 400);
  try {
    await writeFile(STATE, JSON.stringify(state('starting'), null, 2));
    checkpoint(); const cloudflared = await ensureCloudflared(lifecycle.signal); checkpoint();
    const config = localWorkerConfig(JSON.parse(await readFile(join(ROOT, 'wrangler.ai.jsonc'), 'utf8')));
    stage = 'secret';
    let secret = extractApiKey(await readFile(keyFile, 'utf8')); checkpoint();
    await writeFile(secretPath, `DEEPSEEK_API_KEY=${JSON.stringify(secret)}\n`, { mode: 0o600 }); secret = undefined;
    checkpoint(); await writeFile(configPath, JSON.stringify(config, null, 2)); checkpoint();
    stage = 'worker';
    worker = childProcess(process.execPath, [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--config', configPath,
      '--local', '--ip', '127.0.0.1', '--port', String(workerPort), '--inspector-ip', '127.0.0.1', '--inspector-port', String(inspectorPort),
      '--persist-to', join(LOCAL, 'state'), '--log-level', 'none', '--show-interactive-dev-session=false']);
    worker.stdout.resume(); worker.stderr.resume(); worker.on('error', () => {});
    worker.once('exit', requestStop);
    await writeFile(STATE, JSON.stringify(state('starting'), null, 2));
    await waitForStatus(`http://127.0.0.1:${workerPort}`, () => worker.exitCode === null, 45000, () => {}, 2000, lifecycle.signal); checkpoint();
    gateway = createApiGateway({ workerUrl: `http://127.0.0.1:${workerPort}`, allowedOrigins: String(config.vars.AI_ALLOWED_ORIGINS).split(',').map(value => value.trim()) });
    await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(gatewayPort, '127.0.0.1', resolve); }); checkpoint();
    stage = 'tunnel';
    const tunnelConfig = join(LOCAL, 'tunnel.yml'); await writeFile(tunnelConfig, '{}\n'); checkpoint();
    tunnel = childProcess(cloudflared, ['tunnel', '--config', tunnelConfig, '--no-autoupdate', '--url', `http://127.0.0.1:${gatewayPort}`, '--protocol', 'http2', '--metrics', '127.0.0.1:0', '--management-diagnostics=false']);
    tunnel.on('error', () => {});
    tunnel.once('exit', requestStop);
    await writeFile(STATE, JSON.stringify(state('starting'), null, 2));
    publicUrl = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('TUNNEL_START_TIMEOUT')), 45000);
      const aborted = () => { clearTimeout(deadline); reject(new Error('STOPPED')); };
      lifecycle.signal.addEventListener('abort', aborted, { once: true });
      if (lifecycle.signal.aborted) return aborted();
      let output = '';
      const read = chunk => {
        const text = chunk.toString(); output = (output + text).slice(-16000);
        if (text.includes('Registered tunnel connection')) diagnostics.tunnelConnected = true;
        if (/\bERR\b/.test(text)) diagnostics.tunnelError = /lookup |DNS/i.test(text) ? 'dns' : /connect|dial|handshake|timeout/i.test(text) ? 'connection' : 'tunnel';
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
        if (match) { clearTimeout(deadline); lifecycle.signal.removeEventListener('abort', aborted); resolve(match[0]); }
      };
      tunnel.stdout.on('data', read); tunnel.stderr.on('data', read);
      tunnel.once('error', () => { clearTimeout(deadline); reject(new Error('TUNNEL_START_FAILED')); });
      tunnel.once('exit', () => { clearTimeout(deadline); reject(new Error('TUNNEL_EXITED')); });
    });
    checkpoint(); stage = 'public-status'; await writeFile(STATE, JSON.stringify(state('starting'), null, 2));
    await waitForStatus(publicUrl, () => tunnel.exitCode === null, 90000, probe => { diagnostics.publicProbe = probe; }, 10000, lifecycle.signal); checkpoint();
    await writeFile(STATE, JSON.stringify(state('running'), null, 2));
    console.log(JSON.stringify({ ...state('running'), note: '临时共享：电脑和此进程需保持运行；尚未发起收费 AI 请求。' }, null, 2));
    await untilStopped;
  } catch {
    if (!lifecycle.signal.aborted) throw new Error(`LOCAL_SHARED_FAILED_${stage.toUpperCase()}`);
  } finally { await cleanup(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startLocalShared().catch(error => { console.error(error.message); process.exitCode = 1; });
}
