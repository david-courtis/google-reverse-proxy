
let _pendingPasswordPrompt = null;

async function _askPassword() {
    if (_pendingPasswordPrompt) return _pendingPasswordPrompt;
    _pendingPasswordPrompt = (async () => {
        const store = Alpine.store('global');
        const fresh = localStorage.getItem('google_reverse_proxy_password') || '';
        if (fresh && store && fresh !== store.webuiPassword) {
            store.webuiPassword = fresh;
            return fresh;
        }
        const entered = prompt(store ? store.t('enterPassword') : 'Enter Web UI Password:');
        if (entered) {
            localStorage.setItem('google_reverse_proxy_password', entered);
            if (store) store.webuiPassword = entered;
            return entered;
        }
        return null;
    })();
    try {
        return await _pendingPasswordPrompt;
    } finally {
        _pendingPasswordPrompt = null;
    }
}

window.utils = {

    async request(url, options = {}, webuiPassword = '') {
        options.headers = options.headers || {};
        const store = Alpine.store('global');
        let pw = webuiPassword || (store && store.webuiPassword) || '';
        if (pw) {
            options.headers['x-webui-password'] = pw;
        }

        let response = await fetch(url, options);

        if (response.status === 401) {
            const liveStore = Alpine.store('global');
            const live = liveStore && liveStore.webuiPassword;
            if (live && live !== pw) {
                options.headers['x-webui-password'] = live;
                response = await fetch(url, options);
                if (response.status !== 401) {
                    return { response, newPassword: live };
                }
            }
            const fresh = await _askPassword();
            if (fresh) {
                options.headers['x-webui-password'] = fresh;
                response = await fetch(url, options);
                return { response, newPassword: fresh };
            }
        }

        return { response, newPassword: null };
    },

    formatTimeUntil(isoTime) {
        const store = Alpine.store('global');
        const diff = new Date(isoTime) - new Date();
        if (diff <= 0) return store ? store.t('ready') : 'READY';
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);

        const hSuffix = store ? store.t('timeH') : 'H';
        const mSuffix = store ? store.t('timeM') : 'M';

        if (hrs > 0) return `${hrs}${hSuffix} ${mins % 60}${mSuffix}`;
        return `${mins}${mSuffix}`;
    },

    getThemeColor(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};
