"""Counting words

Comprehensions, lambdas and generator expressions have their own scopes, so
each one is a single star wired to the variables it reads from outside
(found, stop, counts, text). Method calls such as text.lower() put the
receiver on the . wire. With expansion, the call to words is filled with its
body, and WORD.findall shows the compiled pattern as a global it reads.
"""

import re
from collections import Counter

WORD = re.compile(r"[a-z']+")
STOP = frozenset({"the", "a", "of", "and", "to", "in"})


def words(text):
    return WORD.findall(text.lower())


def top_words(text, n=3, stop=STOP):
    """
    >>> top_words("The cat and the hat. A cat, a hat, a bat!")
    ['cat', 'hat', 'bat']
    """
    found = words(text)
    counts = Counter(w for w in found if w not in stop)
    ranked = sorted(counts, key=lambda w: (-counts[w], text.lower().index(w)))
    return ranked[:n]
