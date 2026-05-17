
window.Components = window.Components || {};

window.Components.addAccountModal = () => ({
	manualMode: false,
	authUrl: "",
	authState: "",
	callbackInput: "",
	apiKeyInput: "",
	apiKeyOpen: false,
	addingKeys: false,
	submitting: false,
	_pollTimer: null,
	_pollDeadline: 0,
	_baseline: null,
	_msgHandler: null,

	init() {

		this._msgHandler = (ev) => {
			if (ev && ev.data && ev.data.type === "gca-account-added") this._onAdded();
		};
		window.addEventListener("message", this._msgHandler);
	},

	resetState() {
		this.manualMode = false;
		this.authUrl = "";
		this.authState = "";
		this.callbackInput = "";
		this.apiKeyInput = "";
		this.apiKeyOpen = false;
		this.addingKeys = false;
		this.submitting = false;
		this._stopWatching();
		const details = document.querySelectorAll("#add_account_modal details[open]");
		details.forEach((d) => d.removeAttribute("open"));
	},

	async _fetchAuthUrl() {
		if (this.authUrl) return true;
		try {
			const password = Alpine.store("global").webuiPassword;
			const { response, newPassword } = await window.utils.request("/api/auth/url", {}, password);
			if (newPassword) Alpine.store("global").webuiPassword = newPassword;
			const data = await response.json();
			if (data.status === "ok") {
				this.authUrl = data.url;
				this.authState = data.state;
				return true;
			}
			Alpine.store("global").showToast(data.error || "Could not start login", "error");
		} catch (e) {
			Alpine.store("global").showToast(e.message, "error");
		}
		return false;
	},

	async _poolSize() {
		try {
			const password = Alpine.store("global").webuiPassword;
			const { response } = await window.utils.request("/v1/auth/accounts", {}, password);
			const data = await response.json();
			return typeof data.pool_size === "number" ? data.pool_size : 0;
		} catch {
			return null;
		}
	},

	async _startWatching() {
		this._stopWatching();
		this._baseline = await this._poolSize();
		this._pollDeadline = Date.now() + 10 * 60 * 1000;
		this._pollTimer = setInterval(async () => {
			if (Date.now() > this._pollDeadline) {
				this._stopWatching();
				return;
			}
			const size = await this._poolSize();
			if (size !== null && this._baseline !== null && size > this._baseline) {
				this._onAdded();
			}
		}, 3000);
	},

	_stopWatching() {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	},

	_onAdded() {
		const store = Alpine.store("global");
		store.showToast(store.t("accountAddedSuccess"), "success");
		Alpine.store("data").fetchData();
		const dlg = document.getElementById("add_account_modal");
		if (dlg && typeof dlg.close === "function") dlg.close();
		this.resetState();
	},

	async copyLink() {
		if (!this.authUrl) return;
		await navigator.clipboard.writeText(this.authUrl);
		Alpine.store("global").showToast(Alpine.store("global").t("linkCopied"), "success");
	},

	async addAccountWeb() {
		if (!(await this._fetchAuthUrl())) return;
		window.open(this.authUrl, "gca_oauth", "width=520,height=680");
		this.manualMode = true;
		this._startWatching();
	},

	async initManualAuth(event) {
		if (event.target.open && !this.authUrl) {
			if (await this._fetchAuthUrl()) this._startWatching();
		}
	},

	async addApiKeys() {
		const keys = (this.apiKeyInput || "").split(/[\s,]+/).map((k) => k.trim()).filter(Boolean);
		if (keys.length === 0) return;
		this.addingKeys = true;
		try {
			const store = Alpine.store("global");
			const { response, newPassword } = await window.utils.request(
				"/api/accounts/apikey",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys })
				},
				store.webuiPassword
			);
			if (newPassword) store.webuiPassword = newPassword;
			const data = await response.json();
			if (data.status === "ok") {
				store.showToast(`Added ${data.added} API key(s) (pool: ${data.total})`, "success");
				this._onAdded();
			} else {
				store.showToast(data.error || "Failed to add API keys", "error");
			}
		} catch (e) {
			Alpine.store("global").showToast(e.message, "error");
		} finally {
			this.addingKeys = false;
		}
	},

	async completeManualAuth() {
		if (!this.callbackInput || !this.authState) return;
		this.submitting = true;
		try {
			const store = Alpine.store("global");
			const { response, newPassword } = await window.utils.request(
				"/api/auth/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ callbackInput: this.callbackInput, state: this.authState })
				},
				store.webuiPassword
			);
			if (newPassword) store.webuiPassword = newPassword;
			const data = await response.json();
			if (data.status === "ok") {
				this._onAdded();
			} else {
				store.showToast(data.error || store.t("authFailed"), "error");
			}
		} catch (e) {
			Alpine.store("global").showToast(e.message, "error");
		} finally {
			this.submitting = false;
		}
	}
});
