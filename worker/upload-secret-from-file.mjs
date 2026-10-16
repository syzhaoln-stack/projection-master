import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run only after the owner confirms the file is ready and authorizes Cloudflare
// deployment. Never print file contents or raw Wrangler output, even on failure.
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--confirmed-upload' || args[1] !== '--secret-file') {
  console.error('Usage: node worker/upload-secret-from-file.mjs --confirmed-upload --secret-file <path outside this repository>');
  process.exit(2);
}
try {
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const source = realpathSync(resolve(args[2]));
  if (source.toLowerCase() === repository.toLowerCase() || source.toLowerCase().startsWith(`${repository}${sep}`.toLowerCase())) throw Error('in repository');
  const metadata = statSync(source);
  if (!metadata.isFile() || metadata.size > 1024) throw Error('invalid file');
  const key = readFileSync(source, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw Error('invalid key');
  const result = spawnSync(process.execPath, [resolve(repository, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', 'DEEPSEEK_API_KEY', '--config', resolve(repository, 'wrangler.ai.jsonc')], {
    cwd: repository, input: `${key}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    timeout: 60000, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
  });
  if (result.error || result.status !== 0) throw Error('upload failed');
  console.log('DEEPSEEK_API_KEY uploaded. The value was not printed.');
} catch {
  console.error('Secret upload did not complete. Confirm Cloudflare login, the external file, and the Worker configuration. Secret values and provider output were withheld.');
  process.exitCode = 1;
}
