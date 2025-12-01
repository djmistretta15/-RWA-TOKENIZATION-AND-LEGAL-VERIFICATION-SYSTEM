import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Hardhat Configuration for RWA Tokenization System
 *
 * Features:
 * - Multi-network deployment (Mainnet, Goerli, Sepolia, L2s)
 * - Gas optimization reporting
 * - Contract size verification
 * - Solidity coverage
 * - Automated verification
 */

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200, // Optimize for deployment cost vs. runtime cost balance
      },
      viaIR: true, // Use new IR-based code generator for better optimization
      metadata: {
        bytecodeHash: "ipfs", // Store IPFS hash of metadata in bytecode
      },
    },
  },

  networks: {
    // Local development
    hardhat: {
      chainId: 31337,
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
        blockNumber: 18500000, // Pin to specific block for consistent testing
        enabled: process.env.FORK_MAINNET === "true",
      },
      accounts: {
        count: 20,
        accountsBalance: "10000000000000000000000", // 10,000 ETH
      },
      gas: "auto",
      gasPrice: "auto",
      mining: {
        auto: true,
        interval: 0,
      },
    },

    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // Ethereum Mainnet
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 1,
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1.2,
      timeout: 60000,
      confirmations: 2,
    },

    // Ethereum Testnets
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 5,
      gas: "auto",
      gasPrice: "auto",
    },

    sepolia: {
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
      gas: "auto",
      gasPrice: "auto",
    },

    // Layer 2 Networks
    arbitrum: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 42161,
      gas: "auto",
      gasPrice: "auto",
    },

    arbitrumGoerli: {
      url: `https://arb-goerli.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 421613,
      gas: "auto",
      gasPrice: "auto",
    },

    optimism: {
      url: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 10,
      gas: "auto",
      gasPrice: "auto",
    },

    optimismGoerli: {
      url: `https://opt-goerli.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 420,
      gas: "auto",
      gasPrice: "auto",
    },

    base: {
      url: "https://mainnet.base.org",
      accounts: [PRIVATE_KEY],
      chainId: 8453,
      gas: "auto",
      gasPrice: "auto",
    },

    baseGoerli: {
      url: "https://goerli.base.org",
      accounts: [PRIVATE_KEY],
      chainId: 84531,
      gas: "auto",
      gasPrice: "auto",
    },

    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 137,
      gas: "auto",
      gasPrice: "auto",
    },

    polygonMumbai: {
      url: `https://polygon-mumbai.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 80001,
      gas: "auto",
      gasPrice: "auto",
    },

    // Alternative L2s
    zkSync: {
      url: "https://mainnet.era.zksync.io",
      accounts: [PRIVATE_KEY],
      chainId: 324,
      gas: "auto",
      gasPrice: "auto",
    },

    linea: {
      url: "https://rpc.linea.build",
      accounts: [PRIVATE_KEY],
      chainId: 59144,
      gas: "auto",
      gasPrice: "auto",
    },
  },

  etherscan: {
    apiKey: {
      mainnet: ETHERSCAN_API_KEY,
      goerli: ETHERSCAN_API_KEY,
      sepolia: ETHERSCAN_API_KEY,
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      arbitrumGoerli: process.env.ARBISCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      optimisticGoerli: process.env.OPTIMISM_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      baseGoerli: process.env.BASESCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseGoerli",
        chainId: 84531,
        urls: {
          apiURL: "https://api-goerli.basescan.org/api",
          browserURL: "https://goerli.basescan.org",
        },
      },
      {
        network: "linea",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
    ],
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || "",
    outputFile: "gas-report.txt",
    noColors: true,
    token: "ETH",
    gasPriceApi: "https://api.etherscan.io/api?module=proxy&action=eth_gasPrice",
    showTimeSpent: true,
    showMethodSig: true,
  },

  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: [
      "RWAToken",
      "RWARegistry",
      "LegalWrapper",
      "WhitelistAccess",
      "RWAReconciliation",
      "vault4626Router",
      "NotaryRegistry",
      "AssetValidationOracle",
      "YieldDistributor",
    ],
  },

  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 120000, // 2 minutes for complex tests
    bail: false,
    reporter: "spec",
  },

  typechain: {
    outDir: "./typechain-types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["externalArtifacts/*.json"],
    dontOverrideCompile: false,
  },
};

export default config;
