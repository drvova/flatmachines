# OpenCode FlatMachines Plugin Example

This example is credential-free. It validates and runs a final-only FlatMachine so plugin loading can be tested without an LLM provider.

## Global npm config

After the package is published, add this to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@memgrafter/opencode-flatmachines",
      {
        "defaultConfigPath": "machine.yml"
      }
    ]
  ]
}
```

Start OpenCode from this directory and ask it to run `flatmachine_validate`, then `flatmachine_run`.

The plugin also exposes `flatmachine_signal` for `wait_for` workflows. Use the same SQLite `signalDbPath` for `flatmachine_signal` and `flatmachine_run` so a waiting machine can consume the signal.

## Local workspace config

For local development before npm publishing, this example uses `.opencode/plugins/flatmachines.ts` as a shim and `.opencode/package.json` to point at the workspace package.

OpenCode loads project plugins from `.opencode/plugins/` and installs local plugin dependencies from `.opencode/package.json`.
