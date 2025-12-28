/**
 * Frontend компоненты для ZK-Rollup Dashboard
 * 
 * Переиспользуемые компоненты для визуализации
 */

// ============================================================================
// Компонент: Transaction Card
// ============================================================================

function TransactionCard(transaction) {
    return `
        <div class="transaction-item">
            <div class="transaction-info">
                <div class="transaction-from-to">
                    ${formatAddress(transaction.from)} → ${formatAddress(transaction.to)}
                </div>
                <div class="transaction-amount">
                    Amount: ${transaction.amount}
                </div>
                <div class="transaction-time">
                    ${formatTime(transaction.timestamp)}
                </div>
            </div>
            <div class="transaction-status status-${transaction.status}">
                ${transaction.status}
            </div>
        </div>
    `;
}

// ============================================================================
// Компонент: Batch Card
// ============================================================================

function BatchCard(batch) {
    const actions = getBatchActions(batch);
    
    return `
        <div class="batch-item">
            <div class="batch-header">
                <div>
                    <span class="batch-id">Batch #${batch.id}</span>
                    <span class="transaction-status status-${batch.status}" style="margin-left: 10px;">
                        ${batch.status}
                    </span>
                </div>
                ${actions}
            </div>
            <div class="batch-info">
                <div class="batch-transactions">
                    ${batch.transactions.length} transaction(s)
                </div>
                ${batch.oldRoot ? `
                    <div class="batch-roots">
                        <div>Old Root: ${formatAddress(batch.oldRoot)}</div>
                        <div>New Root: ${formatAddress(batch.newRoot)}</div>
                    </div>
                ` : ''}
                ${batch.createdAt ? `
                    <div class="batch-time">
                        Created: ${formatTime(batch.createdAt)}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// ============================================================================
// Компонент: Flow Step
// ============================================================================

function FlowStep(stepNumber, label, value, isActive = false) {
    return `
        <div class="flow-step ${isActive ? 'active' : ''}" id="step${stepNumber}">
            <h4>${stepNumber}. ${label}</h4>
            <div class="step-value">${value}</div>
        </div>
    `;
}

// ============================================================================
// Компонент: Stat Card
// ============================================================================

function StatCard(title, value, isMerkleRoot = false) {
    const valueClass = isMerkleRoot ? 'merkle-root' : '';
    return `
        <div class="stat-card">
            <h3>${title}</h3>
            <div class="value ${valueClass}">${value}</div>
        </div>
    `;
}

// ============================================================================
// Утилиты
// ============================================================================

function formatAddress(address) {
    if (!address) return 'N/A';
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
}

function getBatchActions(batch) {
    switch (batch.status) {
        case 'processing':
            return `
                <button class="btn btn-success" onclick="handleSubmitBatch(${batch.id})">
                    Submit to L1
                </button>
            `;
        case 'submitted':
            return `
                <span style="color: #10b981;">✓ Submitted</span>
            `;
        default:
            return '';
    }
}

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TransactionCard,
        BatchCard,
        FlowStep,
        StatCard,
        formatAddress,
        formatTime
    };
}

