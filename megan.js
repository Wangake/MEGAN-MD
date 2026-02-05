const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    Browsers,
    makeInMemoryStore
} = require('@whiskeysockets/baileys');
const config = require('./config/config');
const settings = require('./config/settings');
const { createLogger } = require('./src/utils/logger');
const CommandHandler = require('./src/handlers/CommandHandler');
const MessageCache = require('./src/cache/MessageCache');
const GroupCache = require('./src/cache/GroupCache');
const MediaProcessor = require('./src/modules/MediaProcessor');
const Chatbot = require('./src/modules/Chatbot');
const AutoFeatures = require('./src/modules/AutoFeatures');

class MeganBot {
    constructor() {
        this.config = config;
        this.settings = settings;
        this.logger = createLogger();
        
        // Core components
        this.sock = null;
        this.store = null;
        this.user = null;
        this.isConnected = false;
        
        // Modules
        this.messageCache = new MessageCache();
        this.groupCache = new GroupCache();
        this.mediaProcessor = new MediaProcessor();
        this.chatbot = new Chatbot();
        this.autoFeatures = null;
        this.commandHandler = null;
        
        // Statistics
        this.stats = {
            startTime: Date.now(),
            messagesProcessed: 0,
            commandsExecuted: 0,
            errors: 0,
            reconnects: 0
        };
        
        // State
        this.connectionState = 'disconnected';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        // Initialize
        this.init();
    }

    async init() {
        try {
            this.logger.info('🤖 Initializing Megan Bot...', 'INIT');
            
            // Load store for message history
            this.store = makeInMemoryStore({ });
            this.store.readFromFile('./data/store.json');
            
            // Auto-save store every 10 seconds
            setInterval(() => {
                this.store?.writeToFile('./data/store.json');
            }, 10000);
            
            this.logger.success('✅ Modules initialized', 'INIT');
        } catch (error) {
            this.logger.error(`❌ Initialization failed: ${error.message}`, 'INIT');
            process.exit(1);
        }
    }

    async connect() {
        try {
            this.connectionState = 'connecting';
            this.logger.connection('connecting', 'Establishing connection...');
            
            // Check session
            const fs = require('fs-extra');
            const sessionExists = await fs.pathExists('./session/creds.json');
            if (!sessionExists) {
                this.logger.error('❌ No session found. Please run: npm run pair', 'AUTH');
                process.exit(1);
            }
            
            // Load auth state
            const { state, saveCreds } = await useMultiFileAuthState('./session');
            
            // Get latest version
            const { version } = await fetchLatestBaileysVersion();
            
            // Create socket with optimized settings
            this.sock = makeWASocket({
                version,
                auth: state,
                logger: this.logger,
                printQRInTerminal: false,
                browser: Browsers.macOS('Desktop'),
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                syncFullHistory: false,
                cachedGroupMetadata: async (jid) => {
                    return this.groupCache.getGroupMetadata(jid);
                }
            });
            
            // Bind store to socket
            this.store?.bind(this.sock.ev);
            
            // Save credentials when updated
            this.sock.ev.on('creds.update', saveCreds);
            
            // Initialize handlers
            this.commandHandler = new CommandHandler(this);
            this.autoFeatures = new AutoFeatures(this);
            
            // Setup event handlers
            this.setupEventHandlers();
            
            this.logger.success('✅ Socket created', 'CONN');
            return true;
            
        } catch (error) {
            this.logger.error(`❌ Connection failed: ${error.message}`, 'CONN');
            this.stats.errors++;
            return false;
        }
    }

    setupEventHandlers() {
        // Connection updates
        this.sock.ev.on('connection.update', async (update) => {
            await this.handleConnectionUpdate(update);
        });
        
        // Message handling
        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
            await this.handleMessagesUpsert(messages, type);
        });
        
        // Group updates
        this.sock.ev.on('groups.update', async (updates) => {
            await this.handleGroupsUpdate(updates);
        });
        
        this.sock.ev.on('group-participants.update', async (event) => {
            await this.handleGroupParticipantsUpdate(event);
        });
        
        // Message reactions
        this.sock.ev.on('messages.reaction', async (reactions) => {
            await this.handleMessageReactions(reactions);
        });
        
        // Calls
        this.sock.ev.on('call', async (call) => {
            await this.handleIncomingCall(call);
        });
        
        // Presence updates
        this.sock.ev.on('presence.update', async (update) => {
            await this.handlePresenceUpdate(update);
        });
        
        // Chat updates
        this.sock.ev.on('chats.update', async (updates) => {
            await this.handleChatsUpdate(updates);
        });
        
        this.logger.success('✅ Event handlers registered', 'EVENT');
    }

    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            this.logger.info('QR Code generated', 'AUTH');
        }
        
        if (connection === 'open') {
            this.connectionState = 'connected';
            this.isConnected = true;
            this.user = this.sock.user;
            this.reconnectAttempts = 0;
            
            const phone = this.user.id.split(':')[0].split('@')[0];
            const name = this.user.name || this.user.verifiedName || 'Unknown';
            
            this.logger.connection('connected', `${name} (${phone})`);
            this.logger.success(`🚀 ${this.config.BOT_NAME} is now online!`, 'SYSTEM');
            this.logger.info(`📱 Phone: ${phone}`, 'SYSTEM');
            this.logger.info(`👑 Owner: ${this.config.OWNER_NAME}`, 'SYSTEM');
            this.logger.info(`⚡ Prefix: ${this.config.PREFIX}`, 'SYSTEM');
            this.logger.info(`⌨️ Commands: ${this.commandHandler.commands.size} loaded`, 'SYSTEM');
            
            // Set initial presence
            if (this.config.AUTO_PRESENCE) {
                setTimeout(() => {
                    this.sock.sendPresenceUpdate(this.config.AUTO_PRESENCE);
                    this.logger.info(`Presence set to: ${this.config.AUTO_PRESENCE}`, 'PRESENCE');
                }, 2000);
            }
            
            // Send startup notification
            setTimeout(() => this.sendStartupNotification(), 3000);
            
        } else if (connection === 'close') {
            this.connectionState = 'disconnected';
            this.isConnected = false;
            
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== 401);
            this.logger.connection('disconnected', `Connection closed. Reconnect: ${shouldReconnect}`);
            
            if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                
                this.logger.info(`Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'RECONNECT');
                this.stats.reconnects++;
                
                setTimeout(async () => {
                    await this.connect();
                }, delay);
            } else if (!shouldReconnect) {
                this.logger.error('❌ Session invalid. Please re-pair the bot.', 'AUTH');
                process.exit(1);
            }
        }
    }

    async handleMessagesUpsert(messages, type) {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            try {
                // Log incoming message
                const isGroup = msg.key.remoteJid.endsWith('@g.us');
                this.logger.incomingMessage(msg, isGroup);
                
                // Cache message
                this.messageCache.cacheMessage(msg);
                this.stats.messagesProcessed++;
                
                // Handle auto-features
                await this.autoFeatures.processMessage(msg);
                
                // Check for commands
                const text = this.extractMessageText(msg);
                if (text && text.startsWith(this.config.PREFIX)) {
                    await this.handleCommand(msg, text);
                } 
                // Handle AI chatbot
                else if (!msg.key.fromMe && this.shouldRespondToChatbot(msg)) {
                    await this.handleChatbot(msg, text);
                }
                
            } catch (error) {
                this.logger.error(`Failed to process message: ${error.message}`, 'MSG');
                this.stats.errors++;
            }
        }
    }

    async handleCommand(msg, text) {
        try {
            const from = msg.key.remoteJid;
            const sender = msg.key.participant || from;
            const isGroup = from.endsWith('@g.us');
            
            // Process command
            const result = await this.commandHandler.handleCommand(msg, text, from, sender, isGroup);
            
            if (!result.success && result.message) {
                await this.sendMessage(from, {
                    text: result.message,
                    footer: this.config.CHANNEL_LINK
                }, { quoted: msg });
            } else if (result.success) {
                this.stats.commandsExecuted++;
                this.logger.success(`Command executed: ${result.command}`, 'CMD');
            }
            
        } catch (error) {
            this.logger.error(`Command handling failed: ${error.message}`, 'CMD');
            this.stats.errors++;
        }
    }

    async handleChatbot(msg, text) {
        try {
            if (!text || text.trim().length === 0) return;
            
            const from = msg.key.remoteJid;
            const sender = msg.key.participant || from;
            const isGroup = from.endsWith('@g.us');
            
            // Get user settings
            const userSettings = this.settings.getUserSettings(sender);
            const groupSettings = isGroup ? this.settings.getGroupSettings(from) : {};
            
            const chatbotEnabled = isGroup 
                ? (groupSettings.chatbotInGroups !== false && userSettings.chatbotEnabled !== false)
                : userSettings.chatbotEnabled !== false;
            
            if (!chatbotEnabled) return;
            
            this.logger.aiResponse(text, 'Processing...', this.config.AI_PROVIDER);
            
            // Get AI response
            const response = await this.chatbot.chat(text, sender, {
                isGroup,
                groupId: isGroup ? from : null
            });
            
            if (response.success) {
                await this.sendMessage(from, {
                    text: `${response.response}\n\n💬 *AI Assistant*\n${this.config.CHANNEL_LINK}`,
                    footer: this.config.BOT_NAME
                }, { quoted: msg });
                
                this.logger.aiResponse(text, response.response, response.provider);
            }
            
        } catch (error) {
            this.logger.error(`Chatbot failed: ${error.message}`, 'AI');
        }
    }

    async handleGroupsUpdate(updates) {
        for (const update of updates) {
            try {
                await this.groupCache.cacheGroupMetadata(this.sock, update.id);
                this.logger.info(`Group updated: ${update.subject || update.id}`, 'GROUP');
            } catch (error) {
                this.logger.error(`Failed to update group cache: ${error.message}`, 'GROUP');
            }
        }
    }

    async handleGroupParticipantsUpdate(event) {
        try {
            const { id, participants, action } = event;
            await this.groupCache.cacheGroupMetadata(this.sock, id);
            
            this.logger.info(`Group ${action}: ${participants.length} participants in ${id}`, 'GROUP');
        } catch (error) {
            this.logger.error(`Failed to handle group participants: ${error.message}`, 'GROUP');
        }
    }

    async handleMessageReactions(reactions) {
        for (const reaction of reactions) {
            this.logger.info(`Reaction: ${reaction.reaction?.text || 'removed'} from ${reaction.key.participant}`, 'REACTION');
        }
    }

    async handleIncomingCall(call) {
        if (this.config.AUTO_REJECT_CALLS) {
            try {
                await this.sock.rejectCall(call.id, call.from);
                this.logger.info(`Auto-rejected call from: ${call.from.split('@')[0]}`, 'CALL');
            } catch (error) {
                this.logger.error(`Failed to reject call: ${error.message}`, 'CALL');
            }
        } else {
            this.logger.info(`Incoming call from: ${call.from.split('@')[0]}`, 'CALL');
        }
    }

    async handlePresenceUpdate(update) {
        // Log presence updates if debugging
        if (this.config.DEBUG) {
            this.logger.debug(`Presence update: ${update.id} is ${update.presence}`, 'PRESENCE');
        }
    }

    async handleChatsUpdate(updates) {
        // Handle chat updates (archive, mute, etc.)
        for (const update of updates) {
            if (this.config.DEBUG) {
                this.logger.debug(`Chat updated: ${update.id}`, 'CHAT');
            }
        }
    }

    // Helper methods
    extractMessageText(msg) {
        if (!msg.message) return '';
        if (msg.message.conversation) return msg.message.conversation;
        if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
        if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
        if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;
        if (msg.message.documentMessage?.title) return msg.message.documentMessage.title;
        return '';
    }

    shouldRespondToChatbot(msg) {
        // Don't respond to commands or bot's own messages
        if (msg.key.fromMe) return false;
        
        const text = this.extractMessageText(msg);
        if (!text) return false;
        
        // Check if it's a command
        if (text.startsWith(this.config.PREFIX)) return false;
        
        return true;
    }

    // Message sending with enhanced features
    async sendMessage(to, content, options = {}) {
        try {
            const defaultOptions = {
                quoted: options.quoted,
                ephemeralExpiration: options.ephemeral || undefined
            };
            
            // Add footer to text messages
            if (content.text && !content.text.includes(this.config.CHANNEL_LINK)) {
                const footer = `\n\n📢 *${this.config.BOT_NAME}*\n${this.config.CHANNEL_LINK}`;
                content.text = content.text + footer;
            }
            
            const result = await this.sock.sendMessage(to, content, defaultOptions);
            
            this.logger.outgoingMessage(to, content, options.forwarded === true);
            return result;
            
        } catch (error) {
            this.logger.error(`Failed to send message: ${error.message}`, 'SEND');
            throw error;
        }
    }

    async sendStartupNotification() {
        try {
            const ownerJid = `${this.config.OWNER_PHONE.replace(/\D/g, '')}@s.whatsapp.net`;
            const phone = this.user.id.split(':')[0].split('@')[0];
            const name = this.user.name || this.user.verifiedName || 'Unknown';
            
            const message = {
                text: `🚀 *${this.config.BOT_NAME} STARTUP COMPLETE*\n\n` +
                      `📱 *Bot Phone:* ${phone}\n` +
                      `👤 *Bot Name:* ${name}\n` +
                      `👑 *Owner:* ${this.config.OWNER_NAME}\n` +
                      `⚡ *Prefix:* ${this.config.PREFIX}\n` +
                      `⌨️ *Commands:* ${this.commandHandler.commands.size}\n` +
                      `💾 *Cache:* ${this.messageCache.stats.cachedMessages} messages\n\n` +
                      `✅ *Status:* Online and ready!\n` +
                      `📢 Channel: ${this.config.CHANNEL_LINK}`
            };
            
            await this.sendMessage(ownerJid, message);
            this.logger.success('Startup notification sent to owner', 'SYSTEM');
            
        } catch (error) {
            this.logger.warning(`Failed to send startup notification: ${error.message}`, 'SYSTEM');
        }
    }

    async getBotStats() {
        const uptime = Date.now() - this.stats.startTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        
        const messageCacheStats = this.messageCache.getStats();
        const commandStats = this.commandHandler?.getStats() || {};
        const chatbotStats = this.chatbot.getStats();
        
        return {
            general: {
                uptime: `${hours}h ${minutes}m`,
                connection: this.connectionState,
                connectedSince: new Date(this.stats.startTime).toLocaleString(),
                phone: this.user?.id?.split(':')[0] || 'Unknown'
            },
            statistics: {
                messagesProcessed: this.stats.messagesProcessed,
                commandsExecuted: this.stats.commandsExecuted,
                errors: this.stats.errors,
                reconnects: this.stats.reconnects
            },
            cache: {
                messagesCached: messageCacheStats.cacheSize,
                deletedRecovered: messageCacheStats.deletedRecovered,
                uniqueChats: messageCacheStats.uniqueChats
            },
            commands: commandStats,
            chatbot: chatbotStats,
            system: {
                memory: process.memoryUsage(),
                nodeVersion: process.version,
                platform: process.platform
            }
        };
    }

    async formatStats() {
        const stats = await this.getBotStats();
        
        let text = `📊 *${this.config.BOT_NAME} STATISTICS*\n\n`;
        
        text += `🔌 *Connection:*\n`;
        text += `• Status: ${stats.general.connection === 'connected' ? '✅ Online' : '❌ Offline'}\n`;
        text += `• Uptime: ${stats.general.uptime}\n`;
        text += `• Phone: ${stats.general.phone}\n\n`;
        
        text += `📈 *Activity:*\n`;
        text += `• Messages: ${stats.statistics.messagesProcessed}\n`;
        text += `• Commands: ${stats.statistics.commandsExecuted}\n`;
        text += `• Errors: ${stats.statistics.errors}\n`;
        text += `• Reconnects: ${stats.statistics.reconnects}\n\n`;
        
        text += `💾 *Cache:*\n`;
        text += `• Messages: ${stats.cache.messagesCached}\n`;
        text += `• Chats: ${stats.cache.uniqueChats}\n`;
        text += `• Deleted Recovered: ${stats.cache.deletedRecovered}\n\n`;
        
        text += `⌨️ *Commands:*\n`;
        text += `• Total: ${stats.commands?.totalCommands || 0}\n`;
        text += `• Categories: ${Object.keys(stats.commands?.categoryCounts || {}).length}\n\n`;
        
        text += `🤖 *AI Chatbot:*\n`;
        text += `• Active Users: ${stats.chatbot?.activeUsers || 0}\n`;
        text += `• History Items: ${stats.chatbot?.totalHistory || 0}\n\n`;
        
        text += `⚙️ *System:*\n`;
        text += `• Memory: ${Math.round(stats.system.memory.heapUsed / 1024 / 1024)}MB\n`;
        text += `• Node: ${stats.system.nodeVersion}\n`;
        text += `• Platform: ${stats.system.platform}\n\n`;
        
        text += `📢 *Channel:* ${this.config.CHANNEL_LINK}`;
        
        return text;
    }

    async cleanup() {
        this.logger.warning('🛑 Shutting down Megan Bot...', 'SYSTEM');
        
        try {
            // Save store
            if (this.store) {
                this.store.writeToFile('./data/store.json');
            }
            
            // Save message cache stats
            await this.messageCache.saveStats();
            
            // Save settings
            await this.settings.save();
            
            // Disconnect socket
            if (this.sock) {
                await this.sock.end();
            }
            
            this.logger.success('✅ Cleanup completed', 'SYSTEM');
            
        } catch (error) {
            this.logger.error(`Cleanup failed: ${error.message}`, 'SYSTEM');
        }
    }
}

module.exports = MeganBot;
