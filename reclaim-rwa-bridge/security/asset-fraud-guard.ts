/**
 * @fileoverview Asset Fraud Detection Guard
 * @module security/asset-fraud-guard
 *
 * AI-GRADE REQUIREMENT: ML-based fraud detection with automated freeze triggers
 *
 * This module implements:
 * - Anomaly detection for suspicious asset behavior
 * - Pattern recognition for known fraud schemes
 * - Real-time monitoring of asset activities
 * - Automated freeze triggers for critical threats
 * - Risk scoring engine
 * - Alert system with escalation
 * - Audit trail for security events
 */

import { ethers } from "ethers";
import { EventEmitter } from "events";
import axios from "axios";
import * as crypto from "crypto";

// ═══════════════════════════════════════════════════════════════
// TYPES AND ENUMS
// ═══════════════════════════════════════════════════════════════

export enum ThreatLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

export enum FraudType {
  DOUBLE_TOKENIZATION = "DOUBLE_TOKENIZATION",
  FAKE_NOTARIZATION = "FAKE_NOTARIZATION",
  OWNERSHIP_CONFLICT = "OWNERSHIP_CONFLICT",
  VALUATION_MANIPULATION = "VALUATION_MANIPULATION",
  DOCUMENT_FORGERY = "DOCUMENT_FORGERY",
  WASH_TRADING = "WASH_TRADING",
  INSIDER_TRADING = "INSIDER_TRADING",
  MARKET_MANIPULATION = "MARKET_MANIPULATION",
  UNAUTHORIZED_TRANSFER = "UNAUTHORIZED_TRANSFER",
  COMPLIANCE_EVASION = "COMPLIANCE_EVASION",
}

export enum DetectionMethod {
  RULE_BASED = "RULE_BASED",
  STATISTICAL_ANOMALY = "STATISTICAL_ANOMALY",
  MACHINE_LEARNING = "MACHINE_LEARNING",
  PATTERN_MATCHING = "PATTERN_MATCHING",
  CROSS_REFERENCE = "CROSS_REFERENCE",
  BEHAVIORAL_ANALYSIS = "BEHAVIORAL_ANALYSIS",
}

export enum AlertStatus {
  NEW = "NEW",
  INVESTIGATING = "INVESTIGATING",
  CONFIRMED = "CONFIRMED",
  FALSE_POSITIVE = "FALSE_POSITIVE",
  RESOLVED = "RESOLVED",
  ESCALATED = "ESCALATED",
}

export interface AssetActivity {
  activityId: string;
  assetId: string;
  activityType: string;
  timestamp: number;
  actor: string;
  details: Record<string, unknown>;
  riskScore: number;
}

export interface FraudAlert {
  alertId: string;
  assetId: string;
  fraudType: FraudType;
  threatLevel: ThreatLevel;
  detectionMethod: DetectionMethod;
  status: AlertStatus;
  riskScore: number;
  confidence: number;
  description: string;
  evidence: string[];
  detectedAt: number;
  updatedAt: number;
  resolvedAt?: number;
  triggeredBy: string;
  assignedTo?: string;
  actions: string[];
  metadata: Record<string, unknown>;
}

export interface RiskProfile {
  assetId: string;
  overallRiskScore: number;
  riskFactors: {
    factor: string;
    score: number;
    weight: number;
    description: string;
  }[];
  historicalIncidents: number;
  lastAssessment: number;
  recommendation: string;
}

export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  anomalyScore: number;
  deviationFactors: {
    metric: string;
    expected: number;
    actual: number;
    deviation: number;
  }[];
  relatedPatterns: string[];
}

export interface FraudGuardConfig {
  monitoring: {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
  };
  thresholds: {
    lowRiskScore: number;
    mediumRiskScore: number;
    highRiskScore: number;
    criticalRiskScore: number;
    autoFreezeThreshold: number;
    anomalyDetectionSensitivity: number;
  };
  actions: {
    autoFreezeEnabled: boolean;
    alertOnHighRisk: boolean;
    escalateOnCritical: boolean;
    requireManualReview: boolean;
  };
  notifications: {
    webhookUrl?: string;
    emailRecipients: string[];
    slackChannel?: string;
    pagerDutyKey?: string;
  };
  blockchain: {
    rpcUrl: string;
    tokenContractAddress: string;
    privateKey?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const defaultFraudGuardConfig: FraudGuardConfig = {
  monitoring: {
    enabled: true,
    intervalMs: 60000, // 1 minute
    batchSize: 100,
  },
  thresholds: {
    lowRiskScore: 25,
    mediumRiskScore: 50,
    highRiskScore: 75,
    criticalRiskScore: 90,
    autoFreezeThreshold: 95,
    anomalyDetectionSensitivity: 0.7,
  },
  actions: {
    autoFreezeEnabled: true,
    alertOnHighRisk: true,
    escalateOnCritical: true,
    requireManualReview: true,
  },
  notifications: {
    webhookUrl: process.env.FRAUD_GUARD_WEBHOOK,
    emailRecipients: [],
    slackChannel: process.env.FRAUD_GUARD_SLACK_CHANNEL,
    pagerDutyKey: process.env.FRAUD_GUARD_PAGERDUTY_KEY,
  },
  blockchain: {
    rpcUrl: process.env.RPC_URL || "https://eth.llamarpc.com",
    tokenContractAddress: process.env.RWA_TOKEN_ADDRESS || "",
    privateKey: process.env.FRAUD_GUARD_PRIVATE_KEY,
  },
};

// ═══════════════════════════════════════════════════════════════
// FRAUD DETECTION RULES ENGINE
// ═══════════════════════════════════════════════════════════════

interface FraudDetectionRule {
  ruleId: string;
  name: string;
  fraudType: FraudType;
  condition: (activity: AssetActivity, history: AssetActivity[]) => boolean;
  riskWeight: number;
  description: string;
}

const defaultRules: FraudDetectionRule[] = [
  {
    ruleId: "RAPID_TRANSFERS",
    name: "Rapid Sequential Transfers",
    fraudType: FraudType.WASH_TRADING,
    condition: (activity, history) => {
      const recentTransfers = history.filter(
        (h) => h.activityType === "TRANSFER" && h.timestamp > activity.timestamp - 3600 // Last hour
      );
      return recentTransfers.length > 10;
    },
    riskWeight: 0.3,
    description: "Multiple transfers in short timeframe may indicate wash trading",
  },
  {
    ruleId: "VALUATION_SPIKE",
    name: "Sudden Valuation Change",
    fraudType: FraudType.VALUATION_MANIPULATION,
    condition: (activity, history) => {
      if (activity.activityType !== "VALUATION_UPDATE") return false;
      const previousValuation = history.find((h) => h.activityType === "VALUATION_UPDATE");
      if (!previousValuation) return false;
      const prevValue = previousValuation.details.valuationUSD as number;
      const currValue = activity.details.valuationUSD as number;
      const change = Math.abs(currValue - prevValue) / prevValue;
      return change > 0.5; // More than 50% change
    },
    riskWeight: 0.4,
    description: "Sudden large valuation changes may indicate manipulation",
  },
  {
    ruleId: "UNAUTHORIZED_PARTITION_TRANSFER",
    name: "Unauthorized Partition Transfer",
    fraudType: FraudType.UNAUTHORIZED_TRANSFER,
    condition: (activity, history) => {
      return activity.activityType === "PARTITION_TRANSFER" && activity.details.unauthorized === true;
    },
    riskWeight: 0.8,
    description: "Transfer between partitions without proper authorization",
  },
  {
    ruleId: "DUPLICATE_DOCUMENT_HASH",
    name: "Duplicate Document Hash",
    fraudType: FraudType.DOUBLE_TOKENIZATION,
    condition: (activity, history) => {
      if (activity.activityType !== "ASSET_REGISTRATION") return false;
      const docHash = activity.details.documentHash as string;
      return history.some((h) => h.activityType === "ASSET_REGISTRATION" && h.details.documentHash === docHash);
    },
    riskWeight: 0.9,
    description: "Same document hash used for multiple assets indicates double tokenization",
  },
  {
    ruleId: "EXPIRED_NOTARY",
    name: "Expired Notary Commission",
    fraudType: FraudType.FAKE_NOTARIZATION,
    condition: (activity, history) => {
      if (activity.activityType !== "NOTARIZATION") return false;
      const notaryExpiration = activity.details.notaryCommissionExpiration as number;
      return notaryExpiration < activity.timestamp;
    },
    riskWeight: 0.95,
    description: "Notarization by notary with expired commission",
  },
  {
    ruleId: "CIRCULAR_OWNERSHIP",
    name: "Circular Ownership Pattern",
    fraudType: FraudType.OWNERSHIP_CONFLICT,
    condition: (activity, history) => {
      if (activity.activityType !== "TRANSFER") return false;
      const transfers = history.filter((h) => h.activityType === "TRANSFER");
      // Check for A -> B -> C -> A pattern
      const addresses = new Set<string>();
      for (const t of transfers) {
        const from = t.details.from as string;
        const to = t.details.to as string;
        if (addresses.has(to)) return true;
        addresses.add(from);
      }
      return false;
    },
    riskWeight: 0.6,
    description: "Circular transfer patterns may indicate ownership conflicts",
  },
];

// ═══════════════════════════════════════════════════════════════
// MAIN FRAUD GUARD SERVICE
// ═══════════════════════════════════════════════════════════════

export class AssetFraudGuard extends EventEmitter {
  private config: FraudGuardConfig;
  private rules: FraudDetectionRule[];
  private activities: Map<string, AssetActivity[]> = new Map(); // assetId -> activities
  private alerts: Map<string, FraudAlert> = new Map();
  private riskProfiles: Map<string, RiskProfile> = new Map();
  private monitoringTimer: NodeJS.Timer | null = null;
  private isRunning: boolean = false;
  private frozenAssets: Set<string> = new Set();

  constructor(config: Partial<FraudGuardConfig> = {}, additionalRules: FraudDetectionRule[] = []) {
    super();
    this.config = { ...defaultFraudGuardConfig, ...config };
    this.rules = [...defaultRules, ...additionalRules];
  }

  // ═══════════════════════════════════════════════════════════════
  // SERVICE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  start(): void {
    if (this.isRunning) return;

    console.log("Starting Asset Fraud Guard Service...");
    this.isRunning = true;

    if (this.config.monitoring.enabled) {
      this.monitoringTimer = setInterval(() => {
        this.runMonitoringCycle();
      }, this.config.monitoring.intervalMs);
    }

    this.emit("serviceStarted", { timestamp: Date.now() });
    console.log("Asset Fraud Guard Service started");
  }

  stop(): void {
    console.log("Stopping Asset Fraud Guard Service...");
    this.isRunning = false;

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    this.emit("serviceStopped", { timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTIVITY INGESTION
  // ═══════════════════════════════════════════════════════════════

  async ingestActivity(activity: AssetActivity): Promise<FraudAlert[]> {
    console.log(`Ingesting activity for asset ${activity.assetId}: ${activity.activityType}`);

    // Store activity
    if (!this.activities.has(activity.assetId)) {
      this.activities.set(activity.assetId, []);
    }
    this.activities.get(activity.assetId)!.push(activity);

    // Run fraud detection
    const alerts = await this.detectFraud(activity);

    // Update risk profile
    await this.updateRiskProfile(activity.assetId);

    this.emit("activityIngested", { activity, alertsGenerated: alerts.length });

    return alerts;
  }

  async ingestBatch(activities: AssetActivity[]): Promise<FraudAlert[]> {
    const allAlerts: FraudAlert[] = [];

    for (const activity of activities) {
      const alerts = await this.ingestActivity(activity);
      allAlerts.push(...alerts);
    }

    return allAlerts;
  }

  // ═══════════════════════════════════════════════════════════════
  // FRAUD DETECTION
  // ═══════════════════════════════════════════════════════════════

  private async detectFraud(activity: AssetActivity): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];
    const history = this.activities.get(activity.assetId) || [];

    // Rule-based detection
    for (const rule of this.rules) {
      if (rule.condition(activity, history)) {
        const alert = this.createAlert(activity.assetId, rule.fraudType, DetectionMethod.RULE_BASED, rule.riskWeight * 100, rule.description);
        alerts.push(alert);
        console.log(`Rule triggered: ${rule.name} for asset ${activity.assetId}`);
      }
    }

    // Statistical anomaly detection
    const anomalyResult = await this.detectAnomalies(activity, history);
    if (anomalyResult.isAnomaly) {
      const alert = this.createAlert(
        activity.assetId,
        FraudType.MARKET_MANIPULATION,
        DetectionMethod.STATISTICAL_ANOMALY,
        anomalyResult.anomalyScore * 100,
        `Statistical anomaly detected: ${anomalyResult.deviationFactors.map((d) => d.metric).join(", ")}`
      );
      alerts.push(alert);
    }

    // ML-based pattern recognition (simulated)
    const mlScore = await this.runMLDetection(activity, history);
    if (mlScore > this.config.thresholds.criticalRiskScore) {
      const alert = this.createAlert(activity.assetId, FraudType.MARKET_MANIPULATION, DetectionMethod.MACHINE_LEARNING, mlScore, "ML model detected suspicious pattern");
      alerts.push(alert);
    }

    // Process alerts
    for (const alert of alerts) {
      await this.processAlert(alert);
    }

    return alerts;
  }

  private createAlert(
    assetId: string,
    fraudType: FraudType,
    detectionMethod: DetectionMethod,
    riskScore: number,
    description: string
  ): FraudAlert {
    const alertId = crypto.randomUUID();
    const threatLevel = this.calculateThreatLevel(riskScore);

    const alert: FraudAlert = {
      alertId,
      assetId,
      fraudType,
      threatLevel,
      detectionMethod,
      status: AlertStatus.NEW,
      riskScore,
      confidence: Math.min(riskScore / 100, 0.99),
      description,
      evidence: [],
      detectedAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      triggeredBy: "AssetFraudGuard",
      actions: [],
      metadata: {},
    };

    this.alerts.set(alertId, alert);
    return alert;
  }

  private calculateThreatLevel(riskScore: number): ThreatLevel {
    if (riskScore >= this.config.thresholds.criticalRiskScore) return ThreatLevel.CRITICAL;
    if (riskScore >= this.config.thresholds.highRiskScore) return ThreatLevel.HIGH;
    if (riskScore >= this.config.thresholds.mediumRiskScore) return ThreatLevel.MEDIUM;
    return ThreatLevel.LOW;
  }

  private async processAlert(alert: FraudAlert): Promise<void> {
    this.emit("alertCreated", alert);

    // Auto-freeze for critical threats
    if (
      this.config.actions.autoFreezeEnabled &&
      alert.riskScore >= this.config.thresholds.autoFreezeThreshold
    ) {
      await this.triggerAssetFreeze(alert);
    }

    // Send notifications for high/critical threats
    if (alert.threatLevel === ThreatLevel.CRITICAL && this.config.actions.escalateOnCritical) {
      await this.escalateAlert(alert);
    } else if (alert.threatLevel === ThreatLevel.HIGH && this.config.actions.alertOnHighRisk) {
      await this.sendNotification(alert);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ANOMALY DETECTION
  // ═══════════════════════════════════════════════════════════════

  private async detectAnomalies(activity: AssetActivity, history: AssetActivity[]): Promise<AnomalyDetectionResult> {
    const deviationFactors: AnomalyDetectionResult["deviationFactors"] = [];
    let totalDeviation = 0;

    // Calculate metrics
    if (history.length > 10) {
      // Time between activities
      const timeDiffs = history.slice(-10).map((h, i, arr) => (i > 0 ? h.timestamp - arr[i - 1].timestamp : 0)).filter((d) => d > 0);
      const avgTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
      const lastTimeDiff = activity.timestamp - history[history.length - 1].timestamp;

      if (lastTimeDiff < avgTimeDiff * 0.1) {
        const deviation = (avgTimeDiff - lastTimeDiff) / avgTimeDiff;
        deviationFactors.push({
          metric: "time_between_activities",
          expected: avgTimeDiff,
          actual: lastTimeDiff,
          deviation,
        });
        totalDeviation += deviation;
      }

      // Risk score trend
      const avgRiskScore = history.reduce((sum, h) => sum + h.riskScore, 0) / history.length;
      if (activity.riskScore > avgRiskScore * 2) {
        const deviation = (activity.riskScore - avgRiskScore) / avgRiskScore;
        deviationFactors.push({
          metric: "risk_score",
          expected: avgRiskScore,
          actual: activity.riskScore,
          deviation,
        });
        totalDeviation += deviation;
      }
    }

    const isAnomaly = totalDeviation / Math.max(deviationFactors.length, 1) > this.config.thresholds.anomalyDetectionSensitivity;

    return {
      isAnomaly,
      anomalyScore: Math.min(totalDeviation / Math.max(deviationFactors.length, 1), 1),
      deviationFactors,
      relatedPatterns: [],
    };
  }

  private async runMLDetection(activity: AssetActivity, history: AssetActivity[]): Promise<number> {
    // Simulated ML model scoring
    // In production, this would call an actual ML service
    const baseScore = activity.riskScore;
    const historyFactor = history.length > 20 ? 0.9 : 1.0;
    const randomFactor = 0.9 + Math.random() * 0.2;

    return baseScore * historyFactor * randomFactor;
  }

  // ═══════════════════════════════════════════════════════════════
  // RISK PROFILING
  // ═══════════════════════════════════════════════════════════════

  private async updateRiskProfile(assetId: string): Promise<void> {
    const activities = this.activities.get(assetId) || [];
    const assetAlerts = Array.from(this.alerts.values()).filter((a) => a.assetId === assetId);

    const riskFactors = [
      {
        factor: "Historical Incidents",
        score: Math.min(assetAlerts.length * 10, 100),
        weight: 0.3,
        description: `${assetAlerts.length} historical security incidents`,
      },
      {
        factor: "Recent Activity Frequency",
        score: Math.min(activities.length * 2, 100),
        weight: 0.2,
        description: `${activities.length} activities recorded`,
      },
      {
        factor: "Critical Alerts",
        score: assetAlerts.filter((a) => a.threatLevel === ThreatLevel.CRITICAL).length * 25,
        weight: 0.5,
        description: `${assetAlerts.filter((a) => a.threatLevel === ThreatLevel.CRITICAL).length} critical alerts`,
      },
    ];

    const overallRiskScore = riskFactors.reduce((sum, f) => sum + f.score * f.weight, 0);

    const profile: RiskProfile = {
      assetId,
      overallRiskScore: Math.min(overallRiskScore, 100),
      riskFactors,
      historicalIncidents: assetAlerts.length,
      lastAssessment: Math.floor(Date.now() / 1000),
      recommendation: overallRiskScore > 75 ? "ENHANCED_MONITORING" : overallRiskScore > 50 ? "STANDARD_MONITORING" : "LOW_PRIORITY",
    };

    this.riskProfiles.set(assetId, profile);
    this.emit("riskProfileUpdated", profile);
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTOMATED ACTIONS
  // ═══════════════════════════════════════════════════════════════

  private async triggerAssetFreeze(alert: FraudAlert): Promise<void> {
    console.log(`CRITICAL: Triggering asset freeze for ${alert.assetId}`);

    this.frozenAssets.add(alert.assetId);
    alert.actions.push(`Asset frozen at ${new Date().toISOString()}`);
    alert.status = AlertStatus.ESCALATED;

    // In production, this would call the smart contract
    // await this.tokenContract.freezeAsset(alert.assetId, alert.description);

    this.emit("assetFrozen", {
      assetId: alert.assetId,
      alertId: alert.alertId,
      reason: alert.description,
      timestamp: Date.now(),
    });

    await this.sendNotification({
      ...alert,
      description: `ASSET FROZEN: ${alert.description}`,
    });
  }

  async unfreezeAsset(assetId: string, reason: string, authorizedBy: string): Promise<void> {
    if (!this.frozenAssets.has(assetId)) {
      throw new Error(`Asset ${assetId} is not frozen`);
    }

    console.log(`Unfreezing asset ${assetId}: ${reason}`);
    this.frozenAssets.delete(assetId);

    this.emit("assetUnfrozen", {
      assetId,
      reason,
      authorizedBy,
      timestamp: Date.now(),
    });
  }

  private async escalateAlert(alert: FraudAlert): Promise<void> {
    console.log(`Escalating alert ${alert.alertId} to security team`);

    alert.status = AlertStatus.ESCALATED;
    alert.actions.push(`Escalated to security team at ${new Date().toISOString()}`);

    // Send to PagerDuty
    if (this.config.notifications.pagerDutyKey) {
      try {
        await axios.post("https://events.pagerduty.com/v2/enqueue", {
          routing_key: this.config.notifications.pagerDutyKey,
          event_action: "trigger",
          payload: {
            summary: `Critical Security Alert: ${alert.fraudType}`,
            source: "AssetFraudGuard",
            severity: "critical",
            custom_details: alert,
          },
        });
      } catch (error) {
        console.error("PagerDuty escalation failed:", error);
      }
    }

    this.emit("alertEscalated", alert);
  }

  private async sendNotification(alert: FraudAlert): Promise<void> {
    // Webhook
    if (this.config.notifications.webhookUrl) {
      try {
        await axios.post(this.config.notifications.webhookUrl, {
          type: "FRAUD_ALERT",
          alert,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("Webhook notification failed:", error);
      }
    }

    this.emit("notificationSent", { alert, timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // MONITORING
  // ═══════════════════════════════════════════════════════════════

  private async runMonitoringCycle(): Promise<void> {
    if (!this.isRunning) return;

    console.log("Running fraud guard monitoring cycle...");

    // Check for stale high-risk alerts
    const now = Math.floor(Date.now() / 1000);
    for (const alert of this.alerts.values()) {
      if (alert.status === AlertStatus.NEW && alert.threatLevel === ThreatLevel.HIGH && now - alert.detectedAt > 3600) {
        // Alert unattended for 1 hour
        await this.escalateAlert(alert);
      }
    }

    // Update risk profiles for active assets
    const recentAssets = new Set<string>();
    for (const [assetId, activities] of this.activities) {
      const recent = activities.filter((a) => now - a.timestamp < 86400); // Last 24 hours
      if (recent.length > 0) {
        recentAssets.add(assetId);
      }
    }

    for (const assetId of recentAssets) {
      await this.updateRiskProfile(assetId);
    }

    this.emit("monitoringCycleCompleted", {
      assetsMonitored: recentAssets.size,
      activeAlerts: Array.from(this.alerts.values()).filter((a) => a.status === AlertStatus.NEW).length,
      frozenAssets: this.frozenAssets.size,
      timestamp: Date.now(),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════

  getAlert(alertId: string): FraudAlert | undefined {
    return this.alerts.get(alertId);
  }

  getAlertsByAsset(assetId: string): FraudAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.assetId === assetId);
  }

  getAllAlerts(status?: AlertStatus): FraudAlert[] {
    const alerts = Array.from(this.alerts.values());
    return status ? alerts.filter((a) => a.status === status) : alerts;
  }

  getRiskProfile(assetId: string): RiskProfile | undefined {
    return this.riskProfiles.get(assetId);
  }

  getFrozenAssets(): string[] {
    return Array.from(this.frozenAssets);
  }

  updateAlertStatus(alertId: string, status: AlertStatus, notes?: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.status = status;
    alert.updatedAt = Math.floor(Date.now() / 1000);

    if (status === AlertStatus.RESOLVED) {
      alert.resolvedAt = alert.updatedAt;
    }

    if (notes) {
      alert.actions.push(`${status}: ${notes} at ${new Date().toISOString()}`);
    }

    this.emit("alertStatusUpdated", alert);
  }

  addCustomRule(rule: FraudDetectionRule): void {
    this.rules.push(rule);
    console.log(`Added custom rule: ${rule.name}`);
  }

  getStatistics(): {
    totalAlerts: number;
    alertsByStatus: Record<AlertStatus, number>;
    alertsByThreatLevel: Record<ThreatLevel, number>;
    frozenAssetsCount: number;
    assetsMonitored: number;
    averageRiskScore: number;
  } {
    const alerts = Array.from(this.alerts.values());

    const alertsByStatus: Record<AlertStatus, number> = {
      [AlertStatus.NEW]: 0,
      [AlertStatus.INVESTIGATING]: 0,
      [AlertStatus.CONFIRMED]: 0,
      [AlertStatus.FALSE_POSITIVE]: 0,
      [AlertStatus.RESOLVED]: 0,
      [AlertStatus.ESCALATED]: 0,
    };

    const alertsByThreatLevel: Record<ThreatLevel, number> = {
      [ThreatLevel.LOW]: 0,
      [ThreatLevel.MEDIUM]: 0,
      [ThreatLevel.HIGH]: 0,
      [ThreatLevel.CRITICAL]: 0,
    };

    for (const alert of alerts) {
      alertsByStatus[alert.status]++;
      alertsByThreatLevel[alert.threatLevel]++;
    }

    const riskScores = Array.from(this.riskProfiles.values()).map((p) => p.overallRiskScore);
    const avgRisk = riskScores.length > 0 ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length : 0;

    return {
      totalAlerts: alerts.length,
      alertsByStatus,
      alertsByThreatLevel,
      frozenAssetsCount: this.frozenAssets.size,
      assetsMonitored: this.activities.size,
      averageRiskScore: avgRisk,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function createFraudGuard(config?: Partial<FraudGuardConfig>, customRules?: FraudDetectionRule[]): AssetFraudGuard {
  return new AssetFraudGuard(config, customRules);
}

export default AssetFraudGuard;
