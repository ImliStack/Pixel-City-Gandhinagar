import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createRoom, handle } from './shared/social-core.mjs';

const deployBuild = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DEPLOY_BUILD;

// Local stand-in for the Cloudflare presence Worker: same protocol, in-memory counts.
function socialDevServer(): Plugin {
  const room = createRoom();
  const middleware = (req: any, res: any, next: () => void) => {
    const url = new URL(req.url || '/', 'http://local');
    if (!url.pathname.startsWith('/api/social/')) return next();
    const readBody = () => new Promise<string>((resolve, reject) => { let text = ''; req.on('data', (c: { toString(): string }) => { text += c.toString(); if (text.length > 4096) { req.destroy(); reject(new Error('too large')); } }); req.on('end', () => resolve(text)); req.on('error', reject); });
    const send = (status: number, json: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(json)); };
    handle(room, req.method || 'GET', url.pathname, readBody).then(({ status, json }) => send(status, json), () => send(400, { error: 'bad request' }));
  };
  return { name: 'pixel-city-social', configureServer: (s) => { s.middlewares.use(middleware); }, configurePreviewServer: (s) => { s.middlewares.use(middleware); } };
}

export default defineConfig({
  root: 'apps/viewer',
  plugins: [react(), socialDevServer()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  // DEPLOY_BUILD=1 leaves public/ (the 3.5 GB tile symlinks) out of dist: in production the tiles live in R2
  // and the Cloudflare Worker serves them at the same /maps/... paths.
  publicDir: deployBuild ? false : 'public',
  build: { outDir: 'dist', sourcemap: !deployBuild, emptyOutDir: true },
});
