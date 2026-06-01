# OpenCode FlatMachines Plugin Architecture

## Evidence from OpenCode

- OpenCode loads project plugins from `.opencode/plugins/` and global plugins from `~/.config/opencode/plugins/`.
- OpenCode loads npm plugins declared in `opencode.json` and installs them with Bun into `~/.cache/opencode/node_modules/`.
- A plugin is a JavaScript or TypeScript module that returns hooks. Hooks can expose custom tools through the `tool` map.
- The OpenCode SDK is a type-safe JavaScript client for the OpenCode server, and `opencode serve` exposes the same server over HTTP on port `4096` by default.

Sources: https://opencode.ai/docs/plugins/, https://opencode.ai/docs/sdk/, https://opencode.ai/docs/server/, https://opencode.ai/docs/ecosystem/

## Package Boundary

Create `@memgrafter/opencode-flatmachines` as a separate JS workspace package. The plugin depends on `@memgrafter/flatmachines` instead of copying orchestration logic, keeping FlatMachine execution as the single source of truth.

The package exports a v1 OpenCode plugin module:

```ts
export default {
  id: "@memgrafter/opencode-flatmachines",
  server,
}
```

This matches OpenCode's current plugin loader while also exporting `FlatMachinesPlugin` and `server` for direct tests and legacy loading.

## Tool Surface

Initial global-use tools:

- `flatmachine_validate`: parse YAML or JSON and run `validateFlatMachineConfig`.
- `flatmachine_run`: validate, instantiate `FlatMachine`, execute with JSON input, and return structured JSON output.

Default behavior resolves relative paths from the OpenCode worktree and rejects paths outside that worktree. Users can opt into external paths with plugin options.

## Configuration

Global OpenCode example:

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

## Non-Goals for the First Slice

- Do not reimplement FlatMachine orchestration inside the plugin.
- Do not start or manage a separate OpenCode server from the plugin.
- Do not add a background worker manager until the basic validation and execution tools are verified.
