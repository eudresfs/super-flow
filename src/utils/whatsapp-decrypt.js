// src/utils/whatsapp-decrypt.js
import axios from 'axios';
import crypto from 'crypto';

export async function decryptWhatsAppImage(fileData) {
  try {
    const encryptedResponse = await axios.get(fileData.cdn_url, {
      responseType: 'arraybuffer'
    });
    
    const encryptedBuffer = Buffer.from(encryptedResponse.data);
    const encryptionKey = Buffer.from(fileData.encryption_metadata.encryption_key, 'base64');
    const iv = Buffer.from(fileData.encryption_metadata.iv, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(encryptedBuffer)]);

  } catch (error) {
    console.error("Erro na descriptografia:", error);
    throw error;
  }
}