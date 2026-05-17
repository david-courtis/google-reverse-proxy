
window.DashboardFilters = window.DashboardFilters || {};

window.DashboardFilters.getInitialState = function() {
    return {
        timeRange: '24h',
        displayMode: 'model',
        selectedFamilies: [],
        selectedModels: {},
        showModelFilter: false,
        showTimeRangeDropdown: false,
        showDisplayModeDropdown: false
    };
};

window.DashboardFilters.loadPreferences = function(component) {
    try {
        const saved = localStorage.getItem('dashboard_chart_prefs');
        if (saved) {
            const prefs = JSON.parse(saved);
            component.timeRange = prefs.timeRange || '24h';
            component.displayMode = prefs.displayMode || 'model';
            component.selectedFamilies = prefs.selectedFamilies || [];
            component.selectedModels = prefs.selectedModels || {};
        }
    } catch (e) {
        if (window.UILogger) window.UILogger.debug('Failed to load dashboard preferences:', e.message);
    }
};

window.DashboardFilters.savePreferences = function(component) {
    try {
        localStorage.setItem('dashboard_chart_prefs', JSON.stringify({
            timeRange: component.timeRange,
            displayMode: component.displayMode,
            selectedFamilies: component.selectedFamilies,
            selectedModels: component.selectedModels
        }));
    } catch (e) {
        if (window.UILogger) window.UILogger.debug('Failed to save dashboard preferences:', e.message);
    }
};

window.DashboardFilters.setDisplayMode = function(component, mode) {
    component.displayMode = mode;
    component.showDisplayModeDropdown = false;
    window.DashboardFilters.savePreferences(component);

    component.updateTrendChart();
};

window.DashboardFilters.setTimeRange = function(component, range) {
    component.timeRange = range;
    component.showTimeRangeDropdown = false;
    window.DashboardFilters.savePreferences(component);
    component.updateTrendChart();
};

window.DashboardFilters.getTimeRangeCutoff = function(range) {
    const now = Date.now();
    switch (range) {
        case '1h': return now - 1 * 60 * 60 * 1000;
        case '6h': return now - 6 * 60 * 60 * 1000;
        case '24h': return now - 24 * 60 * 60 * 1000;
        case '7d': return now - 7 * 24 * 60 * 60 * 1000;
        default: return null;
    }
};

window.DashboardFilters.getFilteredHistoryData = function(component) {
    const history = component.historyData;
    if (!history || Object.keys(history).length === 0) return {};

    const cutoff = window.DashboardFilters.getTimeRangeCutoff(component.timeRange);
    if (!cutoff) return history;

    const filtered = {};
    Object.entries(history).forEach(([iso, data]) => {
        const timestamp = new Date(iso).getTime();
        if (timestamp >= cutoff) {
            filtered[iso] = data;
        }
    });
    return filtered;
};

window.DashboardFilters.getTimeRangeLabel = function(component) {
    const store = Alpine.store('global');
    switch (component.timeRange) {
        case '1h': return store.t('last1Hour');
        case '6h': return store.t('last6Hours');
        case '24h': return store.t('last24Hours');
        case '7d': return store.t('last7Days');
        default: return store.t('allTime');
    }
};

window.DashboardFilters.toggleFamily = function(component, family) {
    const index = component.selectedFamilies.indexOf(family);
    if (index > -1) {
        component.selectedFamilies.splice(index, 1);
    } else {
        component.selectedFamilies.push(family);
    }
    window.DashboardFilters.savePreferences(component);

    component.updateTrendChart();
};

window.DashboardFilters.toggleModel = function(component, family, model) {
    if (!component.selectedModels[family]) {
        component.selectedModels[family] = [];
    }
    const index = component.selectedModels[family].indexOf(model);
    if (index > -1) {
        component.selectedModels[family].splice(index, 1);
    } else {
        component.selectedModels[family].push(model);
    }
    window.DashboardFilters.savePreferences(component);

    component.updateTrendChart();
};

window.DashboardFilters.isFamilySelected = function(component, family) {
    return component.selectedFamilies.includes(family);
};

window.DashboardFilters.isModelSelected = function(component, family, model) {
    return component.selectedModels[family]?.includes(model) || false;
};

window.DashboardFilters.selectAll = function(component) {
    component.selectedFamilies = [...component.families];
    component.families.forEach(family => {
        component.selectedModels[family] = [...(component.modelTree[family] || [])];
    });
    window.DashboardFilters.savePreferences(component);

    component.updateTrendChart();
};

window.DashboardFilters.deselectAll = function(component) {
    component.selectedFamilies = [];
    component.selectedModels = {};
    window.DashboardFilters.savePreferences(component);

    component.updateTrendChart();
};

window.DashboardFilters.getFamilyColor = function(family) {
    const FAMILY_COLORS = window.DashboardConstants?.FAMILY_COLORS || {};
    return FAMILY_COLORS[family] || FAMILY_COLORS.other;
};

window.DashboardFilters.getModelColor = function(family, modelIndex) {
    const MODEL_COLORS = window.DashboardConstants?.MODEL_COLORS || [];
    const baseIndex = family === 'claude' ? 0 : (family === 'gemini' ? 4 : 8);
    return MODEL_COLORS[(baseIndex + modelIndex) % MODEL_COLORS.length];
};

window.DashboardFilters.getSelectedCount = function(component) {
    if (component.displayMode === 'family') {
        return `${component.selectedFamilies.length}/${component.families.length}`;
    }
    let selected = 0, total = 0;
    component.families.forEach(family => {
        const models = component.modelTree[family] || [];
        total += models.length;
        selected += (component.selectedModels[family] || []).length;
    });
    return `${selected}/${total}`;
};

window.DashboardFilters.autoSelectNew = function(component) {
    
    if (component.selectedFamilies.length === 0 && Object.keys(component.selectedModels).length === 0) {
        component.selectedFamilies = [...component.families];
        component.families.forEach(family => {
            component.selectedModels[family] = [...(component.modelTree[family] || [])];
        });
        window.DashboardFilters.savePreferences(component);
        return;
    }

    component.families.forEach(family => {
        if (!component.selectedFamilies.includes(family)) {
            component.selectedFamilies.push(family);
        }
        if (!component.selectedModels[family]) {
            component.selectedModels[family] = [];
        }
        (component.modelTree[family] || []).forEach(model => {
            if (!component.selectedModels[family].includes(model)) {
                component.selectedModels[family].push(model);
            }
        });
    });
};

window.DashboardFilters.autoSelectTopN = function(component, n = 5) {
    
    const usage = {};
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const vis = Alpine.store('data').modelVisibility || {};

    Object.entries(component.historyData).forEach(([iso, hourData]) => {
        const timestamp = new Date(iso).getTime();
        if (timestamp < dayAgo) return;

        Object.entries(hourData).forEach(([family, familyData]) => {
            if (typeof familyData === 'object' && family !== '_total') {
                Object.entries(familyData).forEach(([model, count]) => {
                    if (model !== '_subtotal' && vis[model] !== false) {
                        const key = `${family}:${model}`;
                        usage[key] = (usage[key] || 0) + count;
                    }
                });
            }
        });
    });

    const sorted = Object.entries(usage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);

    component.selectedFamilies = [];
    component.selectedModels = {};

    sorted.forEach(([key, _]) => {
        const [family, model] = key.split(':');
        if (!component.selectedFamilies.includes(family)) {
            component.selectedFamilies.push(family);
        }
        if (!component.selectedModels[family]) {
            component.selectedModels[family] = [];
        }
        if (!component.selectedModels[family].includes(model)) {
            component.selectedModels[family].push(model);
        }
    });

    window.DashboardFilters.savePreferences(component);
    
    component.updateTrendChart();
};
