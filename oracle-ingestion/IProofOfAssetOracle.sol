// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProofOfAssetOracle
 * @notice Interface for the Proof-of-Asset Oracle System
 * @dev Defines the contract interface for registering, verifying, and managing real-world asset proofs
 *
 * This oracle serves as the cryptographic bridge between physical assets and their digital representations.
 * It implements a multi-layered verification system that combines:
 * - Cryptographic hash verification (SHA-256/Keccak-256)
 * - Geospatial validation (GPS coordinates with uncertainty bounds)
 * - Temporal attestation (block timestamp + external time oracle)
 * - Notary verification (multi-signature from certified notaries)
 * - Document provenance tracking (IPFS/Arweave content addressing)
 */
interface IProofOfAssetOracle {

    /// @notice Status of an asset proof submission
    enum ProofStatus {
        Pending,           // Initial submission, awaiting verification
        UnderReview,       // Being reviewed by notaries/validators
        Verified,          // Fully verified and accepted
        Rejected,          // Rejected due to invalid data
        Disputed,          // Under dispute resolution
        Revoked            // Previously valid, now revoked
    }

    /// @notice Type of real-world asset being tokenized
    enum AssetType {
        RealEstate,        // Residential, commercial, land
        CorporateBond,     // Fixed-income securities
        PrivateEquity,     // Company shares, fund interests
        Commodity,         // Physical commodities (gold, oil, etc.)
        IntellectualProperty, // Patents, copyrights, trademarks
        Infrastructure,    // Roads, utilities, public works
        ArtCollectible,    // Fine art, rare collectibles
        Other              // Catch-all for novel asset classes
    }

    /// @notice Geolocation data with uncertainty modeling
    struct GeoLocation {
        int256 latitude;          // Latitude in millionths of degrees (e.g., 40123456 = 40.123456°)
        int256 longitude;         // Longitude in millionths of degrees
        uint32 uncertaintyMeters; // Horizontal uncertainty in meters
        uint32 altitude;          // Altitude in meters above sea level
        uint64 timestamp;         // GPS timestamp
        bytes32 geoHash;          // Geohash for spatial indexing
    }

    /// @notice Notary attestation with cryptographic signature
    struct NotaryAttestation {
        address notaryAddress;    // Ethereum address of licensed notary
        bytes32 licenseHash;      // Hash of notary license document
        string jurisdiction;      // Legal jurisdiction (e.g., "US-NY", "EU-DE")
        uint64 attestationDate;   // Date of notarization
        bytes signature;          // Digital signature over (documentHash, assetId, timestamp)
        string notaryName;        // Full legal name of notary
        uint256 commissionExpiry; // Notary commission expiration timestamp
    }

    /// @notice Complete asset proof package
    struct AssetProof {
        bytes32 assetId;              // Unique identifier (hash of primary documentation)
        AssetType assetType;          // Classification of asset
        bytes32 documentHash;         // SHA-256 hash of legal documentation
        string ipfsHash;              // IPFS CID for retrievable storage
        string arweaveHash;           // Arweave transaction ID for permanent storage
        GeoLocation location;         // Physical location of asset
        NotaryAttestation[] attestations; // Multi-sig notary verifications
        uint256 valuationUSD;         // Third-party valuation in USD (6 decimals)
        address submitter;            // Address that submitted the proof
        uint64 submissionTime;        // Block timestamp of submission
        ProofStatus status;           // Current verification status
        bytes32 legalEntityHash;      // Hash of SPV/LLC operating agreement
        string metadata;              // JSON metadata (title, description, etc.)
    }

    /// @notice Events for proof lifecycle tracking

    event ProofSubmitted(
        bytes32 indexed assetId,
        address indexed submitter,
        AssetType assetType,
        bytes32 documentHash,
        uint256 timestamp
    );

    event ProofVerified(
        bytes32 indexed assetId,
        address indexed verifier,
        uint256 timestamp
    );

    event ProofRejected(
        bytes32 indexed assetId,
        address indexed verifier,
        string reason,
        uint256 timestamp
    );

    event ProofRevoked(
        bytes32 indexed assetId,
        address indexed revoker,
        string reason,
        uint256 timestamp
    );

    event NotaryAdded(
        bytes32 indexed assetId,
        address indexed notaryAddress,
        string jurisdiction
    );

    event DisputeRaised(
        bytes32 indexed assetId,
        address indexed disputant,
        string reason,
        uint256 timestamp
    );

    /// @notice Core oracle functions

    /**
     * @notice Submit a new asset proof to the oracle
     * @param documentHash Hash of the legal documentation
     * @param ipfsHash IPFS content identifier
     * @param arweaveHash Arweave transaction ID
     * @param assetType Type of asset being tokenized
     * @param location Geolocation data
     * @param valuationUSD Asset valuation in USD (6 decimals)
     * @param legalEntityHash Hash of SPV/LLC documentation
     * @param metadata JSON metadata string
     * @return assetId Unique identifier for the asset proof
     */
    function submitProof(
        bytes32 documentHash,
        string calldata ipfsHash,
        string calldata arweaveHash,
        AssetType assetType,
        GeoLocation calldata location,
        uint256 valuationUSD,
        bytes32 legalEntityHash,
        string calldata metadata
    ) external returns (bytes32 assetId);

    /**
     * @notice Add notary attestation to an existing proof
     * @param assetId The asset proof identifier
     * @param attestation Notary attestation data
     */
    function addNotaryAttestation(
        bytes32 assetId,
        NotaryAttestation calldata attestation
    ) external;

    /**
     * @notice Verify an asset proof (callable by authorized verifiers)
     * @param assetId The asset proof identifier
     */
    function verifyProof(bytes32 assetId) external;

    /**
     * @notice Reject an asset proof with reason
     * @param assetId The asset proof identifier
     * @param reason Rejection rationale
     */
    function rejectProof(bytes32 assetId, string calldata reason) external;

    /**
     * @notice Revoke a previously verified proof
     * @param assetId The asset proof identifier
     * @param reason Revocation rationale
     */
    function revokeProof(bytes32 assetId, string calldata reason) external;

    /**
     * @notice Raise a dispute against an asset proof
     * @param assetId The asset proof identifier
     * @param reason Dispute rationale
     */
    function raiseDispute(bytes32 assetId, string calldata reason) external;

    /**
     * @notice Retrieve complete asset proof
     * @param assetId The asset proof identifier
     * @return proof The complete AssetProof struct
     */
    function getProof(bytes32 assetId) external view returns (AssetProof memory proof);

    /**
     * @notice Verify that a document hash matches the registered proof
     * @param assetId The asset proof identifier
     * @param documentHash Hash to verify
     * @return matches True if hash matches registered proof
     */
    function verifyDocumentHash(bytes32 assetId, bytes32 documentHash) external view returns (bool matches);

    /**
     * @notice Check if an asset proof is fully verified
     * @param assetId The asset proof identifier
     * @return isVerified True if proof status is Verified
     */
    function isProofVerified(bytes32 assetId) external view returns (bool isVerified);

    /**
     * @notice Get all proofs for a specific submitter
     * @param submitter Address of the submitter
     * @return assetIds Array of asset IDs
     */
    function getProofsBySubmitter(address submitter) external view returns (bytes32[] memory assetIds);

    /**
     * @notice Get proofs by asset type
     * @param assetType Type of asset
     * @return assetIds Array of asset IDs
     */
    function getProofsByType(AssetType assetType) external view returns (bytes32[] memory assetIds);
}
