// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./RollupVerifier.sol";

/**
 * @title RollupContract
 * @notice Layer-1 контракт для ZK-Rollup
 * @dev Принимает batch транзакций с ZK-proof и обновляет состояние
 */
contract RollupContract {
    // ============================================================================
    // Структуры
    // ============================================================================
    
    struct BatchProof {
        uint256[2] a;          // pi_a (G1 point)
        uint256[2][2] b;       // pi_b (G2 point)
        uint256[2] c;          // pi_c (G1 point)
        uint256[2] publicSignals; // [oldMerkleRoot, newMerkleRoot]
    }
    
    // ============================================================================
    // State Variables
    // ============================================================================
    
    RollupVerifier public immutable verifier;
    
    // Текущий корень Merkle дерева состояния
    uint256 public currentMerkleRoot;
    
    // Счетчик batch'ей
    uint256 public batchCount;
    
    // Mapping для хранения истории batch'ей
    mapping(uint256 => uint256) public batchRoots; // batchId => merkleRoot
    
    // События
    event BatchSubmitted(uint256 indexed batchId, uint256 oldRoot, uint256 newRoot);
    event StateUpdated(uint256 indexed batchId, uint256 newRoot);
    
    // ============================================================================
    // Modifiers
    // ============================================================================
    
    
    // ============================================================================
    // Constructor
    // ============================================================================
    
    constructor(address _verifier, uint256 _initialRoot) {
        verifier = RollupVerifier(_verifier);
        currentMerkleRoot = _initialRoot;
        batchCount = 0;
    }
    
    // ============================================================================
    // Основные функции
    // ============================================================================
    
    /**
     * @notice Submit batch транзакций с ZK-proof
     * @param proof Groth16 proof структура
     * @param oldRoot Старый корень Merkle дерева (должен совпадать с currentMerkleRoot)
     * @param newRoot Новый корень Merkle дерева после обработки batch
     * 
     * Процесс:
     * 1. Проверяем, что oldRoot совпадает с currentMerkleRoot
     * 2. Верифицируем ZK-proof
     * 3. Обновляем currentMerkleRoot на newRoot
     * 4. Сохраняем batch в историю
     */
    /**
     * @notice Внутренняя функция для обработки batch
     * @dev Выполняет все проверки и обновляет состояние
     */
    function _submitBatch(
        BatchProof memory proof,
        uint256 oldRoot,
        uint256 newRoot
    ) internal {
        // Проверка согласованности корней
        require(
            oldRoot == currentMerkleRoot,
            "Old root does not match current state"
        );
        
        // Проверка, что public signals совпадают с переданными корнями
        require(
            proof.publicSignals[0] == oldRoot,
            "Proof oldRoot mismatch"
        );
        require(
            proof.publicSignals[1] == newRoot,
            "Proof newRoot mismatch"
        );
        
        // Верификация proof
        require(
            verifier.verifyProof(proof.a, proof.b, proof.c, proof.publicSignals),
            "Invalid ZK proof"
        );
        
        // Обновление состояния
        uint256 batchId = batchCount;
        currentMerkleRoot = newRoot;
        batchRoots[batchId] = newRoot;
        batchCount++;
        
        emit BatchSubmitted(batchId, oldRoot, newRoot);
        emit StateUpdated(batchId, newRoot);
    }
    
    /**
     * @notice Submit batch с полной структурой proof
     * @param proof Groth16 proof структура
     * @param oldRoot Старый корень Merkle дерева
     * @param newRoot Новый корень Merkle дерева после обработки batch
     */
    function submitBatch(
        BatchProof memory proof,
        uint256 oldRoot,
        uint256 newRoot
    ) external {
        _submitBatch(proof, oldRoot, newRoot);
    }
    
    /**
     * @notice Упрощенная функция submit с явными параметрами proof
     * @dev Используется для удобства вызова из фронтенда
     */
    function submitBatchSimple(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256 oldRoot,
        uint256 newRoot
    ) external {
        BatchProof memory proof = BatchProof({
            a: a,
            b: b,
            c: c,
            publicSignals: [oldRoot, newRoot]
        });
        
        _submitBatch(proof, oldRoot, newRoot);
    }
    
    /**
     * @notice Получить текущий корень Merkle дерева
     */
    function getCurrentRoot() external view returns (uint256) {
        return currentMerkleRoot;
    }
    
    /**
     * @notice Получить корень для конкретного batch
     */
    function getBatchRoot(uint256 batchId) external view returns (uint256) {
        return batchRoots[batchId];
    }
    
    /**
     * @notice Проверка валидности proof без обновления состояния
     * @dev Полезно для off-chain проверки перед submit
     */
    function verifyProofOnly(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory publicSignals
    ) external view returns (bool) {
        return verifier.verifyProof(a, b, c, publicSignals);
    }
}

