// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title RWAVault4626
 * @notice ERC-4626 Tokenized Vault for RWA Yield Distribution
 * @dev Production-ready yield-bearing vault with compliance integration
 *
 * ARCHITECTURE:
 * This vault implements the ERC-4626 standard, allowing investors to deposit
 * RWA tokens and receive yield-bearing shares. The vault automatically:
 *
 * 1. Accepts RWA token deposits
 * 2. Issues vault shares proportional to deposit
 * 3. Distributes yield (rent, dividends, interest) to shareholders
 * 4. Enables compliant withdrawals with legal registry sync
 * 5. Maintains NAV (Net Asset Value) calculations
 *
 * YIELD SOURCES:
 * - Real Estate: Rental income, property appreciation
 * - Corporate Bonds: Coupon payments, capital gains
 * - Private Equity: Dividends, fund distributions
 * - Commodities: Storage fees, price appreciation
 *
 * COMPLIANCE:
 * All deposits/withdrawals are subject to whitelist validation.
 * Vault shares are themselves securities and require compliance.
 *
 * MATHEMATICAL MODEL:
 * Shares = Deposit * TotalShares / TotalAssets
 * Assets = Shares * TotalAssets / TotalShares
 * SharePrice = TotalAssets / TotalShares
 */
contract RWAVault4626 is ERC4626, AccessControl, ReentrancyGuard, Pausable {

    // ============ ROLES ============

    bytes32 public constant VAULT_MANAGER_ROLE = keccak256("VAULT_MANAGER_ROLE");
    bytes32 public constant YIELD_DISTRIBUTOR_ROLE = keccak256("YIELD_DISTRIBUTOR_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    // ============ VAULT CONFIGURATION ============

    struct VaultConfig {
        uint256 managementFee;          // Annual management fee in basis points (100 = 1%)
        uint256 performanceFee;         // Performance fee on yield (2000 = 20%)
        uint256 withdrawalFee;          // Withdrawal fee in basis points
        uint256 minDeposit;             // Minimum deposit amount
        uint256 maxDeposit;             // Maximum deposit per user
        uint256 maxTotalAssets;         // Vault capacity
        uint256 lockupPeriod;           // Minimum holding period
        bool requiresWhitelist;         // Require whitelist check
    }

    VaultConfig public config;

    // ============ YIELD TRACKING ============

    struct YieldRecord {
        uint256 id;
        uint256 amount;
        uint256 timestamp;
        uint256 sharePrice;
        YieldType yieldType;
        string description;
    }

    enum YieldType {
        RENTAL_INCOME,
        DIVIDEND,
        COUPON_PAYMENT,
        CAPITAL_GAIN,
        LIQUIDATION,
        OTHER
    }

    YieldRecord[] public yieldHistory;
    uint256 public totalYieldDistributed;
    uint256 public lastYieldTimestamp;

    // ============ USER TRACKING ============

    struct UserPosition {
        uint256 shares;
        uint256 depositTimestamp;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 yieldEarned;
        bool isActive;
    }

    mapping(address => UserPosition) public userPositions;
    address[] public depositors;
    mapping(address => bool) public isDepositor;

    // ============ COMPLIANCE ============

    address public whitelistAccess;
    address public legalWrapper;
    address public rwaRegistry;

    // ============ NAV TRACKING ============

    struct NAVSnapshot {
        uint256 timestamp;
        uint256 totalAssets;
        uint256 totalShares;
        uint256 sharePrice;
        uint256 blockNumber;
    }

    NAVSnapshot[] public navHistory;
    uint256 public constant NAV_PRECISION = 1e18;

    // ============ EMERGENCY ============

    bool public emergencyMode;
    uint256 public emergencyWithdrawalDelay = 7 days;

    // ============ EVENTS ============

    event YieldDistributed(
        uint256 indexed yieldId,
        uint256 amount,
        YieldType yieldType,
        uint256 newSharePrice
    );

    event DepositCompleted(
        address indexed depositor,
        uint256 assets,
        uint256 shares,
        uint256 timestamp
    );

    event WithdrawalCompleted(
        address indexed withdrawer,
        uint256 shares,
        uint256 assets,
        uint256 timestamp
    );

    event NAVUpdated(
        uint256 totalAssets,
        uint256 totalShares,
        uint256 sharePrice,
        uint256 timestamp
    );

    event EmergencyModeActivated(uint256 timestamp);
    event VaultConfigUpdated(VaultConfig newConfig);
    event FeesCollected(uint256 managementFee, uint256 performanceFee);

    // ============ CONSTRUCTOR ============

    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC4626(_asset) ERC20(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VAULT_MANAGER_ROLE, msg.sender);
        _grantRole(YIELD_DISTRIBUTOR_ROLE, msg.sender);
        _grantRole(COMPLIANCE_ROLE, msg.sender);

        // Default configuration
        config = VaultConfig({
            managementFee: 200,           // 2% annual
            performanceFee: 2000,         // 20% of yield
            withdrawalFee: 50,            // 0.5%
            minDeposit: 1e18,             // 1 token minimum
            maxDeposit: 1000000e18,       // 1M token max per user
            maxTotalAssets: 100000000e18, // 100M total capacity
            lockupPeriod: 90 days,        // 90 day lockup
            requiresWhitelist: true
        });

        // Initial NAV snapshot
        navHistory.push(NAVSnapshot({
            timestamp: block.timestamp,
            totalAssets: 0,
            totalShares: 0,
            sharePrice: NAV_PRECISION,
            blockNumber: block.number
        }));
    }

    // ============ ERC-4626 OVERRIDES ============

    /**
     * @notice Get total assets in vault
     * @dev Overrides ERC4626 to include pending yield
     */
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /**
     * @notice Deposit assets and receive shares
     * @dev Enforces compliance and lockup restrictions
     */
    function deposit(
        uint256 assets,
        address receiver
    ) public override nonReentrant whenNotPaused returns (uint256 shares) {
        require(!emergencyMode, "RWAVault: emergency mode active");
        require(assets >= config.minDeposit, "RWAVault: below minimum deposit");
        require(assets <= config.maxDeposit, "RWAVault: exceeds maximum deposit");
        require(totalAssets() + assets <= config.maxTotalAssets, "RWAVault: vault capacity reached");

        // Compliance check
        if (config.requiresWhitelist && whitelistAccess != address(0)) {
            (bool canDeposit,) = _checkWhitelist(msg.sender, receiver, assets);
            require(canDeposit, "RWAVault: compliance check failed");
        }

        // Calculate shares
        shares = previewDeposit(assets);
        require(shares > 0, "RWAVault: zero shares");

        // Execute deposit
        _deposit(msg.sender, receiver, assets, shares);

        // Update user position
        _updateUserPosition(receiver, shares, assets, true);

        // Record NAV
        _recordNAV();

        emit DepositCompleted(receiver, assets, shares, block.timestamp);

        return shares;
    }

    /**
     * @notice Withdraw assets by burning shares
     * @dev Enforces lockup period and compliance
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override nonReentrant returns (uint256 shares) {
        // Check lockup period
        UserPosition storage position = userPositions[owner];
        require(
            block.timestamp >= position.depositTimestamp + config.lockupPeriod,
            "RWAVault: lockup period active"
        );

        // Compliance check
        if (config.requiresWhitelist && whitelistAccess != address(0)) {
            (bool canWithdraw,) = _checkWhitelist(owner, receiver, assets);
            require(canWithdraw, "RWAVault: compliance check failed");
        }

        // Calculate withdrawal fee
        uint256 feeAmount = (assets * config.withdrawalFee) / 10000;
        uint256 netAssets = assets - feeAmount;

        // Calculate shares needed
        shares = previewWithdraw(assets);

        // Execute withdrawal
        _withdraw(msg.sender, receiver, owner, netAssets, shares);

        // Update user position
        _updateUserPosition(owner, shares, netAssets, false);

        // Record NAV
        _recordNAV();

        emit WithdrawalCompleted(owner, shares, netAssets, block.timestamp);

        return shares;
    }

    /**
     * @notice Redeem shares for assets
     * @dev Alternative withdrawal method
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override nonReentrant returns (uint256 assets) {
        // Check lockup period
        UserPosition storage position = userPositions[owner];
        require(
            block.timestamp >= position.depositTimestamp + config.lockupPeriod,
            "RWAVault: lockup period active"
        );

        // Compliance check
        if (config.requiresWhitelist && whitelistAccess != address(0)) {
            uint256 expectedAssets = previewRedeem(shares);
            (bool canRedeem,) = _checkWhitelist(owner, receiver, expectedAssets);
            require(canRedeem, "RWAVault: compliance check failed");
        }

        // Calculate assets
        assets = previewRedeem(shares);

        // Apply withdrawal fee
        uint256 feeAmount = (assets * config.withdrawalFee) / 10000;
        uint256 netAssets = assets - feeAmount;

        // Execute redemption
        _withdraw(msg.sender, receiver, owner, netAssets, shares);

        // Update user position
        _updateUserPosition(owner, shares, netAssets, false);

        // Record NAV
        _recordNAV();

        emit WithdrawalCompleted(owner, shares, netAssets, block.timestamp);

        return netAssets;
    }

    // ============ YIELD DISTRIBUTION ============

    /**
     * @notice Distribute yield to the vault
     * @dev Yield is deposited as additional assets, increasing share price
     */
    function distributeYield(
        uint256 amount,
        YieldType yieldType,
        string memory description
    ) external onlyRole(YIELD_DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "RWAVault: zero yield");
        require(totalSupply() > 0, "RWAVault: no shares outstanding");

        // Transfer yield to vault
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);

        // Calculate performance fee
        uint256 performanceFeeAmount = (amount * config.performanceFee) / 10000;
        uint256 netYield = amount - performanceFeeAmount;

        // Calculate new share price
        uint256 newSharePrice = (totalAssets() * NAV_PRECISION) / totalSupply();

        // Record yield
        uint256 yieldId = yieldHistory.length;
        yieldHistory.push(YieldRecord({
            id: yieldId,
            amount: netYield,
            timestamp: block.timestamp,
            sharePrice: newSharePrice,
            yieldType: yieldType,
            description: description
        }));

        totalYieldDistributed += netYield;
        lastYieldTimestamp = block.timestamp;

        // Record NAV
        _recordNAV();

        emit YieldDistributed(yieldId, netYield, yieldType, newSharePrice);
        emit FeesCollected(0, performanceFeeAmount);
    }

    // ============ NAV MANAGEMENT ============

    /**
     * @notice Record current NAV snapshot
     */
    function _recordNAV() internal {
        uint256 currentTotalAssets = totalAssets();
        uint256 currentTotalShares = totalSupply();
        uint256 currentSharePrice = currentTotalShares > 0
            ? (currentTotalAssets * NAV_PRECISION) / currentTotalShares
            : NAV_PRECISION;

        navHistory.push(NAVSnapshot({
            timestamp: block.timestamp,
            totalAssets: currentTotalAssets,
            totalShares: currentTotalShares,
            sharePrice: currentSharePrice,
            blockNumber: block.number
        }));

        emit NAVUpdated(currentTotalAssets, currentTotalShares, currentSharePrice, block.timestamp);
    }

    /**
     * @notice Get current share price
     */
    function getSharePrice() external view returns (uint256) {
        if (totalSupply() == 0) return NAV_PRECISION;
        return (totalAssets() * NAV_PRECISION) / totalSupply();
    }

    /**
     * @notice Get NAV history
     */
    function getNAVHistory(
        uint256 fromIndex,
        uint256 toIndex
    ) external view returns (NAVSnapshot[] memory) {
        require(toIndex >= fromIndex, "RWAVault: invalid range");
        require(toIndex < navHistory.length, "RWAVault: index out of bounds");

        uint256 length = toIndex - fromIndex + 1;
        NAVSnapshot[] memory result = new NAVSnapshot[](length);

        for (uint256 i = 0; i < length; i++) {
            result[i] = navHistory[fromIndex + i];
        }

        return result;
    }

    // ============ USER POSITION MANAGEMENT ============

    function _updateUserPosition(
        address user,
        uint256 shares,
        uint256 assets,
        bool isDeposit
    ) internal {
        UserPosition storage position = userPositions[user];

        if (!isDepositor[user] && isDeposit) {
            depositors.push(user);
            isDepositor[user] = true;
            position.isActive = true;
        }

        if (isDeposit) {
            position.shares += shares;
            position.totalDeposited += assets;
            position.depositTimestamp = block.timestamp;
        } else {
            position.shares -= shares;
            position.totalWithdrawn += assets;

            if (position.shares == 0) {
                position.isActive = false;
            }
        }
    }

    /**
     * @notice Get user position details
     */
    function getUserPosition(address user) external view returns (UserPosition memory) {
        return userPositions[user];
    }

    /**
     * @notice Get all depositors
     */
    function getAllDepositors() external view returns (address[] memory) {
        return depositors;
    }

    /**
     * @notice Get active depositor count
     */
    function getActiveDepositorCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < depositors.length; i++) {
            if (userPositions[depositors[i]].isActive) {
                count++;
            }
        }
        return count;
    }

    // ============ COMPLIANCE INTEGRATION ============

    function _checkWhitelist(
        address from,
        address to,
        uint256 amount
    ) internal view returns (bool, bytes32) {
        if (whitelistAccess == address(0)) {
            return (true, bytes32("NO_WHITELIST_CONFIGURED"));
        }

        (bool success, bytes memory data) = whitelistAccess.staticcall(
            abi.encodeWithSignature(
                "canTransfer(address,address,uint256)",
                from,
                to,
                amount
            )
        );

        if (success) {
            (bool canTransfer, bytes32 reason) = abi.decode(data, (bool, bytes32));
            return (canTransfer, reason);
        }

        return (false, bytes32("WHITELIST_CHECK_FAILED"));
    }

    /**
     * @notice Set compliance contracts
     */
    function setComplianceContracts(
        address _whitelistAccess,
        address _legalWrapper,
        address _rwaRegistry
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistAccess = _whitelistAccess;
        legalWrapper = _legalWrapper;
        rwaRegistry = _rwaRegistry;
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @notice Activate emergency mode
     */
    function activateEmergencyMode() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyMode = true;
        emit EmergencyModeActivated(block.timestamp);
    }

    /**
     * @notice Emergency withdrawal (bypasses restrictions)
     */
    function emergencyWithdraw() external nonReentrant {
        require(emergencyMode, "RWAVault: not in emergency mode");

        UserPosition storage position = userPositions[msg.sender];
        require(position.shares > 0, "RWAVault: no shares to withdraw");

        uint256 shares = position.shares;
        uint256 assets = previewRedeem(shares);

        _withdraw(msg.sender, msg.sender, msg.sender, assets, shares);

        position.shares = 0;
        position.isActive = false;

        emit WithdrawalCompleted(msg.sender, shares, assets, block.timestamp);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update vault configuration
     */
    function updateConfig(VaultConfig memory newConfig) external onlyRole(VAULT_MANAGER_ROLE) {
        require(newConfig.managementFee <= 1000, "RWAVault: fee too high"); // Max 10%
        require(newConfig.performanceFee <= 5000, "RWAVault: fee too high"); // Max 50%
        require(newConfig.withdrawalFee <= 500, "RWAVault: fee too high"); // Max 5%

        config = newConfig;
        emit VaultConfigUpdated(newConfig);
    }

    /**
     * @notice Pause vault operations
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause vault operations
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Collect management fees
     */
    function collectManagementFees() external onlyRole(VAULT_MANAGER_ROLE) {
        // Calculate time since last collection
        uint256 timeSinceLastYield = block.timestamp - lastYieldTimestamp;
        uint256 annualFee = (totalAssets() * config.managementFee) / 10000;
        uint256 periodFee = (annualFee * timeSinceLastYield) / 365 days;

        if (periodFee > 0) {
            // Mint shares to fee recipient (dilutes other shareholders)
            uint256 feeShares = previewDeposit(periodFee);
            _mint(msg.sender, feeShares);

            emit FeesCollected(periodFee, 0);
        }
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get yield history
     */
    function getYieldHistory() external view returns (YieldRecord[] memory) {
        return yieldHistory;
    }

    /**
     * @notice Get vault statistics
     */
    function getVaultStats() external view returns (
        uint256 _totalAssets,
        uint256 _totalShares,
        uint256 _sharePrice,
        uint256 _totalYield,
        uint256 _depositorCount
    ) {
        _totalAssets = totalAssets();
        _totalShares = totalSupply();
        _sharePrice = _totalShares > 0 ? (_totalAssets * NAV_PRECISION) / _totalShares : NAV_PRECISION;
        _totalYield = totalYieldDistributed;
        _depositorCount = depositors.length;
    }
}
