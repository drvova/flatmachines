import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultConfigDir = resolve(homedir(), '.config/opencode');
const configDir = resolve(process.env.OPENCODE_CONFIG_DIR || defaultConfigDir);
const packagePath = resolve(repoRoot, 'sdk/js/packages/opencode-flatmachines');
const pluginName = 'flatmachines.ts';
const pluginDir = resolve(configDir, 'plugins');
const pluginPath = resolve(pluginDir, pluginName);
const packageJsonPath = resolve(configDir, 'package.json');
const opencodeJsonPath = resolve(configDir, 'opencode.json');

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

await mkdir(pluginDir, { recursive: true });
await writeFile(
  pluginPath,
  'export { FlatMachinesPlugin } from "@memgrafter/opencode-flatmachines"\n',
);

const packageJson = await readJson(packageJsonPath, { dependencies: {} });
packageJson.dependencies = sortedObject({
  ...(packageJson.dependencies || {}),
  '@memgrafter/opencode-flatmachines': `file:${packagePath}`,
});
await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const opencodeJson = await readJson(opencodeJsonPath, { $schema: 'https://opencode.ai/config.json' });
const plugins = Array.isArray(opencodeJson.plugin) ? opencodeJson.plugin : [];
if (!plugins.includes(pluginName)) {
  plugins.push(pluginName);
}
opencodeJson.plugin = plugins;
await writeFile(opencodeJsonPath, `${JSON.stringify(opencodeJson, null, 2)}\n`);

console.log(JSON.stringify({
  configDir,
  pluginPath,
  packageJsonPath,
  opencodeJsonPath,
  dependency: packageJson.dependencies['@memgrafter/opencode-flatmachines'],
  plugin: pluginName,
}, null, 2));
