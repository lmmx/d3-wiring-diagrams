"""Inlining is composition

hypot calls square twice. Each call star has square's own interface
{x, return}, so square's body diagram can be plugged into it. In the nested
view each call holds square's body. In the composed view the calls are gone
and the two products sit directly in hypot's dataflow: operadic composition
is inlining.
"""

import math


def square(x):
    return x * x


def hypot(a, b):
    """
    >>> hypot(3, 4)
    5.0
    """
    return math.sqrt(square(a) + square(b))
