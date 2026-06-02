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

function waitForMachinePersisted(dbPath: string, signalDbPath?: string) {
  return `
spec: flatmachine
spec_version: "4.1.0"
data:
  settings:
    backends:
      persistence: sqlite
  persistence:
    enabled: true
    backend: sqlite
    db_path: ${dbPath}
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
}

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
    const result = await hooks.tool!['flatmachine-validate'].execute({ configPath: 'machine.yml' }, toolContext(root));
    expect(result).toMatchObject({
      title: 'FlatMachine config is valid',
      metadata: { valid: true },
    });
  });

  it('runs a final-only FlatMachine through the OpenCode tool surface', async () => {
    const root = await workspace();
    await writeFile(join(root, 'machine.yml'), finalOnlyMachine);
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const result = await hooks.tool!['flatmachine-run'].execute({ configPath: 'machine.yml', input: {} }, toolContext(root));
    expect(JSON.parse((result as { output: string }).output).result).toEqual({ ok: true });
  });

  it('sends SQLite-backed signals that waiting machines consume', async () => {
    const root = await workspace();
    await writeFile(join(root, 'machine.yml'), waitForMachine);
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);

    const signal = await hooks.tool!['flatmachine-signal'].execute({
      channel: 'approval/task-1',
      data: { approved: true },
      signalBackend: 'sqlite',
      signalDbPath: 'signals.sqlite',
    }, toolContext(root));
    expect(JSON.parse((signal as { output: string }).output).channel).toBe('approval/task-1');

    const result = await hooks.tool!['flatmachine-run'].execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-1' },
      signalBackend: 'sqlite',
      signalDbPath: 'signals.sqlite',
    }, toolContext(root));
    expect(JSON.parse((result as { output: string }).output).result).toEqual({ approved: true });
  });

  it('resumes with inline signalData', async () => {
    const root = await workspace();
    const dbPath = join(root, 'checkpoints.sqlite');
    const configPath = join(root, 'machine.yml');
    await writeFile(configPath, waitForMachinePersisted(dbPath));
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);

    // Run machine — parks at wait_for, checkpoints to SQLite
    const runResult = await hooks.tool!['flatmachine-run'].execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-3' },
    }, ctx);
    const runParsed = JSON.parse((runResult as { output: string }).output);
    expect(runParsed.result._waiting).toBe(true);

    // Resume with inline signalData — injected into snapshot context
    const resumeResult = await hooks.tool!['flatmachine-resume'].execute({
      configPath: 'machine.yml',
      executionId: runParsed.executionId,
      signalData: { approved: true },
    }, ctx);
    const resumeParsed = JSON.parse((resumeResult as { output: string }).output);
    expect(resumeParsed.result).toEqual({ approved: true });
  });

  it('lists pending signals on channels', async () => {
    const root = await workspace();
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);
    const sigDb = join(root, 'signals.sqlite');

    // Send signals
    await hooks.tool!['flatmachine-signal'].execute({
      channel: 'approval/task-a',
      data: { approved: true },
      signalBackend: 'sqlite',
      signalDbPath: sigDb,
    }, ctx);
    await hooks.tool!['flatmachine-signal'].execute({
      channel: 'approval/task-b',
      data: { approved: false },
      signalBackend: 'sqlite',
      signalDbPath: sigDb,
    }, ctx);

    // List all channels
    const listResult = await hooks.tool!['flatmachine-list-signals'].execute({
      signalBackend: 'sqlite',
      signalDbPath: sigDb,
    }, ctx);
    const listParsed = JSON.parse((listResult as { output: string }).output);
    expect(listParsed.channels).toContain('approval/task-a');
    expect(listParsed.channels).toContain('approval/task-b');

    // Peek specific channel
    const peekResult = await hooks.tool!['flatmachine-list-signals'].execute({
      channel: 'approval/task-a',
      signalBackend: 'sqlite',
      signalDbPath: sigDb,
    }, ctx);
    const peekParsed = JSON.parse((peekResult as { output: string }).output);
    expect(peekParsed.count).toBe(1);
    expect(peekParsed.signals[0].data).toEqual({ approved: true });
  });

  it('dispatches signals and inspects checkpoint state', async () => {
    const root = await workspace();
    const dbPath = join(root, 'checkpoints.sqlite');
    const configPath = join(root, 'machine.yml');
    await writeFile(configPath, waitForMachinePersisted(dbPath));
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);

    // Run machine — parks at wait_for
    const runResult = await hooks.tool!['flatmachine-run'].execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-4' },
    }, ctx);
    const runParsed = JSON.parse((runResult as { output: string }).output);
    expect(runParsed.result._waiting).toBe(true);

    // Check checkpoint status — list wait_for events
    const statusResult = await hooks.tool!['flatmachine-checkpoint-status'].execute({
      mode: 'list',
      event: 'wait_for',
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx);
    const statusParsed = JSON.parse((statusResult as { output: string }).output);
    expect(statusParsed.executionIds).toContain(runParsed.executionId);

    // Load snapshot
    const snapshotResult = await hooks.tool!['flatmachine-checkpoint-status'].execute({
      mode: 'snapshot',
      executionId: runParsed.executionId,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx) as any;
    const snapshotParsed = JSON.parse(snapshotResult.output);
    expect(snapshotResult.metadata.found).toBe(true);
    expect(snapshotResult.metadata.waiting).toBe(true);
    expect(snapshotParsed.waitingChannel).toBe('approval/task-4');

    // Dispatch — needs a signal to consume, then injects data into checkpoint
    const sigDb = join(root, 'signals.sqlite');
    await hooks.tool!['flatmachine-signal'].execute({
      channel: 'approval/task-4',
      data: { approved: true },
      signalBackend: 'sqlite',
      signalDbPath: sigDb,
    }, ctx);

    const dispatchResult = await hooks.tool!['flatmachine-dispatch'].execute({
      channel: 'approval/task-4',
      signalBackend: 'sqlite',
      signalDbPath: sigDb,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx);
    const dispatchParsed = JSON.parse((dispatchResult as { output: string }).output);
    expect(dispatchParsed.count).toBe(1);
    expect(dispatchParsed.resumedExecutionIds).toContain(runParsed.executionId);
  });

  it('prunes and deletes execution checkpoints', async () => {
    const root = await workspace();
    const dbPath = join(root, 'checkpoints.sqlite');
    const configPath = join(root, 'machine.yml');
    await writeFile(configPath, waitForMachinePersisted(dbPath));
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);

    // Run machine to create a checkpoint
    const runResult = await hooks.tool!['flatmachine-run'].execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-5' },
    }, ctx);
    const runParsed = JSON.parse((runResult as { output: string }).output);
    expect(runParsed.result._waiting).toBe(true);

    // Prune with maxCount=0 (keep nothing, delete all)
    const pruneResult = await hooks.tool!['flatmachine-checkpoint-prune'].execute({
      maxCount: 0,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx);
    const pruneParsed = JSON.parse((pruneResult as { output: string }).output);
    expect(pruneParsed.deleted).toBeGreaterThanOrEqual(1);

    // Run another machine
    const runResult2 = await hooks.tool!['flatmachine-run'].execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-6' },
    }, ctx);
    const runParsed2 = JSON.parse((runResult2 as { output: string }).output);

    // Delete specific execution
    const deleteResult = await hooks.tool!['flatmachine-delete-execution'].execute({
      executionId: runParsed2.executionId,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx) as any;
    expect(deleteResult.metadata.deleted).toBe(true);

    // Verify it's gone
    const snapshotResult = await hooks.tool!['flatmachine-checkpoint-status'].execute({
      mode: 'snapshot',
      executionId: runParsed2.executionId,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx) as any;
    expect(snapshotResult.metadata.found).toBe(false);
  });

  it('forks a checkpoint to a new execution', async () => {
    const root = await workspace();
    const dbPath = join(root, 'checkpoints.sqlite');
    const configPath = join(root, 'machine.yml');
    await writeFile(configPath, waitForMachinePersisted(dbPath));
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);

    // Run machine — parks at wait_for
    const runResult = await hooks.tool!['flatmachine-run'].execute({
      configPath: 'machine.yml',
      input: { task_id: 'task-fork' },
    }, ctx);
    const runParsed = JSON.parse((runResult as { output: string }).output);
    expect(runParsed.result._waiting).toBe(true);

    // Fork the checkpoint
    const forkResult = await hooks.tool!['flatmachine-fork'].execute({
      executionId: runParsed.executionId,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx) as any;
    expect(forkResult.metadata.parentExecutionId).toBe(runParsed.executionId);
    expect(forkResult.metadata.newExecutionId).not.toBe(runParsed.executionId);

    // Original still exists
    const origResult = await hooks.tool!['flatmachine-checkpoint-status'].execute({
      mode: 'snapshot',
      executionId: runParsed.executionId,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx) as any;
    expect(origResult.metadata.found).toBe(true);

    // Fork also exists
    const forkSnapshot = await hooks.tool!['flatmachine-checkpoint-status'].execute({
      mode: 'snapshot',
      executionId: forkResult.metadata.newExecutionId,
      persistenceBackend: 'sqlite',
      persistenceDbPath: dbPath,
    }, ctx) as any;
    expect(forkSnapshot.metadata.found).toBe(true);
  });

  it('returns JSON schema for flatmachine configs', async () => {
    const root = await workspace();
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);

    const result = await hooks.tool!['flatmachine-get-schema'].execute({
      schemaType: 'flatmachine',
    }, ctx);
    const parsed = JSON.parse((result as { output: string }).output);
    expect(parsed).toHaveProperty('definitions');
    expect(parsed.definitions).toHaveProperty('MachineWrapper');
  });

  it('launches a machine as fire-and-forget', async () => {
    const root = await workspace();
    await writeFile(join(root, 'machine.yml'), finalOnlyMachine);
    const hooks = await FlatMachinesPlugin({ directory: root, worktree: root } as any);
    const ctx = toolContext(root);

    const result = await hooks.tool!['flatmachine-launch'].execute({
      configPath: 'machine.yml',
      input: {},
    }, ctx) as any;
    expect(result.metadata.launched).toBe(true);
    expect(result.metadata.executionId).toBeDefined();
  });
});
