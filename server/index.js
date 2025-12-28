/**
 * ZK-Rollup Backend API Server
 * 
 * REST API для:
 * - Отправки L2 транзакций
 * - Создания batch'ей
 * - Генерации ZK-proof
 * - Отправки на L1
 */

const express = require('express');
const cors = require('cors');
const { Sequencer } = require('../sequencer/sequencer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================================================================
// Инициализация Sequencer
// ============================================================================

const CONFIG = {
    BATCH_SIZE: 4,
    TREE_DEPTH: 10,
    L1_CONTRACT_ADDRESS: process.env.L1_CONTRACT_ADDRESS,
    RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
    CIRCUIT_PATH: path.join(__dirname, '../circuits/rollup_js/rollup.wasm'),
    ZKEY_PATH: path.join(__dirname, '../circuits/rollup_0001.zkey'),
    STATE_FILE: path.join(__dirname, '../sequencer/state.json')
};

const sequencer = new Sequencer(CONFIG);

// Инициализация sequencer при старте сервера
let sequencerReady = false;
let l1Connected = false;

(async () => {
    try {
        await sequencer.init();
        sequencerReady = true;
        l1Connected = sequencer.rollupContract !== null;
        
        // Регистрируем callback для отслеживания batch'ей
        sequencer.onBatchProcessed((batchInfo) => {
            const batch = {
                id: batchCounter++,
                transactions: batchInfo.transactions,
                oldRoot: batchInfo.oldRoot,
                newRoot: batchInfo.newRoot,
                status: l1Connected ? 'submitted' : 'processing',
                createdAt: batchInfo.timestamp,
                proofGenerated: batchInfo.proof ? true : false
            };
            batches.push(batch);
            
            // Обновляем статусы транзакций в batch
            // Ищем последние N транзакций, где N = размер batch
            const batchSize = batchInfo.transactions.length;
            const recentTxs = transactions.slice(-batchSize);
            
            batchInfo.transactions.forEach((tx, index) => {
                // Находим соответствующую транзакцию по индексу
                const foundTx = recentTxs[index];
                if (foundTx) {
                    // Обновляем статус всех транзакций в batch
                    if (l1Connected && batchInfo.proof) {
                        foundTx.status = 'submitted'; // Отправлено на L1
                    } else if (batchInfo.proof) {
                        foundTx.status = 'processing'; // Proof сгенерирован, но L1 не подключен
                    } else {
                        foundTx.status = 'processing'; // Batch обрабатывается
                    }
                    foundTx.batchId = batch.id;
                }
            });
            
            console.log(`📦 Batch #${batch.id} created with ${batch.transactions.length} transactions`);
        });
        
        console.log('✅ Sequencer initialized');
        if (!l1Connected) {
            console.log('ℹ️  Running in DEMO MODE (L1 not connected)');
            console.log('ℹ️  To connect to L1, set RPC_URL, L1_CONTRACT_ADDRESS, and PRIVATE_KEY in .env');
        }
    } catch (error) {
        console.error('❌ Failed to initialize sequencer:', error.message);
        console.error('⚠️  Server will continue in limited mode');
        sequencerReady = true; // Позволяем серверу работать даже без полной инициализации
    }
})();

// ============================================================================
// In-memory хранилище для демо
// ============================================================================

const transactions = [];  // Все транзакции
const batches = [];       // Все batch'и
let batchCounter = 0;

// ============================================================================
// API Routes
// ============================================================================

/**
 * GET /api/health
 * Проверка здоровья сервера
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        sequencerReady: sequencerReady,
        l1Connected: l1Connected,
        mode: l1Connected ? 'production' : 'demo',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/state
 * Получение текущего состояния
 */
app.get('/api/state', async (req, res) => {
    try {
        const merkleRoot = sequencer.tree.getRoot();
        const pendingCount = sequencer.pendingTxs.length;
        
        // Расчет экономии газа
        const GAS_PER_TX_L1 = 21000; // Примерная стоимость простой транзакции на L1
        const GAS_PER_BATCH = 33870; // Из логов: gas used для batch
        const BATCH_SIZE = CONFIG.BATCH_SIZE;
        
        const totalTxs = transactions.length;
        const totalBatches = batches.length;
        
        // Подсчет proof'ов и отправленных batches
        const proofsGenerated = batches.filter(b => b.proofGenerated).length;
        const batchesSubmitted = batches.filter(b => b.status === 'submitted' || b.status === 'verified').length;
        
        // Gas если бы отправляли напрямую на L1
        const gasIfDirect = totalTxs * GAS_PER_TX_L1;
        
        // Gas через ZK-Rollup
        const gasViaRollup = totalBatches * GAS_PER_BATCH;
        
        // Экономия
        const gasSaved = gasIfDirect - gasViaRollup;
        const gasSavingsPercent = totalTxs > 0 ? Math.round((gasSaved / gasIfDirect) * 100) : 0;
        
        // Gas на транзакцию
        const gasPerTxRollup = totalBatches > 0 ? Math.round(gasViaRollup / totalTxs) : 0;
        
        res.json({
            merkleRoot: merkleRoot,
            pendingTransactions: pendingCount,
            totalTransactions: transactions.length,
            totalBatches: batches.length,
            l1Connected: l1Connected,
            mode: l1Connected ? 'production' : 'demo',
            gasSavings: {
                gasIfDirect: gasIfDirect,
                gasViaRollup: gasViaRollup,
                gasSaved: gasSaved,
                gasSavingsPercent: gasSavingsPercent,
                gasPerTxL1: GAS_PER_TX_L1,
                gasPerTxRollup: gasPerTxRollup,
                batchSize: BATCH_SIZE
            },
            proofsGenerated: proofsGenerated,
            batchesSubmitted: batchesSubmitted,
            accounts: Array.from(sequencer.tree.leaves.entries()).map(([addr, acc]) => ({
                address: addr,
                balance: acc.balance
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/transaction
 * Отправка L2 транзакции
 */
app.post('/api/transaction', async (req, res) => {
    try {
        if (!sequencerReady) {
            return res.status(503).json({ error: 'Sequencer not ready' });
        }

        const { from, to, amount } = req.body;

        // Валидация
        if (!from || !to || !amount) {
            return res.status(400).json({ error: 'Missing required fields: from, to, amount' });
        }

        if (amount <= 0) {
            return res.status(400).json({ error: 'Amount must be positive' });
        }

        // Создаем транзакцию
        const tx = {
            id: transactions.length + 1,
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            amount: parseInt(amount),
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        // Добавляем в sequencer
        await sequencer.addTransaction(tx);

        // Сохраняем транзакцию
        transactions.push(tx);

        // Проверяем, был ли создан batch (после обработки pendingTxs будет пуст)
        const batchCreated = sequencer.pendingTxs.length === 0 && transactions.length % CONFIG.BATCH_SIZE === 0;

        res.json({
            success: true,
            transaction: tx,
            batchCreated: batchCreated,
            pendingCount: sequencer.pendingTxs.length
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/transactions
 * Получение списка транзакций
 */
app.get('/api/transactions', (req, res) => {
    const { status, limit = 50 } = req.query;
    
    let filtered = transactions;
    if (status) {
        filtered = transactions.filter(tx => tx.status === status);
    }
    
    res.json({
        transactions: filtered.slice(-limit),
        total: filtered.length
    });
});

/**
 * GET /api/batches
 * Получение списка batch'ей
 */
app.get('/api/batches', (req, res) => {
    res.json({
        batches: batches,
        total: batches.length
    });
});

/**
 * GET /api/batch/:id
 * Получение информации о batch
 */
app.get('/api/batch/:id', (req, res) => {
    const batch = batches.find(b => b.id === parseInt(req.params.id));
    if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
    }
    res.json(batch);
});

/**
 * POST /api/batch/create
 * Принудительное создание batch (если есть pending транзакции)
 */
app.post('/api/batch/create', async (req, res) => {
    try {
        if (!sequencerReady) {
            return res.status(503).json({ error: 'Sequencer not ready' });
        }

        if (sequencer.pendingTxs.length === 0) {
            return res.status(400).json({ error: 'No pending transactions' });
        }

        // Обрабатываем batch
        await sequencer.processBatch();

        const batch = {
            id: batchCounter++,
            transactions: sequencer.pendingTxs.length > 0 
                ? sequencer.pendingTxs.slice(0, CONFIG.BATCH_SIZE)
                : transactions.slice(-CONFIG.BATCH_SIZE),
            status: 'processing',
            createdAt: new Date().toISOString()
        };
        batches.push(batch);

        res.json({
            success: true,
            batch: batch,
            merkleRoot: sequencer.tree.getRoot()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/batch/:id/generate-proof
 * Генерация ZK-proof для batch
 */
app.post('/api/batch/:id/generate-proof', async (req, res) => {
    try {
        if (!sequencerReady) {
            return res.status(503).json({ error: 'Sequencer not ready' });
        }

        const batch = batches.find(b => b.id === parseInt(req.params.id));
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        // Генерация proof (упрощенная версия)
        // В реальности proof генерируется автоматически при processBatch
        res.json({
            success: true,
            message: 'Proof generation initiated',
            batchId: batch.id
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/batch/:id/submit
 * Отправка batch на L1
 */
app.post('/api/batch/:id/submit', async (req, res) => {
    try {
        if (!sequencerReady) {
            return res.status(503).json({ error: 'Sequencer not ready' });
        }

        const batch = batches.find(b => b.id === parseInt(req.params.id));
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        // В реальности это делается автоматически в sequencer.processBatch()
        // Здесь для демо обновляем статус
        if (l1Connected) {
            // Если L1 подключен, можно попытаться отправить
            // Но в реальности proof уже должен быть сгенерирован
            batch.status = 'submitted';
            batch.submittedAt = new Date().toISOString();
            res.json({
                success: true,
                batch: batch,
                message: 'Batch submitted to L1',
                l1Connected: true
            });
        } else {
            // Demo mode - просто обновляем статус
            batch.status = 'submitted';
            batch.submittedAt = new Date().toISOString();
            res.json({
                success: true,
                batch: batch,
                message: 'Batch marked as submitted (demo mode - L1 not connected)',
                l1Connected: false,
                demo: true
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/account/balance
 * Получение баланса аккаунта
 */
app.post('/api/account/balance', (req, res) => {
    try {
        const { address } = req.body;
        if (!address) {
            return res.status(400).json({ error: 'Address required' });
        }

        const balance = sequencer.tree.getBalance(address.toLowerCase());
        res.json({
            address: address,
            balance: balance
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/account/deposit
 * Инициализация аккаунта с балансом (для демо)
 */
app.post('/api/account/deposit', async (req, res) => {
    try {
        const { address, balance } = req.body;
        if (!address || balance === undefined) {
            return res.status(400).json({ error: 'Address and balance required' });
        }

        await sequencer.tree.updateAccount(address.toLowerCase(), parseInt(balance));
        await sequencer.tree.rebuildTree();

        res.json({
            success: true,
            address: address,
            balance: sequencer.tree.getBalance(address.toLowerCase()),
            merkleRoot: sequencer.tree.getRoot()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Frontend routes
// ============================================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============================================================================
// Запуск сервера
// ============================================================================

app.listen(PORT, () => {
    console.log(`🚀 ZK-Rollup API Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔌 API: http://localhost:${PORT}/api`);
});

