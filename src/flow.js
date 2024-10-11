import axios from 'axios';

// Função para calcular a data de hoje menos X anos
const calculateDateYearsAgo = (yearsAgo) => {
  const today = new Date();
  const pastDate = new Date(today.setFullYear(today.getFullYear() - yearsAgo));
  return pastDate.toISOString().split('T')[0]; // Retorna a data no formato "YYYY-MM-DD"
};

// Cálculo dinâmico das datas
const dynamicMaxDate = calculateDateYearsAgo(18); // Data de hoje menos 18 anos
const dynamicMinDate = calculateDateYearsAgo(75); // Data de hoje menos 75 anos

const SCREEN_RESPONSES = {
  account: {
    screen: "account",
    data: {
      federal_id: "", // Inicialmente vazio, será preenchido dinamicamente
    },
  },
  infos: {
    screen: "infos",
    data: {
      name: "João da Silva",
    },
  },
  address: {
    screen: "address",
    data: {},
  },
  complete: {
    screen: "complete",
    data: {},
  },
  SUCCESS: {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token: "REPLACE_FLOW_TOKEN",
          some_param_name: "PASS_CUSTOM_VALUE",
        },
      },
    },
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
  // Aqui você pode adicionar lógica para enviar logs para um serviço de monitoramento
};

// Funções de cache
const getCachedData = (screen) => {
  const cachedItem = dataCache[screen];
  if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TIMEOUT)) {
    return cachedItem.data;
  }
  return null;
};

const setCachedData = (screen, data) => {
  dataCache[screen] = { data, timestamp: Date.now() };
};

// Função de envio de dados para o endpoint real e retorna apenas o data da resposta
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

    // Fallback: retornar um objeto simulado se todas as tentativas falharem
    console.warn('All retry attempts failed. Using fallback data.');
    return {
      screen: payload.screen || 'account',
      data: {
        warningMessage: "Não foi possível conectar ao servidor. Alguns recursos podem estar indisponíveis."
      }
    };
  }
};

// Função para buscar dados do CEP
const fetchCEPData = async (cep) => {
  try {
    const response = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
    if (response.data.erro) {
      throw new Error('CEP não encontrado');
    }
    return {
      isComplete: !!response.data.logradouro,
      ...response.data
    };
  } catch (error) {
    logError('Error fetching CEP data', error);
    return {
      isComplete: false,
      error: error.message === 'CEP não encontrado' ? 'CEP não encontrado' : 'Erro ao buscar CEP'
    };
  }
};

// Função de validação de input
const validateInput = (data, screen) => {
  switch(screen) {
    case 'account':
      if (!data.codigoBanco || !data.tipoConta || !data.agencia || !data.conta) {
        throw new Error('Todos os campos bancários são obrigatórios');
      }
      break;
    case 'infos':
      if (!data.name || !data.birthDate || !data.mother || !data.zipcode) {
        throw new Error('Todos os campos são obrigatórios, exceto email');
      }
      break;
    // Adicione validações para outras telas conforme necessário
  }
};

export const getNextScreen = async (decryptedBody) => {
  const { screen, data, version, action, flow_token, federal_id } = decryptedBody;

  // Verifica o ping (checagem de status do serviço)
  if (action === "ping") {
    return {
      version,
      data: {
        status: "active",
      },
    };
  }

  // Lida com erros vindos da requisição
  if (data?.error) {
    console.warn("Received client error:", data);
    return {
      version,
      data: {
        acknowledged: true,
        errorMessage: "Ocorreu um erro. Por favor, tente novamente."
      },
    };
  }

  try {
    // Verifica se os dados estão no cache
    const cachedData = getCachedData(screen);
    if (cachedData) {
      console.log('Using cached data for screen:', screen);
      return cachedData;
    }

    // Lida com a inicialização do fluxo (action: INIT)
    if (action === "INIT") {
      try {
        const endpointData = await sendDataToEndpoint({
          screen: "",
          data: {},
          flow_token,
          version,
        });

        const response = {
          screen: endpointData.screen || SCREEN_RESPONSES.account.screen,
          data: {
            ...endpointData.data,
            federal_id,
          },
        };
        setCachedData(screen, response);
        return response;
      } catch (error) {
        logError("Failed to initialize flow", error);
        return {
          screen: SCREEN_RESPONSES.account.screen,
          data: {
            federal_id,
            warningMessage: "Inicialização com limitações. Alguns dados podem não estar disponíveis."
          }
        };
      }
    }

    // Validação de input
    validateInput(data, screen);

    // Captura e envia os dados de troca de tela para o endpoint, recebendo a resposta
    const endpointData = await sendDataToEndpoint({
      screen,
      data,
      flow_token,
      version,
    });

    // Sempre garantimos que o `federal_id` seja incluído na resposta
    const mergedDataWithFederalID = {
      ...endpointData,
      federal_id, // Garantimos que o `federal_id` seja sempre retornado
    };

    // Lida com troca de dados e de telas (action: data_exchange)
    if (action === "data_exchange") {
      let response;
      switch (screen) {
        case "account":
          response = {
            screen: SCREEN_RESPONSES.infos.screen,
            data: {
              ...mergedDataWithFederalID,
              maxDate: dynamicMaxDate,
              minDate: dynamicMinDate,
              successMessage: "Dados bancários recebidos com sucesso!"
            },
          };
          break;

        case "infos":
          const cepData = await fetchCEPData(data.zipcode);
          if (cepData.error) {
            response = {
              screen: SCREEN_RESPONSES.infos.screen,
              data: {
                ...mergedDataWithFederalID,
                errorMessage: cepData.error
              },
            };
          } else if (cepData.isComplete) {
            response = {
              screen: SCREEN_RESPONSES.complete.screen,
              data: {
                ...mergedDataWithFederalID,
                ...cepData,
                successMessage: "Todas as informações foram recebidas com sucesso!"
              },
            };
          } else {
            response = {
              screen: SCREEN_RESPONSES.address.screen,
              data: {
                ...mergedDataWithFederalID,
                ...cepData,
                infoMessage: "Por favor, complete as informações de endereço."
              },
            };
          }
          break;

        case "address":
          response = {
            screen: SCREEN_RESPONSES.complete.screen,
            data: {
              ...mergedDataWithFederalID,
              successMessage: "Endereço registrado com sucesso!"
            },
          };
          break;

        case "complete":
          response = {
            screen: SCREEN_RESPONSES.SUCCESS.screen,
            data: {
              ...mergedDataWithFederalID,
              successMessage: "Proposta finalizada com sucesso!"
            },
          };
          break;

        default:
          throw new Error(`Tela não reconhecida: ${screen}`);
      }

      setCachedData(screen, response);
      return response;
    }

    // Caso uma ação não seja reconhecida
    throw new Error(`Ação não reconhecida: ${action}`);

  } catch (error) {
    logError("Erro em getNextScreen", error);
    return {
      screen: screen, // Mantém o usuário na tela atual
      data: {
        errorMessage: error.message || "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.",
        technicalDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
    };
  }
};