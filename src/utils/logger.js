// utils/logger.js
export class Logger {
  static error(message, error) {
    console.error(`${message}:`, error);
  }

  static info(message, data = '') {
    console.log(message, data || '');
  }
}