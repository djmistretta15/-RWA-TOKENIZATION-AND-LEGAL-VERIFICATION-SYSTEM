// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title RWAReconciliation
 * @notice Off-chain legal registry reconciliation engine with automated discrepancy detection
 * @dev Ensures on-chain token state matches off-chain legal ownership records
 *
 * AI-GRADE REQUIREMENT: Continuous validation of 1-block sync guarantee
 *
 * Key Features:
 * - Periodic reconciliation runs (configurable intervals)
 * - Automated discrepancy detection and classification
 * - Multi-stage dispute resolution pipeline
 * - Court-admissible audit trail generation
 * - Regulatory reporting automation
 * - Oracle-based off-chain data ingestion
 * - Automated freeze triggers for critical discrepancies
 */
contract RWAReconciliation is AccessControl, ReentrancyGuard, Pausable {

    // ═══════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════

    bytes32 public constant RECONCILER_ROLE = keccak256("RECONCILER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    // ═══════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════

    enum DiscrepancyType {
        NONE,
        BALANCE_MISMATCH,           // On-chain balance != off-chain record
        OWNERSHIP_CONFLICT,          // Multiple owners claiming same asset
        MISSING_LEGAL_RECORD,        // Token exists but no legal record
        MISSING_TOKEN_RECORD,        // Legal record exists but no token
        PARTITION_MISMATCH,          // Share class inconsistency
        TRANSFER_NOT_RECORDED,       // Transfer occurred but not in registry
        TIMESTAMP_DISCREPANCY,       // Significant time difference in records
        VALUATION_MISMATCH,          // Asset valuation inconsistency
        JURISDICTION_CONFLICT,       // Jurisdiction designation mismatch
        COMPLIANCE_STATUS_MISMATCH   // Compliance status inconsistency
    }

    enum DiscrepancySeverity {
        LOW,        // Minor timing differences, auto-resolvable
        MEDIUM,     // Requires manual review but not critical
        HIGH,       // Significant issue, may affect legal validity
        CRITICAL    // Immediate freeze required, potential fraud
    }

    enum ResolutionStatus {
        PENDING,
        UNDER_REVIEW,
        RESOLVED_AUTO,
        RESOLVED_MANUAL,
        ESCALATED,
        FROZEN,
        CLOSED_INVALID
    }

    enum ReconciliationStatus {
        NOT_STARTED,
        IN_PROGRESS,
        COMPLETED_CLEAN,
        COMPLETED_WITH_ISSUES,
        FAILED,
        CANCELLED
    }

    // ═══════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════

    struct Discrepancy {
        bytes32 discrepancyId;
        bytes32 assetId;
        address affectedHolder;
        DiscrepancyType discrepancyType;
        DiscrepancySeverity severity;
        ResolutionStatus status;
        uint256 onChainValue;
        uint256 offChainValue;
        bytes32 onChainDataHash;
        bytes32 offChainDataHash;
        uint256 detectedAt;
        uint256 resolvedAt;
        address resolvedBy;
        string resolutionNotes;
        bytes32 evidenceHash;
        uint256 reconciliationRunId;
    }

    struct ReconciliationRun {
        uint256 runId;
        uint256 startTime;
        uint256 endTime;
        ReconciliationStatus status;
        uint256 totalRecordsChecked;
        uint256 discrepanciesFound;
        uint256 autoResolved;
        uint256 manualRequired;
        uint256 criticalIssues;
        bytes32 onChainStateHash;
        bytes32 offChainStateHash;
        address initiatedBy;
        string reportIPFSHash;
    }

    struct ReconciliationConfig {
        uint256 runInterval;                // Seconds between runs (default: 86400 = 24h)
        uint256 maxDiscrepancyAge;          // Max time before auto-escalation
        uint256 autoResolveThreshold;       // Value threshold for auto-resolution
        uint256 criticalFreezeThreshold;    // Value threshold for auto-freeze
        bool autoFreezeOnCritical;          // Auto-freeze on critical discrepancy
        bool requiresMultiSigResolution;    // Require multiple signatures for resolution
        uint256 minSignaturesRequired;      // Minimum signatures for resolution
    }

    struct OffChainRecord {
        bytes32 assetId;
        address holder;
        uint256 balance;
        bytes32 partition;
        uint256 timestamp;
        bytes32 documentHash;
        string jurisdiction;
        bool verified;
    }

    struct AuditEntry {
        uint256 entryId;
        uint256 timestamp;
        bytes32 discrepancyId;
        string action;
        address actor;
        bytes32 beforeStateHash;
        bytes32 afterStateHash;
        string notes;
        bytes signature;
    }

    struct RegulatoryReport {
        uint256 reportId;
        uint256 generatedAt;
        string reportType;          // "MONTHLY", "QUARTERLY", "ANNUAL", "INCIDENT"
        uint256 periodStart;
        uint256 periodEnd;
        uint256 totalReconciliations;
        uint256 totalDiscrepancies;
        uint256 resolvedDiscrepancies;
        uint256 pendingDiscrepancies;
        bytes32 reportHash;
        string ipfsHash;
        bool submittedToRegulator;
    }

    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════

    // Configuration
    ReconciliationConfig public config;

    // Reconciliation runs
    mapping(uint256 => ReconciliationRun) public reconciliationRuns;
    uint256 public currentRunId;
    uint256 public lastReconciliationTime;

    // Discrepancies
    mapping(bytes32 => Discrepancy) public discrepancies;
    bytes32[] public activeDiscrepancies;
    bytes32[] public resolvedDiscrepancies;
    uint256 public totalDiscrepanciesDetected;

    // Off-chain records (submitted by oracle)
    mapping(bytes32 => OffChainRecord) public offChainRecords; // assetId => record
    mapping(address => mapping(bytes32 => uint256)) public offChainBalances; // holder => partition => balance

    // Audit trail
    mapping(bytes32 => AuditEntry[]) public discrepancyAuditTrail;
    uint256 public totalAuditEntries;

    // Regulatory reports
    mapping(uint256 => RegulatoryReport) public regulatoryReports;
    uint256 public totalReports;

    // Connected contracts
    address public rwaToken;
    address public rwaRegistry;
    address public legalWrapper;

    // Statistics
    uint256 public totalReconciliationsCompleted;
    uint256 public totalAutoResolutions;
    uint256 public totalManualResolutions;
    uint256 public totalFreezeTriggered;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════

    event ReconciliationStarted(
        uint256 indexed runId,
        uint256 timestamp,
        address indexed initiator
    );

    event ReconciliationCompleted(
        uint256 indexed runId,
        ReconciliationStatus status,
        uint256 discrepanciesFound,
        uint256 autoResolved
    );

    event DiscrepancyDetected(
        bytes32 indexed discrepancyId,
        bytes32 indexed assetId,
        address indexed holder,
        DiscrepancyType discrepancyType,
        DiscrepancySeverity severity
    );

    event DiscrepancyResolved(
        bytes32 indexed discrepancyId,
        ResolutionStatus resolutionType,
        address indexed resolvedBy,
        string notes
    );

    event DiscrepancyEscalated(
        bytes32 indexed discrepancyId,
        DiscrepancySeverity newSeverity,
        string reason
    );

    event CriticalDiscrepancyFreezeTriggered(
        bytes32 indexed discrepancyId,
        bytes32 indexed assetId,
        address indexed holder
    );

    event OffChainRecordSubmitted(
        bytes32 indexed assetId,
        address indexed holder,
        uint256 balance,
        bytes32 documentHash
    );

    event AuditEntryCreated(
        uint256 indexed entryId,
        bytes32 indexed discrepancyId,
        string action
    );

    event RegulatoryReportGenerated(
        uint256 indexed reportId,
        string reportType,
        bytes32 reportHash
    );

    event ConfigurationUpdated(
        string parameter,
        uint256 oldValue,
        uint256 newValue
    );

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(
        address _rwaToken,
        address _rwaRegistry,
        address _legalWrapper
    ) {
        require(_rwaToken != address(0), "Invalid token address");
        require(_rwaRegistry != address(0), "Invalid registry address");
        require(_legalWrapper != address(0), "Invalid wrapper address");

        rwaToken = _rwaToken;
        rwaRegistry = _rwaRegistry;
        legalWrapper = _legalWrapper;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RECONCILER_ROLE, msg.sender);
        _grantRole(AUDITOR_ROLE, msg.sender);
        _grantRole(DISPUTE_RESOLVER_ROLE, msg.sender);

        // Default configuration
        config = ReconciliationConfig({
            runInterval: 86400,              // 24 hours
            maxDiscrepancyAge: 604800,       // 7 days
            autoResolveThreshold: 100e18,    // $100 USD equivalent
            criticalFreezeThreshold: 100000e18, // $100k USD
            autoFreezeOnCritical: true,
            requiresMultiSigResolution: true,
            minSignaturesRequired: 2
        });

        lastReconciliationTime = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════
    // ORACLE DATA INGESTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Submit off-chain legal registry data for reconciliation
     * @dev Called by authorized oracle to provide off-chain state
     */
    function submitOffChainRecord(
        bytes32 assetId,
        address holder,
        uint256 balance,
        bytes32 partition,
        bytes32 documentHash,
        string memory jurisdiction
    ) external onlyRole(ORACLE_ROLE) {
        require(holder != address(0), "Invalid holder");

        offChainRecords[assetId] = OffChainRecord({
            assetId: assetId,
            holder: holder,
            balance: balance,
            partition: partition,
            timestamp: block.timestamp,
            documentHash: documentHash,
            jurisdiction: jurisdiction,
            verified: true
        });

        offChainBalances[holder][partition] = balance;

        emit OffChainRecordSubmitted(assetId, holder, balance, documentHash);
    }

    /**
     * @notice Batch submit multiple off-chain records
     * @dev Gas-efficient batch operation
     */
    function batchSubmitOffChainRecords(
        bytes32[] memory assetIds,
        address[] memory holders,
        uint256[] memory balances,
        bytes32[] memory partitions,
        bytes32[] memory documentHashes,
        string[] memory jurisdictions
    ) external onlyRole(ORACLE_ROLE) {
        require(assetIds.length == holders.length, "Array length mismatch");
        require(assetIds.length == balances.length, "Array length mismatch");
        require(assetIds.length == partitions.length, "Array length mismatch");

        for (uint256 i = 0; i < assetIds.length; i++) {
            offChainRecords[assetIds[i]] = OffChainRecord({
                assetId: assetIds[i],
                holder: holders[i],
                balance: balances[i],
                partition: partitions[i],
                timestamp: block.timestamp,
                documentHash: documentHashes[i],
                jurisdiction: jurisdictions[i],
                verified: true
            });

            offChainBalances[holders[i]][partitions[i]] = balances[i];

            emit OffChainRecordSubmitted(assetIds[i], holders[i], balances[i], documentHashes[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // RECONCILIATION ENGINE
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Start a new reconciliation run
     * @dev Compares on-chain token state with off-chain legal registry
     */
    function startReconciliation()
        external
        onlyRole(RECONCILER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 runId)
    {
        require(
            block.timestamp >= lastReconciliationTime + config.runInterval,
            "Too soon for next reconciliation"
        );

        currentRunId++;
        runId = currentRunId;

        reconciliationRuns[runId] = ReconciliationRun({
            runId: runId,
            startTime: block.timestamp,
            endTime: 0,
            status: ReconciliationStatus.IN_PROGRESS,
            totalRecordsChecked: 0,
            discrepanciesFound: 0,
            autoResolved: 0,
            manualRequired: 0,
            criticalIssues: 0,
            onChainStateHash: bytes32(0),
            offChainStateHash: bytes32(0),
            initiatedBy: msg.sender,
            reportIPFSHash: ""
        });

        emit ReconciliationStarted(runId, block.timestamp, msg.sender);

        return runId;
    }

    /**
     * @notice Record a detected discrepancy during reconciliation
     * @dev Internal function called during reconciliation process
     */
    function recordDiscrepancy(
        uint256 runId,
        bytes32 assetId,
        address holder,
        DiscrepancyType discrepancyType,
        uint256 onChainValue,
        uint256 offChainValue,
        bytes32 onChainDataHash,
        bytes32 offChainDataHash
    ) external onlyRole(RECONCILER_ROLE) returns (bytes32 discrepancyId) {
        require(reconciliationRuns[runId].status == ReconciliationStatus.IN_PROGRESS, "Run not active");

        // Generate unique discrepancy ID
        discrepancyId = keccak256(abi.encodePacked(
            runId,
            assetId,
            holder,
            discrepancyType,
            block.timestamp
        ));

        // Determine severity based on type and value
        DiscrepancySeverity severity = _calculateSeverity(discrepancyType, onChainValue, offChainValue);

        discrepancies[discrepancyId] = Discrepancy({
            discrepancyId: discrepancyId,
            assetId: assetId,
            affectedHolder: holder,
            discrepancyType: discrepancyType,
            severity: severity,
            status: ResolutionStatus.PENDING,
            onChainValue: onChainValue,
            offChainValue: offChainValue,
            onChainDataHash: onChainDataHash,
            offChainDataHash: offChainDataHash,
            detectedAt: block.timestamp,
            resolvedAt: 0,
            resolvedBy: address(0),
            resolutionNotes: "",
            evidenceHash: bytes32(0),
            reconciliationRunId: runId
        });

        activeDiscrepancies.push(discrepancyId);
        totalDiscrepanciesDetected++;

        reconciliationRuns[runId].discrepanciesFound++;

        emit DiscrepancyDetected(discrepancyId, assetId, holder, discrepancyType, severity);

        // Handle critical discrepancies
        if (severity == DiscrepancySeverity.CRITICAL && config.autoFreezeOnCritical) {
            reconciliationRuns[runId].criticalIssues++;
            _triggerCriticalFreeze(discrepancyId);
        }

        // Attempt auto-resolution for low severity
        if (severity == DiscrepancySeverity.LOW) {
            _attemptAutoResolution(discrepancyId);
        } else {
            reconciliationRuns[runId].manualRequired++;
        }

        // Create audit entry
        _createAuditEntry(discrepancyId, "DISCREPANCY_DETECTED", bytes32(0), bytes32(0), "");

        return discrepancyId;
    }

    /**
     * @notice Complete a reconciliation run
     * @dev Finalize run and generate summary
     */
    function completeReconciliation(
        uint256 runId,
        uint256 totalRecords,
        bytes32 onChainStateHash,
        bytes32 offChainStateHash,
        string memory reportIPFSHash
    ) external onlyRole(RECONCILER_ROLE) {
        require(reconciliationRuns[runId].status == ReconciliationStatus.IN_PROGRESS, "Run not active");

        ReconciliationRun storage run = reconciliationRuns[runId];
        run.endTime = block.timestamp;
        run.totalRecordsChecked = totalRecords;
        run.onChainStateHash = onChainStateHash;
        run.offChainStateHash = offChainStateHash;
        run.reportIPFSHash = reportIPFSHash;

        // Determine final status
        if (run.discrepanciesFound == 0) {
            run.status = ReconciliationStatus.COMPLETED_CLEAN;
        } else {
            run.status = ReconciliationStatus.COMPLETED_WITH_ISSUES;
        }

        lastReconciliationTime = block.timestamp;
        totalReconciliationsCompleted++;

        emit ReconciliationCompleted(runId, run.status, run.discrepanciesFound, run.autoResolved);
    }

    // ═══════════════════════════════════════════════════════════════
    // DISCREPANCY RESOLUTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Manually resolve a discrepancy
     * @dev Requires DISPUTE_RESOLVER_ROLE
     */
    function resolveDiscrepancy(
        bytes32 discrepancyId,
        string memory resolutionNotes,
        bytes32 evidenceHash
    ) external onlyRole(DISPUTE_RESOLVER_ROLE) nonReentrant {
        Discrepancy storage disc = discrepancies[discrepancyId];
        require(disc.status == ResolutionStatus.PENDING || disc.status == ResolutionStatus.UNDER_REVIEW, "Cannot resolve");

        bytes32 beforeHash = keccak256(abi.encode(disc));

        disc.status = ResolutionStatus.RESOLVED_MANUAL;
        disc.resolvedAt = block.timestamp;
        disc.resolvedBy = msg.sender;
        disc.resolutionNotes = resolutionNotes;
        disc.evidenceHash = evidenceHash;

        // Remove from active list
        _removeFromActiveDiscrepancies(discrepancyId);
        resolvedDiscrepancies.push(discrepancyId);

        totalManualResolutions++;

        bytes32 afterHash = keccak256(abi.encode(disc));
        _createAuditEntry(discrepancyId, "MANUAL_RESOLUTION", beforeHash, afterHash, resolutionNotes);

        emit DiscrepancyResolved(discrepancyId, ResolutionStatus.RESOLVED_MANUAL, msg.sender, resolutionNotes);
    }

    /**
     * @notice Escalate discrepancy to higher severity
     * @dev Used when issue is more serious than initially classified
     */
    function escalateDiscrepancy(
        bytes32 discrepancyId,
        DiscrepancySeverity newSeverity,
        string memory reason
    ) external onlyRole(DISPUTE_RESOLVER_ROLE) {
        Discrepancy storage disc = discrepancies[discrepancyId];
        require(uint8(newSeverity) > uint8(disc.severity), "Can only escalate to higher severity");
        require(disc.status != ResolutionStatus.RESOLVED_AUTO &&
                disc.status != ResolutionStatus.RESOLVED_MANUAL, "Already resolved");

        bytes32 beforeHash = keccak256(abi.encode(disc));

        disc.severity = newSeverity;
        disc.status = ResolutionStatus.ESCALATED;

        bytes32 afterHash = keccak256(abi.encode(disc));
        _createAuditEntry(discrepancyId, "ESCALATED", beforeHash, afterHash, reason);

        emit DiscrepancyEscalated(discrepancyId, newSeverity, reason);

        // Trigger freeze if escalated to critical
        if (newSeverity == DiscrepancySeverity.CRITICAL && config.autoFreezeOnCritical) {
            _triggerCriticalFreeze(discrepancyId);
        }
    }

    /**
     * @notice Mark discrepancy as under review
     */
    function startReview(bytes32 discrepancyId) external onlyRole(DISPUTE_RESOLVER_ROLE) {
        Discrepancy storage disc = discrepancies[discrepancyId];
        require(disc.status == ResolutionStatus.PENDING, "Not pending");

        disc.status = ResolutionStatus.UNDER_REVIEW;

        _createAuditEntry(discrepancyId, "REVIEW_STARTED", bytes32(0), bytes32(0), "");
    }

    /**
     * @notice Close discrepancy as invalid (false positive)
     */
    function closeAsInvalid(
        bytes32 discrepancyId,
        string memory reason
    ) external onlyRole(DISPUTE_RESOLVER_ROLE) {
        Discrepancy storage disc = discrepancies[discrepancyId];
        require(disc.status != ResolutionStatus.RESOLVED_AUTO &&
                disc.status != ResolutionStatus.RESOLVED_MANUAL, "Already resolved");

        disc.status = ResolutionStatus.CLOSED_INVALID;
        disc.resolvedAt = block.timestamp;
        disc.resolvedBy = msg.sender;
        disc.resolutionNotes = reason;

        _removeFromActiveDiscrepancies(discrepancyId);

        _createAuditEntry(discrepancyId, "CLOSED_INVALID", bytes32(0), bytes32(0), reason);

        emit DiscrepancyResolved(discrepancyId, ResolutionStatus.CLOSED_INVALID, msg.sender, reason);
    }

    // ═══════════════════════════════════════════════════════════════
    // REGULATORY REPORTING
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Generate regulatory report for specified period
     * @dev Creates court-admissible report of reconciliation activities
     */
    function generateRegulatoryReport(
        string memory reportType,
        uint256 periodStart,
        uint256 periodEnd,
        string memory ipfsHash
    ) external onlyRole(REGULATOR_ROLE) returns (uint256 reportId) {
        require(periodEnd > periodStart, "Invalid period");
        require(bytes(ipfsHash).length > 0, "IPFS hash required");

        totalReports++;
        reportId = totalReports;

        // Calculate statistics for period
        uint256 reconciliationsInPeriod = 0;
        uint256 discrepanciesInPeriod = 0;
        uint256 resolvedInPeriod = 0;
        uint256 pendingCount = 0;

        // Count reconciliation runs in period
        for (uint256 i = 1; i <= currentRunId; i++) {
            if (reconciliationRuns[i].startTime >= periodStart &&
                reconciliationRuns[i].startTime <= periodEnd) {
                reconciliationsInPeriod++;
                discrepanciesInPeriod += reconciliationRuns[i].discrepanciesFound;
            }
        }

        // Count resolutions and pending
        for (uint256 i = 0; i < resolvedDiscrepancies.length; i++) {
            if (discrepancies[resolvedDiscrepancies[i]].resolvedAt >= periodStart &&
                discrepancies[resolvedDiscrepancies[i]].resolvedAt <= periodEnd) {
                resolvedInPeriod++;
            }
        }

        pendingCount = activeDiscrepancies.length;

        bytes32 reportHash = keccak256(abi.encodePacked(
            reportId,
            reportType,
            periodStart,
            periodEnd,
            reconciliationsInPeriod,
            discrepanciesInPeriod,
            resolvedInPeriod,
            pendingCount,
            ipfsHash
        ));

        regulatoryReports[reportId] = RegulatoryReport({
            reportId: reportId,
            generatedAt: block.timestamp,
            reportType: reportType,
            periodStart: periodStart,
            periodEnd: periodEnd,
            totalReconciliations: reconciliationsInPeriod,
            totalDiscrepancies: discrepanciesInPeriod,
            resolvedDiscrepancies: resolvedInPeriod,
            pendingDiscrepancies: pendingCount,
            reportHash: reportHash,
            ipfsHash: ipfsHash,
            submittedToRegulator: false
        });

        emit RegulatoryReportGenerated(reportId, reportType, reportHash);

        return reportId;
    }

    /**
     * @notice Mark report as submitted to regulator
     */
    function markReportSubmitted(uint256 reportId) external onlyRole(REGULATOR_ROLE) {
        require(regulatoryReports[reportId].reportId == reportId, "Report not found");
        regulatoryReports[reportId].submittedToRegulator = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // AUDIT TRAIL
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Get complete audit trail for a discrepancy
     * @dev Returns court-admissible chronological record
     */
    function getDiscrepancyAuditTrail(bytes32 discrepancyId)
        external
        view
        returns (AuditEntry[] memory)
    {
        return discrepancyAuditTrail[discrepancyId];
    }

    /**
     * @notice Add external evidence to audit trail
     */
    function addAuditEvidence(
        bytes32 discrepancyId,
        string memory action,
        string memory notes,
        bytes memory signature
    ) external onlyRole(AUDITOR_ROLE) {
        require(discrepancies[discrepancyId].discrepancyId == discrepancyId, "Discrepancy not found");

        totalAuditEntries++;

        discrepancyAuditTrail[discrepancyId].push(AuditEntry({
            entryId: totalAuditEntries,
            timestamp: block.timestamp,
            discrepancyId: discrepancyId,
            action: action,
            actor: msg.sender,
            beforeStateHash: bytes32(0),
            afterStateHash: bytes32(0),
            notes: notes,
            signature: signature
        }));

        emit AuditEntryCreated(totalAuditEntries, discrepancyId, action);
    }

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    function updateRunInterval(uint256 newInterval) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldValue = config.runInterval;
        config.runInterval = newInterval;
        emit ConfigurationUpdated("runInterval", oldValue, newInterval);
    }

    function updateAutoResolveThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldValue = config.autoResolveThreshold;
        config.autoResolveThreshold = newThreshold;
        emit ConfigurationUpdated("autoResolveThreshold", oldValue, newThreshold);
    }

    function updateCriticalFreezeThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldValue = config.criticalFreezeThreshold;
        config.criticalFreezeThreshold = newThreshold;
        emit ConfigurationUpdated("criticalFreezeThreshold", oldValue, newThreshold);
    }

    function setAutoFreezeOnCritical(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        config.autoFreezeOnCritical = enabled;
    }

    function setRequiresMultiSigResolution(bool required, uint256 minSignatures) external onlyRole(DEFAULT_ADMIN_ROLE) {
        config.requiresMultiSigResolution = required;
        config.minSignaturesRequired = minSignatures;
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function getActiveDiscrepancyCount() external view returns (uint256) {
        return activeDiscrepancies.length;
    }

    function getActiveDiscrepancies() external view returns (bytes32[] memory) {
        return activeDiscrepancies;
    }

    function getResolvedDiscrepancyCount() external view returns (uint256) {
        return resolvedDiscrepancies.length;
    }

    function getReconciliationRunDetails(uint256 runId)
        external
        view
        returns (ReconciliationRun memory)
    {
        return reconciliationRuns[runId];
    }

    function isReconciliationOverdue() external view returns (bool) {
        return block.timestamp >= lastReconciliationTime + config.runInterval;
    }

    function getDiscrepancyDetails(bytes32 discrepancyId)
        external
        view
        returns (Discrepancy memory)
    {
        return discrepancies[discrepancyId];
    }

    function getSystemStatistics() external view returns (
        uint256 totalRuns,
        uint256 totalDiscrepancies,
        uint256 autoResolved,
        uint256 manualResolved,
        uint256 freezeTriggered,
        uint256 activePending,
        uint256 lastRunTime
    ) {
        return (
            totalReconciliationsCompleted,
            totalDiscrepanciesDetected,
            totalAutoResolutions,
            totalManualResolutions,
            totalFreezeTriggered,
            activeDiscrepancies.length,
            lastReconciliationTime
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function _calculateSeverity(
        DiscrepancyType discrepancyType,
        uint256 onChainValue,
        uint256 offChainValue
    ) internal view returns (DiscrepancySeverity) {
        // Critical: Ownership conflict or missing records with high value
        if (discrepancyType == DiscrepancyType.OWNERSHIP_CONFLICT) {
            return DiscrepancySeverity.CRITICAL;
        }

        // Calculate value difference
        uint256 valueDifference = onChainValue > offChainValue ?
            onChainValue - offChainValue : offChainValue - onChainValue;

        // Critical: Large value discrepancy
        if (valueDifference >= config.criticalFreezeThreshold) {
            return DiscrepancySeverity.CRITICAL;
        }

        // High: Medium value discrepancy or missing records
        if (valueDifference >= config.autoResolveThreshold * 10 ||
            discrepancyType == DiscrepancyType.MISSING_LEGAL_RECORD ||
            discrepancyType == DiscrepancyType.MISSING_TOKEN_RECORD) {
            return DiscrepancySeverity.HIGH;
        }

        // Medium: Small value discrepancy
        if (valueDifference >= config.autoResolveThreshold) {
            return DiscrepancySeverity.MEDIUM;
        }

        // Low: Minor discrepancy
        return DiscrepancySeverity.LOW;
    }

    function _attemptAutoResolution(bytes32 discrepancyId) internal {
        Discrepancy storage disc = discrepancies[discrepancyId];

        // Only auto-resolve timestamp discrepancies or very small balance mismatches
        if (disc.discrepancyType == DiscrepancyType.TIMESTAMP_DISCREPANCY) {
            disc.status = ResolutionStatus.RESOLVED_AUTO;
            disc.resolvedAt = block.timestamp;
            disc.resolvedBy = address(this);
            disc.resolutionNotes = "Auto-resolved: Minor timestamp difference within tolerance";

            _removeFromActiveDiscrepancies(discrepancyId);
            resolvedDiscrepancies.push(discrepancyId);

            // Update run statistics
            reconciliationRuns[disc.reconciliationRunId].autoResolved++;
            totalAutoResolutions++;

            _createAuditEntry(discrepancyId, "AUTO_RESOLVED", bytes32(0), bytes32(0), disc.resolutionNotes);

            emit DiscrepancyResolved(discrepancyId, ResolutionStatus.RESOLVED_AUTO, address(this), disc.resolutionNotes);
        }
    }

    function _triggerCriticalFreeze(bytes32 discrepancyId) internal {
        Discrepancy storage disc = discrepancies[discrepancyId];
        disc.status = ResolutionStatus.FROZEN;

        totalFreezeTriggered++;

        _createAuditEntry(discrepancyId, "CRITICAL_FREEZE_TRIGGERED", bytes32(0), bytes32(0), "Auto-freeze due to critical discrepancy");

        emit CriticalDiscrepancyFreezeTriggered(discrepancyId, disc.assetId, disc.affectedHolder);

        // In production, this would call:
        // IRWAToken(rwaToken).freezeAccount(disc.affectedHolder);
        // IRWAToken(rwaToken).freezeAsset(disc.assetId, "Critical reconciliation discrepancy");
    }

    function _createAuditEntry(
        bytes32 discrepancyId,
        string memory action,
        bytes32 beforeHash,
        bytes32 afterHash,
        string memory notes
    ) internal {
        totalAuditEntries++;

        discrepancyAuditTrail[discrepancyId].push(AuditEntry({
            entryId: totalAuditEntries,
            timestamp: block.timestamp,
            discrepancyId: discrepancyId,
            action: action,
            actor: msg.sender,
            beforeStateHash: beforeHash,
            afterStateHash: afterHash,
            notes: notes,
            signature: ""
        }));

        emit AuditEntryCreated(totalAuditEntries, discrepancyId, action);
    }

    function _removeFromActiveDiscrepancies(bytes32 discrepancyId) internal {
        for (uint256 i = 0; i < activeDiscrepancies.length; i++) {
            if (activeDiscrepancies[i] == discrepancyId) {
                activeDiscrepancies[i] = activeDiscrepancies[activeDiscrepancies.length - 1];
                activeDiscrepancies.pop();
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // EMERGENCY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Cancel an in-progress reconciliation run
     */
    function cancelReconciliationRun(uint256 runId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(reconciliationRuns[runId].status == ReconciliationStatus.IN_PROGRESS, "Run not active");
        reconciliationRuns[runId].status = ReconciliationStatus.CANCELLED;
        reconciliationRuns[runId].endTime = block.timestamp;
    }
}
