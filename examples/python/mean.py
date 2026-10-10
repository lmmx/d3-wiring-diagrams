"""A loop with a branch

A for loop is a star filled with its body's diagram. Its wires are the
iterated value (in), the variables it reads (total, count), and the ones it
writes that are used afterwards (total', count'). The if inside is a star of
the same kind.
"""


def mean_positive(xs):
    """
    >>> mean_positive([3, -1, 5])
    4.0
    >>> mean_positive([])
    0.0
    """
    total = 0
    count = 0
    for x in xs:
        if x > 0:
            total += x
            count += 1
    return total / count if count else 0.0
