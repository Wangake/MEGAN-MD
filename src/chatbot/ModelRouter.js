// src/chatbot/ModelRouter.js
const axios = require('axios');

class ModelRouter {
  constructor() {
    this.models = {
      'megan-fast': this.fastModel.bind(this),
      'megan-base': this.baseModel.bind(this),
      'megan-ultra': this.ultraModel.bind(this),
      'cloudflare': this.cloudflareModel.bind(this)
    };
    this.enabled = true;
    this.onlyInbox = true;
  }

  async route(model, message, context) {
    if (!this.enabled) return null;
    
    // Check if we should reply
    if (this.onlyInbox && context.isGroup) {
      return null; // Skip groups
    }
    
    const handler = this.models[model] || this.models['megan-fast'];
    return await handler(message);
  }

  async fastModel(message) {
    try {
      const response = await axios.post(
        'https://late-salad-9d56.youngwanga254.workers.dev',
        { 
          prompt: message,
          model: '@cf/meta/llama-3.1-8b-instruct'
        },
        { timeout: 10000 }
      );
      return response.data.data?.response || 'No response';
    } catch (error) {
      console.error('Fast model error:', error.message);
      return this.fallbackResponse(message);
    }
  }

  async baseModel(message) {
    try {
      const response = await axios.post(
        'https://late-salad-9d56.youngwanga254.workers.dev',
        { 
          prompt: message,
          model: '@hf/thebloke/llama-2-13b-chat-awq'
        },
        { timeout: 15000 }
      );
      return response.data.data?.response || this.fastModel(message);
    } catch (error) {
      return this.fastModel(message);
    }
  }

  async ultraModel(message) {
    return `[Ultra Mode] ${message}\n\nEnhanced response coming soon!`;
  }

  async cloudflareModel(message) {
    return this.fastModel(message);
  }

  fallbackResponse(message) {
    const responses = [
      `I heard: "${message.substring(0, 50)}..."`,
      `Processing your message...`,
      `Thanks for reaching out!`
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }
  setInboxOnly(enable) { this.onlyInbox = enable; }
}

module.exports = ModelRouter;
