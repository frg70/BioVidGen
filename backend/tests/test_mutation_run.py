"""The mutation runner itself: a broken runner would report a good score for nothing."""

import importlib.util
import sys
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("mutation_run", Path(__file__).parents[1] / "scripts" / "mutation_run.py")
assert SPEC is not None
assert SPEC.loader is not None
mutation_run = importlib.util.module_from_spec(SPEC)
sys.modules["mutation_run"] = mutation_run
SPEC.loader.exec_module(mutation_run)

SOURCE = '''"""Module docstring stays."""
LIMIT: int = 5


def f(x: int, y: str = "a") -> bool:
    """Function docstring stays."""
    for z in range(3):
        if x > 2 and not y:
            continue
        x += 1
    return x == 3
'''


def behaviour(source: str, x: int, y: str) -> bool:
    scope: dict = {}
    exec(compile(source, "<mutant>", "exec"), scope)  # noqa: S102
    return scope["f"](x, y)


def test_mutants_change_the_code_and_leave_docstrings_and_annotations_alone() -> None:
    """OP5V-MUT-01 each operator yields a valid, different program; docstrings and annotations are never mutated."""
    mutants = list(mutation_run.mutants_of("m.py", SOURCE))
    kinds = " | ".join(m.what for m in mutants)
    for expected in (
        "Gt -> GtE",
        "And swapped",
        "not removed",
        "If condition negated",
        "continue -> break",
        "Add -> Sub",
        "Eq -> NotEq",
        "5 -> 6",
        "3 -> 4",
        "2 -> 3",
    ):
        assert expected in kinds, expected
    assert "docstring" not in kinds
    assert "int" not in kinds
    for m in mutants:
        compile(m.source, "<mutant>", "exec")
        assert m.source != SOURCE
        assert "Module docstring stays." in m.source
        assert m.line > 0


def test_mutants_really_behave_differently() -> None:
    """OP5V-MUT-01 removing `not` and swapping `and` change what the program returns, not only how it reads."""
    by_kind = {m.what: m.source for m in mutation_run.mutants_of("m.py", SOURCE)}
    assert behaviour(SOURCE, 0, "a") is True
    assert behaviour(by_kind["Eq -> NotEq"], 0, "a") is False
    assert behaviour(SOURCE, 3, "a") is False
    assert behaviour(SOURCE, 3, "") is True
    assert behaviour(by_kind["not removed"], 3, "") is False
