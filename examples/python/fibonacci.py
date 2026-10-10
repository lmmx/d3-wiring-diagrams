"""Fibonacci, iteratively

a, b = b, a + b builds a tuple and unpacks it: a ( , ) star feeding an
unpack star, whose wires [0] and [1] become the new a and b. Both are read
by the next iteration, so the loop's body writes a' and b', and the loop
passes a' on to the return.
"""


def fib(n):
    """
    >>> [fib(n) for n in range(10)]
    [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
    """
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
