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

For unpublished local development, use a local plugin shim:

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

## Release Gate

The plugin package intentionally depends on the latest published FlatMachines major range so a global OpenCode install can resolve dependencies from npm without waiting for every workspace package to be published in the same release.

Publish order for a lockstep release remains:

1. `@memgrafter/flatagents`
2. `@memgrafter/flatmachines`
3. `@memgrafter/opencode-flatmachines`

Before publishing the plugin, run:

```sh
npm run build
npm run typecheck
npm run verify:opencode-plugin
```

`verify:opencode-plugin` installs the packed plugin into a clean consumer project and resolves FlatMachines dependencies from npm, matching the global OpenCode npm-plugin path.
