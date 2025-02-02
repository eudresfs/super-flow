const { getNextScreen } = require('../src/flow.js');
const { decryptRequest, encryptResponse } = require('../src/encryption.js');
const { Logger } = require('../src/utils/logger.js');

module.exports = async function (context, req) {
    try {
        // Descriptografa a requisição recebida.
        const decryptedRequest = decryptRequest(
            req.body,
            process.env.PRIVATE_KEY,
            process.env.PASSPHRASE
        );

        // Determina o tipo de fluxo com base no corpo descriptografado da requisição ou no parâmetro de consulta.
        const flowType = (decryptedRequest.decryptedBody?.data.creditGroup || req.query?.flow_name || 'padrao').toLowerCase();
        
        // Obtém a próxima tela com base no corpo descriptografado e no produto.    
        const screenResponse = await getNextScreen(decryptedRequest.decryptedBody, flowType);
        
        // Processamento da resposta criptografada para o Flows
        context.res = {
            status: 200,
            body: encryptResponse(
                screenResponse,
                decryptedRequest.aesKeyBuffer,
                decryptedRequest.initialVectorBuffer
            )
        };
        
    } catch (error) {
        context.log.error('Erro ao processar requisição:', error);
        context.res = { status: 200 };
    }
};
