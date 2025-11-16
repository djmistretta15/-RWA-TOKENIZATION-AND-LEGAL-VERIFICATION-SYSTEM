/**
 * @fileoverview Redemption Flow Tests
 * @module tests/redemptionFlow
 *
 * AI-GRADE REQUIREMENT: Redemption = on-chain burn + off-chain legal ownership handover
 *
 * Test coverage:
 * - Redemption request validation
 * - On-chain token burning
 * - Legal handover proof verification
 * - Failed redemption handling
 * - Partial redemption flows
 * - Compliance checks during redemption
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Redemption Flow", function () {
  let rwaToken: Contract;
  let rwaRegistry: Contract;
  let owner: Signer;
  let complianceOfficer: Signer;
  let redemptionAgent: Signer;
  let holder1: Signer;
  let holder2: Signer;
  let oracle: Signer;

  const COMMON_PARTITION = ethers.keccak256(ethers.toUtf8Bytes("COMMON"));
  const PREFERRED_PARTITION = ethers.keccak256(ethers.toUtf8Bytes("PREFERRED"));

  const REDEMPTION_STATUS_PENDING = 0;
  const REDEMPTION_STATUS_APPROVED = 1;
  const REDEMPTION_STATUS_EXECUTED = 2;
  const REDEMPTION_STATUS_CANCELLED = 3;
  const REDEMPTION_STATUS_FAILED = 4;

  beforeEach(async function () {
    [owner, complianceOfficer, redemptionAgent, holder1, holder2, oracle] = await ethers.getSigners();

    // Deploy Registry first
    const RWARegistry = await ethers.getContractFactory("RWARegistry");
    rwaRegistry = await RWARegistry.deploy();

    // Deploy Token
    const RWAToken = await ethers.getContractFactory("RWAToken");
    rwaToken = await RWAToken.deploy("RWA Security Token", "RWAST", await rwaRegistry.getAddress());

    // Grant roles
    await rwaToken.grantRole(await rwaToken.COMPLIANCE_OFFICER_ROLE(), await complianceOfficer.getAddress());
    await rwaToken.grantRole(await rwaToken.REDEMPTION_AGENT_ROLE(), await redemptionAgent.getAddress());
    await rwaToken.grantRole(await rwaToken.ORACLE_ROLE(), await oracle.getAddress());

    // Grant token contract role to registry
    await rwaRegistry.grantRole(await rwaRegistry.TOKEN_CONTRACT_ROLE(), await rwaToken.getAddress());

    // Issue tokens to holders
    await rwaToken.connect(complianceOfficer).issueByPartition(COMMON_PARTITION, await holder1.getAddress(), ethers.parseEther("10000"), "0x");
    await rwaToken.connect(complianceOfficer).issueByPartition(COMMON_PARTITION, await holder2.getAddress(), ethers.parseEther("5000"), "0x");
    await rwaToken.connect(complianceOfficer).issueByPartition(PREFERRED_PARTITION, await holder1.getAddress(), ethers.parseEther("2000"), "0x");
  });

  describe("Redemption Request", function () {
    it("should allow holder to request redemption", async function () {
      const redemptionAmount = ethers.parseEther("1000");

      const tx = await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, redemptionAmount, "Liquidity need");

      await expect(tx).to.emit(rwaToken, "RedemptionRequested");
    });

    it("should create redemption request with correct details", async function () {
      const redemptionAmount = ethers.parseEther("1000");
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, redemptionAmount, "Test redemption");

      const requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
      const request = await rwaToken.getRedemptionRequest(requestId);

      expect(request.holder).to.equal(await holder1.getAddress());
      expect(request.amount).to.equal(redemptionAmount);
      expect(request.partition).to.equal(COMMON_PARTITION);
      expect(request.status).to.equal(REDEMPTION_STATUS_PENDING);
    });

    it("should prevent redemption request exceeding balance", async function () {
      const excessiveAmount = ethers.parseEther("20000");

      await expect(rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, excessiveAmount, "Too much")).to.be.revertedWith("Insufficient balance");
    });

    it("should lock redeemed tokens", async function () {
      const redemptionAmount = ethers.parseEther("1000");
      const initialBalance = await rwaToken.balanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, redemptionAmount, "Lock test");

      const availableBalance = await rwaToken.availableBalanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());
      expect(availableBalance).to.equal(initialBalance - redemptionAmount);
    });

    it("should assign unique request ID", async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("100"), "Request 1");
      const requestId1 = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("200"), "Request 2");
      const requestId2 = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());

      expect(requestId1).to.not.equal(requestId2);
    });

    it("should record request timestamp", async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("500"), "Timestamp test");

      const requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
      const request = await rwaToken.getRedemptionRequest(requestId);

      const currentTime = await time.latest();
      expect(request.requestTimestamp).to.be.closeTo(currentTime, 10);
    });
  });

  describe("Redemption Approval", function () {
    let requestId: bigint;

    beforeEach(async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("1000"), "Approval test");
      requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
    });

    it("should allow redemption agent to approve", async function () {
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.status).to.equal(REDEMPTION_STATUS_APPROVED);
    });

    it("should emit RedemptionApproved event", async function () {
      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.emit(rwaToken, "RedemptionApproved").withArgs(requestId);
    });

    it("should prevent non-agent from approving", async function () {
      await expect(rwaToken.connect(holder1).approveRedemption(requestId)).to.be.revertedWithCustomError(rwaToken, "AccessControlUnauthorizedAccount");
    });

    it("should prevent double approval", async function () {
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);

      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.be.revertedWith("Already approved");
    });

    it("should record approver address", async function () {
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.approvedBy).to.equal(await redemptionAgent.getAddress());
    });
  });

  describe("Legal Handover Proof", function () {
    let requestId: bigint;
    const legalHandoverProof = ethers.keccak256(ethers.toUtf8Bytes("Legal ownership transfer document signed and notarized"));

    beforeEach(async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("1000"), "Handover test");
      requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);
    });

    it("should require legal handover proof for execution", async function () {
      await expect(rwaToken.connect(redemptionAgent).executeRedemption(requestId, ethers.ZeroHash)).to.be.revertedWith("Legal handover proof required");
    });

    it("should accept valid legal handover proof", async function () {
      const tx = await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalHandoverProof);

      await expect(tx).to.emit(rwaToken, "RedemptionExecuted");
    });

    it("should store legal handover proof on-chain", async function () {
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalHandoverProof);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.legalHandoverProof).to.equal(legalHandoverProof);
    });

    it("should verify legal handover proof format", async function () {
      // Proof should be non-zero bytes32
      const invalidProof = ethers.ZeroHash;

      await expect(rwaToken.connect(redemptionAgent).executeRedemption(requestId, invalidProof)).to.be.revertedWith("Legal handover proof required");
    });

    it("should link legal proof to specific redemption", async function () {
      const uniqueProof = ethers.keccak256(ethers.toUtf8Bytes(`Unique proof for request ${requestId}`));

      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, uniqueProof);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.legalHandoverProof).to.equal(uniqueProof);
    });
  });

  describe("On-Chain Token Burning", function () {
    let requestId: bigint;
    const redemptionAmount = ethers.parseEther("1000");
    const legalProof = ethers.keccak256(ethers.toUtf8Bytes("Legal handover complete"));

    beforeEach(async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, redemptionAmount, "Burn test");
      requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);
    });

    it("should burn tokens on redemption execution", async function () {
      const initialBalance = await rwaToken.balanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());

      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof);

      const finalBalance = await rwaToken.balanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());
      expect(finalBalance).to.equal(initialBalance - redemptionAmount);
    });

    it("should reduce total supply", async function () {
      const initialSupply = await rwaToken.totalSupplyByPartition(COMMON_PARTITION);

      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof);

      const finalSupply = await rwaToken.totalSupplyByPartition(COMMON_PARTITION);
      expect(finalSupply).to.equal(initialSupply - redemptionAmount);
    });

    it("should emit Burned event", async function () {
      await expect(rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof))
        .to.emit(rwaToken, "Burned")
        .withArgs(await holder1.getAddress(), redemptionAmount, COMMON_PARTITION);
    });

    it("should update redemption status to executed", async function () {
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.status).to.equal(REDEMPTION_STATUS_EXECUTED);
    });

    it("should record execution timestamp", async function () {
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof);

      const request = await rwaToken.getRedemptionRequest(requestId);
      const currentTime = await time.latest();
      expect(request.executedTimestamp).to.be.closeTo(currentTime, 10);
    });

    it("should sync with legal registry", async function () {
      const holder1Address = await holder1.getAddress();
      const initialRegistryBalance = await rwaRegistry.getBalance(holder1Address, COMMON_PARTITION);

      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof);

      const finalRegistryBalance = await rwaRegistry.getBalance(holder1Address, COMMON_PARTITION);
      expect(finalRegistryBalance).to.equal(initialRegistryBalance - redemptionAmount);
    });
  });

  describe("Failed Redemption Handling", function () {
    let requestId: bigint;
    const redemptionAmount = ethers.parseEther("1000");

    beforeEach(async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, redemptionAmount, "Failure test");
      requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
    });

    it("should allow cancellation by holder", async function () {
      await rwaToken.connect(holder1).cancelRedemption(requestId);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.status).to.equal(REDEMPTION_STATUS_CANCELLED);
    });

    it("should unlock tokens on cancellation", async function () {
      const initialAvailable = await rwaToken.availableBalanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());

      await rwaToken.connect(holder1).cancelRedemption(requestId);

      const finalAvailable = await rwaToken.availableBalanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());
      expect(finalAvailable).to.equal(initialAvailable + redemptionAmount);
    });

    it("should emit RedemptionCancelled event", async function () {
      await expect(rwaToken.connect(holder1).cancelRedemption(requestId)).to.emit(rwaToken, "RedemptionCancelled").withArgs(requestId, "User cancelled");
    });

    it("should allow rejection by agent", async function () {
      await rwaToken.connect(redemptionAgent).rejectRedemption(requestId, "Compliance issue");

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.status).to.equal(REDEMPTION_STATUS_FAILED);
    });

    it("should record rejection reason", async function () {
      const rejectReason = "KYC expired";
      await rwaToken.connect(redemptionAgent).rejectRedemption(requestId, rejectReason);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.failureReason).to.equal(rejectReason);
    });

    it("should unlock tokens on rejection", async function () {
      await rwaToken.connect(redemptionAgent).rejectRedemption(requestId, "Rejected");

      const balance = await rwaToken.balanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());
      const available = await rwaToken.availableBalanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());
      expect(balance).to.equal(available);
    });

    it("should prevent execution of cancelled request", async function () {
      await rwaToken.connect(holder1).cancelRedemption(requestId);

      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.be.revertedWith("Invalid request status");
    });

    it("should prevent execution of rejected request", async function () {
      await rwaToken.connect(redemptionAgent).rejectRedemption(requestId, "Rejected");

      const legalProof = ethers.keccak256(ethers.toUtf8Bytes("Proof"));
      await expect(rwaToken.connect(redemptionAgent).executeRedemption(requestId, legalProof)).to.be.revertedWith("Request not approved");
    });
  });

  describe("Partial Redemption", function () {
    it("should allow partial redemption of holdings", async function () {
      const partialAmount = ethers.parseEther("2000"); // Out of 10000

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, partialAmount, "Partial redemption");

      const remainingBalance = await rwaToken.availableBalanceOfByPartition(COMMON_PARTITION, await holder1.getAddress());
      expect(remainingBalance).to.equal(ethers.parseEther("8000"));
    });

    it("should allow multiple partial redemptions", async function () {
      // First partial redemption
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("2000"), "First partial");
      const requestId1 = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId1);
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId1, ethers.keccak256(ethers.toUtf8Bytes("Proof 1")));

      // Second partial redemption
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("3000"), "Second partial");
      const requestId2 = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());

      const request2 = await rwaToken.getRedemptionRequest(requestId2);
      expect(request2.amount).to.equal(ethers.parseEther("3000"));
    });

    it("should track cumulative redemptions", async function () {
      const holder1Address = await holder1.getAddress();

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("1000"), "Part 1");
      const id1 = await rwaToken.getLatestRedemptionRequestId(holder1Address);
      await rwaToken.connect(redemptionAgent).approveRedemption(id1);
      await rwaToken.connect(redemptionAgent).executeRedemption(id1, ethers.keccak256(ethers.toUtf8Bytes("P1")));

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("2000"), "Part 2");
      const id2 = await rwaToken.getLatestRedemptionRequestId(holder1Address);
      await rwaToken.connect(redemptionAgent).approveRedemption(id2);
      await rwaToken.connect(redemptionAgent).executeRedemption(id2, ethers.keccak256(ethers.toUtf8Bytes("P2")));

      const totalRedeemed = await rwaToken.getTotalRedeemed(holder1Address, COMMON_PARTITION);
      expect(totalRedeemed).to.equal(ethers.parseEther("3000"));
    });
  });

  describe("Compliance Checks During Redemption", function () {
    let requestId: bigint;

    beforeEach(async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("1000"), "Compliance test");
      requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
    });

    it("should prevent redemption when account is frozen", async function () {
      await rwaToken.connect(complianceOfficer).freezeAccount(await holder1.getAddress());

      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.be.revertedWith("Account is frozen");
    });

    it("should prevent redemption when asset is frozen", async function () {
      // Assuming there's an asset freeze mechanism
      const assetId = await rwaToken.getAssetId();
      await rwaToken.connect(complianceOfficer).freezeAsset(assetId, "Legal dispute");

      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.be.revertedWith("Asset is frozen");
    });

    it("should prevent redemption when global halt is active", async function () {
      await rwaToken.connect(complianceOfficer).haltRedemptions(true);

      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.be.revertedWith("Redemptions are halted");
    });

    it("should allow redemption after halt is lifted", async function () {
      await rwaToken.connect(complianceOfficer).haltRedemptions(true);
      await rwaToken.connect(complianceOfficer).haltRedemptions(false);

      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.status).to.equal(REDEMPTION_STATUS_APPROVED);
    });

    it("should check lockup period compliance", async function () {
      // Set lockup period for holder
      await rwaToken.connect(complianceOfficer).setLockupPeriod(await holder1.getAddress(), COMMON_PARTITION, 365 * 24 * 3600);

      await expect(rwaToken.connect(redemptionAgent).approveRedemption(requestId)).to.be.revertedWith("Lockup period active");
    });

    it("should allow redemption after lockup expires", async function () {
      await rwaToken.connect(complianceOfficer).setLockupPeriod(await holder1.getAddress(), COMMON_PARTITION, 1 * 24 * 3600);

      // Fast forward past lockup
      await time.increase(2 * 24 * 3600);

      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);

      const request = await rwaToken.getRedemptionRequest(requestId);
      expect(request.status).to.equal(REDEMPTION_STATUS_APPROVED);
    });
  });

  describe("Audit Trail", function () {
    it("should maintain complete redemption history", async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("500"), "History test");
      const requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, ethers.keccak256(ethers.toUtf8Bytes("Proof")));

      const history = await rwaToken.getRedemptionHistory(await holder1.getAddress());
      expect(history.length).to.be.gte(1);
    });

    it("should record all status changes", async function () {
      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("500"), "Status tracking");
      const requestId = await rwaToken.getLatestRedemptionRequestId(await holder1.getAddress());

      const initialStatus = (await rwaToken.getRedemptionRequest(requestId)).status;
      expect(initialStatus).to.equal(REDEMPTION_STATUS_PENDING);

      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);
      const approvedStatus = (await rwaToken.getRedemptionRequest(requestId)).status;
      expect(approvedStatus).to.equal(REDEMPTION_STATUS_APPROVED);

      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, ethers.keccak256(ethers.toUtf8Bytes("Proof")));
      const executedStatus = (await rwaToken.getRedemptionRequest(requestId)).status;
      expect(executedStatus).to.equal(REDEMPTION_STATUS_EXECUTED);
    });

    it("should be queryable for regulatory reporting", async function () {
      // Create multiple redemptions
      for (let i = 0; i < 3; i++) {
        await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("100"), `Request ${i}`);
      }

      const totalRequests = await rwaToken.getTotalRedemptionRequests();
      expect(totalRequests).to.be.gte(3);
    });
  });

  describe("Registry Synchronization", function () {
    it("should sync redemption with legal registry", async function () {
      const holder1Address = await holder1.getAddress();
      const initialRegistryBalance = await rwaRegistry.getBalance(holder1Address, COMMON_PARTITION);

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("1000"), "Registry sync");
      const requestId = await rwaToken.getLatestRedemptionRequestId(holder1Address);
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, ethers.keccak256(ethers.toUtf8Bytes("Legal proof")));

      const finalRegistryBalance = await rwaRegistry.getBalance(holder1Address, COMMON_PARTITION);
      expect(finalRegistryBalance).to.equal(initialRegistryBalance - ethers.parseEther("1000"));
    });

    it("should update registry within same block", async function () {
      const holder1Address = await holder1.getAddress();

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("500"), "Same block sync");
      const requestId = await rwaToken.getLatestRedemptionRequestId(holder1Address);
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);

      const tx = await rwaToken.connect(redemptionAgent).executeRedemption(requestId, ethers.keccak256(ethers.toUtf8Bytes("Proof")));
      const receipt = await tx.wait();

      const tokenBlock = receipt?.blockNumber;
      const registrySyncBlock = await rwaRegistry.getLastSyncBlock(holder1Address, COMMON_PARTITION);

      expect(registrySyncBlock).to.equal(tokenBlock);
    });

    it("should maintain 1-block sync guarantee", async function () {
      const holder1Address = await holder1.getAddress();

      await rwaToken.connect(holder1).requestRedemption(COMMON_PARTITION, ethers.parseEther("750"), "1-block guarantee");
      const requestId = await rwaToken.getLatestRedemptionRequestId(holder1Address);
      await rwaToken.connect(redemptionAgent).approveRedemption(requestId);
      await rwaToken.connect(redemptionAgent).executeRedemption(requestId, ethers.keccak256(ethers.toUtf8Bytes("Legal")));

      const syncStatus = await rwaRegistry.isSyncHealthy(holder1Address, COMMON_PARTITION);
      expect(syncStatus).to.be.true;
    });
  });
});
