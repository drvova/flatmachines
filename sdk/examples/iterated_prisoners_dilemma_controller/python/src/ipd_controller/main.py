from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from flatmachines import FlatMachine, HooksRegistry, get_logger, setup_logging

from .hooks import IPDControllerHooks

setup_logging(level="INFO")
logger = get_logger(__name__)


def _config_path(name: str) -> Path:
    return Path(__file__).parent.parent.parent.parent / "config" / name


def _print_summary(result: dict) -> None:
    history = result.get("history") or []
    print("\n=== Iterated Prisoner's Dilemma (10 rounds) ===")
    print("Rnd | A | B | +A | +B | TotA | TotB")
    print("----+---+---+----+----+------+------")
    for r in history:
        print(
            f"{r.get('round', 0):>3} | {r.get('move_a', '?'):>1} | {r.get('move_b', '?'):>1} | "
            f"{r.get('score_a', 0):>2} | {r.get('score_b', 0):>2} | "
            f"{r.get('total_a', 0):>4} | {r.get('total_b', 0):>4}"
        )

    totals = result.get("totals") or {}
    coop = result.get("cooperation_rate") or {}
    defect = result.get("defection_rate") or {}

    print("\nTotals:")
    print(f"  A: {totals.get('A', 0)}")
    print(f"  B: {totals.get('B', 0)}")
    print("Rates:")
    print(f"  A cooperate={coop.get('A', 0)} defect={defect.get('A', 0)}")
    print(f"  B cooperate={coop.get('B', 0)} defect={defect.get('B', 0)}")


async def run(rounds: int = 10) -> dict:
    registry = HooksRegistry()
    registry.register("ipd-hooks", IPDControllerHooks)

    machine = FlatMachine(
        config_file=str(_config_path("match_machine.yml")),
        hooks_registry=registry,
    )

    logger.info("Running IPD match with rounds=%s", rounds)
    result = await machine.execute(input={"rounds_total": rounds})

    _print_summary(result)
    logger.info("API calls=%s cost=$%.4f", machine.total_api_calls, machine.total_cost)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Iterated Prisoner's Dilemma controller demo")
    parser.add_argument("--rounds", type=int, default=10, help="Number of rounds (default: 10)")
    args = parser.parse_args()

    asyncio.run(run(rounds=args.rounds))


if __name__ == "__main__":
    main()
