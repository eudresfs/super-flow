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

// Configurações para retry
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 segundo

// Função de envio de dados para o endpoint real e retorna apenas o data da resposta
const sendDataToEndpoint = async (payload, retryCount = 0) => {
  try {
    const response = await axios.post('https://n8n-01-webhook.kemosoft.com.br/webhook/flows', payload);
    console.log('Data successfully sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending data to endpoint:', error.message);
    
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
    return {
      isComplete: !!response.data.logradouro, // Considera completo se tiver logradouro
      ...response.data
    };
  } catch (error) {
    console.error('Error fetching CEP data:', error);
    return { isComplete: false };
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
    if (dataCache[screen]) {
      console.log('Using cached data for screen:', screen);
      return dataCache[screen];
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
        dataCache[screen] = response;
        return response;
      } catch (error) {
        console.error("Failed to initialize flow:", error);
        return {
          screen: SCREEN_RESPONSES.account.screen,
          data: {
            federal_id,
            warningMessage: "Inicialização com limitações. Alguns dados podem não estar disponíveis."
          }
        };
      }
    }

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
          if (cepData.isComplete) {
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
          throw new Error(`Unhandled screen: ${screen}`);
      }

      dataCache[screen] = response;
      return response;
    }

    // Caso uma ação não seja reconhecida
    throw new Error(`Unhandled action: ${action}`);

  } catch (error) {
    console.error("Error in getNextScreen:", error);
    return {
      screen: screen, // Mantém o usuário na tela atual
      data: {
        errorMessage: "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.",
      },
    };
  }
};