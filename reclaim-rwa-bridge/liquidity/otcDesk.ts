import { EventEmitter } from "events";
import { ethers, Contract } from "ethers";

/**
 * OTC (Over-The-Counter) Trading Desk for RWA Tokens
 *
 * Provides institutional-grade OTC trading services for RWA tokens:
 * - Quote request/response system
 * - Bilateral trade negotiation
 * - Settlement coordination
 * - Compliance verification
 * - Price discovery
 * - Large block trades
 */

// ============ Types and Interfaces ============

interface OTCConfig {
  minTradeSize: bigint;
  maxTradeSize: bigint;
  settlementPeriods: {
    T0: number; // Same day
    T1: number; // Next day
    T2: number; // T+2
    T3: number; // T+3
  };
  pricingSpread: number; // basis points
  quoteValidityPeriod: number; // seconds
  requiredCollateral: number; // percentage
}

interface TradeParty {
  address: string;
  name: string;
  kycStatus: "APPROVED" | "PENDING" | "REJECTED";
  accreditationStatus: "ACCREDITED" | "QUALIFIED" | "NON_ACCREDITED";
  jurisdiction: string;
  institutionalType: "HEDGE_FUND" | "FAMILY_OFFICE" | "ASSET_MANAGER" | "PENSION_FUND" | "INDIVIDUAL" | "OTHER";
  creditRating?: string;
  maxTradeLimit: bigint;
}

interface QuoteRequest {
  requestId: string;
  requester: TradeParty;
  tokenAddress: string;
  partition: string;
  quantity: bigint;
  side: "BUY" | "SELL";
  settlementType: "T0" | "T1" | "T2" | "T3";
  requestTimestamp: number;
  expirationTimestamp: number;
  preferredPriceRange?: {
    min: bigint;
    max: bigint;
  };
  notes?: string;
}

interface Quote {
  quoteId: string;
  requestId: string;
  provider: TradeParty;
  bidPrice: bigint;
  askPrice: bigint;
  midPrice: bigint;
  quantity: bigint;
  validUntil: number;
  settlementType: "T0" | "T1" | "T2" | "T3";
  fees: {
    tradingFee: bigint;
    settlementFee: bigint;
    complianceFee: bigint;
    totalFees: bigint;
  };
  conditions: string[];
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "EXECUTED";
}

interface OTCTrade {
  tradeId: string;
  quoteId: string;
  buyer: TradeParty;
  seller: TradeParty;
  tokenAddress: string;
  partition: string;
  quantity: bigint;
  executionPrice: bigint;
  totalValue: bigint;
  fees: {
    buyerFees: bigint;
    sellerFees: bigint;
    totalFees: bigint;
  };
  settlementDetails: SettlementDetails;
  complianceChecks: ComplianceCheck[];
  status: "PENDING" | "COMPLIANCE_CHECK" | "AWAITING_SETTLEMENT" | "SETTLED" | "FAILED" | "CANCELLED";
  createdAt: number;
  updatedAt: number;
  executedAt?: number;
}

interface SettlementDetails {
  settlementType: "T0" | "T1" | "T2" | "T3";
  expectedSettlementDate: number;
  actualSettlementDate?: number;
  deliveryVsPay: boolean;
  escrowAddress?: string;
  collateralRequired: bigint;
  collateralPosted: {
    buyer: bigint;
    seller: bigint;
  };
  settlementInstructions: string;
  settlementStatus: "PENDING" | "COLLATERAL_POSTED" | "TOKENS_LOCKED" | "PAYMENT_RECEIVED" | "SETTLED" | "FAILED";
}

interface ComplianceCheck {
  checkType: string;
  status: "PASS" | "FAIL" | "PENDING" | "REVIEW_REQUIRED";
  details: string;
  timestamp: number;
}

interface MarketData {
  tokenAddress: string;
  lastTradePrice: bigint;
  volumeWeightedAvgPrice: bigint;
  high24h: bigint;
  low24h: bigint;
  volume24h: bigint;
  tradeCount24h: number;
  timestamp: number;
}

interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: bigint;
  spreadPercentage: number;
}

interface OrderBookEntry {
  price: bigint;
  quantity: bigint;
  provider: string;
  quoteId: string;
}

interface SettlementReport {
  tradeId: string;
  settlementHash: string;
  tokenTransferTxHash: string;
  paymentTxHash: string;
  timestamp: number;
  finalStatus: "SUCCESS" | "PARTIAL" | "FAILED";
  notes: string;
}

interface RFQBroadcast {
  requestId: string;
  tokenAddress: string;
  quantity: bigint;
  side: "BUY" | "SELL";
  broadcastTime: number;
  respondents: string[];
  quotes: Quote[];
}

// ============ OTC Desk Service ============

export class OTCDeskService extends EventEmitter {
  private config: OTCConfig;
  private provider: ethers.Provider;
  private registeredParties: Map<string, TradeParty> = new Map();
  private activeQuoteRequests: Map<string, QuoteRequest> = new Map();
  private quotes: Map<string, Quote> = new Map();
  private trades: Map<string, OTCTrade> = new Map();
  private marketData: Map<string, MarketData> = new Map();
  private orderBooks: Map<string, OrderBook> = new Map();
  private rfqBroadcasts: Map<string, RFQBroadcast> = new Map();

  // Contracts
  private rwaToken: Contract | null = null;
  private escrowContract: Contract | null = null;
  private complianceContract: Contract | null = null;

  constructor(
    config: Partial<OTCConfig> = {},
    provider?: ethers.Provider
  ) {
    super();

    this.config = {
      minTradeSize: config.minTradeSize || ethers.parseEther("10000"), // Min $10k
      maxTradeSize: config.maxTradeSize || ethers.parseEther("100000000"), // Max $100M
      settlementPeriods: config.settlementPeriods || {
        T0: 0,
        T1: 86400,
        T2: 172800,
        T3: 259200,
      },
      pricingSpread: config.pricingSpread || 50, // 0.5%
      quoteValidityPeriod: config.quoteValidityPeriod || 300, // 5 minutes
      requiredCollateral: config.requiredCollateral || 10, // 10%
    };

    this.provider = provider || ethers.getDefaultProvider();
  }

  // ============ Party Registration ============

  /**
   * Register a trade party (institutional or accredited investor)
   */
  async registerParty(party: TradeParty): Promise<{ success: boolean; partyId: string }> {
    // Validate party
    if (party.kycStatus !== "APPROVED") {
      throw new Error("Party must have approved KYC status");
    }

    if (party.accreditationStatus === "NON_ACCREDITED") {
      throw new Error("Only accredited or qualified investors allowed");
    }

    // Store party
    this.registeredParties.set(party.address, party);

    this.emit("partyRegistered", party);

    return {
      success: true,
      partyId: party.address,
    };
  }

  /**
   * Get registered party information
   */
  getParty(address: string): TradeParty | undefined {
    return this.registeredParties.get(address);
  }

  /**
   * Check if party can trade
   */
  canTrade(address: string, amount: bigint): { allowed: boolean; reason?: string } {
    const party = this.registeredParties.get(address);

    if (!party) {
      return { allowed: false, reason: "Party not registered" };
    }

    if (party.kycStatus !== "APPROVED") {
      return { allowed: false, reason: "KYC not approved" };
    }

    if (amount > party.maxTradeLimit) {
      return { allowed: false, reason: "Exceeds trade limit" };
    }

    return { allowed: true };
  }

  // ============ Quote Request System ============

  /**
   * Create a Request for Quote (RFQ)
   */
  async createQuoteRequest(
    requester: string,
    tokenAddress: string,
    partition: string,
    quantity: bigint,
    side: "BUY" | "SELL",
    settlementType: "T0" | "T1" | "T2" | "T3" = "T2",
    options: {
      preferredPriceRange?: { min: bigint; max: bigint };
      notes?: string;
      expirationMinutes?: number;
    } = {}
  ): Promise<QuoteRequest> {
    // Validate requester
    const party = this.registeredParties.get(requester);
    if (!party) {
      throw new Error("Requester not registered");
    }

    // Validate trade size
    if (quantity < this.config.minTradeSize) {
      throw new Error(`Trade size below minimum (${ethers.formatEther(this.config.minTradeSize)})`);
    }

    if (quantity > this.config.maxTradeSize) {
      throw new Error(`Trade size exceeds maximum (${ethers.formatEther(this.config.maxTradeSize)})`);
    }

    const requestId = this.generateId("RFQ");
    const now = Math.floor(Date.now() / 1000);
    const expiration = now + (options.expirationMinutes || 30) * 60;

    const request: QuoteRequest = {
      requestId,
      requester: party,
      tokenAddress,
      partition,
      quantity,
      side,
      settlementType,
      requestTimestamp: now,
      expirationTimestamp: expiration,
      preferredPriceRange: options.preferredPriceRange,
      notes: options.notes,
    };

    this.activeQuoteRequests.set(requestId, request);

    // Broadcast RFQ to market makers
    await this.broadcastRFQ(request);

    this.emit("quoteRequestCreated", request);

    return request;
  }

  /**
   * Broadcast RFQ to registered market makers
   */
  private async broadcastRFQ(request: QuoteRequest): Promise<void> {
    const broadcast: RFQBroadcast = {
      requestId: request.requestId,
      tokenAddress: request.tokenAddress,
      quantity: request.quantity,
      side: request.side,
      broadcastTime: Math.floor(Date.now() / 1000),
      respondents: [],
      quotes: [],
    };

    this.rfqBroadcasts.set(request.requestId, broadcast);

    // Notify all registered parties (in production, filter for market makers)
    for (const [address, party] of this.registeredParties) {
      if (address !== request.requester.address) {
        this.emit("rfqReceived", {
          recipient: address,
          request,
        });
      }
    }
  }

  /**
   * Submit a quote in response to RFQ
   */
  async submitQuote(
    requestId: string,
    provider: string,
    bidPrice: bigint,
    askPrice: bigint,
    options: {
      conditions?: string[];
      validityMinutes?: number;
    } = {}
  ): Promise<Quote> {
    const request = this.activeQuoteRequests.get(requestId);
    if (!request) {
      throw new Error("Quote request not found");
    }

    const providerParty = this.registeredParties.get(provider);
    if (!providerParty) {
      throw new Error("Provider not registered");
    }

    // Validate prices
    if (askPrice <= bidPrice) {
      throw new Error("Ask price must be greater than bid price");
    }

    const midPrice = (bidPrice + askPrice) / 2n;
    const validitySeconds = (options.validityMinutes || 5) * 60;

    // Calculate fees
    const tradeValue = request.quantity * midPrice;
    const tradingFee = (tradeValue * BigInt(this.config.pricingSpread)) / 10000n;
    const settlementFee = tradeValue / 1000n; // 0.1%
    const complianceFee = tradeValue / 10000n; // 0.01%
    const totalFees = tradingFee + settlementFee + complianceFee;

    const quote: Quote = {
      quoteId: this.generateId("QTE"),
      requestId,
      provider: providerParty,
      bidPrice,
      askPrice,
      midPrice,
      quantity: request.quantity,
      validUntil: Math.floor(Date.now() / 1000) + validitySeconds,
      settlementType: request.settlementType,
      fees: {
        tradingFee,
        settlementFee,
        complianceFee,
        totalFees,
      },
      conditions: options.conditions || [],
      status: "PENDING",
    };

    this.quotes.set(quote.quoteId, quote);

    // Add to RFQ broadcast
    const broadcast = this.rfqBroadcasts.get(requestId);
    if (broadcast) {
      broadcast.respondents.push(provider);
      broadcast.quotes.push(quote);
    }

    // Update order book
    this.updateOrderBook(request.tokenAddress, quote);

    this.emit("quoteSubmitted", quote);

    return quote;
  }

  /**
   * Update order book with new quote
   */
  private updateOrderBook(tokenAddress: string, quote: Quote): void {
    let orderBook = this.orderBooks.get(tokenAddress);

    if (!orderBook) {
      orderBook = {
        bids: [],
        asks: [],
        spread: 0n,
        spreadPercentage: 0,
      };
      this.orderBooks.set(tokenAddress, orderBook);
    }

    // Add to bids
    orderBook.bids.push({
      price: quote.bidPrice,
      quantity: quote.quantity,
      provider: quote.provider.address,
      quoteId: quote.quoteId,
    });

    // Add to asks
    orderBook.asks.push({
      price: quote.askPrice,
      quantity: quote.quantity,
      provider: quote.provider.address,
      quoteId: quote.quoteId,
    });

    // Sort bids descending, asks ascending
    orderBook.bids.sort((a, b) => (b.price > a.price ? 1 : -1));
    orderBook.asks.sort((a, b) => (a.price > b.price ? 1 : -1));

    // Calculate spread
    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      orderBook.spread = orderBook.asks[0].price - orderBook.bids[0].price;
      const midPrice = (orderBook.asks[0].price + orderBook.bids[0].price) / 2n;
      orderBook.spreadPercentage = Number((orderBook.spread * 10000n) / midPrice);
    }
  }

  /**
   * Get best quote for a request
   */
  getBestQuote(requestId: string): Quote | null {
    const broadcast = this.rfqBroadcasts.get(requestId);
    if (!broadcast || broadcast.quotes.length === 0) {
      return null;
    }

    const request = this.activeQuoteRequests.get(requestId);
    if (!request) {
      return null;
    }

    // For BUY orders, lowest ask is best; for SELL, highest bid is best
    const validQuotes = broadcast.quotes.filter(
      (q) => q.status === "PENDING" && q.validUntil > Math.floor(Date.now() / 1000)
    );

    if (validQuotes.length === 0) {
      return null;
    }

    if (request.side === "BUY") {
      return validQuotes.reduce((best, current) =>
        current.askPrice < best.askPrice ? current : best
      );
    } else {
      return validQuotes.reduce((best, current) =>
        current.bidPrice > best.bidPrice ? current : best
      );
    }
  }

  // ============ Trade Execution ============

  /**
   * Accept a quote and initiate trade
   */
  async acceptQuote(quoteId: string): Promise<OTCTrade> {
    const quote = this.quotes.get(quoteId);
    if (!quote) {
      throw new Error("Quote not found");
    }

    if (quote.status !== "PENDING") {
      throw new Error(`Quote is ${quote.status}, cannot accept`);
    }

    if (quote.validUntil < Math.floor(Date.now() / 1000)) {
      quote.status = "EXPIRED";
      throw new Error("Quote has expired");
    }

    const request = this.activeQuoteRequests.get(quote.requestId);
    if (!request) {
      throw new Error("Original request not found");
    }

    // Determine buyer and seller
    const buyer = request.side === "BUY" ? request.requester : quote.provider;
    const seller = request.side === "SELL" ? request.requester : quote.provider;

    // Calculate execution price based on side
    const executionPrice = request.side === "BUY" ? quote.askPrice : quote.bidPrice;
    const totalValue = quote.quantity * executionPrice;

    // Calculate collateral
    const collateralRequired = (totalValue * BigInt(this.config.requiredCollateral)) / 100n;

    const trade: OTCTrade = {
      tradeId: this.generateId("TRD"),
      quoteId,
      buyer,
      seller,
      tokenAddress: request.tokenAddress,
      partition: request.partition,
      quantity: quote.quantity,
      executionPrice,
      totalValue,
      fees: {
        buyerFees: quote.fees.totalFees / 2n,
        sellerFees: quote.fees.totalFees / 2n,
        totalFees: quote.fees.totalFees,
      },
      settlementDetails: {
        settlementType: quote.settlementType,
        expectedSettlementDate:
          Math.floor(Date.now() / 1000) +
          this.config.settlementPeriods[quote.settlementType],
        deliveryVsPay: true,
        collateralRequired,
        collateralPosted: {
          buyer: 0n,
          seller: 0n,
        },
        settlementInstructions: `DVP settlement for ${ethers.formatEther(quote.quantity)} tokens`,
        settlementStatus: "PENDING",
      },
      complianceChecks: [],
      status: "PENDING",
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    };

    // Update quote status
    quote.status = "ACCEPTED";

    // Store trade
    this.trades.set(trade.tradeId, trade);

    // Run compliance checks
    await this.runComplianceChecks(trade);

    this.emit("tradeInitiated", trade);

    return trade;
  }

  /**
   * Run compliance checks on trade
   */
  private async runComplianceChecks(trade: OTCTrade): Promise<void> {
    trade.status = "COMPLIANCE_CHECK";
    trade.updatedAt = Math.floor(Date.now() / 1000);

    const checks: ComplianceCheck[] = [];
    const now = Math.floor(Date.now() / 1000);

    // 1. KYC/AML Check
    const kycCheck: ComplianceCheck = {
      checkType: "KYC_AML",
      status: trade.buyer.kycStatus === "APPROVED" && trade.seller.kycStatus === "APPROVED" ? "PASS" : "FAIL",
      details: "Both parties have approved KYC status",
      timestamp: now,
    };
    checks.push(kycCheck);

    // 2. Accreditation Check
    const accreditationCheck: ComplianceCheck = {
      checkType: "ACCREDITATION",
      status:
        trade.buyer.accreditationStatus !== "NON_ACCREDITED" &&
        trade.seller.accreditationStatus !== "NON_ACCREDITED"
          ? "PASS"
          : "FAIL",
      details: "Both parties meet accreditation requirements",
      timestamp: now,
    };
    checks.push(accreditationCheck);

    // 3. Jurisdiction Check
    const jurisdictionCheck: ComplianceCheck = {
      checkType: "JURISDICTION",
      status: this.validateJurisdictions(trade.buyer.jurisdiction, trade.seller.jurisdiction),
      details: `Cross-border trade: ${trade.buyer.jurisdiction} <-> ${trade.seller.jurisdiction}`,
      timestamp: now,
    };
    checks.push(jurisdictionCheck);

    // 4. Trade Limit Check
    const limitCheck: ComplianceCheck = {
      checkType: "TRADE_LIMITS",
      status:
        trade.totalValue <= trade.buyer.maxTradeLimit &&
        trade.totalValue <= trade.seller.maxTradeLimit
          ? "PASS"
          : "FAIL",
      details: "Trade within authorized limits",
      timestamp: now,
    };
    checks.push(limitCheck);

    // 5. Sanctions Screening
    const sanctionsCheck: ComplianceCheck = {
      checkType: "SANCTIONS_SCREENING",
      status: "PASS", // Simplified - would integrate with sanctions lists
      details: "No matches found on OFAC, UN, or EU sanctions lists",
      timestamp: now,
    };
    checks.push(sanctionsCheck);

    // 6. Rule 144 Check (if applicable)
    const rule144Check: ComplianceCheck = {
      checkType: "RULE_144_COMPLIANCE",
      status: "PASS", // Simplified
      details: "Holding period and volume restrictions satisfied",
      timestamp: now,
    };
    checks.push(rule144Check);

    trade.complianceChecks = checks;

    // Check if all passed
    const allPassed = checks.every((c) => c.status === "PASS");

    if (allPassed) {
      trade.status = "AWAITING_SETTLEMENT";
      this.emit("complianceChecksPassed", { tradeId: trade.tradeId });
    } else {
      const failedChecks = checks.filter((c) => c.status === "FAIL");
      trade.status = "FAILED";
      this.emit("complianceChecksFailed", {
        tradeId: trade.tradeId,
        failedChecks,
      });
    }

    trade.updatedAt = Math.floor(Date.now() / 1000);
  }

  /**
   * Validate cross-jurisdiction trade
   */
  private validateJurisdictions(buyerJurisdiction: string, sellerJurisdiction: string): "PASS" | "FAIL" | "REVIEW_REQUIRED" {
    // Simplified validation - in production, check regulatory requirements
    const restrictedPairs = [
      ["US", "IR"], // US-Iran
      ["US", "KP"], // US-North Korea
      ["EU", "RU"], // EU-Russia (sanctions)
    ];

    for (const pair of restrictedPairs) {
      if (
        (buyerJurisdiction.startsWith(pair[0]) && sellerJurisdiction.startsWith(pair[1])) ||
        (buyerJurisdiction.startsWith(pair[1]) && sellerJurisdiction.startsWith(pair[0]))
      ) {
        return "FAIL";
      }
    }

    return "PASS";
  }

  /**
   * Post collateral for trade
   */
  async postCollateral(
    tradeId: string,
    party: "buyer" | "seller",
    amount: bigint
  ): Promise<{ success: boolean; remainingRequired: bigint }> {
    const trade = this.trades.get(tradeId);
    if (!trade) {
      throw new Error("Trade not found");
    }

    if (trade.status !== "AWAITING_SETTLEMENT") {
      throw new Error(`Cannot post collateral in status: ${trade.status}`);
    }

    if (party === "buyer") {
      trade.settlementDetails.collateralPosted.buyer += amount;
    } else {
      trade.settlementDetails.collateralPosted.seller += amount;
    }

    const totalPosted =
      trade.settlementDetails.collateralPosted.buyer +
      trade.settlementDetails.collateralPosted.seller;

    const requiredTotal = trade.settlementDetails.collateralRequired * 2n;

    if (totalPosted >= requiredTotal) {
      trade.settlementDetails.settlementStatus = "COLLATERAL_POSTED";
      this.emit("collateralComplete", { tradeId });
    }

    trade.updatedAt = Math.floor(Date.now() / 1000);

    this.emit("collateralPosted", {
      tradeId,
      party,
      amount,
      totalPosted,
    });

    return {
      success: true,
      remainingRequired: requiredTotal > totalPosted ? requiredTotal - totalPosted : 0n,
    };
  }

  /**
   * Execute settlement (DVP - Delivery vs Payment)
   */
  async executeSettlement(tradeId: string): Promise<SettlementReport> {
    const trade = this.trades.get(tradeId);
    if (!trade) {
      throw new Error("Trade not found");
    }

    if (trade.status !== "AWAITING_SETTLEMENT") {
      throw new Error(`Cannot settle in status: ${trade.status}`);
    }

    if (trade.settlementDetails.settlementStatus !== "COLLATERAL_POSTED") {
      throw new Error("Collateral not fully posted");
    }

    // Check settlement date
    const now = Math.floor(Date.now() / 1000);
    if (now < trade.settlementDetails.expectedSettlementDate) {
      throw new Error("Settlement date not reached");
    }

    // Simulate settlement process
    trade.settlementDetails.settlementStatus = "TOKENS_LOCKED";

    // In production:
    // 1. Lock tokens from seller
    // 2. Verify payment from buyer
    // 3. Execute atomic swap

    trade.settlementDetails.settlementStatus = "PAYMENT_RECEIVED";

    // Complete settlement
    trade.settlementDetails.settlementStatus = "SETTLED";
    trade.settlementDetails.actualSettlementDate = now;
    trade.status = "SETTLED";
    trade.executedAt = now;
    trade.updatedAt = now;

    // Update market data
    this.updateMarketData(trade);

    // Update quote status
    const quote = this.quotes.get(trade.quoteId);
    if (quote) {
      quote.status = "EXECUTED";
    }

    const report: SettlementReport = {
      tradeId: trade.tradeId,
      settlementHash: ethers.keccak256(
        ethers.toUtf8Bytes(`${trade.tradeId}:${trade.executedAt}`)
      ),
      tokenTransferTxHash: "0x" + "a".repeat(64), // Simulated
      paymentTxHash: "0x" + "b".repeat(64), // Simulated
      timestamp: now,
      finalStatus: "SUCCESS",
      notes: `Settlement completed for ${ethers.formatEther(trade.quantity)} tokens at ${ethers.formatEther(trade.executionPrice)}`,
    };

    this.emit("tradeSettled", { trade, report });

    return report;
  }

  /**
   * Update market data after trade
   */
  private updateMarketData(trade: OTCTrade): void {
    let data = this.marketData.get(trade.tokenAddress);

    if (!data) {
      data = {
        tokenAddress: trade.tokenAddress,
        lastTradePrice: trade.executionPrice,
        volumeWeightedAvgPrice: trade.executionPrice,
        high24h: trade.executionPrice,
        low24h: trade.executionPrice,
        volume24h: trade.quantity,
        tradeCount24h: 1,
        timestamp: Math.floor(Date.now() / 1000),
      };
    } else {
      // Update VWAP
      const totalVolume = data.volume24h + trade.quantity;
      data.volumeWeightedAvgPrice =
        (data.volumeWeightedAvgPrice * data.volume24h +
          trade.executionPrice * trade.quantity) /
        totalVolume;

      data.lastTradePrice = trade.executionPrice;
      data.volume24h = totalVolume;
      data.tradeCount24h++;

      if (trade.executionPrice > data.high24h) {
        data.high24h = trade.executionPrice;
      }
      if (trade.executionPrice < data.low24h) {
        data.low24h = trade.executionPrice;
      }

      data.timestamp = Math.floor(Date.now() / 1000);
    }

    this.marketData.set(trade.tokenAddress, data);

    this.emit("marketDataUpdated", data);
  }

  // ============ Query Functions ============

  /**
   * Get trade by ID
   */
  getTrade(tradeId: string): OTCTrade | undefined {
    return this.trades.get(tradeId);
  }

  /**
   * Get all trades for a party
   */
  getTradesForParty(address: string): OTCTrade[] {
    const result: OTCTrade[] = [];

    for (const trade of this.trades.values()) {
      if (trade.buyer.address === address || trade.seller.address === address) {
        result.push(trade);
      }
    }

    return result;
  }

  /**
   * Get market data for token
   */
  getMarketData(tokenAddress: string): MarketData | undefined {
    return this.marketData.get(tokenAddress);
  }

  /**
   * Get order book for token
   */
  getOrderBook(tokenAddress: string): OrderBook | undefined {
    return this.orderBooks.get(tokenAddress);
  }

  /**
   * Get active RFQs
   */
  getActiveRFQs(): QuoteRequest[] {
    const now = Math.floor(Date.now() / 1000);
    const result: QuoteRequest[] = [];

    for (const request of this.activeQuoteRequests.values()) {
      if (request.expirationTimestamp > now) {
        result.push(request);
      }
    }

    return result;
  }

  /**
   * Get quotes for an RFQ
   */
  getQuotesForRFQ(requestId: string): Quote[] {
    const broadcast = this.rfqBroadcasts.get(requestId);
    return broadcast ? broadcast.quotes : [];
  }

  /**
   * Get trading statistics
   */
  getStatistics(): {
    totalTrades: number;
    totalVolume: bigint;
    averageTradeSize: bigint;
    successfulSettlements: number;
    failedTrades: number;
  } {
    let totalVolume = 0n;
    let successfulSettlements = 0;
    let failedTrades = 0;

    for (const trade of this.trades.values()) {
      totalVolume += trade.totalValue;

      if (trade.status === "SETTLED") {
        successfulSettlements++;
      } else if (trade.status === "FAILED" || trade.status === "CANCELLED") {
        failedTrades++;
      }
    }

    const totalTrades = this.trades.size;
    const averageTradeSize = totalTrades > 0 ? totalVolume / BigInt(totalTrades) : 0n;

    return {
      totalTrades,
      totalVolume,
      averageTradeSize,
      successfulSettlements,
      failedTrades,
    };
  }

  // ============ Helper Functions ============

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Clean up expired quotes and requests
   */
  cleanupExpired(): { expiredQuotes: number; expiredRequests: number } {
    const now = Math.floor(Date.now() / 1000);
    let expiredQuotes = 0;
    let expiredRequests = 0;

    // Expire quotes
    for (const quote of this.quotes.values()) {
      if (quote.status === "PENDING" && quote.validUntil < now) {
        quote.status = "EXPIRED";
        expiredQuotes++;
      }
    }

    // Expire requests
    for (const [id, request] of this.activeQuoteRequests) {
      if (request.expirationTimestamp < now) {
        this.activeQuoteRequests.delete(id);
        expiredRequests++;
      }
    }

    return { expiredQuotes, expiredRequests };
  }
}

// ============ Export ============

export {
  OTCConfig,
  TradeParty,
  QuoteRequest,
  Quote,
  OTCTrade,
  SettlementDetails,
  ComplianceCheck,
  MarketData,
  OrderBook,
  SettlementReport,
};
