#!/usr/bin/env python3
"""Build the validated LG C5/webOS 25 stock-Home v14 patch from the known v9b base.

This repository intentionally does not redistribute LG's proprietary libapp.so.
Provide the known v9b binary locally; this script verifies it before patching.
"""
from __future__ import annotations

import argparse
import hashlib
import struct
from pathlib import Path

V9B_SHA256 = "05517870a32d99e6acc37ecd3ed57fb12c502ef987a3ad7854dc60e0c3a8e6ba"
V14_SHA256 = "d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981"
EXPECTED_SIZE = 8_782_428

HERO_CALL = 0x620E10
ORIGINAL_HERO_CALLEE = 0x621E9C
CAVE = 0x37EC90
CAVE_LEN = 0x30
LAUNCHER_SITES = (0x629418, 0x62949C, 0x62957C)

# ARM helper:
#   vmov.f64 d1, d0
#   vadd.f64 d0, d0, d0
#   vadd.f64 d0, d0, d0
#   vadd.f64 d0, d0, d1
#   ldr      r0, [r10, #0x24]
#   bx       lr
#
# This is the validated x5 launcher-path multiplier used by v14.
HELPER = bytes.fromhex(
    "40 1b b0 ee "
    "00 0b 30 ee "
    "00 0b 30 ee "
    "01 0b 30 ee "
    "24 00 9a e5 "
    "1e ff 2f e1"
)

SHRINK_STUB = bytes.fromhex(
    "09 0a 85 e2 "
    "f3 01 90 e5 "
    "1e ff 2f e1"
)

QCARDS_BUILD = 0x64C818
RECOMMENDED_BUILD = 0x6CD958

def sha256(data: bytes | bytearray) -> str:
    return hashlib.sha256(data).hexdigest()

def encode_bl(site: int, target: int) -> bytes:
    delta = target - (site + 8)
    if delta % 4:
        raise ValueError(f"unaligned BL target: {site:#x} -> {target:#x}")
    imm24 = (delta >> 2) & 0x00FFFFFF
    return struct.pack("<I", 0xEB000000 | imm24)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="known v9b libapp.so")
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=Path("libapp-homeui-stockhero-bottomrail-v14-x5.so"),
    )
    args = parser.parse_args()

    data = bytearray(args.input.read_bytes())

    if len(data) != EXPECTED_SIZE:
        raise SystemExit(f"unexpected size: {len(data)} (expected {EXPECTED_SIZE})")

    got = sha256(data)
    if got != V9B_SHA256:
        raise SystemExit(f"wrong input SHA256: {got}\nexpected: {V9B_SHA256}")

    # v9b has both unwanted stock Home rows structurally removed already.
    if data[QCARDS_BUILD:QCARDS_BUILD + 12] != SHRINK_STUB:
        raise SystemExit("v9b guard failed: QCard/Edit shrink stub missing")
    if data[RECOMMENDED_BUILD:RECOMMENDED_BUILD + 12] != SHRINK_STUB:
        raise SystemExit("v9b guard failed: RecommendedShelf shrink stub missing")

    # Restore the stock Hero call path.
    data[HERO_CALL:HERO_CALL + 4] = encode_bl(HERO_CALL, ORIGINAL_HERO_CALLEE)

    # Reuse the obsolete v9b Hero trampoline area for the independent
    # launcher-position helper.
    data[CAVE:CAVE + CAVE_LEN] = b"\x00" * CAVE_LEN
    data[CAVE:CAVE + len(HELPER)] = HELPER

    # Apply the validated x5 launcher-path adjustment.
    expected_ldr = bytes.fromhex("24 00 9a e5")
    for site in LAUNCHER_SITES:
        if data[site:site + 4] != expected_ldr:
            raise SystemExit(
                f"launcher guard failed at {site:#x}: "
                f"{data[site:site+4].hex()}"
            )
        data[site:site + 4] = encode_bl(site, CAVE)

    final = sha256(data)
    if final != V14_SHA256:
        raise SystemExit(f"output SHA256 mismatch: {final}\nexpected: {V14_SHA256}")

    args.output.write_bytes(data)
    print(f"wrote {args.output}")
    print(f"sha256 {final}")

if __name__ == "__main__":
    main()
