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
    return { error: "⚠️ CEP não localizado" };
  }
};

// Função para obter o ano e mês atual no formato YYYYMM
const getCurrentYearMonth = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() - 6).padStart(2, '0'); // +1 porque getMonth() retorna 0-11
  return `${year}${month}`;
};

// Função para Consulta de Dados de Bolsa Família por CPF ou NIS
const fetchBolsaFamilia = async (codigo) => {
  const anoMesReferencia = getCurrentYearMonth();
  const codigoLimpo = codigo.replace(/[^\d]/g, '');
  
  try {
    console.log(`Buscando dados de Bolsa Família para: ${codigoLimpo}`);
    console.log(`Ano/Mês de referência: ${anoMesReferencia}`);
    
    const response = await axios.get(
      `https://api.portaldatransparencia.gov.br/api-de-dados/bolsa-familia-disponivel-por-cpf-ou-nis?anoMesReferencia=${anoMesReferencia}&pagina=1&codigo=${codigoLimpo}`,
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
    return [];
  }
};

// Função Principal para Tratamento de Ações e Retorno de Dados
export const getNextScreen = async (decryptedBody) => {
  console.log('Corpo da requisição decodificado:', decryptedBody);
  const { action, flow_token, version, data, screen } = decryptedBody;
  console.log('Estrutura de dados recebida:', { data, screen, action });

  // Switch principal para actions específicas
  switch (action) {
    case "INIT":
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

    default:
      // Switch secundário baseado na screen atual
      switch (screen) {
        case "signup":
          if (data?.cpf) {
            console.log('CPF encontrado. Buscando dados de Bolsa Família...');
            const bolsaFamiliaData = await fetchBolsaFamilia(data.cpf);
            
            return {
              screen: "information",
              data: {
                ...bolsaFamiliaData,
                flow_token,
                version,
                error: bolsaFamiliaData.length === 0,
                errorMessage: bolsaFamiliaData.length === 0 ? "CPF não encontrado" : null,
              },
            };
          }
          break;

        case "information":
          if (data?.cep) {
            console.log('CEP encontrado. Buscando dados do CEP...');
            const cepData = await fetchCEPData(data.cep);
            
            if (cepData.error) {
              return {
                screen: "information",
                data: {
                  flow_token,
                  version,
                  erro_cep: "CEP não localizado",
                  error: true,
                },
              };
            }

            return {
              screen: "address",
              data: {
                ...cepData,
                flow_token,
                version,
                error: false,
                errorMessage: null,
              },
            };
          }
          break;

        default:
          return {
            screen: "falha",
            data: {
              flow_token,
              version,
              errorMessage: "Tela não identificada.",
              error: true,
            },
          };
      }

      // Se nenhuma condição nos switches for atendida
      return {
        screen: "falha",
        data: {
          flow_token,
          version,
          errorMessage: "Dados insuficientes ou inválidos.",
          error: true,
        },
      };
  }
};