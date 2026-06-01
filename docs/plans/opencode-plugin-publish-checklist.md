# OpenCode FlatMachines Publish Checklist

## Current Global-Use Status

- Package name: `@memgrafter/opencode-flatmachines`
- OpenCode config artifact: `sdk/js/packages/opencode-flatmachines/opencode.example.json`
- Plugin tools: `flatmachine_validate`, `flatmachine_run`, `flatmachine_signal`
- Registry-compatible dependency: `@memgrafter/flatmachines` `^4.0.1`

## Required Gates Before `npm publish`

Run from `sdk/js`:

```sh
npm run typecheck
npm run build
npx vitest run tests/unit/opencode-plugin.test.ts
npm run verify:opencode-plugin
npm pack --dry-run -w packages/opencode-flatmachines --json
```

Run from `sdk/js/packages/opencode-flatmachines` before a direct package publish:

```sh
npm run prepublishOnly
```

## Publish Sequence

1. Confirm the current plugin feature set only needs APIs present in the published FlatMachines range.
2. Publish `@memgrafter/opencode-flatmachines` with public access.
3. Install into a clean global OpenCode config using the packaged `opencode.example.json`.
4. Start OpenCode from `sdk/examples/opencode_plugin` and run `flatmachine_validate`, `flatmachine_run`, and `flatmachine_signal`.
5. Submit the plugin to the OpenCode ecosystem with the package name, npm URL, docs URL, and a short description.

## Ecosystem Entry Draft

Name: `FlatMachines`

Package: `@memgrafter/opencode-flatmachines`

Description: OpenCode tools for validating, running, and signaling FlatMachines state-machine workflows from any OpenCode project.

Config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@memgrafter/opencode-flatmachines"]
}
```
