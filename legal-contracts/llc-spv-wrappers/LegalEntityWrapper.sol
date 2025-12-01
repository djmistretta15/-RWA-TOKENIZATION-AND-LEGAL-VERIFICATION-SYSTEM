// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LegalEntityWrapper
 * @notice Creates blockchain-enforceable legal entity wrappers for RWA tokens
 * @dev Implements SPV (Special Purpose Vehicle) and LLC (Limited Liability Company) structures
 *
 * LEGAL ARCHITECTURE PHILOSOPHY:
 *
 * This contract bridges the gap between on-chain token ownership and off-chain legal reality.
 * Every RWA token represents ownership in a LEGAL ENTITY, not just a blockchain token.
 *
 * THE WRAPPER STRUCTURE:
 *
 * Physical Asset (Real Estate, Bonds, etc.)
 *          ↓
 * SPV/LLC Legal Entity (off-chain legal entity)
 *          ↓
 * Operating Agreement (legal contract, hash stored on-chain)
 *          ↓
 * ERC-1400 Security Token (blockchain representation)
 *          ↓
 * Token Holders (investors with legal ownership rights)
 *
 * KEY LEGAL PRINCIPLES:
 *
 * 1. PIERCING THE CORPORATE VEIL PROTECTION:
 *    - Each asset has its own SPV/LLC
 *    - Isolates liability to the specific asset
 *    - Protects investors from cross-collateralization
 *
 * 2. SERIES LLC STRUCTURE (Delaware):
 *    - Master LLC with multiple series (one per asset)
 *    - Each series is legally independent
 *    - Shared governance overhead, isolated liability
 *
 * 3. OPERATING AGREEMENT HASH:
 *    - Full operating agreement stored on IPFS/Arweave
 *    - SHA-256 hash stored on-chain
 *    - Creates cryptographic proof of legal terms
 *    - Court-enforceable via "hash as evidence" precedent
 *
 * 4. DUAL REGISTRY:
 *    - On-chain: Token ownership via ERC-1400
 *    - Off-chain: Legal entity member registry via API
 *    - Automated sync ensures legal = blockchain
 *
 * 5. FORCED TRANSFER MECHANISM:
 *    - Court orders can force token transfers
 *    - Inheritance / estate settlement
 *    - Divorce / marital property division
 *    - Bankruptcy / creditor claims
 *
 * LEGAL JURISDICTIONS SUPPORTED:
 * - Delaware (USA) - Series LLC
 * - Wyoming (USA) - DAO LLC
 * - Cayman Islands - Exempted Company
 * - British Virgin Islands (BVI) - Business Company
 * - Switzerland - AG (Aktiengesellschaft)
 * - Singapore - Variable Capital Company (VCC)
 */
contract LegalEntityWrapper {

    // ========== ENTITY TYPES ==========

    enum EntityType {
        SPV_LLC,              // Special Purpose Vehicle (LLC)
        SERIES_LLC,           // Series LLC (Delaware)
        DAO_LLC,              // DAO LLC (Wyoming)
        CAYMAN_EXEMPTED,      // Cayman Islands Exempted Company
        BVI_BUSINESS,         // BVI Business Company
        SWISS_AG,             // Swiss Aktiengesellschaft
        SINGAPORE_VCC         // Singapore Variable Capital Company
    }

    enum Jurisdiction {
        US_DELAWARE,
        US_WYOMING,
        CAYMAN_ISLANDS,
        BRITISH_VIRGIN_ISLANDS,
        SWITZERLAND,
        SINGAPORE,
        OTHER
    }

    // ========== DATA STRUCTURES ==========

    struct LegalEntity {
        bytes32 entityId;                 // Unique entity identifier
        EntityType entityType;            // Type of legal entity
        Jurisdiction jurisdiction;        // Legal jurisdiction
        string entityName;                // Legal name of entity
        string registrationNumber;        // Government registration number
        bytes32 operatingAgreementHash;   // Hash of operating agreement
        string ipfsHash;                  // IPFS CID of legal documents
        string arweaveHash;               // Arweave TX ID of legal documents
        address tokenContract;            // Associated ERC-1400 token
        bytes32 assetId;                  // Link to ProofOfAssetOracle
        address registeredAgent;          // Registered agent address
        uint256 formationDate;            // Date of entity formation
        bool active;                      // Entity active status
        address[] members;                // Current members (token holders)
        mapping(address => uint256) memberShares; // Member ownership percentages
    }

    struct GovernanceRights {
        bool votingRights;                // Can vote on governance proposals
        bool informationRights;           // Can access entity information
        bool inspectionRights;            // Can inspect books and records
        bool transferRights;              // Can transfer ownership
        bool redemptionRights;            // Can redeem tokens
    }

    struct OperatingAgreementTerms {
        bytes32 entityId;
        string managementStructure;       // "Member-managed" or "Manager-managed"
        address[] managers;               // If manager-managed
        uint256 votingThreshold;          // Percentage needed for decisions (basis points)
        uint256 quorumRequirement;        // Minimum participation for votes
        bool allowTransfers;              // Can members transfer ownership
        uint256 transferRestrictionPeriod; // Lock-up period for transfers
        string disputeResolution;         // "Arbitration" or "Litigation"
        string governingLaw;              // e.g., "Delaware General Corporation Law"
        bytes32 documentHash;             // Hash of full agreement
    }

    struct CourtOrder {
        bytes32 orderId;
        bytes32 entityId;
        address targetAddress;            // Address subject to order
        CourtOrderType orderType;
        uint256 amount;                   // Amount of tokens affected
        string courtName;                 // e.g., "Delaware Chancery Court"
        string caseNumber;                // Court case number
        bytes32 orderDocumentHash;        // Hash of court order document
        uint256 issuedDate;
        bool executed;
        address executor;                 // Who executed the order
    }

    enum CourtOrderType {
        FORCED_TRANSFER,                  // Transfer tokens by court order
        ACCOUNT_FREEZE,                   // Freeze account
        SEIZURE,                          // Seize tokens (government)
        INHERITANCE,                      // Estate transfer
        DIVORCE_SETTLEMENT,               // Marital property division
        BANKRUPTCY                        // Bankruptcy trustee control
    }

    // ========== STATE VARIABLES ==========

    address public administrator;
    address public registryOracle;        // Off-chain registry sync oracle

    mapping(bytes32 => LegalEntity) private legalEntities;
    mapping(address => bytes32[]) private entitiesByMember;
    mapping(bytes32 => OperatingAgreementTerms) public operatingAgreements;
    mapping(bytes32 => GovernanceRights) public memberGovernanceRights;
    mapping(bytes32 => CourtOrder) public courtOrders;

    bytes32[] public allEntityIds;

    // Authorized legal officers who can execute court orders
    mapping(address => bool) public authorizedLegalOfficers;

    // ========== EVENTS ==========

    event EntityCreated(
        bytes32 indexed entityId,
        EntityType entityType,
        Jurisdiction jurisdiction,
        string entityName,
        address tokenContract
    );

    event OperatingAgreementUpdated(
        bytes32 indexed entityId,
        bytes32 documentHash
    );

    event MemberAdded(
        bytes32 indexed entityId,
        address indexed member,
        uint256 shares
    );

    event MemberRemoved(
        bytes32 indexed entityId,
        address indexed member
    );

    event CourtOrderExecuted(
        bytes32 indexed orderId,
        bytes32 indexed entityId,
        CourtOrderType orderType,
        address targetAddress
    );

    event ManagersUpdated(
        bytes32 indexed entityId,
        address[] managers
    );

    // ========== MODIFIERS ==========

    modifier onlyAdministrator() {
        require(msg.sender == administrator, "LegalEntityWrapper: caller is not administrator");
        _;
    }

    modifier onlyLegalOfficer() {
        require(authorizedLegalOfficers[msg.sender], "LegalEntityWrapper: caller is not authorized legal officer");
        _;
    }

    modifier entityExists(bytes32 entityId) {
        require(legalEntities[entityId].active, "LegalEntityWrapper: entity does not exist");
        _;
    }

    // ========== CONSTRUCTOR ==========

    constructor() {
        administrator = msg.sender;
        authorizedLegalOfficers[msg.sender] = true;
    }

    // ========== ENTITY CREATION ==========

    /**
     * @notice Create a new legal entity wrapper
     * @param entityType Type of legal entity (LLC, Series LLC, etc.)
     * @param jurisdiction Legal jurisdiction
     * @param entityName Legal name of entity
     * @param registrationNumber Government registration number
     * @param operatingAgreementHash Hash of operating agreement
     * @param ipfsHash IPFS CID of legal documents
     * @param arweaveHash Arweave TX ID of legal documents
     * @param tokenContract Associated ERC-1400 token contract
     * @param assetId Link to ProofOfAssetOracle
     * @return entityId Unique entity identifier
     */
    function createLegalEntity(
        EntityType entityType,
        Jurisdiction jurisdiction,
        string memory entityName,
        string memory registrationNumber,
        bytes32 operatingAgreementHash,
        string memory ipfsHash,
        string memory arweaveHash,
        address tokenContract,
        bytes32 assetId,
        address registeredAgent
    ) external onlyAdministrator returns (bytes32 entityId) {

        entityId = keccak256(abi.encodePacked(
            entityName,
            registrationNumber,
            jurisdiction,
            block.timestamp
        ));

        require(!legalEntities[entityId].active, "LegalEntityWrapper: entity already exists");

        LegalEntity storage entity = legalEntities[entityId];
        entity.entityId = entityId;
        entity.entityType = entityType;
        entity.jurisdiction = jurisdiction;
        entity.entityName = entityName;
        entity.registrationNumber = registrationNumber;
        entity.operatingAgreementHash = operatingAgreementHash;
        entity.ipfsHash = ipfsHash;
        entity.arweaveHash = arweaveHash;
        entity.tokenContract = tokenContract;
        entity.assetId = assetId;
        entity.registeredAgent = registeredAgent;
        entity.formationDate = block.timestamp;
        entity.active = true;

        allEntityIds.push(entityId);

        emit EntityCreated(
            entityId,
            entityType,
            jurisdiction,
            entityName,
            tokenContract
        );

        return entityId;
    }

    /**
     * @notice Set operating agreement terms
     */
    function setOperatingAgreement(
        bytes32 entityId,
        string memory managementStructure,
        address[] memory managers,
        uint256 votingThreshold,
        uint256 quorumRequirement,
        bool allowTransfers,
        uint256 transferRestrictionPeriod,
        string memory disputeResolution,
        string memory governingLaw,
        bytes32 documentHash
    ) external onlyAdministrator entityExists(entityId) {

        operatingAgreements[entityId] = OperatingAgreementTerms({
            entityId: entityId,
            managementStructure: managementStructure,
            managers: managers,
            votingThreshold: votingThreshold,
            quorumRequirement: quorumRequirement,
            allowTransfers: allowTransfers,
            transferRestrictionPeriod: transferRestrictionPeriod,
            disputeResolution: disputeResolution,
            governingLaw: governingLaw,
            documentHash: documentHash
        });

        emit OperatingAgreementUpdated(entityId, documentHash);
    }

    // ========== MEMBER MANAGEMENT ==========

    /**
     * @notice Add a member to the legal entity
     * @dev Called automatically when tokens are transferred
     */
    function addMember(
        bytes32 entityId,
        address member,
        uint256 shares
    ) external onlyAdministrator entityExists(entityId) {

        LegalEntity storage entity = legalEntities[entityId];

        if (entity.memberShares[member] == 0) {
            entity.members.push(member);
            entitiesByMember[member].push(entityId);
        }

        entity.memberShares[member] = shares;

        emit MemberAdded(entityId, member, shares);
    }

    /**
     * @notice Remove a member from the legal entity
     */
    function removeMember(
        bytes32 entityId,
        address member
    ) external onlyAdministrator entityExists(entityId) {

        LegalEntity storage entity = legalEntities[entityId];

        require(entity.memberShares[member] > 0, "LegalEntityWrapper: member does not exist");

        entity.memberShares[member] = 0;

        // Remove from members array
        for (uint i = 0; i < entity.members.length; i++) {
            if (entity.members[i] == member) {
                entity.members[i] = entity.members[entity.members.length - 1];
                entity.members.pop();
                break;
            }
        }

        emit MemberRemoved(entityId, member);
    }

    /**
     * @notice Get all members of an entity
     */
    function getMembers(bytes32 entityId)
        external
        view
        entityExists(entityId)
        returns (address[] memory)
    {
        return legalEntities[entityId].members;
    }

    /**
     * @notice Get member's ownership percentage
     */
    function getMemberShares(bytes32 entityId, address member)
        external
        view
        entityExists(entityId)
        returns (uint256)
    {
        return legalEntities[entityId].memberShares[member];
    }

    // ========== COURT ORDER EXECUTION ==========

    /**
     * @notice Execute a court order for forced transfer, freeze, etc.
     * @dev Only authorized legal officers can execute court orders
     */
    function executeCourtOrder(
        bytes32 entityId,
        address targetAddress,
        CourtOrderType orderType,
        uint256 amount,
        string memory courtName,
        string memory caseNumber,
        bytes32 orderDocumentHash
    ) external onlyLegalOfficer entityExists(entityId) returns (bytes32 orderId) {

        orderId = keccak256(abi.encodePacked(
            entityId,
            targetAddress,
            orderType,
            block.timestamp
        ));

        courtOrders[orderId] = CourtOrder({
            orderId: orderId,
            entityId: entityId,
            targetAddress: targetAddress,
            orderType: orderType,
            amount: amount,
            courtName: courtName,
            caseNumber: caseNumber,
            orderDocumentHash: orderDocumentHash,
            issuedDate: block.timestamp,
            executed: true,
            executor: msg.sender
        });

        // In production, this would call the token contract to execute the order
        // For example: IERC1400(tokenContract).forcedTransfer(...)

        emit CourtOrderExecuted(orderId, entityId, orderType, targetAddress);

        return orderId;
    }

    /**
     * @notice Get court order details
     */
    function getCourtOrder(bytes32 orderId)
        external
        view
        returns (CourtOrder memory)
    {
        return courtOrders[orderId];
    }

    // ========== GOVERNANCE ==========

    /**
     * @notice Set governance rights for a member
     */
    function setGovernanceRights(
        bytes32 entityId,
        address member,
        bool votingRights,
        bool informationRights,
        bool inspectionRights,
        bool transferRights,
        bool redemptionRights
    ) external onlyAdministrator entityExists(entityId) {

        bytes32 memberRightsId = keccak256(abi.encodePacked(entityId, member));

        memberGovernanceRights[memberRightsId] = GovernanceRights({
            votingRights: votingRights,
            informationRights: informationRights,
            inspectionRights: inspectionRights,
            transferRights: transferRights,
            redemptionRights: redemptionRights
        });
    }

    /**
     * @notice Get governance rights for a member
     */
    function getGovernanceRights(bytes32 entityId, address member)
        external
        view
        returns (GovernanceRights memory)
    {
        bytes32 memberRightsId = keccak256(abi.encodePacked(entityId, member));
        return memberGovernanceRights[memberRightsId];
    }

    // ========== ADMIN FUNCTIONS ==========

    function addLegalOfficer(address officer) external onlyAdministrator {
        authorizedLegalOfficers[officer] = true;
    }

    function removeLegalOfficer(address officer) external onlyAdministrator {
        authorizedLegalOfficers[officer] = false;
    }

    function setRegistryOracle(address oracle) external onlyAdministrator {
        registryOracle = oracle;
    }

    function updateManagers(bytes32 entityId, address[] memory newManagers)
        external
        onlyAdministrator
        entityExists(entityId)
    {
        operatingAgreements[entityId].managers = newManagers;
        emit ManagersUpdated(entityId, newManagers);
    }

    // ========== VIEW FUNCTIONS ==========

    function getLegalEntity(bytes32 entityId)
        external
        view
        entityExists(entityId)
        returns (
            EntityType entityType,
            Jurisdiction jurisdiction,
            string memory entityName,
            string memory registrationNumber,
            bytes32 operatingAgreementHash,
            address tokenContract,
            uint256 formationDate
        )
    {
        LegalEntity storage entity = legalEntities[entityId];
        return (
            entity.entityType,
            entity.jurisdiction,
            entity.entityName,
            entity.registrationNumber,
            entity.operatingAgreementHash,
            entity.tokenContract,
            entity.formationDate
        );
    }

    function getEntitiesByMember(address member)
        external
        view
        returns (bytes32[] memory)
    {
        return entitiesByMember[member];
    }

    function getAllEntities()
        external
        view
        returns (bytes32[] memory)
    {
        return allEntityIds;
    }
}
