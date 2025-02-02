// constants.js
const CHANNELS = {
    WHATSAPP: {
      id: 'whatsapp',
      identifiers: ['phoneNumber'],
      sessionKey: 'flow_token'
    },
    WEB: {
      id: 'web',
      identifiers: ['visitorId', 'sessionId'],
      sessionKey: 'sessionId'
    },
    CRM: {
      id: 'crm',
      identifiers: ['userId'],
      sessionKey: 'sessionId'
    }
  };
  
  const EVENT_LEVELS = {
    MINOR: 'minor',
    MAJOR: 'major',
    CRITICAL: 'critical'
  };
  
  const EVENT_TYPES = {
    // Sessão
    SESSION_START: {
      name: 'SessionStart',
      level: EVENT_LEVELS.MINOR
    },
    SESSION_END: {
      name: 'SessionEnd',
      level: EVENT_LEVELS.MINOR
    },
  
    // Lead
    LEAD_CREATE: {
      name: 'LeadCreate',
      level: EVENT_LEVELS.MAJOR
    },
    LEAD_UPDATE: {
      name: 'LeadUpdate',
      level: EVENT_LEVELS.MINOR
    },
  
    // Documentos
    DOCUMENT_UPLOAD: {
      name: 'DocumentUpload',
      level: EVENT_LEVELS.MAJOR
    },
  
    // Contrato
    CONTRACT_SIGN: {
      name: 'ContractSign',
      level: EVENT_LEVELS.CRITICAL
    },
    CONTRACT_ERROR: {
      name: 'ContractError',
      level: EVENT_LEVELS.CRITICAL
    }
  };
  
  module.exports = {
    CHANNELS,
    EVENT_LEVELS,
    EVENT_TYPES
  };