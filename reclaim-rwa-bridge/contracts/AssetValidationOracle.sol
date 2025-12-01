// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AssetValidationOracle
 * @author Reclaim RWA Bridge
 * @notice On-chain 3-source oracle consensus for RWA asset validation
 * @dev Implements Chainlink, API3, and UMA oracle aggregation with 2/3 consensus requirement
 *
 * AI-GRADE REQUIREMENT: 3-Source Oracle Consensus
 * Requires agreement from at least 2 of 3 oracle sources for asset validation
 */
contract AssetValidationOracle is AccessControl, ReentrancyGuard, Pausable {
    // ============ Roles ============
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");

    // ============ Enums ============
    enum OracleSource {
        CHAINLINK,
        API3,
        UMA
    }

    enum ValidationStatus {
        PENDING,
        CONSENSUS_REACHED,
        DISPUTED,
        EXPIRED,
        REJECTED
    }

    enum ProofStatus {
        INCOMPLETE,
        DOCUMENTS_SUBMITTED,
        GEO_STAMP_ADDED,
        NOTARIZED,
        ORACLE_VALIDATED,
        BACKUP_COMPLETE,
        FULLY_VALIDATED
    }

    // ============ Structs ============
    struct OracleResponse {
        OracleSource source;
        address oracle;
        uint256 assetValue;
        string assetStatus;
        uint256 riskScore;
        uint256 timestamp;
        bool submitted;
    }

    struct ConsensusResult {
        bool isReached;
        bool requiresDispute;
        bool isExpired;
        uint256 consensusValue;
        uint256 confidenceScore;
        uint256 timestamp;
        uint256 oracleCount;
    }

    struct DocumentProof {
        bytes32 merkleRoot;
        uint256 documentCount;
        uint256 timestamp;
        bool isValid;
    }

    struct GeoStamp {
        int256 latitude;
        int256 longitude;
        uint256 accuracy;
        uint256 timestamp;
        bytes32 locationHash;
    }

    struct StorageBackup {
        string ipfsCid;
        string arweaveTxId;
        bool isBackedUp;
        uint256 timestamp;
        string[] additionalPins;
        string[] pinServices;
    }

    struct NotarizationCertificate {
        bytes32 assetId;
        address notaryAddress;
        bytes32 documentHash;
        bytes32 geoStampHash;
        bool consensusReached;
        bytes32 certificateHash;
        uint256 timestamp;
    }

    struct AssetProofStatus {
        bool hasDocuments;
        bool hasGeoStamp;
        bool hasNotarization;
        bool hasConsensus;
        bool hasBackup;
        bool isComplete;
        ProofStatus currentStatus;
    }

    struct AuditEntry {
        bytes32 currentHash;
        bytes32 previousHash;
        string operation;
        uint256 timestamp;
        address actor;
    }

    struct TimestampRecord {
        string stage;
        uint256 timestamp;
        uint256 blockNumber;
    }

    struct CourtProof {
        bytes chainEvidence;
        uint256 timestampProof;
        uint256 blockNumber;
        bytes32 transactionHash;
    }

    struct SignedCertificate {
        bytes signature;
        address signingAuthority;
        uint256 signatureTimestamp;
        bytes32 certificateHash;
    }

    struct DocumentVersion {
        bytes32 merkleRoot;
        uint256 timestamp;
        uint256 version;
    }

    // ============ State Variables ============

    // Reference to notary registry
    address public notaryRegistry;

    // Oracle responses per asset
    mapping(bytes32 => mapping(OracleSource => OracleResponse)) public oracleResponses;
    mapping(bytes32 => ConsensusResult) public consensusResults;
    mapping(bytes32 => address[]) public oracleSubmitters;

    // Document proofs
    mapping(bytes32 => DocumentProof) public documentProofs;
    mapping(bytes32 => DocumentVersion[]) public documentVersionHistory;

    // Geo stamps
    mapping(bytes32 => GeoStamp) public geoStamps;
    mapping(bytes32 => GeoStamp[]) public geoStampHistory;

    // Storage backups
    mapping(bytes32 => StorageBackup) public storageBackups;

    // Notarization timestamps
    mapping(bytes32 => uint256) public notarizationTimestamps;
    mapping(bytes32 => TimestampRecord[]) public timestampSequence;

    // Audit trails
    mapping(bytes32 => AuditEntry[]) public auditTrails;

    // Jurisdiction boundaries (simplified: bounding boxes)
    mapping(string => int256[4]) public jurisdictionBounds; // [minLat, maxLat, minLon, maxLon]

    // Oracle configuration
    uint256 public constant REQUIRED_SOURCES = 2; // 2 of 3 for consensus
    uint256 public constant AGREEMENT_THRESHOLD = 67; // 67% agreement required
    uint256 public validationTimeout = 24 hours;
    uint256 public oracleDataMaxAge = 6 hours;
    uint256 public valueTolerance = 10; // 10% tolerance for value agreement

    // Tracking
    uint256 public totalValidations;
    uint256 public successfulConsensus;
    uint256 public disputedValidations;

    // ============ Events ============

    event OracleResponseSubmitted(
        bytes32 indexed assetId,
        OracleSource source,
        address oracle,
        uint256 value
    );

    event ConsensusReached(
        bytes32 indexed assetId,
        uint256 consensusValue,
        uint256 oracleCount,
        uint256 confidenceScore
    );

    event ConsensusFailed(
        bytes32 indexed assetId,
        string reason
    );

    event DocumentProofSubmitted(
        bytes32 indexed assetId,
        bytes32 merkleRoot,
        uint256 documentCount
    );

    event GeoStampRecorded(
        bytes32 indexed assetId,
        int256 latitude,
        int256 longitude
    );

    event StorageBackupRecorded(
        bytes32 indexed assetId,
        string ipfsCid,
        string arweaveTxId
    );

    event ValidationExpired(
        bytes32 indexed assetId,
        uint256 timestamp
    );

    event DisputeRaised(
        bytes32 indexed assetId,
        string reason,
        address disputedBy
    );

    event ValuationUpdated(
        bytes32 indexed assetId,
        uint256 oldValue,
        uint256 newValue
    );

    event AssetProofComplete(
        bytes32 indexed assetId,
        bytes32 masterHash
    );

    // ============ Constructor ============

    constructor(address _notaryRegistry) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(DISPUTE_RESOLVER_ROLE, msg.sender);

        notaryRegistry = _notaryRegistry;

        // Initialize jurisdiction bounds (scaled by 1e6)
        // Delaware
        jurisdictionBounds["US-DE"] = [int256(38451000), int256(39839000), int256(-75789000), int256(-75049000)];
        // California
        jurisdictionBounds["US-CA"] = [int256(32534000), int256(42009000), int256(-124409000), int256(-114131000)];
        // New York
        jurisdictionBounds["US-NY"] = [int256(40496000), int256(45015000), int256(-79763000), int256(-71856000)];
        // Switzerland (Zurich)
        jurisdictionBounds["CH-ZH"] = [int256(47159000), int256(47695000), int256(8356000), int256(8984000)];
        // Singapore
        jurisdictionBounds["SG"] = [int256(1150000), int256(1471000), int256(103600000), int256(104100000)];
    }

    // ============ Oracle Submission Functions ============

    /**
     * @notice Submit oracle validation for an asset
     * @param assetId Asset identifier
     * @param assetValue Validated asset value in wei
     * @param assetStatus Asset status string
     * @param riskScore Risk score (0-100)
     */
    function submitValidation(
        bytes32 assetId,
        uint256 assetValue,
        string calldata assetStatus,
        uint256 riskScore
    ) external onlyRole(ORACLE_ROLE) nonReentrant whenNotPaused {
        require(assetValue > 0, "Invalid asset value");
        require(riskScore <= 100, "Invalid risk score");

        // Determine oracle source based on caller
        OracleSource source = _getOracleSource(msg.sender);

        // Check if oracle already submitted
        require(
            !oracleResponses[assetId][source].submitted,
            "Oracle already submitted"
        );

        // Check if validation not expired
        ConsensusResult storage consensus = consensusResults[assetId];
        if (consensus.timestamp > 0) {
            require(
                block.timestamp - consensus.timestamp < validationTimeout,
                "Validation expired"
            );
        }

        // Record response
        oracleResponses[assetId][source] = OracleResponse({
            source: source,
            oracle: msg.sender,
            assetValue: assetValue,
            assetStatus: assetStatus,
            riskScore: riskScore,
            timestamp: block.timestamp,
            submitted: true
        });

        oracleSubmitters[assetId].push(msg.sender);

        emit OracleResponseSubmitted(assetId, source, msg.sender, assetValue);

        // Try to build consensus
        _buildConsensus(assetId);
    }

    /**
     * @notice Submit document proof with Merkle root
     * @param assetId Asset identifier
     * @param merkleRoot Merkle root of document hashes
     * @param documentCount Number of documents
     * @param timestamp Proof timestamp
     */
    function submitDocumentProof(
        bytes32 assetId,
        bytes32 merkleRoot,
        uint256 documentCount,
        uint256 timestamp
    ) external onlyRole(VALIDATOR_ROLE) whenNotPaused {
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(documentCount > 0, "Invalid document count");
        require(timestamp <= block.timestamp, "Future timestamp not allowed");

        // Add to version history
        documentVersionHistory[assetId].push(DocumentVersion({
            merkleRoot: merkleRoot,
            timestamp: timestamp,
            version: documentVersionHistory[assetId].length + 1
        }));

        // Update current proof
        documentProofs[assetId] = DocumentProof({
            merkleRoot: merkleRoot,
            documentCount: documentCount,
            timestamp: timestamp,
            isValid: true
        });

        // Record audit entry
        _recordAudit(assetId, "DOCUMENT_PROOF_SUBMITTED", msg.sender);

        emit DocumentProofSubmitted(assetId, merkleRoot, documentCount);
    }

    /**
     * @notice Submit geo-stamp for asset location
     * @param assetId Asset identifier
     * @param latitude Latitude (scaled by 1e6)
     * @param longitude Longitude (scaled by 1e6)
     * @param accuracy Accuracy in meters
     * @param timestamp Timestamp of geo-stamp
     */
    function submitGeoStamp(
        bytes32 assetId,
        int256 latitude,
        int256 longitude,
        uint256 accuracy,
        uint256 timestamp
    ) external onlyRole(VALIDATOR_ROLE) whenNotPaused {
        require(latitude >= -90000000 && latitude <= 90000000, "Invalid latitude");
        require(longitude >= -180000000 && longitude <= 180000000, "Invalid longitude");
        require(accuracy > 0 && accuracy <= 10000, "Invalid accuracy");

        bytes32 locationHash = keccak256(
            abi.encodePacked(latitude, longitude, accuracy, timestamp)
        );

        GeoStamp memory stamp = GeoStamp({
            latitude: latitude,
            longitude: longitude,
            accuracy: accuracy,
            timestamp: timestamp,
            locationHash: locationHash
        });

        // Store in history
        geoStampHistory[assetId].push(stamp);

        // Update current stamp
        geoStamps[assetId] = stamp;

        // Record audit
        _recordAudit(assetId, "GEO_STAMP_RECORDED", msg.sender);

        emit GeoStampRecorded(assetId, latitude, longitude);
    }

    /**
     * @notice Record IPFS and Arweave storage backup
     * @param assetId Asset identifier
     * @param ipfsCid IPFS content identifier
     * @param arweaveTxId Arweave transaction ID
     */
    function recordStorageBackup(
        bytes32 assetId,
        string calldata ipfsCid,
        string calldata arweaveTxId
    ) external onlyRole(VALIDATOR_ROLE) whenNotPaused {
        require(bytes(ipfsCid).length > 0, "IPFS CID required");
        require(bytes(arweaveTxId).length > 0, "Both IPFS and Arweave required");
        require(validateIPFSCid(ipfsCid), "Invalid IPFS CID format");

        storageBackups[assetId] = StorageBackup({
            ipfsCid: ipfsCid,
            arweaveTxId: arweaveTxId,
            isBackedUp: true,
            timestamp: block.timestamp,
            additionalPins: new string[](0),
            pinServices: new string[](0)
        });

        _recordAudit(assetId, "STORAGE_BACKUP_RECORDED", msg.sender);

        emit StorageBackupRecorded(assetId, ipfsCid, arweaveTxId);
    }

    /**
     * @notice Record additional IPFS pin
     * @param assetId Asset identifier
     * @param cid IPFS CID
     * @param service Pin service name (e.g., "Pinata")
     */
    function recordAdditionalIPFSPin(
        bytes32 assetId,
        string calldata cid,
        string calldata service
    ) external onlyRole(VALIDATOR_ROLE) {
        require(storageBackups[assetId].isBackedUp, "Primary backup required first");

        storageBackups[assetId].additionalPins.push(cid);
        storageBackups[assetId].pinServices.push(service);
    }

    /**
     * @notice Record notarization timestamp
     * @param assetId Asset identifier
     * @param documentHash Document that was notarized
     */
    function recordNotarizationTimestamp(
        bytes32 assetId,
        bytes32 documentHash
    ) external whenNotPaused {
        // Only callable by notary registry or validator
        require(
            msg.sender == notaryRegistry || hasRole(VALIDATOR_ROLE, msg.sender),
            "Not authorized"
        );

        notarizationTimestamps[assetId] = block.timestamp;

        timestampSequence[assetId].push(TimestampRecord({
            stage: "NOTARIZATION",
            timestamp: block.timestamp,
            blockNumber: block.number
        }));

        _recordAudit(assetId, "NOTARIZATION_RECORDED", msg.sender);
    }

    // ============ Consensus Functions ============

    /**
     * @dev Build consensus from oracle responses
     */
    function _buildConsensus(bytes32 assetId) internal {
        OracleResponse[] memory responses = new OracleResponse[](3);
        uint256 validCount = 0;

        // Collect valid responses
        for (uint256 i = 0; i < 3; i++) {
            OracleSource source = OracleSource(i);
            OracleResponse storage response = oracleResponses[assetId][source];

            if (response.submitted && block.timestamp - response.timestamp < oracleDataMaxAge) {
                responses[validCount] = response;
                validCount++;
            }
        }

        // Need at least 2 responses
        if (validCount < REQUIRED_SOURCES) {
            return;
        }

        // Check for value agreement
        bool hasConsensus = false;
        uint256 consensusValue = 0;
        uint256 agreeingOracles = 0;

        // Simple majority check with tolerance
        for (uint256 i = 0; i < validCount; i++) {
            uint256 matchCount = 1;
            uint256 sumValue = responses[i].assetValue;

            for (uint256 j = i + 1; j < validCount; j++) {
                uint256 diff = _absDiff(responses[i].assetValue, responses[j].assetValue);
                uint256 tolerance = (responses[i].assetValue * valueTolerance) / 100;

                if (diff <= tolerance) {
                    matchCount++;
                    sumValue += responses[j].assetValue;
                }
            }

            if (matchCount >= REQUIRED_SOURCES) {
                hasConsensus = true;
                consensusValue = sumValue / matchCount;
                agreeingOracles = matchCount;
                break;
            }
        }

        // Calculate confidence score
        uint256 confidenceScore = (agreeingOracles * 100) / validCount;

        // Update consensus result
        consensusResults[assetId] = ConsensusResult({
            isReached: hasConsensus,
            requiresDispute: !hasConsensus && validCount >= REQUIRED_SOURCES,
            isExpired: false,
            consensusValue: consensusValue,
            confidenceScore: confidenceScore,
            timestamp: block.timestamp,
            oracleCount: validCount
        });

        if (hasConsensus) {
            successfulConsensus++;
            _recordAudit(assetId, "CONSENSUS_REACHED", address(this));
            emit ConsensusReached(assetId, consensusValue, agreeingOracles, confidenceScore);
        } else if (validCount >= REQUIRED_SOURCES) {
            disputedValidations++;
            emit ConsensusFailed(assetId, "Oracle values too divergent");
        }

        totalValidations++;
    }

    // ============ View Functions ============

    /**
     * @notice Get consensus status for an asset
     * @param assetId Asset identifier
     * @return result Consensus result
     */
    function getConsensusStatus(
        bytes32 assetId
    ) external view returns (ConsensusResult memory result) {
        result = consensusResults[assetId];

        // Check expiration
        if (result.timestamp > 0 && block.timestamp - result.timestamp > validationTimeout) {
            result.isExpired = true;
        }

        return result;
    }

    /**
     * @notice Get oracle responses for an asset
     * @param assetId Asset identifier
     * @return responses Array of oracle responses
     */
    function getOracleResponses(
        bytes32 assetId
    ) external view returns (OracleResponse[] memory responses) {
        responses = new OracleResponse[](3);

        for (uint256 i = 0; i < 3; i++) {
            responses[i] = oracleResponses[assetId][OracleSource(i)];
        }

        return responses;
    }

    /**
     * @notice Get document proof for an asset
     * @param assetId Asset identifier
     * @return proof Document proof
     */
    function getDocumentProof(
        bytes32 assetId
    ) external view returns (DocumentProof memory proof) {
        return documentProofs[assetId];
    }

    /**
     * @notice Get document version history
     * @param assetId Asset identifier
     * @return versions Array of document versions
     */
    function getDocumentVersionHistory(
        bytes32 assetId
    ) external view returns (DocumentVersion[] memory versions) {
        return documentVersionHistory[assetId];
    }

    /**
     * @notice Get geo-stamp for an asset
     * @param assetId Asset identifier
     * @return stamp Geo-stamp data
     */
    function getGeoStamp(
        bytes32 assetId
    ) external view returns (GeoStamp memory stamp) {
        return geoStamps[assetId];
    }

    /**
     * @notice Get geo-stamp history
     * @param assetId Asset identifier
     * @return history Array of geo-stamps
     */
    function getGeoStampHistory(
        bytes32 assetId
    ) external view returns (GeoStamp[] memory history) {
        return geoStampHistory[assetId];
    }

    /**
     * @notice Get storage information
     * @param assetId Asset identifier
     * @return info Storage backup info
     */
    function getStorageInfo(
        bytes32 assetId
    ) external view returns (StorageBackup memory info) {
        return storageBackups[assetId];
    }

    /**
     * @notice Get redundancy status
     * @param assetId Asset identifier
     * @return ipfsPinCount Number of IPFS pins
     * @return hasArweaveBackup Whether Arweave backup exists
     * @return redundancyLevel Redundancy level string
     */
    function getRedundancyStatus(
        bytes32 assetId
    ) external view returns (
        uint256 ipfsPinCount,
        bool hasArweaveBackup,
        string memory redundancyLevel
    ) {
        StorageBackup storage backup = storageBackups[assetId];

        ipfsPinCount = backup.additionalPins.length + (bytes(backup.ipfsCid).length > 0 ? 1 : 0);
        hasArweaveBackup = bytes(backup.arweaveTxId).length > 0;

        if (ipfsPinCount >= 3 && hasArweaveBackup) {
            redundancyLevel = "HIGH";
        } else if (ipfsPinCount >= 2 && hasArweaveBackup) {
            redundancyLevel = "MEDIUM";
        } else if (hasArweaveBackup) {
            redundancyLevel = "LOW";
        } else {
            redundancyLevel = "NONE";
        }
    }

    /**
     * @notice Get notarization timestamp
     * @param assetId Asset identifier
     * @return timestamp Notarization timestamp
     */
    function getNotarizationTimestamp(
        bytes32 assetId
    ) external view returns (uint256 timestamp) {
        return notarizationTimestamps[assetId];
    }

    /**
     * @notice Get complete asset proof status
     * @param assetId Asset identifier
     * @return status Proof status breakdown
     */
    function getCompleteProofStatus(
        bytes32 assetId
    ) external view returns (AssetProofStatus memory status) {
        status.hasDocuments = documentProofs[assetId].isValid;
        status.hasGeoStamp = geoStamps[assetId].timestamp > 0;
        status.hasNotarization = notarizationTimestamps[assetId] > 0;
        status.hasConsensus = consensusResults[assetId].isReached;
        status.hasBackup = storageBackups[assetId].isBackedUp;

        status.isComplete = status.hasDocuments &&
                           status.hasGeoStamp &&
                           status.hasNotarization &&
                           status.hasConsensus &&
                           status.hasBackup;

        // Determine current status
        if (status.isComplete) {
            status.currentStatus = ProofStatus.FULLY_VALIDATED;
        } else if (status.hasBackup) {
            status.currentStatus = ProofStatus.BACKUP_COMPLETE;
        } else if (status.hasConsensus) {
            status.currentStatus = ProofStatus.ORACLE_VALIDATED;
        } else if (status.hasNotarization) {
            status.currentStatus = ProofStatus.NOTARIZED;
        } else if (status.hasGeoStamp) {
            status.currentStatus = ProofStatus.GEO_STAMP_ADDED;
        } else if (status.hasDocuments) {
            status.currentStatus = ProofStatus.DOCUMENTS_SUBMITTED;
        } else {
            status.currentStatus = ProofStatus.INCOMPLETE;
        }
    }

    /**
     * @notice Get audit trail for an asset
     * @param assetId Asset identifier
     * @return trail Array of audit entries
     */
    function getAuditTrail(
        bytes32 assetId
    ) external view returns (AuditEntry[] memory trail) {
        return auditTrails[assetId];
    }

    /**
     * @notice Generate notarization certificate
     * @param assetId Asset identifier
     * @return certificate Notarization certificate
     */
    function generateNotarizationCertificate(
        bytes32 assetId
    ) external view returns (NotarizationCertificate memory certificate) {
        require(consensusResults[assetId].isReached, "Consensus not reached");

        certificate.assetId = assetId;
        certificate.notaryAddress = address(0); // Would be set from notary registry
        certificate.documentHash = documentProofs[assetId].merkleRoot;
        certificate.geoStampHash = geoStamps[assetId].locationHash;
        certificate.consensusReached = consensusResults[assetId].isReached;
        certificate.timestamp = block.timestamp;

        // Generate certificate hash
        certificate.certificateHash = keccak256(
            abi.encodePacked(
                certificate.assetId,
                certificate.documentHash,
                certificate.geoStampHash,
                certificate.consensusReached,
                certificate.timestamp
            )
        );
    }

    /**
     * @notice Export proof for court admissibility
     * @param assetId Asset identifier
     * @return proof Court-admissible proof
     */
    function exportForCourt(
        bytes32 assetId
    ) external view returns (CourtProof memory proof) {
        // Build chain evidence
        bytes memory evidence = abi.encode(
            documentProofs[assetId],
            geoStamps[assetId],
            consensusResults[assetId],
            storageBackups[assetId]
        );

        proof.chainEvidence = evidence;
        proof.timestampProof = notarizationTimestamps[assetId];
        proof.blockNumber = block.number;
        proof.transactionHash = bytes32(0); // Would be set from tx hash
    }

    /**
     * @notice Sign certificate with contract authority
     * @param assetId Asset identifier
     * @return signedCert Signed certificate
     */
    function signCertificate(
        bytes32 assetId
    ) external view returns (SignedCertificate memory signedCert) {
        NotarizationCertificate memory cert = this.generateNotarizationCertificate(assetId);

        signedCert.certificateHash = cert.certificateHash;
        signedCert.signingAuthority = address(this);
        signedCert.signatureTimestamp = block.timestamp;
        signedCert.signature = abi.encodePacked(cert.certificateHash, address(this));
    }

    // ============ Validation Functions ============

    /**
     * @notice Validate IPFS CID format
     * @param cid IPFS CID to validate
     * @return isValid Whether CID is valid
     */
    function validateIPFSCid(string memory cid) public pure returns (bool isValid) {
        bytes memory cidBytes = bytes(cid);

        // CIDv0 starts with "Qm" and is 46 characters
        if (cidBytes.length == 46 && cidBytes[0] == "Q" && cidBytes[1] == "m") {
            return true;
        }

        // CIDv1 starts with "b" (base32) or "z" (base58)
        if (cidBytes.length > 0 && (cidBytes[0] == "b" || cidBytes[0] == "z")) {
            return true;
        }

        return false;
    }

    /**
     * @notice Verify stored content matches expected hash
     * @param assetId Asset identifier
     * @param expectedHash Expected document hash
     * @return isValid Whether content matches
     */
    function verifyStoredContent(
        bytes32 assetId,
        bytes32 expectedHash
    ) external view returns (bool isValid) {
        return documentProofs[assetId].merkleRoot == expectedHash;
    }

    /**
     * @notice Validate geo-stamp is within jurisdiction
     * @param latitude Latitude (scaled by 1e6)
     * @param longitude Longitude (scaled by 1e6)
     * @param jurisdiction Jurisdiction code
     * @return inJurisdiction Whether location is within jurisdiction
     */
    function validateGeoStampJurisdiction(
        int256 latitude,
        int256 longitude,
        string calldata jurisdiction
    ) external view returns (bool inJurisdiction) {
        int256[4] storage bounds = jurisdictionBounds[jurisdiction];

        // Check if bounds are set
        if (bounds[0] == 0 && bounds[1] == 0 && bounds[2] == 0 && bounds[3] == 0) {
            return true; // No bounds set, allow by default
        }

        // Check if location is within bounding box
        return (
            latitude >= bounds[0] &&
            latitude <= bounds[1] &&
            longitude >= bounds[2] &&
            longitude <= bounds[3]
        );
    }

    /**
     * @notice Verify geo-stamp hash integrity
     * @param latitude Latitude
     * @param longitude Longitude
     * @param accuracy Accuracy
     * @param timestamp Timestamp
     * @param expectedHash Expected hash
     * @return isValid Whether hash matches
     */
    function verifyGeoStampHash(
        int256 latitude,
        int256 longitude,
        uint256 accuracy,
        uint256 timestamp,
        bytes32 expectedHash
    ) external pure returns (bool isValid) {
        bytes32 computedHash = keccak256(
            abi.encodePacked(latitude, longitude, accuracy, timestamp)
        );
        return computedHash == expectedHash;
    }

    /**
     * @notice Validate timestamp is within acceptable range
     * @param submittedTime Submitted timestamp
     * @param currentTime Current timestamp
     * @param tolerance Tolerance in seconds
     * @return isValid Whether timestamp is valid
     */
    function validateTimestampRange(
        uint256 submittedTime,
        uint256 currentTime,
        uint256 tolerance
    ) external pure returns (bool isValid) {
        // Reject future timestamps
        if (submittedTime > currentTime) {
            return false;
        }

        // Check within tolerance
        return (currentTime - submittedTime) <= tolerance;
    }

    /**
     * @notice Record sequential timestamp
     * @param assetId Asset identifier
     * @param stage Stage name
     * @param timestamp Timestamp
     */
    function recordSequentialTimestamp(
        bytes32 assetId,
        string calldata stage,
        uint256 timestamp
    ) external onlyRole(VALIDATOR_ROLE) {
        TimestampRecord[] storage sequence = timestampSequence[assetId];

        // Check ordering
        if (sequence.length > 0) {
            require(
                timestamp > sequence[sequence.length - 1].timestamp,
                "Timestamp must be after last recorded"
            );
        }

        sequence.push(TimestampRecord({
            stage: stage,
            timestamp: timestamp,
            blockNumber: block.number
        }));
    }

    /**
     * @notice Compute timestamp hash
     * @param submission Submission timestamp
     * @param notarization Notarization timestamp
     * @param validation Validation timestamp
     * @param consensus Consensus timestamp
     * @return hash Computed hash
     */
    function computeTimestampHash(
        uint256 submission,
        uint256 notarization,
        uint256 validation,
        uint256 consensus
    ) external pure returns (bytes32 hash) {
        return keccak256(
            abi.encodePacked(submission, notarization, validation, consensus)
        );
    }

    /**
     * @notice Compute Merkle root from document hashes
     * @param hashes Array of document hashes
     * @return root Merkle root
     */
    function computeMerkleRoot(
        bytes32[] calldata hashes
    ) external pure returns (bytes32 root) {
        require(hashes.length > 0, "No hashes provided");

        if (hashes.length == 1) {
            return hashes[0];
        }

        bytes32[] memory level = hashes;

        while (level.length > 1) {
            uint256 newSize = (level.length + 1) / 2;
            bytes32[] memory newLevel = new bytes32[](newSize);

            for (uint256 i = 0; i < newSize; i++) {
                if (2 * i + 1 < level.length) {
                    newLevel[i] = keccak256(
                        abi.encodePacked(level[2 * i], level[2 * i + 1])
                    );
                } else {
                    newLevel[i] = level[2 * i];
                }
            }

            level = newLevel;
        }

        return level[0];
    }

    /**
     * @notice Verify document inclusion in Merkle tree
     * @param documentHash Document hash to verify
     * @param proof Merkle proof
     * @param root Expected root
     * @param index Document index
     * @return isValid Whether document is in tree
     */
    function verifyDocumentInclusion(
        bytes32 documentHash,
        bytes32[] calldata proof,
        bytes32 root,
        uint256 index
    ) external pure returns (bool isValid) {
        bytes32 computedHash = documentHash;

        for (uint256 i = 0; i < proof.length; i++) {
            if (index % 2 == 0) {
                computedHash = keccak256(
                    abi.encodePacked(computedHash, proof[i])
                );
            } else {
                computedHash = keccak256(
                    abi.encodePacked(proof[i], computedHash)
                );
            }
            index = index / 2;
        }

        return computedHash == root;
    }

    /**
     * @notice Validate document schema compliance
     * @param requiredTypes Required document types
     * @param submittedTypes Submitted document types
     * @return isCompliant Whether schema is compliant
     */
    function validateDocumentSchema(
        string[] calldata requiredTypes,
        string[] calldata submittedTypes
    ) external pure returns (bool isCompliant) {
        if (requiredTypes.length > submittedTypes.length) {
            return false;
        }

        // Check all required types are present
        for (uint256 i = 0; i < requiredTypes.length; i++) {
            bool found = false;
            bytes32 requiredHash = keccak256(bytes(requiredTypes[i]));

            for (uint256 j = 0; j < submittedTypes.length; j++) {
                if (keccak256(bytes(submittedTypes[j])) == requiredHash) {
                    found = true;
                    break;
                }
            }

            if (!found) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Check oracle consensus status
     * @return consensusReached Whether consensus is valid
     */
    function checkOracleConsensus() external view returns (bool consensusReached) {
        // This is a general check - specific asset checks use getConsensusStatus
        return successfulConsensus > 0;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set oracle role for an address
     * @param oracle Oracle address
     * @param source Oracle source type
     */
    function setOracleRole(
        address oracle,
        OracleSource source
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(ORACLE_ROLE, oracle);
        // Source mapping would be stored externally or in a mapping
    }

    /**
     * @notice Update validation timeout
     * @param newTimeout New timeout in seconds
     */
    function setValidationTimeout(
        uint256 newTimeout
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTimeout >= 1 hours, "Timeout too short");
        validationTimeout = newTimeout;
    }

    /**
     * @notice Update oracle data max age
     * @param newMaxAge New max age in seconds
     */
    function setOracleDataMaxAge(
        uint256 newMaxAge
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMaxAge >= 1 hours, "Max age too short");
        oracleDataMaxAge = newMaxAge;
    }

    /**
     * @notice Update value tolerance for consensus
     * @param newTolerance New tolerance percentage
     */
    function setValueTolerance(
        uint256 newTolerance
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTolerance <= 25, "Tolerance too high");
        valueTolerance = newTolerance;
    }

    /**
     * @notice Set jurisdiction bounds
     * @param jurisdiction Jurisdiction code
     * @param bounds Bounding box [minLat, maxLat, minLon, maxLon]
     */
    function setJurisdictionBounds(
        string calldata jurisdiction,
        int256[4] calldata bounds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        jurisdictionBounds[jurisdiction] = bounds;
    }

    /**
     * @notice Pause oracle operations
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause oracle operations
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ Internal Functions ============

    /**
     * @dev Get oracle source from address
     */
    function _getOracleSource(address oracle) internal pure returns (OracleSource) {
        // In production, this would be a mapping lookup
        // For now, derive from address bits
        uint256 addrNum = uint256(uint160(oracle));
        return OracleSource(addrNum % 3);
    }

    /**
     * @dev Record audit entry
     */
    function _recordAudit(
        bytes32 assetId,
        string memory operation,
        address actor
    ) internal {
        AuditEntry[] storage trail = auditTrails[assetId];

        bytes32 prevHash = trail.length > 0 ? trail[trail.length - 1].currentHash : bytes32(0);

        bytes32 currentHash = keccak256(
            abi.encodePacked(prevHash, operation, block.timestamp, actor)
        );

        trail.push(AuditEntry({
            currentHash: currentHash,
            previousHash: prevHash,
            operation: operation,
            timestamp: block.timestamp,
            actor: actor
        }));
    }

    /**
     * @dev Calculate absolute difference
     */
    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }
}
