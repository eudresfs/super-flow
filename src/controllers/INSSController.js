// controllers/INSSController.js
const BaseController = require('./baseController');
const { Logger } = require('../utils/logger');
const { 
  nextStage, 
  createContact,
  leadData,
  validaCPF
} = require('../services/apiClient');
const { transformData, extractOpportunities } = require('../utils/formatCards');

class INSSController extends BaseController {
  constructor() {
    super();
    this.validadores = {
      nome: this.#validateName.bind(this),
      cpf: this.#validateCPF.bind(this),
      conta: this.#validateAccount.bind(this)
    };

    // Configuração específica de telas do INSS
    this.SCREEN_CONFIG = {
      screens: {
        'data-nascimento': 'signup',
        documento: 'signup',
        endereco: 'address',
        conta: 'account'
      },
      priority: ['data-nascimento', 'documento', 'endereco', 'conta']
    };
  }

  // Mantém validadores específicos do INSS
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

  #validateCPF(cpf) {
    if (!cpf) {
      throw new ScreenValidationError('CPF não informado', 'front');
    }
    
    const cleaned = cpf.replace(/\D/g, '');
    
    if (cleaned.length !== 11) {
      throw new ScreenValidationError('CPF deve conter 11 dígitos', 'front');
    }
    
    return true;
  }

  #validateAccount(data) {
    const requiredFields = ['agencia', 'conta', 'tipoConta', 'codigoBanco'];
    const missingFields = requiredFields.filter(field => !data[field]);
    
    if (missingFields.length) {
      throw new ScreenValidationError(
        `Campos obrigatórios faltando: ${missingFields.join(', ')}`,
        'account'
      );
    }
    
    if (!data.cpf && !data.leadId) {
      throw new ScreenValidationError('CPF ou leadId não informado', 'account');
    }
    
    return true;
  }

  async getHandler(screen) {
    const handlers = {
      'credit_group': this.handleFrontScreen.bind(this),
      'signup': this.handleSignupScreen.bind(this),
      'infos': this.handleInformationScreen.bind(this),
      'address': this.handleAddressScreen.bind(this),
      'confirm_account': this.handleAccountScreen.bind(this)
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

      // Formatação de data específica do INSS
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

      // Lógica específica para oportunidades do INSS
      if (this.#hasValidOpportunities(nextStep)) {
        const oportunidades = nextStep.oportunidades;
        const cards = await transformData(oportunidades);
        const totalValor = oportunidades.reduce((acc, item) => acc + item.valor, 0).toFixed(2);
        
        return this._createEnhancedResponse('opportunities', { 
          cards,
          totalValor 
        }, { 
          flow_token, 
          version, 
          startTime 
        });
      }

      // Define próxima tela usando configuração do INSS
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

  // Helper method para verificar oportunidades válidas
  #hasValidOpportunities(nextStep) {
    return (
      nextStep?.situacao === 'escolher-simulacao' && 
      Array.isArray(nextStep?.pedirInfos) &&
      nextStep.pedirInfos.includes('documento') && 
      Array.isArray(nextStep?.oportunidades) &&
      nextStep.oportunidades.length > 0
    );
  }

  // Usa a implementação base do handleSignupScreen com processamento específico de oportunidades
  async handleSignupScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      this.validadores.nome(data.nome);

      const { id: leadId } = await createContact(data);
      const nextStageResponse = await nextStage(leadId);
      
      const opportunities = await this._processOpportunities(nextStageResponse);

      return this._createEnhancedResponse('opportunities', opportunities, { 
        flow_token, 
        version,
        startTime 
      });

    } catch (error) {
      return this.handleError(error, 'signup', flow_token, version);
    }
  }

  // Usa implementação base dos outros handles
  async handleInformationScreen(data, flow_token, version) {
    return super.handleInformationScreen(data, flow_token, version);
  }

  async handleAddressScreen(data, flow_token, version) {
    return super.handleAddressScreen(data, flow_token, version);
  }

  async handleAccountScreen(data, flow_token, version) {
    return super.handleAccountScreen(data, flow_token, version);
  }

  // Processamento específico de oportunidades do INSS
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
}

module.exports = INSSController;