/**
 * ZK-Rollup Sequencer
 * 
 * Отвечает за:
 * 1. Сбор транзакций от пользователей
 * 2. Формирование batch'ей
 * 3. Обновление Merkle Tree состояния
 * 4. Генерацию ZK-proof
 * 5. Отправку proof на L1
 */

const { ethers } = require('ethers');
const { groth16 } = require('snarkjs');
const circomlib = require('circomlibjs');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Конфигурация
// ============================================================================

const CONFIG = {
    BATCH_SIZE: 4,              // Количество транзакций в batch
    TREE_DEPTH: 10,             // Глубина Merkle дерева
    L1_CONTRACT_ADDRESS: process.env.L1_CONTRACT_ADDRESS,
    RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
    CIRCUIT_PATH: path.join(__dirname, '../circuits/rollup_js/rollup.wasm'),
    ZKEY_PATH: path.join(__dirname, '../circuits/rollup_0001.zkey'),
    STATE_FILE: path.join(__dirname, 'state.json')
};

// ============================================================================
// Merkle Tree с Poseidon (совместим с circuit)
// ============================================================================

class PoseidonMerkleTree {
    constructor(depth = 10) {
        this.depth = depth;
        this.leaves = new Map(); // address -> {balance, leafHash, index}
        this.tree = [];
        this.poseidon = null;
    }

    async init() {
        this.poseidon = await circomlib.buildPoseidon();
    }

    /**
     * Хеширование листа: Poseidon(address, balance)
     * Адрес преобразуется в числовой идентификатор
     */
    async hashLeaf(address, balance) {
        // Преобразуем адрес в числовой идентификатор
        // Для простоты используем простую хеш-функцию на основе строки
        let addressBigInt;
        try {
            // Пробуем преобразовать адрес напрямую (если это hex число)
            if (address.startsWith('0x')) {
                // Убираем 0x и пробуем как hex
                const hexPart = address.slice(2);
                if (/^[0-9a-fA-F]+$/.test(hexPart)) {
                    addressBigInt = BigInt(address);
                } else {
                    // Если не валидный hex, используем простой hash строки
                    addressBigInt = this._simpleHash(address.toLowerCase());
                }
            } else {
                // Если не hex, используем простой hash
                addressBigInt = this._simpleHash(address.toLowerCase());
            }
        } catch (e) {
            // Fallback: простой hash
            addressBigInt = this._simpleHash(address.toLowerCase());
        }
        
        const balanceBigInt = BigInt(balance);
        const hash = this.poseidon([addressBigInt, balanceBigInt]);
        
        // Логируем тип hash для отладки
        console.log(`[hashLeaf] hash type: ${typeof hash}, value:`, hash);
        
        // Poseidon возвращает BigInt напрямую
        // Проверяем тип и преобразуем правильно
        let hashBigInt;
        if (typeof hash === 'bigint') {
            hashBigInt = hash;
        } else if (Array.isArray(hash)) {
            // Если массив, берем первый элемент
            hashBigInt = BigInt(hash[0] || 0);
        } else {
            // Если строка с запятыми (массив байтов в виде строки), убираем запятые
            const hashStr = String(hash);
            console.log(`[hashLeaf] hashStr: ${hashStr}`);
            if (hashStr.includes(',')) {
                // Это массив байтов в виде строки, преобразуем правильно
                const bytes = hashStr.split(',').map(b => parseInt(b.trim()));
                // Преобразуем массив байтов в BigInt (big-endian)
                hashBigInt = bytes.reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
            } else {
                hashBigInt = BigInt(hashStr);
            }
        }
        
        // Преобразуем в hex строку (убираем отрицательный знак если есть)
        const absHash = hashBigInt >= 0n ? hashBigInt : -hashBigInt;
        const hexStr = absHash.toString(16);
        const result = '0x' + hexStr;
        console.log(`[hashLeaf] result: ${result}`);
        return result;
    }

    /**
     * Простая хеш-функция для строки (для демо)
     */
    _simpleHash(str) {
        let hash = 0n;
        for (let i = 0; i < str.length; i++) {
            const char = BigInt(str.charCodeAt(i));
            hash = ((hash << 5n) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Убеждаемся, что результат положительный
        return hash < 0n ? -hash : hash;
    }

    /**
     * Хеширование пары узлов: Poseidon(left, right)
     */
    async hashPair(left, right) {
        // Преобразуем строки в BigInt
        let leftBigInt, rightBigInt;
        
        if (left === "0" || left === 0) {
            leftBigInt = BigInt(0);
        } else if (typeof left === 'string') {
            // Если строка начинается с 0x, это hex
            if (left.startsWith('0x')) {
                leftBigInt = BigInt(left);
            } else {
                // Иначе пробуем как число
                leftBigInt = BigInt(left);
            }
        } else {
            leftBigInt = BigInt(left);
        }
        
        if (right === "0" || right === 0) {
            rightBigInt = BigInt(0);
        } else if (typeof right === 'string') {
            if (right.startsWith('0x')) {
                rightBigInt = BigInt(right);
            } else {
                rightBigInt = BigInt(right);
            }
        } else {
            rightBigInt = BigInt(right);
        }
        
        const hash = this.poseidon([leftBigInt, rightBigInt]);
        
        // Poseidon возвращает BigInt напрямую
        // Проверяем тип и преобразуем правильно
        let hashBigInt;
        if (typeof hash === 'bigint') {
            hashBigInt = hash;
        } else if (Array.isArray(hash)) {
            // Если массив, берем первый элемент
            hashBigInt = BigInt(hash[0] || 0);
        } else {
            // Если строка с запятыми (массив байтов в виде строки), убираем запятые
            const hashStr = String(hash);
            if (hashStr.includes(',')) {
                // Это массив байтов в виде строки, преобразуем правильно
                const bytes = hashStr.split(',').map(b => parseInt(b.trim()));
                // Преобразуем массив байтов в BigInt (big-endian)
                hashBigInt = bytes.reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
            } else {
                hashBigInt = BigInt(hashStr);
            }
        }
        
        // Преобразуем в hex строку (убираем отрицательный знак если есть)
        const absHash = hashBigInt >= 0n ? hashBigInt : -hashBigInt;
        const hexStr = absHash.toString(16);
        return '0x' + hexStr;
    }

    /**
     * Добавление/обновление аккаунта
     */
    async updateAccount(address, balance) {
        try {
            console.log(`[updateAccount] Updating ${address} with balance ${balance}`);
            const leafHash = await this.hashLeaf(address, balance);
            console.log(`[updateAccount] Leaf hash = ${leafHash}`);
            this.leaves.set(address.toLowerCase(), {
                balance: balance,
                leafHash: leafHash,
                index: this.leaves.size
            });
            console.log(`[updateAccount] Total leaves: ${this.leaves.size}`);
            await this.rebuildTree();
        } catch (error) {
            console.error(`[updateAccount] Error for ${address}:`, error);
            throw error;
        }
    }

    /**
     * Получение баланса аккаунта
     */
    getBalance(address) {
        const account = this.leaves.get(address.toLowerCase());
        return account ? account.balance : 0;
    }

    /**
     * Генерация Merkle proof для аккаунта
     */
    async getProof(address) {
        const account = this.leaves.get(address.toLowerCase());
        if (!account) {
            throw new Error(`Account ${address} not found`);
        }

        const proof = {
            leaf: account.leafHash,
            pathElements: [],
            pathIndices: [],
            root: this.getRoot()
        };

        // Упрощенная реализация - в production используйте правильный алгоритм
        // Для тестирования заполняем нулями
        for (let i = 0; i < this.depth; i++) {
            proof.pathElements.push("0");
            proof.pathIndices.push(0);
        }

        return proof;
    }

    /**
     * Пересборка дерева
     */
    async rebuildTree() {
        try {
            // Упрощенная реализация
            // В production используйте эффективную структуру данных
            const leaves = Array.from(this.leaves.values()).map(a => a.leafHash);
            
            console.log(`[rebuildTree] Leaves count: ${leaves.length}`);
            
            if (leaves.length === 0) {
                this.root = "0x0";
                console.log('[rebuildTree] No leaves, root = 0x0');
                return;
            }

            // Если только один лист, используем его как корень
            if (leaves.length === 1) {
                // Для одного листа создаем пару с нулем
                const zeroHash = "0x0";
                console.log(`[rebuildTree] Single leaf, hashing with zero`);
                this.root = await this.hashPair(leaves[0], zeroHash);
                console.log(`[rebuildTree] Root = ${this.root}`);
                return;
            }

            // Заполняем до степени двойки листов нулями
            let nextPowerOfTwo = 1;
            while (nextPowerOfTwo < leaves.length) {
                nextPowerOfTwo *= 2;
            }
            while (leaves.length < nextPowerOfTwo) {
                leaves.push("0x0"); // Используем hex формат для консистентности
            }

            console.log(`[rebuildTree] Building tree with ${leaves.length} leaves`);

            // Строим дерево снизу вверх
            let level = leaves;
            let depth = 0;
            while (level.length > 1) {
                const nextLevel = [];
                for (let i = 0; i < level.length; i += 2) {
                    const left = level[i];
                    const right = level[i + 1] || level[i];
                    const hash = await this.hashPair(left, right);
                    nextLevel.push(hash);
                }
                level = nextLevel;
                depth++;
                console.log(`[rebuildTree] Level ${depth}: ${level.length} nodes`);
            }

            this.root = level[0];
            console.log(`[rebuildTree] Final root = ${this.root}`);
        } catch (error) {
            console.error('[rebuildTree] Error:', error);
            this.root = "0x0";
            throw error;
        }
    }

    /**
     * Получение корня дерева
     */
    getRoot() {
        return this.root || "0x0";
    }
}

// ============================================================================
// Sequencer
// ============================================================================

class Sequencer {
    constructor(config) {
        this.config = config;
        this.tree = new PoseidonMerkleTree(config.TREE_DEPTH);
        this.pendingTxs = [];
        this.provider = null;
        this.rollupContract = null;
        this.batchCallbacks = []; // Callbacks для уведомления о batch'ах
    }

    /**
     * Регистрация callback для уведомления о batch'ах
     */
    onBatchProcessed(callback) {
        this.batchCallbacks.push(callback);
    }

    /**
     * Инициализация sequencer
     */
    async init() {
        console.log('Initializing Sequencer...');
        
        // Инициализация Merkle Tree
        await this.tree.init();
        
        // Загрузка состояния
        await this.loadState();
        
        // Подключение к L1 (опционально, для демо может быть отключено)
        try {
            if (this.config.RPC_URL && this.config.L1_CONTRACT_ADDRESS && process.env.PRIVATE_KEY) {
                this.provider = new ethers.JsonRpcProvider(this.config.RPC_URL);
                
                // Проверка доступности RPC
                try {
                    await this.provider.getBlockNumber();
                    console.log('✅ Connected to L1 RPC:', this.config.RPC_URL);
                } catch (rpcError) {
                    console.warn('⚠️  L1 RPC not available:', rpcError.message);
                    console.warn('⚠️  Server will run in demo mode (without L1 submission)');
                    this.provider = null;
                    this.rollupContract = null;
                }
                
                if (this.provider) {
                    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
                    
                    const abi = [
                        "function submitBatchSimple(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256 oldRoot, uint256 newRoot) external"
                    ];
                    this.rollupContract = new ethers.Contract(
                        this.config.L1_CONTRACT_ADDRESS,
                        abi,
                        signer
                    );
                    console.log('✅ L1 Contract connected:', this.config.L1_CONTRACT_ADDRESS);
                }
            } else {
                console.warn('⚠️  L1 configuration missing (RPC_URL, L1_CONTRACT_ADDRESS, or PRIVATE_KEY)');
                console.warn('⚠️  Server will run in demo mode (without L1 submission)');
            }
        } catch (error) {
            console.warn('⚠️  Failed to connect to L1:', error.message);
            console.warn('⚠️  Server will run in demo mode (without L1 submission)');
            this.provider = null;
            this.rollupContract = null;
        }
        
        console.log('Sequencer initialized');
        console.log('Current Merkle Root:', this.tree.getRoot());
    }

    /**
     * Добавление транзакции в очередь
     */
    async addTransaction(tx) {
        // Валидация транзакции
        const balance = this.tree.getBalance(tx.from);
        if (balance < tx.amount) {
            throw new Error(`Insufficient balance: ${tx.from} has ${balance}, needs ${tx.amount}`);
        }

        this.pendingTxs.push(tx);
        console.log(`Transaction added: ${tx.from} -> ${tx.to}: ${tx.amount}`);

        // Если набралось достаточно транзакций, обрабатываем batch
        if (this.pendingTxs.length >= this.config.BATCH_SIZE) {
            await this.processBatch();
        }
    }

    /**
     * Обработка batch транзакций
     */
    async processBatch() {
        if (this.pendingTxs.length === 0) {
            return;
        }

        try {
            console.log(`\n=== Processing Batch (${this.pendingTxs.length} transactions) ===`);

            // 1. Сохраняем старое состояние
            const oldRoot = this.tree.getRoot();
            console.log('Old Root:', oldRoot);

            // 2. Применяем транзакции к состоянию
            const batch = this.pendingTxs.splice(0, this.config.BATCH_SIZE);
            console.log(`Applying ${batch.length} transactions...`);
            await this.applyTransactions(batch);

            // 3. Получаем новое состояние
            await this.tree.rebuildTree();
            const newRoot = this.tree.getRoot();
            console.log('New Root:', newRoot);

            // 4. Генерируем ZK-proof (может упасть, поэтому в try-catch)
            let proof = null;
            let publicSignals = null;
            try {
                console.log('Generating ZK-proof...');
                const proofResult = await this.generateProof(batch, oldRoot, newRoot);
                proof = proofResult.proof;
                publicSignals = proofResult.publicSignals;
                console.log('✅ ZK-proof generated');
            } catch (proofError) {
                console.error('⚠️  ZK-proof generation failed:', proofError.message);
                console.log('⚠️  Continuing without proof (demo mode)');
            }

            // 5. Отправляем на L1 (если подключен и proof есть)
            if (this.rollupContract && proof) {
                try {
                    console.log('Submitting to L1...');
                    await this.submitToL1(proof, publicSignals, oldRoot, newRoot);
                } catch (l1Error) {
                    console.error('⚠️  L1 submission failed:', l1Error.message);
                }
            } else {
                if (!proof) {
                    console.log('⚠️  Skipping L1 submission (no proof)');
                } else {
                    console.log('⚠️  L1 not connected, skipping submission (demo mode)');
                }
                console.log('📝 Batch processed:');
                console.log('   Old Root:', oldRoot);
                console.log('   New Root:', newRoot);
            }

            // 6. Сохраняем состояние
            await this.saveState();

            // 7. Уведомляем о batch (даже если proof не сгенерирован)
            const batchInfo = {
                transactions: batch,
                oldRoot: oldRoot,
                newRoot: newRoot,
                proof: proof ? { generated: true } : null,
                publicSignals: publicSignals,
                timestamp: new Date().toISOString()
            };

            // Вызываем все callbacks
            for (const callback of this.batchCallbacks) {
                try {
                    await callback(batchInfo);
                } catch (error) {
                    console.error('Error in batch callback:', error);
                }
            }

            console.log('✅ Batch processed successfully!\n');
        } catch (error) {
            console.error('❌ Error processing batch:', error);
            console.error(error.stack);
            throw error; // Пробрасываем ошибку дальше
        }
    }

    /**
     * Применение транзакций к состоянию
     */
    async applyTransactions(batch) {
        for (const tx of batch) {
            const fromBalance = this.tree.getBalance(tx.from);
            const toBalance = this.tree.getBalance(tx.to);

            // Обновляем балансы
            await this.tree.updateAccount(tx.from, fromBalance - tx.amount);
            await this.tree.updateAccount(tx.to, toBalance + tx.amount);
        }
    }

    /**
     * Генерация ZK-proof для batch
     */
    async generateProof(batch, oldRoot, newRoot) {
        // 1. Подготовка входных данных для circuit
        const input = await this.prepareCircuitInput(batch, oldRoot, newRoot);

        // 2. Генерация witness
        const witness = await this.generateWitness(input);

        // 3. Генерация proof
        const { proof, publicSignals } = await groth16.prove(
            this.config.ZKEY_PATH,
            witness
        );

        return { proof, publicSignals };
    }

    /**
     * Подготовка входных данных для circuit
     */
    async prepareCircuitInput(batch, oldRoot, newRoot) {
        const input = {
            oldMerkleRoot: oldRoot,
            newMerkleRoot: newRoot,
            transactions: [],
            addresses: [],
            oldBalances: [],
            newBalances: [],
            oldProofs: [],
            oldProofIndices: [],
            newProofs: [],
            newProofIndices: []
        };

        // Заполняем данные для каждой транзакции
        for (const tx of batch) {
            // Транзакция
            input.transactions.push([
                tx.from,
                tx.to,
                tx.amount.toString()
            ]);

            // Адреса
            input.addresses.push(tx.from);
            input.addresses.push(tx.to);

            // Старые балансы (до транзакции)
            const oldFromBalance = this.tree.getBalance(tx.from) + tx.amount; // Восстанавливаем
            const oldToBalance = this.tree.getBalance(tx.to) - tx.amount; // Восстанавливаем
            input.oldBalances.push(oldFromBalance.toString());
            input.oldBalances.push(oldToBalance.toString());

            // Новые балансы (после транзакции)
            input.newBalances.push(this.tree.getBalance(tx.from).toString());
            input.newBalances.push(this.tree.getBalance(tx.to).toString());

            // Merkle proofs (упрощенные для тестирования)
            const oldProof = await this.tree.getProof(tx.from);
            const oldProofTo = await this.tree.getProof(tx.to);
            input.oldProofs.push(oldProof.pathElements);
            input.oldProofs.push(oldProofTo.pathElements);
            input.oldProofIndices.push(oldProof.pathIndices);
            input.oldProofIndices.push(oldProofTo.pathIndices);

            const newProof = await this.tree.getProof(tx.from);
            const newProofTo = await this.tree.getProof(tx.to);
            input.newProofs.push(newProof.pathElements);
            input.newProofs.push(newProofTo.pathElements);
            input.newProofIndices.push(newProof.pathIndices);
            input.newProofIndices.push(newProofTo.pathIndices);
        }

        return input;
    }

    /**
     * Генерация witness
     */
    async generateWitness(input) {
        const { execSync } = require('child_process');
        const { tmpdir } = require('os');
        const path = require('path');

        // Сохраняем input во временный файл
        const inputFile = path.join(tmpdir(), `input_${Date.now()}.json`);
        const witnessFile = path.join(tmpdir(), `witness_${Date.now()}.wtns`);

        fs.writeFileSync(inputFile, JSON.stringify(input));

        // Генерируем witness
        const generateWitnessPath = path.join(__dirname, '../circuits/rollup_js/generate_witness.js');
        const wasmPath = path.join(__dirname, '../circuits/rollup_js/rollup.wasm');
        
        try {
            execSync(`node ${generateWitnessPath} ${wasmPath} ${inputFile} ${witnessFile}`, {
                stdio: 'inherit'
            });

            // Читаем witness
            const witness = fs.readFileSync(witnessFile);

            // Удаляем временные файлы
            fs.unlinkSync(inputFile);
            fs.unlinkSync(witnessFile);

            return witness;
        } catch (error) {
            // Очистка в случае ошибки
            if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
            if (fs.existsSync(witnessFile)) fs.unlinkSync(witnessFile);
            throw error;
        }
    }

    /**
     * Отправка proof на L1
     */
    async submitToL1(proof, publicSignals, oldRoot, newRoot) {
        if (!this.rollupContract) {
            console.warn('⚠️  L1 contract not connected. Skipping L1 submission (demo mode)');
            console.log('📝 Proof generated (would be submitted to L1):');
            console.log('   Old Root:', publicSignals[0]);
            console.log('   New Root:', publicSignals[1]);
            return { demo: true, message: 'L1 not connected, running in demo mode' };
        }

        try {
            const tx = await this.rollupContract.submitBatchSimple(
                [proof.pi_a[0], proof.pi_a[1]],
                [
                    [proof.pi_b[0][0], proof.pi_b[0][1]],
                    [proof.pi_b[1][0], proof.pi_b[1][1]]
                ],
                [proof.pi_c[0], proof.pi_c[1]],
                publicSignals[0],  // oldRoot
                publicSignals[1]   // newRoot
            );

            console.log('✅ Transaction hash:', tx.hash);
            const receipt = await tx.wait();
            console.log('✅ Block number:', receipt.blockNumber);
            console.log('✅ Gas used:', receipt.gasUsed.toString());
            return { txHash: tx.hash, blockNumber: receipt.blockNumber };
        } catch (error) {
            console.error('❌ Failed to submit to L1:', error.message);
            throw error;
        }
    }

    /**
     * Загрузка состояния
     */
    async loadState() {
        if (fs.existsSync(this.config.STATE_FILE)) {
            const state = JSON.parse(fs.readFileSync(this.config.STATE_FILE));
            // Восстанавливаем состояние Merkle Tree
            for (const [address, account] of Object.entries(state.accounts)) {
                await this.tree.updateAccount(address, account.balance);
            }
            console.log('State loaded from', this.config.STATE_FILE);
        }
    }

    /**
     * Сохранение состояния
     */
    async saveState() {
        const state = {
            merkleRoot: this.tree.getRoot(),
            accounts: {}
        };

        for (const [address, account] of this.tree.leaves) {
            state.accounts[address] = {
                balance: account.balance
            };
        }

        fs.writeFileSync(this.config.STATE_FILE, JSON.stringify(state, null, 2));
    }
}

// ============================================================================
// Экспорт
// ============================================================================

module.exports = { Sequencer, PoseidonMerkleTree };

// ============================================================================
// Пример использования
// ============================================================================

if (require.main === module) {
    (async () => {
        const sequencer = new Sequencer(CONFIG);
        await sequencer.init();

        // Пример транзакций
        const txs = [
            { from: "0x123", to: "0x456", amount: 100 },
            { from: "0x456", to: "0x789", amount: 50 },
            { from: "0x789", to: "0xabc", amount: 25 },
            { from: "0xabc", to: "0xdef", amount: 10 }
        ];

        for (const tx of txs) {
            await sequencer.addTransaction(tx);
        }
    })();
}

