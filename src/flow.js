/**
 * @fileoverview Gerencia os fluxos de processamento de ações, incluindo funcionalidades de rate limiting, retry com backoff,
 * timeout e integração com telemetria.
 *
 * Este módulo gerencia os fluxos de execução a partir do payload recebido. Realiza as seguintes operações:
 *    - Validação básica e específica do payload.
 *    - Controle de taxa (Rate Limiting) para evitar sobrecarga.
 *    - Mecanismo de retry com backoff exponencial.
 *    - Execução de operações com timeout e registro detalhado (logs).
 *    - Gerenciamento dos controllers para diferentes fluxos: "bolsa-familia", "gov-ce", "fgts", "inss" e "padrao".
 *    - Integração com o Circuit Breaker e Telemetria para monitoramento e resiliência.
 *
 * Dependências:
 *    - INSSController, FGTSController, GovCEController, BFController, CommonController: Controllers responsáveis pelos fluxos.
 *    - Logger: Utilitário para geração de logs.
 *    - CircuitBreaker: Implementação de circuit breaker para tratamento de falhas.
 *    - CONFIG: Configurações globais de operação e rate limiting.
 *    - telemetry: Serviço de telemetria para rastreamento de métricas e eventos.
 *
 * @module flow
 */

const INSSController = require('./controllers/INSSController');
const FGTSController = require('./controllers/FGTSController');
const GovCEController = require('./controllers/GovCEController');
const BFController = require('./controllers/BFController');
const CommonController = require('./controllers/CommonController');
const { Logger } = require('./utils/logger');
const { CONFIG } = require('./config/constants');
const { CircuitBreaker } = require('./utils/circuitBreaker'); 
const { telemetry } = require('./services/telemetryService');

const INITIAL_SCREENS = {
  'bolsa-familia': 'front',
  'gov-ce': 'FRONT',
  'fgts': 'front',
  'inss': 'opportunities', 
  'siape': '',
  'padrao': 'front'
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
      'gov-ce': new GovCEController(),
      'fgts': new FGTSController(),
      'inss': new INSSController(),
      'padrao': new CommonController()
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

  // Retry mechanism com backoff exponencial configurável
  async #withRetry(operation, maxRetries = CONFIG.OPERATION.RETRY_MAX || 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }

  // Executa a operação com timeout e log caso o tempo limite seja atingido
  #executeWithTimeout(operationPromise, timeoutDuration, startTime, action, screen) {
    return Promise.race([
      operationPromise,
      new Promise((_, reject) =>
        setTimeout(() => {
          Logger.warn('Operação atingiu timeout', {
            duration: Date.now() - startTime,
            action,
            screen
          });
          reject(new Error('Operation timed out'));
        }, timeoutDuration)
      )
    ]);
  }

  // Formata a resposta de erro de validação de forma padronizada
  #formatErrorResponse(error, payload, controller) {
    return controller.createResponse(payload.screen || 'error', {}, {
      flow_token: payload.flow_token,
      version: payload.version,
      error: true,
      errorMessage: error.message
    });
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

    telemetry.trackCustomEvent('FlowExecution', {
      flowType,
      action: decryptedBody.action,
      screen: decryptedBody.screen
    });

      // Validações
      validators.validateBasicPayload(decryptedBody);
      validators.validateScreenPayload(decryptedBody);
      this.#checkRateLimit(decryptedBody.flow_token);

      telemetry.trackCustomMetric('RateLimit', this.#rateLimit.get(decryptedBody.flow_token)?.count || 0);

      const { action, flow_token, version, data, screen } = decryptedBody;

      // Circuit
      return await this.circuitBreaker.execute(async () => {
        telemetry.trackDependency('ScreenHandler', {
          target: decryptedBody.screen,
          duration: Date.now() - startTime,
          success: true,
          dependencyTypeName: 'Flow'
        });
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

      const result = await this.#executeWithTimeout(operationPromise, timeoutDuration, startTime, action, screen);

        telemetry.trackScreenTransition(
          decryptedBody.screen,
          result.screen,
          { flowType, startTime }
        );

        return result;
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

    telemetry.trackScreenError(decryptedBody.screen || 'unknown', error, {
      flowType,
      action: decryptedBody.action
    });

      if (error instanceof ValidationError) {
        return this.#formatErrorResponse(error, decryptedBody, controller);
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

exports.getNextScreen = (decryptedBody, flowType = 'padrao') => {
  return flowManager.getNextScreen(decryptedBody, flowType);
};