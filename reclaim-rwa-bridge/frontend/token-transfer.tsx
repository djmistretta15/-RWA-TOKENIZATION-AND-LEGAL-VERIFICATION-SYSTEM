/**
 * @fileoverview Compliant Token Transfer Interface
 * @module frontend/token-transfer
 *
 * Features:
 * - Transfer validation preview with compliance checks
 * - Real-time compliance status indicators
 * - Transfer execution with multi-sig support
 * - Transaction history and tracking
 * - Partition-based transfers
 */

import React, { useState, useEffect } from "react";
import { ethers } from "ethers";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface TransferRequest {
  from: string;
  to: string;
  amount: string;
  partition: string;
  memo?: string;
}

interface ComplianceCheck {
  name: string;
  status: "PASS" | "FAIL" | "PENDING" | "WARNING";
  message: string;
  critical: boolean;
}

interface TransferPreview {
  isValid: boolean;
  complianceChecks: ComplianceCheck[];
  estimatedGas: string;
  warnings: string[];
  errors: string[];
}

interface TransactionRecord {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  partition: string;
  timestamp: number;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  blockNumber?: number;
}

interface TokenBalance {
  partition: string;
  balance: string;
  lockedAmount: string;
  availableAmount: string;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════

const ComplianceStatusBadge: React.FC<{ status: ComplianceCheck["status"] }> = ({ status }) => {
  const colors = {
    PASS: { bg: "#c8e6c9", text: "#2e7d32" },
    FAIL: { bg: "#ffcdd2", text: "#c62828" },
    PENDING: { bg: "#fff3e0", text: "#ef6c00" },
    WARNING: { bg: "#fff9c4", text: "#f9a825" },
  };

  return (
    <span
      className="status-badge"
      style={{ backgroundColor: colors[status].bg, color: colors[status].text }}
    >
      {status}
    </span>
  );
};

const TransactionHistoryItem: React.FC<{ tx: TransactionRecord }> = ({ tx }) => (
  <div className="tx-item">
    <div className="tx-header">
      <span className={`tx-status ${tx.status.toLowerCase()}`}>{tx.status}</span>
      <span className="tx-time">{new Date(tx.timestamp).toLocaleString()}</span>
    </div>
    <div className="tx-details">
      <p>
        <strong>Hash:</strong> {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-8)}
      </p>
      <p>
        <strong>Amount:</strong> {tx.amount} ({tx.partition})
      </p>
      <p>
        <strong>To:</strong> {tx.to.slice(0, 10)}...{tx.to.slice(-8)}
      </p>
    </div>
    <style jsx>{`
      .tx-item {
        background: #f5f5f5;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
      }
      .tx-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }
      .tx-status {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: bold;
      }
      .tx-status.confirmed {
        background: #c8e6c9;
        color: #2e7d32;
      }
      .tx-status.pending {
        background: #fff3e0;
        color: #ef6c00;
      }
      .tx-status.failed {
        background: #ffcdd2;
        color: #c62828;
      }
      .tx-time {
        color: #666;
        font-size: 0.875rem;
      }
      .tx-details p {
        margin: 0.25rem 0;
        font-size: 0.875rem;
      }
    `}</style>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export const TokenTransferDashboard: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [transferRequest, setTransferRequest] = useState<TransferRequest>({
    from: "",
    to: "",
    amount: "",
    partition: "COMMON",
    memo: "",
  });
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"transfer" | "history">("transfer");

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    if (walletAddress) {
      setTransferRequest((prev) => ({ ...prev, from: walletAddress }));
      loadBalances();
      loadTransactionHistory();
    }
  }, [walletAddress]);

  const checkConnection = async () => {
    if ((window as any).ethereum) {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const accounts = await provider.listAccounts();
      if (accounts.length > 0) {
        setIsConnected(true);
        setWalletAddress(accounts[0].address);
      }
    }
  };

  const connectWallet = async () => {
    if ((window as any).ethereum) {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setIsConnected(true);
      setWalletAddress(accounts[0]);
    }
  };

  const loadBalances = () => {
    // Mock balances
    setBalances([
      { partition: "COMMON", balance: "10000", lockedAmount: "2000", availableAmount: "8000" },
      { partition: "PREFERRED", balance: "5000", lockedAmount: "0", availableAmount: "5000" },
    ]);
  };

  const loadTransactionHistory = () => {
    // Mock transaction history
    setTransactions([
      {
        txHash: "0x" + "a".repeat(64),
        from: walletAddress,
        to: "0x" + "b".repeat(40),
        amount: "1000",
        partition: "COMMON",
        timestamp: Date.now() - 86400000,
        status: "CONFIRMED",
        blockNumber: 12345678,
      },
      {
        txHash: "0x" + "c".repeat(64),
        from: walletAddress,
        to: "0x" + "d".repeat(40),
        amount: "500",
        partition: "COMMON",
        timestamp: Date.now() - 172800000,
        status: "CONFIRMED",
        blockNumber: 12345600,
      },
    ]);
  };

  const validateTransfer = async () => {
    if (!transferRequest.to || !transferRequest.amount) {
      return;
    }

    setIsValidating(true);

    // Simulate compliance validation
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const checks: ComplianceCheck[] = [
      {
        name: "Sender KYC Status",
        status: "PASS",
        message: "KYC verified and current",
        critical: true,
      },
      {
        name: "Recipient KYC Status",
        status: "PASS",
        message: "KYC verified and current",
        critical: true,
      },
      {
        name: "Recipient Accreditation",
        status: "PASS",
        message: "Accredited investor verified",
        critical: true,
      },
      {
        name: "Sanctions Screening",
        status: "PASS",
        message: "Not on OFAC/UN/EU sanctions list",
        critical: true,
      },
      {
        name: "Transfer Limit",
        status: Number(transferRequest.amount) > 5000 ? "WARNING" : "PASS",
        message: Number(transferRequest.amount) > 5000 ? "Large transfer may require additional approval" : "Within transfer limits",
        critical: false,
      },
      {
        name: "Lockup Period",
        status: "PASS",
        message: "No active lockup restrictions",
        critical: true,
      },
      {
        name: "Available Balance",
        status: Number(transferRequest.amount) <= 8000 ? "PASS" : "FAIL",
        message: Number(transferRequest.amount) <= 8000 ? "Sufficient balance available" : "Insufficient available balance",
        critical: true,
      },
      {
        name: "Partition Compatibility",
        status: "PASS",
        message: "Recipient can hold this partition type",
        critical: true,
      },
    ];

    const errors = checks.filter((c) => c.status === "FAIL" && c.critical).map((c) => c.message);
    const warnings = checks.filter((c) => c.status === "WARNING").map((c) => c.message);

    setPreview({
      isValid: errors.length === 0,
      complianceChecks: checks,
      estimatedGas: "0.005 ETH",
      warnings,
      errors,
    });

    setIsValidating(false);
  };

  const executeTransfer = async () => {
    if (!preview?.isValid) return;

    setIsExecuting(true);

    // Simulate transfer execution
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const newTx: TransactionRecord = {
      txHash: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, "0"),
      from: transferRequest.from,
      to: transferRequest.to,
      amount: transferRequest.amount,
      partition: transferRequest.partition,
      timestamp: Date.now(),
      status: "PENDING",
    };

    setTransactions([newTx, ...transactions]);

    // Simulate confirmation
    setTimeout(() => {
      setTransactions((prev) =>
        prev.map((tx) => (tx.txHash === newTx.txHash ? { ...tx, status: "CONFIRMED", blockNumber: 12345700 } : tx))
      );
    }, 5000);

    setIsExecuting(false);
    setPreview(null);
    setTransferRequest({ from: walletAddress, to: "", amount: "", partition: "COMMON", memo: "" });
    alert("Transfer submitted successfully!");
  };

  return (
    <div className="transfer-dashboard">
      <header className="dashboard-header">
        <h1>Token Transfer</h1>
        <div className="wallet-info">
          {isConnected ? (
            <span className="connected">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </span>
          ) : (
            <button onClick={connectWallet} className="btn-connect">
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {isConnected && (
        <>
          <div className="balance-cards">
            {balances.map((balance) => (
              <div key={balance.partition} className="balance-card">
                <h3>{balance.partition}</h3>
                <p className="total">Total: {balance.balance}</p>
                <p className="available">Available: {balance.availableAmount}</p>
                <p className="locked">Locked: {balance.lockedAmount}</p>
              </div>
            ))}
          </div>

          <div className="tabs">
            <button className={activeTab === "transfer" ? "active" : ""} onClick={() => setActiveTab("transfer")}>
              New Transfer
            </button>
            <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
              History
            </button>
          </div>

          {activeTab === "transfer" && (
            <div className="transfer-form">
              <div className="form-section">
                <h3>Transfer Details</h3>
                <div className="form-group">
                  <label>Recipient Address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={transferRequest.to}
                    onChange={(e) => setTransferRequest({ ...transferRequest, to: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Amount</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={transferRequest.amount}
                      onChange={(e) => setTransferRequest({ ...transferRequest, amount: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Partition</label>
                    <select
                      value={transferRequest.partition}
                      onChange={(e) => setTransferRequest({ ...transferRequest, partition: e.target.value })}
                    >
                      <option value="COMMON">COMMON</option>
                      <option value="PREFERRED">PREFERRED</option>
                      <option value="RESTRICTED">RESTRICTED</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Memo (optional)</label>
                  <input
                    type="text"
                    placeholder="Transfer reason..."
                    value={transferRequest.memo}
                    onChange={(e) => setTransferRequest({ ...transferRequest, memo: e.target.value })}
                  />
                </div>
                <button
                  className="btn-validate"
                  onClick={validateTransfer}
                  disabled={!transferRequest.to || !transferRequest.amount || isValidating}
                >
                  {isValidating ? "Validating..." : "Validate Transfer"}
                </button>
              </div>

              {preview && (
                <div className="preview-section">
                  <h3>Compliance Validation</h3>
                  <div className="compliance-checks">
                    {preview.complianceChecks.map((check, index) => (
                      <div key={index} className="check-item">
                        <div className="check-header">
                          <span className="check-name">{check.name}</span>
                          <ComplianceStatusBadge status={check.status} />
                        </div>
                        <p className="check-message">{check.message}</p>
                      </div>
                    ))}
                  </div>

                  {preview.warnings.length > 0 && (
                    <div className="warnings">
                      <h4>Warnings</h4>
                      {preview.warnings.map((w, i) => (
                        <p key={i}>⚠️ {w}</p>
                      ))}
                    </div>
                  )}

                  {preview.errors.length > 0 && (
                    <div className="errors">
                      <h4>Errors</h4>
                      {preview.errors.map((e, i) => (
                        <p key={i}>❌ {e}</p>
                      ))}
                    </div>
                  )}

                  <div className="gas-estimate">
                    <strong>Estimated Gas:</strong> {preview.estimatedGas}
                  </div>

                  <button className="btn-execute" onClick={executeTransfer} disabled={!preview.isValid || isExecuting}>
                    {isExecuting ? "Executing..." : "Execute Transfer"}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "history" && (
            <div className="history-section">
              <h3>Transaction History</h3>
              {transactions.length === 0 ? (
                <p>No transactions yet</p>
              ) : (
                transactions.map((tx) => <TransactionHistoryItem key={tx.txHash} tx={tx} />)
              )}
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .transfer-dashboard {
          max-width: 1000px;
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
        .btn-connect {
          background: #4caf50;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .connected {
          background: #e8f5e9;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          color: #2e7d32;
        }
        .balance-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .balance-card {
          background: #fff;
          padding: 1rem;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .balance-card h3 {
          margin: 0 0 0.5rem 0;
          color: #333;
        }
        .balance-card .total {
          font-size: 1.5rem;
          font-weight: bold;
          margin: 0.5rem 0;
        }
        .balance-card .available {
          color: #4caf50;
          margin: 0.25rem 0;
        }
        .balance-card .locked {
          color: #ff9800;
          margin: 0.25rem 0;
        }
        .tabs {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
        }
        .tabs button {
          padding: 0.75rem 1.5rem;
          background: #e0e0e0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .tabs button.active {
          background: #2196f3;
          color: white;
        }
        .transfer-form,
        .history-section {
          background: white;
          padding: 1.5rem;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .form-section {
          margin-bottom: 2rem;
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
        .form-group select {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .btn-validate,
        .btn-execute {
          width: 100%;
          padding: 0.75rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
          font-weight: 500;
        }
        .btn-validate {
          background: #ff9800;
          color: white;
        }
        .btn-execute {
          background: #4caf50;
          color: white;
          margin-top: 1rem;
        }
        .btn-validate:disabled,
        .btn-execute:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .preview-section {
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid #e0e0e0;
        }
        .compliance-checks {
          display: grid;
          gap: 0.75rem;
        }
        .check-item {
          background: #f5f5f5;
          padding: 0.75rem;
          border-radius: 4px;
        }
        .check-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }
        .check-name {
          font-weight: 500;
        }
        .check-message {
          margin: 0;
          font-size: 0.875rem;
          color: #666;
        }
        .status-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: bold;
        }
        .warnings {
          background: #fff3e0;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }
        .errors {
          background: #ffebee;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }
        .gas-estimate {
          margin-top: 1rem;
          padding: 0.75rem;
          background: #e3f2fd;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default TokenTransferDashboard;
