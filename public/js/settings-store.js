
document.addEventListener('alpine:init', () => {
    Alpine.store('settings', {
        refreshInterval: 60,
        logLimit: 2000,
        showExhausted: true,
        showHiddenModels: false,
        showAllAccounts: false,
        showConfigWarning: true,
        compact: false,
        showInfoToasts: false,
        redactMode: false,
        placeholderMode: false,
        placeholderIncludeReal: true,
        debugLogging: true,
        logExport: true,
        healthInspector: true,
        healthInspectorOpen: false,
        port: 8080,

        init() {
            this.loadSettings();
        },

        toggle(key) {
            if (this.hasOwnProperty(key) && typeof this[key] === 'boolean') {
                this[key] = !this[key];
                this.saveSettings(true);
            }
        },

        loadSettings() {
            const saved = localStorage.getItem('google_reverse_proxy_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(parsed).forEach(k => {

                    if (this.hasOwnProperty(k)) this[k] = parsed[k];
                });
            }
        },

        saveSettings(silent = false) {
            const toSave = {
                refreshInterval: this.refreshInterval,
                logLimit: this.logLimit,
                showExhausted: this.showExhausted,
                showHiddenModels: this.showHiddenModels,
                showAllAccounts: this.showAllAccounts,
                showConfigWarning: this.showConfigWarning,
                compact: this.compact,
                redactMode: this.redactMode,
                placeholderMode: this.placeholderMode,
                placeholderIncludeReal: this.placeholderIncludeReal,
                debugLogging: this.debugLogging,
                logExport: this.logExport,
                healthInspector: this.healthInspector,
                healthInspectorOpen: this.healthInspectorOpen
            };
            localStorage.setItem('google_reverse_proxy_settings', JSON.stringify(toSave));

            if (!silent) {
                const store = Alpine.store('global');
                store.showToast(store.t('configSaved'), 'success');
            }

            document.dispatchEvent(new CustomEvent('refresh-interval-changed'));
            if (Alpine.store('data')) {
                Alpine.store('data').computeQuotaRows();
            }
        }
    });
});
