// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title YieldDistributor
 * @author Reclaim RWA Bridge
 * @notice Automated yield distribution for RWA tokenization vaults
 * @dev Implements proportional yield distribution, reinvestment options, and tax reporting
 */
contract YieldDistributor is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Roles ============
    bytes32 public constant YIELD_MANAGER_ROLE = keccak256("YIELD_MANAGER_ROLE");
    bytes32 public constant DISTRIBUTION_ROLE = keccak256("DISTRIBUTION_ROLE");
    bytes32 public constant TAX_REPORTER_ROLE = keccak256("TAX_REPORTER_ROLE");

    // ============ Enums ============
    enum DistributionType {
        RENTAL_INCOME,
        CAPITAL_GAINS,
        DIVIDEND,
        INTEREST,
        RETURN_OF_CAPITAL,
        OTHER
    }

    enum ReinvestmentOption {
        NONE,
        FULL_REINVEST,
        PARTIAL_REINVEST,
        DRIP // Dividend Reinvestment Plan
    }

    enum TaxTreatment {
        ORDINARY_INCOME,
        QUALIFIED_DIVIDEND,
        LONG_TERM_CAPITAL_GAIN,
        SHORT_TERM_CAPITAL_GAIN,
        RETURN_OF_CAPITAL,
        TAX_EXEMPT
    }

    // ============ Structs ============
    struct YieldEvent {
        uint256 eventId;
        bytes32 assetId;
        DistributionType distributionType;
        uint256 totalAmount;
        uint256 timestamp;
        uint256 snapshotBlock;
        string description;
        TaxTreatment taxTreatment;
        bool isDistributed;
    }

    struct ShareholderClaim {
        address shareholder;
        uint256 shareBalance;
        uint256 claimableAmount;
        uint256 claimedAmount;
        uint256 reinvestedAmount;
        bool hasClaimed;
        uint256 claimTimestamp;
    }

    struct ReinvestmentConfig {
        ReinvestmentOption option;
        uint256 reinvestPercentage; // in basis points (10000 = 100%)
        address targetVault;
        bool isActive;
    }

    struct TaxReport {
        uint256 taxYear;
        address shareholder;
        uint256 totalOrdinaryIncome;
        uint256 totalQualifiedDividends;
        uint256 totalCapitalGains;
        uint256 totalReturnOfCapital;
        uint256 federalWithholding;
        uint256 stateWithholding;
        string[] k1Entries;
    }

    struct DistributionSchedule {
        uint256 nextDistributionTime;
        uint256 frequency; // in seconds (monthly, quarterly, etc.)
        bool isActive;
        uint256 minimumAccumulation;
    }

    struct YieldAccumulator {
        uint256 accumulatedYield;
        uint256 lastUpdateTime;
        uint256 averageAPY; // in basis points
        uint256 totalDistributed;
        uint256 distributionCount;
    }

    struct WithholdingConfig {
        uint256 federalRate; // basis points
        uint256 stateRate; // basis points
        bool automaticWithholding;
        string taxJurisdiction;
    }

    // ============ State Variables ============

    // Core token reference
    IERC20 public yieldToken;
    IERC20 public shareToken;

    // Yield events tracking
    uint256 public yieldEventCounter;
    mapping(uint256 => YieldEvent) public yieldEvents;
    mapping(uint256 => mapping(address => ShareholderClaim)) public shareholderClaims;

    // Reinvestment configurations
    mapping(address => ReinvestmentConfig) public reinvestmentConfigs;

    // Tax reporting
    mapping(uint256 => mapping(address => TaxReport)) public taxReports; // year => shareholder => report
    mapping(address => WithholdingConfig) public withholdingConfigs;

    // Distribution schedules per asset
    mapping(bytes32 => DistributionSchedule) public distributionSchedules;

    // Yield accumulators per asset
    mapping(bytes32 => YieldAccumulator) public yieldAccumulators;

    // Whitelist for distribution
    mapping(address => bool) public isWhitelisted;
    address[] public whitelistedAddresses;

    // Fee configuration
    uint256 public distributionFeeRate = 50; // 0.5% in basis points
    address public feeCollector;
    uint256 public totalFeesCollected;

    // Global tracking
    uint256 public totalYieldDistributed;
    uint256 public totalReinvested;
    uint256 public pendingDistributions;

    // Claim deadline configuration
    uint256 public claimDeadline = 365 days; // 1 year to claim

    // ============ Events ============

    event YieldEventCreated(
        uint256 indexed eventId,
        bytes32 indexed assetId,
        DistributionType distributionType,
        uint256 totalAmount
    );

    event YieldDistributed(
        uint256 indexed eventId,
        uint256 totalDistributed,
        uint256 shareholderCount
    );

    event YieldClaimed(
        address indexed shareholder,
        uint256 indexed eventId,
        uint256 amount
    );

    event YieldReinvested(
        address indexed shareholder,
        uint256 indexed eventId,
        uint256 amount,
        address targetVault
    );

    event ReinvestmentConfigured(
        address indexed shareholder,
        ReinvestmentOption option,
        uint256 percentage
    );

    event TaxReportGenerated(
        address indexed shareholder,
        uint256 indexed taxYear,
        uint256 totalIncome
    );

    event WithholdingApplied(
        address indexed shareholder,
        uint256 federalWithholding,
        uint256 stateWithholding
    );

    event DistributionScheduleUpdated(
        bytes32 indexed assetId,
        uint256 nextDistribution,
        uint256 frequency
    );

    event FeeCollected(
        uint256 indexed eventId,
        uint256 feeAmount
    );

    event ShareholderWhitelisted(
        address indexed shareholder,
        bool status
    );

    // ============ Constructor ============

    constructor(address _yieldToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(YIELD_MANAGER_ROLE, msg.sender);
        _grantRole(DISTRIBUTION_ROLE, msg.sender);
        _grantRole(TAX_REPORTER_ROLE, msg.sender);

        yieldToken = IERC20(_yieldToken);
        feeCollector = msg.sender;
    }

    // ============ Yield Distribution Functions ============

    /**
     * @notice Create a new yield distribution event
     * @param assetId Asset identifier
     * @param distributionType Type of distribution
     * @param totalAmount Total yield to distribute
     * @param description Distribution description
     * @param taxTreatment Tax treatment for this distribution
     * @return eventId Created event ID
     */
    function createYieldEvent(
        bytes32 assetId,
        DistributionType distributionType,
        uint256 totalAmount,
        string calldata description,
        TaxTreatment taxTreatment
    ) external onlyRole(YIELD_MANAGER_ROLE) nonReentrant whenNotPaused returns (uint256 eventId) {
        require(totalAmount > 0, "Amount must be positive");

        // Transfer yield tokens to this contract
        yieldToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        eventId = ++yieldEventCounter;

        yieldEvents[eventId] = YieldEvent({
            eventId: eventId,
            assetId: assetId,
            distributionType: distributionType,
            totalAmount: totalAmount,
            timestamp: block.timestamp,
            snapshotBlock: block.number,
            description: description,
            taxTreatment: taxTreatment,
            isDistributed: false
        });

        // Update accumulator
        YieldAccumulator storage accumulator = yieldAccumulators[assetId];
        accumulator.accumulatedYield += totalAmount;
        accumulator.lastUpdateTime = block.timestamp;

        pendingDistributions++;

        emit YieldEventCreated(eventId, assetId, distributionType, totalAmount);
    }

    /**
     * @notice Distribute yield to all shareholders proportionally
     * @param eventId Yield event ID
     * @param shareholders Array of shareholder addresses
     * @param shares Array of share balances at snapshot
     * @param totalShares Total shares at snapshot
     */
    function distributeYield(
        uint256 eventId,
        address[] calldata shareholders,
        uint256[] calldata shares,
        uint256 totalShares
    ) external onlyRole(DISTRIBUTION_ROLE) nonReentrant whenNotPaused {
        require(shareholders.length == shares.length, "Array length mismatch");
        require(totalShares > 0, "No shares");

        YieldEvent storage yieldEvent = yieldEvents[eventId];
        require(!yieldEvent.isDistributed, "Already distributed");
        require(yieldEvent.totalAmount > 0, "Invalid event");

        // Calculate and deduct distribution fee
        uint256 feeAmount = (yieldEvent.totalAmount * distributionFeeRate) / 10000;
        uint256 distributableAmount = yieldEvent.totalAmount - feeAmount;

        // Collect fee
        if (feeAmount > 0) {
            yieldToken.safeTransfer(feeCollector, feeAmount);
            totalFeesCollected += feeAmount;
            emit FeeCollected(eventId, feeAmount);
        }

        // Calculate proportional distribution
        uint256 actualDistributed = 0;

        for (uint256 i = 0; i < shareholders.length; i++) {
            address shareholder = shareholders[i];
            uint256 shareBalance = shares[i];

            require(isWhitelisted[shareholder], "Shareholder not whitelisted");

            // Calculate proportional claim
            uint256 claimAmount = (distributableAmount * shareBalance) / totalShares;

            if (claimAmount > 0) {
                shareholderClaims[eventId][shareholder] = ShareholderClaim({
                    shareholder: shareholder,
                    shareBalance: shareBalance,
                    claimableAmount: claimAmount,
                    claimedAmount: 0,
                    reinvestedAmount: 0,
                    hasClaimed: false,
                    claimTimestamp: 0
                });

                // Apply withholding if configured
                _applyWithholding(shareholder, claimAmount, yieldEvent.taxTreatment);

                actualDistributed += claimAmount;
            }
        }

        yieldEvent.isDistributed = true;

        // Update tracking
        YieldAccumulator storage accumulator = yieldAccumulators[yieldEvent.assetId];
        accumulator.totalDistributed += actualDistributed;
        accumulator.distributionCount++;
        accumulator.accumulatedYield -= actualDistributed;

        totalYieldDistributed += actualDistributed;
        pendingDistributions--;

        emit YieldDistributed(eventId, actualDistributed, shareholders.length);
    }

    /**
     * @notice Claim yield for a specific event
     * @param eventId Yield event ID
     */
    function claimYield(uint256 eventId) external nonReentrant whenNotPaused {
        ShareholderClaim storage claim = shareholderClaims[eventId][msg.sender];
        require(claim.claimableAmount > 0, "No claimable amount");
        require(!claim.hasClaimed, "Already claimed");

        // Check deadline
        YieldEvent storage yieldEvent = yieldEvents[eventId];
        require(
            block.timestamp <= yieldEvent.timestamp + claimDeadline,
            "Claim deadline passed"
        );

        uint256 claimAmount = claim.claimableAmount;
        uint256 reinvestAmount = 0;
        uint256 payoutAmount = claimAmount;

        // Handle reinvestment
        ReinvestmentConfig storage reinvestConfig = reinvestmentConfigs[msg.sender];
        if (reinvestConfig.isActive && reinvestConfig.option != ReinvestmentOption.NONE) {
            if (reinvestConfig.option == ReinvestmentOption.FULL_REINVEST) {
                reinvestAmount = claimAmount;
                payoutAmount = 0;
            } else if (reinvestConfig.option == ReinvestmentOption.PARTIAL_REINVEST) {
                reinvestAmount = (claimAmount * reinvestConfig.reinvestPercentage) / 10000;
                payoutAmount = claimAmount - reinvestAmount;
            } else if (reinvestConfig.option == ReinvestmentOption.DRIP) {
                // DRIP - convert to shares at current price
                reinvestAmount = claimAmount;
                payoutAmount = 0;
            }

            if (reinvestAmount > 0) {
                _processReinvestment(msg.sender, eventId, reinvestAmount, reinvestConfig.targetVault);
                claim.reinvestedAmount = reinvestAmount;
                totalReinvested += reinvestAmount;
            }
        }

        // Transfer payout
        if (payoutAmount > 0) {
            yieldToken.safeTransfer(msg.sender, payoutAmount);
        }

        // Update claim status
        claim.claimedAmount = claimAmount;
        claim.hasClaimed = true;
        claim.claimTimestamp = block.timestamp;

        // Update tax reporting
        _recordTaxableEvent(msg.sender, claimAmount, yieldEvent.taxTreatment);

        emit YieldClaimed(msg.sender, eventId, claimAmount);
    }

    /**
     * @notice Configure reinvestment preferences
     * @param option Reinvestment option
     * @param percentage Percentage to reinvest (for partial reinvestment)
     * @param targetVault Target vault address for reinvestment
     */
    function configureReinvestment(
        ReinvestmentOption option,
        uint256 percentage,
        address targetVault
    ) external {
        require(percentage <= 10000, "Invalid percentage");

        if (option == ReinvestmentOption.PARTIAL_REINVEST) {
            require(percentage > 0 && percentage < 10000, "Invalid partial percentage");
        }

        reinvestmentConfigs[msg.sender] = ReinvestmentConfig({
            option: option,
            reinvestPercentage: percentage,
            targetVault: targetVault,
            isActive: option != ReinvestmentOption.NONE
        });

        emit ReinvestmentConfigured(msg.sender, option, percentage);
    }

    // ============ Tax Reporting Functions ============

    /**
     * @notice Generate tax report for a shareholder
     * @param shareholder Shareholder address
     * @param taxYear Tax year
     * @return report Tax report
     */
    function generateTaxReport(
        address shareholder,
        uint256 taxYear
    ) external onlyRole(TAX_REPORTER_ROLE) returns (TaxReport memory report) {
        report = taxReports[taxYear][shareholder];
        report.taxYear = taxYear;
        report.shareholder = shareholder;

        // Calculate totals from all claimed yields in the tax year
        uint256 yearStart = _getYearStartTimestamp(taxYear);
        uint256 yearEnd = yearStart + 365 days;

        for (uint256 i = 1; i <= yieldEventCounter; i++) {
            YieldEvent storage yieldEvent = yieldEvents[i];
            ShareholderClaim storage claim = shareholderClaims[i][shareholder];

            if (
                claim.hasClaimed &&
                claim.claimTimestamp >= yearStart &&
                claim.claimTimestamp < yearEnd
            ) {
                uint256 amount = claim.claimedAmount;

                if (yieldEvent.taxTreatment == TaxTreatment.ORDINARY_INCOME) {
                    report.totalOrdinaryIncome += amount;
                } else if (yieldEvent.taxTreatment == TaxTreatment.QUALIFIED_DIVIDEND) {
                    report.totalQualifiedDividends += amount;
                } else if (
                    yieldEvent.taxTreatment == TaxTreatment.LONG_TERM_CAPITAL_GAIN ||
                    yieldEvent.taxTreatment == TaxTreatment.SHORT_TERM_CAPITAL_GAIN
                ) {
                    report.totalCapitalGains += amount;
                } else if (yieldEvent.taxTreatment == TaxTreatment.RETURN_OF_CAPITAL) {
                    report.totalReturnOfCapital += amount;
                }
            }
        }

        // Store updated report
        taxReports[taxYear][shareholder] = report;

        uint256 totalIncome = report.totalOrdinaryIncome +
            report.totalQualifiedDividends +
            report.totalCapitalGains;

        emit TaxReportGenerated(shareholder, taxYear, totalIncome);
    }

    /**
     * @notice Configure withholding for a shareholder
     * @param shareholder Shareholder address
     * @param federalRate Federal withholding rate in basis points
     * @param stateRate State withholding rate in basis points
     * @param jurisdiction Tax jurisdiction code
     */
    function configureWithholding(
        address shareholder,
        uint256 federalRate,
        uint256 stateRate,
        string calldata jurisdiction
    ) external onlyRole(TAX_REPORTER_ROLE) {
        require(federalRate <= 5000, "Federal rate too high"); // Max 50%
        require(stateRate <= 2000, "State rate too high"); // Max 20%

        withholdingConfigs[shareholder] = WithholdingConfig({
            federalRate: federalRate,
            stateRate: stateRate,
            automaticWithholding: true,
            taxJurisdiction: jurisdiction
        });
    }

    // ============ Distribution Schedule Functions ============

    /**
     * @notice Set distribution schedule for an asset
     * @param assetId Asset identifier
     * @param firstDistributionTime First distribution timestamp
     * @param frequency Distribution frequency in seconds
     * @param minimumAccumulation Minimum yield before distribution
     */
    function setDistributionSchedule(
        bytes32 assetId,
        uint256 firstDistributionTime,
        uint256 frequency,
        uint256 minimumAccumulation
    ) external onlyRole(YIELD_MANAGER_ROLE) {
        require(firstDistributionTime > block.timestamp, "Must be future time");
        require(frequency >= 1 days, "Frequency too short");

        distributionSchedules[assetId] = DistributionSchedule({
            nextDistributionTime: firstDistributionTime,
            frequency: frequency,
            isActive: true,
            minimumAccumulation: minimumAccumulation
        });

        emit DistributionScheduleUpdated(assetId, firstDistributionTime, frequency);
    }

    /**
     * @notice Check if distribution is due for an asset
     * @param assetId Asset identifier
     * @return isDue Whether distribution is due
     * @return accumulatedAmount Amount accumulated
     */
    function checkDistributionDue(
        bytes32 assetId
    ) external view returns (bool isDue, uint256 accumulatedAmount) {
        DistributionSchedule storage schedule = distributionSchedules[assetId];
        YieldAccumulator storage accumulator = yieldAccumulators[assetId];

        accumulatedAmount = accumulator.accumulatedYield;

        isDue = (
            schedule.isActive &&
            block.timestamp >= schedule.nextDistributionTime &&
            accumulatedAmount >= schedule.minimumAccumulation
        );
    }

    /**
     * @notice Trigger scheduled distribution
     * @param assetId Asset identifier
     */
    function triggerScheduledDistribution(
        bytes32 assetId
    ) external onlyRole(DISTRIBUTION_ROLE) {
        DistributionSchedule storage schedule = distributionSchedules[assetId];
        YieldAccumulator storage accumulator = yieldAccumulators[assetId];

        require(schedule.isActive, "Schedule not active");
        require(
            block.timestamp >= schedule.nextDistributionTime,
            "Not yet time for distribution"
        );
        require(
            accumulator.accumulatedYield >= schedule.minimumAccumulation,
            "Insufficient accumulated yield"
        );

        // Update next distribution time
        schedule.nextDistributionTime = block.timestamp + schedule.frequency;

        emit DistributionScheduleUpdated(assetId, schedule.nextDistributionTime, schedule.frequency);
    }

    // ============ View Functions ============

    /**
     * @notice Get yield event details
     * @param eventId Event ID
     * @return yieldEvent Yield event data
     */
    function getYieldEvent(
        uint256 eventId
    ) external view returns (YieldEvent memory yieldEvent) {
        return yieldEvents[eventId];
    }

    /**
     * @notice Get shareholder claim for an event
     * @param eventId Event ID
     * @param shareholder Shareholder address
     * @return claim Claim data
     */
    function getShareholderClaim(
        uint256 eventId,
        address shareholder
    ) external view returns (ShareholderClaim memory claim) {
        return shareholderClaims[eventId][shareholder];
    }

    /**
     * @notice Get all pending claims for a shareholder
     * @param shareholder Shareholder address
     * @return eventIds Array of event IDs with pending claims
     * @return amounts Array of claimable amounts
     */
    function getPendingClaims(
        address shareholder
    ) external view returns (uint256[] memory eventIds, uint256[] memory amounts) {
        // Count pending claims
        uint256 count = 0;
        for (uint256 i = 1; i <= yieldEventCounter; i++) {
            ShareholderClaim storage claim = shareholderClaims[i][shareholder];
            if (claim.claimableAmount > 0 && !claim.hasClaimed) {
                count++;
            }
        }

        // Build arrays
        eventIds = new uint256[](count);
        amounts = new uint256[](count);
        uint256 index = 0;

        for (uint256 i = 1; i <= yieldEventCounter; i++) {
            ShareholderClaim storage claim = shareholderClaims[i][shareholder];
            if (claim.claimableAmount > 0 && !claim.hasClaimed) {
                eventIds[index] = i;
                amounts[index] = claim.claimableAmount;
                index++;
            }
        }
    }

    /**
     * @notice Get total claimable amount for shareholder
     * @param shareholder Shareholder address
     * @return total Total claimable amount
     */
    function getTotalClaimable(
        address shareholder
    ) external view returns (uint256 total) {
        for (uint256 i = 1; i <= yieldEventCounter; i++) {
            ShareholderClaim storage claim = shareholderClaims[i][shareholder];
            if (claim.claimableAmount > 0 && !claim.hasClaimed) {
                total += claim.claimableAmount;
            }
        }
    }

    /**
     * @notice Get yield accumulator statistics
     * @param assetId Asset identifier
     * @return accumulator Yield accumulator data
     */
    function getYieldAccumulator(
        bytes32 assetId
    ) external view returns (YieldAccumulator memory accumulator) {
        return yieldAccumulators[assetId];
    }

    /**
     * @notice Get reinvestment configuration
     * @param shareholder Shareholder address
     * @return config Reinvestment configuration
     */
    function getReinvestmentConfig(
        address shareholder
    ) external view returns (ReinvestmentConfig memory config) {
        return reinvestmentConfigs[shareholder];
    }

    /**
     * @notice Get withholding configuration
     * @param shareholder Shareholder address
     * @return config Withholding configuration
     */
    function getWithholdingConfig(
        address shareholder
    ) external view returns (WithholdingConfig memory config) {
        return withholdingConfigs[shareholder];
    }

    /**
     * @notice Get tax report for shareholder and year
     * @param shareholder Shareholder address
     * @param taxYear Tax year
     * @return report Tax report
     */
    function getTaxReport(
        address shareholder,
        uint256 taxYear
    ) external view returns (TaxReport memory report) {
        return taxReports[taxYear][shareholder];
    }

    /**
     * @notice Get distribution schedule
     * @param assetId Asset identifier
     * @return schedule Distribution schedule
     */
    function getDistributionSchedule(
        bytes32 assetId
    ) external view returns (DistributionSchedule memory schedule) {
        return distributionSchedules[assetId];
    }

    /**
     * @notice Get all whitelisted addresses
     * @return addresses Array of whitelisted addresses
     */
    function getWhitelistedAddresses() external view returns (address[] memory) {
        return whitelistedAddresses;
    }

    /**
     * @notice Calculate APY for an asset
     * @param assetId Asset identifier
     * @param totalAssetValue Total value of asset
     * @return apy Annual percentage yield in basis points
     */
    function calculateAPY(
        bytes32 assetId,
        uint256 totalAssetValue
    ) external view returns (uint256 apy) {
        YieldAccumulator storage accumulator = yieldAccumulators[assetId];

        if (totalAssetValue == 0 || accumulator.totalDistributed == 0) {
            return 0;
        }

        // Simplified APY calculation
        uint256 timePeriod = block.timestamp - accumulator.lastUpdateTime;
        if (timePeriod == 0) {
            return accumulator.averageAPY;
        }

        // Annual yield rate
        uint256 annualizedYield = (accumulator.totalDistributed * 365 days * 10000) /
            (totalAssetValue * timePeriod);

        return annualizedYield;
    }

    // ============ Admin Functions ============

    /**
     * @notice Add shareholder to whitelist
     * @param shareholder Shareholder address
     */
    function addToWhitelist(
        address shareholder
    ) external onlyRole(YIELD_MANAGER_ROLE) {
        require(!isWhitelisted[shareholder], "Already whitelisted");

        isWhitelisted[shareholder] = true;
        whitelistedAddresses.push(shareholder);

        emit ShareholderWhitelisted(shareholder, true);
    }

    /**
     * @notice Remove shareholder from whitelist
     * @param shareholder Shareholder address
     */
    function removeFromWhitelist(
        address shareholder
    ) external onlyRole(YIELD_MANAGER_ROLE) {
        require(isWhitelisted[shareholder], "Not whitelisted");

        isWhitelisted[shareholder] = false;

        // Remove from array
        for (uint256 i = 0; i < whitelistedAddresses.length; i++) {
            if (whitelistedAddresses[i] == shareholder) {
                whitelistedAddresses[i] = whitelistedAddresses[whitelistedAddresses.length - 1];
                whitelistedAddresses.pop();
                break;
            }
        }

        emit ShareholderWhitelisted(shareholder, false);
    }

    /**
     * @notice Set share token address
     * @param _shareToken Share token address
     */
    function setShareToken(address _shareToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_shareToken != address(0), "Invalid address");
        shareToken = IERC20(_shareToken);
    }

    /**
     * @notice Set distribution fee rate
     * @param newFeeRate New fee rate in basis points
     */
    function setDistributionFeeRate(
        uint256 newFeeRate
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeRate <= 500, "Fee rate too high"); // Max 5%
        distributionFeeRate = newFeeRate;
    }

    /**
     * @notice Set fee collector address
     * @param newCollector New fee collector address
     */
    function setFeeCollector(
        address newCollector
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCollector != address(0), "Invalid address");
        feeCollector = newCollector;
    }

    /**
     * @notice Set claim deadline
     * @param newDeadline New deadline in seconds
     */
    function setClaimDeadline(
        uint256 newDeadline
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDeadline >= 30 days, "Deadline too short");
        claimDeadline = newDeadline;
    }

    /**
     * @notice Recover unclaimed yield after deadline
     * @param eventId Event ID
     */
    function recoverUnclaimedYield(
        uint256 eventId
    ) external onlyRole(YIELD_MANAGER_ROLE) nonReentrant {
        YieldEvent storage yieldEvent = yieldEvents[eventId];
        require(
            block.timestamp > yieldEvent.timestamp + claimDeadline,
            "Deadline not passed"
        );

        // Calculate unclaimed amount
        uint256 unclaimedAmount = 0;
        for (uint256 i = 0; i < whitelistedAddresses.length; i++) {
            address shareholder = whitelistedAddresses[i];
            ShareholderClaim storage claim = shareholderClaims[eventId][shareholder];

            if (claim.claimableAmount > 0 && !claim.hasClaimed) {
                unclaimedAmount += claim.claimableAmount;
                // Mark as claimed to prevent double recovery
                claim.hasClaimed = true;
                claim.claimTimestamp = block.timestamp;
            }
        }

        if (unclaimedAmount > 0) {
            yieldToken.safeTransfer(feeCollector, unclaimedAmount);
        }
    }

    /**
     * @notice Pause yield distribution
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause yield distribution
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Emergency withdraw tokens
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // ============ Internal Functions ============

    /**
     * @dev Apply tax withholding to a claim
     */
    function _applyWithholding(
        address shareholder,
        uint256 amount,
        TaxTreatment taxTreatment
    ) internal {
        WithholdingConfig storage config = withholdingConfigs[shareholder];

        if (!config.automaticWithholding || taxTreatment == TaxTreatment.TAX_EXEMPT) {
            return;
        }

        uint256 federalWithholding = (amount * config.federalRate) / 10000;
        uint256 stateWithholding = (amount * config.stateRate) / 10000;

        // Update tax report with withholdings
        uint256 currentYear = _getCurrentTaxYear();
        TaxReport storage report = taxReports[currentYear][shareholder];
        report.federalWithholding += federalWithholding;
        report.stateWithholding += stateWithholding;

        emit WithholdingApplied(shareholder, federalWithholding, stateWithholding);
    }

    /**
     * @dev Process reinvestment of yield
     */
    function _processReinvestment(
        address shareholder,
        uint256 eventId,
        uint256 amount,
        address targetVault
    ) internal {
        // In production, this would interact with the vault contract
        // to purchase additional shares
        yieldToken.safeTransfer(targetVault, amount);

        emit YieldReinvested(shareholder, eventId, amount, targetVault);
    }

    /**
     * @dev Record taxable event for reporting
     */
    function _recordTaxableEvent(
        address shareholder,
        uint256 amount,
        TaxTreatment taxTreatment
    ) internal {
        uint256 currentYear = _getCurrentTaxYear();
        TaxReport storage report = taxReports[currentYear][shareholder];

        if (taxTreatment == TaxTreatment.ORDINARY_INCOME) {
            report.totalOrdinaryIncome += amount;
        } else if (taxTreatment == TaxTreatment.QUALIFIED_DIVIDEND) {
            report.totalQualifiedDividends += amount;
        } else if (
            taxTreatment == TaxTreatment.LONG_TERM_CAPITAL_GAIN ||
            taxTreatment == TaxTreatment.SHORT_TERM_CAPITAL_GAIN
        ) {
            report.totalCapitalGains += amount;
        } else if (taxTreatment == TaxTreatment.RETURN_OF_CAPITAL) {
            report.totalReturnOfCapital += amount;
        }
    }

    /**
     * @dev Get current tax year
     */
    function _getCurrentTaxYear() internal view returns (uint256) {
        // Simplified: use current year based on timestamp
        return (block.timestamp / 365 days) + 1970;
    }

    /**
     * @dev Get start timestamp of a tax year
     */
    function _getYearStartTimestamp(uint256 year) internal pure returns (uint256) {
        return (year - 1970) * 365 days;
    }
}
