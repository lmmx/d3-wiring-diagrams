"""Binary search

A while loop holding an if/elif/else: the elif is an if nested in the else
branch. The first branch returns from inside the loop, so the loop, the if
and that branch all have a return wire, soldered to the function's. The loop
body writes lo' and hi' for the next iteration; nothing after the loop reads
them, so they end inside the loop's star.
"""


def index(xs, target):
    """Where target is in the sorted list xs, or -1.

    >>> index([1, 3, 5, 8, 13], 8)
    3
    >>> index([1, 3, 5, 8, 13], 4)
    -1
    """
    lo, hi = 0, len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        elif xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
