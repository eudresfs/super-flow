const axios = require('axios');
const { Logger } = require('../utils/logger');
const { CONFIG } = require('../config/constants');

/**
 * Erro de validação específico para endereços
 */
class AddressValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AddressValidationError';
  }
}

/**
 * Interface de cache para dados de CEP
 */
class CepCache {
  constructor(ttl = 24 * 60 * 60 * 1000) { // 24 horas por padrão
    this.cache = new Map();
    this.TTL = ttl;
  }

  getKey(cep) {
    return `cep_${cep}`;
  }

  async get(cep) {
    const cached = this.cache.get(this.getKey(cep));
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      Logger.info('Cache hit para CEP', { 
        cep: cep.substr(0, 5) + '-***' 
      });
      return cached.data;
    }
    return null;
  }

  set(cep, data) {
    this.cache.set(this.getKey(cep), {
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
 * Serviço para busca e validação de endereços
 */
class AddressService {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'https://brasilapi.com.br/api';
    this.timeout = config.timeout || 5000;
    this.retries = config.retries || 3;
    this.cache = new CepCache(config.cacheTTL);

    // Headers padrão para requisições
    this.headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      ...config.headers
    };

    // Configuração do cliente HTTP
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: this.headers
    });

    // Configura interceptadores para logging
    this.setupInterceptors();
  }

  /**
   * Configura interceptadores para logging de requisições
   * @private
   */
  setupInterceptors() {
    this.client.interceptors.request.use(
      (config) => {
        Logger.info('API Request', {
          method: config.method,
          url: config.url,
          timestamp: new Date().toISOString()
        });
        return config;
      },
      (error) => {
        Logger.error('Request error', {
          error: error.message,
          stack: error.stack
        });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        Logger.info('API Response success', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        Logger.error('API Response error', {
          status: error.response?.status,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Valida formato do CEP
   * @private
   */
  #validateCEP(cep) {
    if (!cep) {
      throw new AddressValidationError('CEP não informado');
    }
    
    const cepClean = this.#formatCEP(cep);
    if (!/^\d{8}$/.test(cepClean)) {
      throw new AddressValidationError('Formato de CEP inválido');
    }

    return cepClean;
  }

  /**
   * Remove caracteres não numéricos do CEP
   * @private
   */
  #formatCEP(cep) {
    return cep.replace(/\D/g, '');
  }

  /**
   * Formata os dados de endereço recebidos da API
   * @private
   */
  #formatAddressData(data, cep) {
    return {
      cep,
      state: data.state.trim().toUpperCase(),
      city: data.city,
      neighborhood: data.neighborhood || '',
      street: data.street || '',
      service: 'BRASIL_API'
    };
  }

  /**
   * Busca dados de um CEP
   * @param {string} cep - CEP a ser consultado
   * @returns {Promise<Object>} Dados do endereço ou erro
   */
  async fetchCEPData(cep) {
    const startTime = Date.now();
    
    try {
      Logger.info('Iniciando busca de CEP', { 
        cep: cep.substr(0, 5) + '-***',
        timestamp: new Date().toISOString() 
      });

      const cepFormatted = this.#validateCEP(cep);
      
      // Verifica cache
      const cachedData = await this.cache.get(cepFormatted);
      if (cachedData) return cachedData;

      // Faz a requisição
      const response = await this.client.get(`cep/v1/${cepFormatted}`);
      const data = response.data;

      if (!data || !data.state || !data.city) {
        throw new AddressValidationError('Dados de endereço incompletos');
      }

      const formattedData = this.#formatAddressData(data, cepFormatted);

      Logger.info('Dados do CEP obtidos com sucesso', {
        cep: cepFormatted.substr(0, 5) + '-***',
        state: formattedData.state,
        duration: Date.now() - startTime
      });

      // Salva no cache
      this.cache.set(cepFormatted, formattedData);

      return formattedData;

    } catch (error) {
      Logger.error('Erro ao processar CEP', {
        cep: cep.substr(0, 5) + '-***',
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });

      if (error instanceof AddressValidationError) {
        return { error: `⚠️ ${error.message}` };
      }

      return { 
        error: "⚠️ Erro ao consultar CEP. Por favor, tente novamente.",
        details: error.message
      };
    }
  }

  /**
   * Limpa o cache do serviço
   */
  clearCache() {
    this.cache.cleanup();
  }
}

module.exports = {
  AddressService,
  AddressValidationError
};