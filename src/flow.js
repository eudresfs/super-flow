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

// Função Principal para Consultar CEP e Retornar Tela
export const getNextScreen = async (decryptedBody) => {
  const { cep } = decryptedBody.data;

  try {
    const cepData = await fetchCEPData(cep);
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
};