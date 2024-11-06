import axios from 'axios';

// Configuração da Tela de Resposta
const SCREEN_RESPONSE = { screen: "address", data: {} };

// Função de Log de Erros
const logError = (message, error) => {
  console.error(`${message}:`, error);
};

// Função para Consulta de Dados do CEP
const fetchCEPData = async (cep) => {
  try {
    if (!/^\d{8}$/.test(cep)) throw new Error('CEP inválido');
    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    return response.data;
  } catch (error) {
    logError("Erro ao buscar CEP", error);
    return { error: "CEP não localizado" };
  }
};

// Função Principal para Tratamento de Ações e Retorno de Dados
export const getNextScreen = async (decryptedBody) => {
  const { action, flow_token, version, data } = decryptedBody;

  if (action === "INIT") {
    // Resposta para inicialização
    return {
      screen: SCREEN_RESPONSE.screen,
      data: { flow_token, version, message: "Inicialização bem-sucedida", error: false }
    };
  }

  if (action === "data_exchange" && data.cep) {
    try {
      const cepData = await fetchCEPData(data.cep);
      return {
        screen: SCREEN_RESPONSE.screen,
        data: { ...cepData, error: !cepData.error ? false : true, errorMessage: cepData.error || "não houveram erros" }
      };
    } catch (error) {
      logError("Erro em getNextScreen", error);
      return {
        screen: SCREEN_RESPONSE.screen,
        data: { errorMessage: "Erro ao processar consulta.", error: true },
      };
    }
  }

  return {
    screen: SCREEN_RESPONSE.screen,
    data: { errorMessage: "Ação não suportada.", error: true },
  };
};
