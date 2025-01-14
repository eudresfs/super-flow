const { APIClientBase } = require('./apiClient');
const { CONFIG } = require('../config/constants');
const { Logger } = require('../utils/logger');

/**
 * Erro de validação específico para benefícios
 */
class BenefitsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BenefitsValidationError';
  }
}

/**
 * Gerenciador de cache para consultas de benefícios
 */
class BenefitsCache {
  constructor(ttl = 24 * 60 * 60 * 1000) { // 24 horas por padrão
    this.cache = new Map();
    this.TTL = ttl;
  }

  async get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      Logger.info('Cache hit para benefício', { 
        key: key.replace(/\d{6,}/, '***') 
      });
      return cached.data;
    }
    return null;
  }

  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.TTL) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Rate Limiter para controle de requisições
 */
class RateLimiter {
  constructor(limit = 100, interval = 60000) {
    this.requests = [];
    this.limit = limit;
    this.interval = interval;
  }

  async checkLimit() {
    const now = Date.now();
    this.requests = this.requests.filter(
      time => time > now - this.interval
    );

    if (this.requests.length >= this.limit) {
      throw new BenefitsValidationError('Limite de requisições excedido');
    }

    this.requests.push(now);
  }
}

/**
 * Serviço para consulta de benefícios sociais
 */
class BenefitsService extends APIClientBase {
  constructor() {
    super({
      baseURL: CONFIG.TRANSPARENCIA_API.BASE_URL,
      headers: {
        'accept': '*/*',
        'chave-api-dados': CONFIG.TRANSPARENCIA_API.API_KEY
      },
      timeout: 5000,
      maxRetries: 3
    });

    // Configurações de endpoints e períodos
    this.ENDPOINTS = {
      CPF: '/bolsa-familia-disponivel-por-cpf-ou-nis',
      NIS: '/novo-bolsa-familia-sacado-por-nis'
    };

    this.PERIODOS = {
      CPF: ['202106', '202006', '202206', '202306', '202404'],
      NIS: ['202409', '202408', '202407', '202406', '202405', '202404']
    };

    // Inicialização dos serviços
    this.cache = new BenefitsCache();
    this.rateLimiter = new RateLimiter(10, 60000);

    // Configuração da limpeza periódica do cache
    setInterval(() => this.cache.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Valida e limpa o input
   * @private
   */
  #validateInput(codigo, tipo = 'CPF/NIS') {
    if (!codigo) {
      throw new BenefitsValidationError(`${tipo} não informado`);
    }
    return codigo.replace(/\D/g, '');
  }

  /**
   * Valida NIS usando algoritmo específico
   * @private
   */
  #validateNIS(nis) {
    const cleanNIS = this.#validateInput(nis, 'NIS');
    
    if (cleanNIS.length !== 11 || !['1', '2'].includes(cleanNIS[0])) {
      throw new BenefitsValidationError('NIS inválido');
    }

    const multiplicadores = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    
    for (let i = 0; i < 10; i++) {
      soma += parseInt(cleanNIS[i]) * multiplicadores[i];
    }

    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;

    return dv === parseInt(cleanNIS[10]);
  }

  /**
   * Consulta benefícios por CPF
   * @param {string} cpf - CPF do beneficiário
   * @returns {Promise<Array>} Lista de benefícios
   */
  async consultarCPF(cpf) {
    const startTime = Date.now();
    try {
      await this.rateLimiter.checkLimit();
      const cleanCPF = this.#validateInput(cpf, 'CPF');
      const cacheKey = `cpf_${cleanCPF}`;
  
      const cachedData = await this.cache.get(cacheKey);
      if (cachedData) return cachedData;
  
      for (const anoRef of this.PERIODOS.CPF) {
        Logger.info('Consultando benefício', {
          tipo: 'CPF',
          periodo: anoRef,
          duration: Date.now() - startTime
        });
        
        try {
          const { data, error } = await this.get(
            this.ENDPOINTS.CPF,
            {
              params: {
                anoMesCompetencia: anoRef,
                pagina: 1,
                codigo: cleanCPF
              }
            }
          );
          
          if (!error && Array.isArray(data) && data.length > 0) {
            this.cache.set(cacheKey, data);
            return data;
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          Logger.error('Erro na requisição:', {
            status: error.response?.status,
            message: error.message
          });
        }
      }
      
      return [];
    } catch (error) {
      Logger.error('Erro na consulta de CPF', {
        error: error.message,
        stack: error instanceof BenefitsValidationError ? undefined : error.stack,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Consulta benefícios por NIS
   * @param {string} nis - NIS do beneficiário
   * @returns {Promise<Array>} Lista de benefícios
   */
  async consultarNIS(nis) {
    const startTime = Date.now();
    try {
      await this.rateLimiter.checkLimit();
      const cleanNIS = this.#validateInput(nis, 'NIS');
        
      if (!this.#validateNIS(cleanNIS)) {
        throw new BenefitsValidationError('NIS inválido');
      }
   
      const cacheKey = `nis_${cleanNIS}`;
      const cachedData = await this.cache.get(cacheKey);
      if (cachedData) return cachedData;
   
      for (const mes of this.PERIODOS.NIS) {
        Logger.info('Consultando benefício', {
          tipo: 'NIS',
          periodo: mes,
          duration: Date.now() - startTime
        });

        try {
          const { data, error } = await this.get(
            this.ENDPOINTS.NIS,
            {
              params: {
                anoMesReferencia: mes,
                pagina: 1,
                nis: cleanNIS
              }
            }
          );

          if (!error && Array.isArray(data) && data.length > 0) {
            this.cache.set(cacheKey, data);
            return data;
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          Logger.error('Erro na consulta de NIS', {
            error: error.message,
            stack: error instanceof BenefitsValidationError ? undefined : error.stack,
            duration: Date.now() - startTime
          });
        }
      }

      return [];
    } catch (error) {
      Logger.error('Erro na consulta de NIS', {
        error: error.message,
        stack: error instanceof BenefitsValidationError ? undefined : error.stack,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Consulta benefícios por código (CPF ou NIS)
   * @param {string} codigo - Código do beneficiário
   * @returns {Promise<Array>} Lista de benefícios
   */
  async fetchBolsaFamilia(codigo) {
    const startTime = Date.now();
    try {
      const codigoLimpo = this.#validateInput(codigo);
      
      let isNISValid = false;
      try {
        isNISValid = this.#validateNIS(codigoLimpo);
      } catch (e) {
        // Se não for um NIS válido, continua como CPF
      }
      
      Logger.info('Iniciando consulta de benefício', {
        tipo: isNISValid ? 'NIS' : 'CPF',
        timestamp: new Date().toISOString()
      });
  
      const result = isNISValid 
        ? await this.consultarNIS(codigoLimpo)
        : await this.consultarCPF(codigoLimpo);
  
      Logger.info('Consulta finalizada', {
        tipo: isNISValid ? 'NIS' : 'CPF',
        encontrado: result.length > 0,
        duration: Date.now() - startTime
      });
  
      return result;
    } catch (error) {
      Logger.error('Erro na consulta de benefício', {
        error: error.message,
        stack: error instanceof BenefitsValidationError ? undefined : error.stack,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }
}

module.exports = {
  BenefitsService,
  BenefitsValidationError
};