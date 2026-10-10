"""Reading a config file

try, with and except are stars holding their blocks. The with star takes
the opened file on its with wire and binds it to fh inside. Both the try
block and the FileNotFoundError handler assign user, so the try star's
user' wire carries whichever ran into the merge.
"""

import json

DEFAULTS = {"width": 80, "colour": True}


def load(path):
    """
    >>> load("no-such-file.json")
    {'width': 80, 'colour': True}
    """
    try:
        with open(path, encoding="utf-8") as fh:
            user = json.load(fh)
    except FileNotFoundError:
        user = {}
    except json.JSONDecodeError as e:
        raise ValueError(f"{path}: {e}") from e
    return {**DEFAULTS, **user}
