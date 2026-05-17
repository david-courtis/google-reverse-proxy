
window.Validators = window.Validators || {};

window.Validators.validateRange = function(value, min, max, fieldName = 'Value') {
    const numValue = Number(value);
    const t = Alpine.store('global').t;

    if (isNaN(numValue)) {
        return {
            isValid: false,
            value: min,
            error: t('mustBeValidNumber', { fieldName })
        };
    }

    if (numValue < min) {
        return {
            isValid: false,
            value: min,
            error: t('mustBeAtLeast', { fieldName, min })
        };
    }

    if (numValue > max) {
        return {
            isValid: false,
            value: max,
            error: t('mustBeAtMost', { fieldName, max })
        };
    }

    return {
        isValid: true,
        value: numValue,
        error: null
    };
};

window.Validators.validateTimeout = function(value, minMs = null, maxMs = null) {
    const { TIMEOUT_MIN, TIMEOUT_MAX } = window.AppConstants.VALIDATION;
    return window.Validators.validateRange(value, minMs ?? TIMEOUT_MIN, maxMs ?? TIMEOUT_MAX, 'Timeout');
};

window.Validators.validate = function(value, validator, showError = true) {
    const result = validator(value);

    if (!result.isValid && showError && result.error) {
        window.ErrorHandler.showError(result.error);
    }

    return result;
};
