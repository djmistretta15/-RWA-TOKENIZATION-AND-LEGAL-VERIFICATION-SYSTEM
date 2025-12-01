import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";

/**
 * RWA Liquidity Vault Test Suite (ERC-4626 Compliant)
 *
 * Tests comprehensive ERC-4626 tokenized vault functionality:
 * - Deposit/withdraw mechanics
 * - Share calculation and accounting
 * - Yield distribution
 * - Compliance-gated access
 * - Asset valuation oracle integration
 * - Redemption queues
 * - Multi-partition support
 */

describe("RWA Liquidity Vault (ERC-4626)", function () {
  let owner: SignerWithAddress;
  let vaultManager: SignerWithAddress;
  let investor1: SignerWithAddress;
  let investor2: SignerWithAddress;
  let investor3: SignerWithAddress;
  let nonWhitelisted: SignerWithAddress;
  let yieldSource: SignerWithAddress;
  let oracle: SignerWithAddress;
  let complianceOfficer: SignerWithAddress;

  // Contracts
  let rwaToken: Contract;
  let liquidityVault: Contract;
  let whitelistAccess: Contract;
  let assetOracle: Contract;
  let yieldDistributor: Contract;

  // Test constants
  const VAULT_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_MANAGER_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const COMPLIANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_ROLE"));
  const YIELD_DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("YIELD_DISTRIBUTOR_ROLE"));

  const INITIAL_DEPOSIT = ethers.parseEther("10000");
  const ONE_SHARE = ethers.parseEther("1");

  beforeEach(async function () {
    [
      owner,
      vaultManager,
      investor1,
      investor2,
      investor3,
      nonWhitelisted,
      yieldSource,
      oracle,
      complianceOfficer,
    ] = await ethers.getSigners();

    // Deploy RWA Token (underlying asset)
    const RWATokenFactory = await ethers.getContractFactory("RWAToken");
    rwaToken = await RWATokenFactory.deploy("Real Estate Token", "RET", owner.getAddress());
    await rwaToken.waitForDeployment();

    // Deploy WhitelistAccess for compliance
    const WhitelistAccessFactory = await ethers.getContractFactory("WhitelistAccess");
    whitelistAccess = await WhitelistAccessFactory.deploy();
    await whitelistAccess.waitForDeployment();

    // Deploy Asset Oracle
    const AssetOracleFactory = await ethers.getContractFactory("AssetValidationOracle");
    assetOracle = await AssetOracleFactory.deploy(ethers.ZeroAddress);
    await assetOracle.waitForDeployment();

    // Deploy Yield Distributor
    const YieldDistributorFactory = await ethers.getContractFactory("YieldDistributor");
    yieldDistributor = await YieldDistributorFactory.deploy(await rwaToken.getAddress());
    await yieldDistributor.waitForDeployment();

    // Deploy Liquidity Vault (ERC-4626)
    const LiquidityVaultFactory = await ethers.getContractFactory("RWALiquidityVault");
    liquidityVault = await LiquidityVaultFactory.deploy(
      await rwaToken.getAddress(),
      "RWA Vault Share",
      "vRWA",
      await whitelistAccess.getAddress(),
      await assetOracle.getAddress()
    );
    await liquidityVault.waitForDeployment();

    // Setup roles
    await liquidityVault.grantRole(VAULT_MANAGER_ROLE, await vaultManager.getAddress());
    await liquidityVault.grantRole(ORACLE_ROLE, await oracle.getAddress());
    await liquidityVault.grantRole(COMPLIANCE_ROLE, await complianceOfficer.getAddress());
    await liquidityVault.grantRole(YIELD_DISTRIBUTOR_ROLE, await yieldDistributor.getAddress());

    // Whitelist investors for compliance
    await whitelistAccess.addToWhitelist(await investor1.getAddress(), "US", "ACCREDITED");
    await whitelistAccess.addToWhitelist(await investor2.getAddress(), "US", "ACCREDITED");
    await whitelistAccess.addToWhitelist(await investor3.getAddress(), "CH", "QUALIFIED");

    // Mint RWA tokens for testing
    await rwaToken.mint(await investor1.getAddress(), ethers.parseEther("100000"));
    await rwaToken.mint(await investor2.getAddress(), ethers.parseEther("100000"));
    await rwaToken.mint(await investor3.getAddress(), ethers.parseEther("100000"));
    await rwaToken.mint(await yieldSource.getAddress(), ethers.parseEther("1000000"));

    // Approve vault to spend tokens
    await rwaToken
      .connect(investor1)
      .approve(await liquidityVault.getAddress(), ethers.MaxUint256);
    await rwaToken
      .connect(investor2)
      .approve(await liquidityVault.getAddress(), ethers.MaxUint256);
    await rwaToken
      .connect(investor3)
      .approve(await liquidityVault.getAddress(), ethers.MaxUint256);
    await rwaToken
      .connect(yieldSource)
      .approve(await liquidityVault.getAddress(), ethers.MaxUint256);
  });

  describe("ERC-4626 Compliance", function () {
    it("should return correct asset address", async function () {
      const asset = await liquidityVault.asset();
      expect(asset).to.equal(await rwaToken.getAddress());
    });

    it("should return correct total assets", async function () {
      // Initially no assets
      expect(await liquidityVault.totalAssets()).to.equal(0);

      // After deposit
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      expect(await liquidityVault.totalAssets()).to.equal(INITIAL_DEPOSIT);
    });

    it("should convert assets to shares correctly", async function () {
      // Initial 1:1 ratio
      const shares = await liquidityVault.convertToShares(INITIAL_DEPOSIT);
      expect(shares).to.equal(INITIAL_DEPOSIT);
    });

    it("should convert shares to assets correctly", async function () {
      // Initial 1:1 ratio
      const assets = await liquidityVault.convertToAssets(ONE_SHARE);
      expect(assets).to.equal(ONE_SHARE);
    });

    it("should return max deposit for whitelisted investor", async function () {
      const maxDeposit = await liquidityVault.maxDeposit(await investor1.getAddress());
      expect(maxDeposit).to.be.gt(0);
    });

    it("should return zero max deposit for non-whitelisted address", async function () {
      const maxDeposit = await liquidityVault.maxDeposit(await nonWhitelisted.getAddress());
      expect(maxDeposit).to.equal(0);
    });

    it("should return max mint for whitelisted investor", async function () {
      const maxMint = await liquidityVault.maxMint(await investor1.getAddress());
      expect(maxMint).to.be.gt(0);
    });

    it("should return max withdraw for shareholder", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      const maxWithdraw = await liquidityVault.maxWithdraw(await investor1.getAddress());
      expect(maxWithdraw).to.equal(INITIAL_DEPOSIT);
    });

    it("should return max redeem for shareholder", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      const shares = await liquidityVault.balanceOf(await investor1.getAddress());
      const maxRedeem = await liquidityVault.maxRedeem(await investor1.getAddress());
      expect(maxRedeem).to.equal(shares);
    });

    it("should preview deposit accurately", async function () {
      const previewShares = await liquidityVault.previewDeposit(INITIAL_DEPOSIT);
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      const actualShares = await liquidityVault.balanceOf(await investor1.getAddress());
      expect(previewShares).to.equal(actualShares);
    });

    it("should preview mint accurately", async function () {
      const previewAssets = await liquidityVault.previewMint(ONE_SHARE);
      const actualAssets = await liquidityVault.convertToAssets(ONE_SHARE);
      expect(previewAssets).to.equal(actualAssets);
    });

    it("should preview withdraw accurately", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      const previewShares = await liquidityVault.previewWithdraw(INITIAL_DEPOSIT);
      const expectedShares = await liquidityVault.balanceOf(await investor1.getAddress());
      expect(previewShares).to.equal(expectedShares);
    });

    it("should preview redeem accurately", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      const shares = await liquidityVault.balanceOf(await investor1.getAddress());
      const previewAssets = await liquidityVault.previewRedeem(shares);
      expect(previewAssets).to.equal(INITIAL_DEPOSIT);
    });
  });

  describe("Deposit Operations", function () {
    it("should allow whitelisted investor to deposit", async function () {
      const tx = await liquidityVault
        .connect(investor1)
        .deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      await expect(tx)
        .to.emit(liquidityVault, "Deposit")
        .withArgs(
          await investor1.getAddress(),
          await investor1.getAddress(),
          INITIAL_DEPOSIT,
          INITIAL_DEPOSIT
        );

      const shares = await liquidityVault.balanceOf(await investor1.getAddress());
      expect(shares).to.equal(INITIAL_DEPOSIT);
    });

    it("should reject deposit from non-whitelisted address", async function () {
      await rwaToken.mint(await nonWhitelisted.getAddress(), INITIAL_DEPOSIT);
      await rwaToken
        .connect(nonWhitelisted)
        .approve(await liquidityVault.getAddress(), INITIAL_DEPOSIT);

      await expect(
        liquidityVault.connect(nonWhitelisted).deposit(INITIAL_DEPOSIT, await nonWhitelisted.getAddress())
      ).to.be.revertedWith("Depositor not whitelisted");
    });

    it("should reject deposit to non-whitelisted receiver", async function () {
      await expect(
        liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await nonWhitelisted.getAddress())
      ).to.be.revertedWith("Receiver not whitelisted");
    });

    it("should update total assets after deposit", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      expect(await liquidityVault.totalAssets()).to.equal(INITIAL_DEPOSIT);

      await liquidityVault.connect(investor2).deposit(INITIAL_DEPOSIT, await investor2.getAddress());
      expect(await liquidityVault.totalAssets()).to.equal(INITIAL_DEPOSIT * 2n);
    });

    it("should enforce minimum deposit amount", async function () {
      const minDeposit = ethers.parseEther("100");
      await liquidityVault.connect(vaultManager).setMinimumDeposit(minDeposit);

      await expect(
        liquidityVault.connect(investor1).deposit(ethers.parseEther("50"), await investor1.getAddress())
      ).to.be.revertedWith("Below minimum deposit");
    });

    it("should enforce maximum total deposits", async function () {
      const maxTotalDeposits = ethers.parseEther("15000");
      await liquidityVault.connect(vaultManager).setMaxTotalDeposits(maxTotalDeposits);

      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      await expect(
        liquidityVault.connect(investor2).deposit(INITIAL_DEPOSIT, await investor2.getAddress())
      ).to.be.revertedWith("Exceeds maximum total deposits");
    });

    it("should track deposit history", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      const depositHistory = await liquidityVault.getDepositHistory(await investor1.getAddress());
      expect(depositHistory.length).to.equal(1);
      expect(depositHistory[0].amount).to.equal(INITIAL_DEPOSIT);
      expect(depositHistory[0].sharesMinted).to.equal(INITIAL_DEPOSIT);
    });
  });

  describe("Mint Operations", function () {
    it("should allow minting exact shares", async function () {
      const sharesToMint = ethers.parseEther("5000");
      const tx = await liquidityVault.connect(investor1).mint(sharesToMint, await investor1.getAddress());

      await expect(tx).to.emit(liquidityVault, "Deposit");

      const shares = await liquidityVault.balanceOf(await investor1.getAddress());
      expect(shares).to.equal(sharesToMint);
    });

    it("should calculate correct asset amount for mint", async function () {
      // After initial deposit, ratio changes with yield
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      // Add yield to vault
      await rwaToken.connect(yieldSource).transfer(await liquidityVault.getAddress(), ethers.parseEther("1000"));

      // Now shares are worth more
      const sharesToMint = ethers.parseEther("100");
      const assetsRequired = await liquidityVault.previewMint(sharesToMint);
      expect(assetsRequired).to.be.gt(sharesToMint);
    });

    it("should reject mint from non-whitelisted address", async function () {
      await expect(
        liquidityVault.connect(nonWhitelisted).mint(ONE_SHARE, await nonWhitelisted.getAddress())
      ).to.be.revertedWith("Minter not whitelisted");
    });
  });

  describe("Withdraw Operations", function () {
    beforeEach(async function () {
      // Setup: investor1 deposits
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
    });

    it("should allow shareholder to withdraw assets", async function () {
      const withdrawAmount = ethers.parseEther("5000");
      const initialBalance = await rwaToken.balanceOf(await investor1.getAddress());

      const tx = await liquidityVault
        .connect(investor1)
        .withdraw(withdrawAmount, await investor1.getAddress(), await investor1.getAddress());

      await expect(tx).to.emit(liquidityVault, "Withdraw");

      const finalBalance = await rwaToken.balanceOf(await investor1.getAddress());
      expect(finalBalance - initialBalance).to.equal(withdrawAmount);
    });

    it("should burn correct amount of shares on withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("5000");
      const initialShares = await liquidityVault.balanceOf(await investor1.getAddress());

      await liquidityVault
        .connect(investor1)
        .withdraw(withdrawAmount, await investor1.getAddress(), await investor1.getAddress());

      const finalShares = await liquidityVault.balanceOf(await investor1.getAddress());
      expect(initialShares - finalShares).to.equal(withdrawAmount);
    });

    it("should reject withdrawal exceeding balance", async function () {
      const excessiveAmount = ethers.parseEther("20000");

      await expect(
        liquidityVault
          .connect(investor1)
          .withdraw(excessiveAmount, await investor1.getAddress(), await investor1.getAddress())
      ).to.be.revertedWith("ERC4626: withdraw more than max");
    });

    it("should allow approved operator to withdraw", async function () {
      // Investor1 approves investor2 to manage shares
      await liquidityVault.connect(investor1).approve(await investor2.getAddress(), ethers.MaxUint256);

      const withdrawAmount = ethers.parseEther("5000");
      const tx = await liquidityVault
        .connect(investor2)
        .withdraw(withdrawAmount, await investor2.getAddress(), await investor1.getAddress());

      await expect(tx).to.emit(liquidityVault, "Withdraw");
    });

    it("should enforce withdrawal lockup period", async function () {
      // Set lockup period
      const lockupDays = 30;
      await liquidityVault.connect(vaultManager).setWithdrawalLockup(lockupDays);

      // New deposit
      await liquidityVault.connect(investor2).deposit(INITIAL_DEPOSIT, await investor2.getAddress());

      // Try immediate withdrawal
      await expect(
        liquidityVault
          .connect(investor2)
          .withdraw(ethers.parseEther("1000"), await investor2.getAddress(), await investor2.getAddress())
      ).to.be.revertedWith("Withdrawal lockup period not elapsed");
    });

    it("should allow withdrawal after lockup period", async function () {
      const lockupDays = 30;
      await liquidityVault.connect(vaultManager).setWithdrawalLockup(lockupDays);

      await liquidityVault.connect(investor2).deposit(INITIAL_DEPOSIT, await investor2.getAddress());

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [lockupDays * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      // Now withdrawal should succeed
      const tx = await liquidityVault
        .connect(investor2)
        .withdraw(ethers.parseEther("1000"), await investor2.getAddress(), await investor2.getAddress());

      await expect(tx).to.emit(liquidityVault, "Withdraw");
    });
  });

  describe("Redeem Operations", function () {
    beforeEach(async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
    });

    it("should allow shareholder to redeem shares", async function () {
      const sharesToRedeem = ethers.parseEther("5000");
      const initialBalance = await rwaToken.balanceOf(await investor1.getAddress());

      const tx = await liquidityVault
        .connect(investor1)
        .redeem(sharesToRedeem, await investor1.getAddress(), await investor1.getAddress());

      await expect(tx).to.emit(liquidityVault, "Withdraw");

      const finalBalance = await rwaToken.balanceOf(await investor1.getAddress());
      expect(finalBalance - initialBalance).to.equal(sharesToRedeem);
    });

    it("should redeem all shares correctly", async function () {
      const allShares = await liquidityVault.balanceOf(await investor1.getAddress());

      await liquidityVault
        .connect(investor1)
        .redeem(allShares, await investor1.getAddress(), await investor1.getAddress());

      const remainingShares = await liquidityVault.balanceOf(await investor1.getAddress());
      expect(remainingShares).to.equal(0);

      const vaultAssets = await liquidityVault.totalAssets();
      expect(vaultAssets).to.equal(0);
    });

    it("should reject redeem exceeding balance", async function () {
      const excessiveShares = ethers.parseEther("20000");

      await expect(
        liquidityVault
          .connect(investor1)
          .redeem(excessiveShares, await investor1.getAddress(), await investor1.getAddress())
      ).to.be.revertedWith("ERC4626: redeem more than max");
    });

    it("should track redemption history", async function () {
      const sharesToRedeem = ethers.parseEther("3000");
      await liquidityVault
        .connect(investor1)
        .redeem(sharesToRedeem, await investor1.getAddress(), await investor1.getAddress());

      const redemptionHistory = await liquidityVault.getRedemptionHistory(await investor1.getAddress());
      expect(redemptionHistory.length).to.equal(1);
      expect(redemptionHistory[0].sharesBurned).to.equal(sharesToRedeem);
    });
  });

  describe("Yield Distribution", function () {
    beforeEach(async function () {
      // Multiple investors deposit
      await liquidityVault.connect(investor1).deposit(ethers.parseEther("6000"), await investor1.getAddress());
      await liquidityVault.connect(investor2).deposit(ethers.parseEther("4000"), await investor2.getAddress());
    });

    it("should distribute yield proportionally to shareholders", async function () {
      // Add yield to vault (simulating rental income)
      const yieldAmount = ethers.parseEther("1000");
      await rwaToken.connect(yieldSource).transfer(await liquidityVault.getAddress(), yieldAmount);

      // Total assets now includes yield
      const totalAssets = await liquidityVault.totalAssets();
      expect(totalAssets).to.equal(ethers.parseEther("11000"));

      // Shares are now worth more
      const investor1Assets = await liquidityVault.convertToAssets(
        await liquidityVault.balanceOf(await investor1.getAddress())
      );
      const investor2Assets = await liquidityVault.convertToAssets(
        await liquidityVault.balanceOf(await investor2.getAddress())
      );

      // Investor1 should have 60% of yield (600), Investor2 40% (400)
      expect(investor1Assets).to.equal(ethers.parseEther("6600"));
      expect(investor2Assets).to.equal(ethers.parseEther("4400"));
    });

    it("should track yield per share", async function () {
      const initialYieldPerShare = await liquidityVault.yieldPerShare();

      // Add yield
      await rwaToken.connect(yieldSource).transfer(await liquidityVault.getAddress(), ethers.parseEther("500"));

      const newYieldPerShare = await liquidityVault.yieldPerShare();
      expect(newYieldPerShare).to.be.gt(initialYieldPerShare);
    });

    it("should emit YieldDistributed event", async function () {
      const yieldAmount = ethers.parseEther("1000");

      const tx = await liquidityVault.connect(vaultManager).recordYieldDistribution(yieldAmount);

      await expect(tx)
        .to.emit(liquidityVault, "YieldDistributed")
        .withArgs(yieldAmount, await ethers.provider.getBlock("latest").then((b) => b!.timestamp));
    });

    it("should compound yields correctly", async function () {
      // First yield distribution
      await rwaToken.connect(yieldSource).transfer(await liquidityVault.getAddress(), ethers.parseEther("1000"));

      // Second yield distribution
      await rwaToken.connect(yieldSource).transfer(await liquidityVault.getAddress(), ethers.parseEther("1000"));

      // Total assets should reflect compounded yields
      const totalAssets = await liquidityVault.totalAssets();
      expect(totalAssets).to.equal(ethers.parseEther("12000")); // 10000 + 1000 + 1000
    });

    it("should calculate APY correctly", async function () {
      // Record multiple yield events over time
      await liquidityVault.connect(vaultManager).recordYieldDistribution(ethers.parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]); // 30 days
      await ethers.provider.send("evm_mine", []);

      await liquidityVault.connect(vaultManager).recordYieldDistribution(ethers.parseEther("100"));

      const apy = await liquidityVault.calculateAPY();
      expect(apy).to.be.gt(0);
    });
  });

  describe("Asset Valuation Oracle Integration", function () {
    beforeEach(async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
    });

    it("should update vault value based on oracle price", async function () {
      // Oracle reports 10% appreciation
      const appreciatedValue = ethers.parseEther("11000");
      await assetOracle.connect(oracle).updateAssetValue(await rwaToken.getAddress(), appreciatedValue);

      // Update vault valuation
      await liquidityVault.connect(vaultManager).syncOracleValuation();

      const totalAssets = await liquidityVault.totalAssets();
      expect(totalAssets).to.equal(appreciatedValue);
    });

    it("should handle asset depreciation", async function () {
      // Oracle reports 20% depreciation
      const depreciatedValue = ethers.parseEther("8000");
      await assetOracle.connect(oracle).updateAssetValue(await rwaToken.getAddress(), depreciatedValue);

      await liquidityVault.connect(vaultManager).syncOracleValuation();

      const totalAssets = await liquidityVault.totalAssets();
      expect(totalAssets).to.equal(depreciatedValue);

      // Share value decreased
      const shareValue = await liquidityVault.convertToAssets(ONE_SHARE);
      expect(shareValue).to.be.lt(ONE_SHARE);
    });

    it("should emit ValuationUpdated event", async function () {
      const newValue = ethers.parseEther("12000");
      await assetOracle.connect(oracle).updateAssetValue(await rwaToken.getAddress(), newValue);

      const tx = await liquidityVault.connect(vaultManager).syncOracleValuation();

      await expect(tx).to.emit(liquidityVault, "ValuationUpdated").withArgs(INITIAL_DEPOSIT, newValue);
    });

    it("should reject stale oracle data", async function () {
      // Set oracle data timestamp to be old
      await ethers.provider.send("evm_increaseTime", [86400 * 7]); // 7 days
      await ethers.provider.send("evm_mine", []);

      await expect(liquidityVault.connect(vaultManager).syncOracleValuation()).to.be.revertedWith(
        "Oracle data too stale"
      );
    });

    it("should validate oracle consensus before updating", async function () {
      // Only 1 oracle source (need 2/3 consensus)
      await assetOracle.connect(oracle).updateAssetValue(await rwaToken.getAddress(), ethers.parseEther("11000"));

      const isConsensusReached = await liquidityVault.checkOracleConsensus();
      expect(isConsensusReached).to.be.false;
    });
  });

  describe("Redemption Queue", function () {
    beforeEach(async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
      await liquidityVault.connect(investor2).deposit(INITIAL_DEPOSIT, await investor2.getAddress());

      // Enable queue mode
      await liquidityVault.connect(vaultManager).enableRedemptionQueue();
    });

    it("should queue large redemptions", async function () {
      const largeRedemption = ethers.parseEther("8000");
      const tx = await liquidityVault
        .connect(investor1)
        .queueRedemption(largeRedemption, await investor1.getAddress());

      await expect(tx)
        .to.emit(liquidityVault, "RedemptionQueued")
        .withArgs(await investor1.getAddress(), largeRedemption, 0);
    });

    it("should process queue in FIFO order", async function () {
      // Queue two redemptions
      await liquidityVault.connect(investor1).queueRedemption(ethers.parseEther("5000"), await investor1.getAddress());
      await liquidityVault.connect(investor2).queueRedemption(ethers.parseEther("3000"), await investor2.getAddress());

      const queue = await liquidityVault.getRedemptionQueue();
      expect(queue[0].investor).to.equal(await investor1.getAddress());
      expect(queue[1].investor).to.equal(await investor2.getAddress());

      // Process first in queue
      await liquidityVault.connect(vaultManager).processNextRedemption();

      const remainingQueue = await liquidityVault.getRedemptionQueue();
      expect(remainingQueue[0].investor).to.equal(await investor2.getAddress());
    });

    it("should handle partial redemptions when liquidity is limited", async function () {
      // Large redemption request
      await liquidityVault.connect(investor1).queueRedemption(ethers.parseEther("15000"), await investor1.getAddress());

      // Process with available liquidity
      await liquidityVault.connect(vaultManager).processQueueWithLiquidity(ethers.parseEther("10000"));

      // Check partial fulfillment
      const queueEntry = await liquidityVault.getQueueEntry(0);
      expect(queueEntry.remainingAmount).to.equal(ethers.parseEther("5000"));
    });

    it("should cancel queued redemption", async function () {
      await liquidityVault.connect(investor1).queueRedemption(ethers.parseEther("5000"), await investor1.getAddress());

      const tx = await liquidityVault.connect(investor1).cancelQueuedRedemption(0);

      await expect(tx).to.emit(liquidityVault, "RedemptionCancelled");
    });

    it("should prevent queue manipulation", async function () {
      await liquidityVault.connect(investor1).queueRedemption(ethers.parseEther("5000"), await investor1.getAddress());

      // Other user tries to cancel
      await expect(liquidityVault.connect(investor2).cancelQueuedRedemption(0)).to.be.revertedWith(
        "Not queue owner"
      );
    });

    it("should track queue position and estimated wait time", async function () {
      await liquidityVault.connect(investor1).queueRedemption(ethers.parseEther("5000"), await investor1.getAddress());
      await liquidityVault.connect(investor2).queueRedemption(ethers.parseEther("3000"), await investor2.getAddress());

      const investor2Position = await liquidityVault.getQueuePosition(await investor2.getAddress());
      expect(investor2Position).to.equal(1); // Second in queue (0-indexed)

      const estimatedWait = await liquidityVault.estimateWaitTime(await investor2.getAddress());
      expect(estimatedWait).to.be.gt(0);
    });
  });

  describe("Multi-Partition Support", function () {
    const PARTITION_A = ethers.keccak256(ethers.toUtf8Bytes("PARTITION_A"));
    const PARTITION_B = ethers.keccak256(ethers.toUtf8Bytes("PARTITION_B"));

    beforeEach(async function () {
      // Setup partitions
      await liquidityVault.connect(vaultManager).createPartition(PARTITION_A, "Commercial Real Estate");
      await liquidityVault.connect(vaultManager).createPartition(PARTITION_B, "Residential Real Estate");
    });

    it("should deposit to specific partition", async function () {
      const tx = await liquidityVault
        .connect(investor1)
        .depositToPartition(PARTITION_A, INITIAL_DEPOSIT, await investor1.getAddress());

      await expect(tx).to.emit(liquidityVault, "PartitionDeposit").withArgs(PARTITION_A, INITIAL_DEPOSIT);

      const partitionBalance = await liquidityVault.partitionBalanceOf(
        await investor1.getAddress(),
        PARTITION_A
      );
      expect(partitionBalance).to.equal(INITIAL_DEPOSIT);
    });

    it("should track total assets per partition", async function () {
      await liquidityVault
        .connect(investor1)
        .depositToPartition(PARTITION_A, ethers.parseEther("6000"), await investor1.getAddress());
      await liquidityVault
        .connect(investor2)
        .depositToPartition(PARTITION_B, ethers.parseEther("4000"), await investor2.getAddress());

      const partitionAAssets = await liquidityVault.totalPartitionAssets(PARTITION_A);
      const partitionBAssets = await liquidityVault.totalPartitionAssets(PARTITION_B);

      expect(partitionAAssets).to.equal(ethers.parseEther("6000"));
      expect(partitionBAssets).to.equal(ethers.parseEther("4000"));
    });

    it("should withdraw from specific partition", async function () {
      await liquidityVault
        .connect(investor1)
        .depositToPartition(PARTITION_A, INITIAL_DEPOSIT, await investor1.getAddress());

      const withdrawAmount = ethers.parseEther("5000");
      await liquidityVault
        .connect(investor1)
        .withdrawFromPartition(PARTITION_A, withdrawAmount, await investor1.getAddress());

      const remainingBalance = await liquidityVault.partitionBalanceOf(
        await investor1.getAddress(),
        PARTITION_A
      );
      expect(remainingBalance).to.equal(ethers.parseEther("5000"));
    });

    it("should prevent cross-partition withdrawal", async function () {
      await liquidityVault
        .connect(investor1)
        .depositToPartition(PARTITION_A, INITIAL_DEPOSIT, await investor1.getAddress());

      await expect(
        liquidityVault
          .connect(investor1)
          .withdrawFromPartition(PARTITION_B, ethers.parseEther("5000"), await investor1.getAddress())
      ).to.be.revertedWith("Insufficient partition balance");
    });

    it("should distribute yields per partition", async function () {
      await liquidityVault
        .connect(investor1)
        .depositToPartition(PARTITION_A, ethers.parseEther("6000"), await investor1.getAddress());
      await liquidityVault
        .connect(investor2)
        .depositToPartition(PARTITION_B, ethers.parseEther("4000"), await investor2.getAddress());

      // Partition A yield
      await liquidityVault.connect(vaultManager).addPartitionYield(PARTITION_A, ethers.parseEther("600"));
      // Partition B yield
      await liquidityVault.connect(vaultManager).addPartitionYield(PARTITION_B, ethers.parseEther("200"));

      const partitionAAssets = await liquidityVault.totalPartitionAssets(PARTITION_A);
      const partitionBAssets = await liquidityVault.totalPartitionAssets(PARTITION_B);

      expect(partitionAAssets).to.equal(ethers.parseEther("6600"));
      expect(partitionBAssets).to.equal(ethers.parseEther("4200"));
    });

    it("should transfer shares between partitions", async function () {
      await liquidityVault
        .connect(investor1)
        .depositToPartition(PARTITION_A, INITIAL_DEPOSIT, await investor1.getAddress());

      const transferAmount = ethers.parseEther("3000");
      await liquidityVault
        .connect(investor1)
        .transferBetweenPartitions(PARTITION_A, PARTITION_B, transferAmount);

      const partitionABalance = await liquidityVault.partitionBalanceOf(
        await investor1.getAddress(),
        PARTITION_A
      );
      const partitionBBalance = await liquidityVault.partitionBalanceOf(
        await investor1.getAddress(),
        PARTITION_B
      );

      expect(partitionABalance).to.equal(ethers.parseEther("7000"));
      expect(partitionBBalance).to.equal(ethers.parseEther("3000"));
    });
  });

  describe("Compliance Integration", function () {
    it("should reject transfer to non-compliant address", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      const shares = await liquidityVault.balanceOf(await investor1.getAddress());

      await expect(
        liquidityVault.connect(investor1).transfer(await nonWhitelisted.getAddress(), shares)
      ).to.be.revertedWith("Recipient not whitelisted");
    });

    it("should enforce accreditation requirements", async function () {
      // Set vault to require accredited investors only
      await liquidityVault.connect(complianceOfficer).setAccreditedOnly(true);

      // Remove accreditation from investor
      await whitelistAccess.updateInvestorStatus(await investor1.getAddress(), "US", "NON_ACCREDITED");

      await expect(
        liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress())
      ).to.be.revertedWith("Accredited investor required");
    });

    it("should enforce jurisdiction restrictions", async function () {
      // Block specific jurisdiction
      await liquidityVault.connect(complianceOfficer).blockJurisdiction("US");

      await expect(
        liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress())
      ).to.be.revertedWith("Jurisdiction restricted");

      // Swiss investor should still be allowed
      const tx = await liquidityVault.connect(investor3).deposit(INITIAL_DEPOSIT, await investor3.getAddress());
      await expect(tx).to.emit(liquidityVault, "Deposit");
    });

    it("should track investor concentration limits", async function () {
      // Set max ownership percentage to 40%
      await liquidityVault.connect(complianceOfficer).setMaxOwnershipPercent(4000); // 40% in basis points

      await liquidityVault.connect(investor1).deposit(ethers.parseEther("8000"), await investor1.getAddress());

      // This would make investor1 own 75% of vault
      await expect(
        liquidityVault.connect(investor1).deposit(ethers.parseEther("16000"), await investor1.getAddress())
      ).to.be.revertedWith("Exceeds ownership concentration limit");
    });

    it("should generate compliance report", async function () {
      await liquidityVault.connect(investor1).deposit(ethers.parseEther("6000"), await investor1.getAddress());
      await liquidityVault.connect(investor2).deposit(ethers.parseEther("4000"), await investor2.getAddress());

      const report = await liquidityVault.generateComplianceReport();

      expect(report.totalInvestors).to.equal(2);
      expect(report.accreditedInvestorCount).to.equal(2);
      expect(report.jurisdictionBreakdown.length).to.be.gt(0);
    });
  });

  describe("Emergency Controls", function () {
    beforeEach(async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
    });

    it("should pause all operations in emergency", async function () {
      await liquidityVault.connect(vaultManager).pause();

      await expect(
        liquidityVault.connect(investor2).deposit(INITIAL_DEPOSIT, await investor2.getAddress())
      ).to.be.revertedWith("Pausable: paused");

      await expect(
        liquidityVault
          .connect(investor1)
          .withdraw(ethers.parseEther("1000"), await investor1.getAddress(), await investor1.getAddress())
      ).to.be.revertedWith("Pausable: paused");
    });

    it("should allow emergency withdrawal by owner", async function () {
      await liquidityVault.connect(vaultManager).pause();

      // Emergency withdrawal still allowed for vault manager
      const tx = await liquidityVault.connect(vaultManager).emergencyWithdrawAll(await owner.getAddress());

      await expect(tx).to.emit(liquidityVault, "EmergencyWithdrawal");

      const vaultBalance = await rwaToken.balanceOf(await liquidityVault.getAddress());
      expect(vaultBalance).to.equal(0);
    });

    it("should maintain share accounting after emergency", async function () {
      const initialShares = await liquidityVault.totalSupply();

      await liquidityVault.connect(vaultManager).pause();
      await liquidityVault.connect(vaultManager).unpause();

      const finalShares = await liquidityVault.totalSupply();
      expect(finalShares).to.equal(initialShares);
    });

    it("should trigger circuit breaker on large withdrawal", async function () {
      // Set circuit breaker threshold
      await liquidityVault.connect(vaultManager).setCircuitBreakerThreshold(5000); // 50%

      // Try to withdraw more than 50%
      await expect(
        liquidityVault
          .connect(investor1)
          .withdraw(ethers.parseEther("6000"), await investor1.getAddress(), await investor1.getAddress())
      ).to.be.revertedWith("Circuit breaker triggered");
    });
  });

  describe("Fee Management", function () {
    beforeEach(async function () {
      // Set management fee (2% annual)
      await liquidityVault.connect(vaultManager).setManagementFee(200); // 200 basis points

      // Set performance fee (20%)
      await liquidityVault.connect(vaultManager).setPerformanceFee(2000); // 2000 basis points

      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());
    });

    it("should deduct management fees periodically", async function () {
      // Fast forward 1 year
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      await liquidityVault.connect(vaultManager).collectManagementFees();

      // 2% of 10000 = 200
      const collectedFees = await liquidityVault.totalCollectedFees();
      expect(collectedFees).to.be.closeTo(ethers.parseEther("200"), ethers.parseEther("10")); // Approximate due to compounding
    });

    it("should deduct performance fees on profit", async function () {
      // Add yield (profit)
      const yieldAmount = ethers.parseEther("1000");
      await rwaToken.connect(yieldSource).transfer(await liquidityVault.getAddress(), yieldAmount);

      await liquidityVault.connect(vaultManager).collectPerformanceFees();

      // 20% of 1000 = 200
      const performanceFees = await liquidityVault.totalPerformanceFees();
      expect(performanceFees).to.equal(ethers.parseEther("200"));
    });

    it("should track fee breakdown for investor", async function () {
      // Fast forward and collect fees
      await ethers.provider.send("evm_increaseTime", [180 * 24 * 60 * 60]); // 6 months
      await ethers.provider.send("evm_mine", []);

      await liquidityVault.connect(vaultManager).collectManagementFees();

      const feeBreakdown = await liquidityVault.getInvestorFeeBreakdown(await investor1.getAddress());

      expect(feeBreakdown.managementFeesPaid).to.be.gt(0);
      expect(feeBreakdown.netReturns).to.equal(feeBreakdown.grossReturns - feeBreakdown.managementFeesPaid);
    });

    it("should allow fee waiver for early investors", async function () {
      // Waive fees for investor1
      await liquidityVault.connect(vaultManager).waiveFees(await investor1.getAddress(), true);

      // Fast forward
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      const feeBreakdown = await liquidityVault.getInvestorFeeBreakdown(await investor1.getAddress());
      expect(feeBreakdown.managementFeesPaid).to.equal(0);
    });
  });

  describe("Audit Trail", function () {
    it("should log all deposit events with details", async function () {
      const tx = await liquidityVault
        .connect(investor1)
        .deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      const receipt = await tx.wait();
      const event = receipt.logs.find((log: any) => log.topics[0] === liquidityVault.interface.getEvent("Deposit").topicHash);

      expect(event).to.not.be.undefined;
    });

    it("should maintain immutable transaction history", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      const history = await liquidityVault.getTransactionHistory(await investor1.getAddress());
      expect(history.length).to.equal(1);
      expect(history[0].txType).to.equal("DEPOSIT");
      expect(history[0].amount).to.equal(INITIAL_DEPOSIT);
    });

    it("should export audit data for regulators", async function () {
      await liquidityVault.connect(investor1).deposit(ethers.parseEther("6000"), await investor1.getAddress());
      await liquidityVault.connect(investor2).deposit(ethers.parseEther("4000"), await investor2.getAddress());

      const auditData = await liquidityVault.exportAuditData(0, 100);

      expect(auditData.transactions.length).to.equal(2);
      expect(auditData.totalVolume).to.equal(INITIAL_DEPOSIT * 2n);
    });

    it("should verify data integrity with checksums", async function () {
      await liquidityVault.connect(investor1).deposit(INITIAL_DEPOSIT, await investor1.getAddress());

      const checksum = await liquidityVault.computeStateChecksum();
      expect(checksum).to.not.equal(ethers.ZeroHash);

      // Verify checksum hasn't changed
      const verifiedChecksum = await liquidityVault.computeStateChecksum();
      expect(verifiedChecksum).to.equal(checksum);
    });
  });
});
