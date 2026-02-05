// src/lib/cache/MessageCache.js - SQLite3 Cache System
const sqlite3 = require('sqlite3').verbose();

class MessageCache {
    constructor(config) {
        this.config = config;
        this.db = null;
        this.initialized = false;
        this.stats = {
            totalMessages: 0,
            deletedRecovered: 0,
            lastCleanup: new Date().toISOString()
        };
        
        // Initialize database
        this.initDatabase();
    }
    
    async initDatabase() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database('./data/messages.db', (err) => {
                if (err) {
                    console.error('Database error:', err);
                    reject(err);
                    return;
                }
                
                // Create messages table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS messages (
                        id TEXT PRIMARY KEY,
                        chatId TEXT NOT NULL,
                        senderId TEXT NOT NULL,
                        senderName TEXT,
                        timestamp INTEGER NOT NULL,
                        messageType TEXT NOT NULL,
                        textContent TEXT,
                        isViewOnce INTEGER DEFAULT 0,
                        messageData TEXT,
                        createdAt INTEGER DEFAULT (unixepoch())
                    )
                `, (err) => {
                    if (err) {
                        console.error('Table creation error:', err);
                        reject(err);
                        return;
                    }
                    
                    // Create indexes for fast lookup
                    this.db.run('CREATE INDEX IF NOT EXISTS idx_chatId ON messages(chatId)');
                    this.db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp)');
                    
                    console.log('✅ SQLite message cache initialized');
                    this.initialized = true;
                    resolve();
                });
            });
        });
    }
    
    // Add message to cache
    addMessage(msg) {
        if (!this.initialized || !msg.message) return null;
        
        return new Promise((resolve) => {
            try {
                const id = msg.key.id;
                const chatId = msg.key.remoteJid;
                const senderId = msg.key.participant || msg.key.remoteJid;
                const senderName = msg.pushName || 'Unknown';
                const timestamp = msg.messageTimestamp * 1000 || Date.now();
                const messageType = this.detectMessageType(msg);
                const textContent = this.extractText(msg);
                const isViewOnce = this.checkViewOnce(msg) ? 1 : 0;
                const messageData = JSON.stringify(msg);
                
                // Insert or replace
                this.db.run(`
                    INSERT OR REPLACE INTO messages 
                    (id, chatId, senderId, senderName, timestamp, messageType, textContent, isViewOnce, messageData)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [id, chatId, senderId, senderName, timestamp, messageType, textContent, isViewOnce, messageData], 
                (err) => {
                    if (err) {
                        console.error('Insert error:', err);
                        resolve(null);
                        return;
                    }
                    
                    this.stats.totalMessages++;
                    resolve({
                        id, chatId, senderId, senderName, timestamp, 
                        messageType, textContent, isViewOnce: isViewOnce === 1
                    });
                });
                
            } catch (error) {
                console.error('Cache add error:', error);
                resolve(null);
            }
        });
    }
    
    // Get message by ID
    getMessage(messageId, chatId = null) {
        if (!this.initialized) return Promise.resolve(null);
        
        return new Promise((resolve) => {
            let query = 'SELECT * FROM messages WHERE id = ?';
            const params = [messageId];
            
            if (chatId) {
                query += ' AND chatId = ?';
                params.push(chatId);
            }
            
            this.db.get(query, params, (err, row) => {
                if (err || !row) {
                    resolve(null);
                    return;
                }
                
                // Parse message data
                let message = null;
                try {
                    message = JSON.parse(row.messageData);
                } catch (e) {
                    console.error('Parse error:', e);
                }
                
                resolve({
                    id: row.id,
                    chatId: row.chatId,
                    senderId: row.senderId,
                    senderName: row.senderName,
                    timestamp: row.timestamp,
                    messageType: row.messageType,
                    textContent: row.textContent,
                    isViewOnce: row.isViewOnce === 1,
                    message: message
                });
            });
        });
    }
    
    // Delete message from cache
    deleteMessage(messageId) {
        if (!this.initialized) return Promise.resolve(false);
        
        return new Promise((resolve) => {
            this.db.run('DELETE FROM messages WHERE id = ?', [messageId], (err) => {
                resolve(!err);
            });
        });
    }
    
    // Cleanup messages older than 24 hours
    cleanupOldMessages() {
        if (!this.initialized) return;
        
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        this.db.run('DELETE FROM messages WHERE timestamp < ?', [oneDayAgo], (err) => {
            if (!err) {
                this.stats.lastCleanup = new Date().toISOString();
                this.db.get('SELECT changes() as cleaned', (err, row) => {
                    if (row && row.cleaned > 0) {
                        console.log(`🧹 SQLite cleaned ${row.cleaned} old messages`);
                    }
                });
            }
        });
    }
    
    // Get statistics
    getStats() {
        return new Promise((resolve) => {
            if (!this.initialized) {
                resolve({ ...this.stats, cacheSize: 0, uniqueChats: 0, viewOnceMessages: 0 });
                return;
            }
            
            this.db.all(`
                SELECT 
                    COUNT(*) as cacheSize,
                    COUNT(DISTINCT chatId) as uniqueChats,
                    SUM(isViewOnce) as viewOnceMessages
                FROM messages
            `, (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    resolve({ ...this.stats, cacheSize: 0, uniqueChats: 0, viewOnceMessages: 0 });
                    return;
                }
                
                resolve({
                    ...this.stats,
                    cacheSize: rows[0].cacheSize || 0,
                    uniqueChats: rows[0].uniqueChats || 0,
                    viewOnceMessages: rows[0].viewOnceMessages || 0
                });
            });
        });
    }
    
    // Helper methods
    detectMessageType(msg) {
        if (!msg.message) return 'unknown';
        if (msg.message.imageMessage) return 'image';
        if (msg.message.videoMessage) return 'video';
        if (msg.message.audioMessage) return 'audio';
        if (msg.message.documentMessage) return 'document';
        if (msg.message.stickerMessage) return 'sticker';
        if (msg.message.conversation || msg.message.extendedTextMessage) return 'text';
        return 'unknown';
    }
    
    checkViewOnce(msg) {
        return !!(
            msg.message?.imageMessage?.viewOnce ||
            msg.message?.videoMessage?.viewOnce ||
            msg.message?.audioMessage?.viewOnce ||
            msg.message?.viewOnceMessage
        );
    }
    
    extractText(msg) {
        if (!msg.message) return '';
        if (msg.message.conversation) return msg.message.conversation;
        if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
        if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
        if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;
        if (msg.message.documentMessage?.caption) return msg.message.documentMessage.caption;
        return '';
    }
    
    // Close database
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = MessageCache;
