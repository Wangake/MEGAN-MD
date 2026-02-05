const MeganBot = require('./megan.js');
const config = require('./config/config');

// Create bot instance
const bot = new MeganBot();

// Handle graceful shutdown
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    try {
        await bot.cleanup();
        console.log('✅ Bot shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    bot.logger?.error(`Uncaught Exception: ${error.message}`, 'CRASH');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    bot.logger?.error(`Unhandled Rejection: ${reason}`, 'CRASH');
});

// Start bot
async function startBot() {
    try {
        console.log(`🚀 Starting ${config.BOT_NAME}...`);
        
        // Connect to WhatsApp
        const connected = await bot.connect();
        if (!connected) {
            console.error('❌ Failed to connect to WhatsApp');
            process.exit(1);
        }
        
        // Keep process alive
        setInterval(() => {
            if (!bot.isConnected) {
                console.log('⚠️ Bot disconnected, attempting reconnect...');
            }
        }, 60000); // Check every minute
        
        console.log('✅ Bot started successfully');
        
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

// Start the bot
startBot();
