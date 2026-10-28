"""Prompt matrix engine: combinatorial prompt templates.

Syntax
------
``{a|b|c}``            alternatives (cartesian product with the rest)
``{red {cat|dog}|x}``  nesting
``{|detailed}``        empty option = optional fragment
``{2::a|1::b}``        option weights (used in random mode)
``{1-5}`` ``{5-9:2}``  numeric ranges (optional step, floats allowed)
``{2$$a|b|c}``         choose 2 of the options (``{1-2$$...}`` range,
                       ``{2$$ and $$a|b|c}`` custom separator)
``{@color:red|blue}``  named axis; ``{@color}`` re-uses the same choice
``__name__``           wildcard (list of lines, may contain syntax itself)
``\\{ \\} \\|``          escape special characters
"""
from __future__ import annotations

import itertools
import random
import re
from dataclasses import dataclass, field
from typing import Any, Iterator, Mapping

MAX_DEPTH = 32


class MatrixError(ValueError):
    pass


@dataclass
class Text:
    value: str


@dataclass
class Choice:
    options: list[list]
    name: str | None = None
    label: str | None = None
    weights: list[float] | None = None


@dataclass
class Ref:
    name: str


@dataclass
class Wildcard:
    name: str


@dataclass
class Combo:
    options: list[list]
    nmin: int
    nmax: int
    sep: str = ", "
    label: str | None = None


RE_RANGE = re.compile(r"\s*([+-]?\d+(?:\.\d+)?)\s*-\s*([+-]?\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?\s*\}")
RE_NAME = re.compile(r"@([A-Za-z_][\w\-]*)\s*(:|\})")
RE_COMBO = re.compile(r"(\d+)(?:-(\d+))?\$\$(?:(.*?)\$\$)?", re.S)
RE_WILDCARD = re.compile(r"__([A-Za-z0-9][\w\-/.]*?)__")
RE_WEIGHT = re.compile(r"^\s*(\d+(?:\.\d+)?)::")


def _fmt_num(x: float, decimals: int) -> str:
    return str(int(round(x))) if decimals == 0 else f"{x:.{decimals}f}"


def _range_options(a: str, b: str, step: str | None) -> list[list]:
    decimals = max(len(s.split(".")[1]) if "." in s else 0 for s in (a, b, step or "1"))
    lo, hi, st = float(a), float(b), float(step or 1)
    if st <= 0:
        raise MatrixError("Aralık adımı pozitif olmalı")
    if hi < lo:
        st = -st
    n = int(abs(hi - lo) / abs(st) + 1e-9) + 1
    if n > 100_000:
        raise MatrixError("Aralık çok büyük")
    return [[Text(_fmt_num(lo + i * st, decimals))] for i in range(n)]


class _Parser:
    def __init__(self, src: str, label_prefix: str = ""):
        self.s = src
        self.i = 0
        self.prefix = label_prefix
        self.counter = 0

    def _label(self) -> str | None:
        if not self.prefix:
            return None
        self.counter += 1
        return f"{self.prefix}{self.counter}"

    def parse(self) -> list:
        nodes = self.seq(inside=False)
        if self.i < len(self.s):
            raise MatrixError(f"Beklenmeyen '{self.s[self.i]}' (konum {self.i})")
        return nodes

    def seq(self, inside: bool) -> list:
        s, nodes, buf = self.s, [], []

        def flush():
            if buf:
                nodes.append(Text("".join(buf)))
                buf.clear()

        while self.i < len(s):
            c = s[self.i]
            if c == "\\" and self.i + 1 < len(s):
                buf.append(s[self.i + 1])
                self.i += 2
                continue
            if c == "{":
                flush()
                nodes.append(self.group())
                continue
            if c in "|}":
                if inside:
                    break
                if c == "}":
                    raise MatrixError(f"Eşleşmeyen '}}' (konum {self.i})")
            if c == "_" and s.startswith("__", self.i):
                m = RE_WILDCARD.match(s, self.i)
                if m:
                    flush()
                    nodes.append(Wildcard(m.group(1)))
                    self.i = m.end()
                    continue
            buf.append(c)
            self.i += 1
        flush()
        return nodes

    def group(self):
        start = self.i
        self.i += 1  # skip '{'
        s = self.s
        name = None
        m = RE_NAME.match(s, self.i)
        if m:
            self.i = m.end()
            if m.group(2) == "}":
                return Ref(m.group(1))
            name = m.group(1)
        m = RE_RANGE.match(s, self.i)
        if m:
            self.i = m.end()
            return Choice(_range_options(*m.groups()), name, None if name else self._label())
        combo = None
        m = RE_COMBO.match(s, self.i)
        if m and not name:
            nmin = int(m.group(1))
            nmax = int(m.group(2)) if m.group(2) else nmin
            combo = (min(nmin, nmax), max(nmin, nmax), m.group(3) if m.group(3) is not None else ", ")
            self.i = m.end()
        options, weights = [], []
        while True:
            opt = self.seq(inside=True)
            w = 1.0
            if opt and isinstance(opt[0], Text):
                wm = RE_WEIGHT.match(opt[0].value)
                if wm:
                    w = float(wm.group(1))
                    rest = opt[0].value[wm.end():]
                    opt = ([Text(rest)] if rest else []) + opt[1:]
            options.append(opt)
            weights.append(w)
            if self.i >= len(s):
                raise MatrixError(f"Kapanmamış '{{' (konum {start})")
            ch = s[self.i]
            self.i += 1
            if ch == "}":
                break
        if combo:
            return Combo(options, combo[0], min(combo[1], len(options)), combo[2], self._label())
        return Choice(options, name, None if name else self._label(),
                      weights if any(w != 1.0 for w in weights) else None)


def parse_template(template: str, label_prefix: str = "") -> list:
    return _Parser(template or "", label_prefix).parse()


def _walk(nodes: list) -> Iterator:
    for n in nodes:
        yield n
        if isinstance(n, (Choice, Combo)):
            for opt in n.options:
                yield from _walk(opt)


def _cleanup(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*,(\s*,)+", ",", text)
    text = re.sub(r"\(\s*:[\d.]+\)|\(\s*\)", "", text)
    text = re.sub(r"\s+,", ",", text)
    return text.strip().strip(",").strip()


def _coerce(v: str) -> Any:
    s = v.strip()
    if re.fullmatch(r"[+-]?\d+", s):
        return int(s)
    if re.fullmatch(r"[+-]?(\d+\.\d*|\.\d+)", s):
        return float(s)
    if s.lower() in ("true", "false"):
        return s.lower() == "true"
    return s


@dataclass
class MatrixSpec:
    prompt: str = ""
    negative: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    mode: str = "product"          # "product" | "random"
    count: int | None = None       # rows to draw in random mode
    seed: int | None = None
    limit: int = 10_000
    cleanup: bool = True

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "MatrixSpec":
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d and d[k] is not None}
        return cls(**known)

    def to_dict(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


class Matrix:
    """Expands a :class:`MatrixSpec` into concrete generation rows."""

    def __init__(self, spec: MatrixSpec | Mapping[str, Any] | str,
                 wildcards: Mapping[str, list[str]] | None = None):
        if isinstance(spec, str):
            spec = MatrixSpec(prompt=spec)
        elif not isinstance(spec, MatrixSpec):
            spec = MatrixSpec.from_dict(spec)
        self.spec = spec
        self.wildcards = {k.lower(): v for k, v in (wildcards or {}).items()}
        self._wild_cache: dict[str, Choice] = {}
        self.fields: list[tuple[str, list]] = [
            ("prompt", parse_template(spec.prompt, "p")),
            ("negative", parse_template(spec.negative, "n")),
        ]
        for key, value in (spec.params or {}).items():
            if isinstance(value, (list, tuple)):
                vals = [str(v) for v in value if str(v).strip() != ""]
                nodes = [Choice([[Text(v)] for v in vals], label=key)] if len(vals) > 1 else \
                    [Text(vals[0] if vals else "")]
            else:
                nodes = parse_template(str(value), key)
                if len(nodes) == 1 and isinstance(nodes[0], Choice) and not nodes[0].name:
                    nodes[0].label = key
            self.fields.append((f"param:{key}", nodes))
        self.defs: dict[str, Choice] = {}
        for _, nodes in self.fields:
            for n in _walk(nodes):
                if isinstance(n, Choice) and n.name and n.name not in self.defs:
                    self.defs[n.name] = n
        for _, nodes in self.fields:  # validate references and wildcards early
            self._validate(nodes, 0)

    # ----------------------------------------------------------- wildcards
    def _wild(self, name: str, depth: int) -> Choice:
        if depth > MAX_DEPTH:
            raise MatrixError(f"Wildcard döngüsü: __{name}__")
        key = name.lower()
        if key not in self._wild_cache:
            if key not in self.wildcards:
                raise MatrixError(f"Wildcard bulunamadı: __{name}__")
            lines = [l.strip() for l in self.wildcards[key]
                     if l.strip() and not l.lstrip().startswith("#")]
            if not lines:
                raise MatrixError(f"Wildcard boş: __{name}__")
            self._wild_cache[key] = Choice([parse_template(l) for l in lines], label=name)
        return self._wild_cache[key]

    def _validate(self, nodes: list, depth: int) -> None:
        for n in _walk(nodes):
            if isinstance(n, Ref) and n.name not in self.defs:
                raise MatrixError(f"Tanımsız eksen: {{@{n.name}}}")
            if isinstance(n, Wildcard):
                self._validate([self._wild(n.name, depth + 1)], depth + 1)

    # ------------------------------------------------------------ counting
    def count(self) -> int:
        seen: set[str] = set()
        total = 1
        for _, nodes in self.fields:
            total *= self._count_seq(nodes, seen, 0)
        return total

    def _count_seq(self, nodes: list, seen: set, depth: int) -> int:
        total = 1
        for n in nodes:
            total *= self._count_node(n, seen, depth)
            if total == 0:
                return 0
        return total

    def _count_node(self, n, seen: set, depth: int) -> int:
        if isinstance(n, Text):
            return 1
        if isinstance(n, Ref):
            if n.name in seen:
                return 1
            return self._count_node(self.defs[n.name], seen, depth)
        if isinstance(n, Wildcard):
            return self._count_node(self._wild(n.name, depth + 1), seen, depth + 1)
        if isinstance(n, Choice):
            if n.name:
                if n.name in seen:
                    return 1
                seen.add(n.name)
            return sum(self._count_seq(o, seen, depth) for o in n.options)
        if isinstance(n, Combo):
            counts = [self._count_seq(o, seen, depth) for o in n.options]
            e = [1] + [0] * len(counts)  # elementary symmetric polynomials
            for c in counts:
                for k in range(len(counts), 0, -1):
                    e[k] += e[k - 1] * c
            return sum(e[k] for k in range(n.nmin, n.nmax + 1))
        return 1

    # ----------------------------------------------------------- expansion
    def _bind(self, n, text: str, env: dict) -> dict:
        if getattr(n, "name", None):
            return {**env, n.name: text}
        if getattr(n, "label", None):
            return {**env, "~" + n.label: text}
        return env

    def _exp_seq(self, nodes: list, idx: int, env: dict, depth: int) -> Iterator[tuple[str, dict]]:
        if idx == len(nodes):
            yield "", env
            return
        for head, env1 in self._exp_node(nodes[idx], env, depth):
            for tail, env2 in self._exp_seq(nodes, idx + 1, env1, depth):
                yield head + tail, env2

    def _exp_node(self, n, env: dict, depth: int) -> Iterator[tuple[str, dict]]:
        if isinstance(n, Text):
            yield n.value, env
        elif isinstance(n, Ref):
            if n.name in env:
                yield env[n.name], env
            else:
                yield from self._exp_node(self.defs[n.name], env, depth)
        elif isinstance(n, Wildcard):
            yield from self._exp_node(self._wild(n.name, depth + 1), env, depth + 1)
        elif isinstance(n, Choice):
            if n.name and n.name in env:
                yield env[n.name], env
                return
            for opt in n.options:
                for text, e in self._exp_seq(opt, 0, env, depth):
                    yield text, self._bind(n, text, e)
        elif isinstance(n, Combo):
            for k in range(n.nmin, n.nmax + 1):
                for idxs in itertools.combinations(range(len(n.options)), k):
                    nodes: list = []
                    for j, i in enumerate(idxs):
                        if j:
                            nodes.append(Text(n.sep))
                        nodes.extend(n.options[i])
                    for text, e in self._exp_seq(nodes, 0, env, depth):
                        yield text, self._bind(n, text, e)

    def _exp_fields(self, fi: int, env: dict) -> Iterator[tuple[list[str], dict]]:
        if fi == len(self.fields):
            yield [], env
            return
        for text, env1 in self._exp_seq(self.fields[fi][1], 0, env, 0):
            for rest, env2 in self._exp_fields(fi + 1, env1):
                yield [text] + rest, env2

    # -------------------------------------------------------------- random
    def _rnd_seq(self, nodes: list, env: dict, rng: random.Random, depth: int) -> tuple[str, dict]:
        out = []
        for n in nodes:
            t, env = self._rnd_node(n, env, rng, depth)
            out.append(t)
        return "".join(out), env

    def _rnd_node(self, n, env: dict, rng: random.Random, depth: int) -> tuple[str, dict]:
        if isinstance(n, Text):
            return n.value, env
        if isinstance(n, Ref):
            if n.name in env:
                return env[n.name], env
            return self._rnd_node(self.defs[n.name], env, rng, depth)
        if isinstance(n, Wildcard):
            return self._rnd_node(self._wild(n.name, depth + 1), env, rng, depth + 1)
        if isinstance(n, Choice):
            if n.name and n.name in env:
                return env[n.name], env
            opt = rng.choices(n.options, weights=n.weights)[0] if n.weights else rng.choice(n.options)
            t, env = self._rnd_seq(opt, env, rng, depth)
            return t, self._bind(n, t, env)
        if isinstance(n, Combo):
            k = rng.randint(n.nmin, n.nmax)
            idxs = sorted(rng.sample(range(len(n.options)), k))
            parts = []
            for i in idxs:
                t, env = self._rnd_seq(n.options[i], env, rng, depth)
                parts.append(t)
            t = n.sep.join(parts)
            return t, self._bind(n, t, env)
        return "", env

    # ---------------------------------------------------------------- rows
    def _row(self, index: int, texts: list[str], env: dict) -> dict[str, Any]:
        clean = _cleanup if self.spec.cleanup else (lambda x: x)
        row: dict[str, Any] = {"index": index, "prompt": clean(texts[0]), "negative": clean(texts[1]),
                               "params": {}, "axes": {}}
        for (name, _), text in zip(self.fields[2:], texts[2:]):
            if text.strip() != "":
                row["params"][name.split(":", 1)[1]] = _coerce(text)
        for k, v in env.items():
            row["axes"][k.lstrip("~")] = _cleanup(v) if self.spec.cleanup else v
        return row

    def rows(self, limit: int | None = None) -> Iterator[dict[str, Any]]:
        limit = limit if limit is not None else self.spec.limit
        if self.spec.mode == "random":
            yield from self._random_rows(limit)
            return
        for i, (texts, env) in enumerate(self._exp_fields(0, {})):
            if limit and i >= limit:
                return
            yield self._row(i, texts, env)

    def _random_rows(self, limit: int | None) -> Iterator[dict[str, Any]]:
        rng = random.Random(self.spec.seed)
        want = self.spec.count or 10
        if limit:
            want = min(want, limit)
        total = self.count()
        weighted = any(isinstance(n, Choice) and n.weights
                       for _, nodes in self.fields for n in _walk(nodes))
        weighted = weighted or any(c.weights for c in self._wild_cache.values())
        if not weighted and total <= max(want * 4, 2000):  # small space: exact sample, no duplicates
            all_rows = list(self._exp_fields(0, {}))
            picks = rng.sample(all_rows, min(want, total))
            for i, (texts, env) in enumerate(picks):
                yield self._row(i, texts, env)
            return
        seen: set[tuple] = set()
        attempts = 0
        i = 0
        while i < want and attempts < want * 50:
            attempts += 1
            env: dict = {}
            texts = []
            for _, nodes in self.fields:
                t, env = self._rnd_seq(nodes, env, rng, 0)
                texts.append(t)
            key = tuple(texts)
            if key in seen:
                continue
            seen.add(key)
            yield self._row(i, texts, env)
            i += 1


def expand(template: str, wildcards: Mapping[str, list[str]] | None = None, limit: int | None = None) -> list[str]:
    """Convenience helper: expand a single prompt template into strings."""
    return [r["prompt"] for r in Matrix(MatrixSpec(prompt=template), wildcards).rows(limit)]
