import axios from 'axios';

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

// Função para Consulta de Dados de Bolsa Família por CPF
const fetchBolsaFamiliaByCPF = async (cpf) => {
  try {
    const response = await axios.get(
      `https://api.portaldatransparencia.gov.br/api-de-dados/bolsa-familia-disponivel-por-cpf-ou-nis?anoMesReferencia=202011&pagina=1&codigo=${cpf}`,
      {
        headers: {
          'accept': '*/*',
          'chave-api-dados': 'c21ad49b7475b2e7f202701426414805',
        },
      }
    );
    return response.data;
  } catch (error) {
    logError("Erro ao buscar dados de Bolsa Família", error);
    return { error: "Erro ao buscar dados de Bolsa Família" };
  }
};

// Função Principal para Tratamento de Ações e Retorno de Dados
export const getNextScreen = async (decryptedBody) => {
  const { action, flow_token, version, data } = decryptedBody;
  const { screen } = data;

  switch (screen) {
    case "INIT":
      // Resposta para inicialização
      return {
        screen: "signup",  // Alterado para "information"
        data: { flow_token, version, message: "Inicialização bem-sucedida", error: false }
      };

    case "ping":
      // handle health check request
      return {
        version,
        data: {
          status: "active",
        },
      };
      
    case "signup":
      if (data.cpf) {
        try {
          const bolsaFamiliaData = await fetchBolsaFamiliaByCPF(data.cpf);
          return {
            screen: "information",
            data: { 
              ...bolsaFamiliaData, 
              error: !bolsaFamiliaData.error ? false : true, 
              errorMessage: bolsaFamiliaData.error || "Não houve erro" 
            },
          };
        } catch (error) {
          logError("Erro em getNextScreen (signup)", error);
          return {
            screen: "information",
            data: { errorMessage: "Erro ao processar consulta de Bolsa Família.", error: true },
          };
        }
      }
      break;

    case "information":
      if (action === "data_exchange" && data.cep) {
        try {
          const cepData = await fetchCEPData(data.cep);
          return {
            screen: "address", // Alterado para "address"
            data: { ...cepData, error: !cepData.error ? false : true, errorMessage: cepData.error || "não houveram erros" }
          };
        } catch (error) {
          logError("Erro em getNextScreen", error);
          return {
            screen: "address",  // Alterado para "address"
            data: { errorMessage: "Erro ao processar consulta.", error: true },
          };
        }
      }
      break;

    default:
      return {
        screen: "address",  // Alterado para "address" caso o screen não corresponda a nenhum case
        data: { errorMessage: "Ação não suportada.", error: true },
      };
  }
};
