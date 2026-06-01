# OpenCode FlatMachines Plugin Rollout Plan

## Slice 1: Publishable Plugin Scaffold

- Add `@memgrafter/opencode-flatmachines` to the JS workspace.
- Export an OpenCode server plugin with `flatmachine_validate` and `flatmachine_run`.
- Add path safety so global usage cannot accidentally read outside the active worktree.
- Verify with TypeScript, package build, and focused unit tests.

## Slice 2: Local and Global Installation Docs

- Document npm config usage for `opencode.json`.
- Document local plugin usage through `.opencode/plugins/` and global usage through `~/.config/opencode/plugins/`.
- Include a minimal runnable FlatMachine example that finishes without provider credentials.
- Verify package loading from a clean consumer install so unpublished workspace packages do not hide npm install defects.

## Slice 3: Runtime Operations

- Add tools for durable signaling and dispatcher wakeups once the basic execution path is stable.
- Map `wait_for` outputs into OpenCode tool metadata so waiting machines are obvious in the TUI.
- Add examples for SQLite persistence and file triggers.

## Slice 4: Global Local Install

- Prepare a global local setup command for `~/.config/opencode`.
- Preserve existing OpenCode plugin config while adding `flatmachines.ts`.
- Verify the setup command against an isolated `OPENCODE_CONFIG_DIR`.

## Slice 5: Post-Install Hardening

- Add dispatcher/resume tools after OpenCode global install is verified.
- Add a compatibility matrix for OpenCode, Node, FlatMachines, and SQLite signaling.
- Add live OpenCode CLI verification when a local `opencode` binary is available.
