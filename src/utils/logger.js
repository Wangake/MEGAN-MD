const pino = require('pino');
const chalk = require('chalk');
const moment = require('moment-timezone');
const config = require('../../config/config');

class MeganLogger {
    constructor() {
        this.timezone = config.TIMEZONE;
        this.botName = config.BOT_NAME;
        
        // Create Pino logger for Baileys
        this.pinoLogger = pino({
            level: config.LOG_LEVEL,
            transport: config.DEBUG ? {
                target: 'pino-pretty',
                options: { colorize: true }
            } : undefined
        });
        
        // Colors
        this.colors = {
            info: chalk.cyan,
            success: chalk.green,
            warning: chalk.yellow,
            error: chalk.red,
            debug: chalk.magenta,
            system: chalk.blue,
            incoming: chalk.green.bold,
            outgoing: chalk.blue.bold,
            command: chalk.yellow.bold,
            ai: chalk.magenta.bold
        };
        
        // Emojis
        this.emojis = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            debug: '🐛',
            incoming: '📥',
            outgoing: '📤',
            command: '⌨️',
            ai: '🤖',
            group: '👥',
            private: '👤',
            media: '🖼️',
            link: '🔗',
            money: '💰',
            time: '⏰'
        };
    }

    getTimestamp() {
        return moment().tz(this.timezone).format('HH:mm:ss');
    }

    formatMessage(level, message, emoji = '', context = '') {
        const timestamp = chalk.gray(`[${this.getTimestamp()}]`);
        const botTag = chalk.magenta(`[${this.botName}]`);
        const levelColor = this.colors[level] || chalk.white;
        const contextTag = context ? chalk.gray(`[${context}]`) : '';
        
        return `${timestamp} ${botTag} ${emoji} ${levelColor(message)} ${contextTag}`;
    }

    // Public logging methods
    log(message, level = 'info', emoji = '', context = '') {
        const formatted = this.formatMessage(level, message, emoji, context);
        console.log(formatted);
        
        // Also log to file via Pino if debug mode
        if (config.DEBUG) {
            this.pinoLogger[level]({ message, context });
        }
    }

    info(message, context = '') {
        this.log(message, 'info', this.emojis.info, context);
    }

    success(message, context = '') {
        this.log(message, 'success', this.emojis.success, context);
    }

    warning(message, context = '') {
        this.log(message, 'warning', this.emojis.warning, context);
    }

    error(message, context = '') {
        this.log(message, 'error', this.emojis.error, context);
    }

    debug(message, context = '') {
        if (config.DEBUG) {
            this.log(message, 'debug', this.emojis.debug, context);
        }
    }

    // Specialized loggers
    incomingMessage(msg, isGroup = false) {
        const type = isGroup ? 'GROUP' : 'PVT';
        const from = msg.key.remoteJid.split('@')[0];
        const text = this.extractMessageText(msg);
        const shortText = text ? text.substring(0, 50) : '[Media]';
        
        this.log(`${type}: ${from} - ${shortText}`, 'incoming', 
                 isGroup ? this.emojis.group : this.emojis.private, 'MSG');
    }

    outgoingMessage(to, message, isForwarded = false) {
        const toShort = to.split('@')[0];
        const type = isForwarded ? 'FWD' : 'SENT';
        this.log(`${type} to ${toShort}: ${this.getMessageType(message)}`, 
                 'outgoing', this.emojis.outgoing, 'SEND');
    }

    commandLog(command, from, args = []) {
        const fromShort = from.split('@')[0];
        const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';
        this.log(`${fromShort} - ${command}${argsStr}`, 'command', this.emojis.command, 'CMD');
    }

    aiResponse(prompt, response, model = '') {
        const shortPrompt = prompt.substring(0, 30);
        const shortResponse = response.substring(0, 30);
        this.log(`AI: "${shortPrompt}..." → "${shortResponse}..."`, 'ai', this.emojis.ai, model);
    }

    connection(status, details = '') {
        const statusEmojis = {
            connecting: '🔌',
            connected: '✅',
            disconnected: '❌',
            reconnecting: '🔄'
        };
        this.log(`${status}: ${details}`, 'system', statusEmojis[status] || '⚡', 'CONN');
    }

    // Helper methods
    extractMessageText(msg) {
        if (!msg.message) return '';
        if (msg.message.conversation) return msg.message.conversation;
        if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
        if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
        if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;
        return '';
    }

    getMessageType(message) {
        if (message.text) return `Text: ${message.text.substring(0, 30)}...`;
        if (message.image) return 'Image';
        if (message.video) return 'Video';
        if (message.audio) return 'Audio';
        if (message.sticker) return 'Sticker';
        if (message.contact) return 'Contact';
        if (message.location) return 'Location';
        if (message.poll) return 'Poll';
        return 'Unknown';
    }
}

// Export both Pino logger (for Baileys) and MeganLogger
module.exports = new MeganLogger().pinoLogger;
module.exports.MeganLogger = MeganLogger;
module.exports.createLogger = () => new MeganLogger();
