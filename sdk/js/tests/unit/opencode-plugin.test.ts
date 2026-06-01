import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FlatMachinesPlugin, normalizeOptions, resolveWorkspacePath } from '../../packages/opencode-flatmachines/src/index';

const finalOnlyMachine = `
spec: flatmachine
spec_version: "4.1.0"
data:
  states:
    done:
      type: final
      output:
        ok: true
`;

async function workspace() {
  return mkdtemp(join(tmpdir(), 'flatmachines-opencode-'));
}

function toolContext(root: string) {
  return {
    sessionID: 'session',
    messageID: 'message',
    agent: 'build',
    directory: root,
    worktree: root,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  };
}

describe('@memgrafter/opencode-flatmachines', () => {
  it('normalizes plugin options', () => {
    expect(normalizeOptions({
      defaultConfigPath: 'machine.yml',
      profilesFile: 'profiles.yml',
      allowExternalPaths: true,
    })).toEqual({
      defaultConfigPath: 'machine.yml',
      profilesFile: 'profiles.yml',
      allowExternalPaths: true,
    });
  });

  it('rejects paths outside the OpenCode worktree by default', async () => {
    const root = await workspace();
    expect(() => resolveWorkspacePath('../machine.yml', toolContext(root), normalizeOptions())).toThrow(
      'outside OpenCode worktree',
    );
  });

  it('validates FlatMachine configs through the OpenCode tool surface', async () => {
    const root = await workspace();
    await writeFile(join(root, 'machine.yml'), finalOnlyMachine);
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const result = await hooks.tool!.flatmachine_validate.execute({ configPath: 'machine.yml' }, toolContext(root));
    expect(result).toMatchObject({
      title: 'FlatMachine config is valid',
      metadata: { valid: true },
    });
  });

  it('runs a final-only FlatMachine through the OpenCode tool surface', async () => {
    const root = await workspace();
    await writeFile(join(root, 'machine.yml'), finalOnlyMachine);
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const result = await hooks.tool!.flatmachine_run.execute({ configPath: 'machine.yml', input: {} }, toolContext(root));
    expect(JSON.parse((result as { output: string }).output).result).toEqual({ ok: true });
  });
});
