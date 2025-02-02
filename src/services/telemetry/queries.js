// queries.js

const BASE_QUERIES = {
    // Query base para jornada do lead
    LEAD_JOURNEY: `
      let leadJourney = customEvents
      | where timestamp > ago(90d)
      | extend 
          leadId = tostring(customDimensions.user.leadId),
          anonymousId = tostring(customDimensions.user.anonymousId),
          eventName = name,
          eventLevel = tostring(customDimensions.level),
          stage = tostring(customDimensions.context.stage),
          channel = tostring(customDimensions.channel.type)
      | project 
          timestamp,
          leadId,
          anonymousId,
          eventName,
          eventLevel,
          stage,
          channel;
    `,
   
    // Análise de Funil
    FUNNEL_ANALYSIS: `
      let funnelAnalysis = leadJourney
      | summarize 
          sessions = countif(eventName == "SessionStart"),
          leads = countif(eventName == "LeadCreate"),
          docs = countif(eventName == "DocumentUpload"),
          contracts = countif(eventName == "ContractSign"),
          errors = countif(eventLevel == "error")
      | extend
          conversion_rate = (toreal(contracts) / leads) * 100,
          error_rate = (toreal(errors) / sessions) * 100;
    `,
   
    // Análise por Etapa
    STAGE_ANALYSIS: `
      let stageAnalysis = leadJourney
      | where isnotempty(leadId)
      | summarize 
          start = min(timestamp),
          end = max(timestamp)
          by leadId, stage
      | extend duration = datetime_diff('minute', end, start);
    `
   };
   
   class QueryRunner {
    constructor(client) {
      this.client = client;
    }
   
    async getLeadJourney(leadId) {
      const query = `
        ${BASE_QUERIES.LEAD_JOURNEY}
        | where leadId == '${leadId}'
        | order by timestamp asc
      `;
      return await this.execute(query);
    }
   
    async getFunnelMetrics(timeWindow = '24h') {
      const query = `
        ${BASE_QUERIES.FUNNEL_ANALYSIS}
        | where timestamp > ago(${timeWindow})
      `;
      return await this.execute(query);
    }
   
    async getStageMetrics(stage) {
      const query = `
        ${BASE_QUERIES.STAGE_ANALYSIS}
        | where stage == '${stage}'
        | summarize 
            avgDuration = avg(duration),
            maxDuration = max(duration)
      `;
      return await this.execute(query);
    }
   
    async execute(query) {
      try {
        return await this.client.query(query);
      } catch (error) {
        console.error('Query execution error:', error);
        throw error;
      }
    }
   }
   
   module.exports = {
    QueryRunner,
    BASE_QUERIES
   };