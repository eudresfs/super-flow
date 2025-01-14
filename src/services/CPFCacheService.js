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

// Criar instância
const cpfCache = new CPFCacheService();

// Exportar a instância
module.exports = cpfCache;