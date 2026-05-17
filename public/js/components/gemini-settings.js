
window.Components = window.Components || {};
window.Components.geminiSettings = () => ({
	cfg: {
		selectionStrategy: "random",
		cooldownSeconds: 90,
		requestQuota: 1000,
		apiKeyDailyQuota: 500,
		enableRealThinking: false,
		streamThinkingAsContent: false,
		enableAutoModelSwitching: false,
		preferredAccountKind: "cli",
		modelVisibility: {},
		hasPassword: false
	},

	defaults: { cooldownSeconds: 90, requestQuota: 1000, apiKeyDailyQuota: 500 },
	newPassword: "",
	loaded: false,
	saving: false,
	savingPw: false,
	savedAt: "",

	_toast(msg, type) {
		const g = this.$store && this.$store.global;
		if (g && g.showToast) g.showToast(msg, type || "info");
		else console.log("[settings]", msg);
	},

	async init() {
		try {
			const pw = this.$store.global.webuiPassword;
			const { response } = await window.utils.request("/api/config", {}, pw);
			if (!response.ok) return;
			const data = await response.json();
			if (data && data.config) {
				this.cfg = Object.assign(this.cfg, data.config);
				if (!this.cfg.modelVisibility) this.cfg.modelVisibility = {};
			}
		} catch (e) {
			console.error("settings load", e);
		} finally {
			this.loaded = true;
		}
	},

	async save() {
		this.saving = true;
		try {
			const pw = this.$store.global.webuiPassword;
			const { response } = await window.utils.request(
				"/api/config",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						selectionStrategy: this.cfg.selectionStrategy,
						cooldownSeconds: this.cfg.cooldownSeconds,
						requestQuota: this.cfg.requestQuota,
						apiKeyDailyQuota: this.cfg.apiKeyDailyQuota,
						enableRealThinking: this.cfg.enableRealThinking,
						streamThinkingAsContent: this.cfg.streamThinkingAsContent,
						enableAutoModelSwitching: this.cfg.enableAutoModelSwitching,
						preferredAccountKind: this.cfg.preferredAccountKind,
						modelVisibility: this.cfg.modelVisibility
					})
				},
				pw
			);
			if (!response.ok) throw new Error("HTTP " + response.status);
			this.savedAt = "Saved " + new Date().toLocaleTimeString();
			this._toast("Settings saved", "success");
		} catch (e) {
			this._toast("Save failed: " + e.message, "error");
		} finally {
			this.saving = false;
		}
	},

	async savePassword() {
		this.savingPw = true;
		try {
			const pw = this.$store.global.webuiPassword;
			const { response } = await window.utils.request(
				"/api/config/password",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: this.newPassword })
				},
				pw
			);
			if (!response.ok) throw new Error("HTTP " + response.status);
			const next = this.newPassword || "";

			this.$store.global.webuiPassword = next;
			if (next) localStorage.setItem("google_reverse_proxy_password", next);
			else localStorage.removeItem("google_reverse_proxy_password");
			this.cfg.hasPassword = !!next;
			this.newPassword = "";
			this._toast(next ? "Dashboard password set" : "Dashboard password removed", "success");
		} catch (e) {
			this._toast("Failed: " + e.message, "error");
		} finally {
			this.savingPw = false;
		}
	}
});
