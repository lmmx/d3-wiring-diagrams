"""Newton's method

sqrt improves a guess until it is good enough. The while loop is a star
whose wires are what it reads (x, guess) and the guess it leaves behind
(guess'). With one level of calls expanded, improve and good_enough are
filled with their bodies inside the loop, and the default tolerance is a
cable that nothing drives.
"""


def improve(guess, x):
    return (guess + x / guess) / 2


def good_enough(guess, x, tolerance=1e-12):
    return abs(guess * guess - x) <= tolerance * x


def sqrt(x):
    """
    >>> sqrt(2.0)
    1.414213562373095
    >>> sqrt(0.0)
    0.0
    """
    if x < 0:
        raise ValueError("math domain error")
    if x == 0:
        return 0.0
    guess = x
    while not good_enough(guess, x):
        guess = improve(guess, x)
    return guess
