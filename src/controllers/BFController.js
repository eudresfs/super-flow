// controllers/BFController.js
const BaseController = require('./baseController');
const { Logger } = require('../utils/logger');
const { BenefitsService } = require('../services/benefitsService');
const { TelemetryService } = require('../services/telemetryService');
const telemetry = TelemetryService.getInstance(process.env.INSTRUMENTATION_KEY);
const { 
  nextStage, 
  createContact, 
  getLeadData,
  registerDocument,
  uploadFiles,
  validaCPF,
  getStatusMessage
} = require('../services/apiClient');

class BFController extends BaseController {
  constructor() {
    super();
    this.benefitsService = new BenefitsService();
    this.validadores = {
      nome: this.#validateName.bind(this)
    };

    // Configuração específica de telas do BF
    this.SCREEN_CONFIG = {
      screens: {
        'data-nascimento': 'signup',
        documento: 'information',
        endereco: 'address',
        conta: 'account'
      },
      priority: ['data-nascimento', 'documento', 'endereco', 'conta'],
      imageTypes: ['imagem-rg-frente', 'imagem-rg-tras'],
      outsideDocs: ['imagem-conta', 'extrato-conta']
    };
  }

  // Mantém validadores específicos do BF
  #validateName(nome) {
    const nomeValido = nome.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
    if (nomeValido !== nome.trim()) {
      throw new ScreenValidationError('O nome não deve conter números ou caracteres especiais', 'signup');
    }
    if (nomeValido.split(/\s+/).length < 2) {
      throw new ScreenValidationError('Por favor, informe o nome completo', 'signup');
    }
    return nomeValido;
  }

  async getHandler(screen) {
    const handlers = {
      'front': this.handleFrontScreen.bind(this),
      'signup': this.handleSignupScreen.bind(this),
      'information': this.handleInformationScreen.bind(this),
      'address': this.handleAddressScreen.bind(this),
      'account': this.handleAccountScreen.bind(this),
      'warning': this.handleWarningScreen.bind(this),
      'documento_rg': this.handleDocumentScreen.bind(this)
    };

    return super.getHandler(screen, handlers);
  }

   // Helper específico para determinar próxima tela
   #getNextScreen(pendingInfo) {
    const isOutsideDocument = (item) => this.SCREEN_CONFIG.outsideDocs.includes(item);
    const outsideDocsMatch = (
      pendingInfo.length <= 2 &&
      pendingInfo.every(isOutsideDocument)
    );

    if (outsideDocsMatch) {
      return 'complete';
    }

    const nextPriorityScreen = this.SCREEN_CONFIG.priority.find(
      screen => pendingInfo.includes(screen)
    );

    if (nextPriorityScreen) {
      return this.SCREEN_CONFIG.screens[nextPriorityScreen];
    }

    const hasImagePending = pendingInfo.some(
      info => this.SCREEN_CONFIG.imageTypes.includes(info)
    );

    return hasImagePending ? 'warning' : 'information';
  }

  async handleFrontScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      const [leadData, cpfValidation] = await Promise.all([
        nextStage(data.cpf, data.creditGroup),
        validaCPF(data.cpf)
      ]);

      if (!cpfValidation) {
        throw new ScreenValidationError('CPF inválido! Verifique o documento e tente novamente.', 'signup');
      }

      // Fluxo para lead inexistente
      if (leadData.etapaFunil?.toLowerCase() === 'inexistente') {
        return super._handleNewLead(data, leadData, flow_token, version, startTime);
      }

      // Fluxo para lead com oportunidades ou sem informações pendentes
      if (leadData.oportunidades.length > 0 || (Array.isArray(leadData?.pedirInfos) && leadData?.pedirInfos?.length === 0)) {
        const etapa = leadData.oportunidades?.[0]?.etapa || leadData.etapaFunil || 'Em Andamento';
        const statusResponse = await getStatusMessage(etapa);
        
        return this._createEnhancedResponse('status', {
          ...leadData,
          ...statusResponse
        }, {
          flow_token,
          version,
          startTime
        });
      }

      // Fluxo para definição da próxima tela
      if (Array.isArray(leadData?.pedirInfos)) {
        const nextScreen = this.#getNextScreen(leadData.pedirInfos);
        return this._createEnhancedResponse(nextScreen, {
          leadId: leadData.id
        }, {
          flow_token,
          version,
          startTime
        });
      }

    } catch (error) {
      return this.handleError(error, 'front', flow_token, version);
    }
  }

  async _handleNewLead(data, leadData, flow_token, version, startTime) {
    try {
      Logger.info('Processando novo lead', {
        leadId: leadData.id,
        timestamp: new Date().toISOString()
      });

      // Busca informações em paralelo
      const [leadInfo, bolsaFamiliaData] = await Promise.all([
        getLeadData(data.cpf),
        this.benefitsService.consultarCPF(data.cpf)
      ]);

      const lead = this.#buildLeadData(leadData, leadInfo, bolsaFamiliaData);

      return this._createEnhancedResponse('signup', { ...lead }, { 
        flow_token, 
        version,
        startTime 
      });

    } catch (error) {
      return this.handleError(error, 'front', flow_token, version);
    }
  }

  // Helper para construir dados do lead
  #buildLeadData(leadData, leadInfo = [], bolsaFamiliaData = []) {
    const customer = leadInfo[0]?.customer;
    const titularData = bolsaFamiliaData[0]?.titularBolsaFamilia || {};

    if (customer?.birthDate) {
      customer.birthDate = this.#formatBrazilianDate(customer.birthDate);
    }

    return {
      leadId: leadData.id,
      nome: titularData.nome || customer?.name || '',
      nis: titularData.nis || customer?.enrollment || '',
      birthDate: customer?.birthDate || '',
    };
  }

  #formatBrazilianDate(isoDate) {
    if (!isoDate) return '';
    try {
      const [year, month, day] = isoDate.split('-');
      return `${day}/${month}/${year}`;
    } catch (error) {
      Logger.error('Erro ao formatar data:', error);
      return '';
    }
  }

  async handleSignupScreen(data, flow_token, version) {
    try {
      this.validadores.nome(data.nome);

      // Executa processos em paralelo específicos do BF
      const [leadData, bolsaFamiliaData] = await Promise.all([
        createContact(data, flow_token).then(async (lead) => {
          if (!lead?.id) throw new Error('Erro ao criar contato');
          return lead;
        }),
        this.benefitsService.consultarNIS(data.nis)
      ]);

      const valorSaque = bolsaFamiliaData[0]?.valorSaque;

      return this._createEnhancedResponse('information', {
        leadId: leadData.id,
        valorSaque
      }, { flow_token, version });

    } catch (error) {
      const errorField = error.message.toLowerCase().includes('nis') ? 'nisErro' : 'nomeErro';
      return this.handleError(error, 'signup', flow_token, version, errorField);
    }
  }

  // Usa implementação base com algumas customizações
  async handleInformationScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      Logger.info('Dados recebidos em Information Screen', {
        hasState: !!data.state,
        stateValue: data.state,
        hasNomeMae: !!data.nomeMae,
        timestamp: new Date().toISOString()
      });

      if (!data.nomeMae) {
        throw new ScreenValidationError('Nome da mãe não informado', 'information');
      }

      const cepData = await this.withTimeout(
        this.addressService.fetchCEPData(data.cep)
      );

      if (cepData.error) {
        return this.createResponse('information', {
          cepErro: cepData.error
        }, { flow_token, version });
      }

      // Registro de documento específico do BF
      await registerDocument({
        leadId: data.leadId,
        tipo: data.tipo || "RG",
        numero: data.numero,
        nomeMae: data.nomeMae,
        ufAgencia: cepData.state,
        agencia: data.agencia || "SSP"
      });

      return this._createEnhancedResponse('address', { 
        ...cepData, 
        leadId: data.leadId 
      }, { 
        flow_token, 
        version,
        startTime 
      });

    } catch (error) {
      let errorField = 'cepErro';
      if (error.message.toLowerCase().includes('nome da mãe')) {
        errorField = 'nomeMaeErro';
      }
      return this.handleError(error, 'information', flow_token, version, errorField);
    }
  }

  // Handlers específicos do BF
  async handleWarningScreen(data, flow_token, version) {
    return this._createEnhancedResponse('documento_rg', {
      leadId: data.leadId || null,
    }, { 
      flow_token, 
      version 
    });
  }

  async handleDocumentScreen(data, flow_token, version) {
    try {
      Logger.info('Iniciando processamento de documentos', {
        hasRg: !!data.rg,
        leadId: data.leadId,
        flow_token
      });

      if (!data.leadId) {
        throw new Error('ID do lead não informado');
      }

      const uploadedFiles = await uploadFiles(data);

      return this._createEnhancedResponse('complete', uploadedFiles, { 
        flow_token, 
        version 
      });

    } catch (error) {
      const errorKey = data.rg ? 'rgErro' : 'comprovanteErro';
      return this.handleError(error, 'documento_rg', flow_token, version, errorKey);
    }
  }

  // Usa implementação base para handlers comuns
  async handleAddressScreen(data, flow_token, version) {
    return super.handleAddressScreen(data, flow_token, version);
  }

  async handleAccountScreen(data, flow_token, version) {
    return super.handleAccountScreen(data, flow_token, version);
  }
}

module.exports = BFController;