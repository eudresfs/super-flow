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
 const startTime = Date.now();
 const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
 
 if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
   throw new FlowEndpointException(400, 'Missing required encryption parameters');
 }

 try {
   // Create private key instance for this request
   let requestPrivateKey = crypto.createPrivateKey({ 
     key: privatePem, 
     passphrase 
   });

   // Decrypt AES key
   const decryptedAesKey = crypto.privateDecrypt(
     {
       key: requestPrivateKey,
       padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
       oaepHash: "sha256",
       mgf1Hash: "sha256"
     },
     Buffer.from(encrypted_aes_key, "base64")
   );

   // Process encrypted flow data
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
   
   const result = {
     decryptedBody: JSON.parse(decryptedJSONString),
     aesKeyBuffer: decryptedAesKey,
     initialVectorBuffer,
   };

   return result;

 } catch (error) {
   Logger.error('Failed to decrypt data', {
     error: error.message,
     code: error.code
   });

   throw new FlowEndpointException(
     421,
     "Failed to decrypt the request. Please verify your data."
   );
 }
};

const encryptResponse = (response, aesKeyBuffer, initialVectorBuffer) => {
 const startTime = Date.now();

 if (!aesKeyBuffer || !initialVectorBuffer) {
   throw new FlowEndpointException(500, 'Missing encryption parameters for response');
 }

 try {
   const flipped_iv = [];
   for (const pair of initialVectorBuffer.entries()) {
     flipped_iv.push(~pair[1]);
   }
   
   const cipher = crypto.createCipheriv(
     "aes-128-gcm",
     aesKeyBuffer,
     Buffer.from(flipped_iv)
   );
   
   const result = Buffer.concat([
     cipher.update(JSON.stringify(response), "utf-8"),
     cipher.final(),
     cipher.getAuthTag(),
   ]).toString("base64");

   return result;

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