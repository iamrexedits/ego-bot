/**
 * Moderation Module
 * Handles kick, ban, mute, warn, and message purging
 */

class ModerationModule {
    constructor(client) {
        this.client = client;
        this.name = 'moderation';
        this.storage = null;
        this.config = null;
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        console.log(`[${this.name}] Moderation system ready`);
    }

    onCommand(command, args, message) {
        switch(command) {
            case 'kick':
                this.handleKick(message, args);
                break;
            case 'ban':
                this.handleBan(message, args);
                break;
            case 'purge':
                this.handlePurge(message, args);
                break;
            case 'warn':
                this.handleWarn(message, args);
                break;
        }
    }

    async handleKick(message, args) {
        if (!message.member.permissions.has('KickMembers')) {
            return message.reply('❌ You lack permission to kick members.');
        }
        
        const target = message.mentions.members.first();
        if (!target) return message.reply('Please mention a user to kick.');
        
        const reason = args.slice(1).join(' ') || 'No reason provided';
        
        try {
            await target.kick(reason);
            message.reply(`👢 Kicked ${target.user.tag} | Reason: ${reason}`);
            
            // Log to database
            const warnings = this.storage.users.get(`${target.id}.warnings`, []);
            warnings.push({ type: 'kick', reason, date: new Date().toISOString(), by: message.author.id });
            this.storage.users.set(`${target.id}.warnings`, warnings);
        } catch (error) {
            message.reply('❌ Failed to kick user.');
        }
    }

    async handlePurge(message, args) {
        if (!message.member.permissions.has('ManageMessages')) return;
        
        const amount = parseInt(args[0]);
        if (!amount || amount < 1 || amount > 100) {
            return message.reply('Please provide a number between 1-100.');
        }
        
        try {
            await message.channel.bulkDelete(amount + 1);
            const msg = await message.channel.send(`🗑️ Deleted ${amount} messages.`);
            setTimeout(() => msg.delete(), 3000);
        } catch (error) {
            message.reply('❌ Failed to delete messages.');
        }
    }

    async handleWarn(message, args) {
        const target = message.mentions.members.first();
        if (!target) return message.reply('Please mention a user to warn.');
        
        const reason = args.slice(1).join(' ') || 'No reason provided';
        
        // Store warning
        const userData = this.storage.users.get(target.id, {});
        if (!userData.warnings) userData.warnings = [];
        userData.warnings.push({
            reason,
            date: new Date().toISOString(),
            by: message.author.id
        });
        
        this.storage.users.set(target.id, userData);
        
        message.reply(`⚠️ Warned ${target.user.tag} | Reason: ${reason} | Total warnings: ${userData.warnings.length}`);
    }

    destroy() {
        console.log(`[${this.name}] Module unloaded`);
    }
}

module.exports = ModerationModule;
