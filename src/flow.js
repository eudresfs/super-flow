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
    data: {},
  },
  infos: {
    screen: "infos",
    data: {
      name: "João da Silva", // Este nome é fixo, mas pode ser substituído por outra informação do `n8n`
    },
  },
  address: {
    screen: "address",
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

// Função de envio de dados para o endpoint real e retorna apenas o data da resposta
const sendDataToEndpoint = async (payload) => {
  try {
    const response = await axios.post('https://n8n-01.kemosoft.com.br/webhook-test/flows', payload);
    console.log('Data successfully sent:', response.data);
    return response.data; // Retorna apenas o data da resposta do n8n
  } catch (error) {
    console.error('Error sending data to endpoint:', error);
    return {}; // Retorna um objeto vazio se houver erro
  }
};

export const getNextScreen = async (decryptedBody) => {
  const { screen, data, version, action, flow_token } = decryptedBody;

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
      },
    };
  }

  // Captura e envia os dados de troca de tela para o endpoint, recebendo a resposta
  const endpointData = await sendDataToEndpoint({
    screen,
    data,
    flow_token,
    version,
  });

  // Lida com a inicialização do fluxo (action: INIT)
  if (action === "INIT") {
    return {
      screen: SCREEN_RESPONSES.account.screen,
      data: {
        ...SCREEN_RESPONSES.account.data, // Inclui os dados da tela account (vazio aqui)
        ...endpointData, // Retorna também os dados vindos do n8n
      },
    };
  }

  // Lida com troca de dados e de telas (action: data_exchange)
  if (action === "data_exchange") {
    switch (screen) {
      case "account":
        // Ao continuar da tela account para a tela infos, retornamos os dados do n8n
        // mais o minDate e maxDate dinâmicos
        return {
          screen: SCREEN_RESPONSES.infos.screen,
          data: {
            ...endpointData, // Resposta do n8n
            maxDate: dynamicMaxDate, // Data dinâmica: hoje - 18 anos
            minDate: dynamicMinDate, // Data dinâmica: hoje - 75 anos
          },
        };

      case "infos":
        // Após a tela de informações, navega para a tela de endereço
        return {
          screen: SCREEN_RESPONSES.address.screen,
          data: endpointData, // Retorna somente os dados vindos do n8n
        };

      case "address":
        // Após completar a tela de endereço, envia a resposta de sucesso
        return {
          screen: SCREEN_RESPONSES.SUCCESS.screen,
          data: endpointData, // Retorna somente os dados vindos do n8n
        };

      default:
        break;
    }
  }

  // Caso uma ação não seja reconhecida
  console.error("Unhandled request body:", decryptedBody);
  throw new Error(
    "Unhandled endpoint request. Make sure you handle the request action & screen logged above."
  );
};
