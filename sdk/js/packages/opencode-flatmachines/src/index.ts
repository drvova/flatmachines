import type { Plugin, PluginModule, PluginOptions, ToolContext } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import {
  FlatMachine,
  CheckpointManager,
  MemoryBackend,
  LocalFileBackend,
  SQLiteCheckpointBackend,
  SignalDispatcher,
  ConfigStoreResumer,
  cloneSnapshot,
  launch_machine,
  createSignalBackend,
  createTriggerBackend,
  sendAndNotify,
  validateFlatMachineConfig,
  // Hooks
  HooksRegistry,
  LoggingHooks,
  CompositeHooks,
  WebhookHooks,
  // Expression
  evaluate,
  evaluateCel,
  // Workers
  createRegistrationBackend,
  createWorkBackend,
} from '@memgrafter/flatmachines';
import type { PersistenceBackend } from '@memgrafter/flatmachines';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

type FlatMachinesPluginOptions = {
  allowExternalPaths: boolean;
  defaultConfigPath?: string;
  profilesFile?: string;
};

type PathContext = Pick<ToolContext, 'directory' | 'worktree'>;
const signalBackends = ['memory', 'sqlite'] as const;
const triggerBackends = ['none', 'file', 'socket'] as const;
const persistenceBackends = ['memory', 'local', 'sqlite'] as const;

function stringOption(options: PluginOptions | undefined, key: string): string | undefined {
  const value = options?.[key];
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${key} must be a non-empty string when provided`);
  }
  return value;
}

function booleanOption(options: PluginOptions | undefined, key: string, fallback: boolean): boolean {
  const value = options?.[key];
  if (value == null) return fallback;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${key} must be a boolean when provided`);
  }
  return value;
}

export function normalizeOptions(options?: PluginOptions): FlatMachinesPluginOptions {
  return {
    allowExternalPaths: booleanOption(options, 'allowExternalPaths', false),
    defaultConfigPath: stringOption(options, 'defaultConfigPath'),
    profilesFile: stringOption(options, 'profilesFile'),
  };
}

function workspaceRoot(context: PathContext): string {
  return resolve(context.worktree || context.directory || process.cwd());
}

export function resolveWorkspacePath(rawPath: string, context: PathContext, options: FlatMachinesPluginOptions): string {
  if (!rawPath.trim()) {
    throw new TypeError('path must be a non-empty string');
  }

  const root = workspaceRoot(context);
  const absolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (options.allowExternalPaths) return absolute;

  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Refusing to access path outside OpenCode worktree: ${rawPath}`);
  }
  return absolute;
}

async function loadConfig(path: string): Promise<Record<string, unknown>> {
  const source = await readFile(path, 'utf8');
  const parsed = parseYaml(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`FlatMachine config must be a YAML or JSON object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function configPath(inputPath: string | undefined, options: FlatMachinesPluginOptions): string {
  const path = inputPath ?? options.defaultConfigPath;
  if (!path) {
    throw new Error('configPath is required unless defaultConfigPath is set in the plugin options');
  }
  return path;
}

function signalBackendOptions(dbPath: string | undefined, context: PathContext, options: FlatMachinesPluginOptions) {
  return dbPath ? { db_path: resolveWorkspacePath(dbPath, context, options) } : undefined;
}

function triggerBackendOptions(
  args: { triggerBasePath?: string; triggerSocketPath?: string },
  context: PathContext,
  options: FlatMachinesPluginOptions,
) {
  return {
    base_path: args.triggerBasePath ? resolveWorkspacePath(args.triggerBasePath, context, options) : undefined,
    socket_path: args.triggerSocketPath ? resolveWorkspacePath(args.triggerSocketPath, context, options) : undefined,
  };
}

/**
 * Resolve relative db_path in persistence config to absolute path based on config directory.
 * Without this, SQLite resolves relative to the MCP server's CWD — which may differ
 * from the config file's directory, causing checkpoints to be written to the wrong location.
 * Also sets db_path to a sensible default if not specified.
 * Handles both data.persistence and data.settings.backends.persistence paths.
 */
function resolveConfigPersistence(config: Record<string, any>, configDir: string): void {
  const data = (config as any)?.data;
  if (!data) return;

  // Primary: data.persistence
  const persistence = data.persistence;
  if (persistence?.backend === 'sqlite') {
    if (!persistence.db_path) {
      persistence.db_path = resolve(configDir, 'flatmachines.sqlite');
    } else if (!isAbsolute(persistence.db_path)) {
      persistence.db_path = resolve(configDir, persistence.db_path);
    }
  }

  // Also: data.settings.backends.persistence (db_path for settings-level)
  const settingsPersistence = data.settings?.backends?.persistence;
  if (settingsPersistence && typeof settingsPersistence === 'object' && settingsPersistence.backend === 'sqlite') {
    if (!settingsPersistence.db_path) {
      settingsPersistence.db_path = resolve(configDir, 'flatmachines.sqlite');
    } else if (!isAbsolute(settingsPersistence.db_path)) {
      settingsPersistence.db_path = resolve(configDir, settingsPersistence.db_path);
    }
  }
}

function createPersistenceBackend(
  type: string,
  dbPath: string | undefined,
  context: PathContext,
  options: FlatMachinesPluginOptions,
): PersistenceBackend {
  if (type === 'memory') return new MemoryBackend();
  if (type === 'local') return new LocalFileBackend();
  if (type === 'sqlite') {
    const resolvedPath = dbPath ? resolveWorkspacePath(dbPath, context, options) : 'flatmachines.sqlite';
    return new SQLiteCheckpointBackend(resolvedPath);
  }
  throw new Error(`Unknown persistence backend type: ${type}`);
}

function jsonOutput(title: string, value: unknown, metadata?: Record<string, unknown>) {
  return {
    title,
    output: JSON.stringify(value, null, 2),
    metadata,
  };
}

export const FlatMachinesPlugin: Plugin = async (_ctx, rawOptions) => {
  const options = normalizeOptions(rawOptions);

  return {
    tool: {
      'flatmachine-validate': tool({
        description: 'Validate a FlatMachine YAML or JSON config from the current OpenCode worktree.',
        args: {
          configPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const absoluteConfigPath = resolveWorkspacePath(configPath(args.configPath, options), context, options);
          const config = await loadConfig(absoluteConfigPath);
          const validation = validateFlatMachineConfig(config);
          return jsonOutput(
            validation.valid ? 'FlatMachine config is valid' : 'FlatMachine config is invalid',
            {
              configPath: absoluteConfigPath,
              ...validation,
            },
            { valid: validation.valid, configPath: absoluteConfigPath },
          );
        },
      }),

      'flatmachine-run': tool({
        description: 'Validate and execute a FlatMachine config with JSON input.',
        args: {
          configPath: tool.schema.string().optional(),
          input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          executionId: tool.schema.string().optional(),
          profilesFile: tool.schema.string().optional(),
          signalBackend: tool.schema.enum(signalBackends).optional(),
          signalDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const absoluteConfigPath = resolveWorkspacePath(configPath(args.configPath, options), context, options);
          const config = await loadConfig(absoluteConfigPath);
          resolveConfigPersistence(config, dirname(absoluteConfigPath));
          const validation = validateFlatMachineConfig(config);
          if (!validation.valid) {
            throw new Error(`FlatMachine config is invalid: ${validation.errors.join('; ')}`);
          }

          const profilesPath = args.profilesFile ?? options.profilesFile;
          const machine = new FlatMachine({
            config: config as any,
            configDir: dirname(absoluteConfigPath),
            executionId: args.executionId,
            profilesFile: profilesPath ? resolveWorkspacePath(profilesPath, context, options) : undefined,
            signalBackend: args.signalBackend
              ? createSignalBackend(args.signalBackend, signalBackendOptions(args.signalDbPath, context, options))
              : undefined,
          });

          const result = await machine.execute(args.input ?? {});
          return jsonOutput(
            'FlatMachine execution finished',
            {
              executionId: machine.executionId,
              result,
              warnings: validation.warnings,
            },
            {
              executionId: machine.executionId,
              waiting: Boolean(result?._waiting),
            },
          );
        },
      }),

      'flatmachine-signal': tool({
        description: 'Send a FlatMachines signal and notify an optional trigger backend.',
        args: {
          channel: tool.schema.string(),
          data: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          signalBackend: tool.schema.enum(signalBackends).default('memory'),
          signalDbPath: tool.schema.string().optional(),
          triggerBackend: tool.schema.enum(triggerBackends).default('none'),
          triggerBasePath: tool.schema.string().optional(),
          triggerSocketPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const signalBackend = createSignalBackend(
            args.signalBackend,
            signalBackendOptions(args.signalDbPath, context, options),
          );
          const triggerBackend = createTriggerBackend(
            args.triggerBackend,
            triggerBackendOptions(args, context, options),
          );
          const signalId = await sendAndNotify(signalBackend, triggerBackend, args.channel, args.data ?? {});
          return jsonOutput(
            'FlatMachine signal sent',
            {
              signalId,
              channel: args.channel,
              backend: args.signalBackend,
              trigger: args.triggerBackend,
            },
            {
              signalId,
              channel: args.channel,
            },
          );
        },
      }),

      'flatmachine-resume': tool({
        description: 'Resume a parked FlatMachine from its last checkpoint. Loads the checkpoint, optionally injects signal data, and continues execution. When configPath is omitted, uses ConfigStoreResumer to reconstruct the machine from the persisted config hash.',
        args: {
          configPath: tool.schema.string().optional(),
          executionId: tool.schema.string(),
          signalData: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          profilesFile: tool.schema.string().optional(),
          signalBackend: tool.schema.enum(signalBackends).optional(),
          signalDbPath: tool.schema.string().optional(),
          persistenceBackend: tool.schema.enum(persistenceBackends).default('sqlite'),
          persistenceDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const hasConfigPath = args.configPath ?? options.defaultConfigPath;

          if (hasConfigPath) {
            // Standard path: create FlatMachine from config file
            const absoluteConfigPath = resolveWorkspacePath(configPath(args.configPath, options), context, options);
            const config = await loadConfig(absoluteConfigPath);
            resolveConfigPersistence(config, dirname(absoluteConfigPath));
            const validation = validateFlatMachineConfig(config);
            if (!validation.valid) {
              throw new Error(`FlatMachine config is invalid: ${validation.errors.join('; ')}`);
            }

            const profilesPath = args.profilesFile ?? options.profilesFile;
            const machine = new FlatMachine({
              config: config as any,
              configDir: dirname(absoluteConfigPath),
              profilesFile: profilesPath ? resolveWorkspacePath(profilesPath, context, options) : undefined,
              signalBackend: args.signalBackend
                ? createSignalBackend(args.signalBackend, signalBackendOptions(args.signalDbPath, context, options))
                : undefined,
            });

            const checkpointMgr = (machine as any).checkpointManager;
            if (!checkpointMgr) {
              throw new Error('Machine does not have persistence enabled — cannot resume');
            }
            const snapshot = await checkpointMgr.restore(args.executionId);
            if (!snapshot) {
              throw new Error(`No checkpoint found for execution ${args.executionId}`);
            }

            if (args.signalData) {
              snapshot.context._signal_data = args.signalData;
            }

            const result = await machine.execute(undefined, snapshot);
            return jsonOutput(
              'FlatMachine resumed',
              { executionId: args.executionId, result },
              { executionId: args.executionId, waiting: Boolean(result?._waiting) },
            );
          }

          // ConfigPath-free path: use ConfigStoreResumer to reconstruct from config hash
          const persBackend = createPersistenceBackend(
            args.persistenceBackend,
            args.persistenceDbPath,
            context,
            options,
          );

          if (!(persBackend instanceof SQLiteCheckpointBackend)) {
            throw new Error('ConfigPath-free resume requires sqlite persistence backend');
          }

          const snapshot = await persBackend.loadLatest(args.executionId);
          if (!snapshot) {
            throw new Error(`No checkpoint found for execution ${args.executionId}`);
          }
          if (!snapshot.config_hash) {
            throw new Error('Cannot resume without configPath: checkpoint has no config_hash. Provide configPath explicitly.');
          }

          const resumer = new ConfigStoreResumer({
            signalBackend: args.signalBackend
              ? createSignalBackend(args.signalBackend, signalBackendOptions(args.signalDbPath, context, options))
              : createSignalBackend('memory'),
            persistenceBackend: persBackend,
            configStore: persBackend.configStore,
          });

          const result = await resumer.resume(args.executionId, args.signalData);
          return jsonOutput(
            'FlatMachine resumed (via config store)',
            { executionId: args.executionId, result },
            { executionId: args.executionId, waiting: Boolean(result?._waiting) },
          );
        },
      }),

      'flatmachine-dispatch': tool({
        description: 'Dispatch pending signals to waiting machines on a channel. Finds machines parked at wait_for, injects signal data into their checkpoints, and returns execution IDs to resume.',
        args: {
          channel: tool.schema.string(),
          signalBackend: tool.schema.enum(signalBackends).default('sqlite'),
          signalDbPath: tool.schema.string().optional(),
          persistenceBackend: tool.schema.enum(persistenceBackends).default('sqlite'),
          persistenceDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const sigBackend = createSignalBackend(
            args.signalBackend,
            signalBackendOptions(args.signalDbPath, context, options),
          );
          const persBackend = createPersistenceBackend(
            args.persistenceBackend,
            args.persistenceDbPath,
            context,
            options,
          );

          const dispatcher = new SignalDispatcher(sigBackend, persBackend, {
            resumeFn: async () => {},
          });
          const resumed = await dispatcher.dispatch(args.channel);
          return jsonOutput(
            resumed.length ? 'Signals dispatched' : 'No waiting machines found',
            {
              channel: args.channel,
              resumedExecutionIds: resumed,
              count: resumed.length,
            },
            {
              channel: args.channel,
              dispatched: resumed.length > 0,
            },
          );
        },
      }),

      'flatmachine-checkpoint-status': tool({
        description: 'Inspect FlatMachine checkpoint state. List executions by filter, or load a specific execution snapshot.',
        args: {
          mode: tool.schema.enum(['list', 'snapshot'] as const).default('list'),
          executionId: tool.schema.string().optional(),
          event: tool.schema.string().optional(),
          waitingChannel: tool.schema.string().optional(),
          persistenceBackend: tool.schema.enum(persistenceBackends).default('sqlite'),
          persistenceDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const persBackend = createPersistenceBackend(
            args.persistenceBackend,
            args.persistenceDbPath,
            context,
            options,
          );

          if (args.mode === 'snapshot') {
            if (!args.executionId) throw new Error('executionId is required for snapshot mode');
            const checkpointMgr = new CheckpointManager(persBackend);
            const snapshot = await checkpointMgr.restore(args.executionId);
            if (!snapshot) {
              return jsonOutput(
                'No checkpoint found',
                { executionId: args.executionId },
                { found: false },
              );
            }
            return jsonOutput(
              'Checkpoint snapshot loaded',
              {
                executionId: snapshot.execution_id,
                machineName: snapshot.machine_name,
                currentState: snapshot.current_state,
                step: snapshot.step,
                event: snapshot.event,
                waitingChannel: snapshot.waiting_channel,
                createdAt: snapshot.created_at,
                context: snapshot.context,
                output: snapshot.output,
                depth: snapshot.depth,
              },
              {
                executionId: snapshot.execution_id,
                found: true,
                waiting: snapshot.event === 'wait_for',
              },
            );
          }

          // list mode
          if (!persBackend.listExecutionIds) {
            throw new Error(`Persistence backend does not support listing executions`);
          }
          const filter: Record<string, string> = {};
          if (args.event) filter.event = args.event;
          if (args.waitingChannel) filter.waiting_channel = args.waitingChannel;
          const executionIds = await persBackend.listExecutionIds(filter);
          return jsonOutput(
            `Found ${executionIds.length} execution(s)`,
            {
              executionIds,
              count: executionIds.length,
              filter,
            },
            {
              count: executionIds.length,
            },
          );
        },
      }),

      'flatmachine-list-signals': tool({
        description: 'List pending signals in the signal backend. See which channels have signals and peek at signal data without consuming.',
        args: {
          channel: tool.schema.string().optional(),
          signalBackend: tool.schema.enum(signalBackends).default('sqlite'),
          signalDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const sigBackend = createSignalBackend(
            args.signalBackend,
            signalBackendOptions(args.signalDbPath, context, options),
          );

          if (args.channel) {
            const signals = await sigBackend.peek(args.channel);
            return jsonOutput(
              `Found ${signals.length} signal(s) on channel "${args.channel}"`,
              {
                channel: args.channel,
                signals,
                count: signals.length,
              },
              {
                channel: args.channel,
                count: signals.length,
              },
            );
          }

          const channels = await sigBackend.channels();
          const channelSignals: Record<string, number> = {};
          for (const ch of channels) {
            const sigs = await sigBackend.peek(ch);
            channelSignals[ch] = sigs.length;
          }
          return jsonOutput(
            `Found ${channels.length} channel(s) with pending signals`,
            {
              channels,
              signalCounts: channelSignals,
              totalChannels: channels.length,
            },
            {
              totalChannels: channels.length,
            },
          );
        },
      }),

      'flatmachine-checkpoint-prune': tool({
        description: 'Prune old FlatMachine checkpoints by age or count. Returns the number of executions deleted.',
        args: {
          maxAgeSeconds: tool.schema.number().optional(),
          maxCount: tool.schema.number().optional(),
          persistenceBackend: tool.schema.enum(persistenceBackends).default('sqlite'),
          persistenceDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          if (args.maxAgeSeconds == null && args.maxCount == null) {
            throw new Error('At least one of maxAgeSeconds or maxCount is required');
          }
          const persBackend = createPersistenceBackend(
            args.persistenceBackend,
            args.persistenceDbPath,
            context,
            options,
          );
          if (!persBackend.prune) {
            throw new Error(`Persistence backend does not support pruning`);
          }
          const deleted = await persBackend.prune({
            max_age_seconds: args.maxAgeSeconds,
            max_count: args.maxCount,
          });
          return jsonOutput(
            `Pruned ${deleted} execution(s)`,
            {
              deleted,
              maxAgeSeconds: args.maxAgeSeconds,
              maxCount: args.maxCount,
            },
            { deleted },
          );
        },
      }),

      'flatmachine-delete-execution': tool({
        description: 'Delete all checkpoints for a specific FlatMachine execution.',
        args: {
          executionId: tool.schema.string(),
          persistenceBackend: tool.schema.enum(persistenceBackends).default('sqlite'),
          persistenceDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const persBackend = createPersistenceBackend(
            args.persistenceBackend,
            args.persistenceDbPath,
            context,
            options,
          );
          if (!persBackend.deleteExecution) {
            throw new Error(`Persistence backend does not support deleteExecution`);
          }
          await persBackend.deleteExecution(args.executionId);
          return jsonOutput(
            'Execution deleted',
            {
              executionId: args.executionId,
            },
            {
              executionId: args.executionId,
              deleted: true,
            },
          );
        },
      }),

      'flatmachine-fork': tool({
        description: 'Fork a FlatMachine checkpoint to a new execution ID. Clones the snapshot with a new identity, preserving parent_execution_id lineage. Use to explore alternative execution paths without losing the original.',
        args: {
          executionId: tool.schema.string(),
          newExecutionId: tool.schema.string().optional(),
          persistenceBackend: tool.schema.enum(persistenceBackends).default('sqlite'),
          persistenceDbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const persBackend = createPersistenceBackend(
            args.persistenceBackend,
            args.persistenceDbPath,
            context,
            options,
          );
          const checkpointMgr = new CheckpointManager(persBackend);
          const snapshot = await checkpointMgr.restore(args.executionId);
          if (!snapshot) {
            throw new Error(`No checkpoint found for execution ${args.executionId}`);
          }

          const { randomUUID } = await import('node:crypto');
          const newId = args.newExecutionId ?? randomUUID();
          const cloned = await cloneSnapshot(snapshot, newId, persBackend);

          return jsonOutput(
            'Execution forked',
            {
              newExecutionId: cloned.execution_id,
              parentExecutionId: args.executionId,
              machineName: cloned.machine_name,
              currentState: cloned.current_state,
              step: cloned.step,
            },
            {
              newExecutionId: cloned.execution_id,
              parentExecutionId: args.executionId,
            },
          );
        },
      }),

      'flatmachine-get-schema': tool({
        description: 'Return the JSON Schema for FlatMachine configs. Use this to understand the config structure before writing YAML.',
        args: {
          schemaType: tool.schema.enum(['flatmachine', 'flatagent', 'profile'] as const).default('flatmachine'),
        },
        async execute(args) {
          const schemaMap: Record<string, string> = {
            flatmachine: 'flatmachine.schema.json',
            flatagent: 'flatagent.schema.json',
            profile: 'profile.schema.json',
          };
          const schemaFile = schemaMap[args.schemaType];
          if (!schemaFile) throw new Error(`Unknown schema type: ${args.schemaType}`);

          // Resolve from the flatmachines package assets directory
          const { createRequire } = await import('node:module');
          const require = createRequire(import.meta.url);
          let schemaPath: string;
          try {
            schemaPath = require.resolve(`@memgrafter/flatmachines/schemas/${schemaFile}`);
          } catch {
            // Fallback: resolve relative to the flatmachines package
            const { resolve: pathResolve } = await import('node:path');
            schemaPath = pathResolve(__dirname, `../../flatmachines/schemas/${schemaFile}`);
          }
          const schemaContent = await readFile(schemaPath, 'utf8');
          const schema = JSON.parse(schemaContent);

          return jsonOutput(
            `JSON Schema for ${args.schemaType}`,
            schema,
            { schemaType: args.schemaType },
          );
        },
      }),

      'flatmachine-launch': tool({
        description: 'Launch a FlatMachine as a fire-and-forget subprocess. Returns immediately with an execution ID. Unlike flatmachine_run which blocks until completion, this starts the machine in the background.',
        args: {
          configPath: tool.schema.string().optional(),
          input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          executionId: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const absoluteConfigPath = resolveWorkspacePath(configPath(args.configPath, options), context, options);
          const config = await loadConfig(absoluteConfigPath);
          resolveConfigPersistence(config, dirname(absoluteConfigPath));
          const validation = validateFlatMachineConfig(config);
          if (!validation.valid) {
            throw new Error(`FlatMachine config is invalid: ${validation.errors.join('; ')}`);
          }

          const { randomUUID } = await import('node:crypto');
          const execId = args.executionId ?? randomUUID();
          await launch_machine(config, args.input ?? {}, {
            workingDir: dirname(absoluteConfigPath),
            executionId: execId,
          });

          return jsonOutput(
            'FlatMachine launched',
            {
              executionId: execId,
              configPath: absoluteConfigPath,
            },
            {
              executionId: execId,
               launched: true,
            },
          );
        },
      }),

      // ── Infrastructure Tools ──────────────────────────────────────────────

      'flatmachine-hooks': tool({
        description: 'Manage FlatMachine hooks — register, list, and inspect hook factories for lifecycle events.',
        args: {
          action: tool.schema.enum(['register', 'list', 'get'] as const),
          name: tool.schema.string().optional(),
          hookType: tool.schema.enum(['logging', 'composite', 'webhook'] as const).optional(),
          webhookUrl: tool.schema.string().optional(),
        },
        async execute(args) {
          const registry = new HooksRegistry();

          if (args.action === 'register') {
            if (!args.name) throw new Error('name is required for register');
            if (!args.hookType) throw new Error('hookType is required for register');
            let factory: any;
            if (args.hookType === 'logging') factory = () => new LoggingHooks();
            else if (args.hookType === 'composite') factory = () => new CompositeHooks([]);
            else if (args.hookType === 'webhook') {
              if (!args.webhookUrl) throw new Error('webhookUrl is required for webhook hooks');
              factory = () => new WebhookHooks(args.webhookUrl!);
            }
            registry.register(args.name, factory);
            return jsonOutput('Hook registered', { name: args.name, hookType: args.hookType }, { registered: true });
          }

          if (args.action === 'get') {
            if (!args.name) throw new Error('name is required for get');
            const has = registry.has(args.name);
            return jsonOutput(`Hook "${args.name}" ${has ? 'found' : 'not found'}`, { name: args.name, exists: has }, { exists: has });
          }

          // list
          return jsonOutput('Hooks registry is empty (created fresh per call)', { hooks: [] }, { count: 0 });
        },
      }),

      'flatmachine-backend': tool({
        description: 'Create and inspect FlatMachine backends — persistence, signal, result, and lock backends.',
        args: {
          action: tool.schema.enum(['create-persistence', 'create-signal', 'create-result', 'list-types'] as const),
          backendType: tool.schema.enum(['memory', 'local', 'sqlite'] as const).optional(),
          dbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          if (args.action === 'list-types') {
            return jsonOutput('Available backend types', {
              persistence: ['memory', 'local', 'sqlite'],
              signal: ['memory', 'sqlite'],
              result: ['memory'],
              lock: ['none', 'local', 'sqlite'],
              registration: ['memory', 'sqlite'],
              work: ['memory', 'sqlite'],
            });
          }

          const backendType = args.backendType ?? 'memory';

          if (args.action === 'create-persistence') {
            const backend = createPersistenceBackend(
              backendType,
              args.dbPath,
              context,
              options,
            );
            return jsonOutput(`Created ${backendType} persistence backend`, {
              type: backendType,
              dbPath: args.dbPath,
              hasListExecutionIds: typeof (backend as any).listExecutionIds === 'function',
              hasPrune: typeof (backend as any).prune === 'function',
              hasDeleteExecution: typeof (backend as any).deleteExecution === 'function',
            });
          }

          if (args.action === 'create-signal') {
            const backend = createSignalBackend(
              backendType,
              signalBackendOptions(args.dbPath, context, options),
            );
            return jsonOutput(`Created ${backendType} signal backend`, {
              type: backendType,
              hasSend: typeof (backend as any).send === 'function',
              hasConsume: typeof (backend as any).consume === 'function',
              hasPeek: typeof (backend as any).peek === 'function',
              hasChannels: typeof (backend as any).channels === 'function',
            });
          }

          // create-result
          return jsonOutput('In-memory result backend', { type: 'memory' });
        },
      }),

      'flatmachine-execution': tool({
        description: 'List and describe FlatMachine execution types — default, retry, parallel, mdap_voting.',
        args: {
          action: tool.schema.enum(['list-types', 'describe'] as const),
          executionType: tool.schema.enum(['default', 'retry', 'parallel', 'mdap_voting'] as const).optional(),
        },
        async execute(args) {
          const types: Record<string, any> = {
            default: { description: 'Single sequential execution', config: {} },
            retry: { description: 'Retry with exponential backoff', config: { backoffs: [2, 8, 16], jitter: 0.1 } },
            parallel: { description: 'Run N samples in parallel', config: { n_samples: 3 } },
            mdap_voting: { description: 'Multi-sample with voting', config: { k_margin: 0.2, max_candidates: 3 } },
          };

          if (args.action === 'list-types') {
            return jsonOutput('Execution types', types);
          }

          if (!args.executionType) throw new Error('executionType is required for describe');
          return jsonOutput(`Execution type: ${args.executionType}`, types[args.executionType]);
        },
      }),

      'flatmachine-expression': tool({
        description: 'Evaluate FlatMachine expressions against context data. Use to test transition conditions before committing to config.',
        args: {
          expression: tool.schema.string(),
          engine: tool.schema.enum(['simple', 'cel'] as const).default('simple'),
          context: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          output: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
        },
        async execute(args) {
          const ctx = {
            context: args.context ?? {},
            input: args.input ?? {},
            output: args.output ?? {},
          };

          const result = args.engine === 'cel'
            ? evaluateCel(args.expression, ctx)
            : evaluate(args.expression, ctx);

          return jsonOutput(`Expression result (${args.engine})`, {
            expression: args.expression,
            engine: args.engine,
            result,
            resultType: typeof result,
          });
        },
      }),

      'flatmachine-monitor': tool({
        description: 'FlatMachine monitoring and logging — configure logging, get loggers, track operations.',
        args: {
          action: tool.schema.enum(['list-hooks', 'describe'] as const),
          hookType: tool.schema.enum(['logging', 'webhook', 'composite'] as const).optional(),
        },
        async execute(args) {
          if (args.action === 'list-hooks') {
            return jsonOutput('Available hook types', {
              logging: { class: 'LoggingHooks', description: 'Logs all lifecycle events to console' },
              webhook: { class: 'WebhookHooks', description: 'POSTs lifecycle events to a URL' },
              composite: { class: 'CompositeHooks', description: 'Chains multiple hooks together' },
            });
          }

          if (!args.hookType) throw new Error('hookType is required for describe');
          const descriptions: Record<string, any> = {
            logging: { class: 'LoggingHooks', methods: ['onMachineStart', 'onMachineEnd', 'onStateEnter', 'onStateExit', 'onTransition', 'onError', 'onAction'] },
            webhook: { class: 'WebhookHooks', methods: ['onMachineStart', 'onMachineEnd', 'onStateEnter', 'onStateExit'], config: { url: 'string' } },
            composite: { class: 'CompositeHooks', methods: ['all'], config: { hooks: 'MachineHooks[]' } },
          };
          return jsonOutput(`Hook: ${args.hookType}`, descriptions[args.hookType]);
        },
      }),

      'flatmachine-worker': tool({
        description: 'Manage distributed worker registration — register, heartbeat, update status, get, and list workers.',
        args: {
          action: tool.schema.enum(['register', 'heartbeat', 'update-status', 'get', 'list'] as const),
          workerId: tool.schema.string().optional(),
          poolId: tool.schema.string().optional(),
          capability: tool.schema.string().optional(),
          status: tool.schema.enum(['active', 'terminated', 'lost'] as const).optional(),
          backendType: tool.schema.enum(['memory', 'sqlite'] as const).default('memory'),
          dbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const backend = createRegistrationBackend(args.backendType, signalBackendOptions(args.dbPath, context, options));

          if (args.action === 'register') {
            if (!args.poolId) throw new Error('poolId is required for register');
            const { randomUUID } = await import('node:crypto');
            const record = await backend.register({
              worker_id: args.workerId ?? randomUUID(),
              pool_id: args.poolId,
              capabilities: args.capability ? [args.capability] : undefined,
            });
            return jsonOutput('Worker registered', record, { workerId: record.worker_id });
          }

          if (args.action === 'heartbeat') {
            if (!args.workerId) throw new Error('workerId is required for heartbeat');
            await backend.heartbeat(args.workerId);
            return jsonOutput('Heartbeat sent', { workerId: args.workerId });
          }

          if (args.action === 'update-status') {
            if (!args.workerId || !args.status) throw new Error('workerId and status are required');
            await backend.updateStatus(args.workerId, args.status);
            return jsonOutput('Status updated', { workerId: args.workerId, status: args.status });
          }

          if (args.action === 'get') {
            if (!args.workerId) throw new Error('workerId is required for get');
            const record = await backend.get(args.workerId);
            return jsonOutput(record ? 'Worker found' : 'Worker not found', record ?? { workerId: args.workerId }, { found: !!record });
          }

          // list
          const filter: any = {};
          if (args.status) filter.status = args.status;
          if (args.poolId) filter.pool_id = args.poolId;
          if (args.capability) filter.capability = args.capability;
          const workers = await backend.list(filter);
          return jsonOutput(`Found ${workers.length} worker(s)`, { workers, count: workers.length }, { count: workers.length });
        },
      }),

      'flatmachine-work': tool({
        description: 'Manage work pool operations — push, claim, complete, fail, check size, and release work items.',
        args: {
          action: tool.schema.enum(['push', 'claim', 'complete', 'fail', 'size', 'release'] as const),
          pool: tool.schema.string().default('default'),
          workerId: tool.schema.string().optional(),
          itemId: tool.schema.string().optional(),
          data: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          error: tool.schema.string().optional(),
          backendType: tool.schema.enum(['memory', 'sqlite'] as const).default('memory'),
          dbPath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const workBackend = createWorkBackend(args.backendType, signalBackendOptions(args.dbPath, context, options));
          const pool = workBackend.pool(args.pool);

          if (args.action === 'push') {
            if (!args.data) throw new Error('data is required for push');
            const itemId = await pool.push(args.data);
            return jsonOutput('Work item pushed', { itemId, pool: args.pool }, { itemId });
          }

          if (args.action === 'claim') {
            if (!args.workerId) throw new Error('workerId is required for claim');
            const item = await pool.claim(args.workerId);
            return jsonOutput(item ? 'Work item claimed' : 'No work items available', item ?? {}, { found: !!item });
          }

          if (args.action === 'complete') {
            if (!args.itemId) throw new Error('itemId is required for complete');
            await pool.complete(args.itemId, args.data);
            return jsonOutput('Work item completed', { itemId: args.itemId });
          }

          if (args.action === 'fail') {
            if (!args.itemId) throw new Error('itemId is required for fail');
            await pool.fail(args.itemId, args.error);
            return jsonOutput('Work item marked as failed', { itemId: args.itemId, error: args.error });
          }

          if (args.action === 'size') {
            const size = await pool.size();
            return jsonOutput(`Pool "${args.pool}" size: ${size}`, { pool: args.pool, size }, { size });
          }

          // release
          if (!args.workerId) throw new Error('workerId is required for release');
          const released = await pool.releaseByWorker(args.workerId);
          return jsonOutput(`Released ${released} item(s)`, { workerId: args.workerId, released }, { released });
        },
      }),
    },
  };
};

export const server = FlatMachinesPlugin;

const plugin: PluginModule = {
  id: '@memgrafter/opencode-flatmachines',
  server,
};

export default plugin;
