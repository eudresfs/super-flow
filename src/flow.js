import { Logger } from './utils/logger.js';
import { ScreenController } from './controllers/screenController.js';

export const getNextScreen = async (decryptedBody) => {
  Logger.info('Processando requisição:', decryptedBody);
  const { action, flow_token, version, data, screen } = decryptedBody;
  
  const screenController = new ScreenController();

  // Handlers para ações especiais
  if (action === "INIT") {
    return screenController.createResponse('signup', 
      { message: "Inicialização bem-sucedida" }, 
      { flow_token, version }
    );
  }
  
  if (action === "ping") {
    return {
      version,
      data: { status: "active" }
    };
  }

  // Handler para screens
  const screenHandlers = {
    signup: () => screenController.handleSignupScreen(data, flow_token, version),
    account: () => screenController.handleAccountScreen(data, flow_token, version),
    information: () => screenController.handleInformationScreen(data, flow_token, version)
  };

  const handler = screenHandlers[screen];
  if (handler) {
    const result = await handler();
    if (result) return result;
  }

  // Fallback - retorna a mesma tela
  return screenController.createResponse(screen, data, { flow_token, version });
};