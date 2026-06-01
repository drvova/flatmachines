# @memgrafter/opencode-flatmachines

OpenCode plugin for running FlatMachine workflows from any OpenCode project.

## Install

Add the npm plugin to global OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@memgrafter/opencode-flatmachines"]
}
```

OpenCode installs npm plugins automatically at startup.

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
