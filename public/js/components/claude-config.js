
window.Components = window.Components || {};

window.Components.claudeConfig = () => ({
    config: { env: {} },
    configPath: '',
    models: [],
    loading: false,
    restoring: false,
    gemini1mSuffix: false,

    currentMode: 'proxy',
    modeLoading: false,

    getProxyPort() {
        const baseUrl = this.config?.env?.ANTHROPIC_BASE_URL || '';
        try {
            const url = new URL(baseUrl);
            return url.port || '8080';
        } catch {
            return '8080';
        }
    },

    presets: [],
    selectedPresetName: '',
    savingPreset: false,
    deletingPreset: false,
    pendingPresetName: '',
    newPresetName: '',

    geminiModelFields: [
        'ANTHROPIC_MODEL',
        'CLAUDE_CODE_SUBAGENT_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL'
    ],

    init() {

        if (this.$store.global.settingsTab === 'claude') {
            this.fetchConfig();
            this.fetchPresets();
            this.fetchMode();
        }

        this.$watch('$store.global.settingsTab', (tab, oldTab) => {
            if (tab === 'claude' && oldTab !== undefined) {
                this.fetchConfig();
                this.fetchPresets();
                this.fetchMode();
            }
        });

        this.$watch('$store.data.models', (val) => {
            this.models = val || [];
        });
        this.models = Alpine.store('data').models || [];
    },

    detectGemini1mSuffix() {
        for (const field of this.geminiModelFields) {
            const val = this.config.env[field];
            if (val && val.toLowerCase().includes('gemini') && val.includes('[1m]')) {
                return true;
            }
        }
        return false;
    },

    toggleGemini1mSuffix(enabled) {
        for (const field of this.geminiModelFields) {
            const val = this.config.env[field];

            if (val && /gemini/i.test(val)) {
                if (enabled && !val.includes('[1m]')) {
                    this.config.env[field] = val.trim() + '[1m]';
                } else if (!enabled && val.includes('[1m]')) {
                    this.config.env[field] = val.replace(/\s*\[1m\]$/i, '').trim();
                }
            }
        }
        this.gemini1mSuffix = enabled;
    },

    selectModel(field, modelId) {
        if (!this.config.env) this.config.env = {};

        let finalModelId = modelId;

        if (this.gemini1mSuffix && modelId.toLowerCase().includes('gemini')) {
            if (!finalModelId.includes('[1m]')) {
                finalModelId = finalModelId.trim() + '[1m]';
            }
        }

        this.config.env[field] = finalModelId;
    },

    async fetchConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.config = data.config || {};
            this.configPath = data.path || '~/.claude/settings.json'; 
            if (!this.config.env) this.config.env = {};

            if (this.config.env.ENABLE_EXPERIMENTAL_MCP_CLI === undefined) {
                this.config.env.ENABLE_EXPERIMENTAL_MCP_CLI = 'true';
            }

            const hasExistingSuffix = this.detectGemini1mSuffix();
            const hasGeminiModels = this.geminiModelFields.some(f =>
                this.config.env[f]?.toLowerCase().includes('gemini')
            );

            if (!hasExistingSuffix && hasGeminiModels) {
                this.toggleGemini1mSuffix(true);
            } else {
                this.gemini1mSuffix = hasExistingSuffix || !hasGeminiModels;
            }
        } catch (e) {
            console.error('Failed to fetch Claude config:', e);
        }
    },

    async saveClaudeConfig() {
        this.loading = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            Alpine.store('global').showToast(Alpine.store('global').t('claudeConfigSaved'), 'success');
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('saveConfigFailed') + ': ' + e.message, 'error');
        } finally {
            this.loading = false;
        }
    },

    restoreDefaultClaudeConfig() {
        document.getElementById('restore_defaults_modal').showModal();
    },

    async executeRestore() {
        this.restoring = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/config/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            Alpine.store('global').showToast(Alpine.store('global').t('claudeConfigRestored'), 'success');

            document.getElementById('restore_defaults_modal').close();

            await this.fetchConfig();
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('restoreConfigFailed') + ': ' + e.message, 'error');
        } finally {
            this.restoring = false;
        }
    },

    async fetchPresets() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/presets', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                
                if (this.presets.length > 0 && !this.selectedPresetName) {
                    this.selectedPresetName = this.presets[0].name;
                }
            }
        } catch (e) {
            console.error('Failed to fetch presets:', e);
        }
    },

    loadSelectedPreset() {
        const preset = this.presets.find(p => p.name === this.selectedPresetName);
        if (!preset) {
            return;
        }

        this.config.env = { ...this.config.env, ...preset.config };

        this.gemini1mSuffix = this.detectGemini1mSuffix();

        Alpine.store('global').showToast(
            Alpine.store('global').t('presetLoaded') || `Preset "${preset.name}" loaded. Click "Apply to Claude CLI" to save.`,
            'success'
        );
    },

    currentConfigMatchesPreset() {
        const relevantKeys = [
            'ANTHROPIC_BASE_URL',
            'ANTHROPIC_AUTH_TOKEN',
            'ANTHROPIC_MODEL',
            'CLAUDE_CODE_SUBAGENT_MODEL',
            'ANTHROPIC_DEFAULT_OPUS_MODEL',
            'ANTHROPIC_DEFAULT_SONNET_MODEL',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL',
            'ENABLE_EXPERIMENTAL_MCP_CLI'
        ];

        for (const preset of this.presets) {
            let matches = true;
            for (const key of relevantKeys) {
                const currentVal = this.config.env[key] || '';
                const presetVal = preset.config[key] || '';
                if (currentVal !== presetVal) {
                    matches = false;
                    break;
                }
            }
            if (matches) return true;
        }
        return false;
    },

    async onPresetSelect(newPresetName) {
        if (!newPresetName || newPresetName === this.selectedPresetName) return;

        const hasUnsavedChanges = !this.currentConfigMatchesPreset();

        if (hasUnsavedChanges) {
            
            this.pendingPresetName = newPresetName;
            document.getElementById('unsaved_changes_modal').showModal();
            return;
        }

        this.selectedPresetName = newPresetName;
        this.loadSelectedPreset();
    },

    confirmLoadPreset() {
        document.getElementById('unsaved_changes_modal').close();
        this.selectedPresetName = this.pendingPresetName;
        this.pendingPresetName = '';
        this.loadSelectedPreset();
    },

    cancelLoadPreset() {
        document.getElementById('unsaved_changes_modal').close();
        
        const select = document.querySelector('[aria-label="Select preset"]');
        if (select) select.value = this.selectedPresetName;
        this.pendingPresetName = '';
    },

    async saveCurrentAsPreset() {
        
        this.newPresetName = '';
        document.getElementById('save_preset_modal').showModal();
    },

    async executeSavePreset(name) {
        if (!name || !name.trim()) {
            Alpine.store('global').showToast(Alpine.store('global').t('presetNameRequired'), 'error');
            return;
        }

        this.savingPreset = true;
        const password = Alpine.store('global').webuiPassword;

        try {
            
            const relevantKeys = [
                'ANTHROPIC_BASE_URL',
                'ANTHROPIC_AUTH_TOKEN',
                'ANTHROPIC_MODEL',
                'CLAUDE_CODE_SUBAGENT_MODEL',
                'ANTHROPIC_DEFAULT_OPUS_MODEL',
                'ANTHROPIC_DEFAULT_SONNET_MODEL',
                'ANTHROPIC_DEFAULT_HAIKU_MODEL',
                'ENABLE_EXPERIMENTAL_MCP_CLI'
            ];
            const presetConfig = {};
            relevantKeys.forEach(k => {
                if (this.config.env[k]) {
                    presetConfig[k] = this.config.env[k];
                }
            });

            const { response, newPassword } = await window.utils.request('/api/claude/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), config: presetConfig })
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                this.selectedPresetName = name.trim();
                this.newPresetName = ''; 
                Alpine.store('global').showToast(
                    Alpine.store('global').t('presetSaved') || `Preset "${name}" saved`,
                    'success'
                );
                document.getElementById('save_preset_modal').close();
            } else {
                throw new Error(data.error || Alpine.store('global').t('saveFailed'));
            }
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('failedToSavePreset') + ': ' + e.message, 'error');
        } finally {
            this.savingPreset = false;
        }
    },

    async deleteSelectedPreset() {
        if (!this.selectedPresetName) {
            Alpine.store('global').showToast(Alpine.store('global').t('noPresetSelected'), 'warning');
            return;
        }

        const confirmMsg = Alpine.store('global').t('deletePresetConfirm', { name: this.selectedPresetName });
        if (!confirm(confirmMsg)) {
            return;
        }

        this.deletingPreset = true;
        const password = Alpine.store('global').webuiPassword;

        try {
            const { response, newPassword } = await window.utils.request(
                `/api/claude/presets/${encodeURIComponent(this.selectedPresetName)}`,
                { method: 'DELETE' },
                password
            );
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                
                this.selectedPresetName = this.presets.length > 0 ? this.presets[0].name : '';
                Alpine.store('global').showToast(
                    Alpine.store('global').t('presetDeleted') || 'Preset deleted',
                    'success'
                );
            } else {
                throw new Error(data.error || Alpine.store('global').t('deleteFailed'));
            }
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('failedToDeletePreset') + ': ' + e.message, 'error');
        } finally {
            this.deletingPreset = false;
        }
    },

    async fetchMode() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/mode', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.currentMode = data.mode;
            }
        } catch (e) {
            console.error('Failed to fetch mode:', e);
        }
    },

    async toggleMode(newMode) {
        if (this.modeLoading || newMode === this.currentMode) return;

        this.modeLoading = true;
        const password = Alpine.store('global').webuiPassword;

        try {
            const { response, newPassword } = await window.utils.request('/api/claude/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newMode })
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.status === 'ok') {
                this.currentMode = data.mode;
                if (data.config) {
                    this.config = data.config;
                    if (!this.config.env) this.config.env = {};
                }
                Alpine.store('global').showToast(data.message, 'success');

                await this.fetchConfig();
                await this.fetchMode();
            } else {
                throw new Error(data.error || 'Failed to switch mode');
            }
        } catch (e) {
            Alpine.store('global').showToast(
                (Alpine.store('global').t('modeToggleFailed') || 'Failed to switch mode') + ': ' + e.message,
                'error'
            );
        } finally {
            this.modeLoading = false;
        }
    }
});
