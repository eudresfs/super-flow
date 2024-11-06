import express from "express";
import { decryptRequest, encryptResponse, FlowEndpointException } from "./encryption.js";
import { getNextScreen } from "./flow.js";
import crypto from "crypto";

const app = express();
const { APP_SECRET, PRIVATE_KEY, PASSPHRASE = "", PORT = "3000" } = process.env;

app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf?.toString(encoding || "utf8");
    },
  }),
);

app.post("/", async (req, res) => {
  // Verificação da chave privada
  if (!PRIVATE_KEY) {
    console.error('Private key is empty. Check your "PRIVATE_KEY" environment variable.');
    return res.status(200).send(); // Retornando 200 conforme instrução
  }

  // Verificação da assinatura da requisição
  if (!isRequestSignatureValid(req)) {
    console.error("Invalid request signature.");
    return res.status(200).send(); // Retornando 200 conforme instrução
  }

  let decryptedRequest;
  try {
    decryptedRequest = decryptRequest(req.body, PRIVATE_KEY, PASSPHRASE);
  } catch (err) {
    console.error("Decryption failed:", err);
    return res.status(200).send(); // Retornando 200 conforme instrução
  }

  const { aesKeyBuffer, initialVectorBuffer, decryptedBody } = decryptedRequest;
  console.log("💬 Decrypted Request:", decryptedBody);

  try {
    const screenResponse = await getNextScreen(decryptedBody);
    console.log("👉 Response to Encrypt:", screenResponse);

    res.send(encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer));
  } catch (err) {
    console.error("Error processing request:", err);
    res.status(200).send(); // Retornando 200 conforme instrução
  }
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});

// Função para verificação da assinatura da requisição
function isRequestSignatureValid(req) {
  if(!APP_SECRET) {
    console.warn("App Secret is not set up.");
    return true;
  }

  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader) {
    console.error("Signature header missing.");
    return false;
  }

  const signatureBuffer = Buffer.from(signatureHeader.replace("sha256=", ""), "utf-8");

  const hmac = crypto.createHmac("sha256", APP_SECRET);
  const digestString = hmac.update(req.rawBody).digest('hex');
  const digestBuffer = Buffer.from(digestString, "utf-8");

  console.log("Calculated digest:", digestString);
  console.log("Signature from header:", signatureHeader);

  if (!crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
    console.error("Error: Request Signature did not match");
    return false;
  }
  return true;
}
