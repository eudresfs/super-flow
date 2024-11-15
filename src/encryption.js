import crypto from "crypto";



try {
  const privateKey = crypto.createPrivateKey({ 
    key: process.env.PRIVATE_KEY,
    passphrase: process.env.PASSPHRASE
  });
  console.log("Chave carregada com sucesso");
} catch (e) {
  console.error("Erro ao carregar chave:", e);
}

export const decryptRequest = (body, privatePem, passphrase) => {
  console.log("Request body:", body);
  
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  const privateKey = crypto.createPrivateKey({ key: privatePem, passphrase });
  let decryptedAesKey = null;

  try {
    console.log("Encrypted AES key (base64):", encrypted_aes_key);
    
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
        mgf1Hash: "sha256"  // Adicionando hash explícito para MGF1
      },
      Buffer.from(encrypted_aes_key, "base64")
    );
    
    console.log("AES key decrypted successfully");
  } catch (error) {
    console.error(error);
    throw new FlowEndpointException(
      421,
      "Failed to decrypt the request. Please verify your private key."
    );
  }

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
};

export const encryptResponse = (response, aesKeyBuffer, initialVectorBuffer) => {
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
};

export const FlowEndpointException = class FlowEndpointException extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
};