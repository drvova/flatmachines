import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

async function run(command, args, options = {}) {
  const result = await exec(command, args, {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return result.stdout.trim();
}

async function pack(workspace, destination) {
  const json = await run('npm', ['pack', '-w', workspace, '--pack-destination', destination, '--json']);
  const [entry] = JSON.parse(json);
  if (!entry?.filename) {
    throw new Error(`npm pack did not return a filename for ${workspace}`);
  }
  return join(destination, basename(entry.filename));
}

const temp = await mkdtemp(join(tmpdir(), 'flatmachines-opencode-package-'));
const installDir = join(temp, 'consumer');
await run('npm', ['run', 'build']);

const plugin = await pack('packages/opencode-flatmachines', temp);

await mkdir(installDir, { recursive: true });
await run('npm', ['init', '-y'], { cwd: installDir });
await run('npm', ['install', plugin], { cwd: installDir });

const machinePath = join(installDir, 'machine.yml');
await writeFile(machinePath, `spec: flatmachine
spec_version: "4.1.0"
data:
  states:
    done:
      type: final
      output:
        ok: true
`);

await writeFile(join(installDir, 'verify.mjs'), `
import plugin from '@memgrafter/opencode-flatmachines';
import { readFile } from 'node:fs/promises';

const context = {
  sessionID: 'session',
  messageID: 'message',
  agent: 'build',
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
};

const hooks = await plugin.server({
  directory: process.cwd(),
  worktree: process.cwd(),
  project: {},
  client: {},
  experimental_workspace: { register() {} },
  serverUrl: new URL('http://localhost:4096'),
  $: {},
});

const validate = await hooks.tool.flatmachine_validate.execute({ configPath: 'machine.yml' }, context);
const run = await hooks.tool.flatmachine_run.execute({ configPath: 'machine.yml', input: {} }, context);
const payload = JSON.parse(run.output);
if (validate.metadata.valid !== true || payload.result.ok !== true) {
  throw new Error('OpenCode plugin package smoke failed');
}
const flatmachinesPkg = JSON.parse(await readFile('node_modules/@memgrafter/flatmachines/package.json', 'utf8'));
console.log(JSON.stringify({ valid: validate.metadata.valid, result: payload.result, flatmachines: flatmachinesPkg.version }));
`);

const output = await exec('node', ['verify.mjs'], { cwd: installDir });
console.log(output.stdout.trim());
