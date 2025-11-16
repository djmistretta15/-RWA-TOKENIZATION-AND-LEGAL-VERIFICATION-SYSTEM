import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import * as crypto from "crypto";

/**
 * Notary and Asset Validation Oracle Test Suite
 *
 * AI-GRADE REQUIREMENT: notarySig + docHash + geoStamp + timestamp
 *
 * Tests comprehensive notarization workflow:
 * - Notary credential verification
 * - Document hash validation
 * - Geographic stamping
 * - Timestamp verification
 * - 3-source oracle consensus
 * - IPFS/Arweave dual backup
 * - Court-admissible proof generation
 */

describe("Notary and Asset Validation Oracle", function () {
  let owner: SignerWithAddress;
  let notary1: SignerWithAddress;
  let notary2: SignerWithAddress;
  let notary3: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;
  let oracle3: SignerWithAddress;
  let assetOwner: SignerWithAddress;
  let fraudster: SignerWithAddress;

  // Mock contracts
  let notaryRegistry: Contract;
  let assetValidationOracle: Contract;
  let rwaToken: Contract;

  // Test data
  const NOTARY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("NOTARY_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));

  // Sample asset data
  const sampleAssetData = {
    assetType: "REAL_ESTATE",
    jurisdiction: "US-DE",
    estimatedValue: ethers.parseEther("1000000"),
    ownerAddress: "",
    legalDescription: "Lot 42, Block 7, Sunrise Estates, New Castle County, Delaware",
  };

  // Sample document hashes
  const sampleDocuments = {
    deed: ethers.keccak256(ethers.toUtf8Bytes("DEED_DOCUMENT_CONTENT_HASH_12345")),
    titleInsurance: ethers.keccak256(ethers.toUtf8Bytes("TITLE_INSURANCE_POLICY_HASH")),
    appraisal: ethers.keccak256(ethers.toUtf8Bytes("APPRAISAL_REPORT_HASH_67890")),
    survey: ethers.keccak256(ethers.toUtf8Bytes("PROPERTY_SURVEY_HASH_ABCDE")),
    taxRecord: ethers.keccak256(ethers.toUtf8Bytes("TAX_ASSESSMENT_RECORD_HASH")),
  };

  // Sample geo stamp
  const sampleGeoStamp = {
    latitude: 39742043, // Scaled by 1e6: 39.742043
    longitude: -104991531, // Scaled by 1e6: -104.991531
    accuracy: 10, // meters
    timestamp: 0, // Will be set dynamically
    locationHash: ethers.ZeroHash, // Will be computed
  };

  beforeEach(async function () {
    [owner, notary1, notary2, notary3, oracle1, oracle2, oracle3, assetOwner, fraudster] =
      await ethers.getSigners();

    sampleAssetData.ownerAddress = await assetOwner.getAddress();

    // Deploy NotaryRegistry contract
    const NotaryRegistryFactory = await ethers.getContractFactory("NotaryRegistry");
    notaryRegistry = await NotaryRegistryFactory.deploy();
    await notaryRegistry.waitForDeployment();

    // Deploy AssetValidationOracle contract
    const AssetValidationOracleFactory = await ethers.getContractFactory("AssetValidationOracle");
    assetValidationOracle = await AssetValidationOracleFactory.deploy(
      await notaryRegistry.getAddress()
    );
    await assetValidationOracle.waitForDeployment();

    // Deploy RWAToken for integration tests
    const RWATokenFactory = await ethers.getContractFactory("RWAToken");
    rwaToken = await RWATokenFactory.deploy(
      "Real Estate Token",
      "RET",
      await assetValidationOracle.getAddress()
    );
    await rwaToken.waitForDeployment();

    // Setup roles
    await notaryRegistry.grantRole(NOTARY_ROLE, await notary1.getAddress());
    await notaryRegistry.grantRole(NOTARY_ROLE, await notary2.getAddress());
    await notaryRegistry.grantRole(NOTARY_ROLE, await notary3.getAddress());

    await assetValidationOracle.grantRole(ORACLE_ROLE, await oracle1.getAddress());
    await assetValidationOracle.grantRole(ORACLE_ROLE, await oracle2.getAddress());
    await assetValidationOracle.grantRole(ORACLE_ROLE, await oracle3.getAddress());

    // Update geo stamp timestamp
    const block = await ethers.provider.getBlock("latest");
    sampleGeoStamp.timestamp = block!.timestamp;
    sampleGeoStamp.locationHash = ethers.keccak256(
      ethers.solidityPacked(
        ["int256", "int256", "uint256", "uint256"],
        [
          sampleGeoStamp.latitude,
          sampleGeoStamp.longitude,
          sampleGeoStamp.accuracy,
          sampleGeoStamp.timestamp,
        ]
      )
    );
  });

  describe("Notary Credential Management", function () {
    it("should register a new notary with valid credentials", async function () {
      const notaryData = {
        name: "John Smith",
        licenseNumber: "DE-NOT-2024-12345",
        jurisdiction: "US-DE",
        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year from now
        publicKey: await notary1.getAddress(),
      };

      const tx = await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        notaryData.name,
        notaryData.licenseNumber,
        notaryData.jurisdiction,
        notaryData.expirationDate
      );

      await expect(tx)
        .to.emit(notaryRegistry, "NotaryRegistered")
        .withArgs(
          await notary1.getAddress(),
          notaryData.licenseNumber,
          notaryData.jurisdiction
        );

      const notaryInfo = await notaryRegistry.getNotaryInfo(await notary1.getAddress());
      expect(notaryInfo.name).to.equal(notaryData.name);
      expect(notaryInfo.licenseNumber).to.equal(notaryData.licenseNumber);
      expect(notaryInfo.isActive).to.be.true;
    });

    it("should verify notary signature on document hash", async function () {
      // Register notary
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      // Create document hash to sign
      const documentHash = sampleDocuments.deed;

      // Notary signs the document hash
      const signature = await notary1.signMessage(ethers.getBytes(documentHash));

      // Verify signature on-chain
      const isValid = await notaryRegistry.verifyNotarySignature(
        await notary1.getAddress(),
        documentHash,
        signature
      );

      expect(isValid).to.be.true;
    });

    it("should reject expired notary credentials", async function () {
      // Register notary with expired credentials
      const expiredDate = Math.floor(Date.now() / 1000) - 1; // Already expired

      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        expiredDate
      );

      // Try to use expired notary
      const documentHash = sampleDocuments.deed;
      const signature = await notary1.signMessage(ethers.getBytes(documentHash));

      await expect(
        notaryRegistry.verifyNotarySignature(
          await notary1.getAddress(),
          documentHash,
          signature
        )
      ).to.be.revertedWith("Notary credentials expired");
    });

    it("should revoke notary credentials", async function () {
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      await notaryRegistry.revokeNotary(await notary1.getAddress(), "License revoked by state");

      const notaryInfo = await notaryRegistry.getNotaryInfo(await notary1.getAddress());
      expect(notaryInfo.isActive).to.be.false;
    });

    it("should track notary performance metrics", async function () {
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      // Simulate notarizations
      for (let i = 0; i < 5; i++) {
        const docHash = ethers.keccak256(ethers.toUtf8Bytes(`DOCUMENT_${i}`));
        await notaryRegistry.connect(notary1).recordNotarization(docHash, sampleGeoStamp.locationHash);
      }

      const metrics = await notaryRegistry.getNotaryMetrics(await notary1.getAddress());
      expect(metrics.totalNotarizations).to.equal(5);
      expect(metrics.averageResponseTime).to.be.gt(0);
    });
  });

  describe("Document Hash Validation", function () {
    it("should validate multiple document hashes in asset proof", async function () {
      const documentHashes = [
        sampleDocuments.deed,
        sampleDocuments.titleInsurance,
        sampleDocuments.appraisal,
        sampleDocuments.survey,
        sampleDocuments.taxRecord,
      ];

      const merkleRoot = await assetValidationOracle.computeMerkleRoot(documentHashes);

      const assetProof = {
        assetId: ethers.keccak256(ethers.toUtf8Bytes("ASSET_001")),
        documentMerkleRoot: merkleRoot,
        documentCount: documentHashes.length,
        proofTimestamp: Math.floor(Date.now() / 1000),
      };

      const tx = await assetValidationOracle.submitDocumentProof(
        assetProof.assetId,
        assetProof.documentMerkleRoot,
        assetProof.documentCount,
        assetProof.proofTimestamp
      );

      await expect(tx).to.emit(assetValidationOracle, "DocumentProofSubmitted");

      const storedProof = await assetValidationOracle.getDocumentProof(assetProof.assetId);
      expect(storedProof.merkleRoot).to.equal(merkleRoot);
      expect(storedProof.documentCount).to.equal(documentHashes.length);
    });

    it("should verify document inclusion in Merkle tree", async function () {
      const documentHashes = [
        sampleDocuments.deed,
        sampleDocuments.titleInsurance,
        sampleDocuments.appraisal,
      ];

      const { root, proof } = generateMerkleProof(documentHashes, 1); // Proof for titleInsurance

      const isValid = await assetValidationOracle.verifyDocumentInclusion(
        sampleDocuments.titleInsurance,
        proof,
        root,
        1
      );

      expect(isValid).to.be.true;
    });

    it("should reject tampered document proof", async function () {
      const documentHashes = [
        sampleDocuments.deed,
        sampleDocuments.titleInsurance,
        sampleDocuments.appraisal,
      ];

      const { root, proof } = generateMerkleProof(documentHashes, 1);

      // Tamper with the document hash
      const tamperedHash = ethers.keccak256(ethers.toUtf8Bytes("TAMPERED_DOCUMENT"));

      const isValid = await assetValidationOracle.verifyDocumentInclusion(
        tamperedHash,
        proof,
        root,
        1
      );

      expect(isValid).to.be.false;
    });

    it("should track document version history", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      // Submit initial version
      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        1,
        Math.floor(Date.now() / 1000)
      );

      // Submit updated version
      const updatedDeed = ethers.keccak256(ethers.toUtf8Bytes("UPDATED_DEED_V2"));
      await assetValidationOracle.submitDocumentProof(
        assetId,
        updatedDeed,
        1,
        Math.floor(Date.now() / 1000) + 100
      );

      const versionHistory = await assetValidationOracle.getDocumentVersionHistory(assetId);
      expect(versionHistory.length).to.equal(2);
      expect(versionHistory[0].merkleRoot).to.equal(sampleDocuments.deed);
      expect(versionHistory[1].merkleRoot).to.equal(updatedDeed);
    });

    it("should validate document schema compliance", async function () {
      const requiredDocuments = [
        "DEED",
        "TITLE_INSURANCE",
        "APPRAISAL",
        "SURVEY",
        "TAX_RECORD",
      ];

      const submittedDocuments = [
        { type: "DEED", hash: sampleDocuments.deed },
        { type: "TITLE_INSURANCE", hash: sampleDocuments.titleInsurance },
        { type: "APPRAISAL", hash: sampleDocuments.appraisal },
        { type: "SURVEY", hash: sampleDocuments.survey },
        { type: "TAX_RECORD", hash: sampleDocuments.taxRecord },
      ];

      const isCompliant = await assetValidationOracle.validateDocumentSchema(
        requiredDocuments,
        submittedDocuments.map((d) => d.type)
      );

      expect(isCompliant).to.be.true;
    });
  });

  describe("Geographic Stamping", function () {
    it("should record geo stamp with notarization", async function () {
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      const tx = await assetValidationOracle
        .connect(notary1)
        .submitGeoStamp(
          assetId,
          sampleGeoStamp.latitude,
          sampleGeoStamp.longitude,
          sampleGeoStamp.accuracy,
          sampleGeoStamp.timestamp
        );

      await expect(tx)
        .to.emit(assetValidationOracle, "GeoStampRecorded")
        .withArgs(assetId, sampleGeoStamp.latitude, sampleGeoStamp.longitude);

      const storedGeoStamp = await assetValidationOracle.getGeoStamp(assetId);
      expect(storedGeoStamp.latitude).to.equal(sampleGeoStamp.latitude);
      expect(storedGeoStamp.longitude).to.equal(sampleGeoStamp.longitude);
      expect(storedGeoStamp.accuracy).to.equal(sampleGeoStamp.accuracy);
    });

    it("should validate geo stamp is within jurisdiction", async function () {
      // Delaware coordinates
      const delawareGeoStamp = {
        latitude: 39158168, // 39.158168
        longitude: -75524133, // -75.524133
        accuracy: 50,
      };

      const isInJurisdiction = await assetValidationOracle.validateGeoStampJurisdiction(
        delawareGeoStamp.latitude,
        delawareGeoStamp.longitude,
        "US-DE"
      );

      expect(isInJurisdiction).to.be.true;
    });

    it("should reject geo stamp outside declared jurisdiction", async function () {
      // California coordinates (not Delaware)
      const californiaGeoStamp = {
        latitude: 36778259, // 36.778259
        longitude: -119417931, // -119.417931
        accuracy: 50,
      };

      const isInJurisdiction = await assetValidationOracle.validateGeoStampJurisdiction(
        californiaGeoStamp.latitude,
        californiaGeoStamp.longitude,
        "US-DE" // Claiming Delaware
      );

      expect(isInJurisdiction).to.be.false;
    });

    it("should verify geo stamp integrity hash", async function () {
      const computedHash = ethers.keccak256(
        ethers.solidityPacked(
          ["int256", "int256", "uint256", "uint256"],
          [
            sampleGeoStamp.latitude,
            sampleGeoStamp.longitude,
            sampleGeoStamp.accuracy,
            sampleGeoStamp.timestamp,
          ]
        )
      );

      const isValid = await assetValidationOracle.verifyGeoStampHash(
        sampleGeoStamp.latitude,
        sampleGeoStamp.longitude,
        sampleGeoStamp.accuracy,
        sampleGeoStamp.timestamp,
        computedHash
      );

      expect(isValid).to.be.true;
    });

    it("should track geo stamp history for asset movements", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("MOVABLE_ASSET"));

      // Initial location
      await assetValidationOracle.submitGeoStamp(assetId, 40712776, -74005974, 10, 1000);

      // Asset moved
      await assetValidationOracle.submitGeoStamp(assetId, 34052234, -118243685, 15, 2000);

      // Asset moved again
      await assetValidationOracle.submitGeoStamp(assetId, 51507351, -127758, 20, 3000);

      const locationHistory = await assetValidationOracle.getGeoStampHistory(assetId);
      expect(locationHistory.length).to.equal(3);
      expect(locationHistory[0].latitude).to.equal(40712776); // NYC
      expect(locationHistory[1].latitude).to.equal(34052234); // LA
      expect(locationHistory[2].latitude).to.equal(51507351); // London
    });
  });

  describe("Timestamp Verification", function () {
    it("should record notarization timestamp on-chain", async function () {
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));
      const documentHash = sampleDocuments.deed;

      const tx = await assetValidationOracle
        .connect(notary1)
        .recordNotarizationTimestamp(assetId, documentHash);

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const storedTimestamp = await assetValidationOracle.getNotarizationTimestamp(assetId);
      expect(storedTimestamp).to.equal(block!.timestamp);
    });

    it("should validate timestamp within acceptable range", async function () {
      const currentTime = Math.floor(Date.now() / 1000);
      const submittedTimestamp = currentTime - 60; // 1 minute ago

      const isValid = await assetValidationOracle.validateTimestampRange(
        submittedTimestamp,
        currentTime,
        300 // 5 minute tolerance
      );

      expect(isValid).to.be.true;
    });

    it("should reject future timestamps", async function () {
      const currentTime = Math.floor(Date.now() / 1000);
      const futureTimestamp = currentTime + 3600; // 1 hour in future

      const isValid = await assetValidationOracle.validateTimestampRange(
        futureTimestamp,
        currentTime,
        300
      );

      expect(isValid).to.be.false;
    });

    it("should enforce timestamp ordering for sequential operations", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      // Record sequential timestamps
      await assetValidationOracle.recordSequentialTimestamp(assetId, "NOTARIZATION", 1000);
      await assetValidationOracle.recordSequentialTimestamp(assetId, "VALIDATION", 2000);
      await assetValidationOracle.recordSequentialTimestamp(assetId, "MINTING", 3000);

      // Try to insert out-of-order timestamp
      await expect(
        assetValidationOracle.recordSequentialTimestamp(assetId, "APPRAISAL", 1500)
      ).to.be.revertedWith("Timestamp must be after last recorded");
    });

    it("should compute proof timestamp hash", async function () {
      const timestamps = {
        submission: 1000,
        notarization: 2000,
        validation: 3000,
        consensus: 4000,
      };

      const timestampHash = await assetValidationOracle.computeTimestampHash(
        timestamps.submission,
        timestamps.notarization,
        timestamps.validation,
        timestamps.consensus
      );

      expect(timestampHash).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("3-Source Oracle Consensus", function () {
    it("should require 2/3 oracle agreement for validation", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));
      const validationData = {
        assetValue: ethers.parseEther("1000000"),
        assetStatus: "VERIFIED",
        riskScore: 25,
      };

      // Oracle 1 submits validation
      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(
          assetId,
          validationData.assetValue,
          validationData.assetStatus,
          validationData.riskScore
        );

      let consensus = await assetValidationOracle.getConsensusStatus(assetId);
      expect(consensus.isReached).to.be.false;

      // Oracle 2 submits same validation
      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(
          assetId,
          validationData.assetValue,
          validationData.assetStatus,
          validationData.riskScore
        );

      consensus = await assetValidationOracle.getConsensusStatus(assetId);
      expect(consensus.isReached).to.be.true; // 2/3 agreement
      expect(consensus.consensusValue).to.equal(validationData.assetValue);
    });

    it("should handle oracle disagreement", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_002"));

      // Oracle 1: High valuation
      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      // Oracle 2: Low valuation
      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(assetId, ethers.parseEther("800000"), "VERIFIED", 30);

      // Oracle 3: Medium valuation
      await assetValidationOracle
        .connect(oracle3)
        .submitValidation(assetId, ethers.parseEther("900000"), "VERIFIED", 28);

      const consensus = await assetValidationOracle.getConsensusStatus(assetId);
      expect(consensus.isReached).to.be.false;
      expect(consensus.requiresDispute).to.be.true;
    });

    it("should track individual oracle responses", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_003"));

      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      const oracleResponses = await assetValidationOracle.getOracleResponses(assetId);
      expect(oracleResponses.length).to.equal(2);
      expect(oracleResponses[0].oracle).to.equal(await oracle1.getAddress());
      expect(oracleResponses[1].oracle).to.equal(await oracle2.getAddress());
    });

    it("should prevent duplicate oracle submissions", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_004"));

      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      // Same oracle tries to submit again
      await expect(
        assetValidationOracle
          .connect(oracle1)
          .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25)
      ).to.be.revertedWith("Oracle already submitted");
    });

    it("should timeout stale oracle validations", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_005"));

      // Submit first validation
      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      // Advance time beyond timeout
      await ethers.provider.send("evm_increaseTime", [86400]); // 24 hours
      await ethers.provider.send("evm_mine", []);

      // Check validation expired
      const status = await assetValidationOracle.getConsensusStatus(assetId);
      expect(status.isExpired).to.be.true;
    });

    it("should calculate confidence score based on oracle agreement", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_006"));

      // All three oracles agree
      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);
      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);
      await assetValidationOracle
        .connect(oracle3)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      const consensus = await assetValidationOracle.getConsensusStatus(assetId);
      expect(consensus.confidenceScore).to.equal(100); // 100% agreement
    });

    it("should emit consensus reached event", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_007"));
      const validationData = {
        assetValue: ethers.parseEther("1000000"),
        assetStatus: "VERIFIED",
        riskScore: 25,
      };

      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(
          assetId,
          validationData.assetValue,
          validationData.assetStatus,
          validationData.riskScore
        );

      const tx = await assetValidationOracle
        .connect(oracle2)
        .submitValidation(
          assetId,
          validationData.assetValue,
          validationData.assetStatus,
          validationData.riskScore
        );

      await expect(tx)
        .to.emit(assetValidationOracle, "ConsensusReached")
        .withArgs(assetId, validationData.assetValue, 2, 67); // 2 oracles, 67% confidence
    });
  });

  describe("IPFS/Arweave Dual Backup", function () {
    it("should record IPFS and Arweave hashes for asset proof", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));
      const ipfsCid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
      const arweaveTxId = "arweave_tx_id_123456789abcdef";

      const tx = await assetValidationOracle.recordStorageBackup(assetId, ipfsCid, arweaveTxId);

      await expect(tx)
        .to.emit(assetValidationOracle, "StorageBackupRecorded")
        .withArgs(assetId, ipfsCid, arweaveTxId);

      const storageInfo = await assetValidationOracle.getStorageInfo(assetId);
      expect(storageInfo.ipfsCid).to.equal(ipfsCid);
      expect(storageInfo.arweaveTxId).to.equal(arweaveTxId);
      expect(storageInfo.isBackedUp).to.be.true;
    });

    it("should require both IPFS and Arweave for complete backup", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_002"));
      const ipfsCid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

      // Only IPFS, no Arweave
      await expect(
        assetValidationOracle.recordStorageBackup(assetId, ipfsCid, "")
      ).to.be.revertedWith("Both IPFS and Arweave required");
    });

    it("should validate IPFS CID format", async function () {
      const validCidV0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
      const validCidV1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
      const invalidCid = "invalid_cid";

      expect(await assetValidationOracle.validateIPFSCid(validCidV0)).to.be.true;
      expect(await assetValidationOracle.validateIPFSCid(validCidV1)).to.be.true;
      expect(await assetValidationOracle.validateIPFSCid(invalidCid)).to.be.false;
    });

    it("should track storage redundancy status", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_003"));

      // Record initial backup
      await assetValidationOracle.recordStorageBackup(
        assetId,
        "QmCid1",
        "arweave_tx_1"
      );

      // Record additional IPFS pins
      await assetValidationOracle.recordAdditionalIPFSPin(assetId, "QmCid2", "Pinata");
      await assetValidationOracle.recordAdditionalIPFSPin(assetId, "QmCid3", "Infura");

      const redundancyStatus = await assetValidationOracle.getRedundancyStatus(assetId);
      expect(redundancyStatus.ipfsPinCount).to.equal(3);
      expect(redundancyStatus.hasArweaveBackup).to.be.true;
      expect(redundancyStatus.redundancyLevel).to.equal("HIGH");
    });

    it("should verify content hash matches stored hash", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_004"));
      const documentHash = sampleDocuments.deed;

      // Store expected hash
      await assetValidationOracle.submitDocumentProof(
        assetId,
        documentHash,
        1,
        Math.floor(Date.now() / 1000)
      );

      // Verify retrieved content matches
      const isValid = await assetValidationOracle.verifyStoredContent(assetId, documentHash);
      expect(isValid).to.be.true;

      // Verify tampered content fails
      const tamperedHash = ethers.keccak256(ethers.toUtf8Bytes("TAMPERED"));
      const isInvalid = await assetValidationOracle.verifyStoredContent(assetId, tamperedHash);
      expect(isInvalid).to.be.false;
    });
  });

  describe("Court-Admissible Proof Generation", function () {
    it("should generate complete notarization certificate", async function () {
      // Setup complete asset proof
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      // Submit document proof
      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        5,
        Math.floor(Date.now() / 1000)
      );

      // Submit geo stamp
      await assetValidationOracle.submitGeoStamp(
        assetId,
        sampleGeoStamp.latitude,
        sampleGeoStamp.longitude,
        sampleGeoStamp.accuracy,
        sampleGeoStamp.timestamp
      );

      // Record notarization
      await assetValidationOracle
        .connect(notary1)
        .recordNotarizationTimestamp(assetId, sampleDocuments.deed);

      // Oracle consensus
      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);
      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      // Generate certificate
      const certificate = await assetValidationOracle.generateNotarizationCertificate(assetId);

      expect(certificate.assetId).to.equal(assetId);
      expect(certificate.notaryAddress).to.equal(await notary1.getAddress());
      expect(certificate.documentHash).to.equal(sampleDocuments.deed);
      expect(certificate.geoStampHash).to.not.equal(ethers.ZeroHash);
      expect(certificate.consensusReached).to.be.true;
      expect(certificate.certificateHash).to.not.equal(ethers.ZeroHash);
    });

    it("should export proof in court-admissible format", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      // Setup basic proof
      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        1,
        Math.floor(Date.now() / 1000)
      );

      const courtProof = await assetValidationOracle.exportForCourt(assetId);

      expect(courtProof.chainEvidence).to.not.be.empty;
      expect(courtProof.timestampProof).to.be.gt(0);
      expect(courtProof.blockNumber).to.be.gt(0);
      expect(courtProof.transactionHash).to.not.equal(ethers.ZeroHash);
    });

    it("should provide tamper-evident audit trail", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      // Perform multiple operations
      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        1,
        1000
      );
      await assetValidationOracle.submitGeoStamp(assetId, 39742043, -104991531, 10, 2000);

      const auditTrail = await assetValidationOracle.getAuditTrail(assetId);

      expect(auditTrail.length).to.be.gt(0);

      // Each entry should have hash linking to previous
      for (let i = 1; i < auditTrail.length; i++) {
        expect(auditTrail[i].previousHash).to.equal(auditTrail[i - 1].currentHash);
      }
    });

    it("should sign certificate with contract authority", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("ASSET_001"));

      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        1,
        Math.floor(Date.now() / 1000)
      );

      const signedCertificate = await assetValidationOracle.signCertificate(assetId);

      expect(signedCertificate.signature).to.not.be.empty;
      expect(signedCertificate.signingAuthority).to.equal(
        await assetValidationOracle.getAddress()
      );
      expect(signedCertificate.signatureTimestamp).to.be.gt(0);
    });
  });

  describe("Integration Tests", function () {
    it("should complete full notarization workflow", async function () {
      // 1. Register notary
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      const assetId = ethers.keccak256(ethers.toUtf8Bytes("FULL_WORKFLOW_ASSET"));

      // 2. Submit document proof with Merkle root
      const documentHashes = [
        sampleDocuments.deed,
        sampleDocuments.titleInsurance,
        sampleDocuments.appraisal,
      ];
      const merkleRoot = await assetValidationOracle.computeMerkleRoot(documentHashes);

      await assetValidationOracle.submitDocumentProof(
        assetId,
        merkleRoot,
        documentHashes.length,
        Math.floor(Date.now() / 1000)
      );

      // 3. Record geo stamp
      await assetValidationOracle
        .connect(notary1)
        .submitGeoStamp(
          assetId,
          sampleGeoStamp.latitude,
          sampleGeoStamp.longitude,
          sampleGeoStamp.accuracy,
          sampleGeoStamp.timestamp
        );

      // 4. Notary signs document
      const notarySignature = await notary1.signMessage(ethers.getBytes(merkleRoot));
      const isSignatureValid = await notaryRegistry.verifyNotarySignature(
        await notary1.getAddress(),
        merkleRoot,
        notarySignature
      );
      expect(isSignatureValid).to.be.true;

      // 5. Record notarization timestamp
      await assetValidationOracle
        .connect(notary1)
        .recordNotarizationTimestamp(assetId, merkleRoot);

      // 6. Oracle consensus (2/3)
      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);
      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      const consensus = await assetValidationOracle.getConsensusStatus(assetId);
      expect(consensus.isReached).to.be.true;

      // 7. Record IPFS/Arweave backup
      await assetValidationOracle.recordStorageBackup(
        assetId,
        "QmFullWorkflowCid",
        "arweave_full_workflow_tx"
      );

      // 8. Generate final certificate
      const certificate = await assetValidationOracle.generateNotarizationCertificate(assetId);
      expect(certificate.certificateHash).to.not.equal(ethers.ZeroHash);

      // 9. Verify complete proof
      const proofStatus = await assetValidationOracle.getCompleteProofStatus(assetId);
      expect(proofStatus.hasDocuments).to.be.true;
      expect(proofStatus.hasGeoStamp).to.be.true;
      expect(proofStatus.hasNotarization).to.be.true;
      expect(proofStatus.hasConsensus).to.be.true;
      expect(proofStatus.hasBackup).to.be.true;
      expect(proofStatus.isComplete).to.be.true;
    });

    it("should prevent minting without complete proof", async function () {
      const assetId = ethers.keccak256(ethers.toUtf8Bytes("INCOMPLETE_ASSET"));

      // Only submit partial proof (no consensus)
      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        1,
        Math.floor(Date.now() / 1000)
      );

      // Try to mint token with incomplete proof
      await expect(
        rwaToken.mintWithProof(assetId, await assetOwner.getAddress(), ethers.parseEther("100"))
      ).to.be.revertedWith("Asset proof incomplete");
    });

    it("should allow minting only after complete validation", async function () {
      // Complete full workflow
      await notaryRegistry.registerNotary(
        await notary1.getAddress(),
        "John Smith",
        "DE-NOT-2024-12345",
        "US-DE",
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      );

      const assetId = ethers.keccak256(ethers.toUtf8Bytes("COMPLETE_ASSET"));

      await assetValidationOracle.submitDocumentProof(
        assetId,
        sampleDocuments.deed,
        1,
        Math.floor(Date.now() / 1000)
      );

      await assetValidationOracle.submitGeoStamp(
        assetId,
        sampleGeoStamp.latitude,
        sampleGeoStamp.longitude,
        sampleGeoStamp.accuracy,
        sampleGeoStamp.timestamp
      );

      await assetValidationOracle
        .connect(notary1)
        .recordNotarizationTimestamp(assetId, sampleDocuments.deed);

      await assetValidationOracle
        .connect(oracle1)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);
      await assetValidationOracle
        .connect(oracle2)
        .submitValidation(assetId, ethers.parseEther("1000000"), "VERIFIED", 25);

      await assetValidationOracle.recordStorageBackup(
        assetId,
        "QmCompleteCid",
        "arweave_complete_tx"
      );

      // Now minting should succeed
      const tx = await rwaToken.mintWithProof(
        assetId,
        await assetOwner.getAddress(),
        ethers.parseEther("100")
      );

      await expect(tx)
        .to.emit(rwaToken, "Transfer")
        .withArgs(ethers.ZeroAddress, await assetOwner.getAddress(), ethers.parseEther("100"));

      const balance = await rwaToken.balanceOf(await assetOwner.getAddress());
      expect(balance).to.equal(ethers.parseEther("100"));
    });
  });

  // Helper function to generate Merkle proof
  function generateMerkleProof(
    hashes: string[],
    index: number
  ): { root: string; proof: string[] } {
    const tree: string[][] = [hashes];
    let currentLevel = hashes;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          const combined = ethers.keccak256(
            ethers.solidityPacked(["bytes32", "bytes32"], [currentLevel[i], currentLevel[i + 1]])
          );
          nextLevel.push(combined);
        } else {
          nextLevel.push(currentLevel[i]);
        }
      }
      tree.push(nextLevel);
      currentLevel = nextLevel;
    }

    const proof: string[] = [];
    let currentIndex = index;

    for (let level = 0; level < tree.length - 1; level++) {
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < tree[level].length) {
        proof.push(tree[level][siblingIndex]);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: tree[tree.length - 1][0],
      proof,
    };
  }
});
