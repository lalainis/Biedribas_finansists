const { createApp } = Vue;

createApp({
  data() {
    return {
      token: localStorage.getItem("token") || "",
      user: JSON.parse(localStorage.getItem("user") || "null"),
      tab: "income",
      auth: {
        phone: "",
        pin: "",
        pinConfirm: "",
        step: "check",
      },
      dashboard: {
        period: { season_label: "", start_date: "", end_date: "" },
        totals: { income_total: 0, expense_total: 0, difference: 0 },
      },
      availablePeriods: [],
      selectedSeason: "",
      config: {
        expense_categories: [],
      },
      memberStatuses: [],
      members: [],
      history: { incomes: [], expenses: [] },
      forms: {
        otherIncome: { amount: "", entry_date: new Date().toISOString().slice(0, 10), description: "" },
        memberPayment: { member_id: "", amount: "", entry_date: new Date().toISOString().slice(0, 10) },
        expense: { category: "", amount: "", entry_date: new Date().toISOString().slice(0, 10), description: "" },
        member: { first_name: "", last_name: "", phone: "", status: "Biedrs", membership_fee: 0, joining_fee_paid: false, role: "member" },
        period: { season_label: "", default_membership_fee: 0, carry_over: 0 },
      },
      selectedFile: null,
      successMessage: "",
      errorMessage: "",
      historyFilter: { month: "", incomeType: "", expenseCategory: "", },
      historyCollapsed: { incomes: false, expenses: false },
    };
  },
  computed: {
    canWriteIncome() {
      return ["cashier", "admin"].includes(this.user?.role);
    },
    canWriteExpense() {
      return ["cashier", "admin", "member"].includes(this.user?.role);
    },
    canManageMembers() {
      return ["board", "admin"].includes(this.user?.role);
    },
    canManagePeriod() {
      return ["board", "admin"].includes(this.user?.role);
    },
    roleOptions() {
      return [
        { value: "member", label: "Biedrs" },
        { value: "cashier", label: "Kasieris" },
        { value: "board", label: "Valde" },
        { value: "auditor", label: "Revidents" },
        { value: "admin", label: "Administrators" },
      ];
    },
    statusOptions() {
      const options = [...this.memberStatuses];
      const seen = new Set(options);
      this.members.forEach((m) => {
        const value = (m.status || "").trim();
        if (value && !seen.has(value)) {
          options.push(value);
          seen.add(value);
        }
      });
      return options;
    },
    historyMonths() {
      const months = new Set();
      [...(this.history.incomes || []), ...(this.history.expenses || [])].forEach(r => {
        if (r.entry_date) months.add(r.entry_date.slice(0, 7));
      });
      return [...months].sort().reverse();
    },
    historyIncomeTypes() {
      const types = new Set();
      (this.history.incomes || []).forEach(r => { if (r.type) types.add(r.type); });
      return [...types].sort();
    },
    historyExpenseCategories() {
      const cats = new Set();
      (this.history.expenses || []).forEach(r => { if (r.category) cats.add(r.category); });
      return [...cats].sort();
    },
    filteredIncomes() {
      return (this.history.incomes || []).filter(r => {
        if (this.historyFilter.month && !r.entry_date.startsWith(this.historyFilter.month)) return false;
        if (this.historyFilter.incomeType && r.type !== this.historyFilter.incomeType) return false;
        return true;
      });
    },
    filteredExpenses() {
      return (this.history.expenses || []).filter(r => {
        if (this.historyFilter.month && !r.entry_date.startsWith(this.historyFilter.month)) return false;
        if (this.historyFilter.expenseCategory && r.category !== this.historyFilter.expenseCategory) return false;
        return true;
      });
    },
  },
  methods: {
    resetMessages() {
      this.successMessage = "";
      this.errorMessage = "";
    },
    isMemberFullyPaid(member) {
      const fee = Number(member?.membership_fee || 0);
      const paid = Number(member?.paid_this_period || 0);
      if (!Number.isFinite(fee) || !Number.isFinite(paid)) {
        return false;
      }
      if (fee <= 0) {
        return true;
      }
      return paid >= fee;
    },
    async api(path, options = {}) {
      const headers = options.headers || {};
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }
      const response = await fetch(path, { ...options, headers });
      const contentType = response.headers.get("content-type") || "";
      let data = null;
      let rawText = "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        rawText = await response.text();
      }
      if (!response.ok) {
        const fallbackMessage = rawText ? `HTTP ${response.status}: ${rawText.slice(0, 200)}` : `HTTP ${response.status}`;
        const error = new Error(data?.error || fallbackMessage || "Neizdevas izpildit pieprasijumu");
        error.status = response.status;
        throw error;
      }
      return data;
    },
    async loadConfig() {
      this.config = await this.api("/api/config");
    },
    async loadMemberStatuses() {
      if (!this.token || !this.canManageMembers) {
        this.memberStatuses = [];
        return;
      }
      const data = await this.api("/api/member-statuses");
      this.memberStatuses = data.statuses || [];
      if (this.memberStatuses.length > 0 && !this.memberStatuses.includes(this.forms.member.status)) {
        this.forms.member.status = this.memberStatuses[0];
      }
    },
    async checkPhone() {
      this.resetMessages();
      try {
        const data = await this.api("/api/auth/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: this.auth.phone }),
        });
        this.auth.step = data.needs_pin_setup ? "setup" : "login";
      } catch (err) {
        if (err.status === 404) {
          this.auth.step = "login";
          this.errorMessage = "";
          return;
        }
        this.errorMessage = err.message;
      }
    },
    async setupPin() {
      this.resetMessages();
      try {
        await this.api("/api/auth/setup-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: this.auth.phone,
            pin: this.auth.pin,
            pin_confirm: this.auth.pinConfirm,
          }),
        });
        this.successMessage = "PIN kods saglabats. Tagad ielogojieties.";
        this.auth.step = "login";
        this.auth.pin = "";
        this.auth.pinConfirm = "";
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async login() {
      this.resetMessages();
      try {
        const data = await this.api("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: this.auth.phone, pin: this.auth.pin }),
        });
        this.token = data.token;
        this.user = data.user;
        localStorage.setItem("token", this.token);
        localStorage.setItem("user", JSON.stringify(this.user));
        this.tab = "member-list";
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async logout() {
      try {
        await this.api("/api/auth/logout", { method: "POST" });
      } catch (_) {}
      this.token = "";
      this.user = null;
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      this.auth = { phone: "", pin: "", pinConfirm: "", step: "check" };
      this.successMessage = "";
      this.errorMessage = "";
    },
    async loadDashboard() {
      const seasonQuery = this.selectedSeason ? `?season_label=${encodeURIComponent(this.selectedSeason)}` : "";
      this.dashboard = await this.api(`/api/dashboard${seasonQuery}`);
      this.forms.period.season_label = this.dashboard.period.season_label;
      this.forms.period.carry_over = this.dashboard.period.carry_over;
      if (!this.selectedSeason) {
        this.selectedSeason = this.dashboard.period.season_label;
      }
    },
    async loadAvailablePeriods() {
      const data = await this.api("/api/periods/available");
      this.availablePeriods = data.periods || [];
      if (!this.selectedSeason && this.availablePeriods.length > 0) {
        const activePeriod = this.availablePeriods.find((p) => p.active);
        this.selectedSeason = (activePeriod || this.availablePeriods[0]).season_label;
      }
    },
    async loadMembers() {
      if (!this.token) return;
      const seasonQuery = this.selectedSeason ? `?season_label=${encodeURIComponent(this.selectedSeason)}` : "";
      this.members = await this.api(`/api/members${seasonQuery}`);
    },
    async loadHistory() {
      if (!["cashier", "board", "admin", "auditor"].includes(this.user?.role)) return;
      const seasonQuery = this.selectedSeason ? `?season_label=${encodeURIComponent(this.selectedSeason)}` : "";
      this.history = await this.api(`/api/history${seasonQuery}`);
    },
    async onSeasonChange() {
      if (!this.token) return;
      await this.loadDashboard();
      await this.loadMembers();
      await this.loadHistory();
    },
    async refreshAll() {
      await this.loadConfig();
      if (this.token) {
        await this.loadMemberStatuses();
        await this.loadAvailablePeriods();
        await this.loadDashboard();
        await this.loadMembers();
        await this.loadHistory();
      }
    },
    async addOtherIncome() {
      this.resetMessages();
      try {
        await this.api("/api/incomes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.forms.otherIncome),
        });
        this.successMessage = "Ieņēmums pievienots";
        this.forms.otherIncome.amount = "";
        this.forms.otherIncome.description = "";
        await this.refreshAll();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async addMemberPayment() {
      this.resetMessages();
      try {
        const memberId = this.forms.memberPayment.member_id;
        await this.api(`/api/members/${memberId}/payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: this.forms.memberPayment.amount,
            entry_date: this.forms.memberPayment.entry_date,
          }),
        });
        this.successMessage = "Biedra iemaksa pievienota";
        this.forms.memberPayment.amount = "";
        await this.refreshAll();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    onFileChange(event) {
      this.selectedFile = event.target.files[0] || null;
    },
    async addExpense() {
      this.resetMessages();
      try {
        const fd = new FormData();
        Object.entries(this.forms.expense).forEach(([k, v]) => fd.append(k, v));
        if (this.selectedFile) {
          fd.append("attachment", this.selectedFile);
        }
        await this.api("/api/expenses", { method: "POST", body: fd });
        this.successMessage = "Izdevumi pievienoti";
        this.forms.expense.amount = "";
        this.forms.expense.description = "";
        this.selectedFile = null;
        await this.refreshAll();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    attachmentUrl(filename) {
      return `/api/attachments/${filename}`;
    },
    async openAttachment(filename) {
      this.resetMessages();
      let previewWindow = null;

      try {
        previewWindow = window.open("", "_blank");

        const response = await fetch(this.attachmentUrl(filename), {
          headers: { Authorization: `Bearer ${this.token}` },
        });

        if (!response.ok) {
          let message = "Neizdevās atvērt pielikumu";
          try {
            const data = await response.json();
            message = data.error || message;
          } catch (_) {}
          throw new Error(message);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        if (previewWindow) {
          previewWindow.location.href = blobUrl;
        } else {
          window.open(blobUrl, "_blank");
        }

        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } catch (err) {
        if (previewWindow) {
          previewWindow.close();
        }
        this.errorMessage = err.message;
      }
    },
    async addMember() {
      this.resetMessages();
      try {
        const payload = { ...this.forms.member, season_label: this.selectedSeason || this.forms.period.season_label };
        if (this.user.role !== "admin") {
          delete payload.role;
        }
        await this.api("/api/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        this.successMessage = "Biedrs pievienots";
        this.forms.member = {
          first_name: "",
          last_name: "",
          phone: "",
          status: this.memberStatuses[0] || "Biedrs",
          membership_fee: 0,
          joining_fee_paid: false,
          role: "member",
        };
        await this.loadMembers();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async saveMember(member) {
      this.resetMessages();
      try {
        const payload = { ...member, season_label: this.selectedSeason || this.forms.period.season_label };
        await this.api(`/api/members/${member.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        this.successMessage = "Biedra dati saglabāti";
        await this.loadMembers();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async removeMember(memberId) {
      this.resetMessages();
      try {
        await this.api(`/api/members/${memberId}`, { method: "DELETE" });
        this.successMessage = "Biedrs izdzēsts";
        await this.loadMembers();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async clearMemberPin(memberId) {
      this.resetMessages();
      try {
        await this.api(`/api/members/${memberId}/pin`, { method: "DELETE" });
        this.successMessage = "PIN kods izdzēsts";
        await this.loadMembers();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async setPeriod() {
      this.resetMessages();
      try {
        await this.api("/api/period", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            season_label: this.forms.period.season_label,
            default_membership_fee: this.forms.period.default_membership_fee,
            carry_over: this.forms.period.carry_over,
          }),
        });
        this.successMessage = "Pārskata periods saglabāts";
        await this.refreshAll();
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
    async exportBalance() {
      this.resetMessages();
      try {
        const seasonQuery = this.selectedSeason ? `?season_label=${encodeURIComponent(this.selectedSeason)}` : "";
        const res = await fetch(`/api/export${seasonQuery}`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!res.ok) {
          let message = "Eksports neizdevās";
          try {
            const data = await res.json();
            message = data.error || message;
          } catch (_) {}
          throw new Error(message);
        }
        const blob = await res.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "bilance.xlsx";
        document.body.appendChild(link);
        link.click();
        link.remove();
        this.successMessage = "Bilance ir veiksmīgi eksportēta";
      } catch (err) {
        this.errorMessage = err.message;
      }
    },
  },
  async mounted() {
    await this.loadConfig();
    if (this.token && this.user) {
      await this.refreshAll();
      this.tab = "member-list";
    }
  },
}).mount("#app");
