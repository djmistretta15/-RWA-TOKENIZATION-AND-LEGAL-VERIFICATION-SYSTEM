/**
 * @fileoverview Asset Proof Schema - TypeScript type definitions and validation rules
 * @module oracle/assetProof.schema
 *
 * AI-GRADE REQUIREMENT: Full metadata immutability with comprehensive validation
 *
 * This module defines the complete schema for asset proofs including:
 * - Notarization data structures
 * - Geo-tagging specifications
 * - Document hash requirements
 * - Oracle consensus formats
 * - Immutability guarantees
 * - Version management
 * - Validation rules with Zod
 */

import { z } from "zod";
import { ethers } from "ethers";
import * as crypto from "crypto";

// ═══════════════════════════════════════════════════════════════
// CORE ENUMS
// ═══════════════════════════════════════════════════════════════

export enum AssetType {
  REAL_ESTATE = "REAL_ESTATE",
  COMMERCIAL_PROPERTY = "COMMERCIAL_PROPERTY",
  RESIDENTIAL_PROPERTY = "RESIDENTIAL_PROPERTY",
  LAND = "LAND",
  CORPORATE_BOND = "CORPORATE_BOND",
  GOVERNMENT_BOND = "GOVERNMENT_BOND",
  MUNICIPAL_BOND = "MUNICIPAL_BOND",
  PRIVATE_EQUITY = "PRIVATE_EQUITY",
  VENTURE_CAPITAL = "VENTURE_CAPITAL",
  HEDGE_FUND = "HEDGE_FUND",
  COMMODITIES = "COMMODITIES",
  ART = "ART",
  COLLECTIBLES = "COLLECTIBLES",
  INTELLECTUAL_PROPERTY = "INTELLECTUAL_PROPERTY",
  REVENUE_SHARE = "REVENUE_SHARE",
  INVOICE_FACTORING = "INVOICE_FACTORING",
  CARBON_CREDITS = "CARBON_CREDITS",
  RENEWABLE_ENERGY = "RENEWABLE_ENERGY",
}

export enum JurisdictionCode {
  US_DELAWARE = "US-DE",
  US_WYOMING = "US-WY",
  US_NEVADA = "US-NV",
  US_NEW_YORK = "US-NY",
  US_CALIFORNIA = "US-CA",
  CH_ZUG = "CH-ZG",
  CH_ZURICH = "CH-ZH",
  AE_ADGM = "AE-ADGM",
  AE_DIFC = "AE-DIFC",
  SG_MAS = "SG-MAS",
  KY_CIMA = "KY-CIMA",
  VG_FSC = "VG-FSC",
  UK_FCA = "UK-FCA",
  EU_MICA = "EU-MICA",
  LI_FMA = "LI-FMA",
}

export enum NotaryType {
  TRADITIONAL = "TRADITIONAL",
  REMOTE_ONLINE = "REMOTE_ONLINE",
  BLOCKCHAIN_ATTESTED = "BLOCKCHAIN_ATTESTED",
  GOVERNMENT_CERTIFIED = "GOVERNMENT_CERTIFIED",
  COURT_APPOINTED = "COURT_APPOINTED",
}

export enum DocumentType {
  DEED = "DEED",
  TITLE = "TITLE",
  CERTIFICATE = "CERTIFICATE",
  APPRAISAL = "APPRAISAL",
  LEGAL_OPINION = "LEGAL_OPINION",
  REGULATORY_FILING = "REGULATORY_FILING",
  FINANCIAL_STATEMENT = "FINANCIAL_STATEMENT",
  AUDIT_REPORT = "AUDIT_REPORT",
  INSURANCE_POLICY = "INSURANCE_POLICY",
  ENVIRONMENTAL_REPORT = "ENVIRONMENTAL_REPORT",
  SURVEY = "SURVEY",
  ENCUMBRANCE_REPORT = "ENCUMBRANCE_REPORT",
}

export enum OracleSource {
  CHAINLINK = "CHAINLINK",
  API3 = "API3",
  UMA = "UMA",
  PYTH = "PYTH",
  BAND = "BAND",
  REDSTONE = "REDSTONE",
}

export enum ValidationStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  PASSED = "PASSED",
  FAILED = "FAILED",
  REQUIRES_MANUAL_REVIEW = "REQUIRES_MANUAL_REVIEW",
  EXPIRED = "EXPIRED",
}

export enum ProofVersion {
  V1_0 = "1.0",
  V1_1 = "1.1",
  V2_0 = "2.0",
}

// ═══════════════════════════════════════════════════════════════
// GEO-TAGGING SCHEMA
// ═══════════════════════════════════════════════════════════════

export const GeoCoordinatesSchema = z.object({
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .describe("WGS84 latitude in decimal degrees"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .describe("WGS84 longitude in decimal degrees"),
  altitude: z.number().optional().describe("Altitude in meters above sea level"),
  accuracy: z
    .number()
    .positive()
    .describe("GPS accuracy in meters"),
  timestamp: z.number().int().positive().describe("Unix timestamp of location capture"),
});

export const GeoStampSchema = z.object({
  coordinates: GeoCoordinatesSchema,
  addressLine1: z.string().min(1).max(500),
  addressLine2: z.string().max(500).optional(),
  city: z.string().min(1).max(100),
  stateProvince: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  countryCode: z
    .string()
    .length(2)
    .describe("ISO 3166-1 alpha-2 country code"),
  plusCode: z.string().optional().describe("Google Plus Code for precise location"),
  what3words: z.string().optional().describe("What3Words address"),
  verificationMethod: z.enum([
    "GPS",
    "CELLULAR_TRIANGULATION",
    "IP_GEOLOCATION",
    "MANUAL_ENTRY",
    "GOVERNMENT_REGISTRY",
  ]),
  verifiedBy: z.string().optional(),
  verificationTimestamp: z.number().int().positive(),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe("Keccak256 hash of geo data"),
});

// ═══════════════════════════════════════════════════════════════
// NOTARIZATION SCHEMA
// ═══════════════════════════════════════════════════════════════

export const NotaryInfoSchema = z.object({
  notaryId: z.string().min(1).max(100),
  notaryName: z.string().min(1).max(200),
  notaryType: z.nativeEnum(NotaryType),
  licenseNumber: z.string().min(1).max(100),
  licensingAuthority: z.string().min(1).max(200),
  jurisdiction: z.nativeEnum(JurisdictionCode),
  commissionExpiration: z.number().int().positive(),
  bondAmount: z.number().positive().optional(),
  insuranceProvider: z.string().optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(10).max(20),
  publicKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40,130}$/)
    .describe("Notary's public key for signature verification"),
});

export const NotarySignatureSchema = z.object({
  notary: NotaryInfoSchema,
  signatureType: z.enum(["ECDSA", "RSA", "ED25519", "SCHNORR"]),
  signatureValue: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .describe("Cryptographic signature bytes"),
  signedDataHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .describe("Hash of the signed data"),
  signingTimestamp: z.number().int().positive(),
  signingLocation: GeoCoordinatesSchema.optional(),
  witnessCount: z.number().int().min(0).max(10),
  witnesses: z
    .array(
      z.object({
        name: z.string(),
        address: z.string(),
        signature: z.string(),
      })
    )
    .optional(),
  certificationStatement: z.string().max(2000),
  sealImageHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});

// ═══════════════════════════════════════════════════════════════
// DOCUMENT HASH SCHEMA
// ═══════════════════════════════════════════════════════════════

export const DocumentHashSchema = z.object({
  documentId: z.string().uuid(),
  documentType: z.nativeEnum(DocumentType),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(100),
  sha256Hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .describe("SHA-256 hash of document content"),
  sha3Hash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .describe("Keccak256 hash of document content"),
  md5Hash: z
    .string()
    .regex(/^[a-fA-F0-9]{32}$/)
    .optional()
    .describe("MD5 hash for legacy compatibility"),
  ipfsHash: z
    .string()
    .regex(/^(Qm|bafy)[a-zA-Z0-9]{44,}$/)
    .describe("IPFS CID"),
  arweaveHash: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{43}$/)
    .describe("Arweave transaction ID"),
  createdAt: z.number().int().positive(),
  lastModified: z.number().int().positive(),
  version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DocumentCollectionSchema = z.object({
  primaryDocument: DocumentHashSchema,
  supportingDocuments: z.array(DocumentHashSchema).max(50),
  totalDocuments: z.number().int().positive(),
  collectionHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .describe("Merkle root of all document hashes"),
  createdAt: z.number().int().positive(),
});

// ═══════════════════════════════════════════════════════════════
// ORACLE VALIDATION SCHEMA
// ═══════════════════════════════════════════════════════════════

export const OracleResponseSchema = z.object({
  oracleSource: z.nativeEnum(OracleSource),
  requestId: z.string().min(1),
  responseTimestamp: z.number().int().positive(),
  dataFeedId: z.string().optional(),
  validationResult: z.boolean(),
  confidenceScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Confidence percentage 0-100"),
  valuationUSD: z.number().nonnegative(),
  valuationTimestamp: z.number().int().positive(),
  proofHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  callbackTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  rawResponse: z.unknown().optional(),
});

export const OracleConsensusSchema = z.object({
  assetId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  requiredSources: z.number().int().min(1).max(10),
  receivedResponses: z.number().int().min(0).max(10),
  consensusReached: z.boolean(),
  consensusThreshold: z.number().min(0.5).max(1).describe("Required agreement ratio"),
  responses: z.array(OracleResponseSchema),
  finalValidation: z.boolean(),
  finalValuation: z.number().nonnegative(),
  valuationVariance: z.number().nonnegative().describe("Standard deviation of valuations"),
  consensusTimestamp: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

// ═══════════════════════════════════════════════════════════════
// ASSET PROOF MASTER SCHEMA
// ═══════════════════════════════════════════════════════════════

export const AssetProofSchema = z.object({
  // Core identification
  proofId: z.string().uuid(),
  assetId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  version: z.nativeEnum(ProofVersion),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),

  // Asset details
  assetType: z.nativeEnum(AssetType),
  assetName: z.string().min(1).max(500),
  assetDescription: z.string().max(5000),
  assetValue: z.object({
    amount: z.number().positive(),
    currency: z.string().length(3).describe("ISO 4217 currency code"),
    valuationDate: z.number().int().positive(),
    valuationMethod: z.enum(["APPRAISAL", "MARKET_COMPARABLE", "INCOME_APPROACH", "COST_APPROACH"]),
    appraiser: z.string().optional(),
    appraisalLicense: z.string().optional(),
  }),

  // AI-GRADE REQUIREMENT: notarySig + docHash + geoStamp + timestamp
  notarization: NotarySignatureSchema,
  documentHashes: DocumentCollectionSchema,
  geoStamp: GeoStampSchema,
  timestamp: z.object({
    submissionTimestamp: z.number().int().positive(),
    notarizationTimestamp: z.number().int().positive(),
    oracleValidationTimestamp: z.number().int().positive(),
    blockTimestamp: z.number().int().positive().optional(),
    blockNumber: z.number().int().positive().optional(),
  }),

  // Jurisdiction and compliance
  jurisdiction: z.nativeEnum(JurisdictionCode),
  complianceFrameworks: z.array(
    z.enum([
      "SEC_REG_D_506B",
      "SEC_REG_D_506C",
      "SEC_REG_S_CAT2",
      "SEC_REG_S_CAT3",
      "EU_MICA",
      "UK_FCA_CRYPTO",
      "SG_MAS_PSA",
      "CH_FINMA_DLT",
      "ADGM_FSRA",
    ])
  ),

  // Oracle validation
  oracleConsensus: OracleConsensusSchema,

  // Storage
  storage: z.object({
    ipfsPrimaryHash: z.string().regex(/^(Qm|bafy)[a-zA-Z0-9]{44,}$/),
    ipfsBackupHashes: z.array(z.string().regex(/^(Qm|bafy)[a-zA-Z0-9]{44,}$/)).max(5),
    arweavePrimaryHash: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
    arweaveBackupHashes: z.array(z.string().regex(/^[a-zA-Z0-9_-]{43}$/)).max(5),
    encryptionMethod: z.enum(["AES-256-GCM", "AES-256-CBC", "CHACHA20-POLY1305", "NONE"]),
    encryptionKeyHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  }),

  // Legal wrapper
  legalWrapper: z
    .object({
      entityType: z.enum(["DELAWARE_LLC", "SWISS_AG", "ADGM_SPV", "WYOMING_DAO", "CAYMAN_EXEMPT", "SINGAPORE_VCC"]),
      entityName: z.string(),
      registrationNumber: z.string(),
      operatingAgreementHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      registeredAgent: z.string(),
    })
    .optional(),

  // Validation status
  validationStatus: z.nativeEnum(ValidationStatus),
  validationErrors: z.array(z.string()).optional(),

  // Immutability proof
  immutabilityProof: z.object({
    merkleRoot: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    merkleProof: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),
    proofIndex: z.number().int().nonnegative(),
    totalLeaves: z.number().int().positive(),
  }),

  // Master hash (hash of entire proof)
  masterHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),

  // Signatures
  submitterSignature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  submitterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

// ═══════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════

export type GeoCoordinates = z.infer<typeof GeoCoordinatesSchema>;
export type GeoStamp = z.infer<typeof GeoStampSchema>;
export type NotaryInfo = z.infer<typeof NotaryInfoSchema>;
export type NotarySignature = z.infer<typeof NotarySignatureSchema>;
export type DocumentHash = z.infer<typeof DocumentHashSchema>;
export type DocumentCollection = z.infer<typeof DocumentCollectionSchema>;
export type OracleResponse = z.infer<typeof OracleResponseSchema>;
export type OracleConsensus = z.infer<typeof OracleConsensusSchema>;
export type AssetProof = z.infer<typeof AssetProofSchema>;

// ═══════════════════════════════════════════════════════════════
// VALIDATION UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Validates an asset proof against the schema
 */
export function validateAssetProof(data: unknown): {
  valid: boolean;
  proof?: AssetProof;
  errors?: z.ZodError;
} {
  const result = AssetProofSchema.safeParse(data);
  if (result.success) {
    return { valid: true, proof: result.data };
  }
  return { valid: false, errors: result.error };
}

/**
 * Validates a geo stamp
 */
export function validateGeoStamp(data: unknown): {
  valid: boolean;
  geoStamp?: GeoStamp;
  errors?: z.ZodError;
} {
  const result = GeoStampSchema.safeParse(data);
  if (result.success) {
    return { valid: true, geoStamp: result.data };
  }
  return { valid: false, errors: result.error };
}

/**
 * Validates notary signature
 */
export function validateNotarySignature(data: unknown): {
  valid: boolean;
  signature?: NotarySignature;
  errors?: z.ZodError;
} {
  const result = NotarySignatureSchema.safeParse(data);
  if (result.success) {
    return { valid: true, signature: result.data };
  }
  return { valid: false, errors: result.error };
}

/**
 * Validates oracle consensus
 */
export function validateOracleConsensus(data: unknown): {
  valid: boolean;
  consensus?: OracleConsensus;
  errors?: z.ZodError;
} {
  const result = OracleConsensusSchema.safeParse(data);
  if (result.success) {
    return { valid: true, consensus: result.data };
  }
  return { valid: false, errors: result.error };
}

// ═══════════════════════════════════════════════════════════════
// HASH COMPUTATION UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Computes the Keccak256 hash of geo stamp data
 */
export function computeGeoStampHash(geoStamp: Omit<GeoStamp, "hash">): string {
  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    ["int256", "int256", "uint256", "string", "string", "string", "string", "uint256"],
    [
      Math.floor(geoStamp.coordinates.latitude * 1e8),
      Math.floor(geoStamp.coordinates.longitude * 1e8),
      geoStamp.coordinates.timestamp,
      geoStamp.addressLine1,
      geoStamp.city,
      geoStamp.countryCode,
      geoStamp.postalCode,
      geoStamp.verificationTimestamp,
    ]
  );
  return ethers.keccak256(data);
}

/**
 * Computes SHA-256 hash of document content
 */
export function computeDocumentSHA256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Computes Keccak256 hash of document content
 */
export function computeDocumentKeccak256(content: Buffer): string {
  return ethers.keccak256(content);
}

/**
 * Computes the master hash of an asset proof
 */
export function computeMasterHash(proof: Omit<AssetProof, "masterHash">): string {
  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "bytes32", "bytes32", "uint256"],
    [
      proof.assetId,
      proof.notarization.signedDataHash,
      proof.documentHashes.collectionHash,
      proof.geoStamp.hash,
      proof.timestamp.submissionTimestamp,
    ]
  );
  return ethers.keccak256(data);
}

/**
 * Computes Merkle root from document hashes
 */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    throw new Error("Cannot compute Merkle root of empty array");
  }
  if (hashes.length === 1) {
    return hashes[0];
  }

  const layer: string[] = [];
  for (let i = 0; i < hashes.length; i += 2) {
    if (i + 1 < hashes.length) {
      const combined = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [hashes[i], hashes[i + 1]]);
      layer.push(combined);
    } else {
      layer.push(hashes[i]);
    }
  }

  return computeMerkleRoot(layer);
}

/**
 * Generates Merkle proof for a specific leaf
 */
export function generateMerkleProof(hashes: string[], index: number): string[] {
  if (index >= hashes.length) {
    throw new Error("Index out of bounds");
  }

  const proof: string[] = [];
  let currentIndex = index;
  let currentHashes = [...hashes];

  while (currentHashes.length > 1) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    if (siblingIndex < currentHashes.length) {
      proof.push(currentHashes[siblingIndex]);
    }

    const newHashes: string[] = [];
    for (let i = 0; i < currentHashes.length; i += 2) {
      if (i + 1 < currentHashes.length) {
        const combined = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [currentHashes[i], currentHashes[i + 1]]);
        newHashes.push(combined);
      } else {
        newHashes.push(currentHashes[i]);
      }
    }

    currentIndex = Math.floor(currentIndex / 2);
    currentHashes = newHashes;
  }

  return proof;
}

// ═══════════════════════════════════════════════════════════════
// SIGNATURE VERIFICATION UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Verifies ECDSA signature from notary
 */
export function verifyNotarySignature(signature: NotarySignature, expectedSigner: string): boolean {
  try {
    if (signature.signatureType !== "ECDSA") {
      console.warn(`Signature type ${signature.signatureType} verification not implemented`);
      return false;
    }

    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(signature.signedDataHash),
      signature.signatureValue
    );

    return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verifies that notary commission is still valid
 */
export function isNotaryCommissionValid(notary: NotaryInfo): boolean {
  const now = Math.floor(Date.now() / 1000);
  return notary.commissionExpiration > now;
}

// ═══════════════════════════════════════════════════════════════
// ORACLE CONSENSUS VERIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Checks if oracle consensus has been reached
 */
export function verifyOracleConsensus(consensus: OracleConsensus): {
  valid: boolean;
  reason?: string;
} {
  // Check if we have enough responses
  if (consensus.receivedResponses < consensus.requiredSources) {
    return {
      valid: false,
      reason: `Insufficient responses: ${consensus.receivedResponses}/${consensus.requiredSources}`,
    };
  }

  // Count positive validations
  const positiveValidations = consensus.responses.filter((r) => r.validationResult).length;
  const requiredPositive = Math.ceil(consensus.receivedResponses * consensus.consensusThreshold);

  if (positiveValidations < requiredPositive) {
    return {
      valid: false,
      reason: `Insufficient consensus: ${positiveValidations}/${requiredPositive} positive validations`,
    };
  }

  // Check if consensus has expired
  const now = Math.floor(Date.now() / 1000);
  if (consensus.expiresAt < now) {
    return {
      valid: false,
      reason: "Consensus has expired",
    };
  }

  // Check valuation variance
  const maxVariancePercent = 0.1; // 10% max variance
  const avgValuation = consensus.finalValuation;
  if (avgValuation > 0 && consensus.valuationVariance / avgValuation > maxVariancePercent) {
    return {
      valid: false,
      reason: `Valuation variance too high: ${((consensus.valuationVariance / avgValuation) * 100).toFixed(2)}%`,
    };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════
// IMMUTABILITY VERIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Verifies that proof data has not been tampered with
 */
export function verifyImmutability(proof: AssetProof): boolean {
  // Recompute master hash
  const computedHash = computeMasterHash(proof);
  if (computedHash !== proof.masterHash) {
    return false;
  }

  // Verify Merkle proof
  const leafHash = proof.documentHashes.collectionHash;
  let currentHash = leafHash;

  for (const sibling of proof.immutabilityProof.merkleProof) {
    // Determine order based on index
    currentHash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [currentHash, sibling]);
  }

  return currentHash === proof.immutabilityProof.merkleRoot;
}

// ═══════════════════════════════════════════════════════════════
// VERSION MIGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Migrates proof from older version to current version
 */
export function migrateProof(oldProof: unknown, fromVersion: ProofVersion): AssetProof | null {
  if (fromVersion === ProofVersion.V2_0) {
    const result = AssetProofSchema.safeParse(oldProof);
    return result.success ? result.data : null;
  }

  // V1.0 -> V2.0 migration
  if (fromVersion === ProofVersion.V1_0 || fromVersion === ProofVersion.V1_1) {
    // Migration logic would go here
    console.warn("Migration from V1.x to V2.0 not implemented");
    return null;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// SERIALIZATION UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Serializes asset proof for blockchain submission
 */
export function serializeForBlockchain(proof: AssetProof): {
  assetId: string;
  documentHash: string;
  ipfsHash: string;
  arweaveHash: string;
  notarySignature: string;
  geoStampHash: string;
  timestamp: number;
  valuationUSD: bigint;
} {
  return {
    assetId: proof.assetId,
    documentHash: proof.documentHashes.collectionHash,
    ipfsHash: proof.storage.ipfsPrimaryHash,
    arweaveHash: proof.storage.arweavePrimaryHash,
    notarySignature: proof.notarization.signatureValue.slice(0, 66), // First 32 bytes
    geoStampHash: proof.geoStamp.hash,
    timestamp: proof.timestamp.submissionTimestamp,
    valuationUSD: BigInt(Math.floor(proof.oracleConsensus.finalValuation * 1e18)),
  };
}

/**
 * Converts proof to JSON for storage
 */
export function serializeToJSON(proof: AssetProof): string {
  return JSON.stringify(proof, null, 2);
}

/**
 * Parses JSON back to AssetProof
 */
export function deserializeFromJSON(json: string): AssetProof | null {
  try {
    const parsed = JSON.parse(json);
    const result = AssetProofSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export default {
  // Schemas
  AssetProofSchema,
  GeoStampSchema,
  NotarySignatureSchema,
  OracleConsensusSchema,
  DocumentHashSchema,
  // Validators
  validateAssetProof,
  validateGeoStamp,
  validateNotarySignature,
  validateOracleConsensus,
  // Hash utilities
  computeGeoStampHash,
  computeDocumentSHA256,
  computeDocumentKeccak256,
  computeMasterHash,
  computeMerkleRoot,
  generateMerkleProof,
  // Verification
  verifyNotarySignature,
  isNotaryCommissionValid,
  verifyOracleConsensus,
  verifyImmutability,
  // Serialization
  serializeForBlockchain,
  serializeToJSON,
  deserializeFromJSON,
  // Enums
  AssetType,
  JurisdictionCode,
  NotaryType,
  DocumentType,
  OracleSource,
  ValidationStatus,
  ProofVersion,
};
