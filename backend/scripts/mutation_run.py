"""Mutation testing for OP5V (OP5V-MUT-01). `uv run python scripts/mutation_run.py`

Standard library only. mutmut does not run on native Windows, which the team uses, and cosmic-ray pulls in an
LGPL package that the licence gate refuses (delta D34). Every mutant runs on a temporary copy, so an interrupted
run cannot leave a mutant in the source.
"""

import argparse
import ast
import copy
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from queue import Queue

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
TARGETS = ("normaliser.py", "evidence.py", "validate.py")
SUMMARY = Path("src/biovidgen/summary")
TESTS = ("tests/test_op5v_vectors.py", "tests/test_op5v_store.py", "tests/test_op5v_properties.py")
# The version guard would kill every normaliser mutant for the wrong reason, and timing proves nothing here.
DESELECT = "not version_guard and not performance"
TIMEOUT_S = 300

_COMPARE = {
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.Lt: ast.LtE,
    ast.LtE: ast.Lt,
    ast.Gt: ast.GtE,
    ast.GtE: ast.Gt,
    ast.In: ast.NotIn,
    ast.NotIn: ast.In,
    ast.Is: ast.IsNot,
    ast.IsNot: ast.Is,
}
_BINARY = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.FloorDiv, ast.FloorDiv: ast.Mult}


@dataclass(frozen=True)
class Mutant:
    file: str
    line: int
    what: str
    source: str


def _children(node: ast.AST) -> Iterator[ast.AST]:
    """Child nodes, leaving out what never runs as logic: annotations, decorators and docstrings."""
    for field, value in ast.iter_fields(node):
        if field in ("annotation", "returns", "decorator_list"):
            continue
        items = value if isinstance(value, list) else [value]
        for index, item in enumerate(items):
            if not isinstance(item, ast.AST):
                continue
            is_docstring = (
                field == "body"
                and index == 0
                and isinstance(item, ast.Expr)
                and isinstance(item.value, ast.Constant)
                and isinstance(item.value.value, str)
            )
            if not is_docstring:
                yield item


def _walk(tree: ast.AST) -> Iterator[ast.AST]:
    yield tree
    for child in _children(tree):
        yield from _walk(child)


def _mutations(node: ast.AST) -> Iterator[tuple[str, object]]:
    """(description, argument) pairs for `_apply`. Each pair is one mutant of this node."""
    if isinstance(node, ast.Compare):
        for i, op in enumerate(node.ops):
            if type(op) in _COMPARE:
                yield f"{type(op).__name__} -> {_COMPARE[type(op)].__name__}", i
    elif isinstance(node, ast.BoolOp):
        yield f"{type(node.op).__name__} swapped", None
    elif isinstance(node, ast.BinOp | ast.AugAssign) and type(node.op) in _BINARY:
        yield f"{type(node.op).__name__} -> {_BINARY[type(node.op)].__name__}", None
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        yield "not removed", None
    elif isinstance(node, ast.If | ast.While | ast.IfExp):
        yield f"{type(node).__name__} condition negated", None
    elif isinstance(node, ast.Continue):
        yield "continue -> break", None
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            yield f"{node.value} flipped", None
        elif isinstance(node.value, int):
            yield f"{node.value} -> {node.value + 1}", None
        elif isinstance(node.value, str) and node.value:
            yield f"string {node.value[:20]!r} changed", None


def _apply(node: ast.AST, argument: object) -> None:
    if isinstance(node, ast.Compare):
        node.ops[argument] = _COMPARE[type(node.ops[argument])]()
    elif isinstance(node, ast.BoolOp):
        node.op = ast.Or() if isinstance(node.op, ast.And) else ast.And()
    elif isinstance(node, ast.BinOp | ast.AugAssign):
        node.op = _BINARY[type(node.op)]()
    elif isinstance(node, ast.UnaryOp):
        node.op = ast.UAdd()  # replaced below by removing the node's negation
    elif isinstance(node, ast.If | ast.While | ast.IfExp):
        node.test = ast.UnaryOp(ast.Not(), node.test)
    elif isinstance(node, ast.Constant):
        value = node.value
        node.value = not value if isinstance(value, bool) else value + 1 if isinstance(value, int) else value + "X"


class _DropNot(ast.NodeTransformer):
    def visit_UnaryOp(self, node: ast.UnaryOp) -> ast.AST:
        return node.operand if isinstance(node.op, ast.UAdd) else self.generic_visit(node)


def mutants_of(file: str, source: str) -> Iterator[Mutant]:
    tree = ast.parse(source)
    for index, node in enumerate(_walk(tree)):
        for what, argument in _mutations(node):
            clone = copy.deepcopy(tree)
            target = next(n for i, n in enumerate(_walk(clone)) if i == index)
            if isinstance(target, ast.Continue):
                _replace(clone, target, ast.Break())
            else:
                _apply(target, argument)
            line = getattr(node, "lineno", 0)
            yield Mutant(file, line, what, ast.unparse(_DropNot().visit(clone)))


def _replace(tree: ast.AST, old: ast.AST, new: ast.AST) -> None:
    for parent in ast.walk(tree):
        for _field, value in ast.iter_fields(parent):
            if isinstance(value, list) and old in value:
                value[value.index(old)] = new
                return


def _workspace(root: Path) -> Path:
    """A copy laid out like the repo: the tests find the shared vectors relative to themselves."""
    backend = root / "backend"
    shutil.copytree(BACKEND / "src", backend / "src", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(BACKEND / "tests", backend / "tests", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(BACKEND / "pyproject.toml", backend)
    shutil.copytree(REPO / "extension/fixtures/op5v", root / "extension/fixtures/op5v")
    return backend


def _pytest(backend: Path) -> int:
    env = {
        **os.environ,
        "PYTHONPATH": str(backend / "src"),
        "HYPOTHESIS_STORAGE_DIRECTORY": str(backend / ".hypothesis"),
    }
    command = [
        sys.executable,
        "-m",
        "pytest",
        "-x",
        "-q",
        "--no-header",
        "-p",
        "no:cacheprovider",
        *TESTS,
        "-k",
        DESELECT,
    ]
    try:
        done = subprocess.run(command, cwd=backend, env=env, capture_output=True, timeout=TIMEOUT_S, check=False)  # noqa: S603
        return done.returncode
    except subprocess.TimeoutExpired:
        return -1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--target", type=float, default=90.0)
    args = parser.parse_args()

    mutants = [m for name in TARGETS for m in mutants_of(name, (BACKEND / SUMMARY / name).read_text("utf-8"))]
    print(f"{len(mutants)} mutants, {args.workers} workers", flush=True)
    with tempfile.TemporaryDirectory(prefix="bvg-mut-") as tmp:
        spaces: Queue[Path] = Queue()
        for i in range(args.workers):
            spaces.put(_workspace(Path(tmp) / str(i)))
        baseline = spaces.get()
        if _pytest(baseline) != 0:
            print("baseline tests fail on the unmodified copy: fix those first")
            return 2
        spaces.put(baseline)

        def run(mutant: Mutant) -> tuple[Mutant, int]:
            backend = spaces.get()
            path = backend / SUMMARY / mutant.file
            original = path.read_text("utf-8")
            try:
                path.write_text(mutant.source, "utf-8")
                return mutant, _pytest(backend)
            finally:
                path.write_text(original, "utf-8")
                spaces.put(backend)

        with ThreadPoolExecutor(args.workers) as pool:
            results = list(pool.map(run, mutants))

    survivors = [m for m, code in results if code == 0]
    score = 100 * (len(results) - len(survivors)) / len(results)
    per_file = {name: [c for m, c in results if m.file == name] for name in TARGETS}
    for name, codes in per_file.items():
        print(f"{name}: {sum(c != 0 for c in codes)}/{len(codes)} killed")
    for m, code in results:
        if code == -1:  # counted as killed: a hang is a failure, but one caused by load would be a false kill
            print(f"TIMEOUT {m.file}:{m.line} {m.what}")
    for m in survivors:
        print(f"SURVIVED {m.file}:{m.line} {m.what}")
    print(f"mutation score {score:.1f}% (target {args.target}%)")
    return 0 if score >= args.target else 1


if __name__ == "__main__":
    raise SystemExit(main())
