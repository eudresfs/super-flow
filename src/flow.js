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

// Função auxiliar para identificar se é NIS
const isNIS = (codigo) => {
  return codigo.length === 11 && (codigo.startsWith('1') || codigo.startsWith('2'));
};

// Array fixo para datas de CPF
const CPF_DATES = ['202306', '202206', '202106', '202006', '201906'];

// Função auxiliar para gerar array de datas para NIS
const getNISDates = () => {
  const dates = [];
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1; // getMonth() retorna 0-11

  for (let i = 0; i < 6; i++) {
    month--;
    if (month === 0) {
      month = 12;
      year--;
    }
    const formattedMonth = month.toString().padStart(2, '0');
    dates.push(`${year}${formattedMonth}`);
  }
  return dates;
};

// Função principal para consulta de Bolsa Família
const fetchBolsaFamilia = async (codigo) => {
  const codigoLimpo = codigo.replace(/[^\d]/g, '');
  const isNISCode = isNIS(codigoLimpo);

  // Define as datas e endpoint baseado no tipo de código
  const dates = isNISCode ? getNISDates() : CPF_DATES;
  const baseUrl = isNISCode
    ? 'https://api.portaldatransparencia.gov.br/api-de-dados/novo-bolsa-familia-sacado-por-nis'
    : 'https://api.portaldatransparencia.gov.br/api-de-dados/bolsa-familia-disponivel-por-cpf-ou-nis';
  
  const headers = {
    'accept': '*/*',
    'chave-api-dados': 'c21ad49b7475b2e7f202701426414805',
  };

  // Tenta cada data até encontrar dados ou esgotar as tentativas
  for (const date of dates) {
    try {
      console.log(`Tentando buscar dados para ${isNISCode ? 'NIS' : 'CPF'}: ${codigoLimpo} - Data: ${date}`);
      
      const url = isNISCode
        ? `${baseUrl}?anoMesReferencia=${date}&pagina=1&nis=${codigoLimpo}`
        : `${baseUrl}?anoMesCompetencia=${date}&pagina=1&codigo=${codigoLimpo}`;
      
      const response = await axios.get(url, { headers });
      
      // Se encontrou dados, retorna imediatamente
      if (response.data && response.data.length > 0) {
        console.log(`Dados encontrados para a data ${date}`);
        return response.data;
      }
      
      console.log(`Nenhum dado encontrado para a data ${date}`);
    } catch (error) {
      logError(`Erro ao buscar dados de Bolsa Família para a data ${date}`, error);
      continue; // Continua para a próxima data mesmo se houver erro
    }
  }

  // Se chegou aqui, não encontrou dados em nenhuma tentativa
  console.log(`Nenhum dado encontrado após tentar todas as datas disponíveis`);
  return [];
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
          
        case "account":
          if (data?.nis) {
            console.log('NIS encontrado. Buscando dados de Bolsa Família...');
            const bolsaFamiliaData = await fetchBolsaFamilia(data.nis);
            
            return {
              screen: "account",
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