/**
 * Пример использования Sequencer
 */

const { Sequencer } = require('./sequencer');

const CONFIG = {
    BATCH_SIZE: 4,
    TREE_DEPTH: 10,
    L1_CONTRACT_ADDRESS: process.env.L1_CONTRACT_ADDRESS,
    RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
    CIRCUIT_PATH: require('path').join(__dirname, '../circuits/rollup_js/rollup.wasm'),
    ZKEY_PATH: require('path').join(__dirname, '../circuits/rollup_0001.zkey'),
    STATE_FILE: require('path').join(__dirname, 'state.json')
};

async function main() {
    console.log('=== ZK-Rollup Sequencer Example ===\n');

    // Инициализация sequencer
    const sequencer = new Sequencer(CONFIG);
    await sequencer.init();

    // Инициализация начальных балансов
    await sequencer.tree.updateAccount('0x111', 1000);
    await sequencer.tree.updateAccount('0x222', 500);
    await sequencer.tree.updateAccount('0x333', 200);
    await sequencer.tree.updateAccount('0x444', 100);
    await sequencer.tree.rebuildTree();

    console.log('Initial state:');
    console.log('  Account 0x111:', sequencer.tree.getBalance('0x111'));
    console.log('  Account 0x222:', sequencer.tree.getBalance('0x222'));
    console.log('  Account 0x333:', sequencer.tree.getBalance('0x333'));
    console.log('  Account 0x444:', sequencer.tree.getBalance('0x444'));
    console.log('  Merkle Root:', sequencer.tree.getRoot());
    console.log();

    // Добавление транзакций
    console.log('Adding transactions...\n');

    await sequencer.addTransaction({
        from: '0x111',
        to: '0x222',
        amount: 100
    });

    await sequencer.addTransaction({
        from: '0x222',
        to: '0x333',
        amount: 50
    });

    await sequencer.addTransaction({
        from: '0x333',
        to: '0x444',
        amount: 25
    });

    await sequencer.addTransaction({
        from: '0x444',
        to: '0x111',
        amount: 10
    });

    // Batch будет обработан автоматически после 4-й транзакции

    console.log('\nFinal state:');
    console.log('  Account 0x111:', sequencer.tree.getBalance('0x111'));
    console.log('  Account 0x222:', sequencer.tree.getBalance('0x222'));
    console.log('  Account 0x333:', sequencer.tree.getBalance('0x333'));
    console.log('  Account 0x444:', sequencer.tree.getBalance('0x444'));
    console.log('  Merkle Root:', sequencer.tree.getRoot());
}

main().catch(console.error);

