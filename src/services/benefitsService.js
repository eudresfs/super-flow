// services/benefitsService.js

import { ApiClient } from './apiClient.js';
import { API_CONFIG } from '../config/constants.js';
import { Logger } from '../utils/logger.js';
import { DateHelper } from '../utils/dateHelper.js';


export class BenefitsService {
  constructor() {
    this.apiClient = new ApiClient(API_CONFIG.TRANSPARENCIA_API, {
      'chave-api-dados': API_CONFIG.API_KEY
    });
  }

  isNIS(codigo) {
    return codigo.length === 11 && (codigo.startsWith('1') || codigo.startsWith('2'));
  }

  async fetchBolsaFamilia(codigo) {
    const codigoLimpo = codigo.replace(/[^\d]/g, '');
    const isNISCode = this.isNIS(codigoLimpo);
    
    const dates = isNISCode ? DateHelper.getLastSixMonths() : API_CONFIG.CPF_DATES;
    const endpoint = isNISCode ? 'novo-bolsa-familia-sacado-por-nis' : 'bolsa-familia-disponivel-por-cpf-ou-nis';
    
    for (const date of dates) {
      const params = isNISCode 
        ? `anoMesReferencia=${date}&pagina=1&nis=${codigoLimpo}`
        : `anoMesCompetencia=${date}&pagina=1&codigo=${codigoLimpo}`;

      const { data, error } = await this.apiClient.get(`/${endpoint}?${params}`);
      
      if (!error && data?.length > 0) {
        Logger.info(`Dados encontrados para a data ${date}`);
        return data;
      }
    }
    
    return [];
  }
}