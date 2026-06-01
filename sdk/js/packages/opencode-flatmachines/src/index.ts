import type { Plugin, PluginModule, PluginOptions, ToolContext } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { FlatMachine, createSignalBackend, createTriggerBackend, sendAndNotify, validateFlatMachineConfig } from '@memgrafter/flatmachines';
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
      flatmachine_validate: tool({
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

      flatmachine_run: tool({
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
          const validation = validateFlatMachineConfig(config);
          if (!validation.valid) {
            throw new Error(`FlatMachine config is invalid: ${validation.errors.join('; ')}`);
          }

          const profilesPath = args.profilesFile ?? options.profilesFile;
          const machine = new FlatMachine({
            config: absoluteConfigPath,
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

      flatmachine_signal: tool({
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
    },
  };
};

export const server = FlatMachinesPlugin;

const plugin: PluginModule = {
  id: '@memgrafter/opencode-flatmachines',
  server,
};

export default plugin;
