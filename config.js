// Ego Bot - Environment-Aware Configuration

const fs = require('fs');
const path = require('path');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config();
}

// Determine environment
const ENV = process.env.NODE_ENV || 'development';

// Base configuration
const baseConfig = {
    version: '1.0.0',
    description: 'Custom single-server management bot',
    
    intents: [
        'Guilds',
        'GuildMembers',
        'GuildModeration',
        'GuildMessages',
        'GuildMessageReactions',
        'GuildVoiceStates',
        'GuildPresences',
        'MessageContent',
        'DirectMessages'
    ],
    
    database: {
        settings: './database/settings.json',
        users: './database/users.json',
        guild: './database/guild.json',
        logs: './database/logs.json',
        automod: './database/automod.json'
    },
    
    modules: {
        autoLoad: true,
        path: './modules/',
        enabled: []
    },
    
    defaults: {
        welcomeChannel: null,
        logChannel: null,
        modRole: null,
        adminRole: null,
        muteRole: null,
        autoRole: null,
        antiSpam: false,
        antiLink: false,
        levelSystem: false
    }
};

// Environment-specific overrides
const environments = {
    development: {
        name: 'Ego-Dev',
        prefix: 'E!',
        // Load from env or use defaults
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID,
        guildId: process.env.GUILD_ID,
        ownerId: process.env.OWNER_ID
    },
    
    production: {
        name: 'Ego',
        prefix: process.env.BOT_PREFIX || 'E!',
        // Production should always use env vars
        token: process.env.TOKEN,
        clientId: process.env.MCLIENT_ID,
        guildId: process.env.MGUILD_ID,
        ownerId: process.env.MOWNER_ID
    },
    
    // Hardcoded config option (no env needed)
    static: {
        name: 'Ego',
        prefix: 'E!',
        // EDIT THESE DIRECTLY:
        token: 'YOUR_BOT_TOKEN_HERE',      // ← Replace with your token
        clientId: 'YOUR_CLIENT_ID_HERE',   // ← Replace with your client ID
        guildId: 'YOUR_GUILD_ID_HERE',     // ← Replace with your guild ID
        ownerId: 'YOUR_USER_ID_HERE'       // ← Replace with your Discord ID
    }
};

// Merge base with environment config
const config = {
    ...baseConfig,
    ...environments[ENV],
    environment: ENV,
    
    validate() {
        const required = ['token', 'clientId', 'guildId'];
        const missing = required.filter(key => !this[key] || this[key].includes('YOUR_'));
        
        if (missing.length > 0) {
            console.error(`\n❌ [${ENV}] Configuration Error`);
            console.error('   Missing:', missing.join(', '));
            
            if (ENV === 'static') {
                console.error('\n   Edit config.js and replace the placeholder values');
            } else {
                console.error('\n   Set environment variables or switch to static mode:');
                console.error('   NODE_ENV=static node index.js');
            }
            return false;
        }
        return true;
    },
    
    get isDev() {
        return ENV === 'development';
    },
    
    get safeConfig() {
        return {
            environment: this.environment,
            name: this.name,
            version: this.version,
            prefix: this.prefix,
            guildId: this.guildId
        };
    }
};

// Validate
if (!config.validate()) {
    process.exit(1);
}

console.log(`[Config] Loaded ${ENV} configuration`);
module.exports = config;
