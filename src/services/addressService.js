// services/addressService.js

import { ApiClient } from './apiClient.js';
import { API_CONFIG } from '../config/constants.js';
import { Logger } from '../utils/logger.js';


export class AddressService {
  constructor() {
    this.apiClient = new ApiClient(API_CONFIG.BRASIL_API);
  }

  async fetchCEPData(cep) {
    Logger.info(`Buscando dados do CEP:`, cep);
    const { data, error } = await this.apiClient.get(`/cep/v1/${cep}`);
    
    if (error) {
      return { error: "⚠️ CEP não localizado" };
    }
    
    return data;
  }
}