/**
 * @fileoverview Deployment Script for RWA Tokenization System
 * @description Comprehensive deployment of all smart contracts with proper configuration
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Deployment configuration
const DEPLOYMENT_CONFIG = {
  network: process.env.NETWORK || "localhost",
  gasPrice: process.env.GAS_PRICE || "auto",
  confirmations: process.env.CONFIRMATIONS || 2,

  // Contract configurations
  proofOracle: {
    minNotaryAttestations: 2,
    maxValuationWithoutAudit: ethers.utils.parseUnits("100000000", 6), // $100M
    disputeStake: ethers.utils.parseEther("1") // 1 ETH
  },

  compliance: {
    framework: "SEC_REG_D_506C", // or SEC_REG_D_506B, SEC_REG_S_CAT2, EU_MICA
    maxInvestors: 2000,
    maxNonAccreditedInvestors: 0, // 506(c) - accredited only
    minInvestment: 0,
    maxInvestment: ethers.constants.MaxUint256,
    allowUSInvestors: true,
    defaultLockupPeriod: 365 * 24 * 60 * 60 // 1 year in seconds
  },

  liquidityRouter: {
    defaultFee: 30, // 0.3%
    complianceFee: 20 // 0.2%
  }
};

/**
 * Main deployment function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("RWA TOKENIZATION SYSTEM DEPLOYMENT");
  console.log("=".repeat(60));
  console.log();

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");
  console.log("Network:", hre.network.name);
  console.log();

  const deployedContracts = {};

  try {
    // ========== STEP 1: Deploy Proof-of-Asset Oracle ==========
    console.log("📜 Step 1: Deploying Proof-of-Asset Oracle...");
    const ProofOfAssetOracle = await ethers.getContractFactory("ProofOfAssetOracle");
    const proofOracle = await ProofOfAssetOracle.deploy();
    await proofOracle.deployed();

    console.log("✅ ProofOfAssetOracle deployed to:", proofOracle.address);
    deployedContracts.proofOfAssetOracle = proofOracle.address;

    // Wait for confirmations
    await proofOracle.deployTransaction.wait(DEPLOYMENT_CONFIG.confirmations);
    console.log();

    // ========== STEP 2: Deploy Legal Entity Wrapper ==========
    console.log("🏛️  Step 2: Deploying Legal Entity Wrapper...");
    const LegalEntityWrapper = await ethers.getContractFactory("LegalEntityWrapper");
    const legalEntityWrapper = await LegalEntityWrapper.deploy();
    await legalEntityWrapper.deployed();

    console.log("✅ LegalEntityWrapper deployed to:", legalEntityWrapper.address);
    deployedContracts.legalEntityWrapper = legalEntityWrapper.address;

    await legalEntityWrapper.deployTransaction.wait(DEPLOYMENT_CONFIG.confirmations);
    console.log();

    // ========== STEP 3: Deploy Compliance Module ==========
    console.log("⚖️  Step 3: Deploying Compliance Module...");

    // We'll deploy this after the token, but prepare the factory
    const ComplianceModule = await ethers.getContractFactory("ComplianceModule");
    console.log("✅ ComplianceModule factory prepared");
    console.log();

    // ========== STEP 4: Deploy RWA Security Token (ERC-1400) ==========
    console.log("🪙  Step 4: Deploying RWA Security Token...");

    const tokenName = "Manhattan Real Estate Token";
    const tokenSymbol = "MRET";
    const defaultPartitions = [
      ethers.utils.formatBytes32String("CommonStock"),
      ethers.utils.formatBytes32String("PreferredA")
    ];
    const legalEntityName = "Manhattan Property SPV LLC";
    const jurisdiction = "US-DE";
    const assetId = ethers.utils.formatBytes32String("ASSET001");

    const RWASecurityToken = await ethers.getContractFactory("RWASecurityToken");
    const securityToken = await RWASecurityToken.deploy(
      tokenName,
      tokenSymbol,
      defaultPartitions,
      legalEntityName,
      jurisdiction,
      assetId
    );
    await securityToken.deployed();

    console.log("✅ RWASecurityToken deployed to:", securityToken.address);
    deployedContracts.rwaSecurityToken = securityToken.address;

    await securityToken.deployTransaction.wait(DEPLOYMENT_CONFIG.confirmations);
    console.log();

    // ========== STEP 5: Deploy Compliance Module (now with token address) ==========
    console.log("⚖️  Step 5: Deploying Compliance Module with token...");

    const frameworkId = getFrameworkId(DEPLOYMENT_CONFIG.compliance.framework);
    const complianceModule = await ComplianceModule.deploy(
      securityToken.address,
      frameworkId,
      ethers.constants.AddressZero // Will set identity registry later
    );
    await complianceModule.deployed();

    console.log("✅ ComplianceModule deployed to:", complianceModule.address);
    deployedContracts.complianceModule = complianceModule.address;

    await complianceModule.deployTransaction.wait(DEPLOYMENT_CONFIG.confirmations);
    console.log();

    // ========== STEP 6: Deploy Liquidity Router ==========
    console.log("💱 Step 6: Deploying Cross-Chain Liquidity Router...");

    const RWALiquidityRouter = await ethers.getContractFactory("RWALiquidityRouter");
    const liquidityRouter = await RWALiquidityRouter.deploy(deployer.address);
    await liquidityRouter.deployed();

    console.log("✅ RWALiquidityRouter deployed to:", liquidityRouter.address);
    deployedContracts.rwaLiquidityRouter = liquidityRouter.address;

    await liquidityRouter.deployTransaction.wait(DEPLOYMENT_CONFIG.confirmations);
    console.log();

    // ========== STEP 7: Configure Contracts ==========
    console.log("⚙️  Step 7: Configuring contracts...");

    // Link token to compliance module
    console.log("  • Linking token to compliance module...");
    await securityToken.setComplianceModule(complianceModule.address);
    console.log("  ✓ Token linked to compliance module");

    // Link token to proof oracle
    console.log("  • Linking token to proof oracle...");
    await securityToken.setProofOfAssetOracle(proofOracle.address);
    console.log("  ✓ Token linked to proof oracle");

    // Link token to legal entity wrapper
    console.log("  • Linking token to legal entity wrapper...");
    await securityToken.setLegalEnforcementOracle(legalEntityWrapper.address);
    console.log("  ✓ Token linked to legal entity wrapper");

    // Configure compliance settings
    console.log("  • Configuring compliance settings...");
    await complianceModule.updateComplianceSettings(
      DEPLOYMENT_CONFIG.compliance.maxInvestors,
      DEPLOYMENT_CONFIG.compliance.maxNonAccreditedInvestors,
      DEPLOYMENT_CONFIG.compliance.minInvestment,
      DEPLOYMENT_CONFIG.compliance.maxInvestment,
      DEPLOYMENT_CONFIG.compliance.allowUSInvestors
    );
    console.log("  ✓ Compliance settings configured");

    console.log();

    // ========== STEP 8: Create Legal Entity ==========
    console.log("🏛️  Step 8: Creating legal entity...");

    const entityTx = await legalEntityWrapper.createLegalEntity(
      0, // SPV_LLC
      0, // US_DELAWARE
      legalEntityName,
      "DE123456789", // Registration number
      ethers.utils.formatBytes32String("OPERATING_AGREEMENT_HASH"),
      "QmXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // IPFS hash placeholder
      "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // Arweave hash placeholder
      securityToken.address,
      assetId,
      deployer.address // Registered agent
    );

    const receipt = await entityTx.wait();
    const entityCreatedEvent = receipt.events.find(e => e.event === "EntityCreated");
    const createdEntityId = entityCreatedEvent.args.entityId;

    console.log("✅ Legal entity created with ID:", createdEntityId);
    deployedContracts.entityId = createdEntityId;
    console.log();

    // ========== STEP 9: Save Deployment Info ==========
    console.log("💾 Step 9: Saving deployment info...");

    const deploymentInfo = {
      network: hre.network.name,
      chainId: hre.network.config.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      blockNumber: await ethers.provider.getBlockNumber(),
      contracts: deployedContracts,
      configuration: DEPLOYMENT_CONFIG
    };

    const outputPath = path.join(__dirname, "..", "..", "deployments");
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const filename = `deployment-${hre.network.name}-${Date.now()}.json`;
    fs.writeFileSync(
      path.join(outputPath, filename),
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("✅ Deployment info saved to:", filename);
    console.log();

    // ========== DEPLOYMENT SUMMARY ==========
    console.log("=".repeat(60));
    console.log("DEPLOYMENT SUMMARY");
    console.log("=".repeat(60));
    console.log();
    console.log("📜 ProofOfAssetOracle:", deployedContracts.proofOfAssetOracle);
    console.log("🏛️  LegalEntityWrapper:", deployedContracts.legalEntityWrapper);
    console.log("🪙  RWASecurityToken:", deployedContracts.rwaSecurityToken);
    console.log("⚖️  ComplianceModule:", deployedContracts.complianceModule);
    console.log("💱 RWALiquidityRouter:", deployedContracts.rwaLiquidityRouter);
    console.log();
    console.log("🎯 Legal Entity ID:", deployedContracts.entityId);
    console.log();
    console.log("=".repeat(60));
    console.log("NEXT STEPS");
    console.log("=".repeat(60));
    console.log();
    console.log("1. Verify contracts on Etherscan:");
    console.log("   npx hardhat verify --network", hre.network.name, deployedContracts.proofOfAssetOracle);
    console.log();
    console.log("2. Upload legal documents to IPFS/Arweave");
    console.log();
    console.log("3. Submit asset proof to oracle:");
    console.log("   Call proofOracle.submitProof(...)");
    console.log();
    console.log("4. Onboard investors:");
    console.log("   Call complianceModule.onboardInvestor(...)");
    console.log();
    console.log("5. Issue tokens:");
    console.log("   Call securityToken.issue(...)");
    console.log();
    console.log("6. File SEC Form D within 15 days");
    console.log();
    console.log("7. File state Blue Sky notices");
    console.log();
    console.log("=".repeat(60));

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }
}

/**
 * Get framework ID from string
 */
function getFrameworkId(framework) {
  const frameworks = {
    "SEC_REG_D_506B": 0,
    "SEC_REG_D_506C": 1,
    "SEC_REG_S_CAT1": 2,
    "SEC_REG_S_CAT2": 3,
    "SEC_REG_S_CAT3": 4,
    "EU_MICA": 5,
    "CUSTOM": 6
  };

  return frameworks[framework] || 1; // Default to 506(c)
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
