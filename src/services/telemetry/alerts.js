// alerts.js

const axios = require('axios');
const { TelemetryService } = require('./TelemetryService');

const ALERT_LEVELS = {
 WARNING: {
   severity: 1,
   notification: true
 },
 CRITICAL: {
   severity: 2,
   notification: true
 }
};

const ALERT_CATEGORIES = {
 BUSINESS: 'business',
 SYSTEM: 'system',
 DATA: 'data'
};

const ALERTS = {
 USER_STUCK: {
   name: 'Usuário Travado',
   category: ALERT_CATEGORIES.SYSTEM,
   level: ALERT_LEVELS.CRITICAL,
   condition: {
     event: 'SCREEN_TRANSITION',
     sameScreen: true,
     attempts: 3,
     window: '5m'
   },
   query: `
     customEvents
     | where timestamp > ago(5m)
     | where name == "SCREEN_TRANSITION"
     | extend screen = tostring(customDimensions.screen)
     | summarize attempts = count() by screen, leadId
     | where attempts >= 3
   `
 },

 CONTRACT_ERROR: {
   name: 'Erro de Contrato',
   category: ALERT_CATEGORIES.BUSINESS,
   level: ALERT_LEVELS.CRITICAL,
   condition: {
     event: 'CONTRACT_ERROR',
     threshold: 1,
     window: '1m'
   },
   query: `
     customEvents
     | where timestamp > ago(1m)
     | where name == "CONTRACT_ERROR"
   `
 },

 LOW_CONVERSION: {
   name: 'Queda na Conversão',
   category: ALERT_CATEGORIES.BUSINESS,
   level: ALERT_LEVELS.WARNING,
   condition: {
     metric: 'conversion_rate',
     threshold: 0.5,
     window: '24h'
   },
   query: `
     let current = customEvents
     | where timestamp > ago(24h)
     | where name == "ContractSign"
     | summarize current = count();
     let historical = customEvents
     | where timestamp > ago(7d) and timestamp < ago(24h)
     | where name == "ContractSign"
     | summarize historical = count() / 7;
     current | extend drop = historical * 0.5
     | where current < drop
   `
 }
};

class AlertManager {
 constructor(discordWebhook) {
   this.webhook = discordWebhook;
   this.telemetry = TelemetryService.getInstance();
 }

 async handleAlert(alertType, data) {
   const alert = ALERTS[alertType];
   if (!alert) return;

   try {
     const message = this.formatMessage(alert, data);
     await this.notify(message);
     await this.recordAlert(alertType, data);
   } catch (error) {
     console.error('Error handling alert:', error);
   }
 }

 formatMessage(alert, data) {
   const emoji = alert.level === ALERT_LEVELS.CRITICAL ? '🚨' : '⚠️';
   
   return `${emoji} ${alert.name}
     Categoria: ${alert.category}
     Severidade: ${alert.level.severity}
     Dados: ${JSON.stringify(data, null, 2)}
     Timestamp: ${new Date().toISOString()}`;
 }

 async notify(message) {
   try {
     await axios.post(this.webhook, { content: message });
   } catch (error) {
     console.error('Error sending notification:', error);
   }
 }

 async recordAlert(alertType, data) {
   this.telemetry.trackEvent({
     name: 'Alert',
     properties: {
       type: alertType,
       ...data,
       timestamp: new Date().toISOString()
     }
   });
 }
}

module.exports = {
 AlertManager,
 ALERTS,
 ALERT_LEVELS,
 ALERT_CATEGORIES
};