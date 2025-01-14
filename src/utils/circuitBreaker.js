// src/utils/circuitBreaker.js

class CircuitBreakerError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CircuitBreakerError';
    }
  }
  
  class CircuitBreaker {
    constructor(options = {}) {
      this.failureThreshold = options.failureThreshold || 5;
      this.resetTimeout = options.resetTimeout || 60000; // 60 segundos
      this.state = 'CLOSED';
      this.failures = 0;
      this.lastFailureTime = null;
      this.successThreshold = options.successThreshold || 2;
      this.successCount = 0;
    }
  
    async execute(operation) {
      if (this.state === 'OPEN') {
        if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
          this.state = 'HALF_OPEN';
        } else {
          throw new CircuitBreakerError('Circuit breaker is OPEN');
        }
      }
  
      try {
        const result = await operation();
  
        if (this.state === 'HALF_OPEN') {
          this.successCount++;
          if (this.successCount >= this.successThreshold) {
            this.reset();
          }
        }
  
        return result;
      } catch (error) {
        this.handleFailure();
        throw error;
      }
    }
  
    handleFailure() {
      this.failures++;
      this.lastFailureTime = Date.now();
  
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
      }
    }
  
    reset() {
      this.failures = 0;
      this.successCount = 0;
      this.state = 'CLOSED';
      this.lastFailureTime = null;
    }
  
    getState() {
      return {
        state: this.state,
        failures: this.failures,
        lastFailureTime: this.lastFailureTime,
        successCount: this.successCount
      };
    }
  }

  module.exports.CircuitBreaker = CircuitBreaker;