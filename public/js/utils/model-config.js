
window.ModelConfigUtils = window.ModelConfigUtils || {};

window.ModelConfigUtils.updateModelConfig = async function(modelId, configUpdates) {
    return window.ErrorHandler.safeAsync(async () => {
        const store = Alpine.store('global');

        const { response, newPassword } = await window.utils.request('/api/models/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId, config: configUpdates })
        }, store.webuiPassword);

        if (newPassword) {
            store.webuiPassword = newPassword;
        }

        if (!response.ok) {
            throw new Error(store.t('failedToUpdateModelConfig'));
        }

        const dataStore = Alpine.store('data');
        dataStore.modelConfig[modelId] = {
            ...dataStore.modelConfig[modelId],
            ...configUpdates
        };

        dataStore.computeQuotaRows();
    }, Alpine.store('global').t('failedToUpdateModelConfig'));
};
