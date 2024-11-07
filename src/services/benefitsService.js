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
    if (!codigo || codigo.length !== 11 || !codigo.startsWith('1') && !codigo.startsWith('2')) {
      return false;
    }
    return this.validarNIS(codigo);
  }

  validarNIS(nis) {
    nis = nis.replace(/[^\d]/g, '');

    if (nis.length !== 11) {
      return false;
    }

    const multiplicadores = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    
    for (let i = 0; i < 10; i++) {
      soma += parseInt(nis.charAt(i)) * multiplicadores[i];
    }

    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;

    return dv === parseInt(nis.charAt(10));
  }

  async consultarCPF(cpf) {
    try {
      const anos = ['201906', '202006', '202106', '202206', '202306'];
      
      for (const anoRef of anos) {
        Logger.info(`Consultando CPF ${cpf} para o período ${anoRef}`);
        
        const { data, error } = await this.apiClient.get(
          `/bolsa-familia-disponivel-por-cpf-ou-nis?anoMesCompetencia=${anoRef}&pagina=1&codigo=${cpf}`
        );
        
        if (!error && Array.isArray(data) && data.length > 0) {
          Logger.info(`Dados encontrados para CPF no período ${anoRef}`);
          return data;
        }
      }
      
      Logger.info('Nenhum dado encontrado para o CPF após todas as tentativas');
      return [];
    } catch (error) {
      Logger.error('Erro ao consultar CPF', error);
      return [];
    }
  }

  async consultarNIS(nis) {
    try {
      const dates = DateHelper.getLastSixMonths();
      
      for (const anoMesRef of dates) {
        Logger.info(`Consultando NIS ${nis} para o período ${anoMesRef}`);
        
        const { data, error } = await this.apiClient.get(
          `/novo-bolsa-familia-sacado-por-nis?anoMesReferencia=${anoMesRef}&pagina=1&nis=${nis}`
        );
        
        if (!error && Array.isArray(data) && data.length > 0) {
          Logger.info(`Dados encontrados para NIS no período ${anoMesRef}`);
          return data;
        }
      }
      
      Logger.info('Nenhum dado encontrado para o NIS após todas as tentativas');
      return [];
    } catch (error) {
      Logger.error('Erro ao consultar NIS', error);
      return [];
    }
  }

  async fetchBolsaFamilia(codigo) {
    try {
      const codigoLimpo = codigo.replace(/[^\d]/g, '');
      const isNISCode = this.isNIS(codigoLimpo);
      
      Logger.info(`Verificando código ${codigoLimpo}:`, 
        isNISCode ? 'Identificado como NIS válido' : 'Identificado como CPF');

      const result = isNISCode 
        ? await this.consultarNIS(codigoLimpo)
        : await this.consultarCPF(codigoLimpo);

      return Array.isArray(result) ? result : [];
    } catch (error) {
      Logger.error('Erro ao buscar dados de Bolsa Família', error);
      return [];
    }
  }
}