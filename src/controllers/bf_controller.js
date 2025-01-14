// src/controllers/bf_controller.js
const { AddressService } = require('../services/addressService');
const { BenefitsService } = require('../services/benefitsService');
const { getStatusMessage } = require('./statusMessages');
const { Logger } = require('../utils/logger');
const {
  validaCPF,
  createContact,
  registerAccount,
  uploadFiles,
  registerDocument,
  registerAddress,
  nextStage
} = require('../services/apiClient');

class ScreenValidationError extends Error {
  constructor(message, screen) {
    super(message);
    this.name = 'ScreenValidationError';
    this.screen = screen;
  }
}

class BFController {
  constructor() {
    this.addressService = new AddressService();
    this.benefitsService = new BenefitsService();
    this.validadores = {
      nome: this.#validateName.bind(this),
      cpf: this.#validateCPF.bind(this)
    };
  }

  // Validadores privados
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
      throw new ScreenValidationError('CPF não informado', 'signup');
    }
  
    const cleaned = cpf.replace(/\D/g, '');
    
    if (cleaned.length !== 11) {
      throw new ScreenValidationError('CPF deve conter 11 dígitos', 'signup');
    }
  
    if (/^(\d)\1{10}$/.test(cleaned)) {
      throw new ScreenValidationError('CPF inválido', 'signup');
    }
  
    // Validação do dígito
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cleaned.charAt(i)) * (10 - i);
    }
    
    let digit = 11 - (sum % 11);
    if (digit >= 10) digit = 0;
    
    if (digit !== parseInt(cleaned.charAt(9))) {
      throw new ScreenValidationError('CPF inválido', 'signup');
    }
  
    // Validação do segundo dígito
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cleaned.charAt(i)) * (11 - i);
    }
    
    digit = 11 - (sum % 11);
    if (digit >= 10) digit = 0;
    
    if (digit !== parseInt(cleaned.charAt(10))) {
      throw new ScreenValidationError('CPF inválido', 'signup');
    }
  }

  createResponse(screen, data = {}, options = {}) {
    const { flow_token, version, error = false, errorMessage = null } = options;

    const formattedError = data.error ? {
      error: true,
      errorMessage: data.error
    } : {};

    return {
      screen,
      data: {
        ...data,
        ...(flow_token && { flow_token }),
        ...(version && { version }),
        ...formattedError,
        ...(error && { error }),
        ...(errorMessage && { errorMessage })
      }
    };
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

    const handlerExists = !!handlers[screen];
    Logger.info('Handler encontrado para tela', {
      screen,
      handlerExists
    });

    return handlers[screen];
  }

  _createEnhancedResponse(screen, data, options = {}) {
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


  // HANDLES: O QUE ACONTECE EM CADA TELA
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

      if (leadData.etapaFunil.toLowerCase() === 'inexistente') {
        return this._handleNewLead(data, leadData, flow_token, version, startTime);
      }

      if (leadData.oportunidades.length > 0 || (Array.isArray(leadData?.pedirInfos) && leadData?.pedirInfos?.length === 0)) {
        Logger.info('Possui oportunidade ou já completou o cadastro!');
        let etapa;

        if (leadData.oportunidades && 
            leadData.oportunidades[0] && 
            leadData.oportunidades[0].etapa) {
            etapa = leadData.oportunidades[0].etapa;
        } else if (leadData.etapaFunil) {
            etapa = leadData.etapaFunil;
        } else {
            etapa = 'Em Andamento';
        }
        
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

      // Para caso existente
        const SCREEN_CONFIG = {
          screens: {
              documento: 'information',
              endereco: 'address',
              conta: 'account'
          },
          priority: ['documento', 'endereco', 'conta'],
          imageTypes: ['imagem-rg-frente', 'imagem-rg-tras'],
          outsideDocs: ['imagem-conta', 'extrato-conta']
        };

        function getNextScreen(pendingInfo) {
          Logger.info('Buscando próximo tela!')
          const isOutsideDocument = (item) => ['imagem-conta', 'extrato-conta'].includes(item);
          const outsideDocsMatch = (
              pendingInfo.length <= 2 &&
              pendingInfo.every(isOutsideDocument)
          );

          if (outsideDocsMatch) {
              return 'complete';
          }

          const nextPriorityScreen = SCREEN_CONFIG.priority.find(
              screen => pendingInfo.includes(screen)
          );

          if (nextPriorityScreen) {
              return SCREEN_CONFIG.screens[nextPriorityScreen];
          }

          const hasImagePending = pendingInfo.some(
              info => SCREEN_CONFIG.imageTypes.includes(info)
          );

          return hasImagePending ? 'warning' : 'information';
        }

      if (Array.isArray(leadData?.pedirInfos)) {
          const nextScreen = getNextScreen(leadData.pedirInfos);
          return this._createEnhancedResponse(nextScreen, { 
              leadId: leadData.id
          }, { 
              flow_token, 
              version,
              startTime 
          });
      }
  
    } catch (error) {
      Logger.error('Erro na consulta de CPF', {
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
  
  async _handleNewLead(data, leadData, flow_token, version, startTime) {
    try {
      Logger.info('Processando novo lead', {
        leadId: leadData.id,
        timestamp: new Date().toISOString()
      });
  
      const bolsaFamiliaData = await this.benefitsService.consultarCPF(data.cpf);
      
      const titularData = bolsaFamiliaData.length > 0 ? 
        bolsaFamiliaData[0].titularBolsaFamilia : 
        {};
  
      return this._createEnhancedResponse('signup', {
        leadId: leadData.id,
        ...titularData
      }, { 
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
  
      return this._handleError(
        error, 
        'front', 
        flow_token, 
        version, 
        startTime
      );
    }
  }

  async handleSignupScreen(data, flow_token, version) {
      try {
        this.validadores.nome(data.nome);

        // Executa tudo em paralelo
        const [leadData, bolsaFamiliaData] = await Promise.all([
          createContact(data, flow_token).then(async (lead) => {
            if (!lead?.id) throw new Error('Erro ao criar contato');
            return lead;
          }),
          this.benefitsService.consultarNIS(data.nis)
        ]);

        const valorSaque = bolsaFamiliaData[0]?.valorSaque;
   
      return this.createResponse('information', {
        leadId: leadData.id,
        valorSaque
      }, { flow_token, version });
   
    } catch (error) {
      const errorMessage = error?.message || 'Erro desconhecido';
      const errorStack = error?.stack || 'Sem stack disponível';
  
      Logger.error('Erro no signup', {
          error: errorMessage,
          stack: errorStack
      });
  
      if (errorField === 'nis') {
          return this.createResponse('signup', {
              nisErro: `⚠️ ${errorMessage}`
          }, { flow_token, version });
      }
  
      return this.createResponse('signup', {
          nomeErro: `⚠️ ${errorMessage}`
      }, { flow_token, version });
    }  
  }

  async handleInformationScreen(data, flow_token, version) {
    const startTime = Date.now();
    try {
      Logger.info('Dados recebidos em Information Screen', {
        hasState: !!data.state,
        stateValue: data.state,
        hasNomeMae: !!data.nomeMae,
        timestamp: new Date().toISOString()
      });

      // Validar nome da mãe
      if (data.nomeMae) {
        this.validadores.nomeMae(data.nomeMae);
      } else {
        throw new ScreenValidationError('Nome da mãe não informado', 'information');
      }

      // Validar CEP
      this.validadores.cep(data.cep);

      const withTimeout = (promise, timeout = 30000) => {
        return Promise.race([
          promise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tempo limite excedido')), timeout)
          )
        ]);
      };

      // Usar em todas as chamadas externas
      const cepData = await withTimeout(
        this.addressService.fetchCEPData(data.cep)
      );

      if (cepData.error) {
        return this.createResponse('information', {
          cepErro: cepData.error
        }, { flow_token, version });
      }
      
      const leadId = data.leadId
      // Usar o estado retornado pelo CEP
      const documentResponse = await registerDocument({
        leadId: data.leadId,
        tipo: data.tipo || "RG",
        numero: data.numero,
        nomeMae: data.nomeMae,
        ufAgencia: cepData.state, // Usar o estado do CEP
        agencia: data.agencia || "SSP"
      });

      Logger.info('Information processado', {
        flow_token,
        duration: Date.now() - startTime,
        leadId: data.leadId,
        state: cepData.state
      });
      
      Logger.info('address', {...cepData, leadId}, { flow_token, version })
      return this.createResponse('address', {...cepData, leadId}, { flow_token, version });

    } catch (error) {
      Logger.error('Erro no processamento de information', {
        error: error.message,
        flow_token,
        duration: Date.now() - startTime,
        stack: error.stack
      });

      // Determinar qual campo teve erro baseado na mensagem
      let errorField = 'cepErro'; // Default

      if (error.message.toLowerCase().includes('nome da mãe') ||
        error.message.toLowerCase().includes('nome completo da mãe')) {
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

      // Normalizar dados recebidos
      const addressData = {
        leadId: data.leadId,
        cep: data.cep.replace(/\D/g, ''),
        logradouro: data.endereco, // Já vem como 'endereco' do payload
        numero: data.numero,
        complemento: data.complemento || '',
        bairro: data.bairro || '',
        cidade: data.cidade,
        estado: data.uf // Já vem como 'uf' do payload
      };

      Logger.info('Dados do endereço normalizados', {
        normalizedData: addressData,
        timestamp: new Date().toISOString()
      });

      try {
        // Registrar endereço
        await registerAddress(addressData);
        const leadId = data.leadId

        Logger.info('Endereço processado com sucesso', {
          flow_token,
          duration: Date.now() - startTime,
          leadId
        });


        Logger.info('account', {leadId}, {
          flow_token,
          version
        })

        // Redirecionar para a próxima tela
        return this.createResponse('account', {leadId}, {
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

  async handleAccountScreen(data, flow_token, version) {
    try {
      Logger.info('Iniciando processamento de conta', {
        leadId: data.leadId,
        agencia: data.agencia,
        codigoBanco: data.codigoBanco,
        tipoConta: data.tipoConta
      });
  
      // Validar dados bancários obrigatórios
      const requiredFields = ['agencia', 'conta', 'tipoConta', 'codigoBanco'];
      const missingFields = requiredFields.filter(field => !data[field]);
      
      // Validar se tem pelo menos CPF ou leadId
      if (!data.cpf && !data.leadId) {
        missingFields.push('cpf ou leadId');
      }
      
      if (missingFields.length) {
        Logger.warn('Campos obrigatórios faltando', {
          missingFields,
          data
        });
  
        return this.createResponse('account', {
          contaErro: `⚠️ Campos obrigatórios faltando: ${missingFields.join(', ')}`
        }, { 
          flow_token, 
          version,
          error: true 
        });
      }
  
      // Registrar conta
      Logger.info('Registrando dados bancários');
      await registerAccount(data);
      const leadId = data.leadId
  
      Logger.info('Dados bancários registrados com sucesso');
  
      return this.createResponse('warning', {leadId}, { 
        flow_token, 
        version 
      });
  
    } catch (error) {
      Logger.error('Erro no processamento de conta', {
        error: error.message,
        stack: error.stack
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

  async handleWarningScreen(data, flow_token, version) {
    return this.createResponse('documento_rg', {
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

        // Validar dados necessários
        if (!data.leadId) {
            throw new Error('ID do lead não informado');
        }

        // Upload dos documentos
        const uploadedFiles = await uploadFiles(data);

        Logger.info('Documentos processados com sucesso', uploadedFiles, {
            leadId: data.leadId,
            flow_token
        });

        return this.createResponse('complete', uploadedFiles, { 
            flow_token, 
            version 
        });

    } catch (error) {
        Logger.error('Erro no processamento de documentos', {
            error: error.message,
            stack: error.stack,
            leadId: data.leadId,
            flow_token
        });

        const errorKey = data.rg ? 'rgErro' : 'comprovanteErro';
        return this.createResponse('documento_rg', {
            [errorKey]: `⚠️ ${error.message}`
        }, { 
            flow_token, 
            version 
        });
    }
  }
}


module.exports = {
  BFController,
  ScreenValidationError
};