
window.Redact = {
    email(email) {
        if (!Alpine.store('settings').redactMode) return email;
        if (!email) return email;
        const accounts = Alpine.store('data')?.accounts || [];

        const idx = accounts.findIndex(a => a.email === email || (a.email && a.email.split('@')[0] === email));
        return idx >= 0 ? `Account ${idx + 1}` : 'Account';
    },

    logMessage(message) {
        if (!Alpine.store('settings').redactMode) return message;
        const accounts = Alpine.store('data')?.accounts || [];
        let result = message;
        accounts.forEach((acc, idx) => {
            if (!acc.email) return;
            const escaped = acc.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(escaped, 'g'), `Account ${idx + 1}`);
            const user = acc.email.split('@')[0];
            if (user) {
                const escapedUser = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                result = result.replace(new RegExp(`\\b${escapedUser}\\b`, 'g'), `Account ${idx + 1}`);
            }
        });
        return result;
    },

    escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    logHtml(message) {
        return this.escapeHtml(this.logMessage(message)).replace(/\n/g, '<br>');
    }
};
