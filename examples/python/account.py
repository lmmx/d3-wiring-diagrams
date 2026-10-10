"""A class with methods

The class is a star holding one star per method. transfer calls
self.withdraw, a method of the same class, so the call has withdraw's own
interface {self, amount, return} and is filled with its body.
target.deposit(amount) is called on another object, which the scan cannot
resolve statically, so it stays a method-call star with the receiver on
its . wire.
"""


class Account:
    """
    >>> a, b = Account(100), Account(0)
    >>> a.transfer(b, 30)
    >>> a.balance, b.balance
    (70, 30)
    """

    def __init__(self, balance=0):
        self.balance = balance

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("deposit must be positive")
        self.balance += amount

    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError("insufficient funds")
        self.balance -= amount
        return amount

    def transfer(self, target, amount):
        target.deposit(self.withdraw(amount))
