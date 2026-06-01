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

const waitForMachine = `
spec: flatmachine
spec_version: "4.1.0"
data:
  states:
    wait:
      type: initial
      wait_for: "approval/{{ input.task_id }}"
      output_to_context:
        approved: "{{ output.approved }}"
      transitions:
        - condition: 'context.approved == "True"'
          to: done
        - to: rejected
    done:
      type: final
      output:
        approved: true
    rejected:
      type: final
      output:
        approved: false
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

  it('sends SQLite-backed signals that waiting machines consume', async () => {
    const root = await workspace();
    await writeFile(join(root, 'machine.yml'), waitForMachine);
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);

    const signal = await hooks.tool!.flatmachine_signal.execute({
      channel: 'approval/task-1',
      data: { approved: true },
      signalBackend: 'sqlite',
      signalDbPath: 'signals.sqlite',
    }, toolContext(root));
    expect(JSON.parse((signal as { output: string }).output).channel).toBe('approval/task-1');

    const result = await hooks.tool!.flatmachine_run.execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-1' },
      signalBackend: 'sqlite',
      signalDbPath: 'signals.sqlite',
    }, toolContext(root));
    expect(JSON.parse((result as { output: string }).output).result).toEqual({ approved: true });
  });
});
