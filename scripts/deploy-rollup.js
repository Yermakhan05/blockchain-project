/**
 * Скрипт для деплоя ZK-Rollup контрактов
 * 
 * Использование:
 *   npx hardhat run scripts/deploy-rollup.js
 *   npx hardhat run scripts/deploy-rollup.js --network bnbTestnet
 */

const hre = require("hardhat");

async function main() {
    console.log("🚀 Deploying ZK-Rollup contracts...\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log("📝 Deploying with account:", deployer.address);
    console.log("💰 Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString(), "\n");

    // ============================================================================
    // ШАГ 1: Деплой Verifier
    // ============================================================================
    console.log("1️⃣  Deploying Verifier...");
    
    // Пробуем сначала RollupVerifier (если есть), иначе Verifier
    let VerifierFactory;
    let verifierName;
    try {
        VerifierFactory = await hre.ethers.getContractFactory("RollupVerifier");
        verifierName = "RollupVerifier";
    } catch (e) {
        try {
            VerifierFactory = await hre.ethers.getContractFactory("Verifier");
            verifierName = "Verifier";
        } catch (e2) {
            throw new Error("Neither RollupVerifier nor Verifier contract found. Please compile contracts first: npx hardhat compile");
        }
    }
    
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log(`✅ ${verifierName} deployed to:`, verifierAddress);
    console.log("   Transaction hash:", verifier.deploymentTransaction()?.hash, "\n");

    // ============================================================================
    // ШАГ 2: Деплой RollupContract
    // ============================================================================
    console.log("2️⃣  Deploying RollupContract...");
    const initialMerkleRoot = "0"; // Начальный корень (пустое дерево)
    
    const RollupContract = await hre.ethers.getContractFactory("RollupContract");
    const rollup = await RollupContract.deploy(verifierAddress, initialMerkleRoot);
    await rollup.waitForDeployment();
    const rollupAddress = await rollup.getAddress();
    console.log("✅ RollupContract deployed to:", rollupAddress);
    console.log("   Transaction hash:", rollup.deploymentTransaction()?.hash, "\n");

    // ============================================================================
    // ШАГ 3: Проверка деплоя
    // ============================================================================
    console.log("3️⃣  Verifying deployment...");
    const currentRoot = await rollup.currentMerkleRoot();
    const verifierFromContract = await rollup.verifier();
    
    console.log("   Current Merkle Root:", currentRoot.toString());
    console.log("   Verifier address:", verifierFromContract);
    console.log("   Verifier matches:", verifierFromContract.toLowerCase() === verifierAddress.toLowerCase(), "\n");

    // ============================================================================
    // ШАГ 4: Сохранение адресов
    // ============================================================================
    console.log("📋 Deployment Summary:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Verifier Address:");
    console.log("  ", verifierAddress);
    console.log("");
    console.log("RollupContract Address (L1_CONTRACT_ADDRESS):");
    console.log("  ", rollupAddress);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("💡 Add to your .env file:");
    console.log(`L1_CONTRACT_ADDRESS=${rollupAddress}`);
    console.log(`RPC_URL=${hre.network.config.url || "http://localhost:8545"}`);
    console.log("");

    // Сохранение в файл для удобства
    const fs = require('fs');
    const deploymentInfo = {
        network: hre.network.name,
        chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
        verifier: verifierAddress,
        rollupContract: rollupAddress,
        deployer: deployer.address,
        timestamp: new Date().toISOString()
    };

    const deploymentsDir = './deployments';
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir);
    }

    const deploymentFile = `${deploymentsDir}/${hre.network.name}.json`;
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    console.log(`💾 Deployment info saved to: ${deploymentFile}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });

