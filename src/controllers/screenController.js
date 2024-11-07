// controllers/screenController.js

import { AddressService } from '../services/addressService.js';
import { BenefitsService } from '../services/benefitsService.js';


export class ScreenController {
  constructor() {
    this.addressService = new AddressService();
    this.benefitsService = new BenefitsService();
  }

  createResponse(screen, data, { flow_token, version, error = false, errorMessage = null }) {
    return {
      screen,
      data: {
        ...data,
        flow_token,
        version,
        error,
        errorMessage
      }
    };
  }

  async handleSignupScreen(data, flow_token, version) {
    if (!data?.cpf) return null;
    
    const bolsaFamiliaData = await this.benefitsService.fetchBolsaFamilia(data.cpf);
    return this.createResponse('information', bolsaFamiliaData, {
      flow_token,
      version,
      error: bolsaFamiliaData.length === 0,
      errorMessage: bolsaFamiliaData.length === 0 ? "CPF não encontrado" : null
    });
  }

  async handleAccountScreen(data, flow_token, version) {
    if (!data?.nis) return null;
    
    const bolsaFamiliaData = await this.benefitsService.fetchBolsaFamilia(data.nis);
    return this.createResponse('account', bolsaFamiliaData, {
      flow_token,
      version,
      error: bolsaFamiliaData.length === 0,
      errorMessage: bolsaFamiliaData.length === 0 ? "NIS não encontrado" : null
    });
  }

  async handleInformationScreen(data, flow_token, version) {
    if (!data?.cep) return null;
    
    const cepData = await this.addressService.fetchCEPData(data.cep);
    if (cepData.error) {
      return this.createResponse('information', {}, {
        flow_token,
        version,
        error: true,
        errorMessage: cepData.error
      });
    }
    
    return this.createResponse('address', cepData, { flow_token, version });
  }
}