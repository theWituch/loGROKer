import { buildApplication } from './app.js';
import { parseCli } from './cli.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`LoGROKer wymaga Node.js 24 LTS lub nowszego. Wykryto ${process.versions.node}.`);
  process.exit(1);
}

try {
  const options = parseCli(process.argv.slice(2));
  const { app } = await buildApplication(options);

  const address = await app.listen({
    host: '127.0.0.1',
    port: options.port,
  });
  console.log(`LoGROKer: ${address}`);
  for (const source of options.sources) {
    console.log(`Source ${source.name}: ${source.logPath}`);
    console.log(`Config: ${source.configPath ?? 'brak (raw mode)'}`);
  }

  let closing = false;
  const close = async () => {
    if (closing) {
      return;
    }
    closing = true;
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
