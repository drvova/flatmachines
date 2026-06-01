# Global Local OpenCode Setup

Use this path when the plugin should be available globally in OpenCode without publishing to npm.

From `sdk/js`:

```sh
npm run build
npm run setup:opencode-global-local
```

The setup command writes:

- `~/.config/opencode/plugins/flatmachines.ts`
- `~/.config/opencode/package.json` dependency on the local plugin package
- `~/.config/opencode/opencode.json` plugin entry `flatmachines.ts`

To test without touching the real global config:

```sh
OPENCODE_CONFIG_DIR=/tmp/opencode-flatmachines npm run setup:opencode-global-local
```

Then start OpenCode normally. The plugin exposes `flatmachine_validate`, `flatmachine_run`, and `flatmachine_signal` globally.
