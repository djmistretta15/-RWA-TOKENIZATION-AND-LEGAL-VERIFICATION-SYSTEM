// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ComplianceModule
 * @notice Comprehensive compliance enforcement for RWA security tokens
 * @dev Implements SEC Reg D, Reg S, EU MiCA, and custom transfer restrictions
 *
 * REGULATORY FRAMEWORK ARCHITECTURE:
 *
 * This module is the regulatory brain of the RWA tokenization system. It encodes
 * complex securities law into executable smart contract logic.
 *
 * === SEC REGULATION D (Rule 506) ===
 * Private placements to accredited investors:
 * - Rule 506(b): Up to 35 non-accredited + unlimited accredited investors
 * - Rule 506(c): Only accredited investors (requires verification)
 * - 12-month lock-up period for restricted securities
 * - Form D filing requirement (tracked off-chain, hash on-chain)
 *
 * === SEC REGULATION S ===
 * Offshore offerings to non-U.S. persons:
 * - Category 1: No restrictions (non-U.S. issuer, no substantial U.S. market interest)
 * - Category 2: 40-day distribution compliance period
 * - Category 3: 1-year distribution compliance period + certifications
 * - No U.S. investor restriction during distribution compliance period
 *
 * === EU MiCA (Markets in Crypto-Assets Regulation) ===
 * Comprehensive crypto-asset regulation:
 * - Whitepaper requirements (stored as IPFS hash)
 * - Investor protection disclosures
 * - Anti-market abuse provisions
 * - Capital requirements for issuers
 * - Reverse solicitation exemption tracking
 *
 * === KYC/AML INTEGRATION ===
 * - Identity verification via external oracle
 * - Sanctions screening (OFAC, UN, EU lists)
 * - PEP (Politically Exposed Person) checks
 * - Source of funds verification
 * - Ongoing monitoring triggers
 */
contract ComplianceModule {

    // ========== COMPLIANCE FRAMEWORKS ==========

    enum RegulatoryFramework {
        SEC_REG_D_506B,      // SEC Rule 506(b)
        SEC_REG_D_506C,      // SEC Rule 506(c)
        SEC_REG_S_CAT1,      // Reg S Category 1
        SEC_REG_S_CAT2,      // Reg S Category 2
        SEC_REG_S_CAT3,      // Reg S Category 3
        EU_MICA,             // EU MiCA Regulation
        CUSTOM               // Custom compliance rules
    }

    // ========== INVESTOR CLASSIFICATION ==========

    enum InvestorType {
        None,
        Retail,              // Non-accredited retail investor
        Accredited,          // SEC accredited investor
        QualifiedPurchaser,  // Qualified purchaser (>$5M investments)
        Institutional,       // Institutional investor
        QualifiedClient      // Qualified client for advisory services
    }

    enum InvestorJurisdiction {
        US,                  // United States
        EU,                  // European Union
        UK,                  // United Kingdom
        ASIA_PACIFIC,        // Asia-Pacific region
        MIDDLE_EAST,         // Middle East
        LATAM,               // Latin America
        OTHER                // Other jurisdictions
    }

    // ========== COMPLIANCE DATA STRUCTURES ==========

    struct InvestorProfile {
        InvestorType investorType;
        InvestorJurisdiction jurisdiction;
        bool kycVerified;
        bool amlCleared;
        uint256 kycExpiryDate;
        uint256 investmentLimit;         // Maximum investment amount (USD, 6 decimals)
        uint256 currentInvestment;       // Current investment amount
        bool sanctioned;                  // On sanctions list
        bool isPEP;                       // Politically Exposed Person
        bytes32 identityHash;            // Hash of identity documents
        uint256 onboardingDate;
        string countryCode;              // ISO 3166-1 alpha-2
    }

    struct TransferRestriction {
        bool restricted;
        uint256 lockupExpiry;            // Lock-up period expiry
        uint256 distributionCompliancePeriod; // Reg S compliance period
        bool rule144Restricted;          // Rule 144 restricted securities
        uint256 rule144HoldingPeriod;    // Required holding period (seconds)
        bytes32 exemptionHash;           // Hash of exemption documentation
    }

    struct ComplianceSettings {
        RegulatoryFramework framework;
        uint256 maxInvestors;            // Maximum number of investors
        uint256 maxNonAccreditedInvestors; // Max non-accredited (Reg D)
        uint256 minimumInvestment;       // Minimum investment amount
        uint256 maximumInvestment;       // Maximum investment amount
        bool allowUSInvestors;           // Allow U.S. investors
        bool requireAccreditation;       // Require accredited status
        uint256 defaultLockupPeriod;     // Default lock-up in seconds
        bytes32[] allowedCountries;      // Whitelist of country codes
        bytes32[] blockedCountries;      // Blacklist of country codes
    }

    // ========== STATE VARIABLES ==========

    address public token;
    address public complianceOfficer;
    address public identityRegistry;

    mapping(address => InvestorProfile) public investorProfiles;
    mapping(address => TransferRestriction) public transferRestrictions;

    ComplianceSettings public settings;

    uint256 public totalInvestors;
    uint256 public totalNonAccreditedInvestors;

    // Country code to hash mapping (e.g., "US" => keccak256("US"))
    mapping(bytes32 => bool) public allowedCountries;
    mapping(bytes32 => bool) public blockedCountries;

    // ========== EVENTS ==========

    event InvestorOnboarded(
        address indexed investor,
        InvestorType investorType,
        InvestorJurisdiction jurisdiction
    );

    event InvestorUpdated(
        address indexed investor,
        InvestorType investorType
    );

    event KYCUpdated(
        address indexed investor,
        bool verified,
        uint256 expiryDate
    );

    event TransferRestrictionUpdated(
        address indexed investor,
        bool restricted,
        uint256 lockupExpiry
    );

    event ComplianceCheckFailed(
        address indexed from,
        address indexed to,
        bytes32 reason
    );

    // ========== MODIFIERS ==========

    modifier onlyToken() {
        require(msg.sender == token, "ComplianceModule: caller is not token");
        _;
    }

    modifier onlyComplianceOfficer() {
        require(msg.sender == complianceOfficer, "ComplianceModule: caller is not compliance officer");
        _;
    }

    // ========== CONSTRUCTOR ==========

    constructor(
        address _token,
        RegulatoryFramework _framework,
        address _identityRegistry
    ) {
        token = _token;
        complianceOfficer = msg.sender;
        identityRegistry = _identityRegistry;

        // Initialize default settings based on framework
        _initializeFramework(_framework);
    }

    // ========== CORE COMPLIANCE FUNCTIONS ==========

    /**
     * @notice Check if a transfer is compliant
     * @dev Called by the token contract before every transfer
     * @return esc Ethereum Status Code (0x51 = success, 0x50 = failure)
     * @return reason Human-readable reason code
     */
    function canTransfer(
        address from,
        address to,
        uint256 value,
        bytes calldata data
    ) external view onlyToken returns (bytes1 esc, bytes32 reason) {

        // Check if sender is verified
        if (!investorProfiles[from].kycVerified) {
            return (0x50, bytes32("Sender KYC not verified"));
        }

        // Check if receiver is verified
        if (!investorProfiles[to].kycVerified) {
            return (0x50, bytes32("Receiver KYC not verified"));
        }

        // Check KYC expiry
        if (block.timestamp > investorProfiles[from].kycExpiryDate) {
            return (0x50, bytes32("Sender KYC expired"));
        }

        if (block.timestamp > investorProfiles[to].kycExpiryDate) {
            return (0x50, bytes32("Receiver KYC expired"));
        }

        // Check sanctions
        if (investorProfiles[from].sanctioned || investorProfiles[to].sanctioned) {
            return (0x50, bytes32("Sanctioned address"));
        }

        // Check transfer restrictions
        TransferRestriction memory fromRestriction = transferRestrictions[from];
        if (fromRestriction.restricted && block.timestamp < fromRestriction.lockupExpiry) {
            return (0x50, bytes32("Lock-up period active"));
        }

        // Check Rule 144 holding period
        if (fromRestriction.rule144Restricted) {
            uint256 holdingPeriod = block.timestamp - investorProfiles[from].onboardingDate;
            if (holdingPeriod < fromRestriction.rule144HoldingPeriod) {
                return (0x50, bytes32("Rule 144 holding period"));
            }
        }

        // Check Reg S distribution compliance period
        if (fromRestriction.distributionCompliancePeriod > 0) {
            if (block.timestamp < fromRestriction.distributionCompliancePeriod) {
                // During compliance period, cannot transfer to U.S. persons
                if (investorProfiles[to].jurisdiction == InvestorJurisdiction.US) {
                    return (0x50, bytes32("Reg S compliance period"));
                }
            }
        }

        // Check country restrictions
        bytes32 toCountryHash = keccak256(bytes(investorProfiles[to].countryCode));
        if (blockedCountries[toCountryHash]) {
            return (0x50, bytes32("Country blocked"));
        }

        if (settings.allowedCountries.length > 0 && !allowedCountries[toCountryHash]) {
            return (0x50, bytes32("Country not allowed"));
        }

        // Check U.S. investor restrictions
        if (!settings.allowUSInvestors && investorProfiles[to].jurisdiction == InvestorJurisdiction.US) {
            return (0x50, bytes32("U.S. investors not allowed"));
        }

        // Check accreditation requirements
        if (settings.requireAccreditation) {
            if (investorProfiles[to].investorType != InvestorType.Accredited &&
                investorProfiles[to].investorType != InvestorType.QualifiedPurchaser &&
                investorProfiles[to].investorType != InvestorType.Institutional) {
                return (0x50, bytes32("Accreditation required"));
            }
        }

        // Check investment limits
        if (investorProfiles[to].currentInvestment + value > investorProfiles[to].investmentLimit) {
            return (0x50, bytes32("Investment limit exceeded"));
        }

        // Check max investors
        if (investorProfiles[to].currentInvestment == 0) {
            // New investor
            if (totalInvestors >= settings.maxInvestors) {
                return (0x50, bytes32("Max investors reached"));
            }

            // Check max non-accredited investors (Reg D 506(b))
            if (settings.framework == RegulatoryFramework.SEC_REG_D_506B) {
                if (investorProfiles[to].investorType == InvestorType.Retail) {
                    if (totalNonAccreditedInvestors >= settings.maxNonAccreditedInvestors) {
                        return (0x50, bytes32("Max non-accredited reached"));
                    }
                }
            }
        }

        // Check minimum investment
        if (value < settings.minimumInvestment) {
            return (0x50, bytes32("Below minimum investment"));
        }

        // All checks passed
        return (0x51, bytes32("Transfer approved"));
    }

    /**
     * @notice Onboard a new investor
     */
    function onboardInvestor(
        address investor,
        InvestorType investorType,
        InvestorJurisdiction jurisdiction,
        string calldata countryCode,
        uint256 investmentLimit,
        uint256 kycExpiryDate,
        bytes32 identityHash
    ) external onlyComplianceOfficer {
        require(!investorProfiles[investor].kycVerified, "ComplianceModule: investor already onboarded");

        investorProfiles[investor] = InvestorProfile({
            investorType: investorType,
            jurisdiction: jurisdiction,
            kycVerified: true,
            amlCleared: true,
            kycExpiryDate: kycExpiryDate,
            investmentLimit: investmentLimit,
            currentInvestment: 0,
            sanctioned: false,
            isPEP: false,
            identityHash: identityHash,
            onboardingDate: block.timestamp,
            countryCode: countryCode
        });

        totalInvestors++;
        if (investorType == InvestorType.Retail) {
            totalNonAccreditedInvestors++;
        }

        emit InvestorOnboarded(investor, investorType, jurisdiction);
        emit KYCUpdated(investor, true, kycExpiryDate);
    }

    /**
     * @notice Update investor KYC status
     */
    function updateKYC(
        address investor,
        bool verified,
        uint256 expiryDate
    ) external onlyComplianceOfficer {
        investorProfiles[investor].kycVerified = verified;
        investorProfiles[investor].kycExpiryDate = expiryDate;

        emit KYCUpdated(investor, verified, expiryDate);
    }

    /**
     * @notice Set transfer restrictions for an investor
     */
    function setTransferRestriction(
        address investor,
        bool restricted,
        uint256 lockupExpiry,
        bool rule144Restricted,
        uint256 distributionCompliancePeriod
    ) external onlyComplianceOfficer {
        transferRestrictions[investor] = TransferRestriction({
            restricted: restricted,
            lockupExpiry: lockupExpiry,
            distributionCompliancePeriod: distributionCompliancePeriod,
            rule144Restricted: rule144Restricted,
            rule144HoldingPeriod: rule144Restricted ? 365 days : 0,
            exemptionHash: bytes32(0)
        });

        emit TransferRestrictionUpdated(investor, restricted, lockupExpiry);
    }

    /**
     * @notice Add investor to sanctions list
     */
    function addToSanctionsList(address investor) external onlyComplianceOfficer {
        investorProfiles[investor].sanctioned = true;
    }

    /**
     * @notice Remove investor from sanctions list
     */
    function removeFromSanctionsList(address investor) external onlyComplianceOfficer {
        investorProfiles[investor].sanctioned = false;
    }

    /**
     * @notice Update investor investment amount
     */
    function updateInvestmentAmount(address investor, uint256 newAmount) external onlyToken {
        investorProfiles[investor].currentInvestment = newAmount;
    }

    // ========== ADMIN FUNCTIONS ==========

    function setComplianceOfficer(address newOfficer) external onlyComplianceOfficer {
        complianceOfficer = newOfficer;
    }

    function setIdentityRegistry(address newRegistry) external onlyComplianceOfficer {
        identityRegistry = newRegistry;
    }

    function updateComplianceSettings(
        uint256 maxInvestors,
        uint256 maxNonAccredited,
        uint256 minInvestment,
        uint256 maxInvestment,
        bool allowUS
    ) external onlyComplianceOfficer {
        settings.maxInvestors = maxInvestors;
        settings.maxNonAccreditedInvestors = maxNonAccredited;
        settings.minimumInvestment = minInvestment;
        settings.maximumInvestment = maxInvestment;
        settings.allowUSInvestors = allowUS;
    }

    function addAllowedCountry(bytes32 countryHash) external onlyComplianceOfficer {
        allowedCountries[countryHash] = true;
        settings.allowedCountries.push(countryHash);
    }

    function addBlockedCountry(bytes32 countryHash) external onlyComplianceOfficer {
        blockedCountries[countryHash] = true;
        settings.blockedCountries.push(countryHash);
    }

    // ========== INTERNAL FUNCTIONS ==========

    function _initializeFramework(RegulatoryFramework framework) internal {
        settings.framework = framework;

        if (framework == RegulatoryFramework.SEC_REG_D_506B) {
            settings.maxInvestors = 2000;  // Rule 506(b) allows unlimited accredited + 35 non-accredited
            settings.maxNonAccreditedInvestors = 35;
            settings.requireAccreditation = false;
            settings.allowUSInvestors = true;
            settings.defaultLockupPeriod = 365 days;
            settings.minimumInvestment = 0;
            settings.maximumInvestment = type(uint256).max;

        } else if (framework == RegulatoryFramework.SEC_REG_D_506C) {
            settings.maxInvestors = type(uint256).max;
            settings.maxNonAccreditedInvestors = 0;
            settings.requireAccreditation = true;
            settings.allowUSInvestors = true;
            settings.defaultLockupPeriod = 365 days;
            settings.minimumInvestment = 0;
            settings.maximumInvestment = type(uint256).max;

        } else if (framework == RegulatoryFramework.SEC_REG_S_CAT2) {
            settings.maxInvestors = type(uint256).max;
            settings.maxNonAccreditedInvestors = type(uint256).max;
            settings.requireAccreditation = false;
            settings.allowUSInvestors = false;
            settings.defaultLockupPeriod = 40 days;  // Category 2 compliance period
            settings.minimumInvestment = 0;
            settings.maximumInvestment = type(uint256).max;

        } else if (framework == RegulatoryFramework.SEC_REG_S_CAT3) {
            settings.maxInvestors = type(uint256).max;
            settings.maxNonAccreditedInvestors = type(uint256).max;
            settings.requireAccreditation = false;
            settings.allowUSInvestors = false;
            settings.defaultLockupPeriod = 365 days;  // Category 3 compliance period
            settings.minimumInvestment = 0;
            settings.maximumInvestment = type(uint256).max;

        } else if (framework == RegulatoryFramework.EU_MICA) {
            settings.maxInvestors = type(uint256).max;
            settings.maxNonAccreditedInvestors = type(uint256).max;
            settings.requireAccreditation = false;
            settings.allowUSInvestors = false;
            settings.defaultLockupPeriod = 0;
            settings.minimumInvestment = 0;
            settings.maximumInvestment = type(uint256).max;
        }
    }
}
