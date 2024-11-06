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
    return response.data;
  } catch (error) {
    logError("Erro ao buscar dados de Bolsa Família", error);
    return { error: "Erro ao buscar dados de Bolsa Família" };
  }
};

// Função Principal para Tratamento de Ações e Retorno de Dados
export const getNextScreen = async (decryptedBody) => {
  console.log('Corpo da requisição decodificado:', decryptedBody);

  const { action, flow_token, version, data } = decryptedBody;

  // Garantir que 'data' existe, se não, definir um objeto vazio
  const { cpf, cep, screen } = data || {};

  console.log('Estrutura de dados recebida:', { cpf, cep, screen });

  // 1. Verificando a action
  switch (action) {
    case "INIT":
      console.log('Action "INIT" recebida. Processando inicialização...');
      return {
        screen: "signup",  // Resposta para tela de cadastro
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
      // Verifica a 'screen' quando a action for 'data_exchange'
      if (screen === "signup" && cpf) {
        console.log('Screen "signup" e CPF encontrado. Buscando dados de Bolsa Família...');
        try {
          const bolsaFamiliaData = await fetchBolsaFamiliaByCPF(cpf);
          console.log('Dados de Bolsa Família recebidos:', bolsaFamiliaData);
          return {
            screen: "information",  // Resposta para a tela 'information'
            data: {
              ...bolsaFamiliaData,
              error: bolsaFamiliaData.error ? true : false,
              errorMessage: bolsaFamiliaData.error || "Não houve erro",
            },
          };
        } catch (error) {
          logError("Erro ao processar dados de Bolsa Família", error);
          return {
            screen: "information",  // Tela de informações com erro
            data: { errorMessage: "Erro ao processar consulta de Bolsa Família.", error: true },
          };
        }
      }
      break;

    default:
      console.log('Action não suportada:', action);
      return {
        screen: "falha",
        data: { errorMessage: "Ação não suportada.", error: true },
      };
  }

  // 2. Verificando a 'screen' e realizando ações adicionais
  if (screen) {
    console.log('Screen encontrada:', screen);

    switch (screen) {
      case "information":
        if (cep) {
          console.log('Screen "information" e CEP encontrado. Buscando dados do CEP...');
          try {
            const cepData = await fetchCEPData(cep);
            console.log('Dados do CEP recebidos:', cepData);
            return {
              screen: "information",  // Retorna a tela 'information' com os dados do CEP
              data: { 
                ...cepData, 
                error: cepData.error ? true : false, 
                errorMessage: cepData.error || "não houveram erros" 
              },
            };
          } catch (error) {
            logError("Erro ao processar consulta de CEP", error);
            return {
              screen: "information",  // Tela de informações com erro
              data: { errorMessage: "Erro ao processar consulta de CEP.", error: true },
            };
          }
        }
        break;

      default:
        console.log('Screen não suportada:', screen);
        return {
          screen: "falha",  // Tela de falha
          data: { errorMessage: "Ação ou screen não suportada.", error: true },
        };
    }
  }

  // Caso não haja 'screen' nem 'action' válida
  console.log('Nenhuma action ou screen válida encontrada. Retornando falha.');
  return {
    screen: "falha",  // Tela de falha
    data: { errorMessage: "Ação ou screen não suportada.", error: true },
  };
};
