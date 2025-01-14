import express from "express";
import { decryptRequest, encryptResponse } from "./encryption.js";
import { FlowManager } from "./flow.js";
import crypto from "crypto";
import dotenv from 'dotenv';
import { Logger } from './utils/logger.js';
import { CONFIG } from './config/constants.js';

const flowManager = new FlowManager();

class ServerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ServerError';
    this.code = code;
  }
}

class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}

dotenv.config();

// Rate limiting
const rateLimiter = new Map();
const RATE_LIMIT = {
  WINDOW: 60000, // 1 minuto
  MAX_REQUESTS: 100
};

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimiter.get(ip) || { count: 0, timestamp: now };

  if (now - userRequests.timestamp < RATE_LIMIT.WINDOW) {
    if (userRequests.count >= RATE_LIMIT.MAX_REQUESTS) {
      throw new SecurityError('Rate limit exceeded');
    }
    userRequests.count++;
  } else {
    userRequests.count = 1;
    userRequests.timestamp = now;
  }
  
  rateLimiter.set(ip, userRequests);
}

// Limpeza periódica do rate limiter
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimiter.entries()) {
    if (now - data.timestamp >= RATE_LIMIT.WINDOW) {
      rateLimiter.delete(ip);
    }
  }
}, RATE_LIMIT.WINDOW);

async function validateEnvironment() {
  const required = ['APP_SECRET', 'PRIVATE_KEY', 'PORT'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length) {
    throw new ServerError(
      `Missing environment variables: ${missing.join(', ')}`,
      'ENV_ERROR'
    );
  }

  try {
    crypto.createPrivateKey({
      key: process.env.PRIVATE_KEY,
      format: 'pem',
      type: 'pkcs8',
      passphrase: process.env.PASSPHRASE || ""
    });
    Logger.info('✅ Private Key carregada com sucesso');
  } catch (error) {
    throw new ServerError('Invalid private key', 'KEY_ERROR');
  }
}

const app = express();

// Middlewares
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf?.toString(encoding || "utf8");
  },
  limit: '10mb' // Limite de tamanho da requisição
}));

app.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

// Middleware de validação de assinatura
function validateSignature(req) {
  const signature = req.get("x-hub-signature-256");
  if (!signature) {
    throw new SecurityError("Missing signature");
  }

  const hmac = crypto.createHmac("sha256", process.env.APP_SECRET);
  const expectedSignature = `sha256=${hmac.update(req.rawBody).digest('hex')}`;

  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )) {
    throw new SecurityError("Invalid signature");
  }
}

app.post("/", async (req, res) => {
  const requestId = crypto.randomBytes(16).toString('hex');
  
  try {
    // Rate limiting por IP
    checkRateLimit(req.ip);

    // Validação de assinatura
    validateSignature(req);

    // Descriptografia
    const decryptedRequest = await decryptRequest(
      req.body,
      process.env.PRIVATE_KEY,
      process.env.PASSPHRASE
    );

    Logger.info('Requisição recebida', {
      requestId,
      action: decryptedRequest.decryptedBody.action,
      timestamp: new Date().toISOString()
    });

    // Processamento
    const screenResponse = await flowManager.getNextScreen(decryptedRequest.decryptedBody);

    // Resposta
    const encryptedResponse = encryptResponse(
      screenResponse,
      decryptedRequest.aesKeyBuffer,
      decryptedRequest.initialVectorBuffer
    );

    Logger.info('Requisição completa', {
      requestId,
      duration: Date.now() - req.startTime,
      action: decryptedRequest.decryptedBody.action,
      screen: screenResponse.screen
    });

    res.send(encryptedResponse);

  } catch (error) {
    Logger.error('Requisição falhou', {
      requestId,
      error: error.message,
      code: error.code,
      duration: Date.now() - req.startTime
    });
    
    res.status(200).send();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Inicialização do servidor
async function startServer() {
  try {
    await validateEnvironment();
    
    const server = app.listen(process.env.PORT, () => {
      Logger.info(`Server iniciado na porta: ${process.env.PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      Logger.info('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        Logger.info('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    Logger.error('Server startup failed', { error: error.message });
    process.exit(1);
  }
}

startServer();