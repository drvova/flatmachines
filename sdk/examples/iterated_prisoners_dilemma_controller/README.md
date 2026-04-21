# Iterated Prisoner's Dilemma (Agent as Machine Controller)

Two identical LLM-driven player machines play a deterministic **10-round Iterated Prisoner's Dilemma**.

- Shared `config/agent.yml` for both players
- Each player machine routes through:
  - `llm_decision` (agent)
  - `cooperate` (final output state)
  - `defect` (final output state)
- Player routing is now YAML-native: the agent must emit the exact token `cooperate` or `defect`, and transitions branch directly on that value.
- Per-round decisions are executed in parallel via per-machine entries:
  `machine: [{name: player_a, input: ...}, {name: player_b, input: ...}]`
  so both players act from the same prior-round information set.
- Player-machine behavior is encoded directly in `config/player_machine.yml`.
- Match setup is also YAML-native via initial context values.
- The only remaining hook-backed match semantic is round scoring/accumulation via `ipd-match-hooks` on `score_round`.

## Model setup
This example uses the OpenAI Codex OAuth profile setup from:
`~/code/skills-flatagents/codebase-ripper/profiles.yml`

See: `config/profiles.yml`.

## Run (Python)
```bash
cd python
./run.sh --local
```

Debug mode (shows per-agent input/output messages):
```bash
./run.sh --debug
```

or
```bash
cd python
uv venv .venv
uv pip install --python .venv/bin/python -e .
.venv/bin/python -m ipd_controller.main --rounds 10
```
