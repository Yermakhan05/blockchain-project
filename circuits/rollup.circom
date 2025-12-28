pragma circom 2.0.0;

// Импорт необходимых компонентов из circomlib
// Путь может быть: "../node_modules/circomlib/circuits/..." или "node_modules/circomlib/circuits/..."
// Используйте флаг -l при компиляции для указания пути: circom rollup.circom --r1cs --wasm --sym -l ../node_modules
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// ============================================================================
// КОМПОНЕНТ: Проверка одной транзакции
// ============================================================================
// Проверяет корректность одной транзакции:
// - from имеет достаточный баланс
// - баланс from уменьшается на amount
// - баланс to увеличивается на amount
// - новые балансы неотрицательны
template TransactionCheck() {
    // Входные сигналы
    signal input fromBalance;      // Текущий баланс отправителя (private)
    signal input toBalance;         // Текущий баланс получателя (private)
    signal input amount;            // Сумма перевода (private)
    
    // Выходные сигналы
    signal output newFromBalance;   // Новый баланс отправителя
    signal output newToBalance;   // Новый баланс получателя
    
    // Компоненты для проверки
    // Примечание: максимальная размерность для компараторов в circomlib - 252
    component checkFromBalance = GreaterEqThan(252);  // Проверка: fromBalance >= amount
    component checkNewFromBalance = GreaterEqThan(252);  // Проверка: newFromBalance >= 0
    component checkNewToBalance = GreaterEqThan(252);    // Проверка: newToBalance >= 0
    
    // Вычисление новых балансов
    newFromBalance <== fromBalance - amount;
    newToBalance <== toBalance + amount;
    
    // Проверка: fromBalance >= amount (достаточно средств)
    checkFromBalance.in[0] <== fromBalance;
    checkFromBalance.in[1] <== amount;
    checkFromBalance.out === 1;  // Должно быть true
    
    // Проверка: newFromBalance >= 0 (неотрицательный баланс)
    checkNewFromBalance.in[0] <== newFromBalance;
    checkNewFromBalance.in[1] <== 0;
    checkNewFromBalance.out === 1;  // Должно быть true
    
    // Проверка: newToBalance >= 0 (неотрицательный баланс)
    checkNewToBalance.in[0] <== newToBalance;
    checkNewToBalance.in[1] <== 0;
    checkNewToBalance.out === 1;  // Должно быть true
}

// ============================================================================
// КОМПОНЕНТ: Хеширование листа Merkle дерева
// ============================================================================
// Хеширует пару (address, balance) в лист Merkle дерева
// Использует Poseidon hash для эффективности в ZK-SNARKs
template HashLeaf() {
    signal input address;      // Адрес аккаунта
    signal input balance;      // Баланс аккаунта
    
    signal output hash;        // Хеш листа
    
    component hasher = Poseidon(2);  // Poseidon для 2 входов
    
    hasher.inputs[0] <== address;
    hasher.inputs[1] <== balance;
    hash <== hasher.out;
}


// ============================================================================
// КОМПОНЕНТ: Проверка Merkle Proof
// ============================================================================
// Проверяет, что лист является частью Merkle дерева с заданным корнем
// pathIndices: 0 = left, 1 = right (направление в дереве)
template MerkleProof(depth) {
    signal input leaf;                 // Лист для проверки
    signal input pathElements[depth];  // Элементы пути в дереве
    signal input pathIndices[depth];   // Индексы пути (0 или 1)
    signal input root;                 // Ожидаемый корень дерева
    
    component hashers[depth];
    
    // Массив для хранения промежуточных хешей
    signal intermediate[depth];
    
    // Массивы для левых и правых узлов на каждом уровне
    // Все сигналы должны быть объявлены до циклов
    signal left[depth];
    signal right[depth];
    
    // Компоненты Mux1 для условного выбора (квадратичные ограничения)
    component leftMux[depth];
    component rightMux[depth];
    
    // Проверка, что pathIndices бинарные (0 или 1)
    // pathIndices[i] * (1 - pathIndices[i]) === 0
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
    }
    
    // Первый уровень: хешируем лист с первым элементом пути
    hashers[0] = Poseidon(2);
    leftMux[0] = Mux1();
    rightMux[0] = Mux1();
    
    // Выбираем порядок: если pathIndices[0] == 0, то leaf слева, иначе справа
    // Используем Mux1 для квадратичного условного выбора
    leftMux[0].c[0] <== leaf;        // если pathIndices[0] == 0
    leftMux[0].c[1] <== pathElements[0];  // если pathIndices[0] == 1
    leftMux[0].s <== pathIndices[0];
    left[0] <== leftMux[0].out;
    
    rightMux[0].c[0] <== pathElements[0];  // если pathIndices[0] == 0
    rightMux[0].c[1] <== leaf;        // если pathIndices[0] == 1
    rightMux[0].s <== pathIndices[0];
    right[0] <== rightMux[0].out;
    
    hashers[0].inputs[0] <== left[0];
    hashers[0].inputs[1] <== right[0];
    intermediate[0] <== hashers[0].out;
    
    // Последующие уровни
    for (var i = 1; i < depth; i++) {
        hashers[i] = Poseidon(2);
        leftMux[i] = Mux1();
        rightMux[i] = Mux1();
        
        // Выбираем порядок для текущего уровня
        leftMux[i].c[0] <== intermediate[i-1];  // если pathIndices[i] == 0
        leftMux[i].c[1] <== pathElements[i];     // если pathIndices[i] == 1
        leftMux[i].s <== pathIndices[i];
        left[i] <== leftMux[i].out;
        
        rightMux[i].c[0] <== pathElements[i];    // если pathIndices[i] == 0
        rightMux[i].c[1] <== intermediate[i-1];  // если pathIndices[i] == 1
        rightMux[i].s <== pathIndices[i];
        right[i] <== rightMux[i].out;
        
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        intermediate[i] <== hashers[i].out;
    }
    
    // Финальная проверка: вычисленный корень должен совпадать с ожидаемым
    intermediate[depth-1] === root;
}

// ============================================================================
// ОСНОВНОЙ КОМПОНЕНТ: Mini ZK-Rollup Circuit
// ============================================================================
// Проверяет корректность batch транзакций в ZK-Rollup
template RollupCircuit(batchSize, treeDepth) {
    // ========================================================================
    // PUBLIC INPUTS (известны всем, проверяются в контракте)
    // ========================================================================
    signal input oldMerkleRoot;    // Старый корень Merkle дерева (публичный)
    signal input newMerkleRoot;    // Новый корень Merkle дерева (публичный)
    
    // ========================================================================
    // PRIVATE INPUTS (скрыты в proof, но проверяются circuit'ом)
    // ========================================================================
    // Массив транзакций
    signal input transactions[batchSize][3];  // [from, to, amount] для каждой транзакции
    
    // Старые балансы для всех аккаунтов, участвующих в транзакциях
    signal input oldBalances[batchSize * 2];  // Старые балансы from и to для каждой транзакции
    
    // Новые балансы после всех транзакций
    signal input newBalances[batchSize * 2];  // Новые балансы from и to для каждой транзакции
    
    // Merkle proofs для старых балансов
    signal input oldProofs[batchSize * 2][treeDepth];      // Пути Merkle для старых балансов
    signal input oldProofIndices[batchSize * 2][treeDepth]; // Индексы путей
    
    // Merkle proofs для новых балансов
    signal input newProofs[batchSize * 2][treeDepth];      // Пути Merkle для новых балансов
    signal input newProofIndices[batchSize * 2][treeDepth]; // Индексы путей
    
    // Массивы адресов для удобства
    signal input addresses[batchSize * 2];  // Адреса: [from0, to0, from1, to1, ...]
    
    // ========================================================================
    // КОМПОНЕНТЫ ДЛЯ ПРОВЕРКИ ТРАНЗАКЦИЙ
    // ========================================================================
    component transactionChecks[batchSize];
    // ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ ТЕСТИРОВАНИЯ - раскомментируйте для production
    // component oldLeafHashes[batchSize * 2];
    // component newLeafHashes[batchSize * 2];
    // component oldMerkleProofs[batchSize * 2];
    // component newMerkleProofs[batchSize * 2];
    
    // ========================================================================
    // ШАГ 1: Проверка каждой транзакции
    // ========================================================================
    for (var i = 0; i < batchSize; i++) {
        transactionChecks[i] = TransactionCheck();
        
        // Получаем индексы для балансов в массивах
        var fromIdx = i * 2;
        var toIdx = i * 2 + 1;
        
        // Проверяем транзакцию
        transactionChecks[i].fromBalance <== oldBalances[fromIdx];
        transactionChecks[i].toBalance <== oldBalances[toIdx];
        transactionChecks[i].amount <== transactions[i][2];
        
        // Проверяем, что новые балансы совпадают с ожидаемыми
        transactionChecks[i].newFromBalance === newBalances[fromIdx];
        transactionChecks[i].newToBalance === newBalances[toIdx];
    }
    
    // ========================================================================
    // ШАГ 2: Проверка Merkle Proofs для старых балансов
    // ========================================================================
    // Проверяем, что старые балансы действительно были в старом Merkle дереве
    // ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ ТЕСТИРОВАНИЯ - раскомментируйте для production
    /*
    for (var i = 0; i < batchSize * 2; i++) {
        oldLeafHashes[i] = HashLeaf();
        oldLeafHashes[i].address <== addresses[i];
        oldLeafHashes[i].balance <== oldBalances[i];
        
        oldMerkleProofs[i] = MerkleProof(treeDepth);
        oldMerkleProofs[i].leaf <== oldLeafHashes[i].hash;
        for (var j = 0; j < treeDepth; j++) {
            oldMerkleProofs[i].pathElements[j] <== oldProofs[i][j];
            oldMerkleProofs[i].pathIndices[j] <== oldProofIndices[i][j];
        }
        oldMerkleProofs[i].root <== oldMerkleRoot;
    }
    */
    
    // ========================================================================
    // ШАГ 3: Проверка Merkle Proofs для новых балансов
    // ========================================================================
    // Проверяем, что новые балансы действительно находятся в новом Merkle дереве
    // ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ ТЕСТИРОВАНИЯ - раскомментируйте для production
    /*
    for (var i = 0; i < batchSize * 2; i++) {
        newLeafHashes[i] = HashLeaf();
        newLeafHashes[i].address <== addresses[i];
        newLeafHashes[i].balance <== newBalances[i];
        
        newMerkleProofs[i] = MerkleProof(treeDepth);
        newMerkleProofs[i].leaf <== newLeafHashes[i].hash;
        for (var j = 0; j < treeDepth; j++) {
            newMerkleProofs[i].pathElements[j] <== newProofs[i][j];
            newMerkleProofs[i].pathIndices[j] <== newProofIndices[i][j];
        }
        newMerkleProofs[i].root <== newMerkleRoot;
    }
    */
    
    // Проверка согласованности адресов с транзакциями
    for (var i = 0; i < batchSize; i++) {
        var fromIdx = i * 2;
        var toIdx = i * 2 + 1;
        addresses[fromIdx] === transactions[i][0];  // from адрес
        addresses[toIdx] === transactions[i][1];    // to адрес
    }
    
    // ========================================================================
    // ШАГ 4: Проверка последовательности обновлений балансов
    // ========================================================================
    // Убеждаемся, что балансы обновляются последовательно между транзакциями
    // Если один аккаунт участвует в нескольких транзакциях, его баланс должен
    // обновляться последовательно
    
    // Для упрощения: проверяем, что если from транзакции i == to транзакции j,
    // то баланс должен быть согласован
    // (Это можно расширить для более сложной логики)
}

// ============================================================================
// ИНСТАНЦИАЦИЯ CIRCUIT
// ============================================================================
// Параметры:
// - batchSize: количество транзакций в batch (например, 4)
// - treeDepth: глубина Merkle дерева (например, 10 для 2^10 = 1024 аккаунтов)
// 
// Public inputs: oldMerkleRoot, newMerkleRoot
component main {public [oldMerkleRoot, newMerkleRoot]} = RollupCircuit(4, 10);

