import axios from 'axios';

// Função para calcular a data de hoje menos X anos
const calculateDateYearsAgo = (yearsAgo) => {
  const today = new Date();
  const pastDate = new Date(today.setFullYear(today.getFullYear() - yearsAgo));
  return pastDate.toISOString().split('T')[0]; // Formato "YYYY-MM-DD"
};

// Cálculo dinâmico das datas
const dynamicMaxDate = calculateDateYearsAgo(18); // Data de hoje menos 18 anos
const dynamicMinDate = calculateDateYearsAgo(75); // Data de hoje menos 75 anos

const SCREEN_RESPONSES = {
  account: { screen: "account", data: { federal_id: "" }},
  infos: { screen: "infos", data: { name: "João da Silva" }},
  address: { screen: "address", data: {} },
  complete: { screen: "complete", data: {} },
  SUCCESS: {
    screen: "SUCCESS",
    data: { extension_message_response: { params: { flow_token: "REPLACE_FLOW_TOKEN", some_param_name: "PASS_CUSTOM_VALUE" }}},
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
  // Adicionar lógica para serviço de monitoramento
};

// Função para comparar dois objetos profundamente
const deepEqual = (obj1, obj2) => {
  if (obj1 === obj2) return true; // Se os objetos forem exatamente iguais, retorna true
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false; // Se o número de propriedades for diferente, são diferentes

  // Verifica cada chave e valor
  for (let key of keys1) {
    if (!keys2.includes(key)) return false; // Se uma chave não existe no outro objeto, são diferentes
    if (!deepEqual(obj1[key], obj2[key])) return false; // Recursivamente compara cada valor
  }

  return true;
};

// Função de cache modificada para comparar dados recebidos com o cache
const getCachedData = (screen, receivedData) => {
  const cachedItem = dataCache[screen];
  
  if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TIMEOUT)) {
    // Verifica se os dados em cache são iguais aos dados recebidos
    if (deepEqual(cachedItem.data, receivedData)) {
      console.log('Cache is valid and data is equal.');
      return cachedItem.data;
    } else {
      console.log('Cache invalidated due to data mismatch');
      invalidateCache(screen); // Invalida o cache se os dados forem diferentes
    }
  }

  return null; // Retorna null se não houver cache válido ou se os dados forem diferentes
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
  try {
    const response = await axios.post('https://n8n-01-webhook.kemosoft.com.br/webhook/flows', data);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`Error: ${error.response.status} - ${error.response.data.message}`);
    } else {
      console.error(`Request error: ${error.message}`);
    }
    throw error;
  }
};


// Função para buscar dados do CEP
const fetchCEPData = async (cep) => {
  try {
    if (!cep || !/^\d{8}$/.test(cep)) {
      throw new Error('CEP inválido');
    }
    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching CEP data:', error.message);
    throw new Error('Erro ao buscar CEP');
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
  const { screen, data, version, action, flow_token, federal_id } = decryptedBody;

  if (action === "ping") {
    return { version, data: { status: "active" }};
  }

  if (data?.error) {
    return { version, data: { acknowledged: true, errorMessage: "Ocorreu um erro. Tente novamente." }};
  }

  try {
    // Verifica se os dados estão no cache e se são iguais aos recebidos
    const cachedData = getCachedData(screen, data);
    if (cachedData) {
      console.log('Using cached data for screen:', screen);
      return cachedData; // Usa os dados em cache se forem iguais aos recebidos
    }

    if (action === "INIT") {
      const endpointData = await sendDataToEndpoint({ screen: "", data: {}, flow_token, version });
      const response = { screen: endpointData.screen || SCREEN_RESPONSES.account.screen, data: { ...endpointData.data, federal_id }};
      setCachedData(screen, response); // Armazena a resposta no cache
      return response;
    }

    validateInput(data, screen);
    
    const endpointData = await sendDataToEndpoint({ screen, data, flow_token, version });
    const mergedDataWithFederalID = { ...endpointData, federal_id };

    let response;
    switch (screen) {
      case "account":
        response = { screen: SCREEN_RESPONSES.infos.screen, data: { ...mergedDataWithFederalID, maxDate: dynamicMaxDate, minDate: dynamicMinDate }};
        break;
      case "infos":
        const cepData = await fetchCEPData(data.cep);
        response = cepData.error
          ? { screen: SCREEN_RESPONSES.infos.screen, data: { ...mergedDataWithFederalID, errorMessage: cepData.error }}
          : { screen: cepData.isComplete ? SCREEN_RESPONSES.complete.screen : SCREEN_RESPONSES.address.screen, data: { ...mergedDataWithFederalID, ...cepData }};
        break;
      case "address":
        response = { screen: SCREEN_RESPONSES.complete.screen, data: { ...mergedDataWithFederalID }};
        break;
      case "complete":
        response = { screen: SCREEN_RESPONSES.SUCCESS.screen, data: { ...mergedDataWithFederalID }};
        break;
      default:
        throw new Error(`Tela não reconhecida: ${screen}`);
    }

    // Armazena a resposta atual no cache
    setCachedData(screen, response);
    return response;
  } catch (error) {
    logError("Erro em getNextScreen", error);
    return { screen, data: { errorMessage: error.message || "Erro ao processar.", technicalDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined }};
  }
};