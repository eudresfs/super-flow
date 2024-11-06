import axios from 'axios';

// Função de Log de Erros
const logError = (message, error) => {
  console.error(`${message}:`, error);
};

// Função para Consulta de Dados do CEP
const fetchCEPData = async (cep) => {
  try {
    console.log(`Buscando dados do CEP: ${cep}`);
    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    console.log(`Dados do CEP recebidos:`, response.data);
    return response.data;
  } catch (error) {
    logError("Erro ao buscar CEP", error);
    return { error: "CEP não localizado" };
  }
};

// Função para Consulta de Dados de Bolsa Família por CPF
const fetchBolsaFamiliaByCPF = async (cpf) => {
  try {
    console.log(`Buscando dados de Bolsa Família para o CPF: ${cpf}`);
    const response = await axios.get(
      `https://api.portaldatransparencia.gov.br/api-de-dados/bolsa-familia-disponivel-por-cpf-ou-nis?anoMesReferencia=202011&pagina=1&codigo=${cpf}`,
      {
        headers: {
          'accept': '*/*',
          'chave-api-dados': 'c21ad49b7475b2e7f202701426414805',
        },
      }
    );
    console.log(`Dados de Bolsa Família recebidos:`, response.data);
    return response.data[0].titularBolsaFamilia;
  } catch (error) {
    logError("Erro ao buscar dados de Bolsa Família", error);
    return { error: "Erro ao buscar dados de Bolsa Família" };
  }
};

// Função Principal para Tratamento de Ações e Retorno de Dados
export const getNextScreen = async (decryptedBody) => {
  console.log('Corpo da requisição decodificado:', decryptedBody);

  const { action, flow_token, version, data, screen } = decryptedBody;

  console.log('Estrutura de dados recebida:', { data, screen, action });

  // Verificação inicial da ação
  switch (action) {
    case "INIT":
      console.log('Action "INIT" recebida. Processando inicialização...');
      return {
        screen: "signup",
        data: { flow_token, version, message: "Inicialização bem-sucedida", error: false },
      };

    case "ping":
      console.log('Action "ping" recebida. Processando verificação de saúde...');
      return {
        version,
        data: { status: "active" },
      };

    case "data_exchange":
      console.log('Action "data_exchange" recebida. Processando dados de troca...');
      
      // Verificar se temos CPF nos dados
      if (data && data.cpf) {
        console.log('CPF encontrado. Buscando dados de Bolsa Família...');
        try {
          const bolsaFamiliaData = await fetchBolsaFamiliaByCPF(data.cpf);
          console.log('Dados de Bolsa Família recebidos:', bolsaFamiliaData);
          
          return {
            screen: "information",
            data: {
              ...bolsaFamiliaData,
              flow_token,
              version,
              error: bolsaFamiliaData.error ? true : false,
              errorMessage: bolsaFamiliaData.error || null,
            },
          };
        } catch (error) {
          logError("Erro ao processar dados de Bolsa Família", error);
          return {
            screen: "information",
            data: {
              flow_token,
              version,
              errorMessage: "Erro ao processar consulta de Bolsa Família.",
              error: true,
            },
          };
        }
      }

      // Verificar se temos CEP nos dados
      if (data && data.cep) {
        console.log('CEP encontrado. Buscando dados do CEP...');
        try {
          const cepData = await fetchCEPData(data.cep);
          console.log('Dados do CEP recebidos:', cepData);
          
          return {
            screen: "address",
            data: {
              ...cepData,
              flow_token,
              version,
              error: cepData.error ? true : false,
              errorMessage: cepData.error || null,
            },
          };
        } catch (error) {
          logError("Erro ao processar consulta de CEP", error);
          return {
            screen: "address",
            data: {
              flow_token,
              version,
              errorMessage: "Erro ao processar consulta de CEP.",
              error: true,
            },
          };
        }
      }
      break;

    default:
      console.log('Action não suportada:', action);
      return {
        screen: "falha",
        data: {
          flow_token,
          version,
          errorMessage: "Ação não suportada.",
          error: true,
        },
      };
  }

  // Caso nenhuma condição anterior seja atendida
  return {
    screen: "falha",
    data: {
      flow_token,
      version,
      errorMessage: "Dados insuficientes ou inválidos.",
      error: true,
    },
  };
};