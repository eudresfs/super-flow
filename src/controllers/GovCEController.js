// controllers/GovCEController.js
const BaseController = require('./baseController');
const { Logger } = require('../utils/logger');
const { AddressService } = require('../services/addressService');
const { 
  nextStage, 
  createContact, 
  registerDocument, 
  registerAddress, 
  registerAccount,
  leadData,
  validaCPF,
  uploadFiles,
  requalify,
  tagAssign
} = require('../services/apiClient');

class GovCEController extends BaseController {
  constructor() {
    super();
    this.addressService = new AddressService();
    this.validadores = {
      nome: this.#validateName.bind(this),
      nomeMae: this.#validateName.bind(this)
    };

    // Configuração específica de telas do GovCE
    this.SCREEN_CONFIG = {
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
  }

  // Mantém validador específico do GovCE
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

  async getHandler(screen) {
    const handlers = {
      'credit_group': this.handleFrontScreen.bind(this),
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

  async handleFrontScreen(data, flow_token, version) {
    return super.handleFrontScreen(data, flow_token, version);
  }


  /* async handleFrontScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      const [leadInfo, nextStep, cpfValidation] = await Promise.all([
        leadData(data.cpf),
        nextStage(data.cpf, data.creditGroup),
        validaCPF(data.cpf)
      ]);

      if (!cpfValidation) {
        throw new ScreenValidationError('CPF inválido! Verifique o documento e tente novamente.', 'front');
      }

      // Formatação de data específica do GovCE
      if (leadInfo?.[0]?.customer?.birthDate) {
        const [year, month, day] = leadInfo[0].customer.birthDate.split("-");
        leadInfo[0].customer.birthDate = `${day}/${month}/${year}`;
      }

      if (nextStep?.etapaFunil?.toLowerCase() === 'inexistente') {
        await createContact(data);
        return this._createEnhancedResponse(
          'signup',
          { ...leadInfo?.[0]?.customer },
          { flow_token, version, startTime }
        );
      }

      // Lógica específica de oportunidades do GovCE
      if (this.#hasValidOpportunities(nextStep)) {
        const title = nextStep.oportunidades[0].valor;
        return this._createEnhancedResponse('opportunities', { 
          title, 
          pageTitle: 'Simulação' 
        }, {
          flow_token, version, startTime
        });
      }

      // Define próxima tela usando configuração do GovCE
      if (Array.isArray(nextStep?.pedirInfos)) {
        const nextScreen = this.SCREEN_CONFIG.priority.find(priorityItem =>
          nextStep.pedirInfos.includes(priorityItem)
        );

        return this._createEnhancedResponse(
          this.SCREEN_CONFIG.screens[nextScreen] || 'complete',
          { 
            leadId: nextStep.id, 
            ...leadInfo?.[0]?.customer, 
            suporte: true 
          },
          { flow_token, version, startTime }
        );
      }

    } catch (error) {
      return this.handleError(error, 'front', flow_token, version);
    }
  } */

  // Helper para verificar oportunidades válidas
  #hasValidOpportunities(nextStep) {
    return (
      nextStep?.situacao === 'escolher-simulacao' && 
      Array.isArray(nextStep?.pedirInfos) &&
      nextStep.pedirInfos.includes('documento') && 
      Array.isArray(nextStep?.oportunidades) &&
      nextStep.oportunidades.length > 0
    );
  }

  async handleSignupScreen(data, flow_token, version) {
    const startTime = Date.now();

    try {
      this.validadores.nome(data.nome);

      const lead = await createContact(data, flow_token);
      if (!lead?.id) {
        throw new Error('Erro ao criar contato');
      }

      // Processos específicos do GovCE
      await Promise.all([
        tagAssign(lead.id, "ce1b1427-bd86-4ed5-bb04-7b462a6e2ada"),
        nextStage(lead.id)
      ]);

      return this._createEnhancedResponse(
        'PROPOSTA',
        { title: 0, leadId: lead.id },
        { flow_token, version, startTime }
      );

    } catch (error) {
      return this.handleError(error, 'DADOS_PESSOAIS', flow_token, version);
    }
  }

  // Usa implementação base com algumas customizações
  async handleInformationScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      if (!data.nomeMae) {
        throw new ScreenValidationError('Nome da mãe não informado', 'INFORMACOES');
      }

      this.validadores.nomeMae(data.nomeMae);

      const cepData = await this.withTimeout(
        this.addressService.fetchCEPData(data.cep)
      );

      if (cepData.error) {
        return this.createResponse('INFORMACOES', {
          cepErro: cepData.error
        }, { flow_token, version });
      }

      // Registro de documento específico do GovCE
      await registerDocument({
        cpf: data.cpf,
        tipo: data.tipo || "RG",
        numero: data.numero,
        nomeMae: data.nomeMae,
        ufAgencia: cepData.state,
        agencia: data.agencia || "SSP"
      });

      return this.createResponse('ENDERECO', cepData, { flow_token, version });

    } catch (error) {
      return this.handleError(error, 'INFORMACOES', flow_token, version);
    }
  }

  async handleDocumentScreen(data, flow_token, version) {
    const startTime = Date.now();

    try {
      // Validações específicas do GovCE
      if (!data?.foto_documento?.length || data.foto_documento.length < 2) {
        throw new Error('São necessárias duas fotos do documento (frente e verso)');
      }

      if (!data?.leadId) {
        throw new Error('ID do lead é obrigatório');
      }

      // Upload e tag assignment específicos do GovCE
      const [documento] = await Promise.all([
        uploadFiles(data),
        tagAssign(data.leadId, "314faa2a-535e-44f9-8d5f-b33bf0337030")
      ]);

      return this._createEnhancedResponse('COMPLETE', { documento }, {
        flow_token,
        version
      });

    } catch (error) {
      return this.handleError(error, 'FOTO_DOCUMENTO', flow_token, version, {
        errorKey: 'documentoError'
      });
    }
  }

  async handlePaycheckScreen(data, flow_token, version) {
    const startTime = Date.now();
    
    // Configura timeout global
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        Logger.warn('Timeout global atingido, seguindo para próxima tela', {
          duration: Date.now() - startTime
        });
        resolve(this._createEnhancedResponse("PROPOSTA", {
          title: 0,
          timeoutMessage: 'Processamento em andamento'
        }, {
          flow_token,
          version
        }));
      }, 15000);
    });

    const processamentoPromise = async () => {
      if (!data?.contracheque?.length) {
        throw new Error('Dados do contracheque não fornecidos');
      }

      const paycheck = await this.#processPaycheck(data.contracheque, data.leadId);
      await this.#checkOportunidades(data.leadId, paycheck[0].link);

      return this._createEnhancedResponse("FOTO_DOCUMENTO", {
        documento: paycheck[0]
      }, {
        flow_token,
        version
      });
    };

    try {
      return await Promise.race([processamentoPromise(), timeoutPromise]);
    } catch (error) {
      return this.handleError(error, 'CONTRACHEQUE', flow_token, version, {
        errorKey: 'contrachequeError'
      });
    }
  }

  // Helpers para processamento de contracheque
  async #processPaycheck(fileData, leadId) {
    Logger.info('Iniciando upload do contracheque', { leadId });
    return await uploadFiles({
      contracheque: fileData,
      leadId
    }, false);
  }

  async #checkOportunidades(leadId, documentoLink, config = {}) {
    const defaultConfig = {
      maxRetries: 5,
      baseDelay: 500,
      maxTimeout: 10000,
      maxDelay: 1000,
      nextStageTimeout: 3000,
      ...config
    };

    if (!leadId || !documentoLink) {
      throw new Error('LeadId e documentoLink são obrigatórios');
    }

    await this.#requalifyLead(leadId, documentoLink);
    return await this.#pollOportunidades(leadId, defaultConfig);
  }

  async #requalifyLead(leadId, documentoLink) {
    try {
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
  }

  async #pollOportunidades(leadId, config) {
    const startTime = Date.now();
    let lastError = null;
    let lastLeadData = null;

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      try {
        const leadData = await this.withTimeout(
          nextStage(leadId),
          config.nextStageTimeout
        );

        lastLeadData = leadData;

        if (leadData?.oportunidades?.length > 0) {
          return leadData.oportunidades;
        }

        if (Date.now() - startTime > config.maxTimeout) break;

        if (attempt < config.maxRetries - 1) {
          await this.#delay(attempt, config);
        }
      } catch (error) {
        lastError = error;
        if (Date.now() - startTime > config.maxTimeout) break;
      }
    }

    if (lastError) {
      throw new Error(`Falha ao buscar oportunidades após ${config.maxRetries} tentativas: ${lastError.message}`);
    }

    return lastLeadData?.oportunidades || [];
  }

  #delay(attempt, config) {
    const exponentialDelay = Math.min(
      config.maxDelay,
      config.baseDelay * Math.pow(2, attempt)
    );
    const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1);
    const delay = Math.floor(exponentialDelay + jitter);

    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async handleProposalScreen(data, flow_token, version) {
    const startTime = Date.now();
    
    try {
      // Validação inicial
      if (!data?.marginRCC) {
        throw new Error('Salário não informado');
      }

      const simulationResult = this.#calculateSimulation({
        marginRCC: data.marginRCC,
        coefficient: data.coefficient
      });

      Logger.info('Simulação calculada', {
        margin: data.marginRCC,
        netAmount: simulationResult.netAmount
      });

      return this._createEnhancedResponse(
        'PROPOSTA',
        { 
          title: simulationResult.netAmount, 
          pageTitle: "Veja sua simulação!" 
        },
        { flow_token, version, startTime }
      );

    } catch (error) {
      return this.handleError(error, 'PROPOSTA', flow_token, version, {
        customData: { pageTitle: "Simulação" },
        errorKey: 'marginRccError'
      });
    }
  }

  // Helpers para cálculos de proposta
  #calculateSimulation({ marginRCC, coefficient = 0.059188 }) {
    const marginValue = this.#parseAmount(marginRCC);

    // Validação dos limites do salário
    if (marginValue < 10 || marginValue > 4999) {
      throw new Error('O valor do salário deve estar entre R$ 10,00 e R$ 4.999,00');
    }

    const margem = this.#formatAmount(marginValue * 0.9);
    const netAmount = this.#formatAmount(margem / Math.max(coefficient, 0));

    return {
      margem,
      netAmount
    };
  }

  #parseAmount(value) {
    if (typeof value === 'number') return value;

    const normalized = this.#normalizeCents(String(value));
    if (!normalized) {
      throw new Error('Valor inválido para salário');
    }

    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    const isCommaSeparated = lastComma > lastDot;

    return isCommaSeparated
      ? Number(normalized.replace(/R?\$?\s*/g, '').replace(/\./g, '').replace(',', '.'))
      : Number(normalized.replace(/R?\$?\s*/g, '').replace(/,/g, ''));
  }

  #formatAmount(value) {
    return Number(value.toFixed(2));
  }

  #normalizeCents(value) {
    const hasValidFormat = /^[1-9]\d{0,2}([,\.]\d{3})*[,\.]?\d{2}$/.test(value);
    return hasValidFormat ? (value.includes(',') ? value : `${value},00`) : null;
  }

  // Implementa handlers comuns usando a base
  async handleAddressScreen(data, flow_token, version) {
    return super.handleAddressScreen(data, flow_token, version);
  }

  async handleAccountScreen(data, flow_token, version) {
    // Customiza tela de retorno para GovCE
    const result = await super.handleAccountScreen(data, flow_token, version);
    if (!result.data.error) {
      result.screen = 'WARNING';
    }
    return result;
  }
}

module.exports = GovCEController;