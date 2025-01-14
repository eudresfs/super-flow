const crypto = require('crypto');
const { Logger } = require('./utils/logger');

class FlowEndpointException extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

const decryptRequest = (body, privatePem, passphrase) => {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  
  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new FlowEndpointException(400, 'Missing required encryption parameters');
  }

  // Create private key instance for this request
  let requestPrivateKey;
  try {
    requestPrivateKey = crypto.createPrivateKey({ 
      key: privatePem, 
      passphrase 
    });
  } catch (error) {
    Logger.error('Failed to create private key for request', {
      error: error.message,
      code: error.code
    });
    throw new FlowEndpointException(
      421,
      "Failed to initialize decryption. Invalid private key or passphrase."
    );
  }

  // Decrypt AES key
  let decryptedAesKey;
  try {
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: requestPrivateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
        mgf1Hash: "sha256"
      },
      Buffer.from(encrypted_aes_key, "base64")
    );
  } catch (error) {
    Logger.error('Failed to decrypt AES key', {
      error: error.message,
      code: error.code
    });
    throw new FlowEndpointException(
      421,
      "Failed to decrypt the request. Please verify your private key."
    );
  }

  // Process encrypted flow data
  try {
    const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
    const initialVectorBuffer = Buffer.from(initial_vector, "base64");
    const TAG_LENGTH = 16;
    
    const encrypted_flow_data_body = flowDataBuffer.subarray(0, -TAG_LENGTH);
    const encrypted_flow_data_tag = flowDataBuffer.subarray(-TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(
      "aes-128-gcm",
      decryptedAesKey,
      initialVectorBuffer
    );
    
    decipher.setAuthTag(encrypted_flow_data_tag);
    
    const decryptedJSONString = Buffer.concat([
      decipher.update(encrypted_flow_data_body),
      decipher.final(),
    ]).toString("utf-8");
    
    return {
      decryptedBody: JSON.parse(decryptedJSONString),
      aesKeyBuffer: decryptedAesKey,
      initialVectorBuffer,
    };
  } catch (error) {
    Logger.error('Failed to decrypt flow data', {
      error: error.message,
      code: error.code
    });
    throw new FlowEndpointException(
      421,
      "Failed to decrypt the request data. Data may be corrupted."
    );
  }
};

const encryptResponse = (response, aesKeyBuffer, initialVectorBuffer) => {
  if (!aesKeyBuffer || !initialVectorBuffer) {
    throw new FlowEndpointException(500, 'Missing encryption parameters for response');
  }

  try {
    // Flip IV bits as in original implementation
    const flipped_iv = [];
    for (const pair of initialVectorBuffer.entries()) {
      flipped_iv.push(~pair[1]);
    }
    
    const cipher = crypto.createCipheriv(
      "aes-128-gcm",
      aesKeyBuffer,
      Buffer.from(flipped_iv)
    );
    
    return Buffer.concat([
      cipher.update(JSON.stringify(response), "utf-8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  } catch (error) {
    Logger.error('Failed to encrypt response', {
      error: error.message,
      code: error.code
    });
    throw new FlowEndpointException(
      500,
      "Failed to encrypt the response"
    );
  }
};

module.exports = {
  decryptRequest,
  encryptResponse,
  FlowEndpointException
};