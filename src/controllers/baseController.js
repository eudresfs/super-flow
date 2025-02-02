// controllers/baseController.js
const { Logger } = require('../utils/logger');
const { cpfCache, cepCache } = require('../services/cacheService');
const { AddressService } = require('../services/addressService'); 
const { transformData, extractOpportunities } = require('../utils/formatCards');
const { 
  nextStage, 
  createContact,
  registerAccount, 
  registerAddress, 
  registerDocument, 
  requalify, 
  leadData, 
  updateBasicLeadData, 
  uploadFiles,
  validaCPF
} = require('../services/apiClient');
const { ScreenValidationError } = require('../utils/errors');
const telemetry = require('../utils/telemetry'); // Importa módulo de telemetry para rastreamento

// Importa validadores (assumindo que exista)
// Isso previne erros ao chamar this.validadores.nome() ou this.validadores.nomeMae()
const validadores = require('../utils/validadores');

class BaseController {
  constructor() {
    this.addressService = new AddressService();
    this.screenConfig = this._initializeScreenConfig();
    this.validadores = validadores; // Inicializando o módulo de validadores
  }

  // Inicializa a configuração das telas
  _initializeScreenConfig() {
    const documentScreenHandler = {
      get: (target, prop) => prop in target ? target[prop] : 'warning'
    };

    return {
      screens: {
        'matricula': 'signup',
        'data-nascimento': 'signup',
        'documento': 'information',
        'endereco': 'address',
        'conta': 'account',
        ...new Proxy({
          'imagem-rg-frente': 'warning',
          'imagem-rg-verso': 'warning',
          'contracheque': 'warning'
        }, documentScreenHandler)
      },
      priority: [
        'data-nascimento',
        'matricula',
        'documento',
        'endereco',
        'conta',
        'imagem-rg-frente',
        'imagem-rg-verso',
        'contracheque'
      ]
    };
  }

  // Determina a próxima tela com base nas informações do lead
  _determineNextScreen(lead, creditGroup, flow_token) {
    const startTime = Date.now();

    if (!lead || !Array.isArray(lead.pedirInfos) || lead.pedirInfos.length === 0) {
      telemetry.trackCustomEvent('FlowCompletion', 
        { 
          screen: 'complete', 
          creditGroup,
          flow_token, 
          startTime
        });
      return 'complete';
    }

    const nextScreen = this.screenConfig.priority.find(screen => 
      lead.pedirInfos.includes(screen)
    );

    telemetry.trackCustomEvent('FlowCompletion', 
      { 
        screen: 'complete', 
        creditGroup,
        flow_token, 
        startTime
      });
    return nextScreen ? this.screenConfig.screens[nextScreen] : 'complete';
  }

  /**
   * Adiciona timeout a uma promessa.
   *
   * @param {Promise} promise - Promessa a ser executada.
   * @param {number} [timeout=9000] - Tempo máximo em milissegundos.
   * @returns {Promise} - Uma promessa que rejeita se o tempo limite for excedido.
   */
  _withTimeout(promise, timeout = 9000) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tempo limite excedido')), timeout)
      )
    ]);
  }

  // Valida o lead e o CPF
  async _validateLeadAndCPF(cpf, creditGroup) {
    try {
      const [lead, cpfValidation] = await Promise.all([
        this._withTimeout(nextStage(cpf, creditGroup)),
        this._withTimeout(validaCPF(cpf))
      ]);

      if (!cpfValidation) {
        throw new ScreenValidationError(
          'CPF inválido! Verifique o documento e tente novamente.',
          'front'
        );
      }

      return lead;
    } catch (error) {
      throw error;
    }
  }

  createResponse(screen, data = {}, options = {}) {
    const {
      flow_token,
      version,
      error = false,
      errorMessage = null,
      startTime = null
    } = options;

    const baseResponse = {
      screen,
      data: {
        ...data,
        ...(flow_token && { flow_token }),
        ...(version && { version }),
        ...(error && { error }),
        ...(errorMessage && { errorMessage })
      }
    };

    if (startTime) {
      return {
        ...baseResponse,
        metadata: {
          processingTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }

    return baseResponse;
  }

  // Retorna os campos obrigatórios de acordo com o produto
  getProductRequiredItems(idToMatch) {
    const listItems = new Map([
      ["inss", {
        askEnrollment: true,
        enrollmentLabel: "Número do Benefício",
        enrollmentTutorial: false,
        askEmail: false,
        askRepresentative: true,
        askMargin: false,
        askBirth: true,
        askWork: false,
        creditGroup: "inss",
      }],
      ["fgts", {
        askEnrollment: false,
        enrollmentLabel: "Matrícula",
        enrollmentTutorial: false,
        askEmail: false,
        askRepresentative: false,
        askMargin: false,
        askBirth: true,
        askWork: true,
        creditGroup: "fgts",
      }],
      ["crefisa", {
        askEnrollment: true,
        enrollmentLabel: "Número do NIS",
        enrollmentTutorial: true,
        askEmail: false,
        askRepresentative: false,
        askMargin: false,
        askBirth: true,
        askWork: false,
        creditGroup: "crefisa",
      }],
      ["gov-ce", {
        askEnrollment: true,
        enrollmentLabel: "Matrícula",
        enrollmentTutorial: false,
        askEmail: true,
        askRepresentative: false,
        askMargin: false,
        askBirth: true,
        askWork: false,
        creditGroup: "gov-ce",
      }],
      ["siape", {
        askEnrollment: true,
        enrollmentLabel: "Matrícula",
        enrollmentTutorial: false,
        askEmail: false,
        askRepresentative: false,
        askMargin: false,
        askBirth: true,
        askWork: false,
        creditGroup: "siape",
      }],
    ]);

    return listItems.get(idToMatch) || null;
  }

  handleError(error, screen, flow_token, version) {
    Logger.error(`Erro em ${screen}`, {
      error: error.message,
      stack: error.stack
    });

    return this.createResponse(screen, {
      error: true,
      errorMessage: `⚠️ ${error.message}`
    }, { flow_token, version });
  }

  validateRequired(data, fields) {
    const missing = fields.filter(field => !data[field]);
    if (missing.length) {
      throw new Error(`Campos obrigatórios faltando: ${missing.join(', ')}`);
    }
  }

  _createEnhancedResponse(screen, data = {}, options = {}) {
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

  // Método helper para processamento de oportunidades
  async _processOpportunities(nextStageResponse) {
    if (!nextStageResponse.oportunidades?.length) {
      return {
        ...nextStageResponse,
        oportunidades: [],
        cards: [],
        cardIds: []
      };
    }

    const preDigitacaoOpportunities = nextStageResponse.oportunidades.filter(
      opp => opp.produto === "Pré-digitação Aumento"
    );

    const cards = await extractOpportunities(preDigitacaoOpportunities);
    const cardIds = cards.map(card => card.id);

    return {
      ...nextStageResponse,
      oportunidades: preDigitacaoOpportunities,
      cards,
      cardIds
    };
  }

  // Método helper para tratamento de novos leads
  async _handleNewLead(data, leadData, flow_token, version, startTime) {
    try {
      Logger.info('Processando novo lead', {
        leadId: leadData.id,
        timestamp: new Date().toISOString()
      });

      const formatBrazilianDate = (isoDate) => {
        if (!isoDate) return '';
        try {
          const [year, month, day] = isoDate.split('-');
          return `${day}/${month}/${year}`;
        } catch (error) {
          Logger.error('Erro ao formatar data:', error);
          return '';
        }
      };

      const buildLeadData = (lead, leadInfo = [], additionalData = []) => {
        const customer = leadInfo[0]?.customer;
        const extraData = additionalData[0] || {};

        if (customer?.birthDate) {
          customer.birthDate = formatBrazilianDate(customer.birthDate);
        }

        return {
          leadId: lead.id,
          nome: extraData.nome || customer?.name || '',
          enrollment: customer?.enrollment || '',
          birthDate: customer?.birthDate || '',
        };
      };

      const lead = buildLeadData(leadData);

      return this._createEnhancedResponse('signup', { ...lead }, {
        flow_token,
        version,
        startTime
      });

    } catch (error) {
      Logger.error('Erro ao processar novo lead', {
        error: error.message,
        leadId: leadData.id,
        duration: Date.now() - startTime
      });

      return this.handleError(error, 'front', flow_token, version);
    }
  }

/** 
 * MÉTODOS DE PROCESSAMENTO DE TELAS
 * Cada método lida com uma tela específica do fluxo
 * Cada método deve retornar um objeto contendo a próxima tela e os dados necessários
 * para essa tela, ou lançar um erro caso algo dê errado
 * Os métodos devem ser assíncronos e retornar uma Promise
 * Os métodos são chamados a partir do método getHandler
 * O método getHandler deve retornar o método apropriado para a tela solicitada 
 */

  async handleFrontScreen(data, flow_token, version) {
    const startTime = Date.now();

    try {
      // Validação do lead e CPF
      const lead = await this._validateLeadAndCPF(data.cpf, data.creditGroup);

      // Lógica para lead inexistente
      if (lead.etapaFunil?.toLowerCase() === 'inexistente') {
        // await this._withTimeout(createContact(data)); // Cria contato
        const productRequiredItems = this.getProductRequiredItems(data.creditGroup)
        return this.createResponse('signup', { ...productRequiredItems }, { flow_token, version });
      }

      // Lógica para leads com oportunidades
      if (lead?.situacao === 'escolher-simulacao' && 
        Array.isArray(lead?.pedirInfos) && lead.pedirInfos.length > 0 && 
        Array.isArray(lead?.oportunidades) && lead.oportunidades.length > 0) {
        const oportunidades = lead.oportunidades || []; 
        
        const totalValor = oportunidades
          .reduce((acc, opp) => acc + (Number(opp.valor) || 0), 0)
          .toFixed(2); // Soma total dos valores das oportunidades
      
        const cards = await transformData(oportunidades, data.creditGroup); // Transforma oportunidades em cards
        const multiselect = data.creditGroup === 'inss'; // Determina se o produto é multiselect
      
        return this._createEnhancedResponse(
          'opportunities', 
          { cards, totalValor, multiselect }, 
          { flow_token, version, startTime }
        ); // Retorna tela de oportunidades
      }

      // Determina próxima tela
      const nextScreen = this._determineNextScreen(lead, data.creditGroup, flow_token);

      Logger.info('Front screen processado com sucesso', {
        leadId: lead.id,
        nextScreen,
        duration: Date.now() - startTime
      });

      return this.createResponse(nextScreen, { leadId: lead.id }, {
        flow_token,
        version,
        startTime
      }); // Retorna próxima tela baseado no 'próxima-etapa' do lead

    } catch (error) {
      Logger.error('Erro no processamento de front', {
        error: error.message,
        stack: error.stack,
        flow_token,
        duration: Date.now() - startTime
      });

      return this.createResponse('front', {
        cpfErro: `⚠️ ${error.message}`
      }, { flow_token, version });
    }
  }

  /**
   * Processa a tela de cadastro (signup).
   *
   * @param {Object} data - Dados enviados pelo cliente.
   * @param {string} flow_token - Token identificador do fluxo.
   * @param {string} version - Versão do fluxo.
   * @returns {Promise<Object>} Resposta com a próxima tela e dados adicionais.
   */
  async handleSignupScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      // Validações básicas
      this.validadores.nome(data.nome);

      // Registra contato e busca próximo estágio
      const [lead, nextStageResponse] = await Promise.all([
        createContact(data),
        nextStage(data.cpf || data.leadId)
      ]);

      // Processa oportunidades se existirem
      if (nextStageResponse?.oportunidades?.length > 0) {
        const opportunities = await this._processOpportunities(nextStageResponse);

        Logger.info('Signup processado com oportunidades', {
          leadId: lead.id,
          hasOpportunities: opportunities.cards.length > 0,
          duration: Date.now() - startTime
        });

        return this._createEnhancedResponse('opportunities', opportunities, {
          flow_token,
          version,
          startTime
        });
      }

      // Caso não tenha oportunidades, segue para próxima tela
      Logger.info('Signup processado sem oportunidades', {
        leadId: lead.id,
        duration: Date.now() - startTime
      });

      return this._createEnhancedResponse('information', {
        leadId: lead.id
      }, {
        flow_token,
        version,
        startTime
      });

    } catch (error) {
      Logger.error('Erro no processamento de signup', {
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });

      // Determina campo de erro baseado na mensagem
      let errorField = 'nomeErro';
      if (error.message.toLowerCase().includes('cpf')) {
        errorField = 'cpfErro';
      }

      return this.createResponse('signup', {
        [errorField]: `⚠️ ${error.message}`
      }, {
        flow_token,
        version,
        error: true
      });
    }
  }

  /**
   * Processa a tela de informações (information).
   *
   * @param {Object} data - Dados enviados pelo cliente.
   * @param {string} flow_token - Token identificador do fluxo.
   * @param {string} version - Versão do fluxo.
   * @returns {Promise<Object>} Resposta com a próxima tela e dados adicionais.
   */
  async handleInformationScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      Logger.info('Dados recebidos em Information Screen', {
        hasNomeMae: !!data.nomeMae,
        hasCep: !!data.cep,
        leadId: data.leadId,
        timestamp: new Date().toISOString()
      });

      // Validar nome da mãe
      if (data.nomeMae) {
        this.validadores.nomeMae(data.nomeMae);
      } else {
        throw new ScreenValidationError('Nome da mãe não informado', 'information');
      }

      // Busca CEP com timeout utilizando o método _withTimeout
      const cepData = await this._withTimeout(
        this.addressService.fetchCEPData(data.cep),
        30000
      );

      if (cepData.error) {
        return this.createResponse('information', {
          cepErro: cepData.error
        }, { flow_token, version });
      }

      // Registra documento usando estado do CEP
      const documentResponse = await registerDocument({
        leadId: data.leadId,
        tipo: data.tipo || "RG",
        numero: data.numero,
        nomeMae: data.nomeMae,
        ufAgencia: cepData.state,
        agencia: data.agencia || "SSP"
      });

      return this.createResponse('address', { ...cepData, leadId: data.leadId }, {
        flow_token,
        version
      });

    } catch (error) {
      Logger.error('Erro no processamento de information', {
        error: error.message,
        flow_token,
        duration: Date.now() - startTime,
        stack: error.stack
      });

      // Determina campo de erro baseado na mensagem
      let errorField = 'cepErro';
      if (error.message.toLowerCase().includes('nome da mãe')) {
        errorField = 'nomeMaeErro';
      }

      return this.createResponse('information', {
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

      // Normalizar dados do endereço
      const addressData = {
        leadId: data.leadId,
        cep: data.cep.replace(/\D/g, ''),
        logradouro: data.endereco || data.logradouro, // Aceita ambos os campos
        numero: data.numero,
        complemento: data.complemento || '',
        bairro: data.bairro || '',
        cidade: data.cidade || data.city, // Aceita ambos os campos
        estado: data.uf || data.estado // Aceita ambos os campos
      };

      // Validar campos obrigatórios
      this.validateRequired(addressData, [
        'leadId',
        'cep',
        'logradouro',
        'numero',
        'bairro',
        'cidade',
        'estado'
      ]);

      try {
        // Registrar endereço
        await registerAddress(addressData);

        Logger.info('Endereço processado com sucesso', {
          flow_token,
          duration: Date.now() - startTime
        });

        // Retorna para próxima tela com leadId
        return this.createResponse('account', { leadId: data.leadId }, {
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

        return this.createResponse('address', {
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

      return this.createResponse('address', {
        error: `⚠️ ${error.message}`
      }, {
        flow_token,
        version
      });
    }
  }

  /**
   * Processa a tela de conta (account).
   *
   * @param {Object} data - Dados bancários e demais informações.
   * @param {string} flow_token - Token identificador do fluxo.
   * @param {string} version - Versão do fluxo.
   * @returns {Promise<Object>} Resposta com a próxima tela e dados adicionais.
   */
  async handleAccountScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      Logger.info('Iniciando processamento de conta', {
        leadId: data.leadId,
        agencia: data.agencia,
        codigoBanco: data.codigoBanco,
        tipoConta: data.tipoConta
      });

      // Validar dados bancários obrigatórios
      this.validateRequired(data, [
        'agencia',
        'conta',
        'tipoConta',
        'codigoBanco'
      ]);

      // Validar se tem pelo menos CPF ou leadId
      if (!data.cpf && !data.leadId) {
        throw new Error('CPF ou leadId não informado');
      }

      // Registrar conta e avançar estágio em paralelo utilizando _withTimeout com timeout de 10000ms
      const [conta, lead] = await Promise.all([
        this._withTimeout(registerAccount(data), 10000),
        this._withTimeout(nextStage(data.cpf || data.leadId), 10000)
      ]);

      Logger.info('Conta processada com sucesso', {
        leadId: data.leadId,
        duration: Date.now() - startTime
      });

      return this.createResponse('warning', { leadId: lead.id }, {
        flow_token,
        version
      });

    } catch (error) {
      Logger.error('Erro no processamento de conta', {
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });

      return this.createResponse('account', {
        contaErro: `⚠️ ${error.message}`
      }, {
        flow_token,
        version,
        error: true
      });
    }
  }

  /**
   * Processa a tela de oportunidades.
   *
   * @param {Object} data - Dados enviados pelo cliente.
   * @param {string} flow_token - Token identificador do fluxo.
   * @param {string} version - Versão do fluxo.
   * @returns {Promise<Object>} Resposta com a próxima tela (baseada na etapa do lead) e dados adicionais.
   */
  async handleOpportunitiesScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      Logger.info('Processando tela de oportunidades', {
        leadId: data.leadId,
        timestamp: new Date().toISOString()
      });
      
      // Validação do lead e CPF
      const lead = await nextStage(data.cpf, data.creditGroup);
      
      // Busca próximo estágio e determina próxima tela
      const nextScreen = this._determineNextScreen(lead, data.creditGroup, flow_token);
      
      Logger.info('Tela de oportunidades processada com sucesso', {
        leadId: lead.id,
        nextScreen,
        duration: Date.now() - startTime
      });
      
      return this.createResponse(nextScreen, { leadId: lead.id }, {
        flow_token,
        version,
        startTime
      });
    } catch (error) {
      Logger.error('Erro no processamento de oportunidades', {
        error: error.message,
        stack: error.stack,
        flow_token,
        duration: Date.now() - startTime
      });
      // Retorna resposta de erro para a tela de oportunidades
      return this.createResponse('opportunities', {
        error: `⚠️ ${error.message}`
      }, { flow_token, version });
    }
  }
}

module.exports = BaseController;