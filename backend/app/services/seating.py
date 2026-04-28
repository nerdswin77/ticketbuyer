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

