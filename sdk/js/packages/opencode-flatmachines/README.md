# @memgrafter/opencode-flatmachines

OpenCode plugin for running FlatMachine workflows from any OpenCode project.

## Install

For global OpenCode use, add the npm plugin to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@memgrafter/opencode-flatmachines",
      {
        "defaultConfigPath": "machine.yml",
        "profilesFile": "profiles.yml"
      }
    ]
  ]
}
```

OpenCode installs npm plugins automatically at startup and caches them under `~/.cache/opencode/node_modules/`.

For one project, put the same `plugin` entry in that project's `opencode.json`.

This package includes [`opencode.example.json`](./opencode.example.json), which can be copied into global or project OpenCode config and adjusted for the target machine path.

For global use without npm publishing, run the repository setup command:

```sh
cd sdk/js
npm run build
npm run setup:opencode-global-local
```

It writes a global local plugin shim into `~/.config/opencode/plugins/flatmachines.ts`, adds a local file dependency to `~/.config/opencode/package.json`, and registers `flatmachines.ts` in `~/.config/opencode/opencode.json`.

For manual local development, use the same shim:

```ts
// .opencode/plugins/flatmachines.ts
export { FlatMachinesPlugin } from "@memgrafter/opencode-flatmachines"
```

Then add `.opencode/package.json`:

```json
{
  "dependencies": {
    "@memgrafter/opencode-flatmachines": "file:../../sdk/js/packages/opencode-flatmachines"
  }
}
```

## Tools

- `flatmachine_validate`: validates a FlatMachine YAML or JSON config.
- `flatmachine_run`: validates and executes a FlatMachine config with JSON input.
- `flatmachine_signal`: sends a FlatMachines signal through a memory or SQLite backend and optionally notifies a trigger.

Relative config paths resolve from the current OpenCode worktree. By default, the plugin rejects paths outside the worktree.

## Options

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@memgrafter/opencode-flatmachines",
      {
        "defaultConfigPath": "machine.yml",
        "profilesFile": "profiles.yml",
        "allowExternalPaths": false
      }
    ]
  ]
}
```

## Waiting Workflows

Use `flatmachine_signal` with a SQLite backend to wake workflows that use `wait_for` channels. The signal database path must match the `signalDbPath` used by `flatmachine_run`. SQLite signaling uses FlatMachines' `node:sqlite` backend and needs a compatible runtime; plain validation and final-only runs do not need it.

```json
{
  "channel": "approval/task-1",
  "data": { "approved": true },
  "signalBackend": "sqlite",
  "signalDbPath": "flatmachines.sqlite",
  "triggerBackend": "none"
}
```

Then run the waiting machine with:

```json
{
  "configPath": "machine.yml",
  "input": { "task_id": "task-1" },
  "signalBackend": "sqlite",
  "signalDbPath": "flatmachines.sqlite"
}
```

## Verification Gate

Before updating global OpenCode config, run:

```sh
npm run build
npm run typecheck
npm run verify:opencode-plugin
```

`verify:opencode-plugin` installs the packed plugin into a clean consumer project and resolves FlatMachines dependencies from npm, matching OpenCode's package-consumption path without publishing this plugin.
