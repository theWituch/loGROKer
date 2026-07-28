import { access, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { EventStream } from './event-stream.js';
import { ViewerService, type ViewerServiceOptions } from './viewer-service.js';

export interface BuiltApplication {
  app: FastifyInstance;
  service: ViewerService;
}

export async function buildApplication(options: ViewerServiceOptions): Promise<BuiltApplication> {
  const app = Fastify({
    logger: {
      level: 'info',
    },
  });
  const service = new ViewerService(options);
  await service.start();
  const stream = new EventStream(service);

  app.get('/api/health', async () => ({
    ok: true,
    status: service.snapshot().status,
  }));

  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();
    stream.add(reply.raw);
    request.raw.socket.setKeepAlive(true);
  });

  const webRoot = fileURLToPath(new URL('../../web/', import.meta.url));
  if (await exists(webRoot)) {
    app.get('/', async (_request, reply) => {
      reply.type('text/html; charset=utf-8').send(await readFile(join(webRoot, 'index.html')));
    });
    app.get('/assets/:name', async (request, reply) => {
      const { name } = request.params as { name: string };
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
        return reply.code(404).send({ error: 'File not found.' });
      }
      const assetPath = join(webRoot, 'assets', name);
      try {
        const body = await readFile(assetPath);
        return reply
          .type(contentType(extname(name)))
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .send(body);
      } catch {
        return reply.code(404).send({ error: 'File not found.' });
      }
    });
  } else {
    app.get('/', async (_request, reply) => {
      reply
        .type('text/plain; charset=utf-8')
        .send('The frontend has not been built. Use "npm run dev" or "npm run build".');
    });
  }

  app.addHook('onClose', async () => {
    stream.close();
    await service.stop();
  });

  return { app, service };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function contentType(extension: string): string {
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}
