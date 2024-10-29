import axios from 'axios';

// Função para calcular a data de hoje menos X anos
const calculateDateYearsAgo = (yearsAgo) => {
  const today = new Date();
  const pastDate = new Date(today.getFullYear() - yearsAgo, today.getMonth(), today.getDate());
  return pastDate.toISOString().split('T')[0]; // Formato "YYYY-MM-DD"
};

// Cálculo dinâmico das datas
const dynamicMaxDate = calculateDateYearsAgo(18); // Data de hoje menos 18 anos
const dynamicMinDate = calculateDateYearsAgo(75); // Data de hoje menos 75 anos

const SCREEN_RESPONSES = {
  account: { screen: "account", data: { cpf: "", bancos_aceitos: [] }},
  infos: { screen: "infos", data: { name: "João da Silva" }},
  address: { screen: "address", data: {} },
  complete: { screen: "complete", data: {} },
  SUCCESS: {
    screen: "SUCCESS",
    data: { extension_message_response: { params: { flow_token: "REPLACE_FLOW_TOKEN", some_param_name: "PASS_CUSTOM_VALUE" } }},
  },
};

// Cache para armazenar dados temporariamente
let dataCache = {};

// Configurações para retry e cache
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 segundo
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutos

// Função de logging melhorada
const logError = (message, error) => {
  console.error(`${message}:`, error);
};

// Função para comparar dois objetos profundamente
const deepEqual = (obj1, obj2) => {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (let key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }

  return true;
};

// Função de cache modificada para comparar dados recebidos com o cache
const getCachedData = (screen, receivedData) => {
  const cachedItem = dataCache[screen];

  if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TIMEOUT)) {
    if (deepEqual(cachedItem.data, receivedData)) {
      console.log('Cache is valid and data is equal.');
      return cachedItem.data;
    } else {
      console.log('Cache invalidated due to data mismatch');
      invalidateCache(screen);
    }
  }

  return null;
};

// Função para invalidar o cache
const invalidateCache = (screen) => {
  const screens = Object.keys(SCREEN_RESPONSES);
  const currentScreenIndex = screens.indexOf(screen);
  if (currentScreenIndex !== -1) {
    screens.slice(currentScreenIndex).forEach(s => {
      delete dataCache[s];
    });
  }
};

const setCachedData = (screen, data) => {
  dataCache[screen] = { data, timestamp: Date.now() };
};

// Função de envio com retry e fallback
const sendDataToEndpoint = async (data) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post('https://n8n-01.kemosoft.com.br/webhook-test/flows', data);
      return response.data;
    } catch (error) {
      if (error.response) {
        console.error(`Error: ${error.response.status} - ${error.response.data.message}`);
      } else {
        console.error(`Request error: ${error.message}`);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw error;
      }
    }
  }
};

// Função para buscar dados do CEP
const fetchCEPData = async (cep) => {
  console.log(`Iniciando busca para o CEP: ${cep}`);

  try {
    if (!cep || !/^\d{8}$/.test(cep)) {
      console.error('CEP inválido:', cep);
      throw new Error('CEP inválido');
    }

    console.log(`Fazendo requisição para: https://brasilapi.com.br/api/cep/v1/${cep}`);

    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);

    console.log('Dados retornados pela API:', response.data);

    return response.data;
  } catch (error) {
    console.error('Erro ao buscar os dados do CEP:', error.message);
    throw new Error('CEP não localizado');
  }
};

// Função de validação de input
const validateInput = (data, screen) => {
  const requiredFields = {
    account: ['codigoBanco', 'tipoConta', 'agencia', 'conta'],
    infos: ['nome', 'dataNascimento', 'nomeMae', 'cep'],
  };
  const missingFields = requiredFields[screen]?.filter(field => !data[field]);
  if (missingFields?.length) throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
};

// Função principal para controle de fluxo
export const getNextScreen = async (decryptedBody) => {
  const { screen, data, version, action, flow_token } = decryptedBody;

  const cpf = data?.cpf;
  console.log(`Processando CPF: ${cpf}`);

  if (action === "ping") {
    return { version, data: { status: "active", error: false, errorMessage: "não houveram erros" }};
  }

  if (data?.error) {
    return { version, data: { acknowledged: true, errorMessage: "Ocorreu um erro. Tente novamente.", error: true }};
  }

  try {
    const cachedData = getCachedData(screen, data);
    if (cachedData) {
      console.log('Using cached data for screen:', screen);
      return { ...cachedData, cpf, error: false, errorMessage: "não houveram erros" };
    }

    // Verificação para chamar o endpoint quando action é "INIT" ou o screen está vazio
    if (action === "INIT" || !screen) {
      const endpointData = await sendDataToEndpoint({ screen: "", data: {}, flow_token, version });
      const response = { screen: endpointData.screen || SCREEN_RESPONSES.account.screen, data: { ...endpointData.data, cpf, error: false, errorMessage: "não houveram erros" }};
      setCachedData(screen, response);
      return response;
    }

    validateInput(data, screen);

    const endpointData = await sendDataToEndpoint({ screen, data, flow_token, version });
    const mergedDataWithCPF = { ...endpointData, cpf };

    let response;
    switch (screen) {
      case "account":
        response = { screen: SCREEN_RESPONSES.infos.screen, data: { ...mergedDataWithCPF, maxDate: dynamicMaxDate, minDate: dynamicMinDate, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      case "infos":
        console.log('CEP antes da chamada fetchCEPData:', data.cep);
        const cepData = await fetchCEPData(data.cep);
        response = cepData.error
          ? { screen: SCREEN_RESPONSES.infos.screen, data: { ...mergedDataWithCPF, errorMessage: cepData.error, cpf, error: true }}
          : { screen: cepData.isComplete ? SCREEN_RESPONSES.complete.screen : SCREEN_RESPONSES.address.screen, data: { ...mergedDataWithCPF, ...cepData, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      case "address":
        response = { screen: SCREEN_RESPONSES.complete.screen, data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      case "complete":
        response = { screen: SCREEN_RESPONSES.SUCCESS.screen, data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      default:
        throw new Error(`Tela não reconhecida: ${screen}`);
    }

    setCachedData(screen, response);
    return response;
  } catch (error) {
    logError("Erro em getNextScreen", error);
    return { screen, data: { errorMessage: error.message || "Erro ao processar.", technicalDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined, error: true }};
  }
};
