/* ============================================================
   Office Directory — application logic
   Storage: localStorage (works identically in browser & Electron)
   ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "officeDirectory.entries";
  const AUTH_KEY_STORAGE = "officeDirectory.adminKeyHash";
  const DEFAULT_ADMIN_KEY = "ADMIN-2026";
  const SESSION_KEY = "officeDirectory.adminSession"; // sessionStorage flag

  // ---------- Seed data (used only on first run) ----------
  const SEED = [
    { id: cryptoId(), officeNumber: "OFF-101", officeName: "Human Resources", location: "3rd Floor, West Wing", phone: "+1 555 010 1234" },
    { id: cryptoId(), officeNumber: "OFF-102", officeName: "IT Support", location: "Ground Floor, Room 4", phone: "+1 555 010 5678" },
    { id: cryptoId(), officeNumber: "OFF-103", officeName: "Finance & Accounts", location: "2nd Floor, East Wing", phone: "+1 555 010 9012" }
  ];

  function cryptoId() {
    return "e-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ---------- Data layer ----------
  const Data = {
    load() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
        return SEED.slice();
      }
      try {
        return JSON.parse(raw);
      } catch (e) {
        return [];
      }
    },
    save(entries) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  };

  // ---------- Auth layer ----------
  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  const Auth = {
    async ensureDefaultKey() {
      if (!localStorage.getItem(AUTH_KEY_STORAGE)) {
        const hash = await sha256(DEFAULT_ADMIN_KEY);
        localStorage.setItem(AUTH_KEY_STORAGE, hash);
      }
    },
    async verify(key) {
      const hash = await sha256(key || "");
      return hash === localStorage.getItem(AUTH_KEY_STORAGE);
    },
    async setNewKey(key) {
      const hash = await sha256(key);
      localStorage.setItem(AUTH_KEY_STORAGE, hash);
    },
    isSignedIn() {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    },
    signIn() {
      sessionStorage.setItem(SESSION_KEY, "1");
    },
    signOut() {
      sessionStorage.removeItem(SESSION_KEY);
    }
  };

  // ---------- App state ----------
  let entries = Data.load();
  let editingId = null;
  let lastFocusedBeforeModal = null;

  // ---------- DOM refs ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const tabStandard = $("#tab-standard");
  const tabAdmin = $("#tab-admin");
  const viewStandard = $("#view-standard");
  const viewAdminLogin = $("#view-admin-login");
  const viewAdminPanel = $("#view-admin-panel");
  const topBarActions = $("#top-bar-actions");

  const searchInput = $("#search-input");
  const searchStatus = $("#search-status");
  const resultsBody = $("#results-body");
  const resultsEmpty = $("#results-empty");
  const resultsTableWrap = $("#results-table-wrap");

  const loginForm = $("#login-form");
  const loginKeyInput = $("#login-key");
  const loginError = $("#login-error");

  const adminSearchInput = $("#admin-search-input");
  const adminBody = $("#admin-body");
  const adminEmpty = $("#admin-empty");
  const adminTableWrap = $("#admin-table-wrap");
  const adminStatus = $("#admin-status");

  const entryForm = $("#entry-form");
  const fOfficeNumber = $("#f-office-number");
  const fOfficeName = $("#f-office-name");
  const fLocation = $("#f-location");
  const fPhone = $("#f-phone");
  const formTitle = $("#entry-form-title");
  const formSubmitBtn = $("#entry-form-submit");
  const formCancelBtn = $("#entry-form-cancel");
  const formMessage = $("#entry-form-message");

  const modalOverlay = $("#modal-overlay");
  const modalForm = $("#modal-form");
  const mOfficeNumber = $("#m-office-number");
  const mOfficeName = $("#m-office-name");
  const mLocation = $("#m-location");
  const mPhone = $("#m-phone");
  const modalCancelBtn = $("#modal-cancel");
  const modalDeleteBtn = $("#modal-delete");

  const changeKeyForm = $("#change-key-form");
  const changeKeyCurrent = $("#change-key-current");
  const changeKeyNew = $("#change-key-new");
  const changeKeyMessage = $("#change-key-message");

  // ============================================================
  // View switching
  // ============================================================
  function showStandard() {
    tabStandard.setAttribute("aria-current", "page");
    tabAdmin.removeAttribute("aria-current");
    viewStandard.hidden = false;
    viewAdminLogin.hidden = true;
    viewAdminPanel.hidden = true;
    renderTopBar();
    renderStandardResults();
    document.title = "Search — Office Directory";
  }

  function showAdmin() {
    tabAdmin.setAttribute("aria-current", "page");
    tabStandard.removeAttribute("aria-current");
    viewStandard.hidden = true;
    if (Auth.isSignedIn()) {
      viewAdminLogin.hidden = true;
      viewAdminPanel.hidden = false;
      renderAdminResults();
      document.title = "Admin — Office Directory";
    } else {
      viewAdminLogin.hidden = false;
      viewAdminPanel.hidden = true;
      document.title = "Admin sign in — Office Directory";
      window.setTimeout(() => loginKeyInput && loginKeyInput.focus(), 0);
    }
    renderTopBar();
  }

  function renderTopBar() {
    topBarActions.innerHTML = "";
    if (Auth.isSignedIn()) {
      const span = document.createElement("span");
      span.className = "signed-in-as";
      span.textContent = "Signed in as Admin";
      const btn = document.createElement("button");
      btn.className = "btn-secondary btn-small";
      btn.type = "button";
      btn.textContent = "Sign out";
      btn.addEventListener("click", () => {
        Auth.signOut();
        showStandard();
        announce(searchStatus, "Signed out of admin mode.");
      });
      topBarActions.appendChild(span);
      topBarActions.appendChild(btn);
    }
  }

  tabStandard.addEventListener("click", showStandard);
  tabAdmin.addEventListener("click", showAdmin);

  // ============================================================
  // Standard mode — search
  // ============================================================
  function matchEntries(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return entries.slice();
    return entries.filter(e => e.officeName.toLowerCase().includes(q));
  }

  function renderStandardResults() {
    const query = searchInput.value;
    const matches = matchEntries(query);
    resultsBody.innerHTML = "";

    if (matches.length === 0) {
      resultsTableWrap.hidden = true;
      resultsEmpty.hidden = false;
      resultsEmpty.querySelector("strong").textContent = query.trim()
        ? "No matching office found"
        : "No offices in the directory yet";
      resultsEmpty.querySelector("p").textContent = query.trim()
        ? "Try a different office name, or check the spelling."
        : "Ask an administrator to add office entries.";
    } else {
      resultsTableWrap.hidden = false;
      resultsEmpty.hidden = true;
      matches
        .sort((a, b) => a.officeName.localeCompare(b.officeName))
        .forEach(e => resultsBody.appendChild(buildStandardRow(e)));
    }

    const count = matches.length;
    announce(searchStatus, query.trim()
      ? `${count} ${count === 1 ? "result" : "results"} found for "${query.trim()}"`
      : `Showing all ${count} ${count === 1 ? "office" : "offices"}`);
  }

  function buildStandardRow(e) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = e.officeName;

    const tdPhone = document.createElement("td");
    tdPhone.className = "phone-number";
    const a = document.createElement("a");
    a.href = "tel:" + e.phone.replace(/\s+/g, "");
    a.textContent = e.phone;
    tdPhone.appendChild(a);

    const tdLocation = document.createElement("td");
    tdLocation.textContent = e.location || "—";

    const tdOfficeNo = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = "office-number-tag";
    tag.textContent = e.officeNumber || "—";
    tdOfficeNo.appendChild(tag);

    tr.append(tdName, tdPhone, tdLocation, tdOfficeNo);
    return tr;
  }

  searchInput.addEventListener("input", renderStandardResults);
  searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      searchInput.value = "";
      renderStandardResults();
    }
  });

  // ============================================================
  // Admin — login
  // ============================================================
  loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    loginError.hidden = true;
    const key = loginKeyInput.value;
    const ok = await Auth.verify(key);
    if (ok) {
      Auth.signIn();
      loginKeyInput.value = "";
      showAdmin();
    } else {
      loginError.hidden = false;
      loginError.textContent = "That authorization key isn't recognized. Check the key and try again.";
      loginKeyInput.focus();
      loginKeyInput.select();
    }
  });

  // ============================================================
  // Admin — search / listing
  // ============================================================
  function adminMatchEntries(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return entries.slice();
    return entries.filter(e =>
      e.officeName.toLowerCase().includes(q) ||
      (e.officeNumber || "").toLowerCase().includes(q) ||
      (e.location || "").toLowerCase().includes(q) ||
      (e.phone || "").toLowerCase().includes(q)
    );
  }

  function renderAdminResults() {
    const query = adminSearchInput.value;
    const matches = adminMatchEntries(query).sort((a, b) => a.officeName.localeCompare(b.officeName));
    adminBody.innerHTML = "";

    if (matches.length === 0) {
      adminTableWrap.hidden = true;
      adminEmpty.hidden = false;
    } else {
      adminTableWrap.hidden = false;
      adminEmpty.hidden = true;
      matches.forEach(e => adminBody.appendChild(buildAdminRow(e)));
    }

    const count = matches.length;
    announce(adminStatus, `${count} ${count === 1 ? "entry" : "entries"} listed`);
  }

  function buildAdminRow(e) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = e.officeName;

    const tdPhone = document.createElement("td");
    tdPhone.className = "phone-number";
    tdPhone.textContent = e.phone;

    const tdLocation = document.createElement("td");
    tdLocation.textContent = e.location || "—";

    const tdOfficeNo = document.createElement("td");
    tdOfficeNo.textContent = e.officeNumber || "—";

    const tdActions = document.createElement("td");
    tdActions.className = "actions-cell";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-secondary btn-small";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.setAttribute("aria-label", `Edit ${e.officeName}`);
    editBtn.addEventListener("click", () => openEditModal(e.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-danger btn-small";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${e.officeName}`);
    deleteBtn.addEventListener("click", () => deleteEntry(e.id, deleteBtn));

    tdActions.append(editBtn, deleteBtn);
    tr.append(tdName, tdPhone, tdLocation, tdOfficeNo, tdActions);
    return tr;
  }

  adminSearchInput.addEventListener("input", renderAdminResults);

  // ============================================================
  // Admin — add entry (inline form)
  // ============================================================
  entryForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    formMessage.hidden = true;

    const officeName = fOfficeName.value.trim();
    const phone = fPhone.value.trim();
    const officeNumber = fOfficeNumber.value.trim();
    const location = fLocation.value.trim();

    if (!officeName || !phone) {
      showFormMessage(formMessage, "Office name and phone number are required.", true);
      (officeName ? fPhone : fOfficeName).focus();
      return;
    }

    entries.push({ id: cryptoId(), officeNumber, officeName, location, phone });
    Data.save(entries);
    entryForm.reset();
    showFormMessage(formMessage, `${officeName} was added to the directory.`, false);
    renderAdminResults();
    fOfficeName.focus();
  });

  function showFormMessage(el, text, isError) {
    el.hidden = false;
    el.textContent = text;
    el.className = isError ? "form-error" : "form-success";
    el.setAttribute("role", isError ? "alert" : "status");
  }

  // ============================================================
  // Admin — edit / delete via modal
  // ============================================================
  function openEditModal(id) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    editingId = id;
    mOfficeNumber.value = e.officeNumber || "";
    mOfficeName.value = e.officeName || "";
    mLocation.value = e.location || "";
    mPhone.value = e.phone || "";
    lastFocusedBeforeModal = document.activeElement;
    modalOverlay.hidden = false;
    document.addEventListener("keydown", onModalKeydown, true);
    window.setTimeout(() => mOfficeName.focus(), 0);
  }

  function closeModal() {
    modalOverlay.hidden = true;
    editingId = null;
    document.removeEventListener("keydown", onModalKeydown, true);
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      lastFocusedBeforeModal.focus();
    }
  }

  function onModalKeydown(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
      return;
    }
    if (ev.key === "Tab") {
      // simple focus trap
      const focusables = $$('button, input, [href]', modalOverlay).filter(el => !el.disabled);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  }

  modalForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const officeName = mOfficeName.value.trim();
    const phone = mPhone.value.trim();
    if (!officeName || !phone) {
      mOfficeName.focus();
      return;
    }
    const e = entries.find(x => x.id === editingId);
    if (e) {
      e.officeNumber = mOfficeNumber.value.trim();
      e.officeName = officeName;
      e.location = mLocation.value.trim();
      e.phone = phone;
      Data.save(entries);
    }
    closeModal();
    renderAdminResults();
    announce(adminStatus, `${officeName} was updated.`);
  });

  modalCancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (ev) => {
    if (ev.target === modalOverlay) closeModal();
  });

  modalDeleteBtn.addEventListener("click", () => {
    const e = entries.find(x => x.id === editingId);
    if (!e) return;
    if (window.confirm(`Delete ${e.officeName} from the directory? This cannot be undone.`)) {
      entries = entries.filter(x => x.id !== editingId);
      Data.save(entries);
      closeModal();
      renderAdminResults();
      announce(adminStatus, `${e.officeName} was deleted.`);
    }
  });

  function deleteEntry(id, triggerBtn) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    if (window.confirm(`Delete ${e.officeName} from the directory? This cannot be undone.`)) {
      entries = entries.filter(x => x.id !== id);
      Data.save(entries);
      renderAdminResults();
      announce(adminStatus, `${e.officeName} was deleted.`);
      adminSearchInput.focus();
    }
  }

  // ============================================================
  // Admin — change authorization key
  // ============================================================
  changeKeyForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    changeKeyMessage.hidden = true;
    const current = changeKeyCurrent.value;
    const next = changeKeyNew.value.trim();

    const ok = await Auth.verify(current);
    if (!ok) {
      showFormMessage(changeKeyMessage, "Current authorization key is incorrect.", true);
      changeKeyCurrent.focus();
      return;
    }
    if (next.length < 6) {
      showFormMessage(changeKeyMessage, "New key must be at least 6 characters.", true);
      changeKeyNew.focus();
      return;
    }
    await Auth.setNewKey(next);
    changeKeyForm.reset();
    showFormMessage(changeKeyMessage, "Authorization key updated.", false);
  });

  // ============================================================
  // Accessibility helper — polite live-region announcements
  // ============================================================
  function announce(el, text) {
    el.textContent = "";
    // Force screen readers to re-announce even if text is identical
    window.requestAnimationFrame(() => { el.textContent = text; });
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    await Auth.ensureDefaultKey();
    showStandard();
  }

  init();
})();
