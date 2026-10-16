export const SHARED_MODEL = 'deepseek-flash';
export const SHARED_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const MAX_BODY_BYTES = 26 * 1024 * 1024;
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_CHARS = 24 * 1024 * 1024;

export class SharedAIError extends Error {
  constructor(code, status = 400, retryAfter) { super(code); this.code = code; this.status = status; this.retryAfter = retryAfter; }
}

export function quotaLimits(env = {}) {
  const read = (key, fallback, maximum) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
    return value;
  };
  return {
    perMinute: read('AI_IP_PER_MINUTE', 3, 1000),
    perDay: read('AI_IP_PER_DAY', 20, 10000),
    globalPerDay: read('AI_GLOBAL_PER_DAY', 300, 100000)
  };
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new SharedAIError('INVALID_REQUEST');
}

export async function readBoundedJson(source, maximum) {
  const claimed = source.headers.get('content-length');
  if (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > maximum)) throw new SharedAIError('REQUEST_TOO_LARGE', 413);
  if (!source.body) throw new SharedAIError('INVALID_REQUEST');
  const reader = source.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new SharedAIError('REQUEST_TOO_LARGE', 413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SharedAIError) throw error;
    throw new SharedAIError('INVALID_REQUEST');
  } finally { reader.releaseLock(); }
}

export function normalizeChatPayload(payload) {
  keys(payload, ['model', 'messages', 'stream', 'thinking', 'response_format', 'max_tokens']);
  if (!Array.isArray(payload.messages) || payload.messages.length < 2 || payload.messages.length > 10
    || payload.messages[0]?.role !== 'system' || payload.messages.at(-1)?.role !== 'user') throw new SharedAIError('INVALID_REQUEST');
  let textSize = 0, imageCount = 0, imageSize = 0;
  const text = value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 65536) throw new SharedAIError('INVALID_REQUEST');
    textSize += value.length;
    if (textSize > 131072) throw new SharedAIError('REQUEST_TOO_LARGE', 413);
    return value;
  };
  const image = value => {
    keys(value, ['url', 'detail']);
    if (typeof value.url !== 'string' || value.url.length > MAX_IMAGE_CHARS) throw new SharedAIError('INVALID_IMAGES');
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.url);
    if (!match || !match[2] || match[2].length % 4 !== 0) throw new SharedAIError('INVALID_IMAGES');
    let prefix;
    try { prefix = atob(match[2].slice(0, 32)); } catch { throw new SharedAIError('INVALID_IMAGES'); }
    const valid = match[1] === 'png' ? prefix.startsWith('\x89PNG\r\n\x1a\n')
      : match[1] === 'jpeg' ? prefix.startsWith('\xff\xd8\xff')
        : match[1] === 'gif' ? /^GIF8[79]a/.test(prefix) : prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP';
    if (!valid || ++imageCount > 6) throw new SharedAIError('INVALID_IMAGES');
    imageSize += value.url.length;
    if (imageSize > MAX_TOTAL_IMAGE_CHARS) throw new SharedAIError('REQUEST_TOO_LARGE', 413);
    return { url: value.url, detail: 'high' };
  };
  const messages = payload.messages.map((message, index) => {
    keys(message, ['role', 'content']);
    if ((index === 0 && message.role !== 'system') || (index > 0 && !['user', 'assistant'].includes(message.role))) throw new SharedAIError('INVALID_REQUEST');
    if (Array.isArray(message.content)) {
      if (index !== payload.messages.length - 1 || message.content.length < 2 || message.content.length > 7 || message.content[0]?.type !== 'text') throw new SharedAIError('INVALID_IMAGES');
      const content = message.content.map((part, position) => {
        if (position === 0) { keys(part, ['type', 'text']); return { type: 'text', text: text(part.text) }; }
        keys(part, ['type', 'image_url']);
        if (part.type !== 'image_url') throw new SharedAIError('INVALID_IMAGES');
        return { type: 'image_url', image_url: image(part.image_url) };
      });
      return { role: message.role, content };
    }
    return { role: message.role, content: text(message.content) };
  });
  // Client values cannot select a different host/model, enable tools or thinking,
  // request multiple completions, stream indefinitely or enlarge the output cap.
  return { model: SHARED_MODEL, stream: false, thinking: { type: 'disabled' },
    response_format: { type: 'json_object' }, max_tokens: 4096, messages };
}

const MESSAGES = {
  INVALID_REQUEST: '请求格式不正确，请刷新网页后重试。', INVALID_IMAGES: '附图格式或数量不符合要求。',
  REQUEST_TOO_LARGE: '问题或图片过大，请减少附图后重试。', ORIGIN_NOT_ALLOWED: '当前网页未接入共享 AI。',
  METHOD_NOT_ALLOWED: '此接口不支持该请求方式。', SERVICE_UNAVAILABLE: '共享 AI 暂未就绪，请稍后再试或使用个人密钥。',
  RATE_LIMIT: '共享体验额度已用完，请稍后再试或使用个人密钥。',
  UPSTREAM_UNAVAILABLE: 'AI 服务暂时不可用，请稍后再试。', UPSTREAM_TIMEOUT: 'AI 响应超时，请减少附图后重试。'
};

function response(body, status = 200, origin, retryAfter) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return undefined;
  const allowed = new Set([new URL(request.url).origin]);
  for (const candidate of String(env.AI_ALLOWED_ORIGINS || '').split(',')) {
    if (!candidate.trim()) continue;
    let url;
    try { url = new URL(candidate.trim()); } catch { throw new SharedAIError('SERVICE_UNAVAILABLE', 503); }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== candidate.trim()) throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
    allowed.add(url.origin);
  }
  if (!allowed.has(origin)) throw new SharedAIError('ORIGIN_NOT_ALLOWED', 403);
  return origin;
}

async function withDeadline(operation, milliseconds) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new SharedAIError('SERVICE_UNAVAILABLE', 503)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function quotaStub(env) {
  if (typeof env.AI_QUOTA?.idFromName !== 'function' || typeof env.AI_QUOTA?.get !== 'function') throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
  return env.AI_QUOTA.get(env.AI_QUOTA.idFromName('shared-default'));
}

async function quotaRequest(env, path, body) {
  let result;
  try {
    const reply = await withDeadline(quotaStub(env).fetch(new Request(`https://ai-quota.internal/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
    })), 3000);
    result = await readBoundedJson(reply, 2048);
    if (reply.status === 429 && result.code === 'RATE_LIMIT') throw new SharedAIError('RATE_LIMIT', 429, result.retryAfter);
    if (!reply.ok || result.ready !== true) throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
  } catch (error) {
    if (error instanceof SharedAIError && error.code === 'RATE_LIMIT') throw error;
    throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
  }
  return result;
}

function hasSecret(env) {
  return typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.length >= 8 && env.DEEPSEEK_API_KEY.length <= 512 && !/\s/.test(env.DEEPSEEK_API_KEY);
}

export function createSharedAIHandler({ fetchImpl = globalThis.fetch, timeoutMs = 45000 } = {}) {
  return async function handleSharedAI(request, env = {}) {
    const path = new URL(request.url).pathname;
    if (!['/api/ai/status', '/api/ai/chat'].includes(path)) return null;
    let origin;
    try {
      origin = allowedOrigin(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600'
      } });
      const limits = quotaLimits(env);
      if (path.endsWith('/status')) {
        if (request.method !== 'GET') throw new SharedAIError('METHOD_NOT_ALLOWED', 405);
        let ready = false;
        if (hasSecret(env)) { try { ready = (await quotaRequest(env, 'status')).ready; } catch {} }
        return response({ ready, model: SHARED_MODEL, mode: 'shared', limits: { perMinute: limits.perMinute, perDay: limits.perDay } }, 200, origin);
      }
      if (request.method !== 'POST') throw new SharedAIError('METHOD_NOT_ALLOWED', 405);
      if (!origin) throw new SharedAIError('ORIGIN_NOT_ALLOWED', 403);
      if (!hasSecret(env)) throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
      if (request.headers.has('Authorization') || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new SharedAIError('INVALID_REQUEST');
      const payload = normalizeChatPayload(await readBoundedJson(request, MAX_BODY_BYTES));
      const key = env.DEEPSEEK_API_KEY;
      for (const message of payload.messages) {
        const content = typeof message.content === 'string' ? message.content : message.content[0].text;
        if (content.includes(key)) throw new SharedAIError('INVALID_REQUEST');
      }
      // Cloudflare supplies this header. Never accept client-supplied forwarded-IP
      // query/body fields as quota identity, and never store the raw address.
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip || !/^[0-9a-fA-F:.]{2,45}$/.test(ip)) throw new SharedAIError('SERVICE_UNAVAILABLE', 503);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
      const client = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      await quotaRequest(env, 'reserve', { client });
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        if (request.signal.aborted) throw new SharedAIError('UPSTREAM_TIMEOUT', 504);
        // Workers supports manual redirects; rejecting every non-2xx response
        // below keeps the server credential on the fixed official host.
        const upstream = await fetchImpl(SHARED_ENDPOINT, { method: 'POST', redirect: 'manual', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
        if (!upstream.ok) { await upstream.body?.cancel().catch(() => {}); throw new SharedAIError('UPSTREAM_UNAVAILABLE', 503); }
        const envelope = await readBoundedJson(upstream, 65536);
        const choice = envelope?.choices?.[0], content = choice?.message?.content;
        if (envelope?.choices?.length !== 1 || choice.finish_reason !== 'stop' || choice.message?.role !== 'assistant'
          || choice.message?.tool_calls?.length || typeof content !== 'string' || !content.trim() || content.length > 32000 || content.includes(key)) throw new SharedAIError('UPSTREAM_UNAVAILABLE', 503);
        // Drop all upstream metadata and error bodies; keep the existing frontend
        // completion contract only. The frontend validates the proposed edits.
        return response({ model: SHARED_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }, 200, origin);
      } catch (error) {
        if (controller.signal.aborted) throw new SharedAIError('UPSTREAM_TIMEOUT', 504);
        if (error instanceof SharedAIError && error.code === 'UPSTREAM_UNAVAILABLE') throw error;
        throw new SharedAIError('UPSTREAM_UNAVAILABLE', 503);
      } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
    } catch (error) {
      const safe = error instanceof SharedAIError ? error : new SharedAIError('SERVICE_UNAVAILABLE', 503);
      return response({ error: { code: safe.code, message: MESSAGES[safe.code] || MESSAGES.SERVICE_UNAVAILABLE } }, safe.status, origin, safe.retryAfter);
    }
  };
}

export const handleSharedAI = createSharedAIHandler();
