/**
 * @fileoverview Arweave Permanent Storage for RWA Tokenization
 * @description Handles permanent, immutable storage of asset documents on Arweave
 *
 * ARCHITECTURAL RATIONALE:
 * While IPFS provides content-addressable storage, it requires active pinning.
 * Arweave solves the permanence problem through its "pay once, store forever" model.
 *
 * We use Arweave for:
 * 1. PERMANENT storage (cryptographically guaranteed for 200+ years)
 * 2. Legal archival requirements (securities must be archived for decades)
 * 3. Regulatory compliance (immutable audit trail)
 * 4. Disaster recovery (IPFS backup if pinning services fail)
 *
 * Arweave's Blockweave Technology:
 * - Each block is linked to previous block AND a random historical block
 * - Storage endowment pays miners perpetually through storage cost decay
 * - Wildfire protocol incentivizes rapid data propagation
 * - GraphQL indexing enables efficient querying
 *
 * Economic Model:
 * - One-time payment for permanent storage
 * - Cost calculated based on data size and current AR token price
 * - Typical cost: ~$5-10 per MB at 2024 rates
 * - For legal documents (usually < 10MB): ~$50-100 for eternal storage
 */

const Arweave = require('arweave');
const crypto = require('crypto');
const { ethers } = require('ethers');

class ArweavePermanentStorage {
  /**
   * @param {Object} config - Configuration object
   * @param {string} config.host - Arweave gateway host
   * @param {number} config.port - Gateway port
   * @param {string} config.protocol - Protocol (http/https)
   * @param {Object} config.wallet - Arweave wallet JWK
   * @param {string[]} config.bundlrNodes - Bundlr Network nodes for instant uploads
   */
  constructor(config = {}) {
    this.arweave = Arweave.init({
      host: config.host || 'arweave.net',
      port: config.port || 443,
      protocol: config.protocol || 'https'
    });

    this.wallet = config.wallet || null;
    this.bundlrNodes = config.bundlrNodes || [
      'https://node1.bundlr.network',
      'https://node2.bundlr.network'
    ];

    // GraphQL endpoint for querying
    this.graphqlEndpoint = `${config.protocol || 'https'}://${config.host || 'arweave.net'}/graphql`;
  }

  /**
   * Upload document to Arweave with comprehensive metadata tagging
   * @param {Buffer|string} document - Document content
   * @param {Object} metadata - Document metadata
   * @param {string} metadata.assetId - Unique asset identifier
   * @param {string} metadata.assetType - Type of asset
   * @param {string} metadata.documentType - Type of document
   * @param {string} metadata.jurisdiction - Legal jurisdiction
   * @param {string} metadata.legalEntityHash - Hash of legal entity
   * @param {Object} options - Upload options
   * @param {boolean} options.useBundlr - Use Bundlr for instant finality
   * @param {Object} options.encryption - Encryption configuration
   * @returns {Promise<Object>} Upload result with transaction ID
   */
  async uploadDocument(document, metadata, options = {}) {
    try {
      if (!this.wallet) {
        throw new Error('Arweave wallet required for uploads');
      }

      const {
        useBundlr = false,
        encryption = null
      } = options;

      let documentBuffer = Buffer.isBuffer(document)
        ? document
        : Buffer.from(document);

      // Encrypt if requested
      let encryptionMetadata = null;
      if (encryption) {
        const encrypted = await this.encryptDocument(documentBuffer, encryption.key);
        documentBuffer = encrypted.encryptedBuffer;
        encryptionMetadata = {
          algorithm: 'aes-256-gcm',
          iv: encrypted.iv.toString('hex'),
          salt: encrypted.salt.toString('hex'),
          authTag: encrypted.authTag.toString('hex')
        };
      }

      // Create comprehensive metadata package
      const documentPackage = {
        document: documentBuffer.toString('base64'),
        metadata: {
          ...metadata,
          uploadTimestamp: Date.now(),
          encrypted: !!encryption,
          encryptionMetadata,
          version: '1.0.0',
          contentType: metadata.contentType || 'application/pdf'
        }
      };

      const packageString = JSON.stringify(documentPackage);
      const packageBuffer = Buffer.from(packageString);

      // Calculate cost
      const cost = await this.estimateUploadCost(packageBuffer.length);

      // Create transaction
      const transaction = await this.arweave.createTransaction({
        data: packageBuffer
      }, this.wallet);

      // Add comprehensive tags for GraphQL querying
      transaction.addTag('Content-Type', 'application/json');
      transaction.addTag('Application', 'RWA-Tokenization');
      transaction.addTag('Version', '1.0.0');
      transaction.addTag('Asset-Id', metadata.assetId);
      transaction.addTag('Asset-Type', metadata.assetType);
      transaction.addTag('Document-Type', metadata.documentType);
      transaction.addTag('Jurisdiction', metadata.jurisdiction);
      transaction.addTag('Legal-Entity-Hash', metadata.legalEntityHash);
      transaction.addTag('Upload-Timestamp', metadata.uploadTimestamp.toString());
      transaction.addTag('Encrypted', encryption ? 'true' : 'false');

      // Sign transaction
      await this.arweave.transactions.sign(transaction, this.wallet);

      // Upload via Bundlr or standard Arweave
      let txId;
      if (useBundlr) {
        txId = await this.uploadViaBundlr(packageBuffer, transaction.tags);
      } else {
        await this.arweave.transactions.post(transaction);
        txId = transaction.id;
      }

      // Calculate document hash for smart contract verification
      const documentHash = '0x' + crypto
        .createHash('sha256')
        .update(documentBuffer)
        .digest('hex');

      return {
        transactionId: txId,
        documentHash,
        size: packageBuffer.length,
        cost: cost,
        encrypted: !!encryption,
        metadata: documentPackage.metadata,
        gatewayUrl: `https://arweave.net/${txId}`,
        status: useBundlr ? 'instant' : 'pending',
        estimatedConfirmationTime: useBundlr ? '0 seconds' : '~2-5 minutes'
      };

    } catch (error) {
      console.error('Arweave upload error:', error);
      throw new Error(`Failed to upload document to Arweave: ${error.message}`);
    }
  }

  /**
   * Retrieve document from Arweave
   * @param {string} transactionId - Arweave transaction ID
   * @param {string} decryptionKey - Decryption key (if encrypted)
   * @returns {Promise<Object>} Retrieved document and metadata
   */
  async retrieveDocument(transactionId, decryptionKey = null) {
    try {
      // Retrieve from Arweave
      const response = await this.arweave.transactions.getData(transactionId, {
        decode: true,
        string: true
      });

      const documentPackage = JSON.parse(response);

      // Decode base64 document
      let documentBuffer = Buffer.from(documentPackage.document, 'base64');

      // Decrypt if necessary
      if (documentPackage.metadata.encrypted) {
        if (!decryptionKey) {
          throw new Error('Decryption key required for encrypted document');
        }

        const encMeta = documentPackage.metadata.encryptionMetadata;
        documentBuffer = await this.decryptDocument(
          documentBuffer,
          decryptionKey,
          {
            iv: Buffer.from(encMeta.iv, 'hex'),
            salt: Buffer.from(encMeta.salt, 'hex'),
            authTag: Buffer.from(encMeta.authTag, 'hex')
          }
        );
      }

      // Get transaction metadata
      const txMetadata = await this.getTransactionMetadata(transactionId);

      return {
        document: documentBuffer,
        metadata: documentPackage.metadata,
        transactionId,
        transactionMetadata: txMetadata
      };

    } catch (error) {
      console.error('Arweave retrieval error:', error);
      throw new Error(`Failed to retrieve document from Arweave: ${error.message}`);
    }
  }

  /**
   * Get transaction metadata and confirmation status
   * @param {string} transactionId - Arweave transaction ID
   * @returns {Promise<Object>} Transaction metadata
   */
  async getTransactionMetadata(transactionId) {
    try {
      const status = await this.arweave.transactions.getStatus(transactionId);
      const transaction = await this.arweave.transactions.get(transactionId);

      // Parse tags
      const tags = {};
      transaction.tags.forEach(tag => {
        const key = tag.get('name', { decode: true, string: true });
        const value = tag.get('value', { decode: true, string: true });
        tags[key] = value;
      });

      return {
        status: status.status,
        confirmed: status.confirmed,
        blockHeight: status.confirmed?.block_height,
        blockIndepHash: status.confirmed?.block_indep_hash,
        numberOfConfirmations: status.confirmed?.number_of_confirmations,
        tags,
        dataSize: transaction.data_size,
        reward: transaction.reward,
        timestamp: tags['Upload-Timestamp']
      };

    } catch (error) {
      console.error('Error getting transaction metadata:', error);
      throw error;
    }
  }

  /**
   * Verify document integrity
   * @param {string} transactionId - Arweave transaction ID
   * @param {string} expectedHash - Expected document hash
   * @param {string} decryptionKey - Decryption key (if encrypted)
   * @returns {Promise<boolean>} True if document matches expected hash
   */
  async verifyDocumentIntegrity(transactionId, expectedHash, decryptionKey = null) {
    try {
      const retrieved = await this.retrieveDocument(transactionId, decryptionKey);

      const actualHash = '0x' + crypto
        .createHash('sha256')
        .update(retrieved.document)
        .digest('hex');

      return actualHash.toLowerCase() === expectedHash.toLowerCase();

    } catch (error) {
      console.error('Document verification error:', error);
      return false;
    }
  }

  /**
   * Query documents by asset ID using GraphQL
   * @param {string} assetId - Asset identifier
   * @returns {Promise<Array>} Array of transaction IDs
   */
  async queryDocumentsByAssetId(assetId) {
    const query = `
      query {
        transactions(
          tags: [
            { name: "Application", values: ["RWA-Tokenization"] },
            { name: "Asset-Id", values: ["${assetId}"] }
          ],
          sort: HEIGHT_DESC
        ) {
          edges {
            node {
              id
              tags {
                name
                value
              }
              block {
                height
                timestamp
              }
            }
          }
        }
      }
    `;

    const response = await fetch(this.graphqlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const result = await response.json();
    return result.data.transactions.edges.map(edge => ({
      transactionId: edge.node.id,
      blockHeight: edge.node.block?.height,
      timestamp: edge.node.block?.timestamp,
      tags: edge.node.tags
    }));
  }

  /**
   * Estimate upload cost in AR tokens and USD
   * @param {number} dataSize - Size of data in bytes
   * @returns {Promise<Object>} Cost estimate
   */
  async estimateUploadCost(dataSize) {
    try {
      const winstonCost = await this.arweave.transactions.getPrice(dataSize);
      const arCost = this.arweave.ar.winstonToAr(winstonCost);

      // Get current AR/USD price (simplified - would use Chainlink oracle in production)
      const arPriceUSD = await this.getARPrice();
      const usdCost = parseFloat(arCost) * arPriceUSD;

      return {
        winston: winstonCost,
        ar: arCost,
        usd: usdCost.toFixed(2),
        dataSize,
        estimatedConfirmation: '~2-5 minutes'
      };

    } catch (error) {
      console.error('Error estimating cost:', error);
      throw error;
    }
  }

  /**
   * Get current AR token price in USD
   * @private
   */
  async getARPrice() {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd');
      const data = await response.json();
      return data.arweave.usd;
    } catch (error) {
      console.warn('Failed to fetch AR price, using fallback');
      return 10; // Fallback price
    }
  }

  /**
   * Upload via Bundlr Network for instant finality
   * @private
   */
  async uploadViaBundlr(dataBuffer, tags) {
    const axios = require('axios');

    for (const node of this.bundlrNodes) {
      try {
        // Sign data with wallet
        const dataToSign = await this.arweave.crypto.hash(dataBuffer);
        const signature = await this.arweave.crypto.sign(this.wallet, dataToSign);

        // Prepare bundlr transaction
        const bundlrTx = {
          data: dataBuffer.toString('base64'),
          tags: tags.map(tag => ({
            name: tag.get('name', { decode: true, string: true }),
            value: tag.get('value', { decode: true, string: true })
          })),
          signature: signature.toString('base64')
        };

        const response = await axios.post(`${node}/tx`, bundlrTx);

        return response.data.id;

      } catch (error) {
        console.error(`Bundlr upload failed on ${node}:`, error.message);
        continue;
      }
    }

    throw new Error('Failed to upload via Bundlr on all nodes');
  }

  /**
   * Encrypt document using AES-256-GCM
   * @private
   */
  async encryptDocument(documentBuffer, encryptionKey) {
    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(64);

    const key = crypto.pbkdf2Sync(encryptionKey, salt, 100000, 32, 'sha512');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(documentBuffer),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      encryptedBuffer: encrypted,
      iv,
      salt,
      authTag
    };
  }

  /**
   * Decrypt document using AES-256-GCM
   * @private
   */
  async decryptDocument(encryptedBuffer, decryptionKey, { iv, salt, authTag }) {
    const key = crypto.pbkdf2Sync(decryptionKey, salt, 100000, 32, 'sha512');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]);

    return decrypted;
  }

  /**
   * Generate Arweave wallet
   * @static
   */
  static async generateWallet() {
    const arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https'
    });

    const key = await arweave.wallets.generate();
    const address = await arweave.wallets.jwkToAddress(key);

    return {
      jwk: key,
      address
    };
  }
}

module.exports = ArweavePermanentStorage;
