
window.Components = window.Components || {};

window.Components.dashboard = () => ({

    stats: { total: 0, active: 0, limited: 0, overallHealth: 0, hasTrendData: false },
    hasFilteredTrendData: true,
    charts: { quotaDistribution: null, usageTrend: null },
    usageStats: { total: 0, today: 0, thisHour: 0 },
    historyData: {},
    modelTree: {},
    families: [],

    claudeConfigStatus: {
        needsApply: false,
        presetName: '',
        checked: false,
        lastCheckedAt: 0
    },

    ...window.DashboardFilters.getInitialState(),

    _debouncedUpdateTrendChart: null,

    init() {

        this._debouncedUpdateTrendChart = window.utils.debounce(() => {
            window.DashboardCharts.updateTrendChart(this);
        }, 300);

        window.DashboardFilters.loadPreferences(this);

        this.checkClaudeConfigStatus();

        this.$watch('$store.global.activeTab', (val, oldVal) => {
            if (val === 'dashboard' && oldVal !== undefined) {
                this.$nextTick(() => {
                    this.updateStats();
                    this.updateCharts();
                    this.updateTrendChart();
                    this.checkClaudeConfigStatus();
                });
            }
        });

        this.$watch('$store.data.accounts', () => {
            if (this.$store.global.activeTab === 'dashboard') {
                this.updateStats();

                if (this._debouncedUpdateCharts) {
                    this._debouncedUpdateCharts();
                } else {
                    this._debouncedUpdateCharts = window.utils.debounce(() => this.updateCharts(), 100);
                    this._debouncedUpdateCharts();
                }
            }
        });

        this.$watch('$store.data.usageHistory', (newHistory) => {
            if (this.$store.global.activeTab === 'dashboard' && newHistory && Object.keys(newHistory).length > 0) {

                if (this.historyData && JSON.stringify(newHistory) === JSON.stringify(this.historyData)) {
                    return;
                }

                this.historyData = newHistory;
                this.processHistory(newHistory);
                this.stats.hasTrendData = true;
            }
        });

        if (this.$store.global.activeTab === 'dashboard') {
            this.$nextTick(() => {
                this.updateStats();
                this.updateCharts();

                const history = Alpine.store('data').usageHistory;
                if (history && Object.keys(history).length > 0) {

                    if (!this.historyData || JSON.stringify(history) !== JSON.stringify(this.historyData)) {
                        this.historyData = history;
                        this.processHistory(history);
                        this.stats.hasTrendData = true;
                    }
                }
            });
        }
    },

    processHistory(history) {

        const tree = {};
        let total = 0, today = 0, thisHour = 0;

        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const currentHour = new Date(now);
        currentHour.setMinutes(0, 0, 0);

        Object.entries(history).forEach(([iso, hourData]) => {
            const timestamp = new Date(iso);

            Object.entries(hourData).forEach(([key, value]) => {

                if (key === '_total' || key === 'total') return;

                if (typeof value === 'object' && value !== null) {
                    const vis = Alpine.store('data').modelVisibility || {};

                    Object.keys(value).forEach(modelName => {
                        if (modelName === '_subtotal') return;
                        if (vis[modelName] === false) return;
                        if (!tree[key]) tree[key] = new Set();
                        tree[key].add(modelName);
                    });
                }
            });

            const hourTotal = hourData._total || hourData.total || 0;
            total += hourTotal;

            if (timestamp >= todayStart) {
                today += hourTotal;
            }
            if (timestamp.getTime() === currentHour.getTime()) {
                thisHour = hourTotal;
            }
        });

        this.usageStats = { total, today, thisHour };

        this.modelTree = {};
        Object.entries(tree).forEach(([family, models]) => {
            this.modelTree[family] = Array.from(models).sort();
        });
        this.families = Object.keys(this.modelTree).sort();

        this.autoSelectNew();

        this.updateTrendChart();
    },

    updateStats() {
        window.DashboardStats.updateStats(this);
    },

    updateCharts() {
        window.DashboardCharts.updateCharts(this);
    },

    updateTrendChart() {

        if (this._debouncedUpdateTrendChart) {
            this._debouncedUpdateTrendChart();
        } else {

            window.DashboardCharts.updateTrendChart(this);
        }
    },

    loadPreferences() {
        window.DashboardFilters.loadPreferences(this);
    },

    savePreferences() {
        window.DashboardFilters.savePreferences(this);
    },

    setDisplayMode(mode) {
        window.DashboardFilters.setDisplayMode(this, mode);
    },

    setTimeRange(range) {
        window.DashboardFilters.setTimeRange(this, range);
    },

    getTimeRangeLabel() {
        return window.DashboardFilters.getTimeRangeLabel(this);
    },

    toggleFamily(family) {
        window.DashboardFilters.toggleFamily(this, family);
    },

    toggleModel(family, model) {
        window.DashboardFilters.toggleModel(this, family, model);
    },

    isFamilySelected(family) {
        return window.DashboardFilters.isFamilySelected(this, family);
    },

    isModelSelected(family, model) {
        return window.DashboardFilters.isModelSelected(this, family, model);
    },

    selectAll() {
        window.DashboardFilters.selectAll(this);
    },

    deselectAll() {
        window.DashboardFilters.deselectAll(this);
    },

    getFamilyColor(family) {
        return window.DashboardFilters.getFamilyColor(family);
    },

    getModelColor(family, modelIndex) {
        return window.DashboardFilters.getModelColor(family, modelIndex);
    },

    getSelectedCount() {
        return window.DashboardFilters.getSelectedCount(this);
    },

    autoSelectNew() {
        window.DashboardFilters.autoSelectNew(this);
    },

    autoSelectTopN(n = 5) {
        window.DashboardFilters.autoSelectTopN(this, n);
    },

    async checkClaudeConfigStatus() {
        const now = Date.now();
        if (this.claudeConfigStatus.checked && now - this.claudeConfigStatus.lastCheckedAt < 30000) return;

        try {
            const password = Alpine.store('global').webuiPassword;

            const [configRes, presetsRes] = await Promise.all([
                window.utils.request('/api/claude/config', {}, password),
                window.utils.request('/api/claude/presets', {}, password)
            ]);

            if (!configRes.response.ok || !presetsRes.response.ok) {
                this.claudeConfigStatus.checked = true;
                this.claudeConfigStatus.lastCheckedAt = now;
                return;
            }

            const configData = await configRes.response.json();
            const presetsData = await presetsRes.response.json();

            const localConfig = configData.config || { env: {} };
            const presets = presetsData.presets || [];

            if (presets.length === 0) {
                this.claudeConfigStatus = { needsApply: false, presetName: '', checked: true, lastCheckedAt: now };
                return;
            }

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

            const matchesAnyPreset = presets.some(preset => {
                return relevantKeys.every(key => {
                    const localVal = localConfig.env?.[key] || '';
                    const presetVal = preset.config?.[key] || '';
                    return localVal === presetVal;
                });
            });

            this.claudeConfigStatus = {
                needsApply: !matchesAnyPreset,
                presetName: presets[0].name,
                checked: true,
                lastCheckedAt: now
            };
        } catch (e) {
            console.error('Failed to check Claude config status:', e);
            this.claudeConfigStatus.checked = true;
            this.claudeConfigStatus.lastCheckedAt = Date.now();
        }
    },

    goToClaudeSettings() {
        this.$store.global.activeTab = 'settings';
        this.$store.global.settingsTab = 'claude';
    }
});
