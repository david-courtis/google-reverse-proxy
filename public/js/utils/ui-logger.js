
(function() {
    'use strict';

    function isDebugEnabled() {

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === 'true') {
            return true;
        }

        try {
            return localStorage.getItem('ag_debug') === 'true';
        } catch (e) {
            return false;
        }
    }

    let debugEnabled = isDebugEnabled();

    window.UILogger = {

        refresh() {
            debugEnabled = isDebugEnabled();
        },

        enableDebug() {
            try {
                localStorage.setItem('ag_debug', 'true');
                debugEnabled = true;
                console.info('[UILogger] Debug mode enabled. Refresh page to see all logs.');
            } catch (e) {
                console.warn('[UILogger] Could not save debug preference');
            }
        },

        disableDebug() {
            try {
                localStorage.removeItem('ag_debug');
                debugEnabled = false;
                console.info('[UILogger] Debug mode disabled.');
            } catch (e) {

            }
        },

        isDebug() {
            return debugEnabled;
        },

        debug(...args) {
            if (debugEnabled) {
                console.log('[DEBUG]', ...args);
            }
        },

        info(...args) {
            if (debugEnabled) {
                console.info('[INFO]', ...args);
            }
        },

        log(...args) {
            if (debugEnabled) {
                console.log(...args);
            }
        },

        warn(...args) {

            if (debugEnabled) {
                console.warn(...args);
            }
        },

        warnAlways(...args) {
            console.warn(...args);
        },

        error(...args) {
            console.error(...args);
        }
    };

    if (debugEnabled) {
        console.info('[UILogger] Debug mode is ON. Set localStorage ag_debug=false to disable.');
    }
})();
