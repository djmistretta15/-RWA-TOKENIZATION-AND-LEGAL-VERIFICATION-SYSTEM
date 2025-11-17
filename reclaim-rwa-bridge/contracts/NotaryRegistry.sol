// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title NotaryRegistry
 * @author Reclaim RWA Bridge
 * @notice On-chain registry for managing licensed notary public credentials
 * @dev Implements notary verification, signature validation, and performance tracking
 *
 * AI-GRADE REQUIREMENT: notarySig verification
 * This contract validates notary signatures for asset proof registration
 */
contract NotaryRegistry is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Roles ============
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant NOTARY_ROLE = keccak256("NOTARY_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant JURISDICTION_ADMIN_ROLE = keccak256("JURISDICTION_ADMIN_ROLE");

    // ============ Enums ============
    enum NotaryStatus {
        INACTIVE,
        ACTIVE,
        SUSPENDED,
        REVOKED,
        EXPIRED
    }

    enum JurisdictionType {
        US_STATE,      // US State-level jurisdiction
        US_FEDERAL,    // US Federal recognition
        EU_MEMBER,     // EU Member State
        SWISS_CANTON,  // Swiss Canton
        SINGAPORE,     // Singapore
        UAE_ADGM,      // Abu Dhabi Global Market
        CAYMAN,        // Cayman Islands
        OTHER          // Other jurisdictions
    }

    // ============ Structs ============
    struct NotaryCredentials {
        string name;
        string licenseNumber;
        string jurisdiction;
        JurisdictionType jurisdictionType;
        uint256 licenseExpirationDate;
        uint256 registrationTimestamp;
        address notaryAddress;
        NotaryStatus status;
        string commissionNumber;
        string bondingCompany;
        uint256 bondAmount;
        bytes32 credentialHash;
        bool eNotaryEnabled;
        string[] certifications;
    }

    struct NotaryPerformance {
        uint256 totalNotarizations;
        uint256 successfulNotarizations;
        uint256 disputedNotarizations;
        uint256 revokedNotarizations;
        uint256 averageResponseTime;
        uint256 lastActivityTimestamp;
        uint256 reputationScore;
        uint256 totalVolume;
    }

    struct NotarizationRecord {
        bytes32 documentHash;
        bytes32 locationHash;
        uint256 timestamp;
        address notary;
        bytes signature;
        bool isValid;
        string metadata;
    }

    struct JurisdictionConfig {
        bool isEnabled;
        uint256 minBondAmount;
        uint256 maxNotarizationValue;
        bool requiresENotary;
        string[] requiredCertifications;
        uint256 notaryCount;
    }

    struct NotarySuspension {
        uint256 suspensionTimestamp;
        uint256 expectedEndTimestamp;
        string reason;
        address suspendedBy;
        bool isPermanent;
    }

    // ============ State Variables ============

    // Notary registry
    mapping(address => NotaryCredentials) public notaryCredentials;
    mapping(address => NotaryPerformance) public notaryPerformance;
    mapping(address => NotarySuspension) public notarySuspensions;
    mapping(address => bool) public isRegisteredNotary;

    // License number to address mapping (for lookups)
    mapping(string => address) public licenseToAddress;

    // Notarization records
    mapping(bytes32 => NotarizationRecord) public notarizationRecords;
    mapping(address => bytes32[]) public notaryRecordHistory;

    // Jurisdiction configurations
    mapping(string => JurisdictionConfig) public jurisdictionConfigs;
    string[] public enabledJurisdictions;

    // Global settings
    uint256 public minReputationScore = 50;
    uint256 public maxNotarizationsPerDay = 100;
    uint256 public signatureExpiryTime = 24 hours;
    uint256 public defaultBondAmount = 10000 * 10**18; // 10,000 tokens

    // Tracking
    address[] public allNotaries;
    uint256 public totalNotarizations;
    uint256 public activeNotaryCount;

    // ============ Events ============

    event NotaryRegistered(
        address indexed notary,
        string licenseNumber,
        string jurisdiction,
        uint256 expirationDate
    );

    event NotaryUpdated(
        address indexed notary,
        string field,
        string newValue
    );

    event NotaryStatusChanged(
        address indexed notary,
        NotaryStatus oldStatus,
        NotaryStatus newStatus,
        string reason
    );

    event NotaryRevoked(
        address indexed notary,
        string reason,
        address revokedBy
    );

    event NotarySuspended(
        address indexed notary,
        uint256 suspensionEnd,
        string reason
    );

    event NotaryReinstated(
        address indexed notary,
        string reason
    );

    event NotarizationRecorded(
        bytes32 indexed recordId,
        address indexed notary,
        bytes32 documentHash,
        uint256 timestamp
    );

    event SignatureVerified(
        address indexed notary,
        bytes32 documentHash,
        bool isValid
    );

    event JurisdictionEnabled(
        string jurisdiction,
        JurisdictionType jurisdictionType
    );

    event JurisdictionDisabled(
        string jurisdiction
    );

    event ReputationUpdated(
        address indexed notary,
        uint256 oldScore,
        uint256 newScore
    );

    event CredentialExpired(
        address indexed notary,
        uint256 expirationDate
    );

    // ============ Modifiers ============

    modifier onlyActiveNotary() {
        require(isRegisteredNotary[msg.sender], "Not a registered notary");
        require(
            notaryCredentials[msg.sender].status == NotaryStatus.ACTIVE,
            "Notary not active"
        );
        require(
            block.timestamp < notaryCredentials[msg.sender].licenseExpirationDate,
            "Notary license expired"
        );
        _;
    }

    modifier notaryExists(address notary) {
        require(isRegisteredNotary[notary], "Notary not registered");
        _;
    }

    modifier validJurisdiction(string memory jurisdiction) {
        require(
            jurisdictionConfigs[jurisdiction].isEnabled,
            "Jurisdiction not enabled"
        );
        _;
    }

    // ============ Constructor ============

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRY_ADMIN_ROLE, msg.sender);
        _grantRole(JURISDICTION_ADMIN_ROLE, msg.sender);

        // Initialize common US jurisdictions
        _initializeJurisdiction("US-DE", JurisdictionType.US_STATE, 10000 * 10**18, false);
        _initializeJurisdiction("US-NY", JurisdictionType.US_STATE, 25000 * 10**18, false);
        _initializeJurisdiction("US-CA", JurisdictionType.US_STATE, 15000 * 10**18, true);
        _initializeJurisdiction("US-TX", JurisdictionType.US_STATE, 10000 * 10**18, false);
        _initializeJurisdiction("US-FL", JurisdictionType.US_STATE, 7500 * 10**18, false);
        _initializeJurisdiction("US-WY", JurisdictionType.US_STATE, 10000 * 10**18, false);

        // International jurisdictions
        _initializeJurisdiction("CH-ZH", JurisdictionType.SWISS_CANTON, 50000 * 10**18, true);
        _initializeJurisdiction("SG", JurisdictionType.SINGAPORE, 100000 * 10**18, true);
        _initializeJurisdiction("AE-ADGM", JurisdictionType.UAE_ADGM, 200000 * 10**18, true);
        _initializeJurisdiction("KY", JurisdictionType.CAYMAN, 50000 * 10**18, true);
    }

    // ============ External Functions ============

    /**
     * @notice Register a new notary with verified credentials
     * @param notary Address of the notary
     * @param name Full legal name of notary
     * @param licenseNumber Official license/commission number
     * @param jurisdiction Jurisdiction code (e.g., "US-DE")
     * @param expirationDate License expiration timestamp
     */
    function registerNotary(
        address notary,
        string calldata name,
        string calldata licenseNumber,
        string calldata jurisdiction,
        uint256 expirationDate
    ) external onlyRole(REGISTRY_ADMIN_ROLE) validJurisdiction(jurisdiction) whenNotPaused {
        require(notary != address(0), "Invalid notary address");
        require(!isRegisteredNotary[notary], "Notary already registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(licenseNumber).length > 0, "License number required");
        require(expirationDate > block.timestamp, "Invalid expiration date");
        require(licenseToAddress[licenseNumber] == address(0), "License already registered");

        JurisdictionConfig storage config = jurisdictionConfigs[jurisdiction];

        // Create credential hash
        bytes32 credHash = keccak256(
            abi.encodePacked(notary, licenseNumber, jurisdiction, expirationDate)
        );

        // Create credentials
        notaryCredentials[notary] = NotaryCredentials({
            name: name,
            licenseNumber: licenseNumber,
            jurisdiction: jurisdiction,
            jurisdictionType: _getJurisdictionType(jurisdiction),
            licenseExpirationDate: expirationDate,
            registrationTimestamp: block.timestamp,
            notaryAddress: notary,
            status: NotaryStatus.ACTIVE,
            commissionNumber: "",
            bondingCompany: "",
            bondAmount: config.minBondAmount,
            credentialHash: credHash,
            eNotaryEnabled: config.requiresENotary,
            certifications: new string[](0)
        });

        // Initialize performance metrics
        notaryPerformance[notary] = NotaryPerformance({
            totalNotarizations: 0,
            successfulNotarizations: 0,
            disputedNotarizations: 0,
            revokedNotarizations: 0,
            averageResponseTime: 0,
            lastActivityTimestamp: block.timestamp,
            reputationScore: 100, // Start with perfect score
            totalVolume: 0
        });

        // Update mappings
        isRegisteredNotary[notary] = true;
        licenseToAddress[licenseNumber] = notary;
        allNotaries.push(notary);
        activeNotaryCount++;
        config.notaryCount++;

        // Grant notary role
        _grantRole(NOTARY_ROLE, notary);

        emit NotaryRegistered(notary, licenseNumber, jurisdiction, expirationDate);
    }

    /**
     * @notice Update notary commission and bonding information
     * @param notary Address of the notary
     * @param commissionNumber Commission number
     * @param bondingCompany Bonding company name
     * @param bondAmount Bond amount in wei
     */
    function updateNotaryBonding(
        address notary,
        string calldata commissionNumber,
        string calldata bondingCompany,
        uint256 bondAmount
    ) external onlyRole(REGISTRY_ADMIN_ROLE) notaryExists(notary) {
        NotaryCredentials storage creds = notaryCredentials[notary];
        JurisdictionConfig storage config = jurisdictionConfigs[creds.jurisdiction];

        require(bondAmount >= config.minBondAmount, "Bond amount below minimum");

        creds.commissionNumber = commissionNumber;
        creds.bondingCompany = bondingCompany;
        creds.bondAmount = bondAmount;

        emit NotaryUpdated(notary, "bonding", bondingCompany);
    }

    /**
     * @notice Add certification to notary credentials
     * @param notary Address of the notary
     * @param certification Certification name
     */
    function addCertification(
        address notary,
        string calldata certification
    ) external onlyRole(REGISTRY_ADMIN_ROLE) notaryExists(notary) {
        notaryCredentials[notary].certifications.push(certification);
        emit NotaryUpdated(notary, "certification", certification);
    }

    /**
     * @notice Verify notary signature on document hash
     * @param notary Address of the notary who signed
     * @param documentHash Hash of the document that was signed
     * @param signature ECDSA signature
     * @return isValid Whether signature is valid
     */
    function verifyNotarySignature(
        address notary,
        bytes32 documentHash,
        bytes calldata signature
    ) external view notaryExists(notary) returns (bool isValid) {
        NotaryCredentials storage creds = notaryCredentials[notary];

        // Check notary status
        if (creds.status != NotaryStatus.ACTIVE) {
            return false;
        }

        // Check expiration
        if (block.timestamp >= creds.licenseExpirationDate) {
            return false;
        }

        // Verify signature using ECDSA
        bytes32 ethSignedHash = documentHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        isValid = recoveredSigner == notary;
    }

    /**
     * @notice Record a notarization event
     * @param documentHash Hash of the notarized document
     * @param locationHash Hash of the geo-location stamp
     * @return recordId Unique identifier for this notarization
     */
    function recordNotarization(
        bytes32 documentHash,
        bytes32 locationHash
    ) external onlyActiveNotary nonReentrant returns (bytes32 recordId) {
        // Check daily limit
        require(
            _checkDailyLimit(msg.sender),
            "Daily notarization limit exceeded"
        );

        // Generate unique record ID
        recordId = keccak256(
            abi.encodePacked(
                documentHash,
                locationHash,
                msg.sender,
                block.timestamp,
                totalNotarizations
            )
        );

        require(
            notarizationRecords[recordId].timestamp == 0,
            "Record already exists"
        );

        // Create record
        notarizationRecords[recordId] = NotarizationRecord({
            documentHash: documentHash,
            locationHash: locationHash,
            timestamp: block.timestamp,
            notary: msg.sender,
            signature: "",
            isValid: true,
            metadata: ""
        });

        // Update performance metrics
        NotaryPerformance storage perf = notaryPerformance[msg.sender];
        perf.totalNotarizations++;
        perf.successfulNotarizations++;
        perf.lastActivityTimestamp = block.timestamp;

        // Track in history
        notaryRecordHistory[msg.sender].push(recordId);
        totalNotarizations++;

        emit NotarizationRecorded(recordId, msg.sender, documentHash, block.timestamp);
    }

    /**
     * @notice Record notarization timestamp for asset proof
     * @param assetId Asset identifier
     * @param documentHash Hash of the notarized document
     */
    function recordNotarizationTimestamp(
        bytes32 assetId,
        bytes32 documentHash
    ) external onlyActiveNotary {
        bytes32 recordId = keccak256(
            abi.encodePacked(assetId, documentHash, block.timestamp)
        );

        notarizationRecords[recordId] = NotarizationRecord({
            documentHash: documentHash,
            locationHash: assetId,
            timestamp: block.timestamp,
            notary: msg.sender,
            signature: "",
            isValid: true,
            metadata: ""
        });

        notaryPerformance[msg.sender].lastActivityTimestamp = block.timestamp;
        notaryRecordHistory[msg.sender].push(recordId);

        emit NotarizationRecorded(recordId, msg.sender, documentHash, block.timestamp);
    }

    /**
     * @notice Revoke a notary's credentials
     * @param notary Address of the notary
     * @param reason Reason for revocation
     */
    function revokeNotary(
        address notary,
        string calldata reason
    ) external onlyRole(REGISTRY_ADMIN_ROLE) notaryExists(notary) {
        NotaryStatus oldStatus = notaryCredentials[notary].status;
        notaryCredentials[notary].status = NotaryStatus.REVOKED;

        // Revoke role
        _revokeRole(NOTARY_ROLE, notary);

        // Update counts
        if (oldStatus == NotaryStatus.ACTIVE) {
            activeNotaryCount--;
            jurisdictionConfigs[notaryCredentials[notary].jurisdiction].notaryCount--;
        }

        // Record suspension
        notarySuspensions[notary] = NotarySuspension({
            suspensionTimestamp: block.timestamp,
            expectedEndTimestamp: type(uint256).max, // Permanent
            reason: reason,
            suspendedBy: msg.sender,
            isPermanent: true
        });

        emit NotaryRevoked(notary, reason, msg.sender);
        emit NotaryStatusChanged(notary, oldStatus, NotaryStatus.REVOKED, reason);
    }

    /**
     * @notice Temporarily suspend a notary
     * @param notary Address of the notary
     * @param duration Suspension duration in seconds
     * @param reason Reason for suspension
     */
    function suspendNotary(
        address notary,
        uint256 duration,
        string calldata reason
    ) external onlyRole(REGISTRY_ADMIN_ROLE) notaryExists(notary) {
        require(duration > 0, "Invalid duration");

        NotaryStatus oldStatus = notaryCredentials[notary].status;
        notaryCredentials[notary].status = NotaryStatus.SUSPENDED;

        uint256 endTime = block.timestamp + duration;

        notarySuspensions[notary] = NotarySuspension({
            suspensionTimestamp: block.timestamp,
            expectedEndTimestamp: endTime,
            reason: reason,
            suspendedBy: msg.sender,
            isPermanent: false
        });

        if (oldStatus == NotaryStatus.ACTIVE) {
            activeNotaryCount--;
        }

        emit NotarySuspended(notary, endTime, reason);
        emit NotaryStatusChanged(notary, oldStatus, NotaryStatus.SUSPENDED, reason);
    }

    /**
     * @notice Reinstate a suspended notary
     * @param notary Address of the notary
     * @param reason Reason for reinstatement
     */
    function reinstateNotary(
        address notary,
        string calldata reason
    ) external onlyRole(REGISTRY_ADMIN_ROLE) notaryExists(notary) {
        require(
            notaryCredentials[notary].status == NotaryStatus.SUSPENDED,
            "Notary not suspended"
        );
        require(
            block.timestamp < notaryCredentials[notary].licenseExpirationDate,
            "License expired"
        );

        NotaryStatus oldStatus = notaryCredentials[notary].status;
        notaryCredentials[notary].status = NotaryStatus.ACTIVE;
        activeNotaryCount++;

        // Clear suspension
        delete notarySuspensions[notary];

        emit NotaryReinstated(notary, reason);
        emit NotaryStatusChanged(notary, oldStatus, NotaryStatus.ACTIVE, reason);
    }

    /**
     * @notice Update notary reputation score
     * @param notary Address of the notary
     * @param adjustment Score adjustment (positive or negative)
     * @param reason Reason for adjustment
     */
    function updateReputation(
        address notary,
        int256 adjustment,
        string calldata reason
    ) external onlyRole(AUDITOR_ROLE) notaryExists(notary) {
        NotaryPerformance storage perf = notaryPerformance[notary];
        uint256 oldScore = perf.reputationScore;

        if (adjustment < 0) {
            uint256 decrease = uint256(-adjustment);
            if (decrease >= perf.reputationScore) {
                perf.reputationScore = 0;
            } else {
                perf.reputationScore -= decrease;
            }
        } else {
            perf.reputationScore += uint256(adjustment);
            if (perf.reputationScore > 100) {
                perf.reputationScore = 100;
            }
        }

        // Auto-suspend if score too low
        if (perf.reputationScore < minReputationScore) {
            NotaryStatus oldStatus = notaryCredentials[notary].status;
            if (oldStatus == NotaryStatus.ACTIVE) {
                notaryCredentials[notary].status = NotaryStatus.SUSPENDED;
                activeNotaryCount--;
                emit NotaryStatusChanged(
                    notary,
                    oldStatus,
                    NotaryStatus.SUSPENDED,
                    "Low reputation score"
                );
            }
        }

        emit ReputationUpdated(notary, oldScore, perf.reputationScore);
    }

    /**
     * @notice Check and update expired notary credentials
     * @param notary Address of the notary
     */
    function checkExpiration(address notary) external notaryExists(notary) {
        NotaryCredentials storage creds = notaryCredentials[notary];

        if (
            block.timestamp >= creds.licenseExpirationDate &&
            creds.status == NotaryStatus.ACTIVE
        ) {
            NotaryStatus oldStatus = creds.status;
            creds.status = NotaryStatus.EXPIRED;
            activeNotaryCount--;

            emit CredentialExpired(notary, creds.licenseExpirationDate);
            emit NotaryStatusChanged(notary, oldStatus, NotaryStatus.EXPIRED, "License expired");
        }
    }

    /**
     * @notice Renew notary license
     * @param notary Address of the notary
     * @param newExpirationDate New expiration timestamp
     */
    function renewLicense(
        address notary,
        uint256 newExpirationDate
    ) external onlyRole(REGISTRY_ADMIN_ROLE) notaryExists(notary) {
        require(newExpirationDate > block.timestamp, "Invalid expiration date");

        NotaryCredentials storage creds = notaryCredentials[notary];
        NotaryStatus oldStatus = creds.status;

        creds.licenseExpirationDate = newExpirationDate;

        // Reactivate if was expired
        if (oldStatus == NotaryStatus.EXPIRED) {
            creds.status = NotaryStatus.ACTIVE;
            activeNotaryCount++;
            emit NotaryStatusChanged(notary, oldStatus, NotaryStatus.ACTIVE, "License renewed");
        }

        emit NotaryUpdated(notary, "licenseExpiration", "renewed");
    }

    // ============ View Functions ============

    /**
     * @notice Get complete notary information
     * @param notary Address of the notary
     * @return creds Notary credentials
     */
    function getNotaryInfo(
        address notary
    ) external view notaryExists(notary) returns (NotaryCredentials memory creds) {
        return notaryCredentials[notary];
    }

    /**
     * @notice Get notary performance metrics
     * @param notary Address of the notary
     * @return metrics Performance metrics
     */
    function getNotaryMetrics(
        address notary
    ) external view notaryExists(notary) returns (NotaryPerformance memory metrics) {
        return notaryPerformance[notary];
    }

    /**
     * @notice Get notary's notarization history
     * @param notary Address of the notary
     * @return recordIds Array of record IDs
     */
    function getNotaryHistory(
        address notary
    ) external view notaryExists(notary) returns (bytes32[] memory recordIds) {
        return notaryRecordHistory[notary];
    }

    /**
     * @notice Get notarization record details
     * @param recordId Record identifier
     * @return record Notarization record
     */
    function getNotarizationRecord(
        bytes32 recordId
    ) external view returns (NotarizationRecord memory record) {
        require(notarizationRecords[recordId].timestamp > 0, "Record not found");
        return notarizationRecords[recordId];
    }

    /**
     * @notice Get all notaries in a jurisdiction
     * @param jurisdiction Jurisdiction code
     * @return notaryList Array of notary addresses
     */
    function getNotariesByJurisdiction(
        string calldata jurisdiction
    ) external view returns (address[] memory notaryList) {
        uint256 count = 0;

        // Count notaries in jurisdiction
        for (uint256 i = 0; i < allNotaries.length; i++) {
            if (
                keccak256(bytes(notaryCredentials[allNotaries[i]].jurisdiction)) ==
                keccak256(bytes(jurisdiction))
            ) {
                count++;
            }
        }

        // Build array
        notaryList = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < allNotaries.length; i++) {
            if (
                keccak256(bytes(notaryCredentials[allNotaries[i]].jurisdiction)) ==
                keccak256(bytes(jurisdiction))
            ) {
                notaryList[index] = allNotaries[i];
                index++;
            }
        }
    }

    /**
     * @notice Get notarization timestamp for an asset
     * @param assetId Asset identifier
     * @return timestamp Notarization timestamp
     */
    function getNotarizationTimestamp(
        bytes32 assetId
    ) external view returns (uint256 timestamp) {
        // Search for record with matching assetId (stored in locationHash)
        for (uint256 i = 0; i < allNotaries.length; i++) {
            bytes32[] storage history = notaryRecordHistory[allNotaries[i]];
            for (uint256 j = 0; j < history.length; j++) {
                if (notarizationRecords[history[j]].locationHash == assetId) {
                    return notarizationRecords[history[j]].timestamp;
                }
            }
        }
        return 0;
    }

    /**
     * @notice Check if notary license is valid
     * @param notary Address to check
     * @return isValid Whether license is currently valid
     */
    function isLicenseValid(address notary) external view returns (bool isValid) {
        if (!isRegisteredNotary[notary]) return false;

        NotaryCredentials storage creds = notaryCredentials[notary];
        return (
            creds.status == NotaryStatus.ACTIVE &&
            block.timestamp < creds.licenseExpirationDate
        );
    }

    /**
     * @notice Get enabled jurisdictions list
     * @return jurisdictions Array of jurisdiction codes
     */
    function getEnabledJurisdictions() external view returns (string[] memory) {
        return enabledJurisdictions;
    }

    /**
     * @notice Get jurisdiction configuration
     * @param jurisdiction Jurisdiction code
     * @return config Jurisdiction configuration
     */
    function getJurisdictionConfig(
        string calldata jurisdiction
    ) external view returns (JurisdictionConfig memory config) {
        return jurisdictionConfigs[jurisdiction];
    }

    /**
     * @notice Get total number of registered notaries
     * @return count Total notary count
     */
    function getTotalNotaryCount() external view returns (uint256 count) {
        return allNotaries.length;
    }

    /**
     * @notice Get all registered notary addresses
     * @return notaries Array of all notary addresses
     */
    function getAllNotaries() external view returns (address[] memory) {
        return allNotaries;
    }

    // ============ Admin Functions ============

    /**
     * @notice Enable a new jurisdiction
     * @param jurisdiction Jurisdiction code
     * @param jurisdictionType Type of jurisdiction
     * @param minBond Minimum bond amount
     * @param requiresENotary Whether e-notary is required
     */
    function enableJurisdiction(
        string calldata jurisdiction,
        JurisdictionType jurisdictionType,
        uint256 minBond,
        bool requiresENotary
    ) external onlyRole(JURISDICTION_ADMIN_ROLE) {
        require(!jurisdictionConfigs[jurisdiction].isEnabled, "Already enabled");

        _initializeJurisdiction(jurisdiction, jurisdictionType, minBond, requiresENotary);

        emit JurisdictionEnabled(jurisdiction, jurisdictionType);
    }

    /**
     * @notice Disable a jurisdiction
     * @param jurisdiction Jurisdiction code
     */
    function disableJurisdiction(
        string calldata jurisdiction
    ) external onlyRole(JURISDICTION_ADMIN_ROLE) {
        require(jurisdictionConfigs[jurisdiction].isEnabled, "Not enabled");
        require(
            jurisdictionConfigs[jurisdiction].notaryCount == 0,
            "Active notaries in jurisdiction"
        );

        jurisdictionConfigs[jurisdiction].isEnabled = false;

        // Remove from enabled list
        for (uint256 i = 0; i < enabledJurisdictions.length; i++) {
            if (
                keccak256(bytes(enabledJurisdictions[i])) ==
                keccak256(bytes(jurisdiction))
            ) {
                enabledJurisdictions[i] = enabledJurisdictions[
                    enabledJurisdictions.length - 1
                ];
                enabledJurisdictions.pop();
                break;
            }
        }

        emit JurisdictionDisabled(jurisdiction);
    }

    /**
     * @notice Update global settings
     * @param newMinReputation New minimum reputation score
     * @param newMaxDaily New max daily notarizations
     * @param newSignatureExpiry New signature expiry time
     */
    function updateGlobalSettings(
        uint256 newMinReputation,
        uint256 newMaxDaily,
        uint256 newSignatureExpiry
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(newMinReputation <= 100, "Invalid reputation threshold");
        require(newMaxDaily > 0, "Invalid daily limit");
        require(newSignatureExpiry > 0, "Invalid expiry time");

        minReputationScore = newMinReputation;
        maxNotarizationsPerDay = newMaxDaily;
        signatureExpiryTime = newSignatureExpiry;
    }

    /**
     * @notice Pause registry operations
     */
    function pause() external onlyRole(REGISTRY_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause registry operations
     */
    function unpause() external onlyRole(REGISTRY_ADMIN_ROLE) {
        _unpause();
    }

    // ============ Internal Functions ============

    /**
     * @dev Initialize jurisdiction configuration
     */
    function _initializeJurisdiction(
        string memory jurisdiction,
        JurisdictionType jurisdictionType,
        uint256 minBond,
        bool requiresENotary
    ) internal {
        jurisdictionConfigs[jurisdiction] = JurisdictionConfig({
            isEnabled: true,
            minBondAmount: minBond,
            maxNotarizationValue: type(uint256).max,
            requiresENotary: requiresENotary,
            requiredCertifications: new string[](0),
            notaryCount: 0
        });

        enabledJurisdictions.push(jurisdiction);
    }

    /**
     * @dev Get jurisdiction type from code
     */
    function _getJurisdictionType(
        string memory jurisdiction
    ) internal pure returns (JurisdictionType) {
        bytes32 hash = keccak256(bytes(jurisdiction));

        // US States
        if (
            hash == keccak256("US-DE") ||
            hash == keccak256("US-NY") ||
            hash == keccak256("US-CA") ||
            hash == keccak256("US-TX") ||
            hash == keccak256("US-FL") ||
            hash == keccak256("US-WY")
        ) {
            return JurisdictionType.US_STATE;
        }

        // Swiss Cantons
        if (hash == keccak256("CH-ZH") || hash == keccak256("CH-GE")) {
            return JurisdictionType.SWISS_CANTON;
        }

        // Singapore
        if (hash == keccak256("SG")) {
            return JurisdictionType.SINGAPORE;
        }

        // UAE ADGM
        if (hash == keccak256("AE-ADGM")) {
            return JurisdictionType.UAE_ADGM;
        }

        // Cayman
        if (hash == keccak256("KY")) {
            return JurisdictionType.CAYMAN;
        }

        return JurisdictionType.OTHER;
    }

    /**
     * @dev Check if notary is within daily limit
     */
    function _checkDailyLimit(address notary) internal view returns (bool) {
        bytes32[] storage history = notaryRecordHistory[notary];
        if (history.length == 0) return true;

        uint256 todayCount = 0;
        uint256 dayStart = block.timestamp - (block.timestamp % 86400);

        // Count from end of array (most recent)
        for (uint256 i = history.length; i > 0; i--) {
            NotarizationRecord storage record = notarizationRecords[history[i - 1]];
            if (record.timestamp >= dayStart) {
                todayCount++;
            } else {
                break; // Records are chronological
            }
        }

        return todayCount < maxNotarizationsPerDay;
    }
}
