class Validators {
    static validateName(nome, screen) {
      const nomeValido = nome.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
      if (nomeValido !== nome.trim()) {
        throw new ScreenValidationError('O nome não deve conter números ou caracteres especiais', screen);
      }
      if (nomeValido.split(/\s+/).length < 2) {
        throw new ScreenValidationError('Por favor, informe o nome completo', screen);
      }
      return nomeValido;
    }
  
    static validateCPF(cpf, screen) {
      if (!cpf) {
        throw new ScreenValidationError('CPF não informado', screen);
      }
  
      const cleaned = cpf.replace(/\D/g, '');
      if (cleaned.length !== 11) {
        throw new ScreenValidationError('CPF deve conter 11 dígitos', screen);
      }
  
      return true;
    }
  
    static validateAccount(data, screen) {
      const requiredFields = ['agencia', 'conta', 'tipoConta', 'codigoBanco'];
      const missingFields = requiredFields.filter(field => !data[field]);
  
      if (missingFields.length) {
        throw new ScreenValidationError(`Campos obrigatórios faltando: ${missingFields.join(', ')}`, screen);
      }
  
      if (!data.cpf && !data.leadId) {
        throw new ScreenValidationError('CPF ou leadId não informado', screen);
      }
  
      return true;
    }
  }
  
  module.exports = Validators;