// Use a sintaxe de import para carregar o axios
import axios from 'axios';

const SCREEN_RESPONSES = {
  account: {
    screen: "account",
    data: {},
  },
  infos: {
    screen: "infos",
    data: {
      name: "João da Silva",
      maxDate: "2006-10-10",
      minDate: "1950-10-10",
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

// Função de envio de dados para o endpoint real
const sendDataToEndpoint = async (payload) => {
  try {
    const response = await axios.post('https://n8n-01.kemosoft.com.br/webhook-test/flows', payload);
    console.log('Data successfully sent:', response.data);
  } catch (error) {
    console.error('Error sending data to endpoint:', error);
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

  // Captura e envia os dados de troca de tela para o endpoint
  const payload = {
    screen,
    data,
    flow_token,
    version,
  };
  await sendDataToEndpoint(payload);

  // Lida com a inicialização do fluxo (action: INIT)
  if (action === "INIT") {
    return {
      ...SCREEN_RESPONSES.account,
    };
  }

  // Lida com troca de dados e de telas (action: data_exchange)
  if (action === "data_exchange") {
    switch (screen) {
      // Manipula a interação com a tela de conta
      case "account":
        // Se o usuário continuar da tela de conta, navega para a tela de informações
        return {
          ...SCREEN_RESPONSES.infos,
        };

      // Manipula a interação com a tela de informações
      case "infos":
        // Após a tela de informações, navega para a tela de endereço
        return {
          ...SCREEN_RESPONSES.address,
        };

      // Manipula a interação com a tela de endereço
      case "address":
        // Após completar a tela de endereço, envia a resposta de sucesso
        return {
          ...SCREEN_RESPONSES.SUCCESS,
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
