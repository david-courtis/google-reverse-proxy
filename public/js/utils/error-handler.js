
window.ErrorHandler = window.ErrorHandler || {};

window.ErrorHandler.safeAsync = async function(fn, errorMessage = null, options = {}) {
    const { rethrow = false, onError = null } = options;
    const store = Alpine.store('global');
    const defaultErrorMessage = errorMessage || store.t('operationFailed');

    try {
        return await fn();
    } catch (error) {

        console.error(`[ErrorHandler] ${defaultErrorMessage}:`, error);

        const fullMessage = `${defaultErrorMessage}: ${error.message || store.t('unknownError')}`;
        store.showToast(fullMessage, 'error');

        if (onError && typeof onError === 'function') {
            try {
                onError(error);
            } catch (handlerError) {
                console.error('[ErrorHandler] Custom error handler failed:', handlerError);
            }
        }

        if (rethrow) {
            throw error;
        }

        return undefined;
    }
};

window.ErrorHandler.showError = function(message, error = null) {
    const store = Alpine.store('global');
    const fullMessage = error ? `${message}: ${error.message}` : message;
    store.showToast(fullMessage, 'error');
};

window.ErrorHandler.withLoading = async function(asyncFn, context, loadingKey = 'loading', options = {}) {
    
    context[loadingKey] = true;

    try {
        
        const result = await window.ErrorHandler.safeAsync(asyncFn, options.errorMessage, options);
        return result;
    } finally {
        
        context[loadingKey] = false;
    }
};
