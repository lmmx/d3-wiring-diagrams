"""An expression evaluator

A match statement is a star with one branch per case. Names a pattern
captures (left, right, name, …) are capture stars on the matched value.
evaluate calls itself: with expansion on, the recursive calls stay stars,
because a call is never expanded into a function that is already being
expanded.
"""


def evaluate(expr, env):
    """
    >>> evaluate(("let", "x", 3, ("+", "x", ("*", "x", 2))), {})
    9
    """
    match expr:
        case int() | float():
            return expr
        case str(name):
            return env[name]
        case ("+", left, right):
            return evaluate(left, env) + evaluate(right, env)
        case ("*", left, right):
            return evaluate(left, env) * evaluate(right, env)
        case ("let", name, value, body):
            return evaluate(body, {**env, name: evaluate(value, env)})
        case _:
            raise ValueError(f"not an expression: {expr!r}")
