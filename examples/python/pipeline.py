"""A data pipeline

report parses CSV lines, keeps the valid readings and averages them by
city. With one level of calls expanded, parse, valid and summarise are each
filled with their own bodies. Switch to the composed view: the call stars
disappear and what is left is the whole pipeline's dataflow in one diagram,
the program with its functions inlined.
"""

import csv
import statistics


def parse(lines):
    return [(row["city"], float(row["temp"])) for row in csv.DictReader(lines)]


def valid(reading, low, high):
    city, temp = reading
    return bool(city) and low <= temp <= high


def summarise(readings):
    by_city = {}
    for city, temp in readings:
        by_city.setdefault(city, []).append(temp)
    return {city: statistics.mean(temps) for city, temps in sorted(by_city.items())}


def report(lines, low=-90.0, high=60.0):
    """
    >>> report(["city,temp", "Oslo,4", "Lima,19", "Oslo,6", "Lima,999"])
    {'Lima': 19.0, 'Oslo': 5.0}
    """
    kept = []
    for reading in parse(lines):
        if valid(reading, low, high):
            kept.append(reading)
    return summarise(kept)
