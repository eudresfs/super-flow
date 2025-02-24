const { getNextScreen } = require('../src/flow.js');
const { decryptRequest, encryptResponse } = require('../src/encryption.js');

// Lista de flows permitidos
const ALLOWED_FLOWS = ['bolsa-familia', 'gov-ce', 'fgts', 'inss', 'siape'];

module.exports = async function (context, req) {
    try {
        // Obtém o flowType da query string ou usa o default
        const flowType = (req.query.flow_name || 'bolsa-familia').toLowerCase();

        // Valida se o flow é permitido
        if (!ALLOWED_FLOWS.includes(flowType)) {
            context.log.warn(`Flow type inválido: ${flowType}`);
            context.res = {
                status: 400,
                body: encryptResponse(
                    { error: `Flow type não suportado. Opções válidas: ${ALLOWED_FLOWS.join(', ')}` },
                    decryptedRequest.aesKeyBuffer,
                    decryptedRequest.initialVectorBuffer
                )
            };
            return;
        }
        
        const decryptedRequest = decryptRequest(
            req.body,
            process.env.PRIVATE_KEY,
            process.env.PASSPHRASE
        );

        const screenResponse = await getNextScreen(decryptedRequest.decryptedBody, flowType);
        
        context.res = {
            status: 200,
            body: encryptResponse(
                screenResponse,
                decryptedRequest.aesKeyBuffer,
                decryptedRequest.initialVectorBuffer
            )
        };
    } catch (error) {
        context.log.error('Erro ao processar requisição:', {
            error: error.message,
            stack: error.stack,
            query: req.query
        });
        context.res = { status: 200 };
    }
};
