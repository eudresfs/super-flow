const BaseController = require('./baseController');
const { Logger } = require('../utils/logger');

class CommonController extends BaseController {
  constructor() {
    super();
  }
  
  async getHandler(screen) {
    const handlers = {
      'front': this.handleFrontScreen.bind(this),
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

  async handleSignupScreen(data, flow_token, version) {
    return super.handleSignupScreen(data, flow_token, version);
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

module.exports = CommonController;