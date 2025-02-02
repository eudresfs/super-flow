process.env.INSTRUMENTATION_KEY = "InstrumentationKey=461ee3fb-9793-418b-a51e-a235aa21ecac";
const appInsights = require('applicationinsights');

class TelemetryService {
 static instance;
 
 constructor(instrumentationKey) {
   appInsights.setup(instrumentationKey)
     .setAutoCollectDependencies(true)
     .setAutoCollectPerformance(true)
     .start();

   this.client = appInsights.defaultClient;
 }

 static getInstance(instrumentationKey) {
   if (!instrumentationKey) {
     console.warn('INSTRUMENTATION_KEY not provided');
     return null;
   }
   if (!TelemetryService.instance && instrumentationKey) {
     TelemetryService.instance = new TelemetryService(instrumentationKey);
   }
   return TelemetryService.instance;
 }

  trackScreenView(screen, data = {}) {
    try {
      this.client.trackEvent({
        name: `Screen_${screen}`,
        properties: {
          flowId: data.flow_token,
          leadId: data.leadId,
          channel: 'whatsapp',
          flowType: data.flowType,
          screenName: screen,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  trackScreenError(screen, error, data = {}) {
    try {
      this.client.trackException({
        exception: error,
        properties: {
          screen,
          flowId: data.flow_token,
          leadId: data.leadId,
          flowType: data.flowType,
          errorType: error.name,
          errorMessage: error.message,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  trackScreenTransition(fromScreen, toScreen, data = {}) {
    try {
      this.client.trackEvent({
        name: 'ScreenTransition',
        properties: {
          fromScreen,
          toScreen,
          flowId: data.flow_token,
          leadId: data.leadId,
          flowType: data.flowType,
          duration: Date.now() - (data.startTime || Date.now()),
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  trackCustomMetric(name, value, properties = {}) {
    try {
      this.client.trackMetric({
        name,
        value,
        properties: {
          ...properties,
          channel: 'whatsapp',
          flowType: properties.flowType,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  trackCustomEvent(eventName, properties = {}) {
    try {
      this.client.trackEvent({
        name: eventName,
        properties: {
          ...properties,
          channel: 'whatsapp',
          flowType: properties.flowType,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }

  trackDependency(name, data) {
    try {
      this.client.trackDependency({
        name,
        target: data.target || 'unknown',
        duration: data.duration || 0,
        success: data.success || true,
        resultCode: data.resultCode || '200',
        dependencyTypeName: data.dependencyTypeName || 'HTTP',
        properties: {
          ...data.properties,
          channel: 'whatsapp',
          flowType: data.properties?.flowType,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Telemetry error:', error);
    }
  }
}

const telemetry = TelemetryService.getInstance(process.env.INSTRUMENTATION_KEY) || {
  trackCustomEvent: () => {},
  trackScreenView: () => {},
  trackScreenError: () => {},
  trackScreenTransition: () => {},
  trackCustomMetric: () => {},
  trackDependency: () => {}
};

module.exports = { TelemetryService, telemetry };