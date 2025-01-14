const { BFController } = require('./controllers/bf_controller');
const { GovCEController } = require('./controllers/gov_ce_controller');
/* const { INSSController } = require('./controllers/inss_controller');
const { FGTSController } = require('./controllers/fgts_controller');
const { SIAPEController } = require('./controllers/siape_controller'); */
const { Logger } = require('./utils/logger');
const { CONFIG } = require('./config/constants');
const { CircuitBreaker } = require('./utils/circuitBreaker');


const INITIAL_SCREENS = {
  'bolsa-familia': 'front',
  'gov-ce': 'BOAS_VINDAS',
  'fgts': '', 
  'inss': '', 
  'siape': ''
};


// Validadores
const validators = {
  validateBasicPayload: (payload) => {
    const required = ['action', 'version'];
    const missing = required.filter(field => !payload[field]);
    if (missing.length) {
      throw new ValidationError(`Campos obrigatórios faltando: ${missing.join(', ')}`);
    }
  },

  validateScreenPayload: (payload) => {
    if (!['INIT', 'ping'].includes(payload.action) && !payload.screen) {
      throw new ValidationError('Screen é obrigatória para esta ação');
    }
  }
};

// Hierarquia de erros
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

class FlowError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FlowError';
    this.code = code;
  }
}

class FlowManager {
  constructor() {
    this.controllers = {
      'bolsa-familia': new BFController(),
      'gov-ce': new GovCEController()
    };
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000
    });
  }

  // Rate limiting
  #rateLimit = new Map();
  #checkRateLimit(flowToken) {
    const now = Date.now();
    const limit = this.#rateLimit.get(flowToken);
    if (limit && now - limit.timestamp < CONFIG.RATE_LIMIT_WINDOW) {
      if (limit.count >= CONFIG.RATE_LIMIT_MAX) {
        throw new FlowError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
      }
      limit.count++;
    } else {
      this.#rateLimit.set(flowToken, { count: 1, timestamp: now });
    }
  }

  // Retry mechanism
  async #withRetry(operation, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }

  async getNextScreen(decryptedBody, flowType) {
    if (!flowType) {
      throw new Error('Flow type is required');
    }

    const controller = this.controllers[flowType];
    if (!controller) {
      throw new Error(`Flow type not found: ${flowType}`);
    }

    const startTime = Date.now();
    try {
      // Log detalhado do payload recebido
      Logger.info('Payload recebido', {
        action: decryptedBody.action,
        screen: decryptedBody.screen,
        flow_token: decryptedBody.flow_token,
        hasData: !!decryptedBody.data,
        data: decryptedBody.data
    });

      // Validações
      validators.validateBasicPayload(decryptedBody);
      validators.validateScreenPayload(decryptedBody);
      this.#checkRateLimit(decryptedBody.flow_token);

      const { action, flow_token, version, data, screen } = decryptedBody;

      // Circuit
      return await this.circuitBreaker.execute(async () => {
        // Timeout
        // Log antes do timeout
        Logger.info('Iniciando execução da operação', {
          action,
          screen,
          timestamp: Date.now()
      });

      // Adicionar timeout maior para a tela de endereço
      const timeoutDuration = decryptedBody.screen === 'address' ? 
        CONFIG.OPERATION.ADDRESS_TIMEOUT || 45000 : 
        CONFIG.OPERATION.TIMEOUT || 30000;

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => {
          Logger.warn('Operação atingiu timeout', {
            duration: Date.now() - startTime,
            action: decryptedBody.action,
            screen: decryptedBody.screen
          });
          reject(new Error('Operation timed out'));
        }, timeoutDuration)
      );

      const operationPromise = this.#withRetry(async () => {
        if (action === "INIT") {
            const initialScreen = INITIAL_SCREENS[flowType] || 'front'; // fallback para front
            return controller.createResponse(
                initialScreen,
                { message: "Inicialização bem-sucedida" },
                { flow_token, version }
            );
        }
    
        if (action === "ping") {
            return {
                data: {
                    status: "active",
                    timestamp: new Date().toISOString()
                }
            };
        }
    
        if (action === "data_exchange") {
          const handler = await controller.getHandler(screen);
          if (!handler) {
              Logger.warn('Handler não encontrado para tela', { screen });
              return controller.createResponse(screen, data, { 
                  flow_token, 
                  version,
                  error: true,
                  errorMessage: `Handler não encontrado para tela: ${screen}`
              });
          }
            return await handler(data, flow_token, version);
        }
    
        // Se nenhuma ação corresponder
        throw new Error(`Ação não suportada: ${action}`);
    });

        return Promise.race([operationPromise, timeoutPromise]);
      });

    } catch (error) {
      // Error handling
      Logger.error('Erro no processamento', {
        error: error.message,
        code: error.code,
        stack: error.stack,
        duration: Date.now() - startTime,
        action: decryptedBody.action,
        screen: decryptedBody.screen
    });

      if (error instanceof ValidationError) {
        return this.bf_controller.createResponse(decryptedBody.screen || 'error', {}, {
          flow_token: decryptedBody.flow_token,
          version: decryptedBody.version,
          error: true,
          errorMessage: error.message
        });
      }

      throw error;
    } finally {
      // Performance logging
      Logger.info('Processamento finalizado', {
        duration: Date.now() - startTime,
        action: decryptedBody.action,
        screen: decryptedBody.screen,
        timestamp: Date.now()
      });
    }
  }
}

const flowManager = new FlowManager();

exports.getNextScreen = (decryptedBody, flowType = 'bolsa-familia') => {
  return flowManager.getNextScreen(decryptedBody, flowType);
};