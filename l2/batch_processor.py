from dataclasses import dataclass
from typing import Dict, List

from merkle_tree import hash_leaf, merkle_root


@dataclass
class Tx:
    sender: str
    receiver: str
    amount: int


def apply_batch(state: Dict[str, int], txs: List[Tx]) -> Dict[str, int]:
    new_state = dict(state)

    for tx in txs:
        s = tx.sender.lower()
        r = tx.receiver.lower()
        a = tx.amount

        if new_state.get(s, 0) < a:
            raise ValueError("Not enough balance")

        new_state[s] -= a
        new_state[r] = new_state.get(r, 0) + a

    return new_state


def compute_root(state: Dict[str, int]) -> str:
    leaves = []
    for addr in sorted(state.keys()):
        leaves.append(hash_leaf(addr, state[addr]))

    root = merkle_root(leaves)
    return "0x" + root.hex()
