import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: 'sites',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const buildDirectory = resolve(root, 'dist');
      const outputDirectory = resolve(root, 'dist', '.openai');
      const hostingConfig = resolve(root, '.openai', 'hosting.json');
      const clientAssets = resolve(buildDirectory, 'client', 'assets');
      const sourceAssets = resolve(root, 'assets');
      const serverDirectory = resolve(buildDirectory, 'server');

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });
      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, 'hosting.json'));
      }

      if (await exists(sourceAssets)) {
        await mkdir(clientAssets, { recursive: true });
        await cp(sourceAssets, clientAssets, { recursive: true });
      }

      const entries = await readdir(buildDirectory, { withFileTypes: true });
      const workerDirectory = entries.find(entry =>
        entry.isDirectory()
        && !['client', 'server', '.openai'].includes(entry.name)
      );
      if (workerDirectory) {
        const workerEntry = resolve(buildDirectory, workerDirectory.name, 'index.js');
        if (await exists(workerEntry)) {
          await mkdir(serverDirectory, { recursive: true });
          await cp(workerEntry, resolve(serverDirectory, 'index.js'));
        }
      }
    }
  };
}
