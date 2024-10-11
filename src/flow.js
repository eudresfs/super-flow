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

// Funções de cache
const getCachedData = (screen) => {
  const cachedItem = dataCache[screen];
  return cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TIMEOUT) ? cachedItem.data : null;
};

const invalidateCache = (screen) => {
  Object.keys(SCREEN_RESPONSES).forEach((s) => {
    if (s === screen || dataCache[s]) delete dataCache[s];
  });
};

const setCachedData = (screen, data) => {
  dataCache[screen] = { data, timestamp: Date.now() };
};

// Função de envio com retry e fallback
const sendDataToEndpoint = async (payload, retryCount = 0) => {
  try {
    const response = await axios.post('https://n8n-01-webhook.kemosoft.com.br/webhook/flows', payload);
    console.log('Data successfully sent:', response.data);
    return response.data;
  } catch (error) {
    logError('Error sending data to endpoint', error);
    
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return sendDataToEndpoint(payload, retryCount + 1);
    }

    console.warn('All retry attempts failed. Using fallback data.');
    return { screen: payload.screen || 'account', data: { warningMessage: "Não foi possível conectar ao servidor." }};
  }
};

// Função para buscar dados do CEP
const fetchCEPData = async (cep) => {
  try {
    const response = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
    if (response.data.erro) throw new Error('CEP não encontrado');
    return { isComplete: !!response.data.logradouro, ...response.data };
  } catch (error) {
    logError('Error fetching CEP data', error);
    return { isComplete: false, error: error.message === 'CEP não encontrado' ? 'CEP não encontrado' : 'Erro ao buscar CEP' };
  }
};

// Função de validação de input
const validateInput = (data, screen) => {
  const requiredFields = {
    account: ['codigoBanco', 'tipoConta', 'agencia', 'conta'],
    infos: ['name', 'birthDate', 'mother', 'zipcode'],
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
    const cachedData = getCachedData(screen);
    if (cachedData) return cachedData;

    if (action === "INIT") {
      const endpointData = await sendDataToEndpoint({ screen: "", data: {}, flow_token, version });
      const response = { screen: endpointData.screen || SCREEN_RESPONSES.account.screen, data: { ...endpointData.data, federal_id }};
      setCachedData(screen, response);
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
        const cepData = await fetchCEPData(data.zipcode);
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

    setCachedData(screen, response);
    return response;
  } catch (error) {
    logError("Erro em getNextScreen", error);
    return { screen, data: { errorMessage: error.message || "Erro ao processar.", technicalDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined }};
  }
};
