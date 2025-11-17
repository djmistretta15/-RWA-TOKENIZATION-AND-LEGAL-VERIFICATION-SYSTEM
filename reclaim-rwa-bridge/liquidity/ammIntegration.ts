import { EventEmitter } from "events";
import { ethers, Contract, BigNumberish } from "ethers";

/**
 * AMM (Automated Market Maker) Integration for RWA Tokens
 *
 * Provides compliant secondary market liquidity:
 * - Uniswap V3 concentrated liquidity pools
 * - Compliant trading with KYC/whitelist enforcement
 * - Price impact protection
 * - Liquidity mining rewards
 * - Impermanent loss tracking
 * - Oracle price anchoring
 */

// ============ Types and Interfaces ============

interface AMMConfig {
  poolFactory: string;
  positionManager: string;
  quoter: string;
  swapRouter: string;
  feeTiers: number[]; // e.g., [500, 3000, 10000] for 0.05%, 0.3%, 1%
  maxPriceImpact: number; // basis points
  oracleTolerance: number; // basis points
  minLiquidityAmount: bigint;
  complianceCheckRequired: boolean;
}

interface LiquidityPool {
  poolAddress: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  createdAt: number;
  isCompliant: boolean;
}

interface LiquidityPosition {
  tokenId: bigint;
  owner: string;
  pool: string;
  token0: string;
  token1: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  token0Amount: bigint;
  token1Amount: bigint;
  feesEarned: {
    token0: bigint;
    token1: bigint;
  };
  createdAt: number;
  lastUpdated: number;
}

interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  recipient: string;
  deadline: number;
  sqrtPriceLimitX96?: bigint;
}

interface SwapResult {
  txHash: string;
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  effectivePrice: bigint;
  fees: bigint;
  route: string[];
  timestamp: number;
}

interface QuoteParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  fee: number;
}

interface Quote {
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  initializedTicksCrossed: number;
  gasEstimate: bigint;
  priceImpact: number;
}

interface LiquidityMiningPool {
  poolAddress: string;
  rewardToken: string;
  rewardsPerSecond: bigint;
  totalStaked: bigint;
  startTime: number;
  endTime: number;
  accRewardsPerShare: bigint;
  lastRewardTime: number;
}

interface UserStake {
  user: string;
  amount: bigint;
  rewardDebt: bigint;
  pendingRewards: bigint;
  stakingTime: number;
}

interface PriceData {
  token: string;
  price: bigint;
  twapPrice: bigint;
  oraclePrice: bigint;
  deviation: number;
  timestamp: number;
}

interface PoolStatistics {
  poolAddress: string;
  tvl: bigint;
  volume24h: bigint;
  fees24h: bigint;
  apy: number;
  utilizationRate: number;
  priceRange: {
    lower: bigint;
    upper: bigint;
  };
}

interface ComplianceCheck {
  trader: string;
  isWhitelisted: boolean;
  kycStatus: string;
  accreditationStatus: string;
  jurisdictionAllowed: boolean;
  tradeAllowed: boolean;
  reason?: string;
}

interface ImpermanentLossData {
  positionId: bigint;
  initialValue: bigint;
  currentValue: bigint;
  hodlValue: bigint;
  impermanentLoss: bigint;
  ilPercentage: number;
}

// ============ AMM Integration Service ============

export class AMMIntegrationService extends EventEmitter {
  private config: AMMConfig;
  private provider: ethers.Provider;
  private signer: ethers.Signer | null = null;

  // Contract references (Uniswap V3)
  private poolFactory: Contract | null = null;
  private positionManager: Contract | null = null;
  private quoter: Contract | null = null;
  private swapRouter: Contract | null = null;

  // Compliance contract
  private whitelistAccess: Contract | null = null;

  // State tracking
  private pools: Map<string, LiquidityPool> = new Map();
  private positions: Map<string, LiquidityPosition> = new Map();
  private miningPools: Map<string, LiquidityMiningPool> = new Map();
  private userStakes: Map<string, Map<string, UserStake>> = new Map(); // pool -> user -> stake
  private priceData: Map<string, PriceData> = new Map();

  // Constants for Uniswap V3
  private readonly Q96 = 2n ** 96n;
  private readonly TICK_SPACING: Record<number, number> = {
    500: 10,
    3000: 60,
    10000: 200,
  };

  constructor(config: Partial<AMMConfig> = {}, provider?: ethers.Provider) {
    super();

    this.config = {
      poolFactory: config.poolFactory || ethers.ZeroAddress,
      positionManager: config.positionManager || ethers.ZeroAddress,
      quoter: config.quoter || ethers.ZeroAddress,
      swapRouter: config.swapRouter || ethers.ZeroAddress,
      feeTiers: config.feeTiers || [500, 3000, 10000],
      maxPriceImpact: config.maxPriceImpact || 100, // 1%
      oracleTolerance: config.oracleTolerance || 200, // 2%
      minLiquidityAmount: config.minLiquidityAmount || ethers.parseEther("1000"),
      complianceCheckRequired: config.complianceCheckRequired !== false,
    };

    this.provider = provider || ethers.getDefaultProvider();
  }

  // ============ Pool Management ============

  /**
   * Create a new compliant liquidity pool
   */
  async createPool(
    rwaToken: string,
    stablecoin: string,
    fee: number,
    initialPrice: bigint
  ): Promise<LiquidityPool> {
    if (!this.config.feeTiers.includes(fee)) {
      throw new Error(`Invalid fee tier. Allowed: ${this.config.feeTiers.join(", ")}`);
    }

    // Sort tokens (Uniswap convention: token0 < token1)
    const [token0, token1] =
      rwaToken.toLowerCase() < stablecoin.toLowerCase()
        ? [rwaToken, stablecoin]
        : [stablecoin, rwaToken];

    // Calculate sqrtPriceX96
    const sqrtPriceX96 = this.priceToSqrtPriceX96(initialPrice);

    // Create pool (simulated - would call poolFactory.createPool)
    const poolAddress = ethers.keccak256(
      ethers.solidityPacked(["address", "address", "uint24"], [token0, token1, fee])
    );

    const pool: LiquidityPool = {
      poolAddress,
      token0,
      token1,
      fee,
      tickLower: -887220, // Min tick
      tickUpper: 887220, // Max tick
      liquidity: 0n,
      sqrtPriceX96,
      tick: this.sqrtPriceX96ToTick(sqrtPriceX96),
      createdAt: Math.floor(Date.now() / 1000),
      isCompliant: true,
    };

    this.pools.set(poolAddress, pool);

    this.emit("poolCreated", pool);

    return pool;
  }

  /**
   * Add liquidity to a pool with compliance checks
   */
  async addLiquidity(
    poolAddress: string,
    provider: string,
    amount0Desired: bigint,
    amount1Desired: bigint,
    amount0Min: bigint,
    amount1Min: bigint,
    tickLower: number,
    tickUpper: number,
    deadline: number
  ): Promise<LiquidityPosition> {
    // Check compliance
    if (this.config.complianceCheckRequired) {
      const compliance = await this.checkCompliance(provider);
      if (!compliance.tradeAllowed) {
        throw new Error(`Compliance check failed: ${compliance.reason}`);
      }
    }

    const pool = this.pools.get(poolAddress);
    if (!pool) {
      throw new Error("Pool not found");
    }

    // Validate tick range
    this.validateTickRange(tickLower, tickUpper, pool.fee);

    // Calculate liquidity from amounts
    const liquidity = this.calculateLiquidity(
      amount0Desired,
      amount1Desired,
      pool.sqrtPriceX96,
      tickLower,
      tickUpper
    );

    if (liquidity < this.config.minLiquidityAmount) {
      throw new Error("Liquidity below minimum");
    }

    // Create position
    const tokenId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

    const position: LiquidityPosition = {
      tokenId,
      owner: provider,
      pool: poolAddress,
      token0: pool.token0,
      token1: pool.token1,
      tickLower,
      tickUpper,
      liquidity,
      token0Amount: amount0Desired,
      token1Amount: amount1Desired,
      feesEarned: {
        token0: 0n,
        token1: 0n,
      },
      createdAt: Math.floor(Date.now() / 1000),
      lastUpdated: Math.floor(Date.now() / 1000),
    };

    // Update pool liquidity
    pool.liquidity += liquidity;

    this.positions.set(tokenId.toString(), position);

    this.emit("liquidityAdded", {
      position,
      pool: poolAddress,
      provider,
    });

    return position;
  }

  /**
   * Remove liquidity from position
   */
  async removeLiquidity(
    tokenId: bigint,
    liquidityToRemove: bigint,
    amount0Min: bigint,
    amount1Min: bigint,
    deadline: number
  ): Promise<{ amount0: bigint; amount1: bigint }> {
    const position = this.positions.get(tokenId.toString());
    if (!position) {
      throw new Error("Position not found");
    }

    if (liquidityToRemove > position.liquidity) {
      throw new Error("Insufficient liquidity");
    }

    // Calculate amounts to return
    const pool = this.pools.get(position.pool);
    if (!pool) {
      throw new Error("Pool not found");
    }

    const ratio = (liquidityToRemove * 10000n) / position.liquidity;
    const amount0 = (position.token0Amount * ratio) / 10000n;
    const amount1 = (position.token1Amount * ratio) / 10000n;

    if (amount0 < amount0Min || amount1 < amount1Min) {
      throw new Error("Slippage too high");
    }

    // Update position
    position.liquidity -= liquidityToRemove;
    position.token0Amount -= amount0;
    position.token1Amount -= amount1;
    position.lastUpdated = Math.floor(Date.now() / 1000);

    // Update pool
    pool.liquidity -= liquidityToRemove;

    this.emit("liquidityRemoved", {
      tokenId,
      amount0,
      amount1,
    });

    return { amount0, amount1 };
  }

  /**
   * Collect earned fees
   */
  async collectFees(
    tokenId: bigint,
    recipient: string
  ): Promise<{ amount0: bigint; amount1: bigint }> {
    const position = this.positions.get(tokenId.toString());
    if (!position) {
      throw new Error("Position not found");
    }

    const fees = {
      amount0: position.feesEarned.token0,
      amount1: position.feesEarned.token1,
    };

    // Reset fees
    position.feesEarned.token0 = 0n;
    position.feesEarned.token1 = 0n;
    position.lastUpdated = Math.floor(Date.now() / 1000);

    this.emit("feesCollected", {
      tokenId,
      recipient,
      ...fees,
    });

    return fees;
  }

  // ============ Swap Operations ============

  /**
   * Execute a compliant token swap
   */
  async swap(params: SwapParams): Promise<SwapResult> {
    // Compliance check
    if (this.config.complianceCheckRequired) {
      const compliance = await this.checkCompliance(params.recipient);
      if (!compliance.tradeAllowed) {
        throw new Error(`Compliance check failed: ${compliance.reason}`);
      }
    }

    // Get quote
    const quote = await this.getQuote({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      fee: 3000, // Default to 0.3%
    });

    // Check price impact
    if (quote.priceImpact > this.config.maxPriceImpact) {
      throw new Error(
        `Price impact too high: ${quote.priceImpact / 100}% exceeds max ${this.config.maxPriceImpact / 100}%`
      );
    }

    // Check slippage
    if (quote.amountOut < params.amountOutMinimum) {
      throw new Error("Output amount below minimum");
    }

    // Check oracle deviation
    const oracleCheck = await this.checkOracleDeviation(params.tokenIn, params.tokenOut);
    if (!oracleCheck.withinTolerance) {
      throw new Error(`Oracle deviation too high: ${oracleCheck.deviation / 100}%`);
    }

    // Execute swap (simulated)
    const effectivePrice = (params.amountIn * this.Q96) / quote.amountOut;
    const fees = (params.amountIn * BigInt(3000)) / 1000000n; // 0.3% fee

    const result: SwapResult = {
      txHash: "0x" + "a".repeat(64), // Simulated
      amountIn: params.amountIn,
      amountOut: quote.amountOut,
      priceImpact: quote.priceImpact,
      effectivePrice,
      fees,
      route: [params.tokenIn, params.tokenOut],
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Update pool state
    this.updatePoolAfterSwap(params.tokenIn, params.tokenOut, params.amountIn, quote.amountOut);

    this.emit("swapExecuted", result);

    return result;
  }

  /**
   * Get swap quote with price impact
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    // Find pool
    const poolAddress = this.findPool(params.tokenIn, params.tokenOut, params.fee);
    const pool = this.pools.get(poolAddress);

    if (!pool) {
      throw new Error("No liquidity pool found");
    }

    // Simplified AMM formula (constant product)
    // Real implementation would use Uniswap V3 tick math
    const reserveIn = pool.liquidity;
    const reserveOut = pool.liquidity;

    // x * y = k formula
    const amountInWithFee = (params.amountIn * (1000000n - BigInt(params.fee))) / 1000000n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;
    const amountOut = numerator / denominator;

    // Calculate price impact
    const idealOutput = (params.amountIn * reserveOut) / reserveIn;
    const priceImpact = Number(((idealOutput - amountOut) * 10000n) / idealOutput);

    const quote: Quote = {
      amountOut,
      sqrtPriceX96After: pool.sqrtPriceX96, // Simplified
      initializedTicksCrossed: 1,
      gasEstimate: 150000n,
      priceImpact,
    };

    return quote;
  }

  /**
   * Get optimal swap route
   */
  async findBestRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<{ route: string[]; expectedOutput: bigint; totalFees: bigint }> {
    // Try different fee tiers
    let bestOutput = 0n;
    let bestFee = 3000;

    for (const fee of this.config.feeTiers) {
      try {
        const quote = await this.getQuote({
          tokenIn,
          tokenOut,
          amountIn,
          fee,
        });

        if (quote.amountOut > bestOutput) {
          bestOutput = quote.amountOut;
          bestFee = fee;
        }
      } catch {
        // Pool doesn't exist for this fee tier
        continue;
      }
    }

    const totalFees = (amountIn * BigInt(bestFee)) / 1000000n;

    return {
      route: [tokenIn, tokenOut],
      expectedOutput: bestOutput,
      totalFees,
    };
  }

  // ============ Liquidity Mining ============

  /**
   * Create liquidity mining program
   */
  async createMiningProgram(
    poolAddress: string,
    rewardToken: string,
    totalRewards: bigint,
    durationDays: number
  ): Promise<LiquidityMiningPool> {
    const now = Math.floor(Date.now() / 1000);
    const durationSeconds = durationDays * 86400;

    const miningPool: LiquidityMiningPool = {
      poolAddress,
      rewardToken,
      rewardsPerSecond: totalRewards / BigInt(durationSeconds),
      totalStaked: 0n,
      startTime: now,
      endTime: now + durationSeconds,
      accRewardsPerShare: 0n,
      lastRewardTime: now,
    };

    this.miningPools.set(poolAddress, miningPool);
    this.userStakes.set(poolAddress, new Map());

    this.emit("miningProgramCreated", miningPool);

    return miningPool;
  }

  /**
   * Stake LP tokens for rewards
   */
  async stakeLPTokens(poolAddress: string, user: string, amount: bigint): Promise<UserStake> {
    const miningPool = this.miningPools.get(poolAddress);
    if (!miningPool) {
      throw new Error("Mining program not found");
    }

    // Update pool rewards
    this.updateMiningPool(poolAddress);

    // Get or create user stake
    const poolStakes = this.userStakes.get(poolAddress)!;
    let stake = poolStakes.get(user);

    if (!stake) {
      stake = {
        user,
        amount: 0n,
        rewardDebt: 0n,
        pendingRewards: 0n,
        stakingTime: Math.floor(Date.now() / 1000),
      };
      poolStakes.set(user, stake);
    }

    // Calculate pending rewards before adding stake
    if (stake.amount > 0) {
      const pending = (stake.amount * miningPool.accRewardsPerShare) / this.Q96 - stake.rewardDebt;
      stake.pendingRewards += pending;
    }

    // Add stake
    stake.amount += amount;
    miningPool.totalStaked += amount;

    // Update reward debt
    stake.rewardDebt = (stake.amount * miningPool.accRewardsPerShare) / this.Q96;

    this.emit("lpStaked", {
      poolAddress,
      user,
      amount,
      totalStaked: stake.amount,
    });

    return stake;
  }

  /**
   * Unstake LP tokens
   */
  async unstakeLPTokens(poolAddress: string, user: string, amount: bigint): Promise<bigint> {
    const miningPool = this.miningPools.get(poolAddress);
    if (!miningPool) {
      throw new Error("Mining program not found");
    }

    const stake = this.userStakes.get(poolAddress)?.get(user);
    if (!stake) {
      throw new Error("No stake found");
    }

    if (amount > stake.amount) {
      throw new Error("Insufficient staked amount");
    }

    // Update pool and calculate pending rewards
    this.updateMiningPool(poolAddress);
    const pending = (stake.amount * miningPool.accRewardsPerShare) / this.Q96 - stake.rewardDebt;
    const totalRewards = stake.pendingRewards + pending;

    // Update stake
    stake.amount -= amount;
    miningPool.totalStaked -= amount;
    stake.rewardDebt = (stake.amount * miningPool.accRewardsPerShare) / this.Q96;
    stake.pendingRewards = 0n;

    this.emit("lpUnstaked", {
      poolAddress,
      user,
      amount,
      rewards: totalRewards,
    });

    return totalRewards;
  }

  /**
   * Claim mining rewards
   */
  async claimRewards(poolAddress: string, user: string): Promise<bigint> {
    const miningPool = this.miningPools.get(poolAddress);
    if (!miningPool) {
      throw new Error("Mining program not found");
    }

    const stake = this.userStakes.get(poolAddress)?.get(user);
    if (!stake) {
      throw new Error("No stake found");
    }

    // Update pool
    this.updateMiningPool(poolAddress);

    // Calculate rewards
    const pending = (stake.amount * miningPool.accRewardsPerShare) / this.Q96 - stake.rewardDebt;
    const totalRewards = stake.pendingRewards + pending;

    // Update state
    stake.rewardDebt = (stake.amount * miningPool.accRewardsPerShare) / this.Q96;
    stake.pendingRewards = 0n;

    this.emit("rewardsClaimed", {
      poolAddress,
      user,
      rewards: totalRewards,
    });

    return totalRewards;
  }

  private updateMiningPool(poolAddress: string): void {
    const pool = this.miningPools.get(poolAddress);
    if (!pool) return;

    const now = Math.floor(Date.now() / 1000);

    if (pool.totalStaked === 0n || now <= pool.lastRewardTime) {
      pool.lastRewardTime = now;
      return;
    }

    const timeElapsed = BigInt(Math.min(now, pool.endTime) - pool.lastRewardTime);
    const rewards = timeElapsed * pool.rewardsPerSecond;

    pool.accRewardsPerShare += (rewards * this.Q96) / pool.totalStaked;
    pool.lastRewardTime = now;
  }

  // ============ Analytics ============

  /**
   * Calculate impermanent loss for a position
   */
  calculateImpermanentLoss(positionId: bigint): ImpermanentLossData {
    const position = this.positions.get(positionId.toString());
    if (!position) {
      throw new Error("Position not found");
    }

    const pool = this.pools.get(position.pool);
    if (!pool) {
      throw new Error("Pool not found");
    }

    // Simplified IL calculation
    const initialValue = position.token0Amount + position.token1Amount;
    const currentValue = position.token0Amount + position.token1Amount; // Would recalculate based on current price

    // Calculate HODL value (if held without providing liquidity)
    const hodlValue = initialValue; // Simplified

    // IL = (currentValue - hodlValue) / hodlValue
    const impermanentLoss = hodlValue - currentValue;
    const ilPercentage = Number((impermanentLoss * 10000n) / hodlValue);

    return {
      positionId,
      initialValue,
      currentValue,
      hodlValue,
      impermanentLoss,
      ilPercentage,
    };
  }

  /**
   * Get pool statistics
   */
  getPoolStatistics(poolAddress: string): PoolStatistics {
    const pool = this.pools.get(poolAddress);
    if (!pool) {
      throw new Error("Pool not found");
    }

    // Calculate TVL
    const tvl = pool.liquidity * 2n; // Simplified

    // Simulated 24h stats
    const volume24h = pool.liquidity / 10n;
    const fees24h = (volume24h * BigInt(pool.fee)) / 1000000n;

    // APY calculation
    const feesAnnualized = fees24h * 365n;
    const apy = Number((feesAnnualized * 10000n) / tvl);

    const stats: PoolStatistics = {
      poolAddress,
      tvl,
      volume24h,
      fees24h,
      apy,
      utilizationRate: 0.75, // 75%
      priceRange: {
        lower: this.tickToPrice(pool.tickLower),
        upper: this.tickToPrice(pool.tickUpper),
      },
    };

    return stats;
  }

  /**
   * Get all positions for a user
   */
  getUserPositions(user: string): LiquidityPosition[] {
    const userPositions: LiquidityPosition[] = [];

    for (const position of this.positions.values()) {
      if (position.owner === user) {
        userPositions.push(position);
      }
    }

    return userPositions;
  }

  // ============ Compliance ============

  /**
   * Check if trader is compliant
   */
  async checkCompliance(trader: string): Promise<ComplianceCheck> {
    // Simulated compliance check - would integrate with WhitelistAccess contract
    const check: ComplianceCheck = {
      trader,
      isWhitelisted: true,
      kycStatus: "APPROVED",
      accreditationStatus: "ACCREDITED",
      jurisdictionAllowed: true,
      tradeAllowed: true,
    };

    // Example restrictions
    const blockedAddresses = new Set([
      "0x0000000000000000000000000000000000000001",
    ]);

    if (blockedAddresses.has(trader)) {
      check.tradeAllowed = false;
      check.reason = "Address is blocked";
    }

    return check;
  }

  /**
   * Check oracle price deviation
   */
  async checkOracleDeviation(
    token0: string,
    token1: string
  ): Promise<{ withinTolerance: boolean; deviation: number }> {
    // Simulated oracle check
    const poolAddress = this.findPool(token0, token1, 3000);
    const pool = this.pools.get(poolAddress);

    if (!pool) {
      return { withinTolerance: true, deviation: 0 };
    }

    // Compare pool price with oracle price
    // Simplified - would fetch from oracle contracts
    const deviation = 50; // 0.5%

    return {
      withinTolerance: deviation <= this.config.oracleTolerance,
      deviation,
    };
  }

  // ============ Helper Functions ============

  private findPool(tokenA: string, tokenB: string, fee: number): string {
    const [token0, token1] =
      tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];

    return ethers.keccak256(
      ethers.solidityPacked(["address", "address", "uint24"], [token0, token1, fee])
    );
  }

  private priceToSqrtPriceX96(price: bigint): bigint {
    // sqrt(price) * 2^96
    const sqrtPrice = this.sqrt(price);
    return sqrtPrice * this.Q96;
  }

  private sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
    // Simplified tick calculation
    const price = (sqrtPriceX96 * sqrtPriceX96) / (this.Q96 * this.Q96);
    return Math.floor(Math.log(Number(price)) / Math.log(1.0001));
  }

  private tickToPrice(tick: number): bigint {
    // price = 1.0001^tick
    return BigInt(Math.floor(Math.pow(1.0001, tick) * 1e18));
  }

  private validateTickRange(tickLower: number, tickUpper: number, fee: number): void {
    const spacing = this.TICK_SPACING[fee] || 60;

    if (tickLower >= tickUpper) {
      throw new Error("Invalid tick range");
    }

    if (tickLower % spacing !== 0 || tickUpper % spacing !== 0) {
      throw new Error("Ticks must align with spacing");
    }
  }

  private calculateLiquidity(
    amount0: bigint,
    amount1: bigint,
    sqrtPriceX96: bigint,
    tickLower: number,
    tickUpper: number
  ): bigint {
    // Simplified liquidity calculation
    // Real implementation would use Uniswap V3 LiquidityAmounts library
    const sqrtRatioA = BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tickLower)) * 1e18));
    const sqrtRatioB = BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tickUpper)) * 1e18));

    const liquidity0 = (amount0 * sqrtRatioA * sqrtRatioB) / (sqrtRatioB - sqrtRatioA);
    const liquidity1 = amount1 / (sqrtRatioB - sqrtRatioA);

    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }

  private updatePoolAfterSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    amountOut: bigint
  ): void {
    const poolAddress = this.findPool(tokenIn, tokenOut, 3000);
    const pool = this.pools.get(poolAddress);

    if (!pool) return;

    // Update sqrtPriceX96 based on swap
    // Simplified - would recalculate based on new reserves
    const priceChange = amountIn > amountOut ? 1n : -1n;
    pool.sqrtPriceX96 += priceChange * (pool.sqrtPriceX96 / 10000n);
    pool.tick = this.sqrtPriceX96ToTick(pool.sqrtPriceX96);
  }

  private sqrt(value: bigint): bigint {
    if (value < 0n) throw new Error("Square root of negative number");
    if (value === 0n) return 0n;

    let z = value;
    let x = value / 2n + 1n;

    while (x < z) {
      z = x;
      x = (value / x + x) / 2n;
    }

    return z;
  }

  // ============ Getters ============

  getPool(poolAddress: string): LiquidityPool | undefined {
    return this.pools.get(poolAddress);
  }

  getPosition(tokenId: string): LiquidityPosition | undefined {
    return this.positions.get(tokenId);
  }

  getMiningPool(poolAddress: string): LiquidityMiningPool | undefined {
    return this.miningPools.get(poolAddress);
  }

  getUserStake(poolAddress: string, user: string): UserStake | undefined {
    return this.userStakes.get(poolAddress)?.get(user);
  }

  getAllPools(): LiquidityPool[] {
    return Array.from(this.pools.values());
  }
}

// ============ Export ============

export {
  AMMConfig,
  LiquidityPool,
  LiquidityPosition,
  SwapParams,
  SwapResult,
  Quote,
  LiquidityMiningPool,
  UserStake,
  PriceData,
  PoolStatistics,
  ComplianceCheck,
  ImpermanentLossData,
};
