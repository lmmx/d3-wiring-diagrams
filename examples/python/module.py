"""module.py, scanned

The module the original proof of concept drew as nested circles, now scanned
from its source. The module and the class are stars that contain their
definitions. Each function is a star whose wires are its parameters and
return, filled with the dataflow of its body. Assignments to self.x are stars.
"""


def bar():
    x = 1


class Foo:
    def sum(self, x, y):
        return x + y

    def __init__(self, x, y):
        self.x = x
        self.y = y

    @classmethod
    def from_xy(cls, xy):
        return cls(*xy)

    def xsq(self):
        return self.x ** 2
