import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } } });

const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
const migrate = spawnSync(process.execPath, [wrangler.pathname, 'd1', 'migrations', 'apply', 'DB', '--local'], {
  stdio: 'inherit',
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const args = ['dev', '--ip', values.host || process.env.HOST || '127.0.0.1', '--port', values.port || process.env.PORT || '8787'];
for (const key of ['SWAP_ENV', 'LOCAL_AUTH_CODES', 'ADMIN_KEY']) {
  if (process.env[key]) args.push('--var', `${key}:${process.env[key]}`);
}
const worker = spawn(process.execPath, [wrangler.pathname, ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill(signal));
worker.once('exit', (code) => process.exit(code ?? 0));
