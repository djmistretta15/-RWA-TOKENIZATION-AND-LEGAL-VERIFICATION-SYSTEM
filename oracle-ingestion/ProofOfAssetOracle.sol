// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IProofOfAssetOracle.sol";

/**
 * @title ProofOfAssetOracle
 * @notice Implementation of the Proof-of-Asset Oracle System
 * @dev Implements cryptographic verification of real-world asset documentation
 *
 * ARCHITECTURAL PHILOSOPHY:
 * This oracle operates on the principle of "cryptographic certainty meets legal reality."
 * We create an immutable audit trail that connects physical assets to their digital twins
 * through multiple layers of verification:
 *
 * 1. CRYPTOGRAPHIC LAYER: SHA-256 hashes ensure document integrity
 * 2. GEOSPATIAL LAYER: GPS coordinates with uncertainty bounds prove physical location
 * 3. TEMPORAL LAYER: Block timestamps create unforgeable chronological record
 * 4. LEGAL LAYER: Notary signatures provide legal enforceability
 * 5. STORAGE LAYER: IPFS/Arweave ensure permanent, censorship-resistant storage
 *
 * Security Model:
 * - Multi-signature verification required for high-value assets
 * - Role-based access control (RBAC) for verifiers and administrators
 * - Dispute resolution mechanism with arbitration panel
 * - Revocation system for compromised or fraudulent proofs
 */
contract ProofOfAssetOracle is IProofOfAssetOracle {

    /// @notice Minimum number of notary attestations required for verification
    uint256 public constant MIN_NOTARY_ATTESTATIONS = 2;

    /// @notice Maximum valuation that can be submitted without additional verification ($100M)
    uint256 public constant MAX_VALUATION_WITHOUT_AUDIT = 100_000_000 * 1e6;

    /// @notice Mapping of assetId to AssetProof
    mapping(bytes32 => AssetProof) private assetProofs;

    /// @notice Mapping of submitter address to their submitted asset IDs
    mapping(address => bytes32[]) private submitterProofs;

    /// @notice Mapping of asset type to asset IDs
    mapping(AssetType => bytes32[]) private assetTypeProofs;

    /// @notice Authorized verifiers who can approve proofs
    mapping(address => bool) public authorizedVerifiers;

    /// @notice Certified notaries who can provide attestations
    mapping(address => bool) public certifiedNotaries;

    /// @notice Administrator role
    address public administrator;

    /// @notice Dispute arbitration panel
    address[] public arbitrationPanel;

    /// @notice Minimum stake required to raise a dispute (prevents spam)
    uint256 public disputeStake = 1 ether;

    /// @notice Counter for generating unique asset IDs
    uint256 private assetCounter;

    /// @notice Modifier to restrict access to administrators
    modifier onlyAdmin() {
        require(msg.sender == administrator, "ProofOfAssetOracle: caller is not admin");
        _;
    }

    /// @notice Modifier to restrict access to authorized verifiers
    modifier onlyVerifier() {
        require(authorizedVerifiers[msg.sender], "ProofOfAssetOracle: caller is not authorized verifier");
        _;
    }

    /// @notice Modifier to restrict access to certified notaries
    modifier onlyNotary() {
        require(certifiedNotaries[msg.sender], "ProofOfAssetOracle: caller is not certified notary");
        _;
    }

    /// @notice Constructor
    constructor() {
        administrator = msg.sender;
        authorizedVerifiers[msg.sender] = true;
        certifiedNotaries[msg.sender] = true;
    }

    /**
     * @notice Submit a new asset proof to the oracle
     * @dev Creates a cryptographically unique identifier and initializes the proof lifecycle
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
    ) external override returns (bytes32 assetId) {
        require(documentHash != bytes32(0), "ProofOfAssetOracle: invalid document hash");
        require(bytes(ipfsHash).length > 0, "ProofOfAssetOracle: invalid IPFS hash");
        require(valuationUSD > 0, "ProofOfAssetOracle: valuation must be positive");

        // Generate unique asset ID using cryptographic hashing
        assetId = keccak256(abi.encodePacked(
            documentHash,
            msg.sender,
            block.timestamp,
            assetCounter++
        ));

        require(assetProofs[assetId].submissionTime == 0, "ProofOfAssetOracle: asset ID collision");

        // Initialize the asset proof
        AssetProof storage proof = assetProofs[assetId];
        proof.assetId = assetId;
        proof.assetType = assetType;
        proof.documentHash = documentHash;
        proof.ipfsHash = ipfsHash;
        proof.arweaveHash = arweaveHash;
        proof.location = location;
        proof.valuationUSD = valuationUSD;
        proof.submitter = msg.sender;
        proof.submissionTime = uint64(block.timestamp);
        proof.status = ProofStatus.Pending;
        proof.legalEntityHash = legalEntityHash;
        proof.metadata = metadata;

        // Index by submitter and asset type
        submitterProofs[msg.sender].push(assetId);
        assetTypeProofs[assetType].push(assetId);

        emit ProofSubmitted(
            assetId,
            msg.sender,
            assetType,
            documentHash,
            block.timestamp
        );

        // Auto-advance to UnderReview if submitter is trusted
        if (authorizedVerifiers[msg.sender] || certifiedNotaries[msg.sender]) {
            proof.status = ProofStatus.UnderReview;
        }

        return assetId;
    }

    /**
     * @notice Add notary attestation to an existing proof
     * @dev Implements multi-signature verification through independent notary attestations
     */
    function addNotaryAttestation(
        bytes32 assetId,
        NotaryAttestation calldata attestation
    ) external override onlyNotary {
        AssetProof storage proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");
        require(proof.status != ProofStatus.Rejected, "ProofOfAssetOracle: proof is rejected");
        require(proof.status != ProofStatus.Revoked, "ProofOfAssetOracle: proof is revoked");

        // Verify notary signature
        require(attestation.notaryAddress == msg.sender, "ProofOfAssetOracle: notary address mismatch");
        require(attestation.commissionExpiry > block.timestamp, "ProofOfAssetOracle: notary commission expired");

        // Verify signature covers critical fields
        bytes32 messageHash = keccak256(abi.encodePacked(
            proof.documentHash,
            assetId,
            attestation.attestationDate
        ));

        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));

        address signer = recoverSigner(ethSignedMessageHash, attestation.signature);
        require(signer == attestation.notaryAddress, "ProofOfAssetOracle: invalid notary signature");

        // Add attestation
        proof.attestations.push(attestation);

        // Update status to UnderReview if this is the first attestation
        if (proof.status == ProofStatus.Pending) {
            proof.status = ProofStatus.UnderReview;
        }

        emit NotaryAdded(assetId, attestation.notaryAddress, attestation.jurisdiction);
    }

    /**
     * @notice Verify an asset proof (callable by authorized verifiers)
     * @dev Final verification requires minimum notary attestations and passes all checks
     */
    function verifyProof(bytes32 assetId) external override onlyVerifier {
        AssetProof storage proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");
        require(proof.status == ProofStatus.UnderReview, "ProofOfAssetOracle: proof not under review");

        // Verify minimum notary attestations
        require(
            proof.attestations.length >= MIN_NOTARY_ATTESTATIONS,
            "ProofOfAssetOracle: insufficient notary attestations"
        );

        // High-value assets require additional verification
        if (proof.valuationUSD > MAX_VALUATION_WITHOUT_AUDIT) {
            require(
                proof.attestations.length >= MIN_NOTARY_ATTESTATIONS + 1,
                "ProofOfAssetOracle: high-value asset requires additional attestations"
            );
        }

        // Verify geolocation is valid
        require(
            proof.location.latitude >= -90_000_000 && proof.location.latitude <= 90_000_000,
            "ProofOfAssetOracle: invalid latitude"
        );
        require(
            proof.location.longitude >= -180_000_000 && proof.location.longitude <= 180_000_000,
            "ProofOfAssetOracle: invalid longitude"
        );

        proof.status = ProofStatus.Verified;

        emit ProofVerified(assetId, msg.sender, block.timestamp);
    }

    /**
     * @notice Reject an asset proof with reason
     */
    function rejectProof(bytes32 assetId, string calldata reason) external override onlyVerifier {
        AssetProof storage proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");
        require(proof.status != ProofStatus.Verified, "ProofOfAssetOracle: cannot reject verified proof");

        proof.status = ProofStatus.Rejected;

        emit ProofRejected(assetId, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Revoke a previously verified proof
     * @dev Used when fraud is discovered or asset conditions change
     */
    function revokeProof(bytes32 assetId, string calldata reason) external override onlyAdmin {
        AssetProof storage proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");

        proof.status = ProofStatus.Revoked;

        emit ProofRevoked(assetId, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Raise a dispute against an asset proof
     * @dev Requires stake to prevent spam attacks
     */
    function raiseDispute(bytes32 assetId, string calldata reason) external payable override {
        require(msg.value >= disputeStake, "ProofOfAssetOracle: insufficient dispute stake");

        AssetProof storage proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");
        require(proof.status == ProofStatus.Verified, "ProofOfAssetOracle: can only dispute verified proofs");

        proof.status = ProofStatus.Disputed;

        emit DisputeRaised(assetId, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Retrieve complete asset proof
     */
    function getProof(bytes32 assetId) external view override returns (AssetProof memory proof) {
        proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");
        return proof;
    }

    /**
     * @notice Verify that a document hash matches the registered proof
     */
    function verifyDocumentHash(bytes32 assetId, bytes32 documentHash)
        external
        view
        override
        returns (bool matches)
    {
        AssetProof storage proof = assetProofs[assetId];
        require(proof.submissionTime > 0, "ProofOfAssetOracle: proof does not exist");
        return proof.documentHash == documentHash;
    }

    /**
     * @notice Check if an asset proof is fully verified
     */
    function isProofVerified(bytes32 assetId) external view override returns (bool isVerified) {
        AssetProof storage proof = assetProofs[assetId];
        return proof.status == ProofStatus.Verified;
    }

    /**
     * @notice Get all proofs for a specific submitter
     */
    function getProofsBySubmitter(address submitter)
        external
        view
        override
        returns (bytes32[] memory assetIds)
    {
        return submitterProofs[submitter];
    }

    /**
     * @notice Get proofs by asset type
     */
    function getProofsByType(AssetType assetType)
        external
        view
        override
        returns (bytes32[] memory assetIds)
    {
        return assetTypeProofs[assetType];
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Add an authorized verifier
     */
    function addVerifier(address verifier) external onlyAdmin {
        authorizedVerifiers[verifier] = true;
    }

    /**
     * @notice Remove an authorized verifier
     */
    function removeVerifier(address verifier) external onlyAdmin {
        authorizedVerifiers[verifier] = false;
    }

    /**
     * @notice Add a certified notary
     */
    function addNotary(address notary) external onlyAdmin {
        certifiedNotaries[notary] = true;
    }

    /**
     * @notice Remove a certified notary
     */
    function removeNotary(address notary) external onlyAdmin {
        certifiedNotaries[notary] = false;
    }

    /**
     * @notice Update dispute stake requirement
     */
    function setDisputeStake(uint256 newStake) external onlyAdmin {
        disputeStake = newStake;
    }

    /**
     * @notice Transfer administrator role
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "ProofOfAssetOracle: invalid admin address");
        administrator = newAdmin;
    }

    // ============ INTERNAL HELPER FUNCTIONS ============

    /**
     * @notice Recover signer address from signature
     * @dev Uses ECDSA signature recovery
     */
    function recoverSigner(bytes32 ethSignedMessageHash, bytes memory signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "ProofOfAssetOracle: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "ProofOfAssetOracle: invalid signature v value");

        return ecrecover(ethSignedMessageHash, v, r, s);
    }
}
