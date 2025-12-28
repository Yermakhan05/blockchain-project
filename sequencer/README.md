# ZK-Rollup Sequencer

## Описание

Off-chain sequencer для обработки транзакций и генерации ZK-proofs для ZK-Rollup.

## Установка

```bash
npm install ethers snarkjs circomlibjs
```

## Использование

### Базовый пример

```javascript
const { Sequencer } = require('./sequencer');

const sequencer = new Sequencer({
    BATCH_SIZE: 4,
    TREE_DEPTH: 10,
    L1_CONTRACT_ADDRESS: '0x...',
    RPC_URL: 'https://...',
    CIRCUIT_PATH: './circuits/rollup_js/rollup.wasm',
    ZKEY_PATH: './circuits/rollup_0001.zkey'
});

await sequencer.init();

// Добавление транзакций
await sequencer.addTransaction({
    from: '0x123...',
    to: '0x456...',
    amount: 100
});
```

## API

### `sequencer.init()`
Инициализация sequencer:
- Загрузка состояния
- Подключение к L1
- Инициализация Merkle Tree

### `sequencer.addTransaction(tx)`
Добавление транзакции:
- Валидация баланса
- Добавление в очередь
- Автоматическая обработка batch при достижении BATCH_SIZE

### `sequencer.processBatch()`
Обработка batch:
- Применение транзакций
- Генерация ZK-proof
- Отправка на L1

## Переменные окружения

```bash
L1_CONTRACT_ADDRESS=0x...
RPC_URL=https://...
PRIVATE_KEY=0x...
```

## Структура файлов

```
sequencer/
├── sequencer.js          # Основной код sequencer
├── merkle_tree.js        # Merkle Tree с Poseidon
└── README.md            # Документация
```

