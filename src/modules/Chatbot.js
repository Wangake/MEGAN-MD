const axios = require('axios');
const config = require('../../config/config');
const settings = require('../../config/settings');

class Chatbot {
    constructor() {
        this.providers = {
            'megan-fast': this.meganFast.bind(this),
            'megan-base': this.meganBase.bind(this),
            'megan-ultra': this.meganUltra.bind(this),
            'gemini': this.geminiAI.bind(this),
            'openai': this.openAI.bind(this),
            'custom': this.customAI.bind(this)
        };
        
        this.contexts = new Map();
        this.history = new Map();
        this.maxHistory = 10;
    }

    // Get user context
    getUserContext(userId) {
        if (!this.contexts.has(userId)) {
            this.contexts.set(userId, {
                userId,
                conversation: [],
                preferences: {},
                lastActive: Date.now()
            });
        }
        return this.contexts.get(userId);
    }

    // Update user context
    updateUserContext(userId, update) {
        const context = this.getUserContext(userId);
        Object.assign(context, update);
        context.lastActive = Date.now();
        this.contexts.set(userId, context);
        return context;
    }

    // Add to conversation history
    addToHistory(userId, role, message) {
        if (!this.history.has(userId)) {
            this.history.set(userId, []);
        }
        
        const history = this.history.get(userId);
        history.push({ role, message, timestamp: Date.now() });
        
        // Keep only last N messages
        if (history.length > this.maxHistory) {
            this.history.set(userId, history.slice(-this.maxHistory));
        }
    }

    // Get conversation history
    getHistory(userId) {
        return this.history.get(userId) || [];
    }

    // Megan Fast AI (Worker)
    async meganFast(prompt, context = {}) {
        try {
            const response = await axios.post(
                'https://late-salad-9d56.youngwanga254.workers.dev',
                {
                    prompt: prompt,
                    model: '@cf/meta/llama-3.1-8b-instruct',
                    context: context
                },
                { timeout: config.AI_TIMEOUT }
            );
            
            return {
                success: true,
                response: response.data.data?.response || this.fallbackResponse(prompt),
                provider: 'megan-fast',
                model: 'llama-3.1-8b-instruct'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                response: this.fallbackResponse(prompt)
            };
        }
    }

    // Megan Base AI
    async meganBase(prompt, context = {}) {
        try {
            const response = await axios.post(
                'https://late-salad-9d56.youngwanga254.workers.dev',
                {
                    prompt: prompt,
                    model: '@hf/thebloke/llama-2-13b-chat-awq',
                    context: context
                },
                { timeout: 15000 }
            );
            
            return {
                success: true,
                response: response.data.data?.response || await this.meganFast(prompt),
                provider: 'megan-base',
                model: 'llama-2-13b-chat-awq'
            };
        } catch (error) {
            return await this.meganFast(prompt, context);
        }
    }

    // Megan Ultra AI (Enhanced)
    async meganUltra(prompt, context = {}) {
        try {
            // Enhanced processing
            const enhancedPrompt = `Context: ${JSON.stringify(context)}\n\nUser: ${prompt}\n\nAssistant:`;
            
            const response = await axios.post(
                'https://late-salad-9d56.youngwanga254.workers.dev',
                {
                    prompt: enhancedPrompt,
                    model: '@cf/meta/llama-3.1-8b-instruct',
                    temperature: 0.7,
                    max_tokens: 500
                },
                { timeout: 20000 }
            );
            
            return {
                success: true,
                response: `✨ ${response.data.data?.response || 'Enhanced response generated.'}`,
                provider: 'megan-ultra',
                model: 'llama-3.1-8b-instruct-enhanced'
            };
        } catch (error) {
            return await this.meganBase(prompt, context);
        }
    }

    // Gemini AI (Google)
    async geminiAI(prompt, context = {}) {
        try {
            // Placeholder for Gemini API
            // In production, use: const { GoogleGenerativeAI } = require("@google/generative-ai");
            return await this.meganUltra(prompt, context);
        } catch (error) {
            return await this.meganBase(prompt, context);
        }
    }

    // OpenAI
    async openAI(prompt, context = {}) {
        try {
            // Placeholder for OpenAI API
            // In production, use: const OpenAI = require("openai");
            return await this.meganUltra(prompt, context);
        } catch (error) {
            return await this.meganBase(prompt, context);
        }
    }

    // Custom AI Endpoint
    async customAI(prompt, context = {}) {
        try {
            const customEndpoint = process.env.CUSTOM_AI_ENDPOINT;
            if (!customEndpoint) {
                return await this.meganFast(prompt, context);
            }

            const response = await axios.post(customEndpoint, {
                prompt,
                context,
                userId: context.userId
            }, { timeout: config.AI_TIMEOUT });

            return {
                success: true,
                response: response.data.response || response.data,
                provider: 'custom',
                endpoint: customEndpoint
            };
        } catch (error) {
            return await this.meganFast(prompt, context);
        }
    }

    // Main chat method
    async chat(prompt, userId, options = {}) {
        try {
            const userSettings = settings.getUserSettings(userId);
            const provider = options.provider || userSettings.aiProvider || config.AI_PROVIDER;
            
            // Get user context
            const context = this.getUserContext(userId);
            
            // Add user message to history
            this.addToHistory(userId, 'user', prompt);
            
            // Get AI handler
            const handler = this.providers[provider] || this.providers['megan-fast'];
            
            // Prepare context with history
            const chatContext = {
                ...context,
                userId,
                history: this.getHistory(userId),
                settings: userSettings,
                timestamp: Date.now()
            };

            // Get AI response
            const result = await handler(prompt, chatContext);
            
            if (result.success) {
                // Add AI response to history
                this.addToHistory(userId, 'assistant', result.response);
                
                // Update context
                this.updateUserContext(userId, {
                    lastQuery: prompt,
                    lastResponse: result.response,
                    providerUsed: result.provider
                });

                return {
                    ...result,
                    context: chatContext,
                    historyLength: this.getHistory(userId).length
                };
            } else {
                return {
                    success: false,
                    response: this.fallbackResponse(prompt),
                    error: result.error,
                    provider: 'fallback'
                };
            }
        } catch (error) {
            return {
                success: false,
                response: this.fallbackResponse(prompt),
                error: error.message,
                provider: 'error-fallback'
            };
        }
    }

    // Fallback responses
    fallbackResponse(prompt) {
        const responses = [
            `I understand you said: "${prompt.substring(0, 50)}..."`,
            `Processing your message...`,
            `Thanks for your message! How can I assist you further?`,
            `I heard: "${prompt.substring(0, 30)}" - could you elaborate?`,
            `That's interesting! Tell me more.`,
            `I'm here to help! What else would you like to know?`,
            `Got it! Is there anything specific you'd like me to help with?`
        ];
        
        return responses[Math.floor(Math.random() * responses.length)];
    }

    // Clear user history
    clearHistory(userId) {
        this.history.delete(userId);
        this.contexts.delete(userId);
        return true;
    }

    // Get chatbot stats
    getStats() {
        return {
            activeUsers: this.contexts.size,
            totalHistory: Array.from(this.history.values()).reduce((sum, hist) => sum + hist.length, 0),
            providers: Object.keys(this.providers)
        };
    }
}

module.exports = Chatbot;
