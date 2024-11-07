// services/apiClient.js

import axios from 'axios';
import { Logger } from '../utils/logger.js';

export class ApiClient {
  constructor(baseURL, headers = {}) {
    this.instance = axios.create({
      baseURL,
      headers: {
        'accept': '*/*',
        ...headers
      }
    });
  }

  async get(url) {
    try {
      const response = await this.instance.get(url);
      return { data: response.data, error: null };
    } catch (error) {
      Logger.error(`API Request failed: ${url}`, error);
      return { data: null, error };
    }
  }
}