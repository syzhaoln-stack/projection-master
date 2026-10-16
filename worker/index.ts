import { handleSharedAI } from './ai-shared.js';
export { AiQuota } from './ai-quota.js';

interface Env {
  DEEPSEEK_API_KEY?: string;
  AI_ALLOWED_ORIGINS?: string;
  AI_IP_PER_MINUTE?: string;
  AI_IP_PER_DAY?: string;
  AI_GLOBAL_PER_DAY?: string;
  AI_QUOTA?: unknown;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

const worker = {
  async fetch(request: Request, env: Env) {
    const api = await handleSharedAI(request, env);
    if (api) return api;
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }
};

export default worker;
