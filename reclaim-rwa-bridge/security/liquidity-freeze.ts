/**
 * @fileoverview Liquidity Freeze and Unauthorized Redemption Detection
 * @module security/liquidity-freeze
 *
 * AI-GRADE REQUIREMENT: Freeze hooks - freezeAsset() and haltRedemptions()
 *
 * This module handles:
 * - Unauthorized redemption detection
 * - Suspicious liquidity activity monitoring
 * - Automated freeze hook triggers
 * - Manual override capabilities
 * - Emergency halt mechanisms
 * - Redemption validation pipeline
 */

import { ethers, Contract } from "ethers";
import { EventEmitter } from "events";
import axios from "axios";
import * as crypto from "crypto";

// ═══════════════════════════════════════════════════════════════
// TYPES AND ENUMS
// ═══════════════════════════════════════════════════════════════

export enum RedemptionStatus {
  PENDING = "PENDING",
  VALIDATED = "VALIDATED",
  REJECTED = "REJECTED",
  FROZEN = "FROZEN",
  EXECUTED = "EXECUTED",
  CANCELLED = "CANCELLED",
}

export enum FreezeType {
  ACCOUNT = "ACCOUNT",
  ASSET = "ASSET",
  REDEMPTION_HALT = "REDEMPTION_HALT",
  GLOBAL = "GLOBAL",
}

export enum RedemptionRiskLevel {
  SAFE = "SAFE",
  SUSPICIOUS = "SUSPICIOUS",
  HIGH_RISK = "HIGH_RISK",
  UNAUTHORIZED = "UNAUTHORIZED",
}

export interface RedemptionRequest {
  requestId: string;
  assetId: string;
  requestor: string;
  amount: bigint;
  partition: string;
  destinationAddress: string;
  requestedAt: number;
  status: RedemptionStatus;
  riskLevel: RedemptionRiskLevel;
  validationResults: ValidationResult[];
  legalHandoverProof?: string;
  executedAt?: number;
  rejectedReason?: string;
}

export interface ValidationResult {
  checkName: string;
  passed: boolean;
  riskScore: number;
  details: string;
  timestamp: number;
}

export interface FreezeEvent {
  freezeId: string;
  freezeType: FreezeType;
  target: string; // assetId, accountAddress, or "GLOBAL"
  reason: string;
  triggeredBy: string;
  triggeredAt: number;
  duration?: number; // seconds, undefined = indefinite
  expiresAt?: number;
  overriddenBy?: string;
  overriddenAt?: number;
  isActive: boolean;
}

export interface LiquidityAlert {
  alertId: string;
  alertType: "SUSPICIOUS_REDEMPTION" | "LARGE_WITHDRAWAL" | "RAPID_LIQUIDITY_DRAIN" | "UNAUTHORIZED_ATTEMPT";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  relatedRedemption?: string;
  description: string;
  detectedAt: number;
  handled: boolean;
  actions: string[];
}

export interface LiquidityFreezeConfig {
  validation: {
    maxRedemptionAmount: bigint;
    dailyRedemptionLimit: bigint;
    minTimeBetweenRedemptions: number; // seconds
    requireLegalProof: boolean;
    requireMultiSig: boolean;
    minSignatures: number;
  };
  thresholds: {
    suspiciousAmountThreshold: bigint;
    rapidDrainThreshold: number; // percentage of total liquidity
    velocityCheckWindow: number; // seconds
    maxVelocityTransactions: number;
  };
  actions: {
    autoFreezeOnUnauthorized: boolean;
    haltRedemptionsOnCritical: boolean;
    requireManualApproval: boolean;
    notifyOnFreeze: boolean;
  };
  notifications: {
    webhookUrl?: string;
    emailRecipients: string[];
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

export const defaultLiquidityFreezeConfig: LiquidityFreezeConfig = {
  validation: {
    maxRedemptionAmount: BigInt(1000000e18), // 1M tokens
    dailyRedemptionLimit: BigInt(5000000e18), // 5M tokens
    minTimeBetweenRedemptions: 3600, // 1 hour
    requireLegalProof: true,
    requireMultiSig: false,
    minSignatures: 2,
  },
  thresholds: {
    suspiciousAmountThreshold: BigInt(500000e18), // 500K tokens
    rapidDrainThreshold: 0.1, // 10% of total liquidity
    velocityCheckWindow: 86400, // 24 hours
    maxVelocityTransactions: 10,
  },
  actions: {
    autoFreezeOnUnauthorized: true,
    haltRedemptionsOnCritical: true,
    requireManualApproval: true,
    notifyOnFreeze: true,
  },
  notifications: {
    webhookUrl: process.env.LIQUIDITY_FREEZE_WEBHOOK,
    emailRecipients: [],
  },
  blockchain: {
    rpcUrl: process.env.RPC_URL || "https://eth.llamarpc.com",
    tokenContractAddress: process.env.RWA_TOKEN_ADDRESS || "",
    privateKey: process.env.LIQUIDITY_FREEZE_PRIVATE_KEY,
  },
};

// ═══════════════════════════════════════════════════════════════
// MAIN LIQUIDITY FREEZE SERVICE
// ═══════════════════════════════════════════════════════════════

export class LiquidityFreezeService extends EventEmitter {
  private config: LiquidityFreezeConfig;
  private redemptionRequests: Map<string, RedemptionRequest> = new Map();
  private freezeEvents: Map<string, FreezeEvent> = new Map();
  private liquidityAlerts: Map<string, LiquidityAlert> = new Map();
  private accountFreezes: Set<string> = new Set();
  private assetFreezes: Set<string> = new Set();
  private globalRedemptionHalt: boolean = false;
  private dailyRedemptions: Map<string, bigint> = new Map(); // date -> amount
  private accountRedemptionHistory: Map<string, number[]> = new Map(); // account -> timestamps
  private monitoringTimer: NodeJS.Timer | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<LiquidityFreezeConfig> = {}) {
    super();
    this.config = { ...defaultLiquidityFreezeConfig, ...config };
  }

  // ═══════════════════════════════════════════════════════════════
  // SERVICE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  start(): void {
    if (this.isRunning) return;

    console.log("Starting Liquidity Freeze Service...");
    this.isRunning = true;

    this.monitoringTimer = setInterval(() => {
      this.runMonitoringCycle();
    }, 60000);

    this.emit("serviceStarted", { timestamp: Date.now() });
  }

  stop(): void {
    console.log("Stopping Liquidity Freeze Service...");
    this.isRunning = false;

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    this.emit("serviceStopped", { timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // REDEMPTION VALIDATION
  // ═══════════════════════════════════════════════════════════════

  async validateRedemptionRequest(request: Omit<RedemptionRequest, "requestId" | "status" | "riskLevel" | "validationResults">): Promise<RedemptionRequest> {
    const requestId = crypto.randomUUID();
    console.log(`Validating redemption request ${requestId} for ${request.requestor}`);

    const redemption: RedemptionRequest = {
      ...request,
      requestId,
      status: RedemptionStatus.PENDING,
      riskLevel: RedemptionRiskLevel.SAFE,
      validationResults: [],
    };

    // Check for global halt
    if (this.globalRedemptionHalt) {
      redemption.status = RedemptionStatus.FROZEN;
      redemption.rejectedReason = "Global redemption halt is active";
      this.redemptionRequests.set(requestId, redemption);
      return redemption;
    }

    // Check for account freeze
    if (this.accountFreezes.has(request.requestor)) {
      redemption.status = RedemptionStatus.FROZEN;
      redemption.rejectedReason = "Account is frozen";
      this.redemptionRequests.set(requestId, redemption);
      return redemption;
    }

    // Check for asset freeze
    if (this.assetFreezes.has(request.assetId)) {
      redemption.status = RedemptionStatus.FROZEN;
      redemption.rejectedReason = "Asset is frozen";
      this.redemptionRequests.set(requestId, redemption);
      return redemption;
    }

    // Run validation checks
    await this.runValidationChecks(redemption);

    // Calculate overall risk level
    this.calculateRiskLevel(redemption);

    // Determine final status
    if (redemption.riskLevel === RedemptionRiskLevel.UNAUTHORIZED) {
      redemption.status = RedemptionStatus.REJECTED;
      redemption.rejectedReason = "Unauthorized redemption attempt";

      if (this.config.actions.autoFreezeOnUnauthorized) {
        await this.freezeAccount(request.requestor, "Unauthorized redemption attempt", "System");
      }

      this.createAlert("UNAUTHORIZED_ATTEMPT", "CRITICAL", redemption.requestId, `Unauthorized redemption attempt by ${request.requestor}`);
    } else if (redemption.riskLevel === RedemptionRiskLevel.HIGH_RISK) {
      if (this.config.actions.requireManualApproval) {
        redemption.status = RedemptionStatus.PENDING;
      } else {
        redemption.status = RedemptionStatus.REJECTED;
        redemption.rejectedReason = "High risk redemption requires manual approval";
      }

      this.createAlert("SUSPICIOUS_REDEMPTION", "HIGH", redemption.requestId, "High risk redemption detected");
    } else if (redemption.riskLevel === RedemptionRiskLevel.SUSPICIOUS) {
      if (this.config.actions.requireManualApproval) {
        redemption.status = RedemptionStatus.PENDING;
      } else {
        redemption.status = RedemptionStatus.VALIDATED;
      }

      this.createAlert("SUSPICIOUS_REDEMPTION", "MEDIUM", redemption.requestId, "Suspicious redemption activity");
    } else {
      redemption.status = RedemptionStatus.VALIDATED;
    }

    this.redemptionRequests.set(requestId, redemption);
    this.emit("redemptionValidated", redemption);

    return redemption;
  }

  private async runValidationChecks(redemption: RedemptionRequest): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Check 1: Maximum amount
    const maxAmountCheck = redemption.amount <= this.config.validation.maxRedemptionAmount;
    redemption.validationResults.push({
      checkName: "MAX_AMOUNT",
      passed: maxAmountCheck,
      riskScore: maxAmountCheck ? 0 : 80,
      details: maxAmountCheck ? "Within maximum limit" : "Exceeds maximum redemption amount",
      timestamp: now,
    });

    // Check 2: Daily limit
    const today = new Date().toDateString();
    const dailyTotal = this.dailyRedemptions.get(today) || BigInt(0);
    const newTotal = dailyTotal + redemption.amount;
    const dailyLimitCheck = newTotal <= this.config.validation.dailyRedemptionLimit;
    redemption.validationResults.push({
      checkName: "DAILY_LIMIT",
      passed: dailyLimitCheck,
      riskScore: dailyLimitCheck ? 0 : 60,
      details: dailyLimitCheck ? "Within daily limit" : "Exceeds daily redemption limit",
      timestamp: now,
    });

    // Check 3: Velocity check
    const accountHistory = this.accountRedemptionHistory.get(redemption.requestor) || [];
    const recentRedemptions = accountHistory.filter((t) => now - t < this.config.thresholds.velocityCheckWindow);
    const velocityCheck = recentRedemptions.length < this.config.thresholds.maxVelocityTransactions;
    redemption.validationResults.push({
      checkName: "VELOCITY",
      passed: velocityCheck,
      riskScore: velocityCheck ? 0 : 70,
      details: velocityCheck ? "Normal redemption frequency" : "Too many redemptions in short period",
      timestamp: now,
    });

    // Check 4: Time between redemptions
    const lastRedemptionTime = accountHistory.length > 0 ? accountHistory[accountHistory.length - 1] : 0;
    const timeSinceLastCheck = lastRedemptionTime === 0 || now - lastRedemptionTime >= this.config.validation.minTimeBetweenRedemptions;
    redemption.validationResults.push({
      checkName: "MIN_TIME_BETWEEN",
      passed: timeSinceLastCheck,
      riskScore: timeSinceLastCheck ? 0 : 40,
      details: timeSinceLastCheck ? "Sufficient time elapsed" : "Too soon after last redemption",
      timestamp: now,
    });

    // Check 5: Suspicious amount threshold
    const suspiciousAmountCheck = redemption.amount < this.config.thresholds.suspiciousAmountThreshold;
    redemption.validationResults.push({
      checkName: "SUSPICIOUS_AMOUNT",
      passed: suspiciousAmountCheck,
      riskScore: suspiciousAmountCheck ? 0 : 50,
      details: suspiciousAmountCheck ? "Amount within normal range" : "Large redemption amount flagged",
      timestamp: now,
    });

    // Check 6: Legal handover proof (if required)
    if (this.config.validation.requireLegalProof) {
      const hasLegalProof = !!redemption.legalHandoverProof && redemption.legalHandoverProof.length > 0;
      redemption.validationResults.push({
        checkName: "LEGAL_PROOF",
        passed: hasLegalProof,
        riskScore: hasLegalProof ? 0 : 90,
        details: hasLegalProof ? "Legal handover proof provided" : "Missing legal handover proof",
        timestamp: now,
      });
    }
  }

  private calculateRiskLevel(redemption: RedemptionRequest): void {
    const failedChecks = redemption.validationResults.filter((r) => !r.passed);
    const maxRiskScore = redemption.validationResults.reduce((max, r) => Math.max(max, r.riskScore), 0);
    const avgRiskScore = redemption.validationResults.reduce((sum, r) => sum + r.riskScore, 0) / redemption.validationResults.length;

    if (maxRiskScore >= 90 || failedChecks.length >= 3) {
      redemption.riskLevel = RedemptionRiskLevel.UNAUTHORIZED;
    } else if (maxRiskScore >= 70 || failedChecks.length === 2) {
      redemption.riskLevel = RedemptionRiskLevel.HIGH_RISK;
    } else if (maxRiskScore >= 40 || failedChecks.length === 1) {
      redemption.riskLevel = RedemptionRiskLevel.SUSPICIOUS;
    } else {
      redemption.riskLevel = RedemptionRiskLevel.SAFE;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FREEZE OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async freezeAccount(accountAddress: string, reason: string, triggeredBy: string, duration?: number): Promise<string> {
    const freezeId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    console.log(`Freezing account ${accountAddress}: ${reason}`);

    const freezeEvent: FreezeEvent = {
      freezeId,
      freezeType: FreezeType.ACCOUNT,
      target: accountAddress,
      reason,
      triggeredBy,
      triggeredAt: now,
      duration,
      expiresAt: duration ? now + duration : undefined,
      isActive: true,
    };

    this.freezeEvents.set(freezeId, freezeEvent);
    this.accountFreezes.add(accountAddress);

    this.emit("accountFrozen", freezeEvent);

    if (this.config.actions.notifyOnFreeze) {
      await this.sendFreezeNotification(freezeEvent);
    }

    return freezeId;
  }

  async freezeAsset(assetId: string, reason: string, triggeredBy: string, duration?: number): Promise<string> {
    const freezeId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    console.log(`Freezing asset ${assetId}: ${reason}`);

    const freezeEvent: FreezeEvent = {
      freezeId,
      freezeType: FreezeType.ASSET,
      target: assetId,
      reason,
      triggeredBy,
      triggeredAt: now,
      duration,
      expiresAt: duration ? now + duration : undefined,
      isActive: true,
    };

    this.freezeEvents.set(freezeId, freezeEvent);
    this.assetFreezes.add(assetId);

    this.emit("assetFrozen", freezeEvent);

    if (this.config.actions.notifyOnFreeze) {
      await this.sendFreezeNotification(freezeEvent);
    }

    return freezeId;
  }

  async haltRedemptions(reason: string, triggeredBy: string, duration?: number): Promise<string> {
    const freezeId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    console.log(`CRITICAL: Halting all redemptions: ${reason}`);

    const freezeEvent: FreezeEvent = {
      freezeId,
      freezeType: FreezeType.REDEMPTION_HALT,
      target: "GLOBAL",
      reason,
      triggeredBy,
      triggeredAt: now,
      duration,
      expiresAt: duration ? now + duration : undefined,
      isActive: true,
    };

    this.freezeEvents.set(freezeId, freezeEvent);
    this.globalRedemptionHalt = true;

    this.emit("redemptionsHalted", freezeEvent);

    if (this.config.actions.notifyOnFreeze) {
      await this.sendFreezeNotification(freezeEvent);
    }

    return freezeId;
  }

  async unfreezeAccount(accountAddress: string, authorizedBy: string): Promise<void> {
    if (!this.accountFreezes.has(accountAddress)) {
      throw new Error(`Account ${accountAddress} is not frozen`);
    }

    console.log(`Unfreezing account ${accountAddress}`);
    this.accountFreezes.delete(accountAddress);

    const freezeEvent = Array.from(this.freezeEvents.values()).find(
      (f) => f.target === accountAddress && f.freezeType === FreezeType.ACCOUNT && f.isActive
    );

    if (freezeEvent) {
      freezeEvent.isActive = false;
      freezeEvent.overriddenBy = authorizedBy;
      freezeEvent.overriddenAt = Math.floor(Date.now() / 1000);
    }

    this.emit("accountUnfrozen", { accountAddress, authorizedBy, timestamp: Date.now() });
  }

  async unfreezeAsset(assetId: string, authorizedBy: string): Promise<void> {
    if (!this.assetFreezes.has(assetId)) {
      throw new Error(`Asset ${assetId} is not frozen`);
    }

    console.log(`Unfreezing asset ${assetId}`);
    this.assetFreezes.delete(assetId);

    const freezeEvent = Array.from(this.freezeEvents.values()).find((f) => f.target === assetId && f.freezeType === FreezeType.ASSET && f.isActive);

    if (freezeEvent) {
      freezeEvent.isActive = false;
      freezeEvent.overriddenBy = authorizedBy;
      freezeEvent.overriddenAt = Math.floor(Date.now() / 1000);
    }

    this.emit("assetUnfrozen", { assetId, authorizedBy, timestamp: Date.now() });
  }

  async resumeRedemptions(authorizedBy: string): Promise<void> {
    if (!this.globalRedemptionHalt) {
      throw new Error("Redemptions are not halted");
    }

    console.log("Resuming redemptions");
    this.globalRedemptionHalt = false;

    const freezeEvent = Array.from(this.freezeEvents.values()).find((f) => f.freezeType === FreezeType.REDEMPTION_HALT && f.isActive);

    if (freezeEvent) {
      freezeEvent.isActive = false;
      freezeEvent.overriddenBy = authorizedBy;
      freezeEvent.overriddenAt = Math.floor(Date.now() / 1000);
    }

    this.emit("redemptionsResumed", { authorizedBy, timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // REDEMPTION EXECUTION
  // ═══════════════════════════════════════════════════════════════

  async approveRedemption(requestId: string, approvedBy: string, legalProof?: string): Promise<void> {
    const redemption = this.redemptionRequests.get(requestId);
    if (!redemption) {
      throw new Error(`Redemption request ${requestId} not found`);
    }

    if (redemption.status !== RedemptionStatus.PENDING) {
      throw new Error(`Cannot approve redemption with status ${redemption.status}`);
    }

    redemption.status = RedemptionStatus.VALIDATED;
    if (legalProof) {
      redemption.legalHandoverProof = legalProof;
    }

    this.emit("redemptionApproved", { requestId, approvedBy, timestamp: Date.now() });
  }

  async executeRedemption(requestId: string): Promise<void> {
    const redemption = this.redemptionRequests.get(requestId);
    if (!redemption) {
      throw new Error(`Redemption request ${requestId} not found`);
    }

    if (redemption.status !== RedemptionStatus.VALIDATED) {
      throw new Error(`Cannot execute redemption with status ${redemption.status}`);
    }

    console.log(`Executing redemption ${requestId}`);

    // Update daily totals
    const today = new Date().toDateString();
    const currentTotal = this.dailyRedemptions.get(today) || BigInt(0);
    this.dailyRedemptions.set(today, currentTotal + redemption.amount);

    // Update account history
    const accountHistory = this.accountRedemptionHistory.get(redemption.requestor) || [];
    accountHistory.push(Math.floor(Date.now() / 1000));
    this.accountRedemptionHistory.set(redemption.requestor, accountHistory);

    redemption.status = RedemptionStatus.EXECUTED;
    redemption.executedAt = Math.floor(Date.now() / 1000);

    this.emit("redemptionExecuted", redemption);
  }

  async rejectRedemption(requestId: string, reason: string, rejectedBy: string): Promise<void> {
    const redemption = this.redemptionRequests.get(requestId);
    if (!redemption) {
      throw new Error(`Redemption request ${requestId} not found`);
    }

    redemption.status = RedemptionStatus.REJECTED;
    redemption.rejectedReason = reason;

    this.emit("redemptionRejected", { requestId, reason, rejectedBy, timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // ALERTING
  // ═══════════════════════════════════════════════════════════════

  private createAlert(
    alertType: LiquidityAlert["alertType"],
    severity: LiquidityAlert["severity"],
    relatedRedemption: string | undefined,
    description: string
  ): LiquidityAlert {
    const alert: LiquidityAlert = {
      alertId: crypto.randomUUID(),
      alertType,
      severity,
      relatedRedemption,
      description,
      detectedAt: Math.floor(Date.now() / 1000),
      handled: false,
      actions: [],
    };

    this.liquidityAlerts.set(alert.alertId, alert);
    this.emit("alertCreated", alert);

    if (severity === "CRITICAL" && this.config.actions.haltRedemptionsOnCritical) {
      this.haltRedemptions(`Critical alert: ${description}`, "System");
    }

    return alert;
  }

  private async sendFreezeNotification(freezeEvent: FreezeEvent): Promise<void> {
    if (this.config.notifications.webhookUrl) {
      try {
        await axios.post(this.config.notifications.webhookUrl, {
          type: "FREEZE_EVENT",
          freezeEvent,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("Failed to send freeze notification:", error);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MONITORING
  // ═══════════════════════════════════════════════════════════════

  private async runMonitoringCycle(): Promise<void> {
    if (!this.isRunning) return;

    const now = Math.floor(Date.now() / 1000);

    // Check for expired freezes
    for (const freezeEvent of this.freezeEvents.values()) {
      if (freezeEvent.isActive && freezeEvent.expiresAt && freezeEvent.expiresAt <= now) {
        console.log(`Freeze ${freezeEvent.freezeId} has expired`);
        freezeEvent.isActive = false;

        if (freezeEvent.freezeType === FreezeType.ACCOUNT) {
          this.accountFreezes.delete(freezeEvent.target);
        } else if (freezeEvent.freezeType === FreezeType.ASSET) {
          this.assetFreezes.delete(freezeEvent.target);
        } else if (freezeEvent.freezeType === FreezeType.REDEMPTION_HALT) {
          this.globalRedemptionHalt = false;
        }

        this.emit("freezeExpired", freezeEvent);
      }
    }

    // Clean up old daily redemption data (keep last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    for (const [date] of this.dailyRedemptions) {
      if (new Date(date) < thirtyDaysAgo) {
        this.dailyRedemptions.delete(date);
      }
    }

    this.emit("monitoringCycleCompleted", { timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC GETTERS
  // ═══════════════════════════════════════════════════════════════

  getRedemptionRequest(requestId: string): RedemptionRequest | undefined {
    return this.redemptionRequests.get(requestId);
  }

  getAllRedemptions(): RedemptionRequest[] {
    return Array.from(this.redemptionRequests.values());
  }

  getFrozenAccounts(): string[] {
    return Array.from(this.accountFreezes);
  }

  getFrozenAssets(): string[] {
    return Array.from(this.assetFreezes);
  }

  isRedemptionHalted(): boolean {
    return this.globalRedemptionHalt;
  }

  getActiveFreezes(): FreezeEvent[] {
    return Array.from(this.freezeEvents.values()).filter((f) => f.isActive);
  }

  getAlerts(): LiquidityAlert[] {
    return Array.from(this.liquidityAlerts.values());
  }

  getStatistics(): {
    totalRedemptions: number;
    executedRedemptions: number;
    rejectedRedemptions: number;
    pendingRedemptions: number;
    frozenAccountsCount: number;
    frozenAssetsCount: number;
    activeAlerts: number;
    isHalted: boolean;
  } {
    const redemptions = Array.from(this.redemptionRequests.values());

    return {
      totalRedemptions: redemptions.length,
      executedRedemptions: redemptions.filter((r) => r.status === RedemptionStatus.EXECUTED).length,
      rejectedRedemptions: redemptions.filter((r) => r.status === RedemptionStatus.REJECTED).length,
      pendingRedemptions: redemptions.filter((r) => r.status === RedemptionStatus.PENDING).length,
      frozenAccountsCount: this.accountFreezes.size,
      frozenAssetsCount: this.assetFreezes.size,
      activeAlerts: Array.from(this.liquidityAlerts.values()).filter((a) => !a.handled).length,
      isHalted: this.globalRedemptionHalt,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function createLiquidityFreezeService(config?: Partial<LiquidityFreezeConfig>): LiquidityFreezeService {
  return new LiquidityFreezeService(config);
}

export default LiquidityFreezeService;
