/**
 * @fileoverview Regulatory Compliance Administration Dashboard
 * @module frontend/compliance-admin
 *
 * Features:
 * - Investor registry management
 * - KYC/AML status monitoring
 * - Compliance monitoring and alerts
 * - Regulatory reporting tools
 * - Whitelist management
 * - Transfer restriction controls
 */

import React, { useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface Investor {
  address: string;
  legalName: string;
  email: string;
  jurisdiction: string;
  kycStatus: "VERIFIED" | "PENDING" | "EXPIRED" | "REJECTED";
  amlStatus: "CLEAR" | "FLAGGED" | "UNDER_REVIEW";
  accreditationStatus: "ACCREDITED" | "NON_ACCREDITED" | "QUALIFIED_PURCHASER" | "QUALIFIED_CLIENT";
  whitelisted: boolean;
  investmentLimit: number;
  totalInvested: number;
  lastKycUpdate: number;
  registeredAt: number;
  restrictions: string[];
  notes: string;
}

interface ComplianceAlert {
  id: string;
  type: "KYC_EXPIRING" | "AML_FLAG" | "LIMIT_BREACH" | "SANCTIONS_HIT" | "JURISDICTION_ISSUE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  investorAddress: string;
  message: string;
  createdAt: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
}

interface TransferRestriction {
  id: string;
  name: string;
  type: "LOCKUP" | "VOLUME_LIMIT" | "JURISDICTION" | "ACCREDITATION" | "CUSTOM";
  active: boolean;
  parameters: Record<string, any>;
  affectedInvestors: number;
}

interface RegulatoryReport {
  id: string;
  type: "FORM_D" | "BLUE_SKY" | "K1" | "AUDIT" | "QUARTERLY";
  status: "DRAFT" | "PENDING_REVIEW" | "SUBMITTED" | "ACCEPTED";
  period: string;
  generatedAt: number;
  submittedAt?: number;
  deadline: number;
}

interface ComplianceMetrics {
  totalInvestors: number;
  verifiedKyc: number;
  pendingKyc: number;
  expiredKyc: number;
  accreditedInvestors: number;
  activeAlerts: number;
  criticalAlerts: number;
  complianceScore: number;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════

const MetricCard: React.FC<{ label: string; value: string | number; trend?: "up" | "down" | "neutral" }> = ({
  label,
  value,
  trend,
}) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">
      {value}
      {trend && (
        <span className={`trend ${trend}`}>{trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}</span>
      )}
    </div>
    <style jsx>{`
      .metric-card {
        background: white;
        padding: 1.5rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .metric-label {
        color: #666;
        font-size: 0.875rem;
        margin-bottom: 0.5rem;
      }
      .metric-value {
        font-size: 2rem;
        font-weight: bold;
        color: #333;
      }
      .trend {
        font-size: 1rem;
        margin-left: 0.5rem;
      }
      .trend.up {
        color: #4caf50;
      }
      .trend.down {
        color: #f44336;
      }
      .trend.neutral {
        color: #ff9800;
      }
    `}</style>
  </div>
);

const AlertBadge: React.FC<{ severity: ComplianceAlert["severity"] }> = ({ severity }) => {
  const colors = {
    LOW: "#4caf50",
    MEDIUM: "#ff9800",
    HIGH: "#f44336",
    CRITICAL: "#9c27b0",
  };
  return (
    <span
      className="alert-badge"
      style={{ backgroundColor: colors[severity], color: "white" }}
    >
      {severity}
    </span>
  );
};

const StatusBadge: React.FC<{ status: string; type?: "kyc" | "aml" | "accreditation" }> = ({ status }) => {
  const getColor = () => {
    if (status === "VERIFIED" || status === "CLEAR" || status === "ACCREDITED") return "#4caf50";
    if (status === "PENDING" || status === "UNDER_REVIEW") return "#ff9800";
    if (status === "REJECTED" || status === "FLAGGED" || status === "EXPIRED") return "#f44336";
    return "#9e9e9e";
  };

  return (
    <span className="status-badge" style={{ backgroundColor: getColor(), color: "white" }}>
      {status.replace(/_/g, " ")}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export const ComplianceAdminDashboard: React.FC = () => {
  // State
  const [activeTab, setActiveTab] = useState<"overview" | "investors" | "alerts" | "restrictions" | "reports">("overview");
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [restrictions, setRestrictions] = useState<TransferRestriction[]>([]);
  const [reports, setReports] = useState<RegulatoryReport[]>([]);
  const [metrics, setMetrics] = useState<ComplianceMetrics>({
    totalInvestors: 0,
    verifiedKyc: 0,
    pendingKyc: 0,
    expiredKyc: 0,
    accreditedInvestors: 0,
    activeAlerts: 0,
    criticalAlerts: 0,
    complianceScore: 0,
  });
  const [selectedInvestor, setSelectedInvestor] = useState<Investor | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterKycStatus, setFilterKycStatus] = useState<string>("ALL");
  const [showAddInvestorModal, setShowAddInvestorModal] = useState(false);

  // Load initial data
  useEffect(() => {
    loadInvestors();
    loadAlerts();
    loadRestrictions();
    loadReports();
    calculateMetrics();
  }, []);

  const loadInvestors = () => {
    // Mock investor data
    const mockInvestors: Investor[] = Array.from({ length: 15 }, (_, i) => ({
      address: `0x${(i + 1).toString().padStart(40, "0")}`,
      legalName: `Investor ${i + 1} Corp`,
      email: `investor${i + 1}@example.com`,
      jurisdiction: ["US-DE", "US-NY", "CH-ZG", "SG-MAS", "UK-FCA"][i % 5],
      kycStatus: (["VERIFIED", "PENDING", "EXPIRED", "VERIFIED"] as const)[i % 4],
      amlStatus: (["CLEAR", "CLEAR", "FLAGGED", "CLEAR"] as const)[i % 4],
      accreditationStatus: (["ACCREDITED", "QUALIFIED_PURCHASER", "NON_ACCREDITED", "ACCREDITED"] as const)[i % 4],
      whitelisted: i % 3 !== 0,
      investmentLimit: 1000000 + i * 100000,
      totalInvested: 500000 + i * 50000,
      lastKycUpdate: Date.now() - i * 86400000 * 30,
      registeredAt: Date.now() - i * 86400000 * 60,
      restrictions: i % 5 === 0 ? ["LOCKUP_ACTIVE"] : [],
      notes: "",
    }));
    setInvestors(mockInvestors);
  };

  const loadAlerts = () => {
    const mockAlerts: ComplianceAlert[] = [
      {
        id: "alert-1",
        type: "KYC_EXPIRING",
        severity: "MEDIUM",
        investorAddress: "0x1234...",
        message: "KYC documentation expiring in 30 days",
        createdAt: Date.now() - 86400000,
        resolved: false,
      },
      {
        id: "alert-2",
        type: "AML_FLAG",
        severity: "HIGH",
        investorAddress: "0x5678...",
        message: "Suspicious transaction pattern detected",
        createdAt: Date.now() - 172800000,
        resolved: false,
      },
      {
        id: "alert-3",
        type: "LIMIT_BREACH",
        severity: "CRITICAL",
        investorAddress: "0x9abc...",
        message: "Investment limit exceeded by 15%",
        createdAt: Date.now() - 3600000,
        resolved: false,
      },
      {
        id: "alert-4",
        type: "SANCTIONS_HIT",
        severity: "CRITICAL",
        investorAddress: "0xdef0...",
        message: "Address matched OFAC SDN list",
        createdAt: Date.now() - 7200000,
        resolved: false,
      },
    ];
    setAlerts(mockAlerts);
  };

  const loadRestrictions = () => {
    const mockRestrictions: TransferRestriction[] = [
      {
        id: "rest-1",
        name: "12-Month Lockup",
        type: "LOCKUP",
        active: true,
        parameters: { duration: 365, exemptions: ["death", "disability"] },
        affectedInvestors: 45,
      },
      {
        id: "rest-2",
        name: "Accredited Only",
        type: "ACCREDITATION",
        active: true,
        parameters: { requiredStatus: "ACCREDITED" },
        affectedInvestors: 120,
      },
      {
        id: "rest-3",
        name: "US Jurisdiction",
        type: "JURISDICTION",
        active: true,
        parameters: { blockedCountries: ["CU", "IR", "KP", "SY"] },
        affectedInvestors: 0,
      },
      {
        id: "rest-4",
        name: "Daily Volume Limit",
        type: "VOLUME_LIMIT",
        active: true,
        parameters: { maxDailyVolume: 5000000, maxSingleTransfer: 1000000 },
        affectedInvestors: 15,
      },
    ];
    setRestrictions(mockRestrictions);
  };

  const loadReports = () => {
    const mockReports: RegulatoryReport[] = [
      {
        id: "report-1",
        type: "FORM_D",
        status: "SUBMITTED",
        period: "2024",
        generatedAt: Date.now() - 2592000000,
        submittedAt: Date.now() - 2592000000,
        deadline: Date.now() - 1728000000,
      },
      {
        id: "report-2",
        type: "QUARTERLY",
        status: "PENDING_REVIEW",
        period: "Q1 2024",
        generatedAt: Date.now() - 86400000,
        deadline: Date.now() + 604800000,
      },
      {
        id: "report-3",
        type: "K1",
        status: "DRAFT",
        period: "2023",
        generatedAt: Date.now(),
        deadline: Date.now() + 2592000000,
      },
    ];
    setReports(mockReports);
  };

  const calculateMetrics = () => {
    const verifiedCount = investors.filter((i) => i.kycStatus === "VERIFIED").length;
    const pendingCount = investors.filter((i) => i.kycStatus === "PENDING").length;
    const expiredCount = investors.filter((i) => i.kycStatus === "EXPIRED").length;
    const accreditedCount = investors.filter(
      (i) => i.accreditationStatus === "ACCREDITED" || i.accreditationStatus === "QUALIFIED_PURCHASER"
    ).length;
    const activeAlertCount = alerts.filter((a) => !a.resolved).length;
    const criticalAlertCount = alerts.filter((a) => !a.resolved && a.severity === "CRITICAL").length;

    const complianceScore = Math.round(
      ((verifiedCount / Math.max(investors.length, 1)) * 40 +
        (accreditedCount / Math.max(investors.length, 1)) * 30 +
        ((100 - activeAlertCount * 5) / 100) * 30) *
        100
    ) / 100;

    setMetrics({
      totalInvestors: investors.length,
      verifiedKyc: verifiedCount,
      pendingKyc: pendingCount,
      expiredKyc: expiredCount,
      accreditedInvestors: accreditedCount,
      activeAlerts: activeAlertCount,
      criticalAlerts: criticalAlertCount,
      complianceScore: Math.min(complianceScore, 100),
    });
  };

  useEffect(() => {
    calculateMetrics();
  }, [investors, alerts]);

  const resolveAlert = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId ? { ...a, resolved: true, resolvedAt: Date.now(), resolvedBy: "Admin" } : a
      )
    );
  };

  const toggleRestriction = (restrictionId: string) => {
    setRestrictions((prev) => prev.map((r) => (r.id === restrictionId ? { ...r, active: !r.active } : r)));
  };

  const updateInvestorKyc = (address: string, status: Investor["kycStatus"]) => {
    setInvestors((prev) =>
      prev.map((inv) => (inv.address === address ? { ...inv, kycStatus: status, lastKycUpdate: Date.now() } : inv))
    );
  };

  const toggleWhitelist = (address: string) => {
    setInvestors((prev) => prev.map((inv) => (inv.address === address ? { ...inv, whitelisted: !inv.whitelisted } : inv)));
  };

  const filteredInvestors = investors.filter((inv) => {
    const matchesSearch =
      inv.legalName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterKycStatus === "ALL" || inv.kycStatus === filterKycStatus;
    return matchesSearch && matchesFilter;
  });

  // Render tabs
  const renderOverview = () => (
    <div className="overview-tab">
      <div className="metrics-grid">
        <MetricCard label="Total Investors" value={metrics.totalInvestors} />
        <MetricCard label="KYC Verified" value={metrics.verifiedKyc} trend="up" />
        <MetricCard label="Pending KYC" value={metrics.pendingKyc} trend="neutral" />
        <MetricCard label="Expired KYC" value={metrics.expiredKyc} trend="down" />
        <MetricCard label="Accredited Investors" value={metrics.accreditedInvestors} />
        <MetricCard label="Active Alerts" value={metrics.activeAlerts} trend={metrics.activeAlerts > 0 ? "down" : "up"} />
        <MetricCard label="Critical Alerts" value={metrics.criticalAlerts} trend={metrics.criticalAlerts > 0 ? "down" : "up"} />
        <MetricCard label="Compliance Score" value={`${metrics.complianceScore}%`} />
      </div>

      <div className="recent-alerts">
        <h3>Recent Alerts</h3>
        {alerts
          .filter((a) => !a.resolved)
          .slice(0, 5)
          .map((alert) => (
            <div key={alert.id} className="alert-item">
              <div className="alert-header">
                <AlertBadge severity={alert.severity} />
                <span className="alert-type">{alert.type.replace(/_/g, " ")}</span>
                <span className="alert-time">{new Date(alert.createdAt).toLocaleString()}</span>
              </div>
              <p className="alert-message">{alert.message}</p>
              <button className="btn-resolve" onClick={() => resolveAlert(alert.id)}>
                Resolve
              </button>
            </div>
          ))}
      </div>
    </div>
  );

  const renderInvestors = () => (
    <div className="investors-tab">
      <div className="tab-header">
        <h3>Investor Registry</h3>
        <button className="btn-primary" onClick={() => setShowAddInvestorModal(true)}>
          Add Investor
        </button>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Search by name, address, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select value={filterKycStatus} onChange={(e) => setFilterKycStatus(e.target.value)}>
          <option value="ALL">All KYC Status</option>
          <option value="VERIFIED">Verified</option>
          <option value="PENDING">Pending</option>
          <option value="EXPIRED">Expired</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="investors-table">
        <table>
          <thead>
            <tr>
              <th>Address</th>
              <th>Legal Name</th>
              <th>KYC</th>
              <th>AML</th>
              <th>Accreditation</th>
              <th>Whitelisted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvestors.map((inv) => (
              <tr key={inv.address}>
                <td>
                  {inv.address.slice(0, 8)}...{inv.address.slice(-6)}
                </td>
                <td>{inv.legalName}</td>
                <td>
                  <StatusBadge status={inv.kycStatus} />
                </td>
                <td>
                  <StatusBadge status={inv.amlStatus} />
                </td>
                <td>
                  <StatusBadge status={inv.accreditationStatus} />
                </td>
                <td>
                  <input type="checkbox" checked={inv.whitelisted} onChange={() => toggleWhitelist(inv.address)} />
                </td>
                <td>
                  <button className="btn-small" onClick={() => setSelectedInvestor(inv)}>
                    View
                  </button>
                  {inv.kycStatus !== "VERIFIED" && (
                    <button className="btn-small btn-success" onClick={() => updateInvestorKyc(inv.address, "VERIFIED")}>
                      Verify KYC
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedInvestor && (
        <div className="investor-detail-modal">
          <div className="modal-content">
            <h3>{selectedInvestor.legalName}</h3>
            <p>
              <strong>Address:</strong> {selectedInvestor.address}
            </p>
            <p>
              <strong>Email:</strong> {selectedInvestor.email}
            </p>
            <p>
              <strong>Jurisdiction:</strong> {selectedInvestor.jurisdiction}
            </p>
            <p>
              <strong>Investment Limit:</strong> ${selectedInvestor.investmentLimit.toLocaleString()}
            </p>
            <p>
              <strong>Total Invested:</strong> ${selectedInvestor.totalInvested.toLocaleString()}
            </p>
            <p>
              <strong>Registered:</strong> {new Date(selectedInvestor.registeredAt).toLocaleDateString()}
            </p>
            <p>
              <strong>Last KYC Update:</strong> {new Date(selectedInvestor.lastKycUpdate).toLocaleDateString()}
            </p>
            <button onClick={() => setSelectedInvestor(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderAlerts = () => (
    <div className="alerts-tab">
      <h3>Compliance Alerts</h3>
      <div className="alert-filters">
        <button className="filter-btn active">All</button>
        <button className="filter-btn">Active</button>
        <button className="filter-btn">Resolved</button>
        <button className="filter-btn">Critical</button>
      </div>
      <div className="alerts-list">
        {alerts.map((alert) => (
          <div key={alert.id} className={`alert-card ${alert.resolved ? "resolved" : ""}`}>
            <div className="alert-card-header">
              <AlertBadge severity={alert.severity} />
              <span className="alert-type-badge">{alert.type.replace(/_/g, " ")}</span>
              {alert.resolved && <span className="resolved-badge">RESOLVED</span>}
            </div>
            <p className="alert-message">{alert.message}</p>
            <p className="alert-address">
              <strong>Investor:</strong> {alert.investorAddress}
            </p>
            <p className="alert-timestamp">{new Date(alert.createdAt).toLocaleString()}</p>
            {!alert.resolved && (
              <div className="alert-actions">
                <button className="btn-resolve" onClick={() => resolveAlert(alert.id)}>
                  Mark as Resolved
                </button>
                <button className="btn-investigate">Investigate</button>
                <button className="btn-escalate">Escalate</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderRestrictions = () => (
    <div className="restrictions-tab">
      <h3>Transfer Restrictions</h3>
      <button className="btn-primary">Add Restriction</button>
      <div className="restrictions-list">
        {restrictions.map((restriction) => (
          <div key={restriction.id} className="restriction-card">
            <div className="restriction-header">
              <h4>{restriction.name}</h4>
              <label className="switch">
                <input type="checkbox" checked={restriction.active} onChange={() => toggleRestriction(restriction.id)} />
                <span className="slider"></span>
              </label>
            </div>
            <p className="restriction-type">Type: {restriction.type}</p>
            <p className="restriction-affected">Affected Investors: {restriction.affectedInvestors}</p>
            <div className="restriction-params">
              <strong>Parameters:</strong>
              <pre>{JSON.stringify(restriction.parameters, null, 2)}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderReports = () => (
    <div className="reports-tab">
      <h3>Regulatory Reports</h3>
      <button className="btn-primary">Generate New Report</button>
      <div className="reports-list">
        {reports.map((report) => (
          <div key={report.id} className="report-card">
            <div className="report-header">
              <h4>{report.type.replace(/_/g, " ")}</h4>
              <span className={`status-badge ${report.status.toLowerCase()}`}>{report.status.replace(/_/g, " ")}</span>
            </div>
            <p>
              <strong>Period:</strong> {report.period}
            </p>
            <p>
              <strong>Generated:</strong> {new Date(report.generatedAt).toLocaleDateString()}
            </p>
            <p>
              <strong>Deadline:</strong> {new Date(report.deadline).toLocaleDateString()}
            </p>
            {report.submittedAt && (
              <p>
                <strong>Submitted:</strong> {new Date(report.submittedAt).toLocaleDateString()}
              </p>
            )}
            <div className="report-actions">
              <button className="btn-small">View</button>
              <button className="btn-small">Download</button>
              {report.status === "DRAFT" && <button className="btn-small btn-primary">Submit</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="compliance-dashboard">
      <header className="dashboard-header">
        <h1>Compliance Administration</h1>
        <div className="header-actions">
          <button className="btn-export">Export Data</button>
          <button className="btn-settings">Settings</button>
        </div>
      </header>

      <nav className="dashboard-nav">
        {(["overview", "investors", "alerts", "restrictions", "reports"] as const).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main className="dashboard-main">
        {activeTab === "overview" && renderOverview()}
        {activeTab === "investors" && renderInvestors()}
        {activeTab === "alerts" && renderAlerts()}
        {activeTab === "restrictions" && renderRestrictions()}
        {activeTab === "reports" && renderReports()}
      </main>

      <style jsx>{`
        .compliance-dashboard {
          max-width: 1400px;
          margin: 0 auto;
          padding: 2rem;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f5f5f5;
          min-height: 100vh;
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }
        .header-actions {
          display: flex;
          gap: 1rem;
        }
        .dashboard-nav {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 2rem;
          background: white;
          padding: 0.5rem;
          border-radius: 8px;
        }
        .dashboard-nav button {
          padding: 0.75rem 1.5rem;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }
        .dashboard-nav button.active {
          background: #2196f3;
          color: white;
        }
        .dashboard-main {
          background: white;
          padding: 2rem;
          border-radius: 8px;
          min-height: 600px;
        }
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .recent-alerts {
          margin-top: 2rem;
        }
        .alert-item {
          background: #f5f5f5;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }
        .alert-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        .alert-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: bold;
        }
        .alert-message {
          margin: 0.5rem 0;
        }
        .btn-resolve {
          background: #4caf50;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-primary {
          background: #2196f3;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }
        .btn-export,
        .btn-settings {
          background: #f5f5f5;
          border: 1px solid #ccc;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .tab-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }
        .filters {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
        }
        .filters input,
        .filters select {
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .filters input {
          flex: 1;
        }
        .investors-table {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th,
        td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid #e0e0e0;
        }
        th {
          background: #f5f5f5;
          font-weight: 600;
        }
        .status-badge {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: bold;
        }
        .btn-small {
          padding: 0.25rem 0.5rem;
          font-size: 0.75rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          background: #e0e0e0;
          margin-right: 0.25rem;
        }
        .btn-success {
          background: #4caf50;
          color: white;
        }
        .investor-detail-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-content {
          background: white;
          padding: 2rem;
          border-radius: 8px;
          max-width: 500px;
          width: 100%;
        }
        .alerts-list,
        .restrictions-list,
        .reports-list {
          display: grid;
          gap: 1rem;
        }
        .alert-card,
        .restriction-card,
        .report-card {
          background: #f5f5f5;
          padding: 1rem;
          border-radius: 8px;
        }
        .alert-card.resolved {
          opacity: 0.6;
        }
        .resolved-badge {
          background: #4caf50;
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
        }
        .alert-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .btn-investigate {
          background: #ff9800;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-escalate {
          background: #f44336;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .restriction-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 24px;
        }
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: 0.4s;
          border-radius: 24px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.4s;
          border-radius: 50%;
        }
        input:checked + .slider {
          background-color: #4caf50;
        }
        input:checked + .slider:before {
          transform: translateX(26px);
        }
        .restriction-params pre {
          background: #e0e0e0;
          padding: 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          overflow-x: auto;
        }
        .report-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .report-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .filter-btn {
          background: #e0e0e0;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .filter-btn.active {
          background: #2196f3;
          color: white;
        }
      `}</style>
    </div>
  );
};

export default ComplianceAdminDashboard;
