// src/lib/CommandHandler.js - Fixed with LID support
const fs = require('fs');
const path = require('path');

class CommandHandler {
    constructor(bot, config) {
        // Check if already initialized
        if (bot.commandHandler) {
            return bot.commandHandler;
        }

        this.bot = bot;
        this.config = config;
        this.commands = new Map();
        this.categories = {
            'public': '👤 Public Commands',
            'group': '👥 Group Commands',
            'admin': '⭐ Admin Commands',
            'owner': '👑 Owner Commands'
        };

        this.emoji = bot.emoji;
        this.logger = bot.logger;

        // Store instance in bot
        bot.commandHandler = this;

        // Load all commands
        this.loadCommands();
    }

    loadCommands() {
        const commandsDir = path.join(__dirname, '../../wanga/commands');

        // Create directory structure if it doesn't exist
        if (!fs.existsSync(commandsDir)) {
            fs.mkdirSync(commandsDir, { recursive: true });
            this.logger.log('Created commands directory', 'info');
        }

        // Strategy 1: Load from category folders
        for (const [category, categoryName] of Object.entries(this.categories)) {
            const categoryPath = path.join(commandsDir, category);

            if (fs.existsSync(categoryPath)) {
                const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

                for (const file of files) {
                    const commandName = path.basename(file, '.js');

                    try {
                        const commandPath = path.join(categoryPath, file);
                        const command = require(commandPath);

                        // Handle both formats: object with execute method or direct function
                        if (typeof command === 'object' && command.execute) {
                            this.commands.set(commandName, {
                                name: commandName,
                                description: command.description || 'No description',
                                usage: command.usage || this.config.PREFIX + commandName,
                                category: command.category || category,
                                categoryName: categoryName,
                                execute: command.execute.bind(command)
                            });
                        } else if (typeof command === 'function') {
                            this.commands.set(commandName, {
                                name: commandName,
                                description: 'No description',
                                usage: this.config.PREFIX + commandName,
                                category: category,
                                categoryName: categoryName,
                                execute: command
                            });
                        }

                        this.logger.log(`Loaded: ${category}/${commandName}`, 'debug');
                    } catch (error) {
                        this.logger.log(`Failed ${category}/${commandName}: ${error.message}`, 'warning');
                    }
                }
            }
        }

        // Strategy 2: Load single-file commands (like group.js with multiple exports)
        const singleFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js') && f !== 'index.js');

        for (const file of singleFiles) {
            try {
                const filePath = path.join(commandsDir, file);
                const module = require(filePath);

                // If file exports multiple commands as an object
                if (typeof module === 'object' && !module.execute) {
                    for (const [commandName, commandDef] of Object.entries(module)) {
                        if (commandDef && typeof commandDef.execute === 'function') {
                            this.commands.set(commandName, {
                                name: commandName,
                                description: commandDef.description || 'No description',
                                usage: commandDef.usage || this.config.PREFIX + commandName,
                                category: commandDef.category || 'public',
                                categoryName: this.categories[commandDef.category] || 'Public Commands',
                                execute: commandDef.execute.bind(commandDef)
                            });

                            this.logger.log(`Loaded from ${file}: ${commandName}`, 'debug');
                        }
                    }
                }
            } catch (error) {
                this.logger.log(`Failed to load ${file}: ${error.message}`, 'warning');
            }
        }

        this.logger.log(`✅ Loaded ${this.commands.size} commands`, 'success');
    }

    // ADDED: Reload commands method
    reloadCommands() {
        this.logger.log('Reloading commands...', 'info');
        
        // Clear existing commands
        this.commands.clear();
        
        // Clear require cache for command files
        const commandFiles = [];
        const commandsDir = path.join(__dirname, '../../wanga/commands');
        
        // Collect all command files
        for (const [category] of Object.entries(this.categories)) {
            const categoryPath = path.join(commandsDir, category);
            if (fs.existsSync(categoryPath)) {
                const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
                files.forEach(file => {
                    const filePath = path.join(categoryPath, file);
                    commandFiles.push(filePath);
                });
            }
        }
        
        // Clear cache for each command file
        commandFiles.forEach(filePath => {
            if (require.cache[filePath]) {
                delete require.cache[filePath];
            }
        });
        
        // Reload commands
        this.loadCommands();
        
        return this.commands.size;
    }

    async handleCommand(msg, text, from, sender, isGroup) {
        const commandName = text.slice(this.config.PREFIX.length).trim().split(/ +/)[0].toLowerCase();
        const args = text.slice(this.config.PREFIX.length + commandName.length).trim().split(/ +/);

        const command = this.commands.get(commandName);

        if (!command) {
            return {
                success: false,
                message: `❌ Unknown command. Type ${this.config.PREFIX}menu for available commands.`
            };
        }

        // Execute command
        try {
            this.logger.log(`⌨️ ${commandName} from ${sender.split('@')[0]}`, 'info');

            const result = await command.execute({
                bot: this.bot,
                msg: msg,
                from: from,
                sender: sender,
                args: args,
                text: text,
                isGroup: isGroup,
                command: commandName,
                config: this.config
            });

            return {
                success: true,
                message: result || '✅ Command executed.',
                command: commandName
            };

        } catch (error) {
            this.logger.error(error, `command:${commandName}`);
            return {
                success: false,
                message: `❌ Error: ${error.message}`
            };
        }
    }

    async generateHelpMenu() {
        let menu = `📋 *${this.config.BOT_NAME} COMMANDS*\n\n`;

        for (const [category, categoryName] of Object.entries(this.categories)) {
            const categoryCommands = [];

            for (const [name, cmd] of this.commands) {
                if (cmd.category === category) {
                    categoryCommands.push({
                        name: name,
                        description: cmd.description
                    });
                }
            }

            if (categoryCommands.length > 0) {
                menu += `*${categoryName}:*\n`;

                for (const cmd of categoryCommands) {
                    menu += `• ${this.config.PREFIX}${cmd.name}`;
                    if (cmd.description && cmd.description !== 'No description') {
                        menu += ` - ${cmd.description}`;
                    }
                    menu += '\n';
                }
                menu += '\n';
            }
        }

        menu += `📊 Total: ${this.commands.size} commands\n`;
        menu += `🔧 Prefix: ${this.config.PREFIX}\n\n`;
        menu += `📝 *Note:* Admin commands work for all group members.`;

        return menu;
    }
}

module.exports = CommandHandler;
