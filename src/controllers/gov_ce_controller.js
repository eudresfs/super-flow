// src/controllers/gov_ce_controller.js
const { AddressService } = require('../services/addressService');
const { Logger } = require('../utils/logger');
const {
  validaCPF,
  createContact,
  registerAccount,
  uploadFiles,
  registerDocument,
  registerAddress,
  nextStage,
  tagAssign,
  requalify,
  leadData
} = require('../services/apiClient');

class ScreenValidationError extends Error {
  constructor(message, screen) {
    super(message);
    this.name = 'ScreenValidationError';
    this.screen = screen;
  }
}

class GovCEController {
  constructor() {
    this.addressService = new AddressService();
    this.validadores = {
      nome: this.#validateName.bind(this),
      nomeMae: this.#validateName.bind(this)
    };
  }

  // Validadores privados
  #validateName(nome) {
    const nomeValido = nome.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
    if (nomeValido !== nome.trim()) {
      throw new ScreenValidationError('O nome não deve conter números ou caracteres especiais', 'DADOS_PESSOAIS');
    }
    if (nomeValido.split(/\s+/).length < 2) {
      throw new ScreenValidationError('Por favor, informe o nome completo', 'DADOS_PESSOAIS');
    }
    return nomeValido;
  }

  createResponse(screen, data = {}, options = {}) {
    const { flow_token, version, error = false, errorMessage = null } = options;

    const formattedError = data.error ? {
      error: true,
      errorMessage: data.error
    } : {};

    return {
      screen,
      data: {
        ...data,
        ...(flow_token && { flow_token }),
        ...(version && { version }),
        ...formattedError,
        ...(error && { error }),
        ...(errorMessage && { errorMessage })
      }
    };
  }

  async getHandler(screen) {
    const handlers = {
      'FRONT': this.handleFrontScreen.bind(this),
      'CONTRACHEQUE': this.handlePaycheckScreen.bind(this),
      'DADOS_PESSOAIS': this.handleSignupScreen.bind(this),
      'ENDERECO': this.handleAddressScreen.bind(this),
      'PROPOSTA': this.handleProposalScreen.bind(this),
      'INFORMACOES': this.handleInformationScreen.bind(this),
      'CONTA_BANCARIA': this.handleAccountScreen.bind(this),
      'FOTO_DOCUMENTO': this.handleDocumentScreen.bind(this)
    };

    const handlerExists = !!handlers[screen];
    Logger.info('Handler encontrado para tela', {
      screen,
      handlerExists
    });

    return handlers[screen];
  }

  _validateFrontScreen(data) {
    try {
      if (!data.cpf || !data.creditGroup) {
        throw new ScreenValidationError('CPF e grupo de crédito são obrigatórios', 'FRONT');
      }
  
      const cpf = data.cpf.replace(/\D/g, '');
      if (cpf.length !== 11) {
        throw new ScreenValidationError('CPF inválido. Verifique e tente novamente!', 'FRONT');
      }
  
      return { isValid: true };
    } catch (error) {
      return { 
        isValid: false, 
        error: error.message 
      };
    }
  }
  
  _createEnhancedResponse(screen, data, options = {}) {
    const startTime = options.startTime || Date.now();
    const baseResponse = this.createResponse(screen, data, options);
    
    return {
      ...baseResponse,
      metadata: {
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      }
    };
  }

  // HANDLES: O QUE ACONTECE EM CADA TELA
  async handleFrontScreen(data, flow_token, version) {
    const startTime = Date.now();

    try {
      const validationResult = await this._validateFrontScreen(data);
      if (!validationResult.isValid) {
        return this.createResponse('FRONT', {
          cpfErro: `⚠️ ${validationResult.error}`
        }, { flow_token, version });
      }
  
      const [leadInfo, nextStep, cpfValidation] = await Promise.all([
        leadData(data.cpf),
        nextStage(data.cpf, data.creditGroup),
        validaCPF(data.cpf)
      ]);

      if (!cpfValidation) {
        throw new ScreenValidationError('CPF inválido! Verifique o documento e tente novamente.', 'FRONT');
      }

      // Converte birthDate para o formato brasileiro
      if (leadInfo?.[0]?.customer?.birthDate) {
        const [year, month, day] = leadInfo[0].customer.birthDate.split("-");
        leadInfo[0].customer.birthDate = `${day}/${month}/${year}`;
      }

      if (nextStep?.etapaFunil?.toLowerCase() === 'inexistente') {
        return this._createEnhancedResponse(
          'DADOS_PESSOAIS', 
          { ...leadInfo?.[0]?.customer }, 
          { flow_token, version, startTime }
        );
      }
      

      // Verifica oportunidades
      if (
        nextStep?.situacao === 'escolher-simulacao' && Array.isArray(nextStep?.pedirInfos) &&
        nextStep.pedirInfos.includes('documento') && Array.isArray(nextStep?.oportunidades) &&
        nextStep.oportunidades.length > 0
      ) {
        const title = nextStep.oportunidades[0].valor;
        const pageTitle = 'Simulação';
        return this._createEnhancedResponse('PROPOSTA', { title, pageTitle }, { 
          flow_token, version, startTime 
        });
      }

      // Configuração de telas
      const SCREEN_CONFIG = {
        screens: {
          documento: 'DADOS_PESSOAIS',
          endereco: 'ENDERECO',
          conta: 'CONTA_BANCARIA',
          contracheque: 'WARNING',
          'imagem-rg-frente': 'WARNING',
          'imagem-rg-verso': 'WARNING'
        },
        priority: ['documento', 'endereco', 'conta', 'contracheque', 'imagem-rg-frente', 'imagem-rg-verso']
      };

      // Define próxima tela
      if (Array.isArray(nextStep?.pedirInfos)) {
        // Encontra o primeiro item da priority que existe em pedirInfos
        const nextScreen = SCREEN_CONFIG.priority.find(priorityItem => 
          nextStep.pedirInfos.includes(priorityItem)
        );
    
        return this._createEnhancedResponse(
            SCREEN_CONFIG.screens[nextScreen] || 'COMPLETE', 
            { leadId: nextStep.id, ...leadInfo?.[0]?.customer, suporte: true },
            { flow_token, version, startTime }
        );
       }
  
    } catch (error) {
      Logger.error('Erro na consulta de CPF', {
        error: error.message,
        stack: error.stack,
        flow_token,
        duration: Date.now() - startTime
      });
  
      return this.createResponse('FRONT', {
        cpfErro: `⚠️ ${error.message}`
      }, { flow_token, version });
    }
  }

  async handleSignupScreen(data, flow_token, version) {
    const startTime = Date.now();
    
    try {
      this.validadores.nome(data.nome);
  
      const handleLead = async (data, flow_token) => {
        const lead = await createContact(data, flow_token);
        if (!lead?.id) throw new Error('Erro ao criar contato');
        return lead;
      };
      
      const lead = await handleLead(data, flow_token);
      
      await Promise.all([
        tagAssign(lead.id, "ce1b1427-bd86-4ed5-bb04-7b462a6e2ada"), // Tag de Teste (Remover)
        nextStage(lead.id)
      ]);

      // Verifica oportunidades
      const oportunidades = nextStage?.oportunidades;
      if (oportunidades?.length > 0) {
        const title = nextStep.oportunidades[0].valor

        return this._createEnhancedResponse(
          'PROPOSTA',
          { title },
          { flow_token, version, startTime }
        );
      }

      return this._createEnhancedResponse(
        'PROPOSTA',
        { title: 0, leadId: lead.id },
        { flow_token, version, startTime }
      );
  
    } catch (error) {
      Logger.error('Erro no cadastro', {
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });
  
      return this.createResponse('DADOS_PESSOAIS', {
        nomeErro: `⚠️ ${error.message}`
      }, { flow_token, version });
    }
  }

  async handleInformationScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {

      // Validar nome da mãe
      if (data.nomeMae) {
        this.validadores.nomeMae(data.nomeMae);
      } else {
        throw new ScreenValidationError('Nome da mãe não informado', 'INFORMATION');
      }

      const withTimeout = (promise, timeout = 30000) => {
        return Promise.race([
          promise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tempo limite excedido')), timeout)
          )
        ]);
      };

      // Usar em todas as chamadas externas
      const cepData = await withTimeout(
        this.addressService.fetchCEPData(data.cep)
      );

      if (cepData.error) {
        return this.createResponse('INFORMACOES', {
          cepErro: cepData.error
        }, { flow_token, version });
      }

      // Usar o estado retornado pelo CEP
      const documentResponse = await registerDocument({
        cpf: data.cpf,
        tipo: data.tipo || "RG",
        numero: data.numero,
        nomeMae: data.nomeMae,
        ufAgencia: cepData.state, // Usar o estado do CEP
        agencia: data.agencia || "SSP"
      });

      Logger.info('Information processado', {
        flow_token,
        duration: Date.now() - startTime,
        leadId: data.leadId,
        state: cepData.state
      });

      return this.createResponse('ENDERECO', cepData, { flow_token, version });

    } catch (error) {
      Logger.error('Erro no processamento de information', {
        error: error.message,
        flow_token,
        duration: Date.now() - startTime,
        stack: error.stack
      });

      // Determinar qual campo teve erro baseado na mensagem
      let errorField = 'cepErro'; // Default

      if (error.message.toLowerCase().includes('nome da mãe') ||
        error.message.toLowerCase().includes('nome completo da mãe')) {
        errorField = 'nomeMaeErro';
      }

      return this.createResponse('INFORMACOES', {
        [errorField]: `⚠️ ${error.message}`
      }, { flow_token, version });
    }
  }

  async handleAddressScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      Logger.info('Iniciando processamento do endereço', {
        flow_token,
        timestamp: new Date().toISOString(),
        receivedData: data
      });

      try {
        // Registrar endereço
        await registerAddress(data);

        Logger.info('Endereço processado com sucesso', {
          flow_token,
          duration: Date.now() - startTime
        });

        // Redirecionar para a próxima tela
        return this.createResponse('CONTA_BANCARIA', {}, {
          flow_token,
          version
        });

      } catch (error) {
        // Se o erro for de validação da API, retornar mensagem amigável
        const errorMessage = error.message.includes('must be a string') ?
          'Por favor, preencha todos os campos obrigatórios.' :
          error.message;

        Logger.error('Erro ao registrar endereço na API', {
          error: error.message,
          stack: error.stack,
          addressData
        });

        return this.createResponse('ENDERECO', {
          error: `⚠️ ${errorMessage}`
        }, {
          flow_token,
          version
        });
      }

    } catch (error) {
      Logger.error('Erro no processamento do endereço', {
        error: error.message,
        flow_token,
        duration: Date.now() - startTime,
        stack: error.stack,
        receivedData: data
      });

      return this.createResponse('ENDERECO', {
        error: `⚠️ ${error.message}`
      }, {
        flow_token,
        version
      });
    }
  }

  async handleAccountScreen(data, flow_token, version) {
    try {
      // Validar dados bancários obrigatórios
      const requiredFields = ['agencia', 'conta', 'tipoConta', 'codigoBanco'];
      const missingFields = requiredFields.filter(field => !data[field]);
      
      // Validar se tem pelo menos CPF ou leadId
      if (!data.cpf && !data.leadId) {
        missingFields.push('cpf ou leadId');
      }
  
      // Registrar conta
      await registerAccount(data);
      const lead = await nextStage(data.cpf, 'gov-ce')
  
      return this.createResponse('WARNING', {leadId: lead.id}, { 
        flow_token, 
        version 
      });
  
    } catch (error) {
      Logger.error('Erro no processamento de conta', {
        error: error.message,
        stack: error.stack
      });
  
      return this.createResponse('CONTA_BANCARIA', {
        contaErro: `⚠️ ${error.message}`
      }, { 
        flow_token, 
        version,
        error: true 
      });
    }
  }
 
  async handleDocumentScreen(data, flow_token, version) {
    const startTime = Date.now();

    try {
        if (!data?.foto_documento?.length || data.foto_documento.length < 2) {
            throw new Error('São necessárias duas fotos do documento (frente e verso)');
        }

        if (!data?.leadId) {
            throw new Error('ID do lead é obrigatório');
        }

      // Upload dos documentos
      const [documento] = await Promise.all([
        uploadFiles(data),
        tagAssign(data.leadId, "314faa2a-535e-44f9-8d5f-b33bf0337030"), // Tag de conclusão
      ]);
      
      Logger.info('Documentos processados com sucesso', {documento}, {
          leadId: data.leadId,
          flow_token
      });

      return this.createResponse('COMPLETE', {documento}, { 
          flow_token, 
          version 
      });

    } catch (error) {
        Logger.error('Erro no processamento dos documentos', {
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });

        return this.createResponse("FOTO_DOCUMENTO", {
            documentoError: `⚠️ ${error.message}`
        }, { 
            flow_token,
            version,
            error: true 
        });
    }
  }
  
  async handlePaycheckScreen(data, flow_token, version) {
    const startTime = Date.now();
    
    try {
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
                Logger.warn('Timeout global atingido, seguindo para próxima tela', {
                    duration: Date.now() - startTime
                });
                resolve(this.createResponse("PROPOSTA", {
                    title: 0,
                    timeoutMessage: 'Processamento em andamento'
                }, {
                    flow_token,
                    version
                }));
            }, 15000); // Aumentado para 15 segundos
        });

        const processamentoPromise = (async () => {
            if (!data?.contracheque?.length) {
                throw new Error('Dados do contracheque não fornecidos');
            }

            // Upload e processo do contracheque
            const processPaycheck = async (fileData, leadId) => {
                Logger.info('Iniciando upload do contracheque', { leadId });
                const result = await uploadFiles({
                    contracheque: fileData,
                    leadId
                }, false);

                return result;
            };

            // Verifica oportunidades do lead
            const checkOportunidades = async (leadId, documentoLink) => {
                const config = {
                    maxRetries: 5,
                    baseDelay: 500,
                    maxTimeout: 10000,
                    maxDelay: 1000,
                    nextStageTimeout: 3000
                };

                if (!leadId || !documentoLink) {
                    throw new Error('LeadId e documentoLink são obrigatórios');
                }

                const getDelay = (attempt) => {
                    const exponentialDelay = Math.min(
                        config.maxDelay,
                        config.baseDelay * Math.pow(2, attempt)
                    );
                    const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1);
                    return Math.floor(exponentialDelay + jitter);
                };

                const isTimeout = (startTime) => Date.now() - startTime > config.maxTimeout;

                const withTimeout = (promise, ms) => {
                    let timeout;
                    const timeoutPromise = new Promise((_, reject) => {
                        const timeoutError = new Error('Operation timed out');
                        timeoutError.name = 'TimeoutError';
                        timeout = setTimeout(() => reject(timeoutError), ms);
                    });
                    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
                };

                try {
                    Logger.info('Iniciando requalificação do lead', {
                        leadId,
                        documentoLink
                    });

                    await requalify({
                        leadId,
                        type: 'paystub',
                        url: documentoLink
                    });

                    Logger.info('Requalificação realizada com sucesso', { leadId });
                } catch (error) {
                    Logger.error('Erro na requalificação do lead', {
                        leadId,
                        error: error.message
                    });
                    throw new Error(`Falha na requalificação do lead: ${error.message}`);
                }

                const startTime = Date.now();
                let lastError = null;
                let lastLeadData = null;

                for (let attempt = 0; attempt < config.maxRetries; attempt++) {
                    try {
                        Logger.info('Tentativa de buscar nextStage', {
                            leadId,
                            attempt: attempt + 1
                        });

                        const leadData = await withTimeout(
                            nextStage(leadId),
                            config.nextStageTimeout
                        );

                        // Log da estrutura completa para debug
                        Logger.info('Resposta do nextStage', {
                            leadId,
                            attempt: attempt + 1,
                            hasOportunidades: !!leadData?.oportunidades,
                            oportunidadesLength: leadData?.oportunidades?.length,
                            etapaFunil: leadData?.etapaFunil,
                            situacao: leadData?.situacao
                        });

                        lastLeadData = leadData;

                        if (leadData?.oportunidades?.length > 0) {
                            Logger.info('Oportunidades encontradas', {
                                leadId,
                                attempt: attempt + 1,
                                duration: Date.now() - startTime,
                                oportunidadesCount: leadData.oportunidades.length,
                                primeiraOportunidade: {
                                    valor: leadData.oportunidades[0].valor,
                                    produto: leadData.oportunidades[0].produto
                                }
                            });
                            return leadData.oportunidades;
                        }

                        if (isTimeout(startTime)) {
                            Logger.warn('Timeout global atingido ao buscar oportunidades', {
                                leadId,
                                duration: Date.now() - startTime,
                                lastLeadData: !!lastLeadData,
                                ultimaSituacao: lastLeadData?.situacao
                            });
                            break;
                        }

                        if (attempt < config.maxRetries - 1) {
                            const delay = getDelay(attempt);
                            Logger.info('Aguardando próxima tentativa', {
                                leadId,
                                attempt: attempt + 1,
                                delay
                            });
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    } catch (error) {
                        lastError = error;
                        const duration = Date.now() - startTime;

                        Logger.warn('Erro ao buscar oportunidades', {
                            leadId,
                            attempt: attempt + 1,
                            error: error.message,
                            duration,
                            timeoutReached: isTimeout(startTime),
                            isTimeoutError: error.name === 'TimeoutError'
                        });

                        if (isTimeout(startTime)) {
                            break;
                        }
                    }
                }

                Logger.warn('Não foram encontradas oportunidades após todas as tentativas', {
                    leadId,
                    duration: Date.now() - startTime,
                    error: lastError?.message,
                    attemptsCompleted: config.maxRetries,
                    lastLeadDataStatus: !!lastLeadData,
                    ultimaSituacao: lastLeadData?.situacao,
                    errorType: lastError?.name
                });

                if (lastError) {
                    throw new Error(`Falha ao buscar oportunidades após ${config.maxRetries} tentativas: ${lastError.message}`);
                }

                return lastLeadData?.oportunidades || [];
            };

            // Processamento principal
            Logger.info('Iniciando processamento do contracheque', {
                hasLeadId: !!data.leadId
            });
            
            const paycheck = await processPaycheck(data.contracheque, data.leadId);
            checkOportunidades(data.leadId, paycheck[0].link)

            // Retorno padrão
            return this.createResponse("FOTO_DOCUMENTO", {
                documento: paycheck[0]
            }, {
                flow_token,
                version
            });
        })();

        return await Promise.race([processamentoPromise, timeoutPromise]);

    } catch (error) {
        Logger.error('Erro no processamento do contracheque', {
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });

        return this.createResponse("CONTRACHEQUE", {
            contrachequeError: `⚠️ ${error.message}`
        }, { 
            flow_token,
            version,
            error: true 
        });
    }
  }

  async handleProposalScreen(data, flow_token, version) {
    const startTime = Date.now();
    
    try {
      const parseAmount = (value) => {
        if (typeof value === 'number') return value;
        
        const lastComma = value.lastIndexOf(',');
        const lastDot = value.lastIndexOf('.');
        const isCommaSeparated = lastComma > lastDot;
        
        return isCommaSeparated
          ? Number(value.replace(/R?\$?\s*/g, '').replace(/\./g, '').replace(',', '.'))
          : Number(value.replace(/R?\$?\s*/g, '').replace(/,/g, ''));
      };
      
      const formatAmount = (value) => Number(value.toFixed(2));
      
      const normalizeCents = (value) => {
        const hasValidFormat = /^[1-9]\d{0,2}([,\.]\d{3})*[,\.]?\d{2}$/.test(value);
        return hasValidFormat ? (value.includes(',') ? value : `${value},00`) : null;
      };
      
      const calculateSimulation = ({ marginRCC, coefficient = 0.059188 }) => {
        const normalized = normalizeCents(String(marginRCC));
        const marginValue = normalized ? parseAmount(normalized) : parseAmount(marginRCC);
      
        // Validação dos limites do salário
        if (marginValue < 10 || marginValue > 4999) {
          throw new Error('O valor do salário deve estar entre R$ 10,00 e R$ 4.999,00');
        }
        
        const margem = formatAmount(marginValue * 0.9);
        const netAmount = formatAmount(margem / Math.max(coefficient, 0));
        
        return {
          margem,
          netAmount
        };
      };
      
      // Validação inicial
      if (!data?.marginRCC) {
        throw new Error('Salário não informado');
      }
      
      // Processamento
      const { netAmount } = calculateSimulation({
        marginRCC: data.marginRCC,
        coefficient: data.coefficient
      });
      
      Logger.info('Simulação calculada', {
        margin: data.marginRCC,
        netAmount
      });
      
      return this._createEnhancedResponse(
        'PROPOSTA',
        { title: netAmount, pageTitle: "Veja sua simulação!" },
        { flow_token, version, startTime }
      );
      
    } catch (error) {
      Logger.error('Erro no cálculo da proposta', {
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });
      
      return this.createResponse('PROPOSTA', {
        marginRccError: `⚠️ ${error.message}`,
        pageTitle: "Simulação"
      }, { 
        flow_token, 
        version,
        error: true 
      });
    }
  }
}

module.exports = {
  GovCEController,
  ScreenValidationError
};
