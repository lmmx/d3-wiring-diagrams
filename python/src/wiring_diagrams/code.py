"""Wiring diagrams of Python source code.

A function is a star: its wires are its parameters and ``return``. Its body is
a wiring diagram inside that star (docs/code.md):

* **cables are values.** Each parameter, each assignment and each
  sub-expression's result is a cable. Reading a variable solders onto the cable
  it currently names.
* **inner stars are operations.** Calls, operators, attribute and item access,
  literals and globals are inner stars. A call's wires are its arguments plus
  ``return``.
* **compound statements are sub-diagrams.** ``if``, ``for``, ``while``,
  ``with``, ``try`` and ``match`` are stars filled with the diagram of their
  body. Their wires are the variables they read, the variables they write that
  are used afterwards (``x'``), and ``return`` if they return.
* **a call to a function of the same module** gets that function's own star
  (every parameter, bound as Python would bind the arguments). With
  ``expand > 0`` the call star is filled with the callee's body: operadic
  composition is inlining.
* **modules, classes and packages** are stars with no wires, containing
  their definitions. Wires of definitions are unconnected at that level.

Every structural wire name is a Python keyword or contains a character no
identifier can (``return``, ``if``, ``in``, ``0``, ``x'``, ``*args``), so it never
collides with a variable or parameter name.

All cables have one type, ``py``: the scan describes dataflow, not types.
"""

from __future__ import annotations

import ast
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .diagram import WiringDiagram
from .term import Term

__all__ = ["document", "scan_path", "scan_source"]

TYPE = "py"
MAX_LABEL = 28

_FunctionDef = ast.FunctionDef | ast.AsyncFunctionDef

_BINOPS: dict[type[ast.AST], str] = {
    ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/", ast.FloorDiv: "//", ast.Mod: "%",
    ast.Pow: "**", ast.MatMult: "@", ast.LShift: "<<", ast.RShift: ">>", ast.BitOr: "|",
    ast.BitXor: "^", ast.BitAnd: "&",
}  # fmt: skip
_UNARY: dict[type[ast.AST], str] = {ast.Not: "not", ast.USub: "-", ast.UAdd: "+", ast.Invert: "~"}
_CMP: dict[type[ast.AST], str] = {
    ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=",
    ast.Is: "is", ast.IsNot: "is not", ast.In: "in", ast.NotIn: "not in",
}  # fmt: skip


def _label(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_LABEL else text[: MAX_LABEL - 1] + "…"


def _source(node: ast.AST) -> str:
    return _label(ast.unparse(node))


# -- the diagram under construction -----------------------------------------------------


@dataclass
class _Diagram:
    """Cables and inner stars of one diagram, in the order they are created."""

    cables: int = 0
    inner: list[dict[str, int]] = field(default_factory=list)
    children: list[Term | None] = field(default_factory=list)
    labels: list[str | None] = field(default_factory=list)
    globals: dict[str, int] = field(default_factory=dict)

    def cable(self) -> int:
        self.cables += 1
        return self.cables - 1

    def star(self, label: str, wires: dict[str, int], child: Term | None = None) -> None:
        self.inner.append(wires)
        self.children.append(child)
        self.labels.append(label)

    def op(self, label: str, args: Sequence[int], **named: int) -> int:
        """A star taking ``args`` on wires 0, 1, … and giving a value on ``return``."""
        out = self.cable()
        self.star(label, {**{str(i): c for i, c in enumerate(args)}, **named, "return": out})
        return out

    def term(self, outer: dict[str, int], label: str | None) -> Term:
        phi = WiringDiagram([TYPE] * self.cables, self.inner, outer)
        return Term(phi, self.children, self.labels, label)


# -- names read and written ---------------------------------------------------------------


class _Names(ast.NodeVisitor):
    """Names a piece of code loads and stores in the current scope, and whether it returns.

    Nested functions, lambdas, classes and comprehensions have their own scopes:
    their free variables count as loads here, nothing else does.
    """

    def __init__(self) -> None:
        self.loads: set[str] = set()
        self.stores: set[str] = set()
        self.returns = False

    @classmethod
    def of(cls, nodes: Iterable[ast.AST]) -> _Names:
        v = cls()
        for n in nodes:
            v.visit(n)
        return v

    def visit_Name(self, node: ast.Name) -> None:
        (self.loads if isinstance(node.ctx, ast.Load) else self.stores).add(node.id)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        # `x += 1` reads x as well as writing it
        if isinstance(node.target, ast.Name):
            self.loads.add(node.target.id)
        self.generic_visit(node)

    def visit_Return(self, node: ast.Return) -> None:
        self.returns = True
        self.generic_visit(node)

    def _nested(self, body: Iterable[ast.AST], bound: set[str]) -> None:
        inner = _Names.of(body)
        self.loads |= inner.loads - inner.stores - bound

    def visit_FunctionDef(self, node: _FunctionDef) -> None:
        self.stores.add(node.name)
        for d in [*node.decorator_list, *node.args.defaults, *node.args.kw_defaults]:
            if d is not None:
                self.visit(d)
        self._nested(node.body, {a.arg for a in _all_args(node.args)})

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self._nested([node.body], {a.arg for a in _all_args(node.args)})

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.stores.add(node.name)
        for b in [*node.bases, *node.decorator_list]:
            self.visit(b)
        self._nested(node.body, set())

    def _comprehension(self, node: ast.AST) -> None:
        inner = _Names()
        for child in ast.iter_child_nodes(node):
            inner.visit(child)
        self.loads |= inner.loads - inner.stores

    visit_ListComp = visit_SetComp = visit_GeneratorExp = visit_DictComp = _comprehension

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.name:
            self.stores.add(node.name)
        self.generic_visit(node)

    def visit_MatchAs(self, node: ast.MatchAs) -> None:
        if node.name:
            self.stores.add(node.name)
        self.generic_visit(node)

    def visit_MatchStar(self, node: ast.MatchStar) -> None:
        if node.name:
            self.stores.add(node.name)

    def visit_MatchMapping(self, node: ast.MatchMapping) -> None:
        if node.rest:
            self.stores.add(node.rest)
        self.generic_visit(node)


def _all_args(args: ast.arguments) -> list[ast.arg]:
    extra = [a for a in (args.vararg, args.kwarg) if a is not None]
    return [*args.posonlyargs, *args.args, *args.kwonlyargs, *extra]


# -- functions --------------------------------------------------------------------------


@dataclass(frozen=True)
class _Signature:
    """The star of a function: one wire per parameter, then ``return``."""

    positional: tuple[str, ...]  # positional-only and ordinary parameters, in order
    keyword_only: tuple[str, ...]
    vararg: str | None
    kwarg: str | None
    defaults: frozenset[str]  # parameters that may be left out

    @classmethod
    def of(cls, args: ast.arguments) -> _Signature:
        positional = tuple(a.arg for a in [*args.posonlyargs, *args.args])
        keyword_only = tuple(a.arg for a in args.kwonlyargs)
        with_default = set(positional[len(positional) - len(args.defaults) :])
        with_default |= {a.arg for a, d in zip(args.kwonlyargs, args.kw_defaults, strict=True) if d}
        return cls(
            positional,
            keyword_only,
            args.vararg.arg if args.vararg else None,
            args.kwarg.arg if args.kwarg else None,
            frozenset(with_default),
        )

    def wires(self) -> list[tuple[str, str]]:
        """``(wire, variable)`` for each parameter."""
        out = [(p, p) for p in [*self.positional, *self.keyword_only]]
        if self.vararg:
            out.append((f"*{self.vararg}", self.vararg))
        if self.kwarg:
            out.append((f"**{self.kwarg}", self.kwarg))
        return out


@dataclass
class _Context:
    """What a scan knows about the module: its functions and classes."""

    functions: dict[str, _FunctionDef]  # "f" and "Class.method"
    expand: int
    stack: tuple[str, ...]  # the function being drawn, then the calls expanded into it

    def enter(self, qualname: str) -> _Context:
        return _Context(self.functions, self.expand, (*self.stack, qualname))

    def may_expand(self, qualname: str) -> bool:
        """Expand ``expand`` levels of calls, never into a function already on the stack."""
        return len(self.stack) <= self.expand and qualname not in self.stack


def _function_term(qualname: str, fn: _FunctionDef, ctx: _Context) -> Term:
    d = _Diagram()
    sig = _Signature.of(fn.args)
    env = {var: d.cable() for _, var in sig.wires()}
    outer = {wire: env[var] for wire, var in sig.wires()}
    ret = d.cable()
    outer["return"] = ret
    cls = qualname.rsplit(".", 1)[0] if "." in qualname else None
    _Body(d, ctx, ret, cls, sig.positional[:1]).block(fn.body, env, set())
    prefix = "async def" if isinstance(fn, ast.AsyncFunctionDef) else "def"
    return d.term(outer, f"{prefix} {qualname}")


class _Body:
    """Translates the statements of one function body into a diagram."""

    def __init__(
        self, d: _Diagram, ctx: _Context, ret: int, cls: str | None, receiver: tuple[str, ...]
    ) -> None:
        self.d = d
        self.ctx = ctx
        self.ret = ret
        self.cls = cls
        self.receiver = receiver  # the name of `self` in a method, if any

    def sub(self, d: _Diagram, ret: int) -> _Body:
        return _Body(d, self.ctx, ret, self.cls, self.receiver)

    # -- statements -------------------------------------------------------------------

    def block(self, stmts: Sequence[ast.stmt], env: dict[str, int], live_out: set[str]) -> None:
        """Translate ``stmts`` in order, updating ``env``; ``live_out`` is read afterwards."""
        later: list[set[str]] = []
        live = set(live_out)
        for s in reversed(stmts):
            later.append(set(live))
            live |= _Names.of([s]).loads
        later.reverse()
        for s, live_after in zip(stmts, later, strict=True):
            self.statement(s, env, live_after)

    def statement(self, s: ast.stmt, env: dict[str, int], live: set[str]) -> None:
        d = self.d
        match s:
            case ast.Expr(value=v):
                if not isinstance(v, ast.Constant):  # docstrings and bare constants do nothing
                    self.expr(v, env)
            case ast.Assign(targets=targets, value=v):
                value = self.expr(v, env)
                for t in targets:
                    self.bind(t, value, env)
            case ast.AnnAssign(target=t, value=v) if v is not None:
                self.bind(t, self.expr(v, env), env)
            case ast.AugAssign(target=t, op=op, value=v):
                current = self.expr(_load(t), env)
                self.bind(t, d.op(_BINOPS[type(op)] + "=", [current, self.expr(v, env)]), env)
            case ast.Return(value=v):
                value = self.expr(v, env) if v is not None else self.constant("None")
                # every return statement is soldered onto the function's `return` cable
                d.star(
                    "return", {"0": value, "return": self.ret} if self.ret >= 0 else {"0": value}
                )
            case ast.Raise(exc=exc):
                d.star("raise", {"0": self.expr(exc, env)} if exc else {})
            case ast.Assert(test=test, msg=msg):
                args = [self.expr(test, env)] + ([self.expr(msg, env)] if msg else [])
                d.star("assert", {str(i): c for i, c in enumerate(args)})
            case ast.Delete(targets=targets):
                d.star("del", {str(i): self.expr(_load(t), env) for i, t in enumerate(targets)})
            case ast.Import(names=names) | ast.ImportFrom(names=names):
                for alias in names:
                    name = alias.asname or alias.name.split(".")[0]
                    env[name] = d.op(_label(ast.unparse(s)), [])
            case ast.FunctionDef() | ast.AsyncFunctionDef() | ast.ClassDef():
                # a nested definition is a value in this scope; its body is not expanded
                kind = "class" if isinstance(s, ast.ClassDef) else "def"
                env[s.name] = d.op(f"{kind} {s.name}", [])
            case ast.If(test=test, body=body, orelse=orelse):
                self.compound("if " + _source(test), {"if": self.expr(test, env)},
                              [("then", body), ("else", orelse)], env, live)  # fmt: skip
            case (
                ast.For(target=target, iter=it, body=body, orelse=orelse)
                | ast.AsyncFor(target=target, iter=it, body=body, orelse=orelse)
            ):
                self.compound(f"for {_source(target)} in {_source(it)}", {"in": self.expr(it, env)},
                              [("body", body), ("else", orelse)], env, live,
                              carried=_Names.of([s]).loads, target=target)  # fmt: skip
            case ast.While(test=test, body=body, orelse=orelse):
                self.compound("while " + _source(test), {},
                              [("body", [ast.Expr(test), *body]), ("else", orelse)], env, live,
                              carried=_Names.of([s]).loads)  # fmt: skip
            case ast.With(items=items, body=body) | ast.AsyncWith(items=items, body=body):
                wires = {"with" if i == 0 else f"with {i}": self.expr(it.context_expr, env)
                         for i, it in enumerate(items)}  # fmt: skip
                as_targets = [(w, it.optional_vars) for w, it in zip(wires, items, strict=True)]
                self.compound("with " + ", ".join(_source(it.context_expr) for it in items), wires,
                              [("body", body)], env, live, bound=as_targets)  # fmt: skip
            case ast.Try(body=body, handlers=handlers, orelse=orelse, finalbody=final):
                branches = [("try", body)]
                branches += [(_handler_label(h), [_bind_exception(h), *h.body]) for h in handlers]
                branches += [("else", orelse), ("finally", final)]
                self.compound("try", {}, branches, env, live)
            case ast.Match(subject=subject, cases=cases):
                subj = self.expr(subject, env)
                branches = [(f"case {_label(ast.unparse(c.pattern))}", c.body) for c in cases]
                self.compound("match " + _source(subject), {"match": subj}, branches, env, live,
                              patterns=[c.pattern for c in cases])  # fmt: skip
            case ast.Pass() | ast.Break() | ast.Continue() | ast.Global() | ast.Nonlocal():
                pass
            case _:
                # anything newer than this scanner: an opaque star over what it reads
                reads = sorted(_Names.of([s]).loads & env.keys())
                d.star(_label(type(s).__name__), {r: env[r] for r in reads})

    def compound(
        self,
        label: str,
        wires: dict[str, int],
        branches: Sequence[tuple[str, Sequence[ast.stmt]]],
        env: dict[str, int],
        live: set[str],
        *,
        carried: set[str] | None = None,
        target: ast.expr | None = None,
        bound: Sequence[tuple[str, ast.expr | None]] = (),
        patterns: Sequence[ast.pattern] = (),
    ) -> None:
        # ``patterns[i]`` (for ``match``) belongs to ``branches[i]``. ``carried``: names a
        # loop body reads, which its writes must reach on the next iteration.
        """A star filled with a diagram whose inner stars are the branches.

        The star's wires are the given ones (the tested or iterated value),
        each variable the branches read (``x``), each variable they write that
        is read afterwards (``x'``), and ``return`` if a branch returns.
        """
        paired = [
            (name, body, patterns[i] if patterns else None)
            for i, (name, body) in enumerate(branches)
            if body
        ]
        stmts = [s for _, body, _ in paired for s in body]
        names = _Names.of(stmts)
        extra_stores = set(_Names.of([target]).stores) if target is not None else set()
        for _, t in bound:
            if t is not None:
                extra_stores |= _Names.of([t]).stores
        for p in patterns:
            extra_stores |= _Names.of([p]).stores
        # names the statement itself binds (loop target, `as` targets, pattern captures)
        # shadow the outer ones inside it, so they are not reads from outside
        reads = sorted((names.loads - extra_stores) & env.keys())
        writes = sorted((names.stores | extra_stores) & live)
        returns = names.returns

        inner = _Diagram()
        inner_env = {r: inner.cable() for r in reads}
        outer = {**{w: inner.cable() for w in wires}, **{r: inner_env[r] for r in reads}}
        inner_ret = inner.cable() if returns else -1
        written = {w: inner.cable() for w in writes}
        sub = self.sub(inner, inner_ret)
        for name, body, pattern in paired:
            branch_env = dict(inner_env)
            if target is not None and name == "body":
                # the loop variable is an item of the iterated value
                item = inner.op("item", [outer["in"]])
                sub.bind(target, item, branch_env)
            for w, t in bound:
                if t is not None:
                    sub.bind(t, outer[w], branch_env)
            if pattern is not None:
                for captured in sorted(_Names.of([pattern]).stores):
                    branch_env[captured] = inner.op("capture " + captured, [outer["match"]])
            sub.branch(name, body, branch_env, written, inner_ret, live | (carried or set()))
        outer.update({f"{w}'": c for w, c in written.items()})
        if returns:
            outer["return"] = inner_ret
        star = {w: c for w, c in wires.items()}
        star.update({r: env[r] for r in reads})
        for w in writes:
            env[w] = self.d.cable()
            star[f"{w}'"] = env[w]
        if returns:
            star["return"] = self.ret
        self.d.star(label, star, inner.term(outer, label))

    def branch(
        self,
        name: str,
        body: Sequence[ast.stmt],
        env: dict[str, int],
        written: dict[str, int],
        ret: int,
        live: set[str],
    ) -> None:
        """One branch of a compound statement, as a star with its own sub-diagram."""
        d = self.d
        names = _Names.of(body)
        reads = sorted(names.loads & env.keys())
        writes = sorted(names.stores & written.keys())
        inner = _Diagram()
        inner_env = {r: inner.cable() for r in reads}
        outer = dict(inner_env)  # before the body rebinds any of them
        inner_ret = inner.cable() if names.returns else -1
        self.sub(inner, inner_ret).block(body, inner_env, set(writes) | live)
        outer.update({f"{w}'": inner_env[w] if w in inner_env else inner.cable() for w in writes})
        if names.returns:
            outer["return"] = inner_ret
        star = {r: env[r] for r in reads}
        star.update({f"{w}'": written[w] for w in writes})
        if names.returns:
            star["return"] = ret
        d.star(name, star, inner.term(outer, name))

    def bind(self, target: ast.expr, value: int, env: dict[str, int]) -> None:
        d = self.d
        match target:
            case ast.Name(id=name):
                env[name] = value
            case ast.Tuple(elts=elts) | ast.List(elts=elts):
                parts = []
                for i, e in enumerate(elts):
                    wire = f"[*{i}]" if isinstance(e, ast.Starred) else f"[{i}]"
                    parts.append((wire, d.cable(), e.value if isinstance(e, ast.Starred) else e))
                d.star("unpack", {"0": value, **{w: c for w, c, _ in parts}})
                for _, c, e in parts:
                    self.bind(e, c, env)
            case ast.Attribute(value=obj, attr=attr):
                d.star(f".{attr} =", {"0": self.expr(obj, env), "1": value})
            case ast.Subscript(value=obj, slice=index):
                d.star("[] =", {"0": self.expr(obj, env), "1": self.expr(index, env), "2": value})
            case ast.Starred(value=inner):
                self.bind(inner, value, env)
            case _:
                d.star("bind " + _source(target), {"0": value})

    # -- expressions ------------------------------------------------------------------

    def constant(self, text: str) -> int:
        return self.d.op(_label(text), [])

    def global_(self, name: str) -> int:
        """A name this function does not bind: one star per name per diagram."""
        if name not in self.d.globals:
            self.d.globals[name] = self.d.op(name, [])
        return self.d.globals[name]

    def expr(self, e: ast.expr, env: dict[str, int]) -> int:
        d = self.d
        match e:
            case ast.Constant():
                return self.constant(ast.unparse(e))
            case ast.Name(id=name):
                return env[name] if name in env else self.global_(name)
            case ast.BinOp(left=a, op=op, right=b):
                return d.op(_BINOPS[type(op)], [self.expr(a, env), self.expr(b, env)])
            case ast.UnaryOp(op=op, operand=a):
                return d.op(_UNARY[type(op)], [self.expr(a, env)])
            case ast.BoolOp(op=op, values=vs):
                return d.op(
                    "and" if isinstance(op, ast.And) else "or", [self.expr(v, env) for v in vs]
                )
            case ast.Compare(left=a, ops=ops, comparators=cs):
                label = " ".join(_CMP[type(o)] for o in ops)
                return d.op(label, [self.expr(a, env), *(self.expr(c, env) for c in cs)])
            case ast.Call():
                return self.call(e, env)
            case ast.Attribute(value=obj, attr=attr):
                dotted = _dotted(e)
                if dotted is not None and dotted.split(".")[0] not in env:
                    return self.global_(dotted)
                return d.op(f".{attr}", [self.expr(obj, env)])
            case ast.Subscript(value=obj, slice=index):
                return d.op("[]", [self.expr(obj, env), self.expr(index, env)])
            case ast.Tuple(elts=es) | ast.List(elts=es) | ast.Set(elts=es):
                brackets = {ast.Tuple: "( , )", ast.List: "[ , ]", ast.Set: "{ , }"}[type(e)]
                return d.op(brackets, [self.expr(x, env) for x in es])
            case ast.Dict(keys=ks, values=vs):
                items = []
                for k, v in zip(ks, vs, strict=True):
                    items += [self.expr(k, env) if k is not None else d.op("**", [])]
                    items += [self.expr(v, env)]
                return d.op("{ : }", items)
            case ast.JoinedStr(values=vs):
                parts = [self.expr(v.value, env) for v in vs if isinstance(v, ast.FormattedValue)]
                return d.op('f"…"', parts)
            case ast.IfExp(test=t, body=b, orelse=o):
                out = d.cable()
                d.star("if-else", {"if": self.expr(t, env), "0": self.expr(b, env),
                                   "else": self.expr(o, env), "return": out})  # fmt: skip
                return out
            case ast.NamedExpr(target=t, value=v):
                value = self.expr(v, env)
                self.bind(t, value, env)
                return value
            case ast.Starred(value=v):
                return d.op("*", [self.expr(v, env)])
            case ast.Await(value=v) | ast.Yield(value=v) | ast.YieldFrom(value=v):
                kind = {ast.Await: "await", ast.Yield: "yield", ast.YieldFrom: "yield from"}[
                    type(e)
                ]
                return d.op(kind, [self.expr(v, env)] if v is not None else [])
            case _:
                # lambdas, comprehensions, slices, …: an opaque star over the variables it reads
                reads = sorted(_Names.of([e]).loads & env.keys())
                out = d.cable()
                d.star(_source(e), {**{r: env[r] for r in reads}, "return": out})
                return out

    def call(self, e: ast.Call, env: dict[str, int]) -> int:
        d = self.d
        resolved = self.resolve(e.func, env)
        if resolved is not None:
            qualname, fn, receiver = resolved
            bound = self.bind_call(_Signature.of(fn.args), receiver, e, env)
            if bound is not None:
                out = d.cable()
                bound["return"] = out
                child = None
                if self.ctx.may_expand(qualname):
                    child = _function_term(qualname, fn, self.ctx.enter(qualname))
                d.star(qualname, bound, child)
                return out
        dotted = _dotted(e.func)
        wires: dict[str, int] = {}
        if dotted is None or dotted.split(".")[0] in env:
            if isinstance(e.func, ast.Attribute):
                # a method call: the receiver goes on wire "."
                wires["."] = self.expr(e.func.value, env)
                label = f".{e.func.attr}()"
            else:
                wires["()"] = self.expr(e.func, env)
                label = "call"
        else:
            label = dotted
        for i, a in enumerate(e.args):
            if isinstance(a, ast.Starred):
                wires[f"*{i}"] = self.expr(a.value, env)
            else:
                wires[str(i)] = self.expr(a, env)
        for i, k in enumerate(e.keywords):
            wires[k.arg if k.arg is not None else f"**{i}"] = self.expr(k.value, env)
        out = d.cable()
        wires["return"] = out
        d.star(_label(label), wires)
        return out

    def resolve(
        self, func: ast.expr, env: dict[str, int]
    ) -> tuple[str, _FunctionDef, ast.expr | None] | None:
        """A function of this module that ``func`` names, and the receiver of a method call."""
        fns = self.ctx.functions
        match func:
            case ast.Name(id=name) if name not in env and name in fns:
                return name, fns[name], None
            case ast.Attribute(value=ast.Name(id=obj) as recv, attr=attr) if (
                self.cls is not None and self.receiver == (obj,) and f"{self.cls}.{attr}" in fns
            ):
                return f"{self.cls}.{attr}", fns[f"{self.cls}.{attr}"], recv
        return None

    def bind_call(
        self, sig: _Signature, receiver: ast.expr | None, e: ast.Call, env: dict[str, int]
    ) -> dict[str, int] | None:
        """Wires for a call as Python binds it, or ``None`` if the binding is not static."""
        if any(isinstance(a, ast.Starred) for a in e.args) or any(
            k.arg is None for k in e.keywords
        ):
            return None
        args: list[ast.expr] = ([receiver] if receiver is not None else []) + list(e.args)
        if len(args) > len(sig.positional) or sig.vararg or sig.kwarg:
            return None
        bound: dict[str, ast.expr] = dict(zip(sig.positional, args, strict=False))
        for k in e.keywords:
            assert k.arg is not None
            if k.arg in bound or k.arg not in (*sig.positional, *sig.keyword_only):
                return None
            bound[k.arg] = k.value
        params = [*sig.positional, *sig.keyword_only]
        if any(p not in bound and p not in sig.defaults for p in params):
            return None
        # arguments are evaluated in source order; defaults are cables nothing drives
        wires = {p: self.expr(bound[p], env) for p in params if p in bound}
        return {p: wires[p] if p in wires else self.d.cable() for p in params}


def _load(target: ast.expr) -> ast.expr:
    """The same target read instead of written (for ``x += 1``, ``del x``)."""
    node = ast.parse(ast.unparse(target), mode="eval").body
    return node


def _dotted(e: ast.expr) -> str | None:
    """``a.b.c`` for an attribute chain on a plain name, else ``None``."""
    parts = []
    while isinstance(e, ast.Attribute):
        parts.append(e.attr)
        e = e.value
    if not isinstance(e, ast.Name):
        return None
    return ".".join([e.id, *reversed(parts)])


def _handler_label(h: ast.ExceptHandler) -> str:
    return "except" + (f" {_source(h.type)}" if h.type is not None else "")


def _bind_exception(h: ast.ExceptHandler) -> ast.stmt:
    """``except E as e`` binds ``e``: model it as ``e = <exception>``."""
    if not h.name:
        return ast.Pass()
    return ast.Assign(
        targets=[ast.Name(h.name, ast.Store())], value=ast.Name("<exception>", ast.Load())
    )


# -- modules, classes, packages -------------------------------------------------------------


def _collect(body: Sequence[ast.stmt], prefix: str = "") -> dict[str, _FunctionDef]:
    out: dict[str, _FunctionDef] = {}
    for s in body:
        if isinstance(s, ast.FunctionDef | ast.AsyncFunctionDef):
            out[prefix + s.name] = s
        elif isinstance(s, ast.ClassDef) and not prefix:
            out.update(_collect(s.body, f"{s.name}."))
    return out


def _signature_star(d: _Diagram, fn: _FunctionDef) -> dict[str, int]:
    """A definition's wires at module or class level: unconnected cables."""
    return {w: d.cable() for w, _ in [*_Signature.of(fn.args).wires(), ("return", "")]}


def _container_term(label: str, body: Sequence[ast.stmt], ctx: _Context, prefix: str) -> Term:
    d = _Diagram()
    for s in body:
        if isinstance(s, ast.FunctionDef | ast.AsyncFunctionDef):
            qualname = prefix + s.name
            d.star(
                qualname, _signature_star(d, s), _function_term(qualname, s, ctx.enter(qualname))
            )
        elif isinstance(s, ast.ClassDef):
            d.star(
                f"class {prefix}{s.name}",
                {},
                _container_term(f"class {prefix}{s.name}", s.body, ctx, f"{prefix}{s.name}."),
            )
    rest = [
        s
        for s in body
        if not isinstance(
            s, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef | ast.Import | ast.ImportFrom
        )
    ]
    rest = [s for s in rest if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
    if rest:
        inner = _Diagram()
        _Body(inner, ctx, -1, None, ()).block(rest, {}, set())
        d.star("statements", {}, inner.term({}, "statements"))
    return d.term({}, label)


def scan_source(
    source: str, *, name: str = "<source>", function: str | None = None, expand: int = 0
) -> Term:
    """The wiring diagram of Python ``source``.

    Args:
        source: Python code.
        name: label of the module star.
        function: ``"f"`` or ``"Class.method"`` to scan one function instead of the module.
        expand: how many levels of calls to functions of the same module to fill
            with the callee's own diagram (0 leaves them as stars).

    Raises:
        SyntaxError: if ``source`` does not parse.
        KeyError: if ``function`` is not defined at the top level or in a class.
    """
    tree = ast.parse(source, filename=name)
    ctx = _Context(_collect(tree.body), expand, ())
    if function is None:
        return _container_term(name, tree.body, ctx, "")
    if function not in ctx.functions:
        raise KeyError(f"no function {function!r} in {name}; found {sorted(ctx.functions)}")
    return _function_term(function, ctx.functions[function], ctx.enter(function))


def scan_path(path: str | Path, *, expand: int = 0) -> Term:
    """A file's module diagram, or a directory's: one star per module and subpackage."""
    p = Path(path)
    if p.is_file():
        return scan_source(p.read_text(encoding="utf-8"), name=p.name, expand=expand)
    d = _Diagram()
    for child in sorted(p.iterdir()):
        if child.name.startswith(".") or child.name == "__pycache__":
            continue
        if child.is_dir() and any(child.rglob("*.py")):
            d.star(child.name + "/", {}, scan_path(child, expand=expand))
        elif child.suffix == ".py":
            d.star(child.name, {}, scan_path(child, expand=expand))
    return d.term({}, p.name + "/")


def document(
    source: str, *, name: str = "<source>", function: str | None = None, expand: int = 0
) -> dict[str, Any]:
    """An example document (docs/format.md) holding the scan and the source it came from."""
    term = scan_source(source, name=name, function=function, expand=expand)
    what = f"function {function}" if function else f"module {name}"
    return {
        "title": f"{what} (scanned)",
        "source": "wiring_diagrams.code",
        "description": (
            f"The dataflow of {what}: cables are values, inner stars are operations and calls, "
            "and compound statements are stars holding their own diagrams"
            + (f"; calls into the module are expanded {expand} level(s) deep" if expand else "")
            + "."
        ),
        "term": term.to_json(),
        "code": {"language": "python", "source": source},
    }


def main(argv: Sequence[str] | None = None) -> int:
    import argparse
    import json

    parser = argparse.ArgumentParser(
        prog="python -m wiring_diagrams.code",
        description="Print the wiring diagram of Python code as JSON (open it in the viewer).",
    )
    parser.add_argument("path", help="a .py file, or a directory to scan as a package")
    parser.add_argument("-f", "--function", help='scan one function: "f" or "Class.method"')
    parser.add_argument("-e", "--expand", type=int, default=0, help="levels of calls to inline")
    args = parser.parse_args(argv)
    p = Path(args.path)
    if p.is_dir():
        if args.function:
            parser.error("--function needs a file")
        doc = {
            "title": f"package {p.name} (scanned)",
            "source": "wiring_diagrams.code",
            "description": "One star per module and subpackage, each holding its definitions.",
            "term": scan_path(p, expand=args.expand).to_json(),
        }
    else:
        doc = document(p.read_text(encoding="utf-8"), name=p.name, function=args.function,
                       expand=args.expand)  # fmt: skip
    json.dump(doc, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
