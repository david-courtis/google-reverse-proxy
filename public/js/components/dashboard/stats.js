
window.DashboardStats = window.DashboardStats || {};

window.DashboardStats.updateStats = function(component) {
    const accounts = Alpine.store('data').accounts;
    let active = 0, limited = 0;

    const enabledAccounts = accounts.filter(acc => acc.enabled !== false);

    enabledAccounts.forEach(acc => {
        if (acc.status === 'ok') {
            const limits = Object.entries(acc.limits || {});

            if (limits.length === 0) {

                limited++;
                return;
            }

            const hasRateLimitedModel = limits.some(([_, l]) => {

                if (!l || l.remainingFraction === null || l.remainingFraction === undefined) return true;
                return l.remainingFraction <= 0.05;
            });

            if (hasRateLimitedModel) {
                limited++;
            } else {
                active++;
            }
        } else {
            limited++;
        }
    });

    component.stats.total = enabledAccounts.length;
    component.stats.active = active;
    component.stats.limited = limited;

    let totalLimitedModels = 0;
    let totalTrackedModels = 0;

    enabledAccounts.forEach(acc => {
         const limits = Object.entries(acc.limits || {});
         limits.forEach(([id, l]) => {
             totalTrackedModels++;
             if (!l || l.remainingFraction == null || l.remainingFraction <= 0.05) {
                 totalLimitedModels++;
             }
         });
    });

    component.stats.modelUsage = {
        limited: totalLimitedModels,
        total: totalTrackedModels
    };

    const subscription = { ultra: 0, pro: 0, free: 0 };
    enabledAccounts.forEach(acc => {
        const tier = acc.subscription?.tier || 'free';
        if (tier === 'ultra') {
            subscription.ultra++;
        } else if (tier === 'pro') {
            subscription.pro++;
        } else {
            subscription.free++;
        }
    });
    component.stats.subscription = subscription;
};
