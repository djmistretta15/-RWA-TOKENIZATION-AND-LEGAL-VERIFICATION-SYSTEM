/**
 * @fileoverview Asset Minting Dashboard
 * @module frontend/asset-mint-dashboard
 *
 * Complete asset tokenization workflow including:
 * - Document upload with notarization
 * - Asset proof submission
 * - Legal entity creation/selection
 * - Token issuance configuration
 * - Compliance framework selection
 */

import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AssetInfo {
  name: string;
  description: string;
  type: string;
  valuation: number;
  currency: string;
  valuationMethod: string;
}

interface NotarizationInfo {
  notaryName: string;
  notaryId: string;
  licenseNumber: string;
  jurisdiction: string;
  commissionExpiration: string;
  certificationStatement: string;
}

interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface LegalEntity {
  entityType: string;
  entityName: string;
  registrationNumber: string;
  jurisdiction: string;
  registeredAgent: string;
}

interface ComplianceConfig {
  frameworks: string[];
  kycRequired: boolean;
  accreditationRequired: boolean;
  transferRestrictions: string[];
  lockupPeriod: number;
}

interface TokenConfig {
  symbol: string;
  totalSupply: number;
  partitions: string[];
  decimals: number;
}

interface MintingStatus {
  step: number;
  totalSteps: number;
  currentAction: string;
  progress: number;
  txHash?: string;
  ipfsHash?: string;
  arweaveHash?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const ASSET_TYPES = [
  "REAL_ESTATE",
  "COMMERCIAL_PROPERTY",
  "RESIDENTIAL_PROPERTY",
  "CORPORATE_BOND",
  "PRIVATE_EQUITY",
  "VENTURE_CAPITAL",
  "ART",
  "COLLECTIBLES",
  "INTELLECTUAL_PROPERTY",
];

const JURISDICTIONS = [
  "US_DELAWARE",
  "US_WYOMING",
  "SWISS_ZUG",
  "AE_ADGM",
  "SG_MAS",
  "KY_CIMA",
  "UK_FCA",
];

const COMPLIANCE_FRAMEWORKS = [
  "SEC_REG_D_506B",
  "SEC_REG_D_506C",
  "SEC_REG_S_CAT2",
  "SEC_REG_S_CAT3",
  "EU_MICA",
  "UK_FCA_CRYPTO",
  "SG_MAS_PSA",
];

const ENTITY_TYPES = [
  "DELAWARE_LLC",
  "SWISS_AG",
  "ADGM_SPV",
  "WYOMING_DAO",
  "CAYMAN_EXEMPT",
  "SINGAPORE_VCC",
];

// ═══════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════

const StepIndicator: React.FC<{ currentStep: number; totalSteps: number; stepNames: string[] }> = ({ currentStep, totalSteps, stepNames }) => (
  <div className="step-indicator">
    {stepNames.map((name, index) => (
      <div key={index} className={`step ${index < currentStep ? "completed" : index === currentStep ? "active" : ""}`}>
        <div className="step-number">{index + 1}</div>
        <div className="step-name">{name}</div>
      </div>
    ))}
    <style jsx>{`
      .step-indicator {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2rem;
      }
      .step {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 1;
      }
      .step-number {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
      }
      .step.completed .step-number {
        background: #4caf50;
        color: white;
      }
      .step.active .step-number {
        background: #2196f3;
        color: white;
      }
      .step-name {
        margin-top: 0.5rem;
        font-size: 0.875rem;
        text-align: center;
      }
    `}</style>
  </div>
);

const DocumentUploader: React.FC<{
  onUpload: (files: File[]) => void;
  uploadedFiles: File[];
  maxFiles?: number;
}> = ({ onUpload, uploadedFiles, maxFiles = 10 }) => {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).slice(0, maxFiles - uploadedFiles.length);
      onUpload([...uploadedFiles, ...files]);
    },
    [onUpload, uploadedFiles, maxFiles]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, maxFiles - uploadedFiles.length);
      onUpload([...uploadedFiles, ...files]);
    }
  };

  return (
    <div className="document-uploader">
      <div className="dropzone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        <p>Drag & drop documents here or click to browse</p>
        <input type="file" multiple onChange={handleFileInput} accept=".pdf,.jpg,.jpeg,.png,.tiff" />
      </div>
      <div className="uploaded-files">
        {uploadedFiles.map((file, index) => (
          <div key={index} className="file-item">
            <span>{file.name}</span>
            <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .dropzone {
          border: 2px dashed #ccc;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          border-radius: 8px;
        }
        .dropzone:hover {
          border-color: #2196f3;
        }
        input[type="file"] {
          display: none;
        }
        .uploaded-files {
          margin-top: 1rem;
        }
        .file-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem;
          background: #f5f5f5;
          margin-bottom: 0.5rem;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AssetMintDashboard: React.FC = () => {
  // State
  const [currentStep, setCurrentStep] = useState(0);
  const [assetInfo, setAssetInfo] = useState<AssetInfo>({
    name: "",
    description: "",
    type: "",
    valuation: 0,
    currency: "USD",
    valuationMethod: "APPRAISAL",
  });
  const [documents, setDocuments] = useState<File[]>([]);
  const [notarization, setNotarization] = useState<NotarizationInfo>({
    notaryName: "",
    notaryId: "",
    licenseNumber: "",
    jurisdiction: "",
    commissionExpiration: "",
    certificationStatement: "",
  });
  const [geoLocation, setGeoLocation] = useState<GeoLocation>({
    latitude: 0,
    longitude: 0,
    accuracy: 0,
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  });
  const [legalEntity, setLegalEntity] = useState<LegalEntity>({
    entityType: "",
    entityName: "",
    registrationNumber: "",
    jurisdiction: "",
    registeredAgent: "",
  });
  const [compliance, setCompliance] = useState<ComplianceConfig>({
    frameworks: [],
    kycRequired: true,
    accreditationRequired: true,
    transferRestrictions: ["LOCKUP_PERIOD"],
    lockupPeriod: 365,
  });
  const [tokenConfig, setTokenConfig] = useState<TokenConfig>({
    symbol: "",
    totalSupply: 1000000,
    partitions: ["COMMON"],
    decimals: 18,
  });
  const [mintingStatus, setMintingStatus] = useState<MintingStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");

  const stepNames = [
    "Asset Information",
    "Document Upload",
    "Notarization",
    "Geo-Location",
    "Legal Entity",
    "Compliance",
    "Token Config",
    "Review & Mint",
  ];

  // Effects
  useEffect(() => {
    checkWalletConnection();
  }, []);

  const checkWalletConnection = async () => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
          setIsConnected(true);
          setWalletAddress(accounts[0].address);
        }
      } catch (error) {
        console.error("Wallet check failed:", error);
      }
    }
  };

  const connectWallet = async () => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        setIsConnected(true);
        setWalletAddress(accounts[0]);
      } catch (error) {
        console.error("Wallet connection failed:", error);
      }
    }
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGeoLocation((prev) => ({
            ...prev,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }));
        },
        (error) => console.error("Geolocation error:", error)
      );
    }
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        return !!assetInfo.name && !!assetInfo.type && assetInfo.valuation > 0;
      case 1:
        return documents.length > 0;
      case 2:
        return !!notarization.notaryName && !!notarization.licenseNumber;
      case 3:
        return geoLocation.latitude !== 0 && !!geoLocation.address;
      case 4:
        return !!legalEntity.entityType && !!legalEntity.entityName;
      case 5:
        return compliance.frameworks.length > 0;
      case 6:
        return !!tokenConfig.symbol && tokenConfig.totalSupply > 0;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep) && currentStep < stepNames.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleMint = async () => {
    if (!isConnected) {
      alert("Please connect your wallet first");
      return;
    }

    setMintingStatus({
      step: 1,
      totalSteps: 5,
      currentAction: "Hashing documents...",
      progress: 10,
    });

    // Simulate minting process
    const steps = [
      { action: "Uploading to IPFS...", progress: 30, delay: 2000 },
      { action: "Uploading to Arweave...", progress: 50, delay: 2000 },
      { action: "Submitting to oracle...", progress: 70, delay: 3000 },
      { action: "Minting tokens...", progress: 90, delay: 3000 },
      { action: "Complete!", progress: 100, delay: 1000 },
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, steps[i].delay));
      setMintingStatus((prev) => ({
        ...prev!,
        step: i + 2,
        currentAction: steps[i].action,
        progress: steps[i].progress,
        ipfsHash: i >= 1 ? `Qm${Math.random().toString(36).slice(2, 48)}` : prev?.ipfsHash,
        arweaveHash: i >= 2 ? Math.random().toString(36).slice(2, 45) : prev?.arweaveHash,
        txHash: i >= 4 ? `0x${Math.random().toString(16).slice(2, 66)}` : prev?.txHash,
      }));
    }
  };

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="step-content">
            <h3>Asset Information</h3>
            <div className="form-group">
              <label>Asset Name</label>
              <input
                type="text"
                value={assetInfo.name}
                onChange={(e) => setAssetInfo({ ...assetInfo, name: e.target.value })}
                placeholder="e.g., Manhattan Office Tower"
              />
            </div>
            <div className="form-group">
              <label>Asset Type</label>
              <select value={assetInfo.type} onChange={(e) => setAssetInfo({ ...assetInfo, type: e.target.value })}>
                <option value="">Select type...</option>
                {ASSET_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={assetInfo.description}
                onChange={(e) => setAssetInfo({ ...assetInfo, description: e.target.value })}
                rows={4}
                placeholder="Detailed description of the asset..."
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Valuation</label>
                <input
                  type="number"
                  value={assetInfo.valuation}
                  onChange={(e) => setAssetInfo({ ...assetInfo, valuation: Number(e.target.value) })}
                  placeholder="1000000"
                />
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select value={assetInfo.currency} onChange={(e) => setAssetInfo({ ...assetInfo, currency: e.target.value })}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="step-content">
            <h3>Document Upload</h3>
            <p>Upload notarized documents proving asset ownership (deeds, titles, certificates, appraisals).</p>
            <DocumentUploader onUpload={setDocuments} uploadedFiles={documents} />
            <div className="info-box">
              <strong>Required Documents:</strong>
              <ul>
                <li>Primary ownership document (deed, title, certificate)</li>
                <li>Recent appraisal report (within 6 months)</li>
                <li>Legal opinion letter</li>
                <li>Insurance policy</li>
              </ul>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="step-content">
            <h3>Notarization Details</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Notary Name</label>
                <input
                  type="text"
                  value={notarization.notaryName}
                  onChange={(e) => setNotarization({ ...notarization, notaryName: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Notary ID</label>
                <input
                  type="text"
                  value={notarization.notaryId}
                  onChange={(e) => setNotarization({ ...notarization, notaryId: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>License Number</label>
                <input
                  type="text"
                  value={notarization.licenseNumber}
                  onChange={(e) => setNotarization({ ...notarization, licenseNumber: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Jurisdiction</label>
                <select
                  value={notarization.jurisdiction}
                  onChange={(e) => setNotarization({ ...notarization, jurisdiction: e.target.value })}
                >
                  <option value="">Select...</option>
                  {JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>
                      {j.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Commission Expiration</label>
              <input
                type="date"
                value={notarization.commissionExpiration}
                onChange={(e) => setNotarization({ ...notarization, commissionExpiration: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Certification Statement</label>
              <textarea
                value={notarization.certificationStatement}
                onChange={(e) => setNotarization({ ...notarization, certificationStatement: e.target.value })}
                rows={3}
                placeholder="I certify that the above documents have been verified..."
              />
            </div>
          </div>
        );

      case 3:
        return (
          <div className="step-content">
            <h3>Asset Geo-Location</h3>
            <button onClick={getCurrentLocation} className="btn-secondary">
              Get Current Location
            </button>
            <div className="form-row">
              <div className="form-group">
                <label>Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  value={geoLocation.latitude}
                  onChange={(e) => setGeoLocation({ ...geoLocation, latitude: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label>Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  value={geoLocation.longitude}
                  onChange={(e) => setGeoLocation({ ...geoLocation, longitude: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Street Address</label>
              <input
                type="text"
                value={geoLocation.address}
                onChange={(e) => setGeoLocation({ ...geoLocation, address: e.target.value })}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>City</label>
                <input type="text" value={geoLocation.city} onChange={(e) => setGeoLocation({ ...geoLocation, city: e.target.value })} />
              </div>
              <div className="form-group">
                <label>State/Province</label>
                <input type="text" value={geoLocation.state} onChange={(e) => setGeoLocation({ ...geoLocation, state: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Postal Code</label>
                <input
                  type="text"
                  value={geoLocation.postalCode}
                  onChange={(e) => setGeoLocation({ ...geoLocation, postalCode: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Country</label>
                <input type="text" value={geoLocation.country} onChange={(e) => setGeoLocation({ ...geoLocation, country: e.target.value })} />
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="step-content">
            <h3>Legal Entity Structure</h3>
            <div className="form-group">
              <label>Entity Type</label>
              <select value={legalEntity.entityType} onChange={(e) => setLegalEntity({ ...legalEntity, entityType: e.target.value })}>
                <option value="">Select type...</option>
                {ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Entity Name</label>
              <input
                type="text"
                value={legalEntity.entityName}
                onChange={(e) => setLegalEntity({ ...legalEntity, entityName: e.target.value })}
                placeholder="e.g., Asset Holdings LLC"
              />
            </div>
            <div className="form-group">
              <label>Registration Number</label>
              <input
                type="text"
                value={legalEntity.registrationNumber}
                onChange={(e) => setLegalEntity({ ...legalEntity, registrationNumber: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Jurisdiction</label>
              <select value={legalEntity.jurisdiction} onChange={(e) => setLegalEntity({ ...legalEntity, jurisdiction: e.target.value })}>
                <option value="">Select...</option>
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Registered Agent</label>
              <input
                type="text"
                value={legalEntity.registeredAgent}
                onChange={(e) => setLegalEntity({ ...legalEntity, registeredAgent: e.target.value })}
              />
            </div>
          </div>
        );

      case 5:
        return (
          <div className="step-content">
            <h3>Compliance Configuration</h3>
            <div className="form-group">
              <label>Compliance Frameworks</label>
              <div className="checkbox-group">
                {COMPLIANCE_FRAMEWORKS.map((framework) => (
                  <label key={framework} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={compliance.frameworks.includes(framework)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCompliance({ ...compliance, frameworks: [...compliance.frameworks, framework] });
                        } else {
                          setCompliance({ ...compliance, frameworks: compliance.frameworks.filter((f) => f !== framework) });
                        }
                      }}
                    />
                    {framework.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={compliance.kycRequired}
                    onChange={(e) => setCompliance({ ...compliance, kycRequired: e.target.checked })}
                  />
                  Require KYC/AML Verification
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={compliance.accreditationRequired}
                    onChange={(e) => setCompliance({ ...compliance, accreditationRequired: e.target.checked })}
                  />
                  Require Accreditation
                </label>
              </div>
            </div>
            <div className="form-group">
              <label>Lockup Period (days)</label>
              <input
                type="number"
                value={compliance.lockupPeriod}
                onChange={(e) => setCompliance({ ...compliance, lockupPeriod: Number(e.target.value) })}
              />
            </div>
          </div>
        );

      case 6:
        return (
          <div className="step-content">
            <h3>Token Configuration</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Token Symbol</label>
                <input
                  type="text"
                  value={tokenConfig.symbol}
                  onChange={(e) => setTokenConfig({ ...tokenConfig, symbol: e.target.value.toUpperCase() })}
                  placeholder="e.g., RWA-NYC-01"
                  maxLength={12}
                />
              </div>
              <div className="form-group">
                <label>Total Supply</label>
                <input
                  type="number"
                  value={tokenConfig.totalSupply}
                  onChange={(e) => setTokenConfig({ ...tokenConfig, totalSupply: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Decimals</label>
              <select value={tokenConfig.decimals} onChange={(e) => setTokenConfig({ ...tokenConfig, decimals: Number(e.target.value) })}>
                <option value={0}>0 (Whole tokens only)</option>
                <option value={6}>6</option>
                <option value={18}>18 (Standard)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Share Classes (Partitions)</label>
              <div className="checkbox-group">
                {["COMMON", "PREFERRED", "RESTRICTED"].map((partition) => (
                  <label key={partition} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={tokenConfig.partitions.includes(partition)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setTokenConfig({ ...tokenConfig, partitions: [...tokenConfig.partitions, partition] });
                        } else {
                          setTokenConfig({ ...tokenConfig, partitions: tokenConfig.partitions.filter((p) => p !== partition) });
                        }
                      }}
                    />
                    {partition}
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 7:
        return (
          <div className="step-content">
            <h3>Review & Mint</h3>
            {mintingStatus ? (
              <div className="minting-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${mintingStatus.progress}%` }}></div>
                </div>
                <p className="status-text">{mintingStatus.currentAction}</p>
                {mintingStatus.ipfsHash && <p>IPFS Hash: {mintingStatus.ipfsHash}</p>}
                {mintingStatus.arweaveHash && <p>Arweave Hash: {mintingStatus.arweaveHash}</p>}
                {mintingStatus.txHash && <p>Transaction: {mintingStatus.txHash}</p>}
              </div>
            ) : (
              <div className="review-summary">
                <div className="summary-section">
                  <h4>Asset</h4>
                  <p>
                    <strong>{assetInfo.name}</strong> ({assetInfo.type.replace(/_/g, " ")})
                  </p>
                  <p>
                    Valuation: {assetInfo.currency} {assetInfo.valuation.toLocaleString()}
                  </p>
                </div>
                <div className="summary-section">
                  <h4>Documents</h4>
                  <p>{documents.length} documents uploaded</p>
                </div>
                <div className="summary-section">
                  <h4>Legal Entity</h4>
                  <p>
                    {legalEntity.entityName} ({legalEntity.entityType.replace(/_/g, " ")})
                  </p>
                </div>
                <div className="summary-section">
                  <h4>Token</h4>
                  <p>
                    {tokenConfig.symbol} - {tokenConfig.totalSupply.toLocaleString()} tokens
                  </p>
                </div>
                <div className="summary-section">
                  <h4>Compliance</h4>
                  <p>{compliance.frameworks.map((f) => f.replace(/_/g, " ")).join(", ")}</p>
                </div>
                <button onClick={handleMint} className="btn-primary btn-large">
                  Mint Asset Token
                </button>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="asset-mint-dashboard">
      <header className="dashboard-header">
        <h1>Asset Tokenization Dashboard</h1>
        <div className="wallet-status">
          {isConnected ? (
            <span className="connected">
              Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </span>
          ) : (
            <button onClick={connectWallet} className="btn-connect">
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <StepIndicator currentStep={currentStep} totalSteps={stepNames.length} stepNames={stepNames} />

      <main className="dashboard-content">{renderStepContent()}</main>

      <footer className="dashboard-footer">
        <button onClick={handleBack} disabled={currentStep === 0} className="btn-secondary">
          Back
        </button>
        {currentStep < stepNames.length - 1 && (
          <button onClick={handleNext} disabled={!validateStep(currentStep)} className="btn-primary">
            Next
          </button>
        )}
      </footer>

      <style jsx>{`
        .asset-mint-dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }
        .dashboard-content {
          background: white;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          min-height: 400px;
        }
        .dashboard-footer {
          display: flex;
          justify-content: space-between;
          margin-top: 2rem;
        }
        .form-group {
          margin-bottom: 1rem;
        }
        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
        }
        .form-group input,
        .form-group select,
        .form-group textarea {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 1rem;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .btn-primary {
          background: #2196f3;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
        }
        .btn-primary:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: #f5f5f5;
          border: 1px solid #ccc;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-large {
          padding: 1rem 2rem;
          font-size: 1.125rem;
        }
        .btn-connect {
          background: #4caf50;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .connected {
          color: #4caf50;
          font-weight: 500;
        }
        .checkbox-group {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 0.5rem;
        }
        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
        }
        .info-box {
          background: #e3f2fd;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }
        .progress-bar {
          width: 100%;
          height: 20px;
          background: #e0e0e0;
          border-radius: 10px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #4caf50;
          transition: width 0.3s ease;
        }
        .status-text {
          text-align: center;
          margin-top: 1rem;
          font-weight: 500;
        }
        .review-summary {
          display: grid;
          gap: 1rem;
        }
        .summary-section {
          background: #f5f5f5;
          padding: 1rem;
          border-radius: 4px;
        }
        .summary-section h4 {
          margin: 0 0 0.5rem 0;
          color: #666;
        }
      `}</style>
    </div>
  );
};

export default AssetMintDashboard;
