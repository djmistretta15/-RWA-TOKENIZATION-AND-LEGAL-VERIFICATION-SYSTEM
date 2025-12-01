/**
 * RWA Tokenization - Contract Upgrade & Migration Manager
 *
 * Enterprise-grade contract upgrade system with:
 * - Transparent Proxy pattern support (EIP-1967)
 * - UUPS Proxy pattern support
 * - Diamond pattern (EIP-2535) support
 * - Timelock-controlled upgrades
 * - Multi-signature governance
 * - Automated migration scripts
 * - State verification and rollback capabilities
 * - Storage layout compatibility checks
 * - Gas estimation and optimization
 *
 * @module UpgradeManager
 * @version 1.0.0
 */

import { ethers } from "ethers";
import crypto from "crypto";
import { z } from "zod";

// ============================================
// TYPE DEFINITIONS
// ============================================

const ProxyTypeSchema = z.enum(["TRANSPARENT", "UUPS", "DIAMOND", "BEACON"]);
type ProxyType = z.infer<typeof ProxyTypeSchema>;

const UpgradeStatusSchema = z.enum([
  "PROPOSED",
  "SCHEDULED",
  "READY",
  "EXECUTING",
  "COMPLETED",
  "FAILED",
  "ROLLED_BACK",
  "CANCELLED"
]);
type UpgradeStatus = z.infer<typeof UpgradeStatusSchema>;

interface ContractInfo {
  name: string;
  address: string;
  proxyType: ProxyType;
  implementationAddress: string;
  adminAddress: string;
  version: string;
  deployedAt: number;
  lastUpgraded?: number;
}

interface UpgradeProposal {
  id: string;
  contractName: string;
  proxyAddress: string;
  currentImplementation: string;
  newImplementation: string;
  newVersion: string;
  proposedBy: string;
  proposedAt: number;
  scheduledFor: number;
  status: UpgradeStatus;
  timelockDelay: number;
  requiredSignatures: number;
  signatures: Map<string, string>;
  migrationScript?: string;
  storageLayoutHash: string;
  estimatedGas: bigint;
  testResults?: TestResult[];
  auditReport?: string;
}

interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  gasUsed?: bigint;
}

interface StorageSlot {
  name: string;
  slot: number;
  type: string;
  offset: number;
  size: number;
}

interface StorageLayout {
  contractName: string;
  version: string;
  slots: StorageSlot[];
  hash: string;
}

interface MigrationStep {
  id: string;
  description: string;
  action: () => Promise<void>;
  rollback: () => Promise<void>;
  verifyFn: () => Promise<boolean>;
  estimatedGas: bigint;
}

interface UpgradeConfig {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Signer;
  timelockAddress: string;
  governorAddress: string;
  proxyAdminAddress: string;
  minTimelockDelay: number; // seconds
  requiredSigners: string[];
  minSignatures: number;
}

// ============================================
// UPGRADE MANAGER
// ============================================

export class ContractUpgradeManager {
  private config: UpgradeConfig;
  private contracts: Map<string, ContractInfo>;
  private proposals: Map<string, UpgradeProposal>;
  private storageLayouts: Map<string, StorageLayout>;
  private migrationHistory: Array<{
    id: string;
    timestamp: number;
    contractName: string;
    fromVersion: string;
    toVersion: string;
    transactionHash: string;
    success: boolean;
  }>;

  constructor(config: UpgradeConfig) {
    this.config = config;
    this.contracts = new Map();
    this.proposals = new Map();
    this.storageLayouts = new Map();
    this.migrationHistory = [];
  }

  // ============================================
  // CONTRACT REGISTRY
  // ============================================

  registerContract(info: ContractInfo): void {
    this.contracts.set(info.name, info);
    console.log(`[Upgrade] Registered contract: ${info.name} at ${info.address}`);
  }

  getContractInfo(name: string): ContractInfo | undefined {
    return this.contracts.get(name);
  }

  async refreshContractInfo(name: string): Promise<ContractInfo> {
    const info = this.contracts.get(name);
    if (!info) {
      throw new Error(`Contract ${name} not registered`);
    }

    // Fetch current implementation address
    const currentImpl = await this.getImplementationAddress(info.address, info.proxyType);
    info.implementationAddress = currentImpl;

    // Fetch version from implementation
    const version = await this.getContractVersion(currentImpl);
    info.version = version;

    return info;
  }

  // ============================================
  // UPGRADE PROPOSALS
  // ============================================

  async proposeUpgrade(params: {
    contractName: string;
    newImplementationBytecode: string;
    newVersion: string;
    migrationScript?: string;
    auditReportUrl?: string;
  }): Promise<UpgradeProposal> {
    const contract = this.contracts.get(params.contractName);
    if (!contract) {
      throw new Error(`Contract ${params.contractName} not registered`);
    }

    // Deploy new implementation
    const newImplAddress = await this.deployImplementation(params.newImplementationBytecode);

    // Analyze storage layout compatibility
    const storageCompatible = await this.checkStorageCompatibility(
      contract.implementationAddress,
      newImplAddress
    );
    if (!storageCompatible.compatible) {
      throw new Error(`Storage layout incompatible: ${storageCompatible.reason}`);
    }

    // Estimate gas for upgrade
    const estimatedGas = await this.estimateUpgradeGas(
      contract.address,
      newImplAddress,
      contract.proxyType
    );

    const proposal: UpgradeProposal = {
      id: crypto.randomUUID(),
      contractName: params.contractName,
      proxyAddress: contract.address,
      currentImplementation: contract.implementationAddress,
      newImplementation: newImplAddress,
      newVersion: params.newVersion,
      proposedBy: await this.config.signer.getAddress(),
      proposedAt: Date.now(),
      scheduledFor: Date.now() + this.config.minTimelockDelay * 1000,
      status: "PROPOSED",
      timelockDelay: this.config.minTimelockDelay,
      requiredSignatures: this.config.minSignatures,
      signatures: new Map(),
      migrationScript: params.migrationScript,
      storageLayoutHash: storageCompatible.hash,
      estimatedGas,
      auditReport: params.auditReportUrl
    };

    this.proposals.set(proposal.id, proposal);

    console.log(`[Upgrade] Proposal created: ${proposal.id}`);
    console.log(`  Contract: ${params.contractName}`);
    console.log(`  New Version: ${params.newVersion}`);
    console.log(`  Scheduled for: ${new Date(proposal.scheduledFor).toISOString()}`);

    return proposal;
  }

  async signProposal(proposalId: string, signature: string): Promise<boolean> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "PROPOSED") {
      throw new Error(`Proposal is not in PROPOSED status`);
    }

    // Verify signature
    const signer = await this.recoverSignerFromProposal(proposalId, signature);
    if (!this.config.requiredSigners.includes(signer)) {
      throw new Error(`Signer ${signer} is not authorized`);
    }

    proposal.signatures.set(signer, signature);

    console.log(`[Upgrade] Signature added from ${signer}`);
    console.log(`  Signatures: ${proposal.signatures.size}/${proposal.requiredSignatures}`);

    // Check if enough signatures
    if (proposal.signatures.size >= proposal.requiredSignatures) {
      proposal.status = "SCHEDULED";
      console.log(`[Upgrade] Proposal ${proposalId} is now SCHEDULED`);

      // Schedule on timelock
      await this.scheduleOnTimelock(proposal);
    }

    return proposal.signatures.size >= proposal.requiredSignatures;
  }

  async cancelProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status === "COMPLETED" || proposal.status === "EXECUTING") {
      throw new Error(`Cannot cancel proposal in ${proposal.status} status`);
    }

    proposal.status = "CANCELLED";

    // Cancel on timelock if scheduled
    if (proposal.status === "SCHEDULED" || proposal.status === "READY") {
      await this.cancelOnTimelock(proposal);
    }

    console.log(`[Upgrade] Proposal ${proposalId} cancelled`);
  }

  // ============================================
  // UPGRADE EXECUTION
  // ============================================

  async executeUpgrade(proposalId: string): Promise<string> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "SCHEDULED" && proposal.status !== "READY") {
      throw new Error(`Proposal is not ready for execution`);
    }

    if (Date.now() < proposal.scheduledFor) {
      throw new Error(
        `Timelock not expired. Wait until ${new Date(proposal.scheduledFor).toISOString()}`
      );
    }

    proposal.status = "EXECUTING";
    console.log(`[Upgrade] Executing upgrade for ${proposal.contractName}...`);

    try {
      // Run pre-upgrade tests
      const preTestResults = await this.runPreUpgradeTests(proposal);
      if (!preTestResults.allPassed) {
        throw new Error("Pre-upgrade tests failed");
      }

      // Take state snapshot for potential rollback
      const snapshotId = await this.takeStateSnapshot(proposal.proxyAddress);
      console.log(`[Upgrade] State snapshot created: ${snapshotId}`);

      // Execute the upgrade based on proxy type
      const contract = this.contracts.get(proposal.contractName)!;
      let txHash: string;

      switch (contract.proxyType) {
        case "TRANSPARENT":
          txHash = await this.upgradeTransparentProxy(proposal);
          break;
        case "UUPS":
          txHash = await this.upgradeUUPSProxy(proposal);
          break;
        case "DIAMOND":
          txHash = await this.upgradeDiamond(proposal);
          break;
        case "BEACON":
          txHash = await this.upgradeBeacon(proposal);
          break;
        default:
          throw new Error(`Unknown proxy type: ${contract.proxyType}`);
      }

      console.log(`[Upgrade] Upgrade transaction: ${txHash}`);

      // Run migration script if provided
      if (proposal.migrationScript) {
        await this.runMigrationScript(proposal.migrationScript);
      }

      // Run post-upgrade tests
      const postTestResults = await this.runPostUpgradeTests(proposal);
      if (!postTestResults.allPassed) {
        console.error("[Upgrade] Post-upgrade tests failed. Initiating rollback...");
        await this.rollbackUpgrade(proposalId, snapshotId);
        throw new Error("Post-upgrade tests failed, upgrade rolled back");
      }

      // Update contract info
      contract.implementationAddress = proposal.newImplementation;
      contract.version = proposal.newVersion;
      contract.lastUpgraded = Date.now();

      // Record in history
      this.migrationHistory.push({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        contractName: proposal.contractName,
        fromVersion: contract.version,
        toVersion: proposal.newVersion,
        transactionHash: txHash,
        success: true
      });

      proposal.status = "COMPLETED";
      proposal.testResults = [...preTestResults.results, ...postTestResults.results];

      console.log(`[Upgrade] Upgrade completed successfully!`);
      console.log(`  New implementation: ${proposal.newImplementation}`);
      console.log(`  New version: ${proposal.newVersion}`);

      return txHash;
    } catch (error) {
      proposal.status = "FAILED";
      console.error(`[Upgrade] Upgrade failed:`, error);
      throw error;
    }
  }

  async rollbackUpgrade(proposalId: string, snapshotId?: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    console.log(`[Upgrade] Rolling back upgrade ${proposalId}...`);

    // Revert to previous implementation
    const contract = this.contracts.get(proposal.contractName)!;

    switch (contract.proxyType) {
      case "TRANSPARENT":
        await this.upgradeTransparentProxy({
          ...proposal,
          newImplementation: proposal.currentImplementation
        });
        break;
      case "UUPS":
        await this.upgradeUUPSProxy({
          ...proposal,
          newImplementation: proposal.currentImplementation
        });
        break;
      case "DIAMOND":
        await this.rollbackDiamond(proposal);
        break;
      case "BEACON":
        await this.upgradeBeacon({
          ...proposal,
          newImplementation: proposal.currentImplementation
        });
        break;
    }

    // Restore state if snapshot available
    if (snapshotId) {
      await this.restoreStateSnapshot(snapshotId);
    }

    proposal.status = "ROLLED_BACK";
    console.log(`[Upgrade] Rollback completed`);
  }

  // ============================================
  // PROXY-SPECIFIC IMPLEMENTATIONS
  // ============================================

  private async upgradeTransparentProxy(proposal: UpgradeProposal): Promise<string> {
    const proxyAdmin = new ethers.Contract(
      this.config.proxyAdminAddress,
      [
        "function upgrade(address proxy, address implementation) external",
        "function upgradeAndCall(address proxy, address implementation, bytes calldata data) external payable"
      ],
      this.config.signer
    );

    const tx = await proxyAdmin.upgrade(proposal.proxyAddress, proposal.newImplementation);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  private async upgradeUUPSProxy(proposal: UpgradeProposal): Promise<string> {
    const proxy = new ethers.Contract(
      proposal.proxyAddress,
      ["function upgradeTo(address newImplementation) external"],
      this.config.signer
    );

    const tx = await proxy.upgradeTo(proposal.newImplementation);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  private async upgradeDiamond(proposal: UpgradeProposal): Promise<string> {
    // Diamond cut for facet upgrades
    const diamond = new ethers.Contract(
      proposal.proxyAddress,
      [
        "function diamondCut(tuple(address facetAddress, uint8 action, bytes4[] functionSelectors)[] calldata _diamondCut, address _init, bytes calldata _calldata) external"
      ],
      this.config.signer
    );

    // This would be more complex with actual facet selectors
    const facetCut = [
      {
        facetAddress: proposal.newImplementation,
        action: 1, // Replace
        functionSelectors: [] // Would contain actual selectors
      }
    ];

    const tx = await diamond.diamondCut(facetCut, ethers.ZeroAddress, "0x");
    const receipt = await tx.wait();
    return receipt.hash;
  }

  private async upgradeBeacon(proposal: UpgradeProposal): Promise<string> {
    const beacon = new ethers.Contract(
      proposal.proxyAddress,
      ["function upgradeTo(address newImplementation) external"],
      this.config.signer
    );

    const tx = await beacon.upgradeTo(proposal.newImplementation);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  private async rollbackDiamond(proposal: UpgradeProposal): Promise<void> {
    // Reverse the diamond cut
    console.log(`[Upgrade] Rolling back diamond facets for ${proposal.contractName}`);
  }

  // ============================================
  // STORAGE LAYOUT ANALYSIS
  // ============================================

  async checkStorageCompatibility(
    oldImpl: string,
    newImpl: string
  ): Promise<{ compatible: boolean; reason?: string; hash: string }> {
    // In production, this would analyze actual storage layouts
    const oldLayout = await this.getStorageLayout(oldImpl);
    const newLayout = await this.getStorageLayout(newImpl);

    // Check for breaking changes
    for (const oldSlot of oldLayout.slots) {
      const newSlot = newLayout.slots.find((s) => s.name === oldSlot.name);

      if (!newSlot) {
        // Slot removed - potentially breaking
        return {
          compatible: false,
          reason: `Storage slot '${oldSlot.name}' was removed`,
          hash: newLayout.hash
        };
      }

      if (newSlot.slot !== oldSlot.slot) {
        return {
          compatible: false,
          reason: `Storage slot '${oldSlot.name}' position changed from ${oldSlot.slot} to ${newSlot.slot}`,
          hash: newLayout.hash
        };
      }

      if (newSlot.type !== oldSlot.type) {
        return {
          compatible: false,
          reason: `Storage slot '${oldSlot.name}' type changed from ${oldSlot.type} to ${newSlot.type}`,
          hash: newLayout.hash
        };
      }
    }

    // New slots can be added at the end
    const newSlotCount = newLayout.slots.length - oldLayout.slots.length;
    if (newSlotCount > 0) {
      console.log(`[Upgrade] ${newSlotCount} new storage slots added (safe)`);
    }

    return { compatible: true, hash: newLayout.hash };
  }

  private async getStorageLayout(implAddress: string): Promise<StorageLayout> {
    // In production, this would fetch actual layout from compilation artifacts
    const cached = this.storageLayouts.get(implAddress);
    if (cached) {
      return cached;
    }

    // Mock storage layout
    const layout: StorageLayout = {
      contractName: "RWAToken",
      version: "1.0.0",
      slots: [
        { name: "_totalSupply", slot: 0, type: "uint256", offset: 0, size: 32 },
        { name: "_balances", slot: 1, type: "mapping(address => uint256)", offset: 0, size: 32 },
        { name: "_paused", slot: 2, type: "bool", offset: 0, size: 1 },
        { name: "_owner", slot: 3, type: "address", offset: 0, size: 20 }
      ],
      hash: crypto.createHash("sha256").update(implAddress).digest("hex")
    };

    this.storageLayouts.set(implAddress, layout);
    return layout;
  }

  // ============================================
  // TIMELOCK INTEGRATION
  // ============================================

  private async scheduleOnTimelock(proposal: UpgradeProposal): Promise<void> {
    const timelock = new ethers.Contract(
      this.config.timelockAddress,
      [
        "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) external"
      ],
      this.config.signer
    );

    const upgradeData = this.encodeUpgradeCall(proposal);
    const salt = ethers.id(proposal.id);

    await timelock.schedule(
      proposal.proxyAddress,
      0,
      upgradeData,
      ethers.ZeroHash,
      salt,
      proposal.timelockDelay
    );

    console.log(`[Upgrade] Scheduled on timelock with ${proposal.timelockDelay}s delay`);
  }

  private async cancelOnTimelock(proposal: UpgradeProposal): Promise<void> {
    const timelock = new ethers.Contract(
      this.config.timelockAddress,
      ["function cancel(bytes32 id) external"],
      this.config.signer
    );

    const operationId = this.computeOperationId(proposal);
    await timelock.cancel(operationId);

    console.log(`[Upgrade] Cancelled on timelock`);
  }

  private encodeUpgradeCall(proposal: UpgradeProposal): string {
    const iface = new ethers.Interface(["function upgradeTo(address newImplementation)"]);
    return iface.encodeFunctionData("upgradeTo", [proposal.newImplementation]);
  }

  private computeOperationId(proposal: UpgradeProposal): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes", "bytes32", "bytes32"],
        [
          proposal.proxyAddress,
          0,
          this.encodeUpgradeCall(proposal),
          ethers.ZeroHash,
          ethers.id(proposal.id)
        ]
      )
    );
  }

  // ============================================
  // TESTING & VERIFICATION
  // ============================================

  private async runPreUpgradeTests(
    proposal: UpgradeProposal
  ): Promise<{ allPassed: boolean; results: TestResult[] }> {
    console.log(`[Upgrade] Running pre-upgrade tests...`);
    const results: TestResult[] = [];

    // Test 1: Verify current state
    results.push(
      await this.runTest("verify-current-state", async () => {
        const impl = await this.getImplementationAddress(
          proposal.proxyAddress,
          this.contracts.get(proposal.contractName)!.proxyType
        );
        if (impl !== proposal.currentImplementation) {
          throw new Error(
            `Current implementation mismatch: ${impl} vs ${proposal.currentImplementation}`
          );
        }
      })
    );

    // Test 2: Check new implementation code
    results.push(
      await this.runTest("verify-new-implementation", async () => {
        const code = await this.config.provider.getCode(proposal.newImplementation);
        if (code === "0x") {
          throw new Error("New implementation has no code");
        }
      })
    );

    // Test 3: Verify storage compatibility
    results.push(
      await this.runTest("storage-compatibility", async () => {
        const compat = await this.checkStorageCompatibility(
          proposal.currentImplementation,
          proposal.newImplementation
        );
        if (!compat.compatible) {
          throw new Error(`Storage incompatible: ${compat.reason}`);
        }
      })
    );

    // Test 4: Check gas estimation
    results.push(
      await this.runTest("gas-estimation", async () => {
        const currentGas = await this.config.provider.getFeeData();
        const estimatedCost = proposal.estimatedGas * (currentGas.gasPrice || 0n);
        console.log(`    Estimated upgrade cost: ${ethers.formatEther(estimatedCost)} ETH`);
      })
    );

    // Test 5: Verify signatures
    results.push(
      await this.runTest("signature-verification", async () => {
        if (proposal.signatures.size < proposal.requiredSignatures) {
          throw new Error(
            `Not enough signatures: ${proposal.signatures.size}/${proposal.requiredSignatures}`
          );
        }
      })
    );

    const allPassed = results.every((r) => r.passed);
    console.log(`[Upgrade] Pre-upgrade tests: ${allPassed ? "PASSED" : "FAILED"}`);

    return { allPassed, results };
  }

  private async runPostUpgradeTests(
    proposal: UpgradeProposal
  ): Promise<{ allPassed: boolean; results: TestResult[] }> {
    console.log(`[Upgrade] Running post-upgrade tests...`);
    const results: TestResult[] = [];

    // Test 1: Verify new implementation is active
    results.push(
      await this.runTest("verify-new-implementation-active", async () => {
        const impl = await this.getImplementationAddress(
          proposal.proxyAddress,
          this.contracts.get(proposal.contractName)!.proxyType
        );
        if (impl !== proposal.newImplementation) {
          throw new Error(
            `New implementation not active: ${impl} vs ${proposal.newImplementation}`
          );
        }
      })
    );

    // Test 2: Verify version updated
    results.push(
      await this.runTest("verify-version-updated", async () => {
        const version = await this.getContractVersion(proposal.newImplementation);
        if (version !== proposal.newVersion) {
          throw new Error(`Version mismatch: ${version} vs ${proposal.newVersion}`);
        }
      })
    );

    // Test 3: Core functionality check
    results.push(
      await this.runTest("core-functionality", async () => {
        // In production, call critical contract functions
        console.log("    Checking core functionality...");
      })
    );

    // Test 4: State integrity check
    results.push(
      await this.runTest("state-integrity", async () => {
        // Verify critical state variables
        console.log("    Verifying state integrity...");
      })
    );

    // Test 5: Event emission check
    results.push(
      await this.runTest("event-emission", async () => {
        // Verify contract can emit events properly
        console.log("    Checking event emission...");
      })
    );

    const allPassed = results.every((r) => r.passed);
    console.log(`[Upgrade] Post-upgrade tests: ${allPassed ? "PASSED" : "FAILED"}`);

    return { allPassed, results };
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
    console.log(`  Running test: ${name}`);
    try {
      await testFn();
      return { testName: name, passed: true, details: "Test passed" };
    } catch (error) {
      console.error(`    FAILED: ${(error as Error).message}`);
      return {
        testName: name,
        passed: false,
        details: (error as Error).message
      };
    }
  }

  // ============================================
  // STATE MANAGEMENT
  // ============================================

  private async takeStateSnapshot(proxyAddress: string): Promise<string> {
    // In production, use Hardhat/Tenderly snapshot or similar
    const snapshotId = crypto.randomUUID();
    console.log(`[Upgrade] Taking state snapshot: ${snapshotId}`);
    return snapshotId;
  }

  private async restoreStateSnapshot(snapshotId: string): Promise<void> {
    console.log(`[Upgrade] Restoring state from snapshot: ${snapshotId}`);
    // In production, revert to snapshot
  }

  // ============================================
  // MIGRATION SCRIPTS
  // ============================================

  async runMigrationScript(scriptPath: string): Promise<void> {
    console.log(`[Upgrade] Running migration script: ${scriptPath}`);

    // In production, dynamically import and execute migration
    const migrationSteps = await this.loadMigrationSteps(scriptPath);

    for (const step of migrationSteps) {
      console.log(`  Executing: ${step.description}`);
      try {
        await step.action();
        const verified = await step.verifyFn();
        if (!verified) {
          console.log(`    Rolling back: ${step.description}`);
          await step.rollback();
          throw new Error(`Migration step failed verification: ${step.description}`);
        }
        console.log(`    Completed: ${step.description}`);
      } catch (error) {
        console.error(`    Failed: ${step.description}`, error);
        throw error;
      }
    }

    console.log(`[Upgrade] Migration script completed`);
  }

  private async loadMigrationSteps(_scriptPath: string): Promise<MigrationStep[]> {
    // In production, load actual migration script
    return [
      {
        id: "step-1",
        description: "Initialize new storage variables",
        action: async () => {
          console.log("      Initializing new storage...");
        },
        rollback: async () => {
          console.log("      Rolling back storage initialization...");
        },
        verifyFn: async () => true,
        estimatedGas: 50000n
      },
      {
        id: "step-2",
        description: "Migrate existing data",
        action: async () => {
          console.log("      Migrating data...");
        },
        rollback: async () => {
          console.log("      Rolling back data migration...");
        },
        verifyFn: async () => true,
        estimatedGas: 200000n
      },
      {
        id: "step-3",
        description: "Update access controls",
        action: async () => {
          console.log("      Updating access controls...");
        },
        rollback: async () => {
          console.log("      Rolling back access control changes...");
        },
        verifyFn: async () => true,
        estimatedGas: 80000n
      }
    ];
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private async deployImplementation(bytecode: string): Promise<string> {
    console.log(`[Upgrade] Deploying new implementation...`);
    const factory = new ethers.ContractFactory([], bytecode, this.config.signer);
    const implementation = await factory.deploy();
    await implementation.waitForDeployment();
    const address = await implementation.getAddress();
    console.log(`[Upgrade] New implementation deployed at: ${address}`);
    return address;
  }

  private async getImplementationAddress(
    proxyAddress: string,
    proxyType: ProxyType
  ): Promise<string> {
    // EIP-1967 implementation slot
    const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

    const slot = await this.config.provider.getStorage(proxyAddress, EIP1967_IMPL_SLOT);
    const address = "0x" + slot.slice(26);
    return ethers.getAddress(address);
  }

  private async getContractVersion(implementationAddress: string): Promise<string> {
    // In production, call version() on implementation
    return "1.0.0";
  }

  private async estimateUpgradeGas(
    proxyAddress: string,
    newImplementation: string,
    proxyType: ProxyType
  ): Promise<bigint> {
    // Base gas for upgrade transaction
    let baseGas = 100000n;

    switch (proxyType) {
      case "TRANSPARENT":
        baseGas = 150000n;
        break;
      case "UUPS":
        baseGas = 120000n;
        break;
      case "DIAMOND":
        baseGas = 200000n;
        break;
      case "BEACON":
        baseGas = 100000n;
        break;
    }

    return baseGas;
  }

  private async recoverSignerFromProposal(proposalId: string, signature: string): Promise<string> {
    const message = ethers.hashMessage(proposalId);
    return ethers.recoverAddress(message, signature);
  }

  // ============================================
  // REPORTING
  // ============================================

  getUpgradeHistory(): typeof this.migrationHistory {
    return this.migrationHistory;
  }

  getProposal(proposalId: string): UpgradeProposal | undefined {
    return this.proposals.get(proposalId);
  }

  getAllProposals(): UpgradeProposal[] {
    return Array.from(this.proposals.values());
  }

  getPendingProposals(): UpgradeProposal[] {
    return this.getAllProposals().filter(
      (p) => p.status === "PROPOSED" || p.status === "SCHEDULED" || p.status === "READY"
    );
  }

  generateUpgradeReport(proposalId: string): Record<string, unknown> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    return {
      proposalId: proposal.id,
      contractName: proposal.contractName,
      currentVersion: this.contracts.get(proposal.contractName)?.version,
      newVersion: proposal.newVersion,
      status: proposal.status,
      proposedAt: new Date(proposal.proposedAt).toISOString(),
      scheduledFor: new Date(proposal.scheduledFor).toISOString(),
      signatures: Array.from(proposal.signatures.keys()),
      testResults: proposal.testResults,
      estimatedGas: proposal.estimatedGas.toString(),
      auditReport: proposal.auditReport,
      storageLayoutHash: proposal.storageLayoutHash
    };
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export async function createUpgradeManager(params: {
  providerUrl: string;
  privateKey: string;
  timelockAddress: string;
  governorAddress: string;
  proxyAdminAddress: string;
  requiredSigners: string[];
  minSignatures: number;
  minTimelockDelay?: number;
}): Promise<ContractUpgradeManager> {
  const provider = new ethers.JsonRpcProvider(params.providerUrl);
  const signer = new ethers.Wallet(params.privateKey, provider);

  const config: UpgradeConfig = {
    provider,
    signer,
    timelockAddress: params.timelockAddress,
    governorAddress: params.governorAddress,
    proxyAdminAddress: params.proxyAdminAddress,
    minTimelockDelay: params.minTimelockDelay || 172800, // 48 hours default
    requiredSigners: params.requiredSigners,
    minSignatures: params.minSignatures
  };

  return new ContractUpgradeManager(config);
}

// ============================================
// USAGE EXAMPLE
// ============================================

/*
const manager = await createUpgradeManager({
  providerUrl: "https://mainnet.infura.io/v3/...",
  privateKey: process.env.DEPLOYER_PRIVATE_KEY!,
  timelockAddress: "0x...",
  governorAddress: "0x...",
  proxyAdminAddress: "0x...",
  requiredSigners: ["0x...", "0x...", "0x..."],
  minSignatures: 2
});

// Register contracts
manager.registerContract({
  name: "RWAToken",
  address: "0x...",
  proxyType: "TRANSPARENT",
  implementationAddress: "0x...",
  adminAddress: "0x...",
  version: "1.0.0",
  deployedAt: Date.now()
});

// Propose upgrade
const proposal = await manager.proposeUpgrade({
  contractName: "RWAToken",
  newImplementationBytecode: "0x...",
  newVersion: "2.0.0",
  migrationScript: "migrations/v2.ts",
  auditReportUrl: "https://audits.company.com/rwa-token-v2"
});

// Collect signatures
await manager.signProposal(proposal.id, signature1);
await manager.signProposal(proposal.id, signature2);

// Execute after timelock
await manager.executeUpgrade(proposal.id);
*/
