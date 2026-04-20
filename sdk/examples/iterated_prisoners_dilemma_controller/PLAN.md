# Iterated Prisoner’s Dilemma (Agent-as-Machine-Controller) — Concise Plan

## Goal
Build a new example where **two instantiated player machines** repeatedly play IPD. Each player uses the **same `agent.yml`** and chooses the next action state.

## Core Design
- One shared player machine config (instantiated twice: `player_a`, `player_b`).
- Same agent prompt file for both players.
- Role swap in message construction:
  - own prior moves/context represented as assistant perspective
  - opponent prior moves represented as user perspective

## Player Machine (minimum 3 states)
1. `llm_decision` (agent)
   - Input: rules + round index + full history
   - Output: raw choice text (`"cooperate" | "defect"`)
2. `cooperate` (programmatic action state)
   - Sets canonical move `C` and rationale fields
3. `defect` (programmatic action state)
   - Sets canonical move `D` and rationale fields

## Include the recommended pattern (action-driven routing)
Use a small router action between decision and move states:
- `route_decision` action writes `context.next_state` from the agent output.
- Transitions use:
  - `condition: "context.next_state == 'cooperate'" -> cooperate`
  - `condition: "context.next_state == 'defect'" -> defect`

This follows the stable pattern: **action mutates `context`, transitions read `context`**.

## Match / Tournament Machine
- Runs fixed rounds (e.g., 50–200).
- Each round:
  - invoke `player_a` + `player_b`
  - compute payoff matrix
  - append transcript/history for next round
- Final output:
  - move history
  - per-round payoffs
  - totals, cooperation rate, defection rate
  - simple diagnostics (e.g., did either converge to Tit-for-Tat-like behavior)

## Deliverables (next implementation pass)
- `config/agent.yml` (shared)
- `config/player_machine.yml`
- `config/match_machine.yml`
- `python/src/.../hooks.py` for programmatic actions and scoring
- `README.md` with run command and expected outputs
