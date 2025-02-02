const axios = require('axios');
const crypto = require('crypto');
const { Logger } = require('../utils/logger');
const FormData = require('form-data');
const { CONFIG } = require('../config/constants');

/**
 * @fileoverview Cliente API para integração com CRM e serviços externos
 * 
 * Este módulo fornece uma interface unificada para todas as operações de API,
 * incluindo:
 * - Gestão de leads e contatos
 * - Upload e processamento de documentos
 * - Integração com serviços de validação
 * - Cache e rate limiting
 * 
 * @module apiClient
 */

// Hierarquia de erros
class APIError extends Error {
  constructor(message, code, originalError = null) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.originalError = originalError;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Cache implementação
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Rate limiter
class RateLimiter {
  constructor(limit = 100, interval = 60000) {
    this.limit = limit;
    this.interval = interval;
    this.requests = [];
  }

  async checkLimit() {
    const now = Date.now();
    this.requests = this.requests.filter(time => time > now - this.interval);
    if (this.requests.length >= this.limit) {
      throw new APIError('Rate limit exceeded', 'RATE_LIMIT');
    }
    this.requests.push(now);
  }
}

const rateLimiter = new RateLimiter();

// Função utilitária para retry
async function withRetry(operation, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === retries) throw error;
      const delay = Math.min(200 * Math.pow(2, attempt), 1000);
      await new Promise(resolve => setTimeout(resolve, delay));
      Logger.info(`Retry attempt ${attempt} after ${delay}ms`);
    }
  }
}

// Configurações de cache por rota
const ROUTE_CONFIG = {
  'proxima-etapa': {
    cache: false,
    timeout: 5000,
    retries: 3
  },
  'requalify': {
    cache: false,
    timeout: 8000,
    retries: 2
  },
  'registrar-arquivo': {
    cache: false,
    timeout: 10000,
    retries: 2
  },
  'lead': {
    cache: false,
    timeout: 10000,
    retries: 2
  },
  'default': {
    cache: true,
    ttl: 5 * 60 * 1000,
    timeout: CONFIG.REQUEST_TIMEOUT,
    retries: 3
  }
};

const getRouteConfig = (url) => {
  const route = Object.keys(ROUTE_CONFIG).find(route => url.includes(route));
  return ROUTE_CONFIG[route] || ROUTE_CONFIG.default;
};

// Função principal de requisição usando proxy
const makeRequest = async (method, url, data = null, additionalHeaders = {}) => {
  const startTime = Date.now();
  await rateLimiter.checkLimit();
  
  const routeConfig = getRouteConfig(url);
  const cacheKey = `${method}:${url}:${JSON.stringify(data)}`;
  const formattedUrl = url.startsWith('http') ? url : `${process.env.CRM_API_URL}${url}`;
  const proxyUrl = "https://proxy-logger.azurewebsites.net/api/ProxyLogger";
  
  if (routeConfig.cache) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < routeConfig.ttl) {
      Logger.info('Cache hit', { url, config: routeConfig });
      return cached.data;
    }
  }

  const baseHeaders = {
    'Content-Type': 'application/json',
    'api-key': process.env.CRM_API_KEY,
    'x-source': 'flows',
    'x-target-url': formattedUrl
  };

  try {

    Logger.info('Request Details', { 
      method,
      proxyUrl,
      targetUrl: formattedUrl,
      timeout: routeConfig.timeout,
      route: Object.keys(ROUTE_CONFIG).find(route => url.includes(route)) || 'default',
      timestamp: new Date().toISOString()
    });

    const response = await withRetry(
      async () => {
        const result = await axios({
          method,
          url: proxyUrl,
          ...(data && { data }),
          headers: { ...baseHeaders, ...additionalHeaders },
          timeout: routeConfig.timeout
        });
        return result;
      },
      routeConfig.retries
    );

    if (routeConfig.cache) {
      cache.set(cacheKey, {
        data: response.data,
        timestamp: Date.now()
      });
    }

    return response.data;
  } catch (error) {
    Logger.error('Request Failed', {
      method,
      proxyUrl,
      targetUrl: formattedUrl,
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    // Tratamento para erro 502 em qualquer endpoint
    if (error.response?.status === 502) {
      Logger.info('Ignorando erro 502', {
        url: formattedUrl,
        method,
        timestamp: new Date().toISOString()
      });

      return {
        status: 'not_available',
        message: 'Service temporarily unavailable',
        timestamp: new Date().toISOString()
      };
    }

    throw new APIError(
      error.response?.data?.message || error.message,
      error.response?.status || 500,
      error
    );
  }
};

/**
 * Gerenciador de cache com limpeza automática
 * @class
 * 
 * @example
 * const cache = new CacheManager(300000); // TTL de 5 minutos
 * cache.set('chave', { dados: 'valor' });
 * const valor = cache.get('chave');
 */
class CacheManager {
  /**
   * @param {number} ttl - Tempo de vida em milissegundos
   */
  constructor(ttl = 5 * 60 * 1000) {
    this.cache = new Map();
    this.ttl = ttl;
    this._startCleanupInterval();
  }

  _startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.cache.entries()) {
        if (now - value.timestamp > value.ttl) {
          this.cache.delete(key);
        }
      }
    }, 60000); // Limpa cache expirado a cada minuto
  }

  set(key, value, customTtl = null) {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl: customTtl || this.ttl
    });
  }

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  invalidate(key) {
    this.cache.delete(key);
  }
}

// Substituir a implementação atual do cache
const cacheManager = new CacheManager(CACHE_TTL);

/**
 * Cliente base para APIs
 * Fornece funcionalidades comuns como retry, rate limiting e timeouts
 * @class
 * 
 * @example
 * const client = new APIClientBase({
 *   baseURL: 'https://api.exemplo.com',
 *   timeout: 5000,
 *   maxRetries: 3
 * });
 */
class APIClientBase {
  /**
   * @param {Object} config - Configurações do cliente
   * @param {string} config.baseURL - URL base da API
   * @param {number} [config.timeout] - Timeout em ms
   * @param {number} [config.maxRetries] - Número máximo de retentativas
   */
  constructor(config) {
    if (!config || !config.baseURL) {
      throw new Error('API Client requer configuração baseURL');
    }

    this.config = {
      baseURL: config.baseURL,
      timeout: config.timeout || CONFIG.REQUEST_TIMEOUT,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      headers: config.headers || {},
    };

    // Inicializar rate limiter específico para a instância
    this.rateLimiter = new RateLimiter(
      config.rateLimit?.limit,
      config.rateLimit?.interval
    );
  }

  // Método para construir URL completa
  _buildUrl(endpoint) {
    return endpoint.startsWith('http') ? endpoint : `${this.config.baseURL}${endpoint}`;
  }

  async makeRequest(method, endpoint, data = null, headers = {}) {
    const url = this._buildUrl(endpoint);
    return makeRequest(
      method, 
      url, 
      data, 
      { ...this.config.headers, ...headers }
    );
  }
}

// Funções utilitárias
const formatDate = (data) => {
  if (typeof data === 'string') {
    const [dia, mes, ano] = data.split('/');
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return `${data.ano}-${String(data.mes).padStart(2, '0')}-${String(data.dia).padStart(2, '0')}`;
};

// Funções de negócio
/**
 * Cria um novo contato no sistema.
 * 
 * @example
 * const novoContato = await createContact({
 *   telefone: "11999999999",
 *   cpf: "12345678900",
 *   nome: "João Silva",
 *   email: "joao@email.com",
 *   creditGroup: "INSS"
 * }, "flow-123");
 * 
 * @example
 * // Com campos opcionais
 * const contatoCompleto = await createContact({
 *   telefone: "11999999999",
 *   cpf: "12345678900",
 *   nome: "João Silva",
 *   email: "joao@email.com",
 *   creditGroup: "INSS",
 *   dataNascimento: "01/01/1980",
 *   bancosAutorizados: ["bmg", "facta"]
 * }, "flow-123");
 */
const createContact = async (data, flowToken) => {
  const startTime = Date.now();
  // Valida se todos os campos obrigatórios estão presentes
  const requiredFields = ['telefone', 'cpf', 'nome', 'creditGroup'];
  const missingFields = requiredFields.filter(field => !data[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
  }

 
  /**
   * Formata o número de telefone removendo caracteres não numéricos
   * e adicionando o dígito 9 na posição correta
   * @param {string} phone - Número de telefone a ser formatado
   * @returns {string} Número de telefone formatado
   * @throws {Error} Se o telefone for muito curto ou inválido
   */
  const formatPhoneNumber = (phone) => {
    const sanitized = phone.replace(/\D/g, '');
    return `${sanitized.substring(2, 4)}9${sanitized.slice(-8)}`;
  };
 
  try {
    // Construção do payload base com campos obrigatórios
    const basePayload = {
      telefone: formatPhoneNumber(data.telefone),
      cpf: data.cpf,
      nome: data.nome,
      email: data.email,
      funil: data.creditGroup,
      naoQualificar: true,
      urlOrigem: `https://app.heymax.io/${flowToken}`,
      urlReferencia: "https://app.heymax.io/"
    };
 
    // Mapeamento de como cada campo opcional deve ser tratado
    const optionalFieldsMap = {
      matricula: 'matricula',
      dataNascimento: (value) => ({ dataNascimento: formatDate(value) }),
      bancosAutorizados: (value) => ({ bancosAutorizados: Array.isArray(value) ? value : [value] }),
      nomeRepresentante: 'nomeRepresentante',
      cpfRepresentante: 'cpfRepresentante',
      jaTrabalhouCarteiraAssinada: (value) => ({ jaTrabalhouCarteiraAssinada: value === 'true' }),
      saqueHabilitado: (value) => ({ saqueHabilitado: value === 'true' }),
      especie: (value) => ({ especie: Number(value) })
    };
 
    // Processa campos opcionais e adiciona ao payload base
    const payload = Object.entries(optionalFieldsMap).reduce((acc, [field, mapper]) => {
      if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
        const value = typeof mapper === 'function' 
          ? mapper(data[field])      // Se for função, aplica a transformação
          : { [mapper]: data[field] }; // Se não, usa o valor direto
        return { ...acc, ...value };
      }
      return acc;
    }, basePayload);
 
    // Faz a requisição para a API
    return await makeRequest('post', '/v2/criar-contato', payload);
  } catch (error) {
    // Registra o erro mantendo a stack trace original
    console.error('Erro ao criar contato:', error);
    throw error;
  }
 };

// Função de processamento de imagens do WhatsApp
async function decryptWhatsAppImage(fileData) {
  if (!fileData) {
    throw new ValidationError('Dados do arquivo são obrigatórios');
  }

  const startTime = Date.now();
  
  try {
    Logger.info('Iniciando descriptografia de imagem', {
      hasUrl: !!fileData?.cdn_url,
      hasEncryptionData: !!fileData?.encryption_metadata,
      fileName: fileData?.file_name
    });

    // Validações mais específicas
    if (!fileData.cdn_url) {
      throw new ValidationError('URL do CDN não fornecida');
    }

    if (!fileData.encryption_metadata) {
      throw new ValidationError('Dados de criptografia ausentes');
    }

    const url = new URL(fileData.cdn_url);
    const encryptedResponse = await axios.get(url.toString(), {
      responseType: 'arraybuffer',
      validateStatus: false
    });

    if (encryptedResponse.status !== 200) {
      throw new Error(`Falha ao baixar imagem do CDN. Status: ${encryptedResponse.status}`);
    }

    const encryptedBuffer = Buffer.from(encryptedResponse.data);
    const encryptionKey = Buffer.from(fileData.encryption_metadata.encryption_key, 'base64');
    const iv = Buffer.from(fileData.encryption_metadata.iv, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
    decipher.setAutoPadding(true);

    return Buffer.concat([decipher.update(encryptedBuffer)]);

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    Logger.error('Erro na descriptografia de imagem', {
      error: error.message,
      stack: error.stack,
      duration: Date.now() - startTime,
      fileData: {
        hasCdnUrl: !!fileData?.cdn_url,
        hasEncryption: !!fileData?.encryption_metadata,
        fileName: fileData?.file_name
      }
    });

    throw new APIError('Falha ao processar imagem', 500, error);
  }
}

/**
 * Timeouts específicos por operação em milissegundos
 * @constant {Object}
 */
const OPERATION_TIMEOUTS = {
  upload: 30000,    // 30s para uploads
  download: 20000,  // 20s para downloads
  decrypt: 15000,   // 15s para descriptografia
  default: CONFIG.REQUEST_TIMEOUT
};

const getOperationTimeout = (operation) => {
  return OPERATION_TIMEOUTS[operation] || OPERATION_TIMEOUTS.default;
};

/**
 * Mapeamento de tipos de documentos e suas configurações
 * Usado no processamento de uploads
 * @constant {Object}
 */
const documentTypeMap = {
  foto_documento: fotoDocumentoHandler,
  rg: fotoDocumentoHandler,
  contracheque: () => ({
    tipo: "paycheck",
    nome: "Contracheque"
  }),
  comprovante_residencia: () => ({
    tipo: "proof_residence",
    nome: "Comprovante de Residência"
  }),
  cad_unico: () => ({
    tipo: "cad_unico",
    nome: "CAD Único"
  }),
  print_portal: () => ({
    tipo: "print_portal",
    nome: "Print Portal"
  })
};

/**
 * Upload e registro de arquivos no sistema
 * 
 * @throws {ValidationError} Quando os dados do arquivo são inválidos
 * @throws {APIError} Quando ocorre erro na API do Cloudinary
 * @throws {Error} Quando nenhum arquivo é fornecido para upload
 * 
 * @example
 * const resultado = await uploadFiles({
 *   leadId: "123",
 *   foto_documento: [
 *     { file_name: "frente.jpg", ... },
 *     { file_name: "verso.jpg", ... }
 *   ]
 * });
 */
async function uploadFiles(data, shouldRegister = true, preset = 'gov-ce-preset', folder = 'gov-ce') {
  const timeout = getOperationTimeout('upload');
  const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/consigmais/upload';
  const API_KEY = '849353588224476';
  const UPLOAD_PRESET = preset;
  const FOLDER = folder;

  Logger.info('Upload Files - Dados recebidos', {
    documentTypes: Object.keys(data),
    leadId: data.leadId,
    shouldRegister
  });

  const startTime = Date.now();

  try {

    const documentTypes = ['foto_documento', 'contracheque', 'comprovante_residencia', 'cad_unico', 'print_portal', 'rg'];
    const currentDoc = documentTypes.find(type => data[type]);
    const files = data[currentDoc];

    if (!files?.length) {
      throw new Error('Nenhum arquivo fornecido para upload');
    }

    // Democratização de tipos de documentos
    const fotoDocumentoHandler = (index, totalFiles) => ({
      tipo: totalFiles > 1 ? (index === 0 ? "rg_front" : "rg_back") : "rg_front",
      nome: totalFiles > 1 ? (index === 0 ? "Frente do Documento" : "Verso do Documento") : "Frente do Documento"
    });
    
    const processFiles = await Promise.all(files.map(async (file, index) => {
      const decryptedBuffer = await decryptWhatsAppImage(file);
      const formData = new FormData();
      
      const mimeType = file.file_name.toLowerCase().endsWith('.pdf') ? 
        'application/pdf' : 'image/jpeg';
      
      formData.append('file', `data:${mimeType};base64,${decryptedBuffer.toString('base64')}`);
      formData.append('api_key', API_KEY);
      formData.append('upload_preset', UPLOAD_PRESET);
      formData.append('folder', FOLDER);
      formData.append('resource_type', 'auto');

      const cloudinaryResponse = await axios.post(CLOUDINARY_URL, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: timeout
      });

      const docInfo = documentTypeMap[currentDoc](index, files.length);
      
      return {
        link: cloudinaryResponse.data.secure_url,
        ...docInfo
      };
    }));

    if (shouldRegister) {
      return Promise.all(processFiles.map(file => 
        makeRequest('post', '/v1/registrar-arquivo', {
          leadId: data.leadId,
          link: file.link,
          tipo: file.tipo,
          nome: file.nome
        })
      ));
    }

    return processFiles;

  } catch (error) {
    Logger.error('Erro no upload', {
      error: error.message,
      stack: error.stack,
      cpf: data.cpf,
      documentTypes: Object.keys(data),
      leadId: data.leadId
    });
    throw error;
  }
}

/**
 * Registra uma nova conta bancária para o lead
 * 
 * @example
 * const conta = await registerAccount({
 *   leadId: "abc-123",
 *   agencia: "0001",
 *   conta: "123456",
 *   tipoConta: "corrente",
 *   codigoBanco: "237 - Bradesco"
 * });
 * 
 * @example
 * // Registro usando CPF
 * const conta = await registerAccount({
 *   cpf: "12345678900",
 *   agencia: "0001",
 *   conta: "123456",
 *   tipoConta: "poupanca",
 *   codigoBanco: "104 - Caixa"
 * });
 * 
 * @throws {ValidationError} Quando CPF ou leadId não são fornecidos
 */
const registerAccount = async (data) => {
  if (!data.leadId && !data.cpf) {
    throw new ValidationError('CPF ou leadId é obrigatório');
  }

  const allowedFields = ['leadId', 'cpf', 'agencia', 'conta', 'tipoConta', 'codigoBanco'];
  const formattedData = Object.keys(data)
    .filter(key => allowedFields.includes(key))
    .reduce((obj, key) => {
      obj[key] = key === 'codigoBanco' ? data[key].split(' - ')[0] : data[key];
      return obj;
    }, {});
    
  const response = await makeRequest('post', '/v2/registrar-conta', formattedData);

  Logger.info('Request feito para registrar nova conta', {
    method: 'post',
    url: '/v2/registrar-conta',
    data: formattedData,
    response: response
  });

  return response;
};

/**
 * Registra documentos do lead
 * 
 * @example
 * const doc = await registerDocument({
 *   leadId: "abc-123",
 *   numero: "123456789",
 *   dataEmissao: "01/01/2020",
 *   orgaoEmissor: "SSP",
 *   ufAgencia: "SP"
 * });
 * 
 * @throws {ValidationError} Quando UF da agência não é fornecida
 */
const registerDocument = async (data) => {
  if (!data.ufAgencia) {
    throw new ValidationError('UF da agência é obrigatória');
  }
  return makeRequest('post', '/v2/registrar-documento', {
    ...data,
    ufAgencia: data.ufAgencia.trim().toUpperCase()
  });
};

/**
 * Atualiza dados básicos do lead
 * @param {Object} data - Dados do lead
 * @returns {Promise<Object>} Resposta da API
 */
const updateBasicLeadData = async (data) => {
  const formattedData = { ...data };
  if (data.dataNascimento) {
    formattedData.dataNascimento = formatDate(data.dataNascimento);
  }

  Logger.info('Atualizando dados básicos do lead', { data: formattedData });
  return makeRequest('patch', '/v1/dados-basicos', formattedData);
};

/**
 * Registra endereço do lead
 * @param {Object} data - Dados do endereço
 * @returns {Promise<Object>} Resposta da API
 */
const registerAddress = async (data) => {
  return makeRequest('post', '/v2/registrar-endereco', data);
};

/**
 * Avança lead para próxima etapa
 * @param {string} identifier - ID do lead ou CPF
 * @param {string} creditGroup - Grupo de crédito
 * @returns {Promise<Object>} Resposta da API
 */
const nextStage = async (identifier, creditGroup) => {
  const path = identifier.length === 36 
    ? `/v1/proxima-etapa/${identifier}/complete`
    : `/v1/proxima-etapa/${creditGroup}/${identifier}/complete`;
  return makeRequest('get', path);
};

/**
 * Inclui um novo contrato
 * @param {Object} data - Dados do contrato
 * @returns {Promise<Object>} Resposta da API
 */
const includeContract = async (data) => {
  if (!data.leadId) {
    throw new ValidationError('ID do lead é obrigatório');
  }
  if (!data.opportuntityId) {
    throw new ValidationError('ID da oportunidade é obrigatório');
  }

  Logger.info('Incluindo novo contrato', { data });
  return makeRequest('post', '/v1/lead/proposal', data);
};

/**
 * Valida CPF através do serviço externo
 * @param {string} cpf - CPF para validar
 * @returns {Promise<boolean>} Resultado da validação
 */
const validaCPF = async (cpf) => {
  return makeRequest('post', 'https://www.4devs.com.br/ferramentas_online.php', 
    new URLSearchParams({ acao: 'validar_cpf', txt_cpf: cpf }), 
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
};

/**
 * Consulta arquivos do cliente
 * @param {string} identifier - ID do cliente
 * @returns {Promise<Object>} Lista de arquivos
 */
const customerFiles = async (identifier) => {
  return makeRequest('get', `/v1/customer/${identifier}/files`);
};

/**
 * Consulta status do contrato
 * @param {string} cpf - CPF do cliente
 * @returns {Promise<Object>} Status do contrato
 */
const consultaStatus = async (cpf) => {
  return makeRequest('get', `https://n8n-01-webhook.kemosoft.com.br/webhook/status-contrato?cpf=${cpf}`);
};

/**
 * Consulta matrícula do cliente
 * @param {string} leadId - ID do lead
 * @returns {Promise<Object>} Dados da matrícula
 */
const consultaMatricula = async (leadId) => {
  return makeRequest('get', `https://n8n-01-webhook.kemosoft.com.br/webhook/consulta-nis?leadId=${leadId}`);
};

/**
 * Atribui tag ao lead
 * @param {string} leadId - ID do lead
 * @param {string} tagId - ID da tag
 * @returns {Promise<Object>} Resposta da API
 */
const tagAssign = async (leadId, tagId) => {
  return makeRequest('post', '/v2/tag/assign', { leadId, tagId });
};

/**
 * Requalifica um lead
 * @param {Object} params - Parâmetros de requalificação
 * @returns {Promise<Object>} Resultado da requalificação
 */
const requalify = async ({ leadId, type, url }) => {
  const startTime = Date.now();

  if (!leadId) throw new Error('ID do lead é obrigatório');
  if (!type) throw new Error('Tipo do documento é obrigatório');
  if (!url) throw new Error('URL do documento é obrigatória');

  return makeRequest('post', `/v1/lead/${leadId}/requalify`, {
    file: { url, type }
  });
};

 /**
* Consulta os dados de cadastro do lead
* @param {string} identifier - cpf ou leadId
* @returns {Promise<Object>} Resposta da API
*/
const leadData = (identifier) => {
  return makeRequest('get', `/v1/lead/${identifier}`);
 };

module.exports = {
  APIClientBase,
  createContact,
  registerAccount,
  fetchCepInfo,
  registerDocument,
  updateBasicLeadData,
  leadData,
  registerAddress,
  nextStage,
  uploadFiles,
  validaCPF,
  customerFiles,
  consultaStatus,
  consultaMatricula,
  tagAssign,
  requalify,
  decryptWhatsAppImage
};