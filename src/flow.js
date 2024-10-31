import axios from 'axios';

// Configuração e Parâmetros
const config = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 segundo
  CACHE_TIMEOUT: 5 * 60 * 1000, // 5 minutos
  ENDPOINT_URL: 'https://n8n-01-webhook.kemosoft.com.br/webhook/flows',
  TEST_ENDPOINT_URL: 'https://n8n-01.kemosoft.com.br/webhook-test/flows'
};

// Utilitários de Data
const calculateDateYearsAgo = (yearsAgo) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - yearsAgo);
  return date.toISOString().split('T')[0];
};
const dynamicMaxDate = calculateDateYearsAgo(18);
const dynamicMinDate = calculateDateYearsAgo(75);

// Configurações e Dados de Respostas das Telas
const SCREEN_RESPONSES = {
  signup: { screen: "signup", data: { cpf: "", nome: "" }},
  authorization: { screen: "authorization", data: {} },
  opportunities: { screen: "opportunities", data: {} },
  no_opportunity: { screen: "no_opportunity", data: {} },
  instructions: { screen: "instructions", data: {} },
  account: { screen: "account", data: { cpf: "", bancos_aceitos: [] }},
  infos: { screen: "infos", data: { name: "João da Silva" }},
  address: { screen: "address", data: {} },
  complete: { screen: "complete", data: {} },
  SUCCESS: {
    screen: "SUCCESS",
    data: { extension_message_response: { params: { flow_token: "REPLACE_FLOW_TOKEN", some_param_name: "PASS_CUSTOM_VALUE" }}}
  },
};

// Cache com Expiração
const dataCache = new Map();
const getCachedData = (screen, receivedData) => {
  const cachedItem = dataCache.get(screen);
  if (cachedItem && Date.now() - cachedItem.timestamp < config.CACHE_TIMEOUT) {
    if (JSON.stringify(cachedItem.data) === JSON.stringify(receivedData)) {
      console.log('Cache válido e dados iguais.');
      return cachedItem.data;
    } else {
      console.log('Cache invalidado por divergência de dados.');
      invalidateCache(screen);
    }
  }
  return null;
};
const setCachedData = (screen, data) => dataCache.set(screen, { data, timestamp: Date.now() });
const invalidateCache = (screen) => {
  const keys = Array.from(dataCache.keys());
  const currentScreenIndex = keys.indexOf(screen);
  keys.slice(currentScreenIndex).forEach(key => dataCache.delete(key));
};

// Função de Log de Erros
const logError = (message, error, screen = '') => {
  console.error(`${message} [Tela: ${screen}]:`, error);
};

// Função de Envio com Retry
const sendDataToEndpoint = async (data) => {
  for (let attempt = 0; attempt < config.MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(config.ENDPOINT_URL, data);
      return response.data;
    } catch (error) {
      if (attempt === config.MAX_RETRIES - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY * (2 ** attempt)));
    }
  }
};

// Busca de Dados de CEP
const fetchCEPData = async (cep) => {
  console.log(`Buscando dados para o CEP: ${cep}`);
  try {
    if (!/^\d{8}$/.test(cep)) throw new Error('CEP inválido');
    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    console.log('Dados retornados pela API de CEP:', response.data);
    return response.data;
  } catch (error) {
    logError('Erro ao buscar CEP', error);
    return { error: 'CEP não localizado' };
  }
};

// Validação de Input com Campos Obrigatórios
const validateInput = (data, screen) => {
  const requiredFields = {
    signup: ['cpf', 'nome'],
    authorization: [],
    opportunities: [],
    no_opportunity: [],
    instructions: [],
    account: ['codigoBanco', 'tipoConta', 'agencia', 'conta'],
    infos: ['nome', 'dataNascimento', 'nomeMae', 'cep'],
  };
  const missingFields = requiredFields[screen]?.filter(field => !data[field]);
  if (missingFields?.length) throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
};

// Função de Tratamento de Erros
const handleErrorResponse = (screen, message, error) => ({
  screen,
  data: {
    errorMessage: message || "Erro ao processar.",
    technicalDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    error: true,
  },
});

// Função Principal de Controle de Fluxo
export const getNextScreen = async (decryptedBody) => {
  
  let { screen, data, version, action, flow_token } = decryptedBody;

  // Verificar e converter bancos_aceitos se for uma string
  if (typeof data?.bancos_aceitos === 'string') {
    try {
      data.bancos_aceitos = JSON.parse(data.bancos_aceitos);
      console.log("bancos_aceitos convertido com sucesso:", data.bancos_aceitos);
    } catch (error) {
      console.error("Erro ao converter bancos_aceitos:", error);
      return { screen, data: { errorMessage: "Erro ao processar bancos_aceitos.", error: true }};
    }
  }
  const cpf = data?.cpf;
  
  if (action === "ping") {
    return { version, data: { status: "active", error: false, errorMessage: "não houveram erros" }};
  }
  
  if (data?.error) {
    return { version, data: { acknowledged: true, errorMessage: "Ocorreu um erro. Tente novamente.", error: true }};
  }

  try {
    const cachedData = getCachedData(screen, data);
    if (cachedData) return { ...cachedData, cpf, error: false, errorMessage: "não houveram erros" };

    if (action === "INIT") {
      const endpointData = await sendDataToEndpoint({
        screen: "",
        data: { cpf, bancos_aceitos: SCREEN_RESPONSES.account.data.bancos_aceitos },
        flow_token,
        version
      });
      
      const response = { screen: endpointData.screen || SCREEN_RESPONSES.account.screen, data: { ...endpointData.data, cpf, error: false, errorMessage: "não houveram erros" }};
      setCachedData(screen, response);
      return response;
    }

    validateInput(data, screen);
    const endpointData = await sendDataToEndpoint({ screen, data, flow_token, version });
    const mergedDataWithCPF = { ...endpointData, cpf };

    let response;
    switch (screen) {
      case "signup":
        response = { screen: SCREEN_RESPONSES.authorization.screen, data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
        
        case "authorization":
          const { contexto, situacao } = data;

          if (contexto === "resolver-situacao") {
            if (situacao === "escolher-simulacao") {
              response = { 
                screen: SCREEN_RESPONSES.opportunities.screen, 
                data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" } 
              };
            } else if (situacao === "autorizar-bancos") {
              response = { 
                screen: SCREEN_RESPONSES.instructions.screen, 
                data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" } 
              };
            }
          } else if (contexto === "sem-oportunidade") {
            response = { 
              screen: SCREEN_RESPONSES.no_opportunity.screen, 
              data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" } 
            };
          } else {
            // Caso de fallback, se necessário
            response = { 
              screen: SCREEN_RESPONSES.opportunities.screen, 
              data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" } 
            };
          }
          break;

      case "opportunities":
        response = { screen: SCREEN_RESPONSES.account.screen, data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      case "account":
        response = { screen: SCREEN_RESPONSES.infos.screen, data: { ...mergedDataWithCPF, maxDate: dynamicMaxDate, minDate: dynamicMinDate, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      case "infos":
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
      case "no_opportunity":
      case "instructions":
        response = { screen: SCREEN_RESPONSES.instructions.screen, data: { ...mergedDataWithCPF, cpf, error: false, errorMessage: "não houveram erros" }};
        break;
      default:
        throw new Error(`Tela não reconhecida: ${screen}`);
    }

    setCachedData(screen, response);
    return response;
  } catch (error) {
    logError("Erro em getNextScreen", error, screen);
    return handleErrorResponse(screen, error.message, error);
  }
};
