"""Seat-level inventory.

Every zone is made of physical blocks; every block has rows × seats. A block's state is a
string with one character per seat: '0' = free, '1' = sold/held. All reads and writes run on
the event-loop thread with no awaits in between, so a check-and-take is atomic.

Block numbering: 1xx main stand, 2xx home end, 3xx opposite, 4xx away end, 5xx upper
corners, H* hospitality. Blocks are listed best-first (closest to the halfway line).
"""

from __future__ import annotations

import random
from dataclasses import dataclass

FREE, TAKEN = "0", "1"


@dataclass(frozen=True)
class BlockSpec:
    name: str
    block_index: int  # which physical part of the zone (left/right wing, corner) for the stadium map
    gate: str
    rows: int
    seats_per_row: int


def _blocks(names: list[str], idx: int, gate: str, rows: int, spr: int) -> list[BlockSpec]:
    return [BlockSpec(n, idx, gate, rows, spr) for n in names]


# zone -> blocks, best-first
LAYOUT: dict[str, list[BlockSpec]] = {
    "VIP": _blocks(["H2", "H1", "H3"], 0, "VIP entrance · Main Stand", 4, 12),
    "MC": _blocks(["112", "111", "113", "110", "114"], 0, "Gate A · Main Stand", 14, 22),
    "OC": _blocks(["312", "311", "313", "310", "314"], 0, "Gate C · Opposite Stand", 14, 22),
    "MW": _blocks(["106", "105"], 0, "Gate A · Main Stand", 16, 20)
    + _blocks(["118", "119"], 1, "Gate B · Main Stand", 16, 20)
    + _blocks(["104", "103", "102"], 0, "Gate A · Main Stand", 16, 20)
    + _blocks(["120", "121", "122"], 1, "Gate B · Main Stand", 16, 20),
    "OW": _blocks(["306", "305"], 0, "Gate C · Opposite Stand", 16, 20)
    + _blocks(["318", "319"], 1, "Gate D · Opposite Stand", 16, 20)
    + _blocks(["304", "303", "302"], 0, "Gate C · Opposite Stand", 16, 20)
    + _blocks(["320", "321", "322"], 1, "Gate D · Opposite Stand", 16, 20),
    "HE": _blocks(["203", "204", "202", "205", "201", "206"], 0, "Gate E · Home End", 20, 24),
    "AE": _blocks(["402", "401", "403"], 0, "Gate F · Away supporters only", 14, 20),
    "CU": _blocks(["501", "502"], 0, "Gate C · Upper tier (north-west)", 12, 18)
    + _blocks(["507", "508"], 1, "Gate D · Upper tier (north-east)", 12, 18)
    + _blocks(["511", "512"], 2, "Gate A · Upper tier (south-west)", 12, 18)
    + _blocks(["517", "518"], 3, "Gate B · Upper tier (south-east)", 12, 18),
}
SPEC_BY_BLOCK: dict[str, tuple[str, BlockSpec]] = {b.name: (zone, b) for zone, bl in LAYOUT.items() for b in bl}


Position = tuple[int, int]  # (row, seat)


@dataclass(frozen=True)
class SeatHold:
    block: str
    block_index: int
    positions: list[Position]
    gate: str


def _idx(row: int, seat: int, spr: int) -> int:
    return (row - 1) * spr + (seat - 1)


def positions_free(state: str, positions: list[Position], spr: int) -> bool:
    return all(state[_idx(r, s, spr)] == FREE for r, s in positions)


def set_positions(state: str, positions: list[Position], spr: int, value: str) -> str:
    chars = list(state)
    for r, s in positions:
        chars[_idx(r, s, spr)] = value
    return "".join(chars)


def positions_csv(positions: list[Position]) -> str:
    return ",".join(f"{r}:{s}" for r, s in positions)


def parse_positions(csv: str) -> list[Position]:
    out: list[Position] = []
    for part in csv.split(","):
        if ":" in part:
            r, s = part.split(":")
            out.append((int(r), int(s)))
    return out


def describe(positions: list[Position]) -> str:
    """'Row 5: 11, 12 · Row 6: 3'"""
    rows: dict[int, list[int]] = {}
    for r, s in sorted(positions):
        rows.setdefault(r, []).append(s)
    return " · ".join(f"Row {r}: {', '.join(map(str, ss))}" for r, ss in rows.items())


def generate_state(rows: int, spr: int, sold_fraction: float, rng: random.Random) -> str:
    """Pre-sold seats (season tickets, members) in realistic clumps: alternating runs of sold
    and free seats with geometric lengths, so the sold share is ~`sold_fraction`."""
    free_mean = 4.0  # typical gap between season-ticket holders
    sold_mean = max(1.0, free_mean * sold_fraction / max(1e-6, 1 - sold_fraction))
    out: list[str] = []
    for _ in range(rows):
        line: list[str] = []
        n = 0
        taken = rng.random() < sold_fraction
        while n < spr:
            length = 1 + int(rng.expovariate(1 / max(0.01, (sold_mean if taken else free_mean) - 1)))
            length = min(length, spr - n)
            line.append((TAKEN if taken else FREE) * length)
            n += length
            taken = not taken
        out.append("".join(line))
    return "".join(out)


def seats_free(state: str, row: int, seats: list[int], spr: int) -> bool:
    return all(state[_idx(row, s, spr)] == FREE for s in seats)


def set_seats(state: str, row: int, seats: list[int], spr: int, value: str) -> str:
    chars = list(state)
    for s in seats:
        chars[_idx(row, s, spr)] = value
    return "".join(chars)


def best_run(state: str, rows: int, spr: int, qty: int) -> tuple[int, list[int]] | None:
    """Front-most row with `qty` adjacent free seats, as close to the middle of the row as possible."""
    centre = (spr + 1) / 2
    for row in range(1, rows + 1):
        line = state[(row - 1) * spr: row * spr]
        best: tuple[float, int] | None = None
        for start in range(0, spr - qty + 1):
            if FREE * qty == line[start: start + qty]:
                dist = abs((start + 1 + start + qty) / 2 - centre)
                if best is None or dist < best[0]:
                    best = (dist, start + 1)
        if best:
            return row, list(range(best[1], best[1] + qty))
    return None


def random_run(state: str, rows: int, spr: int, max_len: int, rng: random.Random) -> tuple[int, list[int]] | None:
    """A rival buyer grabs 1..max_len adjacent free seats somewhere in the block."""
    free = [i for i, ch in enumerate(state) if ch == FREE]
    if not free:
        return None
    i = rng.choice(free)
    row, first = i // spr + 1, i % spr + 1
    seats = [first]
    want = rng.randint(1, max_len)
    while len(seats) < want and seats[-1] < spr and state[_idx(row, seats[-1] + 1, spr)] == FREE:
        seats.append(seats[-1] + 1)
    return row, seats
