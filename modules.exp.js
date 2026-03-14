// modules/my-feature.js
class MyFeature {
    constructor(client) {
        this.client = client;
    }
    
    init() {
        // Setup code runs when bot starts
    }
    
    onMessage(message) {
        // Handle every message
    }
    
    onCommand(command, args, message) {
        // Handle prefix commands
    }
    
    onMemberJoin(member) {
        // Handle new members
    }
    
    // Available events:
    // onMessage, onCommand, onSlashCommand, onButton, onSelectMenu, onModal
    // onMemberJoin, onMemberLeave, onMessageDelete, onMessageEdit
    // onReactionAdd, onVoiceUpdate
    
    destroy() {
        // Cleanup when module reloads/unloads
    }
}

module.exports = MyFeature;
