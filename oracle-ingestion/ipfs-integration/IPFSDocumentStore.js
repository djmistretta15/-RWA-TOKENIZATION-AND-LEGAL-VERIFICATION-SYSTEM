/**
 * @fileoverview IPFS Document Store for RWA Tokenization
 * @description Handles upload, retrieval, and verification of asset documents via IPFS
 *
 * ARCHITECTURAL RATIONALE:
 * IPFS provides content-addressable storage where the hash IS the address.
 * This creates a cryptographic guarantee: if you have the CID (Content Identifier),
 * you can verify the document hasn't been tampered with.
 *
 * We use IPFS for:
 * 1. Retrievable storage (can be pinned by multiple nodes)
 * 2. Fast retrieval through distributed network
 * 3. Content addressing (CID = SHA-256 hash)
 * 4. Gateway access for non-technical users
 *
 * Security Considerations:
 * - Documents are encrypted before upload using AES-256-GCM
 * - Encryption keys are derived from asset owner's signature
 * - Only authorized parties can decrypt using their private keys
 * - Supports both public (for public records) and private (for sensitive docs) modes
 */

const { create } = require('ipfs-http-client');
const crypto = require('crypto');
const { ethers } = require('ethers');

class IPFSDocumentStore {
  /**
   * @param {Object} config - Configuration object
   * @param {string} config.ipfsHost - IPFS node host (default: 'localhost')
   * @param {number} config.ipfsPort - IPFS node port (default: 5001)
   * @param {string} config.ipfsProtocol - Protocol (default: 'http')
   * @param {string[]} config.pinataApiKeys - Pinata API keys for redundant pinning
   * @param {string[]} config.infuraApiKeys - Infura IPFS keys for redundant storage
   */
  constructor(config = {}) {
    this.ipfsHost = config.ipfsHost || 'localhost';
    this.ipfsPort = config.ipfsPort || 5001;
    this.ipfsProtocol = config.ipfsProtocol || 'http';
    this.pinataApiKeys = config.pinataApiKeys || [];
    this.infuraApiKeys = config.infuraApiKeys || [];

    // Initialize IPFS client
    this.ipfs = create({
      host: this.ipfsHost,
      port: this.ipfsPort,
      protocol: this.ipfsProtocol
    });

    // Encryption algorithm
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16;
    this.saltLength = 64;
    this.tagLength = 16;
  }

  /**
   * Upload a document to IPFS with optional encryption
   * @param {Buffer|string} document - Document content
   * @param {Object} metadata - Document metadata
   * @param {string} metadata.assetType - Type of asset
   * @param {string} metadata.jurisdiction - Legal jurisdiction
   * @param {string} metadata.documentType - Type of document (deed, title, bond certificate, etc.)
   * @param {Object} options - Upload options
   * @param {boolean} options.encrypt - Whether to encrypt the document
   * @param {string} options.encryptionKey - Encryption key (derived from owner's signature)
   * @param {boolean} options.pinToMultipleServices - Pin to Pinata/Infura for redundancy
   * @returns {Promise<Object>} Upload result with CID and metadata
   */
  async uploadDocument(document, metadata, options = {}) {
    try {
      const {
        encrypt = true,
        encryptionKey = null,
        pinToMultipleServices = true
      } = options;

      let documentBuffer = Buffer.isBuffer(document)
        ? document
        : Buffer.from(document);

      let encryptionMetadata = null;

      // Encrypt document if requested
      if (encrypt) {
        if (!encryptionKey) {
          throw new Error('Encryption key required when encrypt=true');
        }

        const encryptedData = await this.encryptDocument(documentBuffer, encryptionKey);
        documentBuffer = encryptedData.encryptedBuffer;
        encryptionMetadata = {
          algorithm: this.algorithm,
          iv: encryptedData.iv.toString('hex'),
          salt: encryptedData.salt.toString('hex'),
          authTag: encryptedData.authTag.toString('hex')
        };
      }

      // Create document package with metadata
      const documentPackage = {
        document: documentBuffer.toString('base64'),
        metadata: {
          ...metadata,
          uploadTimestamp: Date.now(),
          encrypted: encrypt,
          encryptionMetadata: encryptionMetadata,
          version: '1.0.0'
        }
      };

      // Upload to primary IPFS node
      const result = await this.ipfs.add(JSON.stringify(documentPackage), {
        pin: true,
        cidVersion: 1,
        hashAlg: 'sha2-256'
      });

      const cid = result.cid.toString();

      // Calculate SHA-256 hash of original document for smart contract
      const documentHash = crypto
        .createHash('sha256')
        .update(documentBuffer)
        .digest('hex');

      // Pin to multiple services for redundancy
      if (pinToMultipleServices) {
        await this.pinToMultipleServices(cid);
      }

      return {
        cid,
        documentHash: '0x' + documentHash,
        size: documentBuffer.length,
        encrypted: encrypt,
        metadata: documentPackage.metadata,
        gateways: this.generateGatewayUrls(cid)
      };

    } catch (error) {
      console.error('IPFS upload error:', error);
      throw new Error(`Failed to upload document to IPFS: ${error.message}`);
    }
  }

  /**
   * Retrieve and decrypt a document from IPFS
   * @param {string} cid - IPFS Content Identifier
   * @param {string} decryptionKey - Decryption key (if encrypted)
   * @returns {Promise<Object>} Retrieved document and metadata
   */
  async retrieveDocument(cid, decryptionKey = null) {
    try {
      // Retrieve from IPFS
      const chunks = [];
      for await (const chunk of this.ipfs.cat(cid)) {
        chunks.push(chunk);
      }

      const packageBuffer = Buffer.concat(chunks);
      const documentPackage = JSON.parse(packageBuffer.toString());

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

      return {
        document: documentBuffer,
        metadata: documentPackage.metadata,
        cid
      };

    } catch (error) {
      console.error('IPFS retrieval error:', error);
      throw new Error(`Failed to retrieve document from IPFS: ${error.message}`);
    }
  }

  /**
   * Verify document integrity by comparing hashes
   * @param {string} cid - IPFS Content Identifier
   * @param {string} expectedHash - Expected document hash
   * @param {string} decryptionKey - Decryption key (if encrypted)
   * @returns {Promise<boolean>} True if document matches expected hash
   */
  async verifyDocumentIntegrity(cid, expectedHash, decryptionKey = null) {
    try {
      const retrieved = await this.retrieveDocument(cid, decryptionKey);

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
   * Encrypt document using AES-256-GCM
   * @private
   */
  async encryptDocument(documentBuffer, encryptionKey) {
    // Generate random IV and salt
    const iv = crypto.randomBytes(this.ivLength);
    const salt = crypto.randomBytes(this.saltLength);

    // Derive key using PBKDF2
    const key = crypto.pbkdf2Sync(encryptionKey, salt, 100000, 32, 'sha512');

    // Create cipher
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(documentBuffer),
      cipher.final()
    ]);

    // Get authentication tag
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
    // Derive key using same parameters
    const key = crypto.pbkdf2Sync(decryptionKey, salt, 100000, 32, 'sha512');

    // Create decipher
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]);

    return decrypted;
  }

  /**
   * Pin CID to multiple pinning services for redundancy
   * @private
   */
  async pinToMultipleServices(cid) {
    const pinPromises = [];

    // Pin to Pinata
    if (this.pinataApiKeys.length > 0) {
      pinPromises.push(this.pinToPinata(cid));
    }

    // Pin to Infura
    if (this.infuraApiKeys.length > 0) {
      pinPromises.push(this.pinToInfura(cid));
    }

    await Promise.allSettled(pinPromises);
  }

  /**
   * Pin to Pinata Cloud
   * @private
   */
  async pinToPinata(cid) {
    const axios = require('axios');

    for (const apiKey of this.pinataApiKeys) {
      try {
        await axios.post(
          'https://api.pinata.cloud/pinning/pinByHash',
          {
            hashToPin: cid
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`
            }
          }
        );
        console.log(`Pinned to Pinata: ${cid}`);
        return;
      } catch (error) {
        console.error('Pinata pinning error:', error.message);
      }
    }
  }

  /**
   * Pin to Infura IPFS
   * @private
   */
  async pinToInfura(cid) {
    // Infura auto-pins content that passes through their gateway
    const axios = require('axios');

    for (const apiKey of this.infuraApiKeys) {
      try {
        await axios.post(
          `https://ipfs.infura.io:5001/api/v0/pin/add?arg=${cid}`,
          null,
          {
            auth: {
              username: apiKey.projectId,
              password: apiKey.projectSecret
            }
          }
        );
        console.log(`Pinned to Infura: ${cid}`);
        return;
      } catch (error) {
        console.error('Infura pinning error:', error.message);
      }
    }
  }

  /**
   * Generate gateway URLs for document access
   * @private
   */
  generateGatewayUrls(cid) {
    return [
      `https://ipfs.io/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`,
      `https://${cid}.ipfs.dweb.link/`,
      `https://ipfs.infura.io/ipfs/${cid}`
    ];
  }

  /**
   * Generate encryption key from Ethereum signature
   * @param {string} message - Message to sign
   * @param {ethers.Wallet} wallet - Ethereum wallet
   * @returns {Promise<string>} Derived encryption key
   */
  static async deriveEncryptionKeyFromSignature(message, wallet) {
    const signature = await wallet.signMessage(message);

    // Use signature as entropy for key derivation
    const hash = crypto
      .createHash('sha256')
      .update(signature)
      .digest('hex');

    return hash;
  }
}

module.exports = IPFSDocumentStore;
