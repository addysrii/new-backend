/**
 * Signal Protocol implementation for end-to-end encryption
 * This module provides a wrapper around Signal Protocol libraries to enable
 * secure end-to-end encrypted communication in chat applications.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

// Mock implementation of libsignal library interactions
// In a real implementation, you would use the actual signal protocol libraries:
// - @privacyresearch/libsignal-protocol-typescript
// - libsignal-protocol-javascript

class SignalProtocol {
  /**
   * Initialize signal protocol store
   */
  static async initialize() {
    // Ensure the key stores exist
    const collections = await mongoose.connection.db.listCollections({ 
      name: 'SignalIdentityKeys' 
    }).toArray();
    
    if (collections.length === 0) {
      await mongoose.connection.db.createCollection('SignalIdentityKeys');
      await mongoose.connection.db.createCollection('SignalPreKeys');
      await mongoose.connection.db.createCollection('SignalSignedPreKeys');
      await mongoose.connection.db.createCollection('SignalSessions');
      
      // Create indexes for better performance
      await mongoose.connection.collection('SignalIdentityKeys').createIndex({ userId: 1 });
      await mongoose.connection.collection('SignalPreKeys').createIndex({ userId: 1, keyId: 1 });
      await mongoose.connection.collection('SignalSignedPreKeys').createIndex({ userId: 1 });
      await mongoose.connection.collection('SignalSessions').createIndex({ userId: 1, deviceId: 1, remoteUserId: 1 });
    }
    
    logger.info('Signal Protocol stores initialized');
  }
  
  /**
   * Store a user's encryption keys
   * 
   * @param {string} userId - The user ID
   * @param {Object} keys - The user's encryption keys
   * @param {string} keys.identityKey - The user's identity key
   * @param {Object} keys.signedPreKey - The user's signed pre-key
   * @param {Array} keys.oneTimePreKeys - The user's one-time pre-keys
   * @returns {Promise<boolean>} - Whether the keys were stored successfully
   */
  static async storeUserKeys(userId, keys) {
    try {
      const { identityKey, signedPreKey, oneTimePreKeys } = keys;
      
      // Store identity key
      await mongoose.connection.collection('SignalIdentityKeys').updateOne(
        { userId },
        { 
          $set: { 
            userId,
            identityKey,
            createdAt: new Date(),
            updatedAt: new Date()
          } 
        },
        { upsert: true }
      );
      
      // Store signed pre-key
      await mongoose.connection.collection('SignalSignedPreKeys').updateOne(
        { userId },
        { 
          $set: { 
            userId,
            keyId: signedPreKey.keyId,
            publicKey: signedPreKey.publicKey,
            signature: signedPreKey.signature,
            createdAt: new Date(),
            updatedAt: new Date()
          } 
        },
        { upsert: true }
      );
      
      // Store one-time pre-keys
      const preKeyOps = oneTimePreKeys.map(preKey => ({
        updateOne: {
          filter: { userId, keyId: preKey.keyId },
          update: {
            $set: {
              userId,
              keyId: preKey.keyId,
              publicKey: preKey.publicKey,
              createdAt: new Date(),
              updatedAt: new Date(),
              used: false
            }
          },
          upsert: true
        }
      }));
      
      if (preKeyOps.length > 0) {
        await mongoose.connection.collection('SignalPreKeys').bulkWrite(preKeyOps);
      }
      
      logger.info(`Stored Signal Protocol keys for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error storing Signal Protocol keys: ${error.message}`, { userId });
      throw error;
    }
  }
  
  /**
   * Get a user's encryption keys
   * 
   * @param {string} userId - The user ID
   * @returns {Promise<Object|null>} - The user's encryption keys or null if not found
   */
  static async getUserKeys(userId) {
    try {
      // Get identity key
      const identityKeyDoc = await mongoose.connection.collection('SignalIdentityKeys')
        .findOne({ userId });
      
      if (!identityKeyDoc) {
        return null;
      }
      
      // Get signed pre-key
      const signedPreKeyDoc = await mongoose.connection.collection('SignalSignedPreKeys')
        .findOne({ userId });
      
      if (!signedPreKeyDoc) {
        return null;
      }
      
      // Get an unused one-time pre-key
      const preKeyDoc = await mongoose.connection.collection('SignalPreKeys')
        .findOneAndUpdate(
          { userId, used: false },
          { $set: { used: true, usedAt: new Date() } },
          { sort: { keyId: 1 } }
        );
      
      // Return keys bundle
      return {
        identityKey: identityKeyDoc.identityKey,
        signedPreKey: {
          keyId: signedPreKeyDoc.keyId,
          publicKey: signedPreKeyDoc.publicKey,
          signature: signedPreKeyDoc.signature
        },
        preKey: preKeyDoc.value ? {
          keyId: preKeyDoc.value.keyId,
          publicKey: preKeyDoc.value.publicKey
        } : null
      };
    } catch (error) {
      logger.error(`Error getting Signal Protocol keys: ${error.message}`, { userId });
      return null;
    }
  }
  
  /**
   * Encrypt a message using Signal Protocol
   * 
   * @param {string} plaintext - The plain text message to encrypt
   * @param {string} senderId - The sender's user ID
   * @param {Array<string>} recipientIds - Array of recipient user IDs
   * @param {Object} recipientKeys - Map of recipient IDs to their public keys
   * @returns {Promise<Object>} - The encrypted message data
   */
  static async encryptMessage(plaintext, senderId, recipientIds, recipientKeys) {
    try {
      // In a real implementation, this would use the actual Signal Protocol
      // For demonstration purposes, we'll simulate the encryption process
      
      const messageId = uuidv4();
      const encryptedContent = {};
      const encryptionMetadata = {
        messageId,
        sender: senderId,
        timestamp: Date.now(),
        encryptionVersion: '1.0',
        recipients: {}
      };
      
      // Generate a random symmetric key for this message
      const symmetricKey = crypto.randomBytes(32);
      
      // Encrypt the message with the symmetric key
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', symmetricKey, iv);
      let encryptedText = cipher.update(plaintext, 'utf8', 'base64');
      encryptedText += cipher.final('base64');
      const authTag = cipher.getAuthTag();
      
      // For each recipient, encrypt the symmetric key with their public key
      for (const recipientId of recipientIds) {
        if (!recipientKeys[recipientId]) {
          logger.warn(`No encryption keys found for recipient ${recipientId}`);
          continue;
        }
        
        // Get recipient's identity key (public key)
        const recipientPublicKey = Buffer.from(recipientKeys[recipientId].identityKey, 'base64');
        
        // Encrypt the symmetric key with the recipient's public key
        // In a real implementation, this would use the X3DH key agreement protocol
        // For demonstration, we'll use a simplified RSA approach
        const encryptedSymmetricKey = crypto.publicEncrypt(
          {
            key: recipientPublicKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
          },
          symmetricKey
        ).toString('base64');
        
        // Store the encrypted key for this recipient
        encryptionMetadata.recipients[recipientId] = {
          encryptedKey: encryptedSymmetricKey,
          // In a real implementation, you would also include signal protocol identifiers
          // like device IDs, signed pre-key IDs, etc.
        };
      }
      
      // Store encryption session data
      await this.storeEncryptionSession(messageId, senderId, recipientIds, {
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
      });
      
      return {
        encryptedContent: {
          ciphertext: encryptedText,
          iv: iv.toString('base64'),
          authTag: authTag.toString('base64')
        },
        metadata: encryptionMetadata
      };
    } catch (error) {
      logger.error(`Error encrypting message: ${error.message}`, { senderId });
      throw new Error('Message encryption failed');
    }
  }
  
  /**
   * Decrypt a message using Signal Protocol
   * 
   * @param {Object} encryptedMessage - The encrypted message object
   * @param {string} userId - The user ID of the recipient
   * @param {string} senderId - The sender's user ID
   * @param {Object} metadata - Encryption metadata
   * @returns {Promise<Object>} - The decrypted message data
   */
  static async decryptMessage(encryptedMessage, userId, senderId, metadata) {
    try {
      // In a real implementation, this would use the actual Signal Protocol
      // For demonstration purposes, we'll simulate the decryption process
      
      // Get the encrypted symmetric key for this recipient
      const recipientData = metadata.recipients[userId];
      if (!recipientData) {
        throw new Error('No encryption data found for this recipient');
      }
      
      // Get the user's private key
      const privateKeyDoc = await mongoose.connection.collection('UserPrivateKeys')
        .findOne({ userId });
      
      if (!privateKeyDoc) {
        throw new Error('Private key not found');
      }
      
      const privateKey = privateKeyDoc.privateKey;
      
      // Decrypt the symmetric key
      const encryptedSymmetricKey = Buffer.from(recipientData.encryptedKey, 'base64');
      const symmetricKey = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
        },
        encryptedSymmetricKey
      );
      
      // Get session data for additional decryption parameters
      const sessionData = await this.getEncryptionSession(metadata.messageId, senderId, userId);
      
      if (!sessionData) {
        throw new Error('Encryption session data not found');
      }
      
      // Decrypt the message
      const iv = Buffer.from(encryptedMessage.iv || sessionData.iv, 'base64');
      const authTag = Buffer.from(encryptedMessage.authTag || sessionData.authTag, 'base64');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', symmetricKey, iv);
      decipher.setAuthTag(authTag);
      
      let decryptedText = decipher.update(encryptedMessage.ciphertext, 'base64', 'utf8');
      decryptedText += decipher.final('utf8');
      
      return {
        decryptedContent: decryptedText,
        messageId: metadata.messageId,
        senderId: senderId,
        timestamp: metadata.timestamp
      };
    } catch (error) {
      logger.error(`Error decrypting message: ${error.message}`, { userId, senderId });
      throw new Error('Message decryption failed');
    }
  }
  
  /**
   * Store encryption session data for a message
   * 
   * @param {string} messageId - The message ID
   * @param {string} senderId - The sender's user ID
   * @param {Array<string>} recipientIds - Array of recipient user IDs
   * @param {Object} sessionData - Session data for encryption/decryption
   * @returns {Promise<boolean>} - Whether the session was stored successfully
   */
  static async storeEncryptionSession(messageId, senderId, recipientIds, sessionData) {
    try {
      const sessionDocs = recipientIds.map(recipientId => ({
        messageId,
        senderId,
        recipientId,
        createdAt: new Date(),
        sessionData
      }));
      
      await mongoose.connection.collection('SignalSessions').insertMany(sessionDocs);
      return true;
    } catch (error) {
      logger.error(`Error storing encryption session: ${error.message}`, { messageId });
      return false;
    }
  }
  
  /**
   * Get encryption session data for a message
   * 
   * @param {string} messageId - The message ID
   * @param {string} senderId - The sender's user ID
   * @param {string} recipientId - The recipient's user ID
   * @returns {Promise<Object|null>} - The session data or null if not found
   */
  static async getEncryptionSession(messageId, senderId, recipientId) {
    try {
      const session = await mongoose.connection.collection('SignalSessions').findOne({
        messageId,
        senderId,
        recipientId
      });
      
      return session ? session.sessionData : null;
    } catch (error) {
      logger.error(`Error getting encryption session: ${error.message}`, { messageId });
      return null;
    }
  }
  
  /**
   * Generate encryption keys for a user
   * 
   * @param {string} userId - The user ID
   * @returns {Promise<Object>} - The generated keys
   */
  static async generateUserKeys(userId) {
    try {
      // Generate identity key pair (RSA)
      const identityKeyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      // Generate signed pre-key (ECDH)
      const signedPreKeyPair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      // Create signature for signed pre-key using identity key
      const signedPreKeyId = Math.floor(Math.random() * 100000);
      const signedPreKeySignature = crypto.createSign('SHA256');
      signedPreKeySignature.update(signedPreKeyPair.publicKey);
      const signature = signedPreKeySignature.sign(identityKeyPair.privateKey, 'base64');
      
      // Generate one-time pre-keys (ECDH)
      const oneTimePreKeys = [];
      for (let i = 0; i < 20; i++) {
        const preKeyId = Math.floor(Math.random() * 100000);
        const preKeyPair = crypto.generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        
        oneTimePreKeys.push({
          keyId: preKeyId,
          publicKey: preKeyPair.publicKey,
          privateKey: preKeyPair.privateKey
        });
      }
      
      // Store private keys securely
      await mongoose.connection.collection('UserPrivateKeys').updateOne(
        { userId },
        {
          $set: {
            userId,
            identityPrivateKey: identityKeyPair.privateKey,
            signedPreKeyPrivateKey: signedPreKeyPair.privateKey,
            signedPreKeyId,
            oneTimePreKeyPrivateKeys: oneTimePreKeys.map(key => ({
              keyId: key.keyId,
              privateKey: key.privateKey
            })),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      
      // Return public keys for distribution
      return {
        identityKey: identityKeyPair.publicKey,
        signedPreKey: {
          keyId: signedPreKeyId,
          publicKey: signedPreKeyPair.publicKey,
          signature
        },
        oneTimePreKeys: oneTimePreKeys.map(key => ({
          keyId: key.keyId,
          publicKey: key.publicKey
        }))
      };
    } catch (error) {
      logger.error(`Error generating encryption keys: ${error.message}`, { userId });
      throw error;
    }
  }
  
  /**
   * Rotate a user's encryption keys
   * 
   * @param {string} userId - The user ID
   * @returns {Promise<Object>} - The new keys
   */
  static async rotateUserKeys(userId) {
    try {
      // Get the user's existing keys
      const privateKeyDoc = await mongoose.connection.collection('UserPrivateKeys')
        .findOne({ userId });
      
      if (!privateKeyDoc) {
        // If no existing keys, generate fresh ones
        return await this.generateUserKeys(userId);
      }
      
      // Generate new signed pre-key (ECDH)
      const signedPreKeyPair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      // Create signature for signed pre-key using identity key
      const signedPreKeyId = Math.floor(Math.random() * 100000);
      const signedPreKeySignature = crypto.createSign('SHA256');
      signedPreKeySignature.update(signedPreKeyPair.publicKey);
      const signature = signedPreKeySignature.sign(privateKeyDoc.identityPrivateKey, 'base64');
      
      // Generate new one-time pre-keys (ECDH)
      const oneTimePreKeys = [];
      for (let i = 0; i < 20; i++) {
        const preKeyId = Math.floor(Math.random() * 100000);
        const preKeyPair = crypto.generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        
        oneTimePreKeys.push({
          keyId: preKeyId,
          publicKey: preKeyPair.publicKey,
          privateKey: preKeyPair.privateKey
        });
      }
      
      // Update private keys storage
      await mongoose.connection.collection('UserPrivateKeys').updateOne(
        { userId },
        {
          $set: {
            signedPreKeyPrivateKey: signedPreKeyPair.privateKey,
            signedPreKeyId,
            oneTimePreKeyPrivateKeys: oneTimePreKeys.map(key => ({
              keyId: key.keyId,
              privateKey: key.privateKey
            })),
            updatedAt: new Date()
          }
        }
      );
      
      // Update public keys in the relevant stores
      await mongoose.connection.collection('SignalSignedPreKeys').updateOne(
        { userId },
        {
          $set: {
            keyId: signedPreKeyId,
            publicKey: signedPreKeyPair.publicKey,
            signature,
            updatedAt: new Date()
          }
        }
      );
      
      // Remove old pre-keys and add new ones
      await mongoose.connection.collection('SignalPreKeys').deleteMany({ userId });
      
      const preKeyDocs = oneTimePreKeys.map(key => ({
        userId,
        keyId: key.keyId,
        publicKey: key.publicKey,
        createdAt: new Date(),
        used: false
      }));
      
      await mongoose.connection.collection('SignalPreKeys').insertMany(preKeyDocs);
      
      // Get the identity key from storage
      const identityKeyDoc = await mongoose.connection.collection('SignalIdentityKeys')
        .findOne({ userId });
      
      // Return the updated public keys
      return {
        identityKey: identityKeyDoc.identityKey,
        signedPreKey: {
          keyId: signedPreKeyId,
          publicKey: signedPreKeyPair.publicKey,
          signature
        },
        oneTimePreKeys: oneTimePreKeys.map(key => ({
          keyId: key.keyId,
          publicKey: key.publicKey
        }))
      };
    } catch (error) {
      logger.error(`Error rotating encryption keys: ${error.message}`, { userId });
      throw error;
    }
  }
  
  /**
   * Verify the integrity of a message using cryptographic signatures
   * 
   * @param {string} message - The message to verify
   * @param {string} signature - The message signature
   * @param {string} senderPublicKey - The sender's public key
   * @returns {boolean} - Whether the message signature is valid
   */
  static verifyMessageIntegrity(message, signature, senderPublicKey) {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(message);
      return verify.verify(senderPublicKey, signature, 'base64');
    } catch (error) {
      logger.error(`Error verifying message integrity: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Create a secure chat session between users
   * 
   * @param {string} chatId - The chat ID
   * @param {Array<string>} participantIds - Array of participant user IDs
   * @returns {Promise<Object>} - The secure session information
   */
  static async createSecureChatSession(chatId, participantIds) {
    try {
      // Generate a unique session ID
      const sessionId = uuidv4();
      
      // Get public keys for all participants
      const participantKeys = {};
      for (const userId of participantIds) {
        const keys = await this.getUserKeys(userId);
        if (keys) {
          participantKeys[userId] = keys;
        }
      }
      
      // Create a shared secret key for the chat (for group messaging)
      const sharedSecret = crypto.randomBytes(32);
      
      // Encrypt the shared secret for each participant
      const encryptedSecrets = {};
      for (const userId of participantIds) {
        const userKeys = participantKeys[userId];
        if (!userKeys) continue;
        
        const publicKey = Buffer.from(userKeys.identityKey, 'base64');
        
        // Encrypt the shared secret with the user's public key
        const encryptedSecret = crypto.publicEncrypt(
          {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
          },
          sharedSecret
        ).toString('base64');
        
        encryptedSecrets[userId] = encryptedSecret;
      }
      
      // Store the session
      await mongoose.connection.collection('SecureChatSessions').insertOne({
        sessionId,
        chatId,
        participantIds,
        encryptedSecrets,
        createdAt: new Date()
      });
      
      // Return session info (without the actual shared secret)
      return {
        sessionId,
        chatId,
        participantIds,
        established: true,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Error creating secure chat session: ${error.message}`, { chatId });
      throw error;
    }
  }
}

module.exports = SignalProtocol;