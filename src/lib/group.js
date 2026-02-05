// src/lib/group.js - Group Management Utilities
class GroupUtils {
    constructor(bot) {
        this.bot = bot;
        this.logger = bot.logger;
    }

    // Format phone to JID
    formatJid(phone) {
        if (!phone) return null;
        
        // If already a JID, return as is
        if (phone.includes('@')) return phone;
        
        // Remove non-digits
        phone = phone.replace(/\D/g, '');
        
        // Add country code if missing
        if (!phone.startsWith('254') && phone.length === 9) {
            phone = '254' + phone;
        }
        
        return phone + '@s.whatsapp.net';
    }

    // Check if user is admin in group
    async isAdmin(groupJid, userJid) {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            const participant = metadata.participants.find(p => p.id === userJid);
            return participant && ['admin', 'superadmin'].includes(participant.admin);
        } catch (error) {
            this.logger.log(`Failed to check admin status: ${error.message}`, 'warning');
            return false;
        }
    }

    // Check if bot is admin
    async isBotAdmin(groupJid) {
        const botJid = this.bot.sock.user.id;
        return await this.isAdmin(groupJid, botJid);
    }

    // Get mentioned users from message
    getMentionedUsers(msg) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quotedMentioned = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        
        return [...new Set([...mentioned, ...quotedMentioned])].filter(Boolean);
    }

    // Create VCF contact card
    createVCard(name, phone, org = '') {
        const formattedPhone = phone.replace(/\D/g, '');
        
        return `BEGIN:VCARD
VERSION:3.0
FN:${name}
${org ? `ORG:${org};\n` : ''}TEL;type=CELL;type=VOICE;waid=${formattedPhone}:+${formattedPhone}
END:VCARD`;
    }

    // Tag all members in group
    async tagAll(groupJid, message = '') {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            const participants = metadata.participants.map(p => p.id);
            
            let tagMessage = message || `📢 *Attention All Members!*\n\n`;
            
            participants.forEach((participant, index) => {
                tagMessage += `@${participant.split('@')[0]} `;
                if ((index + 1) % 5 === 0) tagMessage += '\n';
            });
            
            return {
                success: true,
                message: tagMessage,
                mentions: participants
            };
            
        } catch (error) {
            this.logger.log(`Tag all error: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Tag only admins
    async tagAdmins(groupJid, message = '') {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
            
            if (admins.length === 0) {
                return {
                    success: false,
                    error: 'No admins in this group'
                };
            }
            
            let tagMessage = message || `👑 *Attention Admins!*\n\n`;
            
            admins.forEach((admin, index) => {
                tagMessage += `@${admin.split('@')[0]} `;
                if ((index + 1) % 5 === 0) tagMessage += '\n';
            });
            
            return {
                success: true,
                message: tagMessage,
                mentions: admins
            };
            
        } catch (error) {
            this.logger.log(`Tag admins error: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Promote users to admin
    async promoteUsers(groupJid, users) {
        try {
            // Check if bot is admin
            if (!await this.isBotAdmin(groupJid)) {
                return {
                    success: false,
                    error: 'Bot needs to be admin to promote users'
                };
            }
            
            await this.bot.sock.groupParticipantsUpdate(groupJid, users, 'promote');
            
            return {
                success: true,
                promoted: users.length
            };
            
        } catch (error) {
            this.logger.log(`Promote error: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Demote admins
    async demoteUsers(groupJid, users) {
        try {
            if (!await this.isBotAdmin(groupJid)) {
                return {
                    success: false,
                    error: 'Bot needs to be admin to demote users'
                };
            }
            
            await this.bot.sock.groupParticipantsUpdate(groupJid, users, 'demote');
            
            return {
                success: true,
                demoted: users.length
            };
            
        } catch (error) {
            this.logger.log(`Demote error: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get group invite link
    async getInviteLink(groupJid) {
        try {
            const code = await this.bot.sock.groupInviteCode(groupJid);
            return {
                success: true,
                link: `https://chat.whatsapp.com/${code}`
            };
        } catch (error) {
            this.logger.log(`Invite link error: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Create announcement
    async createAnnouncement(groupJid, message, mentionAll = false) {
        try {
            let finalMessage = message;
            let mentions = [];
            
            if (mentionAll) {
                const metadata = await this.bot.sock.groupMetadata(groupJid);
                mentions = metadata.participants.map(p => p.id);
                finalMessage = `📢 *ANNOUNCEMENT*\n\n${message}`;
            }
            
            return {
                success: true,
                message: finalMessage,
                mentions: mentions
            };
            
        } catch (error) {
            this.logger.log(`Announcement error: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = GroupUtils;
