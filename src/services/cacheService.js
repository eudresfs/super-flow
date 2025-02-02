// CPFCacheService.js
const { Logger } = require('../utils/logger');

class CPFCacheService {
    constructor() {
      this.cache = new Map();
      this.CACHE_TTL = 1000 * 60 * 30; // 30 minutos
      this.MAX_CACHE_SIZE = 10000; // Limite de 10k entradas
    }
  
    generateKey(cpf) {
      return `cpf_${cpf}`;
    }
  
    get(cpf) {
      const key = this.generateKey(cpf);
      const cached = this.cache.get(key);
      
      if (!cached) return null;
  
      if (Date.now() > cached.expiresAt) {
        this.cache.delete(key);
        return null;
      }
  
      Logger.debug('Cache hit', { cpf: cpf.substr(0, 4) + '***' });
      return cached.data;
    }
  
    set(cpf, data) {
      // Limpa cache se atingiu limite
      if (this.cache.size >= this.MAX_CACHE_SIZE) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
  
      const key = this.generateKey(cpf);
      this.cache.set(key, {
        data,
        expiresAt: Date.now() + this.CACHE_TTL
      });
  
      Logger.debug('Cache set', { cpf: cpf.substr(0, 4) + '***' });
    }
  
    clear() {
      this.cache.clear();
      Logger.info('Cache cleared');
    }
}

class CEPCacheService {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 1000 * 60 * 60 * 24; // 24 horas, já que CEP muda raramente
    this.MAX_CACHE_SIZE = 5000; // Limite de 5k entradas
  }

  generateKey(cep) {
    return `cep_${cep.replace(/\D/g, '')}`;
  }

  get(cep) {
    const key = this.generateKey(cep);
    const cached = this.cache.get(key);
    
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    Logger.debug('Cache CEP hit', { cep });
    return cached.data;
  }

  set(cep, data) {
    // Limpa cache se atingiu limite
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const key = this.generateKey(cep);
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL
    });

    Logger.debug('Cache CEP set', { cep });
  }

  clear() {
    this.cache.clear();
    Logger.info('Cache CEP cleared');
  }
}

// Criar instância
const cpfCache = new CPFCacheService();
const cepCache = new CEPCacheService();

// Exportar a instância
module.exports = {
  cpfCache,
  cepCache
};