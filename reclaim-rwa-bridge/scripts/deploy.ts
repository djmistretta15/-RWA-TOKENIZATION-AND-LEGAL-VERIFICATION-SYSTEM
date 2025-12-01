import { ethers, network, run } from "hardhat";
import { Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * Comprehensive Deployment Script for RWA Tokenization System
 *
 * Deploys all 9 core contracts in proper dependency order:
 * 1. NotaryRegistry - Notary credential management
 * 2. AssetValidationOracle - 3-source oracle consensus
 * 3. WhitelistAccess - KYC/AML compliance gating
 * 4. RWARegistry - Legal claims registry
 * 5. RWAToken - ERC-1400 security token
 * 6. LegalWrapper - SPV/LLC court-recognized wrappers
 * 7. RWAReconciliation - Off-chain registry sync
 * 8. vault4626Router - ERC-4626 yield vault
 * 9. YieldDistributor - Automated yield distribution
 *
 * Features:
 * - Dependency-ordered deployment
 * - Contract verification on block explorers
 * - Role configuration and access control setup
 * - Deployment logging and artifact storage
 * - Multi-network support
 */

interface DeploymentResult {
  contractName: string;
  address: string;
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  deployer: string;
  timestamp: number;
  constructorArgs: any[];
}

interface DeploymentState {
  network: string;
  chainId: number;
  deployedContracts: DeploymentResult[];
  deploymentTimestamp: number;
  totalGasUsed: bigint;
  deployer: string;
}

// Configuration
const DEPLOYMENT_GAS_LIMIT = 30_000_000;
const VERIFICATION_DELAY = 60_000; // 60 seconds for block confirmation before verification

// Deployment state
let deploymentState: DeploymentState = {
  network: "",
  chainId: 0,
  deployedContracts: [],
  deploymentTimestamp: 0,
  totalGasUsed: 0n,
  deployer: "",
};

// Contract references
let notaryRegistry: Contract;
let assetValidationOracle: Contract;
let whitelistAccess: Contract;
let rwaRegistry: Contract;
let rwaToken: Contract;
let legalWrapper: Contract;
let rwaReconciliation: Contract;
let vault4626Router: Contract;
let yieldDistributor: Contract;

async function main() {
  console.log("🚀 Starting RWA Tokenization System Deployment");
  console.log("================================================\n");

  // Get deployment account
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log(`📍 Network: ${network.name}`);
  console.log(`🔑 Deployer: ${deployerAddress}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Initialize deployment state
  deploymentState.network = network.name;
  deploymentState.chainId = network.config.chainId || 0;
  deploymentState.deploymentTimestamp = Math.floor(Date.now() / 1000);
  deploymentState.deployer = deployerAddress;

  try {
    // Step 1: Deploy NotaryRegistry
    console.log("📋 Step 1/9: Deploying NotaryRegistry...");
    notaryRegistry = await deployContract("NotaryRegistry", []);

    // Step 2: Deploy AssetValidationOracle
    console.log("📋 Step 2/9: Deploying AssetValidationOracle...");
    assetValidationOracle = await deployContract("AssetValidationOracle", [
      await notaryRegistry.getAddress(),
    ]);

    // Step 3: Deploy WhitelistAccess
    console.log("📋 Step 3/9: Deploying WhitelistAccess...");
    whitelistAccess = await deployContract("WhitelistAccess", []);

    // Step 4: Deploy RWARegistry
    console.log("📋 Step 4/9: Deploying RWARegistry...");
    rwaRegistry = await deployContract("RWARegistry", []);

    // Step 5: Deploy RWAToken
    console.log("📋 Step 5/9: Deploying RWAToken...");
    rwaToken = await deployContract("RWAToken", [
      "Reclaim RWA Token",
      "RWA",
      await assetValidationOracle.getAddress(),
    ]);

    // Step 6: Deploy LegalWrapper
    console.log("📋 Step 6/9: Deploying LegalWrapper...");
    legalWrapper = await deployContract("LegalWrapper", [
      await rwaToken.getAddress(),
      await rwaRegistry.getAddress(),
    ]);

    // Step 7: Deploy RWAReconciliation
    console.log("📋 Step 7/9: Deploying RWAReconciliation...");
    rwaReconciliation = await deployContract("RWAReconciliation", [
      await rwaToken.getAddress(),
      await rwaRegistry.getAddress(),
    ]);

    // Step 8: Deploy vault4626Router
    console.log("📋 Step 8/9: Deploying vault4626Router...");
    vault4626Router = await deployContract("RWALiquidityVault", [
      await rwaToken.getAddress(),
      "RWA Vault Share",
      "vRWA",
      await whitelistAccess.getAddress(),
      await assetValidationOracle.getAddress(),
    ]);

    // Step 9: Deploy YieldDistributor
    console.log("📋 Step 9/9: Deploying YieldDistributor...");
    yieldDistributor = await deployContract("YieldDistributor", [
      await rwaToken.getAddress(),
    ]);

    console.log("\n✅ All contracts deployed successfully!\n");

    // Configure roles and permissions
    console.log("🔧 Configuring roles and permissions...");
    await configureRoles(deployerAddress);

    // Link contracts together
    console.log("🔗 Linking contracts...");
    await linkContracts();

    // Save deployment artifacts
    console.log("💾 Saving deployment artifacts...");
    await saveDeploymentArtifacts();

    // Verify contracts if not on local network
    if (network.name !== "hardhat" && network.name !== "localhost") {
      console.log("\n🔍 Verifying contracts on block explorer...");
      await verifyAllContracts();
    }

    // Print deployment summary
    printDeploymentSummary();

    // Print post-deployment checklist
    printPostDeploymentChecklist();
  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    await saveDeploymentArtifacts(); // Save partial deployment state
    throw error;
  }
}

async function deployContract(
  contractName: string,
  constructorArgs: any[]
): Promise<Contract> {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...constructorArgs, {
    gasLimit: DEPLOYMENT_GAS_LIMIT,
  });

  const receipt = await contract.deploymentTransaction()?.wait();

  if (!receipt) {
    throw new Error(`Failed to get deployment receipt for ${contractName}`);
  }

  const result: DeploymentResult = {
    contractName,
    address: await contract.getAddress(),
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployer: deploymentState.deployer,
    timestamp: Math.floor(Date.now() / 1000),
    constructorArgs,
  };

  deploymentState.deployedContracts.push(result);
  deploymentState.totalGasUsed += receipt.gasUsed;

  console.log(`   ✅ ${contractName} deployed at: ${result.address}`);
  console.log(`      Gas used: ${ethers.formatUnits(receipt.gasUsed, "gwei")} gwei`);
  console.log(`      Tx hash: ${receipt.hash}\n`);

  return contract;
}

async function configureRoles(adminAddress: string) {
  // Define role constants
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const NOTARY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("NOTARY_ROLE"));
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
  const COMPLIANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_ROLE"));
  const REGISTRY_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REGISTRY_ADMIN_ROLE"));
  const YIELD_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("YIELD_MANAGER_ROLE"));

  // Grant roles to deployer for initial setup
  console.log("   Setting up NotaryRegistry roles...");
  await notaryRegistry.grantRole(REGISTRY_ADMIN_ROLE, adminAddress);

  console.log("   Setting up AssetValidationOracle roles...");
  await assetValidationOracle.grantRole(ORACLE_ROLE, adminAddress);
  await assetValidationOracle.grantRole(VALIDATOR_ROLE, adminAddress);

  console.log("   Setting up WhitelistAccess roles...");
  await whitelistAccess.grantRole(COMPLIANCE_ROLE, adminAddress);

  console.log("   Setting up RWAToken roles...");
  await rwaToken.grantRole(ADMIN_ROLE, adminAddress);

  console.log("   Setting up YieldDistributor roles...");
  await yieldDistributor.grantRole(YIELD_MANAGER_ROLE, adminAddress);

  console.log("   ✅ Roles configured\n");
}

async function linkContracts() {
  // Link RWAToken to Registry
  console.log("   Linking RWAToken to RWARegistry...");
  await rwaToken.setRegistry(await rwaRegistry.getAddress());

  // Link RWAToken to WhitelistAccess
  console.log("   Linking RWAToken to WhitelistAccess...");
  await rwaToken.setWhitelistAccess(await whitelistAccess.getAddress());

  // Link RWARegistry to RWAToken
  console.log("   Linking RWARegistry to RWAToken...");
  await rwaRegistry.setToken(await rwaToken.getAddress());

  // Link vault to token
  console.log("   Linking vault4626Router to RWAToken...");
  await vault4626Router.setShareToken(await rwaToken.getAddress());

  // Link YieldDistributor to vault
  console.log("   Linking YieldDistributor to vault...");
  await yieldDistributor.setShareToken(await vault4626Router.getAddress());

  console.log("   ✅ Contracts linked\n");
}

async function saveDeploymentArtifacts() {
  const artifactsDir = path.join(__dirname, "..", "deployments", deploymentState.network);

  // Create directory if it doesn't exist
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Save deployment state
  const stateFile = path.join(artifactsDir, "deployment-state.json");
  const stateData = {
    ...deploymentState,
    totalGasUsed: deploymentState.totalGasUsed.toString(),
  };
  fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));

  // Save individual contract addresses
  const addressesFile = path.join(artifactsDir, "addresses.json");
  const addresses: Record<string, string> = {};
  for (const contract of deploymentState.deployedContracts) {
    addresses[contract.contractName] = contract.address;
  }
  fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));

  // Save constructor arguments for verification
  const argsFile = path.join(artifactsDir, "constructor-args.json");
  const args: Record<string, any[]> = {};
  for (const contract of deploymentState.deployedContracts) {
    args[contract.contractName] = contract.constructorArgs;
  }
  fs.writeFileSync(argsFile, JSON.stringify(args, null, 2));

  // Create .env template with deployed addresses
  const envTemplate = path.join(artifactsDir, ".env.deployed");
  let envContent = `# Deployed Contract Addresses - ${deploymentState.network}\n`;
  envContent += `# Deployment Date: ${new Date(deploymentState.deploymentTimestamp * 1000).toISOString()}\n\n`;

  for (const contract of deploymentState.deployedContracts) {
    const envKey = contract.contractName
      .replace(/([A-Z])/g, "_$1")
      .toUpperCase()
      .replace(/^_/, "");
    envContent += `${envKey}_ADDRESS=${contract.address}\n`;
  }

  fs.writeFileSync(envTemplate, envContent);

  console.log(`   ✅ Artifacts saved to: ${artifactsDir}\n`);
}

async function verifyAllContracts() {
  console.log(`   Waiting ${VERIFICATION_DELAY / 1000}s for block confirmations...`);
  await new Promise((resolve) => setTimeout(resolve, VERIFICATION_DELAY));

  for (const contract of deploymentState.deployedContracts) {
    try {
      console.log(`   Verifying ${contract.contractName}...`);
      await run("verify:verify", {
        address: contract.address,
        constructorArguments: contract.constructorArgs,
      });
      console.log(`   ✅ ${contract.contractName} verified`);
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log(`   ℹ️  ${contract.contractName} already verified`);
      } else {
        console.log(`   ⚠️  Failed to verify ${contract.contractName}: ${error.message}`);
      }
    }
  }

  console.log("\n");
}

function printDeploymentSummary() {
  console.log("====================================");
  console.log("       DEPLOYMENT SUMMARY          ");
  console.log("====================================\n");

  console.log(`Network: ${deploymentState.network}`);
  console.log(`Chain ID: ${deploymentState.chainId}`);
  console.log(`Deployer: ${deploymentState.deployer}`);
  console.log(`Timestamp: ${new Date(deploymentState.deploymentTimestamp * 1000).toISOString()}`);
  console.log(`Total Gas Used: ${ethers.formatUnits(deploymentState.totalGasUsed, "gwei")} gwei\n`);

  console.log("Deployed Contracts:");
  console.log("-------------------");

  for (const contract of deploymentState.deployedContracts) {
    console.log(`\n${contract.contractName}:`);
    console.log(`  Address: ${contract.address}`);
    console.log(`  Gas Used: ${contract.gasUsed}`);
    console.log(`  Block: ${contract.blockNumber}`);
  }

  console.log("\n");
}

function printPostDeploymentChecklist() {
  console.log("====================================");
  console.log("    POST-DEPLOYMENT CHECKLIST      ");
  console.log("====================================\n");

  console.log("⬜ 1. Verify all contracts on block explorer");
  console.log("⬜ 2. Transfer ownership to multisig wallet");
  console.log("⬜ 3. Configure initial whitelisted investors");
  console.log("⬜ 4. Register initial notaries");
  console.log("⬜ 5. Set up oracle data feeds");
  console.log("⬜ 6. Configure yield distribution schedule");
  console.log("⬜ 7. Test tokenization flow on testnet");
  console.log("⬜ 8. Configure compliance parameters");
  console.log("⬜ 9. Set up monitoring and alerts");
  console.log("⬜ 10. Document deployed addresses in README");
  console.log("⬜ 11. Submit for security audit");
  console.log("⬜ 12. Configure IPFS/Arweave gateways");
  console.log("⬜ 13. Set up legal entity (SPV/LLC)");
  console.log("⬜ 14. File Form D with SEC (if applicable)");
  console.log("⬜ 15. Enable frontend with deployed addresses\n");

  console.log("🎉 Deployment complete! Check the checklist above for next steps.\n");
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
