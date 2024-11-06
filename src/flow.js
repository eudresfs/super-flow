import axios from 'axios';

// Função de Log de Erros
const logError = (message, error) => {
  console.error(`${message}:`, error);
};

// Função para Consulta de Dados do CEP
const fetchCEPData = async (cep) => {
  try {
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
  const { screen, cpf, cep } = data;

  // Primeiro, tratamos a action
  switch (action) {
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

    default:
      break;
  }

  // Agora, tratamos o screen
  switch (screen) {
    case "signup":
      if (cpf) {
        try {
          const bolsaFamiliaData = await fetchBolsaFamiliaByCPF(cpf);
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
      try {
        const cepData = await fetchCEPData(cep);
        return {
          screen: "information", // Retorna sempre como "information"
          data: { 
            ...cepData, 
            error: !cepData.error ? false : true, 
            errorMessage: cepData.error || "não houveram erros" 
          }
        };
      } catch (error) {
        logError("Erro ao processar consulta de CEP", error);
        return {
          screen: "information", // Retorna sempre como "information"
          data: { errorMessage: "Erro ao processar consulta.", error: true },
        };
      }
      break;

    default:
      return {
        screen: "falha",  // Caso o screen não corresponda a nenhum caso
        data: { errorMessage: "Ação não suportada.", error: true },
      };
  }
};
