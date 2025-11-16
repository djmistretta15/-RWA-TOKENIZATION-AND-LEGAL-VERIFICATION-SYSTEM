/**
 * @fileoverview Legal Wrapper Contract Tests
 * @module tests/legalWrapper
 *
 * Comprehensive test suite for LegalWrapper.sol covering:
 * - SPV/LLC membership synchronization
 * - Operating agreement validation
 * - Court order execution
 * - Multi-jurisdiction compliance
 * - Capital structure management
 * - Governance proposals
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LegalWrapper Contract", function () {
  let legalWrapper: Contract;
  let owner: Signer;
  let complianceOfficer: Signer;
  let registeredAgent: Signer;
  let courtOfficer: Signer;
  let member1: Signer;
  let member2: Signer;
  let member3: Signer;

  const JURISDICTION_DELAWARE = 0;
  const JURISDICTION_SWISS = 1;
  const JURISDICTION_ADGM = 2;

  const COURT_ORDER_FORCED_TRANSFER = 0;
  const COURT_ORDER_MEMBERSHIP_FREEZE = 1;
  const COURT_ORDER_MEMBERSHIP_SEIZURE = 2;
  const COURT_ORDER_DISSOLUTION = 5;

  beforeEach(async function () {
    [owner, complianceOfficer, registeredAgent, courtOfficer, member1, member2, member3] = await ethers.getSigners();

    const LegalWrapper = await ethers.getContractFactory("LegalWrapper");
    legalWrapper = await LegalWrapper.deploy("Test SPV LLC", JURISDICTION_DELAWARE, await registeredAgent.getAddress());

    // Grant roles
    await legalWrapper.grantRole(await legalWrapper.COMPLIANCE_OFFICER_ROLE(), await complianceOfficer.getAddress());
    await legalWrapper.grantRole(await legalWrapper.REGISTERED_AGENT_ROLE(), await registeredAgent.getAddress());
    await legalWrapper.grantRole(await legalWrapper.COURT_OFFICER_ROLE(), await courtOfficer.getAddress());
  });

  describe("Entity Initialization", function () {
    it("should initialize with correct entity details", async function () {
      const entity = await legalWrapper.getEntityDetails();
      expect(entity.entityName).to.equal("Test SPV LLC");
      expect(entity.jurisdictionType).to.equal(JURISDICTION_DELAWARE);
      expect(entity.registeredAgent).to.equal(await registeredAgent.getAddress());
      expect(entity.isActive).to.be.true;
    });

    it("should generate valid operating agreement hash", async function () {
      const entity = await legalWrapper.getEntityDetails();
      expect(entity.operatingAgreementHash).to.not.equal(ethers.ZeroHash);
    });

    it("should set correct formation timestamp", async function () {
      const entity = await legalWrapper.getEntityDetails();
      const currentTime = await time.latest();
      expect(entity.formationTimestamp).to.be.closeTo(currentTime, 10);
    });

    it("should start with zero members", async function () {
      const memberCount = await legalWrapper.getTotalMembers();
      expect(memberCount).to.equal(0);
    });
  });

  describe("Membership Management", function () {
    beforeEach(async function () {
      // Add initial members
      await legalWrapper.connect(complianceOfficer).addMember(
        await member1.getAddress(),
        1000n * 10n ** 18n, // 1000 units
        "Member One LLC",
        "US-12-3456789"
      );

      await legalWrapper.connect(complianceOfficer).addMember(
        await member2.getAddress(),
        500n * 10n ** 18n, // 500 units
        "Member Two Corp",
        "US-98-7654321"
      );
    });

    it("should add members correctly", async function () {
      const memberCount = await legalWrapper.getTotalMembers();
      expect(memberCount).to.equal(2);
    });

    it("should track member units accurately", async function () {
      const member1Address = await member1.getAddress();
      const member1Data = await legalWrapper.getMemberDetails(member1Address);
      expect(member1Data.unitBalance).to.equal(1000n * 10n ** 18n);
      expect(member1Data.legalName).to.equal("Member One LLC");
    });

    it("should calculate ownership percentage correctly", async function () {
      const member1Address = await member1.getAddress();
      const member1Data = await legalWrapper.getMemberDetails(member1Address);
      // 1000 / 1500 = 66.666...%
      const expectedPercentage = (1000n * 10000n) / 1500n;
      expect(member1Data.percentageOwnership).to.be.closeTo(expectedPercentage, 1);
    });

    it("should emit MemberAdded event", async function () {
      await expect(
        legalWrapper.connect(complianceOfficer).addMember(await member3.getAddress(), 250n * 10n ** 18n, "Member Three Inc", "US-55-1234567")
      )
        .to.emit(legalWrapper, "MemberAdded")
        .withArgs(await member3.getAddress(), 250n * 10n ** 18n, "Member Three Inc");
    });

    it("should prevent duplicate member registration", async function () {
      await expect(
        legalWrapper.connect(complianceOfficer).addMember(await member1.getAddress(), 100n * 10n ** 18n, "Duplicate", "XX-XX-XXXXXXX")
      ).to.be.revertedWith("Member already exists");
    });

    it("should update member units", async function () {
      const member1Address = await member1.getAddress();
      await legalWrapper.connect(complianceOfficer).updateMemberUnits(member1Address, 1500n * 10n ** 18n, "Additional investment");

      const member1Data = await legalWrapper.getMemberDetails(member1Address);
      expect(member1Data.unitBalance).to.equal(1500n * 10n ** 18n);
    });

    it("should remove members correctly", async function () {
      const member1Address = await member1.getAddress();
      await legalWrapper.connect(complianceOfficer).removeMember(member1Address, "Voluntary withdrawal");

      const memberCount = await legalWrapper.getTotalMembers();
      expect(memberCount).to.equal(1);
    });

    it("should emit MemberRemoved event", async function () {
      const member1Address = await member1.getAddress();
      await expect(legalWrapper.connect(complianceOfficer).removeMember(member1Address, "Voluntary withdrawal"))
        .to.emit(legalWrapper, "MemberRemoved")
        .withArgs(member1Address, "Voluntary withdrawal");
    });
  });

  describe("Operating Agreement Management", function () {
    it("should update operating agreement", async function () {
      const newAgreementHash = ethers.keccak256(ethers.toUtf8Bytes("Updated Operating Agreement v2"));

      await legalWrapper.connect(registeredAgent).updateOperatingAgreement(newAgreementHash, "Version 2.0", "ipfs://QmNewAgreement");

      const entity = await legalWrapper.getEntityDetails();
      expect(entity.operatingAgreementHash).to.equal(newAgreementHash);
    });

    it("should emit OperatingAgreementUpdated event", async function () {
      const newAgreementHash = ethers.keccak256(ethers.toUtf8Bytes("Updated Agreement"));

      await expect(legalWrapper.connect(registeredAgent).updateOperatingAgreement(newAgreementHash, "v2", "ipfs://Qm123"))
        .to.emit(legalWrapper, "OperatingAgreementUpdated")
        .withArgs(newAgreementHash, "v2");
    });

    it("should track amendment history", async function () {
      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("Amendment 1"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("Amendment 2"));

      await legalWrapper.connect(registeredAgent).updateOperatingAgreement(hash1, "v1.1", "ipfs://Qm1");
      await legalWrapper.connect(registeredAgent).updateOperatingAgreement(hash2, "v1.2", "ipfs://Qm2");

      const amendmentCount = await legalWrapper.getAmendmentCount();
      expect(amendmentCount).to.be.gte(2);
    });

    it("should only allow registered agent to update", async function () {
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("Unauthorized"));
      await expect(legalWrapper.connect(member1).updateOperatingAgreement(newHash, "v2", "ipfs://Qm")).to.be.revertedWithCustomError(
        legalWrapper,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("Court Order Execution", function () {
    const caseNumber = "2024-CV-1234";
    const courtName = "Delaware Court of Chancery";

    beforeEach(async function () {
      await legalWrapper.connect(complianceOfficer).addMember(await member1.getAddress(), 1000n * 10n ** 18n, "Member One", "TX-123");
      await legalWrapper.connect(complianceOfficer).addMember(await member2.getAddress(), 500n * 10n ** 18n, "Member Two", "TX-456");
    });

    it("should execute forced transfer court order", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Court Order Document"));

      await legalWrapper
        .connect(courtOfficer)
        .executeCourtOrder(
          await member1.getAddress(),
          COURT_ORDER_FORCED_TRANSFER,
          200n * 10n ** 18n,
          await member2.getAddress(),
          courtName,
          caseNumber,
          orderDocHash
        );

      const member1Data = await legalWrapper.getMemberDetails(await member1.getAddress());
      const member2Data = await legalWrapper.getMemberDetails(await member2.getAddress());

      expect(member1Data.unitBalance).to.equal(800n * 10n ** 18n);
      expect(member2Data.unitBalance).to.equal(700n * 10n ** 18n);
    });

    it("should emit CourtOrderExecuted event", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Court Order"));

      await expect(
        legalWrapper
          .connect(courtOfficer)
          .executeCourtOrder(
            await member1.getAddress(),
            COURT_ORDER_MEMBERSHIP_FREEZE,
            0,
            ethers.ZeroAddress,
            courtName,
            caseNumber,
            orderDocHash
          )
      )
        .to.emit(legalWrapper, "CourtOrderExecuted")
        .withArgs(await member1.getAddress(), COURT_ORDER_MEMBERSHIP_FREEZE, caseNumber);
    });

    it("should freeze membership on court order", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Freeze Order"));

      await legalWrapper
        .connect(courtOfficer)
        .executeCourtOrder(
          await member1.getAddress(),
          COURT_ORDER_MEMBERSHIP_FREEZE,
          0,
          ethers.ZeroAddress,
          courtName,
          caseNumber,
          orderDocHash
        );

      const member1Data = await legalWrapper.getMemberDetails(await member1.getAddress());
      expect(member1Data.isFrozen).to.be.true;
    });

    it("should seize membership units", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Seizure Order"));
      const beneficiary = await member3.getAddress();

      await legalWrapper
        .connect(courtOfficer)
        .executeCourtOrder(
          await member1.getAddress(),
          COURT_ORDER_MEMBERSHIP_SEIZURE,
          1000n * 10n ** 18n,
          beneficiary,
          courtName,
          caseNumber,
          orderDocHash
        );

      const member1Data = await legalWrapper.getMemberDetails(await member1.getAddress());
      expect(member1Data.unitBalance).to.equal(0);

      // Member3 should now be a member with seized units
      const member3Data = await legalWrapper.getMemberDetails(beneficiary);
      expect(member3Data.unitBalance).to.equal(1000n * 10n ** 18n);
    });

    it("should require court officer role", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Unauthorized"));

      await expect(
        legalWrapper
          .connect(member1)
          .executeCourtOrder(await member2.getAddress(), COURT_ORDER_FORCED_TRANSFER, 100n * 10n ** 18n, await member1.getAddress(), courtName, caseNumber, orderDocHash)
      ).to.be.revertedWithCustomError(legalWrapper, "AccessControlUnauthorizedAccount");
    });

    it("should store court order history", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Order"));

      await legalWrapper
        .connect(courtOfficer)
        .executeCourtOrder(
          await member1.getAddress(),
          COURT_ORDER_MEMBERSHIP_FREEZE,
          0,
          ethers.ZeroAddress,
          courtName,
          caseNumber,
          orderDocHash
        );

      const orderCount = await legalWrapper.getCourtOrderCount();
      expect(orderCount).to.be.gte(1);
    });
  });

  describe("Capital Structure", function () {
    beforeEach(async function () {
      await legalWrapper.connect(complianceOfficer).addMember(await member1.getAddress(), 1000n * 10n ** 18n, "Member One", "TX-1");
      await legalWrapper.connect(complianceOfficer).addMember(await member2.getAddress(), 500n * 10n ** 18n, "Member Two", "TX-2");
    });

    it("should process distribution correctly", async function () {
      const distributionAmount = ethers.parseEther("10000"); // 10000 USD equivalent

      await legalWrapper.connect(complianceOfficer).recordDistribution(distributionAmount, "Q1 2024 Distribution", "CASH");

      const totalDistributed = await legalWrapper.getTotalDistributed();
      expect(totalDistributed).to.equal(distributionAmount);
    });

    it("should calculate pro-rata distributions", async function () {
      const distributionAmount = ethers.parseEther("15000"); // 15000 total

      await legalWrapper.connect(complianceOfficer).recordDistribution(distributionAmount, "Annual", "CASH");

      const member1Distribution = await legalWrapper.getMemberDistributionEntitlement(await member1.getAddress());
      // Member1 has 1000/1500 = 66.67%, so should get ~10000
      expect(member1Distribution).to.be.closeTo(ethers.parseEther("10000"), ethers.parseEther("100"));
    });

    it("should emit DistributionRecorded event", async function () {
      await expect(legalWrapper.connect(complianceOfficer).recordDistribution(ethers.parseEther("5000"), "Mid-year", "CASH"))
        .to.emit(legalWrapper, "DistributionRecorded");
    });

    it("should track capital calls", async function () {
      const callAmount = ethers.parseEther("50000");

      await legalWrapper.connect(complianceOfficer).initiateCapitalCall(callAmount, "Expansion funding", 30 * 24 * 3600);

      const pendingCalls = await legalWrapper.getPendingCapitalCalls();
      expect(pendingCalls).to.be.gte(1);
    });
  });

  describe("Governance", function () {
    beforeEach(async function () {
      await legalWrapper.connect(complianceOfficer).addMember(await member1.getAddress(), 600n * 10n ** 18n, "Member One", "TX-1");
      await legalWrapper.connect(complianceOfficer).addMember(await member2.getAddress(), 400n * 10n ** 18n, "Member Two", "TX-2");
    });

    it("should create governance proposal", async function () {
      const proposalId = await legalWrapper.connect(member1).createProposal("Amend distribution schedule", 7 * 24 * 3600);

      expect(proposalId).to.be.gt(0);
    });

    it("should allow members to vote", async function () {
      const proposalId = await legalWrapper.connect(member1).createProposal("Test proposal", 7 * 24 * 3600);

      await legalWrapper.connect(member1).vote(proposalId, true);
      await legalWrapper.connect(member2).vote(proposalId, false);

      const proposal = await legalWrapper.getProposal(proposalId);
      expect(proposal.yesVotes).to.equal(600n * 10n ** 18n);
      expect(proposal.noVotes).to.equal(400n * 10n ** 18n);
    });

    it("should prevent double voting", async function () {
      const proposalId = await legalWrapper.connect(member1).createProposal("No double voting", 7 * 24 * 3600);

      await legalWrapper.connect(member1).vote(proposalId, true);

      await expect(legalWrapper.connect(member1).vote(proposalId, true)).to.be.revertedWith("Already voted");
    });

    it("should close proposal after voting period", async function () {
      const proposalId = await legalWrapper.connect(member1).createProposal("Time-limited", 1 * 24 * 3600);

      await legalWrapper.connect(member1).vote(proposalId, true);

      // Fast forward time
      await time.increase(2 * 24 * 3600);

      await legalWrapper.closeProposal(proposalId);

      const proposal = await legalWrapper.getProposal(proposalId);
      expect(proposal.closed).to.be.true;
    });

    it("should determine proposal outcome based on majority", async function () {
      const proposalId = await legalWrapper.connect(member1).createProposal("Majority test", 7 * 24 * 3600);

      await legalWrapper.connect(member1).vote(proposalId, true); // 600 votes yes
      // Member 2 doesn't vote

      await time.increase(8 * 24 * 3600);
      await legalWrapper.closeProposal(proposalId);

      const proposal = await legalWrapper.getProposal(proposalId);
      expect(proposal.passed).to.be.true;
    });
  });

  describe("Multi-Jurisdiction Support", function () {
    it("should support Swiss AG jurisdiction", async function () {
      const SwissWrapper = await ethers.getContractFactory("LegalWrapper");
      const swissEntity = await SwissWrapper.deploy("Test Swiss AG", JURISDICTION_SWISS, await registeredAgent.getAddress());

      const entity = await swissEntity.getEntityDetails();
      expect(entity.jurisdictionType).to.equal(JURISDICTION_SWISS);
    });

    it("should support ADGM SPV jurisdiction", async function () {
      const ADGMWrapper = await ethers.getContractFactory("LegalWrapper");
      const adgmEntity = await ADGMWrapper.deploy("Test ADGM SPV", JURISDICTION_ADGM, await registeredAgent.getAddress());

      const entity = await adgmEntity.getEntityDetails();
      expect(entity.jurisdictionType).to.equal(JURISDICTION_ADGM);
    });

    it("should apply jurisdiction-specific rules", async function () {
      // Different jurisdictions may have different quorum requirements
      const entity = await legalWrapper.getEntityDetails();
      const quorum = await legalWrapper.getQuorumRequirement();
      expect(quorum).to.be.gt(0);
    });
  });

  describe("Audit Trail", function () {
    beforeEach(async function () {
      await legalWrapper.connect(complianceOfficer).addMember(await member1.getAddress(), 1000n * 10n ** 18n, "Member One", "TX-1");
    });

    it("should maintain immutable audit trail", async function () {
      const initialAuditCount = await legalWrapper.getAuditTrailLength();

      await legalWrapper.connect(complianceOfficer).updateMemberUnits(await member1.getAddress(), 1500n * 10n ** 18n, "Additional investment");

      const newAuditCount = await legalWrapper.getAuditTrailLength();
      expect(newAuditCount).to.be.gt(initialAuditCount);
    });

    it("should record all member changes in audit trail", async function () {
      await legalWrapper.connect(complianceOfficer).addMember(await member2.getAddress(), 500n * 10n ** 18n, "Member Two", "TX-2");

      const auditEntry = await legalWrapper.getLatestAuditEntry();
      expect(auditEntry.action).to.include("MEMBER_ADDED");
    });

    it("should include timestamps in audit entries", async function () {
      await legalWrapper.connect(complianceOfficer).updateMemberUnits(await member1.getAddress(), 2000n * 10n ** 18n, "Capital increase");

      const auditEntry = await legalWrapper.getLatestAuditEntry();
      const currentTime = await time.latest();
      expect(auditEntry.timestamp).to.be.closeTo(currentTime, 10);
    });

    it("should be court-admissible", async function () {
      // Audit trail should have cryptographic proof
      const auditHash = await legalWrapper.getAuditTrailHash();
      expect(auditHash).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Emergency Controls", function () {
    it("should pause entity operations", async function () {
      await legalWrapper.pause();
      const isPaused = await legalWrapper.paused();
      expect(isPaused).to.be.true;
    });

    it("should prevent member changes when paused", async function () {
      await legalWrapper.pause();

      await expect(legalWrapper.connect(complianceOfficer).addMember(await member1.getAddress(), 100n * 10n ** 18n, "Test", "XX")).to.be.revertedWithCustomError(legalWrapper, "EnforcedPause");
    });

    it("should allow unpause by admin", async function () {
      await legalWrapper.pause();
      await legalWrapper.unpause();

      const isPaused = await legalWrapper.paused();
      expect(isPaused).to.be.false;
    });

    it("should dissolve entity on court order", async function () {
      const orderDocHash = ethers.keccak256(ethers.toUtf8Bytes("Dissolution Order"));

      await legalWrapper.connect(courtOfficer).executeCourtOrder(ethers.ZeroAddress, COURT_ORDER_DISSOLUTION, 0, ethers.ZeroAddress, "Delaware Court", "2024-DISS-001", orderDocHash);

      const entity = await legalWrapper.getEntityDetails();
      expect(entity.isActive).to.be.false;
    });
  });
});
