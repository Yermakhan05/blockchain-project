import hashlib
from typing import List


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def hash_leaf(address: str, balance: int) -> bytes:
    text = f"{address.lower()}:{balance}".encode()
    return sha256(text)


def hash_pair(left: bytes, right: bytes) -> bytes:
    return sha256(left + right)


def merkle_root(leaves: List[bytes]) -> bytes:
    if not leaves:
        return sha256(b"empty")

    level = leaves[:]
    while len(level) > 1:
        next_level = []
        for i in range(0, len(level), 2):
            left = level[i]
            right = level[i + 1] if i + 1 < len(level) else level[i]
            next_level.append(hash_pair(left, right))
        level = next_level

    return level[0]
