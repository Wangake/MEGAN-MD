// src/lib/GroupUtils.js - Group management with proper admin checks
class GroupUtils {
    constructor(bot) {
        this.bot = bot;
        this.logger = bot.logger;
    }

    // Extract phone number from any JID format
    extractPhone(jid) {
        if (!jid) return '';
        
        // Remove @s.whatsapp.net or @lid suffix
        const phone = jid.split('@')[0];
        
        // Remove any non-digits
        return phone.replace(/\D/g, '');
    }

    // Normalize JID to standard format for comparison
    normalizeJid(jid) {
        if (!jid) return '';
        
        const phone = this.extractPhone(jid);
        if (!phone) return jid;
        
        return phone + '@s.whatsapp.net';
    }

    // Check if user is admin in group (silent check)
    async isAdmin(groupJid, userJid) {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            const normalizedUserJid = this.normalizeJid(userJid);
            
            const participant = metadata.participants.find(p => {
                const normalizedParticipantJid = this.normalizeJid(p.id);
                return normalizedParticipantJid === normalizedUserJid;
            });
            
            return participant && ['admin', 'superadmin'].includes(participant.admin);
        } catch (error) {
            // Silent fail - don't log to avoid spam
            return false;
        }
    }

    // Check if bot is admin
    async isBotAdmin(groupJid) {
        const botJid = this.bot.sock.user.id;
        return await this.isAdmin(groupJid, botJid);
    }

    // Get group metadata
    async getGroupInfo(groupJid) {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            return {
                id: metadata.id,
                subject: metadata.subject,
                desc: metadata.desc || 'No description',
                size: metadata.participants.length,
                creation: metadata.creation,
                owner: metadata.owner,
                restrict: metadata.restrict,
                announce: metadata.announce,
                participants: metadata.participants
            };
        } catch (error) {
            return null;
        }
    }

    // Check if sender is owner (with LID support)
    async isOwner(senderJid) {
        const ownerJid = this.bot.config.OWNER_PHONE;
        
        // Extract phone numbers for comparison
        const senderPhone = this.extractPhone(senderJid);
        const ownerPhone = this.extractPhone(ownerJid);
        
        // Also check if sender matches bot user (when bot sends messages to itself)
        const botPhone = this.extractPhone(this.bot.sock.user?.id);
        
        return senderPhone === ownerPhone || senderPhone === botPhone;
    }

    // Tag admins silently
    async getAdmins(groupJid) {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            return metadata.participants
                .filter(p => ['admin', 'superadmin'].includes(p.admin))
                .map(p => p.id);
        } catch (error) {
            return [];
        }
    }

    // Tag all members
    async getAllMembers(groupJid) {
        try {
            const metadata = await this.bot.sock.groupMetadata(groupJid);
            return metadata.participants.map(p => p.id);
        } catch (error) {
            return [];
        }
    }

    // Format phone to JID
    formatJid(phone) {
        if (!phone) return null;
        
        // If already a JID, return normalized version
        if (phone.includes('@')) {
            return this.normalizeJid(phone);
        }
        
        // Remove non-digits
        phone = phone.replace(/\D/g, '');
        
        // Add country code if missing (Kenya default)
        if (!phone.startsWith('254') && phone.length === 9) {
            phone = '254' + phone;
        }
        
        return phone + '@s.whatsapp.net';
    }
}

module.exports = GroupUtils;
