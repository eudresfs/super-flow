// index.js
const TelemetryService = require('./TelemetryService');
const { AlertManager, ALERTS, ALERT_LEVELS, ALERT_CATEGORIES } = require('./alerts');
const { QueryRunner, BASE_QUERIES } = require('./queries');
const { CHANNELS, EVENT_LEVELS, EVENT_TYPES } = require('./constants');

// Instância singleton do serviço de telemetria
const telemetry = TelemetryService.getInstance(process.env.INSTRUMENTATION_KEY);

// Instância do gerenciador de alertas
const alertManager = new AlertManager(process.env.DISCORD_WEBHOOK);

// Instância do executor de queries
const queryRunner = new QueryRunner(telemetry.client);

module.exports = {
   // Serviços
   telemetry,
   alertManager,
   queryRunner,

   // Classes
   TelemetryService,
   AlertManager,
   QueryRunner,

   // Constantes
   CHANNELS,
   EVENT_LEVELS,
   EVENT_TYPES,
   ALERTS,
   ALERT_LEVELS,
   ALERT_CATEGORIES,
   BASE_QUERIES
};

// Exemplo de uso:
/*
const { telemetry, EVENT_TYPES } = require('./telemetry');

// Tracking de evento
telemetry.trackEvent(EVENT_TYPES.SESSION_START, {
   channel: 'whatsapp',
   anonymousId: 'flow_123'
});

// Alerta
alertManager.handleAlert('USER_STUCK', {
   leadId: 'lead_123',
   screen: 'DADOS_PESSOAIS'
});

// Query
const journey = await queryRunner.getLeadJourney('lead_123');
*/