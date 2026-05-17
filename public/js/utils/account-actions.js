
window.AccountActions = window.AccountActions || {};

window.AccountActions.refreshAccount = async function(email) {
    const store = Alpine.store('global');

    try {
        const { response, newPassword } = await window.utils.request(
            `/api/accounts/${encodeURIComponent(email)}/refresh`,
            { method: 'POST' },
            store.webuiPassword
        );

        if (newPassword) {
            store.webuiPassword = newPassword;
        }

        const data = await response.json();
        if (data.status !== 'ok') {
            return { success: false, error: data.error || Alpine.store('global').t('refreshFailed') };
        }

        await Alpine.store('data').fetchData();

        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

window.AccountActions.toggleAccount = async function(email, enabled) {
    const store = Alpine.store('global');
    const dataStore = Alpine.store('data');

    const account = dataStore.accounts.find(a => a.email === email);
    const previousState = account ? account.enabled : !enabled;

    if (account) {
        account.enabled = enabled;
    }

    try {
        const { response, newPassword } = await window.utils.request(
            `/api/accounts/${encodeURIComponent(email)}/toggle`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            },
            store.webuiPassword
        );

        if (newPassword) {
            store.webuiPassword = newPassword;
        }

        const data = await response.json();
        if (data.status !== 'ok') {
            throw new Error(data.error || Alpine.store('global').t('toggleFailed'));
        }

        await dataStore.fetchData();
        return { success: true, data };

    } catch (error) {
        
        if (account) {
            account.enabled = previousState;
        }
        await dataStore.fetchData();
        return { success: false, error: error.message, rolledBack: true };
    }
};

window.AccountActions.deleteAccount = async function(email) {
    const store = Alpine.store('global');

    try {
        const { response, newPassword } = await window.utils.request(
            `/api/accounts/${encodeURIComponent(email)}`,
            { method: 'DELETE' },
            store.webuiPassword
        );

        if (newPassword) {
            store.webuiPassword = newPassword;
        }

        const data = await response.json();
        if (data.status !== 'ok') {
            return { success: false, error: data.error || Alpine.store('global').t('deleteFailed') };
        }

        await Alpine.store('data').fetchData();
        return { success: true, data };

    } catch (error) {
        return { success: false, error: error.message };
    }
};

window.AccountActions.getFixAccountUrl = async function(email) {
    const store = Alpine.store('global');

    try {
        const urlPath = `/api/auth/url?email=${encodeURIComponent(email)}`;
        const { response, newPassword } = await window.utils.request(
            urlPath,
            {},
            store.webuiPassword
        );

        if (newPassword) {
            store.webuiPassword = newPassword;
        }

        const data = await response.json();
        if (data.status !== 'ok') {
            return { success: false, error: data.error || Alpine.store('global').t('authUrlFailed') };
        }

        return { success: true, url: data.url };

    } catch (error) {
        return { success: false, error: error.message };
    }
};

window.AccountActions.reloadAccounts = async function() {
    const store = Alpine.store('global');

    try {
        const { response, newPassword } = await window.utils.request(
            '/api/accounts/reload',
            { method: 'POST' },
            store.webuiPassword
        );

        if (newPassword) {
            store.webuiPassword = newPassword;
        }

        const data = await response.json();
        if (data.status !== 'ok') {
            return { success: false, error: data.error || Alpine.store('global').t('reloadFailed') };
        }

        await Alpine.store('data').fetchData();
        return { success: true, data };

    } catch (error) {
        return { success: false, error: error.message };
    }
};
