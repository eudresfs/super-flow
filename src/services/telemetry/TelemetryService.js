// TelemetryService.js
const appInsights = require('applicationinsights');
const { EVENT_TYPES } = require('./constants');

class TelemetryService {
  static instance;

  constructor(instrumentationKey) {
    if (!instrumentationKey) {
      console.warn('INSTRUMENTATION_KEY not provided');
      return;
    }

    appInsights.setup(instrumentationKey)
      .setAutoCollectDependencies(true)
      .setAutoCollectPerformance(true)
      .start();

    this.client = appInsights.defaultClient;
  }

  static getInstance(instrumentationKey) {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService(instrumentationKey);
    }
    return TelemetryService.instance;
  }

  trackEvent(eventType, data = {}) {
    try {
      this.client.trackEvent({
        name: eventType.name,
        properties: {
          level: eventType.level,
          channel: data.channel,
          leadId: data.leadId,
          anonymousId: data.anonymousId,
          timestamp: new Date().toISOString(),
          ...data.properties
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  trackError(error, context = {}) {
    try {
      this.client.trackException({
        exception: error,
        properties: {
          channel: context.channel,
          leadId: context.leadId,
          screen: context.screen,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  async linkSessions(anonymousId, leadId) {
    try {
      this.trackEvent(EVENT_TYPES.SESSION_LINK, {
        anonymousId,
        leadId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Session linking error:', error);
    }
  }
}

module.exports = TelemetryService;