pragma circom 2.0.0;

// ВРЕМЕННАЯ ВЕРСИЯ ДЛЯ ТЕСТИРОВАНИЯ БЕЗ MERKLE PROOFS
// Используйте эту версию только для тестирования основной логики транзакций
// В production используйте rollup.circom с полными проверками Merkle proofs

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// ============================================================================
// КОМПОНЕНТ: Проверка одной транзакции
// ============================================================================
template TransactionCheck() {
    signal input fromBalance;
    signal input toBalance;
    signal input amount;
    
    signal output newFromBalance;
    signal output newToBalance;
    
    component checkFromBalance = GreaterEqThan(252);
    component checkNewFromBalance = GreaterEqThan(252);
    component checkNewToBalance = GreaterEqThan(252);
    
    newFromBalance <== fromBalance - amount;
    newToBalance <== toBalance + amount;
    
    checkFromBalance.in[0] <== fromBalance;
    checkFromBalance.in[1] <== amount;
    checkFromBalance.out === 1;
    
    checkNewFromBalance.in[0] <== newFromBalance;
    checkNewFromBalance.in[1] <== 0;
    checkNewFromBalance.out === 1;
    
    checkNewToBalance.in[0] <== newToBalance;
    checkNewToBalance.in[1] <== 0;
    checkNewToBalance.out === 1;
}

// ============================================================================
// УПРОЩЕННЫЙ ROLLUP CIRCUIT БЕЗ MERKLE PROOFS (ТОЛЬКО ДЛЯ ТЕСТИРОВАНИЯ)
// ============================================================================
template RollupCircuitTest(batchSize) {
    signal input oldMerkleRoot;
    signal input newMerkleRoot;
    
    signal input transactions[batchSize][3];
    signal input addresses[batchSize * 2];
    signal input oldBalances[batchSize * 2];
    signal input newBalances[batchSize * 2];
    
    component transactionChecks[batchSize];
    
    // Проверка транзакций
    for (var i = 0; i < batchSize; i++) {
        transactionChecks[i] = TransactionCheck();
        
        var fromIdx = i * 2;
        var toIdx = i * 2 + 1;
        
        transactionChecks[i].fromBalance <== oldBalances[fromIdx];
        transactionChecks[i].toBalance <== oldBalances[toIdx];
        transactionChecks[i].amount <== transactions[i][2];
        
        transactionChecks[i].newFromBalance === newBalances[fromIdx];
        transactionChecks[i].newToBalance === newBalances[toIdx];
    }
    
    // Проверка согласованности адресов
    for (var i = 0; i < batchSize; i++) {
        var fromIdx = i * 2;
        var toIdx = i * 2 + 1;
        addresses[fromIdx] === transactions[i][0];
        addresses[toIdx] === transactions[i][1];
    }
    
    // ВАЖНО: Merkle proofs НЕ проверяются в этой версии!
    // Это только для тестирования основной логики транзакций
}

component main {public [oldMerkleRoot, newMerkleRoot]} = RollupCircuitTest(4);

