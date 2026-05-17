
document.addEventListener('alpine:init', () => {
    Alpine.store('data', {
        accounts: [],
        models: [],
        modelConfig: {},
        modelVisibility: {},
        quotaRows: [],
        usageHistory: {},
        globalQuotaThreshold: 0,
        maxAccounts: 10,
        devMode: false,
        placeholderMode: false,
        placeholderIncludeReal: true,
        _realAccounts: null,
        _realModels: null,
        loading: false,
        initialLoad: true,
        connectionStatus: 'connecting',
        lastUpdated: '-',
        healthCheckTimer: null,

        filters: {
            account: 'all',
            family: 'all',
            search: '',
            sortCol: 'avgQuota',
            sortAsc: true
        },

        init() {

            this.loadFromCache();

            try {
                const saved = JSON.parse(localStorage.getItem('google_reverse_proxy_settings') || '{}');
                if (saved.placeholderMode) {
                    this.setPlaceholderMode(true, saved.placeholderIncludeReal !== false);
                }
            } catch (e) {  }

            this.startHealthCheck();
        },

        loadFromCache() {
            try {
                const cached = localStorage.getItem('google_reverse_proxy_cache');
                if (cached) {
                    const data = JSON.parse(cached);
                    const CACHE_TTL = 24 * 60 * 60 * 1000;

                    if (data.timestamp && (Date.now() - data.timestamp > CACHE_TTL)) {
                        if (window.UILogger) window.UILogger.debug('Cache expired, skipping restoration');
                        localStorage.removeItem('google_reverse_proxy_cache');
                        return;
                    }

                    if (data.accounts && data.models) {
                        this.accounts = data.accounts;
                        this.models = data.models;
                        this.modelConfig = data.modelConfig || {};
                        this.modelVisibility = data.modelVisibility || {};
                        this.usageHistory = data.usageHistory || {};

                        this.initialLoad = false;
                        this.computeQuotaRows();
                        if (window.UILogger) window.UILogger.debug('Restored data from cache');
                    }
                }
            } catch (e) {
                if (window.UILogger) window.UILogger.debug('Failed to load cache', e.message);
            }
        },

        saveToCache() {
            try {
                const cacheData = {
                    accounts: this.accounts,
                    models: this.models,
                    modelConfig: this.modelConfig,
                    modelVisibility: this.modelVisibility,
                    usageHistory: this.usageHistory,
                    timestamp: Date.now()
                };
                localStorage.setItem('google_reverse_proxy_cache', JSON.stringify(cacheData));
            } catch (e) {
                if (window.UILogger) window.UILogger.debug('Failed to save cache', e.message);
            }
        },

        async fetchData() {
            const seq = (this._fetchSeq = (this._fetchSeq || 0) + 1);

            if (this.initialLoad) {
                this.loading = true;
            }
            try {

                const password = Alpine.store('global').webuiPassword;

                const url = '/account-limits?includeHistory=true';
                const { response, newPassword } = await window.utils.request(url, {}, password);

                if (newPassword) Alpine.store('global').webuiPassword = newPassword;

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                if (seq !== this._fetchSeq) return;
                this.accounts = data.accounts || [];
                if (data.models && data.models.length > 0) {
                    this.models = data.models;
                }
                this.modelConfig = data.modelConfig || {};
                this.modelVisibility = data.modelVisibility || {};
                this.globalQuotaThreshold = data.globalQuotaThreshold || 0;

                if (data.history) {
                    this.usageHistory = data.history;
                }

                this.saveToCache(); 

                if (this.placeholderMode) {
                    this._realAccounts = [...this.accounts];
                    this._realModels = [...this.models];
                    const { accounts: fakeAccounts, models: fakeModels } = this._generatePlaceholderData();
                    if (this.placeholderIncludeReal) {
                        this.accounts = [...this._realAccounts, ...fakeAccounts];
                        const modelSet = new Set([...this._realModels, ...fakeModels]);
                        this.models = Array.from(modelSet).sort();
                    } else {
                        this.accounts = fakeAccounts;
                        this.models = fakeModels;
                    }
                }

                this.computeQuotaRows();

                this.lastUpdated = new Date().toLocaleTimeString();
            } catch (error) {
                if (seq !== this._fetchSeq) return;
                console.error('Fetch error:', error);
                const store = Alpine.store('global');
                store.showToast(store.t('connectionLost'), 'error');
            } finally {
                if (seq === this._fetchSeq) {
                    this.loading = false;
                    this.initialLoad = false;
                }
            }
        },

        async performHealthCheck() {
            try {
                
                const password = Alpine.store('global').webuiPassword;

                const { response, newPassword } = await window.utils.request('/api/config', {}, password);

                if (newPassword) Alpine.store('global').webuiPassword = newPassword;

                if (response.ok) {
                    this.connectionStatus = 'connected';
                    
                    try {
                        const data = await response.json();
                        if (data.config) {
                            this.devMode = !!data.config.devMode;
                        }
                    } catch (e) {  }
                } else {
                    this.connectionStatus = 'disconnected';
                }
            } catch (error) {
                console.error('Health check error:', error);
                this.connectionStatus = 'disconnected';
            }
        },

        startHealthCheck() {
            
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
            }

            if (!this._healthVisibilitySetup) {
                this._healthVisibilitySetup = true;
                this._visibilityHandler = () => {
                    if (document.hidden) {
                        
                        this.stopHealthCheck();
                    } else {
                        
                        this.startHealthCheck();
                    }
                };
                document.addEventListener('visibilitychange', this._visibilityHandler);
            }

            this.performHealthCheck();

            this.healthCheckTimer = setInterval(() => {
                
                if (!document.hidden) {
                    this.performHealthCheck();
                }
            }, 15000);
        },

        stopHealthCheck() {
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = null;
            }
        },

        computeQuotaRows() {
            const models = this.models || [];
            const rows = [];
            const showExhausted = Alpine.store('settings')?.showExhausted ?? true;

            models.forEach(modelId => {
                
                const config = this.modelConfig[modelId] || {};
                const family = this.getModelFamily(modelId);

                let isHidden = config.hidden;
                if (isHidden === undefined) {
                    isHidden = (family === 'other' || family === 'unknown');
                }

                const showHidden = Alpine.store('settings')?.showHiddenModels ?? false;
                if (isHidden && !showHidden) return;

                if (this.filters.family !== 'all' && this.filters.family !== family) return;
                if (this.filters.search) {
                    const searchLower = this.filters.search.toLowerCase();
                    const idMatch = modelId.toLowerCase().includes(searchLower);
                    if (!idMatch) return;
                }

                const quotaInfo = [];
                let minQuota = 100;
                let totalQuotaSum = 0;
                let validAccountCount = 0;
                let minResetTime = null;
                let maxEffectiveThreshold = 0;
                const globalThreshold = this.globalQuotaThreshold || 0;

                this.accounts.forEach(acc => {
                    if (acc.enabled === false) return;
                    if (this.filters.account !== 'all' && acc.email !== this.filters.account) return;

                    const limit = acc.limits?.[modelId];
                    if (!limit) return;

                    const pct = limit.remainingFraction !== null ? Math.round(limit.remainingFraction * 100) : 0;
                    minQuota = Math.min(minQuota, pct);

                    totalQuotaSum += pct;
                    validAccountCount++;

                    if (limit.resetTime && (!minResetTime || new Date(limit.resetTime) < new Date(minResetTime))) {
                        minResetTime = limit.resetTime;
                    }

                    const accModelThreshold = acc.modelQuotaThresholds?.[modelId];
                    const accThreshold = acc.quotaThreshold;
                    const effective = accModelThreshold ?? accThreshold ?? globalThreshold;
                    if (effective > maxEffectiveThreshold) {
                        maxEffectiveThreshold = effective;
                    }

                    let thresholdSource = 'global';
                    if (accModelThreshold !== undefined) thresholdSource = 'model';
                    else if (accThreshold !== undefined) thresholdSource = 'account';

                    quotaInfo.push({
                        email: acc.email.split('@')[0],
                        fullEmail: acc.email,
                        pct: pct,
                        resetTime: limit.resetTime,
                        thresholdPct: Math.round(effective * 100),
                        thresholdSource
                    });
                });

                if (quotaInfo.length === 0) return;
                const avgQuota = validAccountCount > 0 ? Math.round(totalQuotaSum / validAccountCount) : 0;

                if (!showExhausted && minQuota === 0) return;

                const uniqueThresholds = new Set(quotaInfo.map(q => q.thresholdPct));
                const hasVariedThresholds = uniqueThresholds.size > 1;

                rows.push({
                    modelId,
                    displayName: modelId, 
                    family,
                    minQuota,
                    avgQuota, 
                    minResetTime,
                    resetIn: minResetTime ? window.utils.formatTimeUntil(minResetTime) : '-',
                    quotaInfo,
                    pinned: !!config.pinned,
                    hidden: !!isHidden, 
                    activeCount: quotaInfo.filter(q => q.pct > 0).length,
                    effectiveThresholdPct: Math.round(maxEffectiveThreshold * 100),
                    hasVariedThresholds
                });
            });

            const sortCol = this.filters.sortCol;
            const sortAsc = this.filters.sortAsc;

            this.quotaRows = rows.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

                let valA = a[sortCol];
                let valB = b[sortCol];

                if (valA === valB) return 0;
                if (valA === null || valA === undefined) return 1;
                if (valB === null || valB === undefined) return -1;

                if (typeof valA === 'string' && typeof valB === 'string') {
                    return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }

                return sortAsc ? valA - valB : valB - valA;
            });

        },

        setSort(col) {
            if (this.filters.sortCol === col) {
                this.filters.sortAsc = !this.filters.sortAsc;
            } else {
                this.filters.sortCol = col;
                
                if (['avgQuota', 'activeCount'].includes(col)) {
                    this.filters.sortAsc = false;
                } else {
                    this.filters.sortAsc = true;
                }
            }
            this.computeQuotaRows();
        },

        getModelFamily(modelId) {
            const lower = modelId.toLowerCase();
            if (lower.includes('claude')) return 'claude';
            if (lower.includes('gemini')) return 'gemini';
            return 'other';
        },

        getUnfilteredQuotaData() {
            const models = this.models || [];
            const rows = [];
            const showHidden = Alpine.store('settings')?.showHiddenModels ?? false;

            models.forEach(modelId => {
                const config = this.modelConfig[modelId] || {};
                const family = this.getModelFamily(modelId);

                let isHidden = config.hidden;
                if (isHidden === undefined) {
                    isHidden = (family === 'other' || family === 'unknown');
                }
                if (isHidden && !showHidden) return;

                const quotaInfo = [];
                
                this.accounts.forEach(acc => {
                    if (acc.enabled === false) return;
                    const limit = acc.limits?.[modelId];
                    if (!limit) return;
                    const pct = limit.remainingFraction !== null ? Math.round(limit.remainingFraction * 100) : 0;
                    quotaInfo.push({ pct });
                });

                rows.push({ modelId, family, quotaInfo });
            });

            return rows;
        },

        _generatePlaceholderData() {
            const models = [
                'claude-opus-4-6-thinking',
                'claude-sonnet-4-6-thinking',
                'claude-sonnet-4-6',
                'gemini-3.1-pro-high',
                'gemini-3.1-pro-low',
                'gemini-3-flash'
            ];

            const tiers = ['ultra', 'pro', 'pro', 'free'];
            const names = ['alice', 'bob', 'charlie', 'diana'];
            const domains = ['workspace.dev', 'company.io', 'example.org', 'test.net'];

            const accounts = names.map((name, i) => {
                const email = `${name}@${domains[i]}`;
                const tier = tiers[i];

                const limits = {};
                models.forEach((modelId, mi) => {
                    
                    const seed = ((i * 7 + mi * 13) % 100);
                    const fraction = seed < 10 ? 0 : seed / 100;
                    const resetTime = fraction === 0
                        ? new Date(Date.now() + (30 + i * 15) * 60000).toISOString()
                        : null;
                    limits[modelId] = {
                        remaining: Math.round(fraction * 100) + '%',
                        remainingFraction: fraction,
                        resetTime
                    };
                });

                return {
                    email,
                    status: i === 3 ? 'invalid' : 'ok',
                    error: i === 3 ? 'Token expired' : null,
                    source: i === 0 ? 'database' : 'oauth',
                    enabled: i !== 2 ? true : false,
                    projectId: `proj-${name}-${1000 + i}`,
                    isInvalid: i === 3,
                    invalidReason: i === 3 ? 'Token expired' : null,
                    lastUsed: new Date(Date.now() - i * 3600000).toISOString(),
                    modelRateLimits: {},
                    quotaThreshold: i === 1 ? 0.15 : undefined,
                    modelQuotaThresholds: i === 0 ? { 'claude-opus-4-6-thinking': 0.25 } : {},
                    subscription: { tier, projectId: `proj-${name}-${1000 + i}`, detectedAt: Date.now() },
                    limits
                };
            });

            return { accounts, models };
        },

        setPlaceholderMode(enabled, includeReal) {
            this.placeholderMode = enabled;
            this.placeholderIncludeReal = includeReal;

            const settings = Alpine.store('settings');
            if (settings) {
                settings.placeholderMode = enabled;
                settings.placeholderIncludeReal = includeReal;
                settings.saveSettings(true);
            }

            if (enabled) {
                
                this._realAccounts = [...this.accounts];
                this._realModels = [...this.models];

                const { accounts: fakeAccounts, models: fakeModels } = this._generatePlaceholderData();

                if (includeReal && this._realAccounts.length > 0) {
                    
                    this.accounts = [...this._realAccounts, ...fakeAccounts];
                    
                    const modelSet = new Set([...this._realModels, ...fakeModels]);
                    this.models = Array.from(modelSet).sort();
                } else {
                    this.accounts = fakeAccounts;
                    this.models = fakeModels;
                }
            } else {
                
                if (this._realAccounts !== null) {
                    this.accounts = this._realAccounts;
                    this._realAccounts = null;
                }
                if (this._realModels !== null) {
                    this.models = this._realModels;
                    this._realModels = null;
                }
            }

            this.computeQuotaRows();
        }
    });
});
