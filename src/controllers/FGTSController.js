// controllers/FGTSController.js
const BaseController = require('./baseController');
const { Logger } = require('../utils/logger');
const { AddressService } = require('../services/addressService');
const { nextStage, registerAccount, registerDocument, updateBasicLeadData, includeContract } = require('../services/apiClient');
const { transformData } = require('../utils/formatCards');

class FGTSController extends BaseController {
  constructor() {
    super();
    this.addressService = new AddressService();
    this.validadores = {
      nomeMae: this.#validateName.bind(this)
    };
  }

  // Mantém o validador privado específico do FGTS
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

  // Sobrescreve apenas o getHandler específico do FGTS
  async getHandler(screen) {
    const handlers = {
      'credit_group': this.handleFrontScreen.bind(this),
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
  
  async handleInformationScreen(data, flow_token, version) {
    return super.handleInformationScreen(data, flow_token, version);
  }

  async handleAddressScreen(data, flow_token, version) {
    return super.handleAddressScreen(data, flow_token, version);
  }

  async handleAccountScreen(data, flow_token, version) {
    return super.handleAccountScreen(data, flow_token, version);
  }
}

module.exports = FGTSController;