import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind(), {
    name: 'hallway-offline-version',
    apply: 'build',
    async closeBundle() {
      const html = await readFile(resolve('dist/index.html'));
      const path = resolve('dist/sw.js');
      const source = await readFile(path, 'utf8');
      const version = createHash('sha256').update(html).update(source).digest('hex').slice(0, 12);
      await writeFile(path, source.replace('hallway-shell-v1', 'hallway-shell-' + version));
    },
  }],
  server: { proxy: { '/api': process.env.API_URL || 'http://localhost:3000' } },
  build: { target: 'es2022' },
});
