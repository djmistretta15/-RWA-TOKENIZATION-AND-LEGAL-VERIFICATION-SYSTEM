// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC1400 - Security Token Standard
 * @notice Interface for the ERC-1400 Security Token Standard
 * @dev Defines the standard for partially fungible tokens with compliance controls
 *
 * ERC-1400 ARCHITECTURAL PHILOSOPHY:
 *
 * Traditional ERC-20 tokens are fully fungible - every token is identical.
 * However, securities have complex compliance requirements:
 * - Transfer restrictions based on investor accreditation
 * - Lock-up periods and vesting schedules
 * - Partition-based ownership (different share classes)
 * - Regulatory compliance checks before transfers
 * - Forced transfers for legal/regulatory reasons
 * - Document management for investor communications
 *
 * ERC-1400 introduces "partitions" - sub-classes of tokens with different rules.
 * For example:
 * - Common Stock (partition: "CommonStock")
 * - Preferred Stock Class A (partition: "PreferredA")
 * - Restricted Securities (partition: "Restricted144A")
 * - Founder Shares (partition: "Founders")
 *
 * Each partition can have its own:
 * - Transfer restrictions
 * - Voting rights
 * - Dividend distribution rules
 * - Lock-up schedules
 *
 * This standard is used by:
 * - Securitize (leading security token platform)
 * - Polymath (now Polymesh)
 * - Harbor (now deprecated, but pioneered the standard)
 * - Major financial institutions tokenizing assets
 */
interface IERC1400 {

    // ========== PARTITION MANAGEMENT ==========

    /**
     * @notice Get balance of a specific partition
     * @param partition The partition identifier
     * @param tokenHolder The address of the token holder
     * @return The balance of the partition
     */
    function balanceOfByPartition(bytes32 partition, address tokenHolder)
        external
        view
        returns (uint256);

    /**
     * @notice Get all partitions for a token holder
     * @param tokenHolder The address of the token holder
     * @return Array of partition identifiers
     */
    function partitionsOf(address tokenHolder)
        external
        view
        returns (bytes32[] memory);

    // ========== TRANSFER WITH DATA ==========

    /**
     * @notice Transfer tokens with additional data
     * @dev Allows attaching metadata to transfers (e.g., reason codes, documentation)
     * @param to The recipient address
     * @param value The amount to transfer
     * @param data Additional data attached to the transfer
     */
    function transferWithData(address to, uint256 value, bytes calldata data)
        external;

    /**
     * @notice Transfer tokens from a specific partition
     * @param partition The partition to transfer from
     * @param to The recipient address
     * @param value The amount to transfer
     * @param data Additional data attached to the transfer
     * @return The destination partition
     */
    function transferByPartition(
        bytes32 partition,
        address to,
        uint256 value,
        bytes calldata data
    ) external returns (bytes32);

    // ========== OPERATOR TRANSFERS ==========

    /**
     * @notice Transfer tokens on behalf of another address (with data)
     * @param from The source address
     * @param to The recipient address
     * @param value The amount to transfer
     * @param data Additional data
     */
    function transferFromWithData(
        address from,
        address to,
        uint256 value,
        bytes calldata data
    ) external;

    /**
     * @notice Transfer tokens from a specific partition on behalf of another address
     * @param partition The partition to transfer from
     * @param from The source address
     * @param to The recipient address
     * @param value The amount to transfer
     * @param data Additional data
     * @param operatorData Data from the operator
     * @return The destination partition
     */
    function operatorTransferByPartition(
        bytes32 partition,
        address from,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata operatorData
    ) external returns (bytes32);

    // ========== ISSUANCE & REDEMPTION ==========

    /**
     * @notice Issue new tokens
     * @param tokenHolder The address to issue tokens to
     * @param value The amount to issue
     * @param data Additional data
     */
    function issue(address tokenHolder, uint256 value, bytes calldata data)
        external;

    /**
     * @notice Issue tokens to a specific partition
     * @param partition The partition to issue to
     * @param tokenHolder The address to issue tokens to
     * @param value The amount to issue
     * @param data Additional data
     */
    function issueByPartition(
        bytes32 partition,
        address tokenHolder,
        uint256 value,
        bytes calldata data
    ) external;

    /**
     * @notice Redeem tokens (burn)
     * @param value The amount to redeem
     * @param data Additional data
     */
    function redeem(uint256 value, bytes calldata data)
        external;

    /**
     * @notice Redeem tokens from a specific partition
     * @param partition The partition to redeem from
     * @param value The amount to redeem
     * @param data Additional data
     */
    function redeemByPartition(
        bytes32 partition,
        uint256 value,
        bytes calldata data
    ) external;

    /**
     * @notice Redeem tokens on behalf of another address
     * @param tokenHolder The address to redeem from
     * @param value The amount to redeem
     * @param data Additional data
     */
    function redeemFrom(address tokenHolder, uint256 value, bytes calldata data)
        external;

    /**
     * @notice Redeem tokens from a specific partition on behalf of another address
     * @param partition The partition to redeem from
     * @param tokenHolder The address to redeem from
     * @param value The amount to redeem
     * @param operatorData Data from the operator
     */
    function operatorRedeemByPartition(
        bytes32 partition,
        address tokenHolder,
        uint256 value,
        bytes calldata operatorData
    ) external;

    // ========== TRANSFER VALIDITY ==========

    /**
     * @notice Check if a transfer can be executed
     * @param to The recipient address
     * @param value The amount to transfer
     * @param data Additional data
     * @return ESC code (Ethereum Status Code) and additional info
     */
    function canTransfer(address to, uint256 value, bytes calldata data)
        external
        view
        returns (bytes1, bytes32);

    /**
     * @notice Check if a partition transfer can be executed
     * @param from The source address
     * @param to The recipient address
     * @param partition The partition
     * @param value The amount to transfer
     * @param data Additional data
     * @return ESC code, destination partition, and additional info
     */
    function canTransferByPartition(
        address from,
        address to,
        bytes32 partition,
        uint256 value,
        bytes calldata data
    ) external view returns (bytes1, bytes32, bytes32);

    // ========== OPERATOR MANAGEMENT ==========

    /**
     * @notice Authorize an operator for all partitions
     * @param operator The address to authorize
     */
    function authorizeOperator(address operator)
        external;

    /**
     * @notice Revoke operator authorization
     * @param operator The address to revoke
     */
    function revokeOperator(address operator)
        external;

    /**
     * @notice Authorize an operator for a specific partition
     * @param partition The partition
     * @param operator The address to authorize
     */
    function authorizeOperatorByPartition(bytes32 partition, address operator)
        external;

    /**
     * @notice Revoke partition operator authorization
     * @param partition The partition
     * @param operator The address to revoke
     */
    function revokeOperatorByPartition(bytes32 partition, address operator)
        external;

    /**
     * @notice Check if an address is an operator
     * @param operator The address to check
     * @param tokenHolder The token holder address
     * @return True if the address is an operator
     */
    function isOperator(address operator, address tokenHolder)
        external
        view
        returns (bool);

    /**
     * @notice Check if an address is an operator for a specific partition
     * @param partition The partition
     * @param operator The address to check
     * @param tokenHolder The token holder address
     * @return True if the address is a partition operator
     */
    function isOperatorForPartition(
        bytes32 partition,
        address operator,
        address tokenHolder
    ) external view returns (bool);

    // ========== TOKEN INFORMATION ==========

    /**
     * @notice Check if the token is issuable
     * @return True if new tokens can be issued
     */
    function isIssuable()
        external
        view
        returns (bool);

    /**
     * @notice Get the list of default partitions
     * @return Array of default partition identifiers
     */
    function getDefaultPartitions()
        external
        view
        returns (bytes32[] memory);

    // ========== DOCUMENT MANAGEMENT ==========

    /**
     * @notice Set a document for the token
     * @param name The document name
     * @param uri The document URI
     * @param documentHash The hash of the document
     */
    function setDocument(bytes32 name, string calldata uri, bytes32 documentHash)
        external;

    /**
     * @notice Get a document
     * @param name The document name
     * @return The document URI, hash, and last modification time
     */
    function getDocument(bytes32 name)
        external
        view
        returns (string memory, bytes32, uint256);

    // ========== EVENTS ==========

    event TransferByPartition(
        bytes32 indexed fromPartition,
        address operator,
        address indexed from,
        address indexed to,
        uint256 value,
        bytes data,
        bytes operatorData
    );

    event ChangedPartition(
        bytes32 indexed fromPartition,
        bytes32 indexed toPartition,
        uint256 value
    );

    event AuthorizedOperator(
        address indexed operator,
        address indexed tokenHolder
    );

    event RevokedOperator(
        address indexed operator,
        address indexed tokenHolder
    );

    event AuthorizedOperatorByPartition(
        bytes32 indexed partition,
        address indexed operator,
        address indexed tokenHolder
    );

    event RevokedOperatorByPartition(
        bytes32 indexed partition,
        address indexed operator,
        address indexed tokenHolder
    );

    event Issued(
        address indexed operator,
        address indexed to,
        uint256 value,
        bytes data
    );

    event Redeemed(
        address indexed operator,
        address indexed from,
        uint256 value,
        bytes data
    );

    event IssuedByPartition(
        bytes32 indexed partition,
        address indexed operator,
        address indexed to,
        uint256 value,
        bytes data,
        bytes operatorData
    );

    event RedeemedByPartition(
        bytes32 indexed partition,
        address indexed operator,
        address indexed from,
        uint256 value,
        bytes operatorData
    );

    event DocumentUpdated(
        bytes32 indexed name,
        string uri,
        bytes32 documentHash
    );
}
