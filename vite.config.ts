import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from './tools/sites-vite-plugin';

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: './worker/index.ts',
  compatibility_date: '2026-07-29',
  compatibility_flags: ['nodejs_compat'],
  assets: {
    binding: 'ASSETS',
    not_found_handling: 'single-page-application' as const
  }
};

export default defineConfig(() => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    build: {
      cssMinify: false,
      rollupOptions: {
        external: ['three', /^three\/addons\//]
      }
    },
    plugins: [
      cloudflare({
        config: localBindingConfig
      }),
      sites()
    ]
  };
});
