const axios = require('axios');
const crypto = require('crypto');
const { Logger } = require('../utils/logger');
const FormData = require('form-data');
const { CONFIG } = require('../config/constants');

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
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
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

// Client API base class
class APIClientBase {
  constructor(config) {
    if (!config || !config.baseURL) {
      throw new Error('API Client requires baseURL configuration');
    }

    this.config = {
      baseURL: config.baseURL,
      timeout: config.timeout || 5000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
    };

    this.setupLogging();
  }

  setupLogging() {
    Logger.info('API Client initialized', {
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries
    });
  }

  async makeRequest(method, endpoint, data = null, headers = {}) {
    return makeRequest(method, endpoint, data, headers);
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
const createContact = (data, flowToken) => {
  const sanitizedPhone = data.telefone ? data.telefone.replace(/\D/g, '') : '55849988341824';
  const phoneNumber = sanitizedPhone.substring(2, 4) + '9' + sanitizedPhone.substring(sanitizedPhone.length - 8);

  return makeRequest('post', '/v2/criar-contato', {
    telefone: phoneNumber,
    matricula: data.matricula,
    nome: data.nome,
    email: data.email,
    cpf: data.cpf,
    dataNascimento: formatDate(data.dataNascimento),
    funil: data.creditGroup,
    naoQualificar: true,
    urlOrigem: `https://app.heymax.io/${flowToken}`,
    urlReferencia: "https://app.heymax.io/"
  });
};

// Função de processamento de imagens do WhatsApp
async function decryptWhatsAppImage(fileData) {
  try {
    Logger.info('Iniciando descriptografia de imagem', {
      hasUrl: !!fileData?.cdn_url,
      hasEncryptionData: !!fileData?.encryption_metadata
    });

    if (fileData.cdn_url === 'EXAMPLE_DATA__CDN_URL_WILL_COME_IN_THIS_FIELD') {
      return Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
    }

    if (!fileData?.cdn_url || !fileData?.encryption_metadata) {
      throw new Error('Dados da imagem incompletos ou ausentes');
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
    Logger.error('Erro na descriptografia de imagem', {
      error: error.message,
      stack: error.stack,
      fileData: {
        hasCdnUrl: !!fileData?.cdn_url,
        hasEncryption: !!fileData?.encryption_metadata
      }
    });
    throw error;
  }
}

/** Função para upload de arquivos
* @param {Object} data - Dados do arquivo capturados no flows
* @param {boolean} shouldRegister - Deve registrar o arquivo na API do CRM
* @param {string} preset - Preset do Cloudinary
* @param {string} folder - Pasta do Cloudinary
* @returns {Promise<Object>} Resposta da API 
*/
async function uploadFiles(data, shouldRegister = true, preset = 'gov-ce-preset', folder = 'gov-ce') {
  const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/consigmais/upload';
  const API_KEY = '849353588224476';
  const UPLOAD_PRESET = preset;
  const FOLDER = folder;

  Logger.info('Upload Files - Dados recebidos', {
    documentTypes: Object.keys(data),
    leadId: data.leadId,
    shouldRegister
  });

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
    
    // Mapeamento de tipos de documentos
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
        timeout: 30000
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
 * Registra uma nova conta
 * @param {Object} data - Dados da conta
 * @returns {Promise<Object>} Dados da conta registrada 
 */
const registerAccount = async (data) => {
  return makeRequest('post', '/v2/registrar-conta', data);
};

/**
 * Busca informações de CEP
 * @param {string} cep - CEP para buscar
 * @returns {Promise<Object>} Dados do endereço
 */
const fetchCepInfo = async (cep) => {
  return makeRequest('get', `https://brasilapi.com.br/api/cep/v1/${cep}`);
};

/**
 * Registra documento do lead
 * @param {Object} data - Dados do documento
 * @returns {Promise<Object>} Resposta da API
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
  return makeRequest('post', '/v2/registrar-dados-empregaticios', data);
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