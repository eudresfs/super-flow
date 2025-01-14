// src/config/constants.js

const CONFIG = {
  // Configurações de API
  BRASIL_API: {
    baseURL: 'https://brasilapi.com.br/api',
    timeout: 10000,  // aumentado para 10 segundos
    maxRetries: 3,
    retryDelay: 1000,
    headers: {
      'User-Agent': 'Flows/2.0'
    }
},

  // Operation Settings
  OPERATION: {
    TIMEOUT: 30000,
    ADDRESS_TIMEOUT: 45000,               // 30 segundos para timeout geral
    MAX_RETRIES: 3,               // número máximo de tentativas
    RETRY_DELAY: 2000,            // delay entre tentativas
  },

  TRANSPARENCIA_API: {
    BASE_URL: process.env.TRANSPARENCIA_API_URL || 'https://api.portaldatransparencia.gov.br/api-de-dados',
    API_KEY: process.env.API_KEY,
    TIMEOUT: 100000
  },

  CRM: {
    BASE_URL: process.env.CRM_API_URL || 'https://ms-crm-az.kemosoft.com.br',
    API_KEY: process.env.CRM_API_KEY,
    TIMEOUT: 80000
  },

  // Cloudinary
  CLOUDINARY: {
    CLOUD_NAME: 'consigmais',
    API_KEY: '849353588224476',
    UPLOAD_PRESET: 'bolsa_familia_preset',
    TIMEOUT: 150000,
    FOLDER: 'bolsa-familia'
  },

  // Cache
  CACHE: {
    CEP_TTL: 24 * 60 * 60 * 1000,          // 24 horas
    BENEFITS_TTL: 30 * 60 * 1000,          // 30 minutos
    DOCUMENTS_TTL: 60 * 60 * 1000          // 1 hora
  },

  // Rate Limiting
  RATE_LIMIT: {
    WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,  // 1 minuto
    MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    IP_WINDOW: 60000,
    IP_MAX_REQUESTS: 1000
  },

  // Circuit Breaker
  CIRCUIT_BREAKER: {
    FAILURE_THRESHOLD: 5,
    RESET_TIMEOUT: 60000,                   // 1 minuto
    SUCCESS_THRESHOLD: 2
  },

  // Request
  REQUEST: {
    TIMEOUT: 30000,              // corrigido para 30 segundos
    MAX_RETRIES: 3,
    MAX_PAYLOAD_SIZE: '10mb'
  },

  // Validation
  VALIDATION: {
    MIN_NAME_LENGTH: 3,
    MAX_NAME_LENGTH: 100,
    CPF_LENGTH: 11,
    CEP_LENGTH: 8,
    PHONE_LENGTH: 11
  },

  // Logging
  LOGGING: {
    LEVEL: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    MAX_FILE_SIZE: 5242880,                // 5MB
    MAX_FILES: 5,
    SANITIZE_FIELDS: ['cpf', 'telefone', 'rg', 'nis']
  },

  // Endpoints
  ENDPOINTS: {
    HEALTH_CHECK: '/health',
    MAIN: '/',
    DOCS: '/docs'
  },

  // Error Messages
  ERRORS: {
    VALIDATION: {
      CPF_INVALID: '⚠️ CPF inválido',
      NAME_INVALID: '⚠️ Nome inválido',
      CEP_INVALID: '⚠️ CEP inválido',
      NIS_INVALID: '⚠️ NIS inválido'
    },
    SYSTEM: {
      RATE_LIMIT: 'Limite de requisições excedido',
      CIRCUIT_OPEN: 'Serviço temporariamente indisponível',
      TIMEOUT: 'Tempo limite excedido'
    }
  },

  // Flow Screens
  SCREENS: {
    SIGNUP: 'signup',
    INFORMATION: 'information',
    ACCOUNT: 'account',
    DOCUMENT_RG: 'document_rg',
    RESIDENCE: 'residencia',
    COMPLETE: 'complete'
  }
};

// Configurações específicas por ambiente
const ENV_CONFIG = {
  development: {
    LOGGING: {
      LEVEL: 'debug',
      CONSOLE: true,
      FILE: false
    }
  },
  production: {
    LOGGING: {
      LEVEL: 'info',
      CONSOLE: false,
      FILE: true
    }
  }
};

// Helper para pegar configuração baseada no ambiente
module.exports = {
  CONFIG,
  getEnvConfig: () => {
      const env = process.env.NODE_ENV || 'development';
      return ENV_CONFIG[env];
  }
};