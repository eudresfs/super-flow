// src/services/TokenCacheService.js
const { Logger } = require('../utils/logger');

class TokenCacheService {
    constructor() {
        this._token = null;
        this._timestamp = null;
        this._expiresIn = 55 * 60 * 1000;
    }

    set token(value) {
        this._token = value;
        this._timestamp = Date.now();
        Logger.info('Token armazenado em cache');
    }

    get token() {
        if (!this._token || !this._timestamp) {
            Logger.debug('Token não encontrado no cache');
            return null;
        }

        const elapsed = Date.now() - this._timestamp;
        if (elapsed > this._expiresIn) {
            Logger.info('Token expirado', {
                elapsed: Math.floor(elapsed / 1000),
                limit: Math.floor(this._expiresIn / 1000)
            });
            this.clear();
            return null;
        }

        Logger.debug('Token recuperado do cache');
        return this._token;
    }

    clear() {
        this._token = null;
        this._timestamp = null;
        Logger.info('Cache do token limpo');
    }

    get isValid() {
        return !!this.token;
    }
}

// Criar instância única
const tokenCache = new TokenCacheService();

// Congelar o objeto para evitar modificações
Object.freeze(tokenCache);

module.exports = tokenCache;