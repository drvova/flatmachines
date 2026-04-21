from __future__ import annotations

from typing import Any, Dict, Tuple

from flatmachines import MachineHooks


class IPDMatchHooks(MachineHooks):
    """Hooks for match-level scoring actions."""

    def on_action(self, state_name: str, action_name: str, context: Dict[str, Any]) -> Dict[str, Any]:
        if action_name == "score_round":
            return self._score_round(context)
        return context

    def _score_round(self, context: Dict[str, Any]) -> Dict[str, Any]:
        round_idx = self._to_int(context.get("round"), default=1)
        rounds_total = self._to_int(context.get("rounds_total"), default=10)

        move_a = self._canonical_move(context.get("move_a"))
        move_b = self._canonical_move(context.get("move_b"))

        score_a, score_b = self._payoff(move_a, move_b)

        moves_a = list(context.get("moves_a") or [])
        moves_b = list(context.get("moves_b") or [])
        moves_a.append(move_a)
        moves_b.append(move_b)
        context["moves_a"] = moves_a
        context["moves_b"] = moves_b

        totals = dict(context.get("totals") or {"A": 0, "B": 0})
        totals["A"] = self._to_int(totals.get("A"), default=0) + score_a
        totals["B"] = self._to_int(totals.get("B"), default=0) + score_b
        context["totals"] = totals

        cooperation_count = dict(context.get("cooperation_count") or {"A": 0, "B": 0})
        defection_count = dict(context.get("defection_count") or {"A": 0, "B": 0})

        if move_a == "C":
            cooperation_count["A"] = self._to_int(cooperation_count.get("A"), 0) + 1
        else:
            defection_count["A"] = self._to_int(defection_count.get("A"), 0) + 1

        if move_b == "C":
            cooperation_count["B"] = self._to_int(cooperation_count.get("B"), 0) + 1
        else:
            defection_count["B"] = self._to_int(defection_count.get("B"), 0) + 1

        context["cooperation_count"] = cooperation_count
        context["defection_count"] = defection_count

        history = list(context.get("history") or [])
        entry = {
            "round": round_idx,
            "move_a": move_a,
            "move_b": move_b,
            "score_a": score_a,
            "score_b": score_b,
            "total_a": totals["A"],
            "total_b": totals["B"],
            "decision_raw_a": context.get("decision_raw_a"),
            "decision_raw_b": context.get("decision_raw_b"),
        }
        history.append(entry)
        context["history"] = history
        context["last_round"] = entry
        context["last_move_a"] = move_a
        context["last_move_b"] = move_b

        rounds_played = max(1, len(history))
        context["cooperation_rate"] = {
            "A": round(cooperation_count["A"] / rounds_played, 3),
            "B": round(cooperation_count["B"] / rounds_played, 3),
        }
        context["defection_rate"] = {
            "A": round(defection_count["A"] / rounds_played, 3),
            "B": round(defection_count["B"] / rounds_played, 3),
        }

        done = round_idx >= rounds_total
        context["done"] = done
        if not done:
            context["round"] = round_idx + 1

        return context

    @staticmethod
    def _to_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _canonical_move(value: Any) -> str:
        raw = str(value or "").strip().upper()
        if raw.startswith("D") or "DEFECT" in raw:
            return "D"
        return "C"

    @staticmethod
    def _payoff(move_a: str, move_b: str) -> Tuple[int, int]:
        # T=5, R=3, P=1, S=0
        if move_a == "C" and move_b == "C":
            return 3, 3
        if move_a == "D" and move_b == "C":
            return 5, 0
        if move_a == "C" and move_b == "D":
            return 0, 5
        return 1, 1
