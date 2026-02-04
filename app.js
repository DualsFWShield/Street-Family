/**
 * Street Family Manager - Core Logic
 */

const CONFIG = {
    // 0-based index mapping for raw Excel array
    COLS: {
        FICHE: 0, // Was ACTIVE. Now "Fiche Rentrée"
        NAME: 1,
        COURSES: 2,
        NB_HOURS: 3,
        REDUCTION: 4,
        AMOUNT_DUE: 5,
        PAYMENT_TYPE: 6,
        PAID_1: 7,
        DATE_1: 8,
        PAID_2: 9,
        DATE_2: 10,
        TEL_STUDENT: 11,
        PARENTS_NAME: 12,
        TEL_PARENTS: 13,
        MAIL_STUDENT: 14,
        MAIL_PARENTS: 15,
        ADDRESS: 16,
        CP: 17,
        CITY: 18,
        DOB: 19,
        POB: 20,
        OTHER: 21,
        SEX: 22,

        // Virtual/Internal columns added to the end of the array
        ACTIVE_STATE: 23
    },
    STORAGE_KEY: 'sf_manager_data_v1',
    PRICING: [
        [1, 140, 260, 126, 234, 119, 221, 133, 247],
        [1.5, 190, 360, 171, 324, 161.5, 306, 180.5, 342],
        [2, 225, 420, 202.5, 378, 191.25, 357, 213.75, 399],
        [2.5, 257.5, 480, 231.75, 432, 218.88, 408, 244.63, 456],
        [3, 290, 540, 261, 486, 246.5, 459, 275.5, 513],
        [3.5, 312.5, 580, 281.25, 522, 265.63, 493, 296.88, 551],
        [4, 335, 620, 301.5, 558, 284.75, 527, 318.25, 589],
        [4.5, 345, 645, 310.5, 580.5, 293.25, 548.25, 327.75, 612.75],
        ["FA", 355, 670, 319.5, 603, 301.75, 569.5, 337.25, 636.5]
    ]
};

// Date Format Helper
function formatDate(val) {
    if (!val) return "";
    let d;
    if (val instanceof Date) {
        d = val;
    } else {
        d = new Date(val);
    }
    if (isNaN(d.getTime())) return val;

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

// Smart Parser for Money Columns
function parseSmartMoney(val) {
    const res = { val: 0, text: '', isComment: false, raw: val };

    if (val === undefined || val === null || val === '') return res;

    if (typeof val === 'number') {
        res.val = val;
        return res;
    }

    let str = val.toString().trim();
    res.raw = str;

    if (str.toLowerCase().includes(' ou ')) {
        res.text = str;
        return res;
    }

    if (str.includes('=')) {
        const parts = str.split('=');
        const resultStr = parts[parts.length - 1];
        res.val = parseFloat(resultStr.replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
        return res;
    }

    if (/^[\d\s€\.\,\+\-]+$/.test(str)) {
        const eqn = str.replace(/,/g, '.').replace(/€/g, '');
        try {
            res.val = Function('"use strict";return (' + eqn + ')')();
            return res;
        } catch (e) { }
    }

    const nums = str.match(/(\d+[.,]?\d*)/g);
    if (nums && nums.length > 1 && /[a-zA-Z]/.test(str)) {
        let total = 0;
        nums.forEach(n => {
            total += parseFloat(n.replace(',', '.'));
        });
        res.val = total;
        res.isComment = true;
        return res;
    }

    if (/[a-zA-Z]/.test(str)) {
        res.text = str;
        res.isComment = true;
        return res;
    }

    res.val = parseFloat(str.replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
    return res;
}


class DataManager {
    constructor() {
        this.rawData = [];
        this.members = [];
        this.headerRowIndex = 1;
        this.columnVisibility = this.loadVisibilitySettings();
    }

    async parseExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });

                    let sheetName = "";
                    const inscriptionSheet = workbook.SheetNames.find(s => s.toLowerCase().includes("inscription"));
                    sheetName = inscriptionSheet || workbook.SheetNames[0];

                    const worksheet = workbook.Sheets[sheetName];
                    this.rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    this.processData();
                    this.saveToStorage();
                    resolve(this.members);
                } catch (error) {
                    reject(error);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    processData() {
        this.members = [];
        for (let i = this.headerRowIndex + 1; i < this.rawData.length; i++) {
            const row = this.rawData[i];
            if (!row || row.length === 0) continue;
            // Pad row if needed
            while (row.length <= 30) row.push("");

            // Basic Validity Check
            if (!row[CONFIG.COLS.NAME]) continue;

            const member = this.mapRowToMember(row, i);
            this.members.push(member);
        }
    }

    mapRowToMember(row, index) {
        const C = CONFIG.COLS;
        const getStr = (idx) => (row[idx] || "").toString().trim();

        // Parse Smart Money Fields
        const mAmountDue = parseSmartMoney(row[C.AMOUNT_DUE]);
        const mPaid1 = parseSmartMoney(row[C.PAID_1]);
        const mPaid2 = parseSmartMoney(row[C.PAID_2]);

        // Column 0 is "Fiche Rentrée" (true/false)
        const hasFiche = row[C.FICHE] === true || row[C.FICHE] === "True" || row[C.FICHE] === 1;

        // "Active" state stored in C.ACTIVE_STATE or default true
        let isActive = true;
        if (row[C.ACTIVE_STATE] !== undefined && row[C.ACTIVE_STATE] !== "") {
            isActive = row[C.ACTIVE_STATE] === true || row[C.ACTIVE_STATE] === "True";
        }

        const member = {
            id: index,
            hasFiche: hasFiche, // Column 0
            active: isActive,   // Column 23 (Virtual)

            name: getStr(C.NAME),
            courses: getStr(C.COURSES),
            nbHours: getStr(C.NB_HOURS),
            reduction: getStr(C.REDUCTION),

            amountDue: mAmountDue.val,
            amountDueDetails: mAmountDue,

            paymentType: getStr(C.PAYMENT_TYPE),

            paid1: mPaid1.val,
            paid1Details: mPaid1,

            date1: row[C.DATE_1],

            paid2: mPaid2.val,
            paid2Details: mPaid2,

            date2: row[C.DATE_2],

            telStudent: getStr(C.TEL_STUDENT),
            parentsName: getStr(C.PARENTS_NAME),
            telParents: getStr(C.TEL_PARENTS),
            mailStudent: getStr(C.MAIL_STUDENT),
            mailParents: getStr(C.MAIL_PARENTS),
            address: getStr(C.ADDRESS),
            cp: getStr(C.CP),
            city: getStr(C.CITY),
            dob: getStr(C.DOB),
            pob: getStr(C.POB),
            other: getStr(C.OTHER),
            sex: getStr(C.SEX),
            raw: row
        };

        member.amountPaid = this.calculateTotalPaid(member);
        member.status = this.calculateStatus(member);
        member.pricingCheck = this.verifyPrice(member);

        return member;
    }

    calculateTotalPaid(member) {
        let validPaid = 0;
        if (this.isValidDate(member.date1)) validPaid += member.paid1;
        if (this.isValidDate(member.date2)) validPaid += member.paid2;
        return validPaid;
    }

    calculateStatus(member) {
        if (member.amountDueDetails.text) return 'N/A';
        const validPaid = member.amountPaid;
        const due = member.amountDue;
        if ((!due || due === 0) && validPaid === 0) return 'N/A';

        if (validPaid >= due - 0.1) return 'Payé';
        if (validPaid > 0 && validPaid < due) return 'A moitié payé';
        return 'Non payé';
    }

    verifyPrice(member) {
        if (member.amountDueDetails.text) return { status: 'unknown', msg: 'Prix texte' };

        let hoursKey = member.nbHours;
        if (!isNaN(parseFloat(hoursKey))) hoursKey = parseFloat(hoursKey);

        if (String(hoursKey).toLowerCase().includes("forfait")) hoursKey = "FA";

        const row = CONFIG.PRICING.find(r => r[0] == hoursKey);
        if (!row) return { status: 'unknown', diff: 0, target: 0, msg: 'Heures?' };

        const isSemestre = member.paymentType.toLowerCase().includes("semestre");
        const red = member.reduction.toLowerCase();
        let colIndex = 2; // Default Standard Year

        if (red.includes("10") || red.includes("0.1")) {
            colIndex = isSemestre ? 3 : 4;
        } else if (red.includes("15") || red.includes("0.15")) {
            colIndex = isSemestre ? 5 : 6;
        } else if (red.includes("fam") || red.includes("nomb")) {
            colIndex = isSemestre ? 7 : 8;
        } else {
            colIndex = isSemestre ? 1 : 2;
        }

        let targetPrice = row[colIndex];
        const paid = member.amountPaid;
        const diff = paid - targetPrice;

        if (Math.abs(diff) < 1) return { status: 'ok', diff: 0, target: targetPrice, msg: 'Exact' };
        if (diff > 0) return { status: 'over', diff: diff, target: targetPrice, msg: `+${diff.toFixed(2)}€` };
        return { status: 'under', diff: diff, target: targetPrice, msg: `${diff.toFixed(2)}€` };
    }

    isValidDate(val) {
        if (!val) return false;
        if (typeof val === 'string' && val.trim() === '') return false;
        return true;
    }

    parseCurrency(val) {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        const cleaned = val.toString().replace(/[^\d.,]/g, "").replace(',', '.');
        return parseFloat(cleaned) || 0;
    }

    saveToStorage() {
        const payload = {
            rawData: this.rawData,
            visibility: this.columnVisibility
        };
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn("Storage full or error", e);
        }
    }

    loadFromStorage() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.rawData && parsed.rawData.length > 0) {
                    this.rawData = parsed.rawData;
                    this.processData();
                    return true;
                }
            } catch (e) {
                console.error("Error loading storage", e);
            }
        }
        return false;
    }

    loadVisibilitySettings() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (stored) {
            try { return JSON.parse(stored).visibility || {}; } catch (e) { }
        }
        return {};
    }

    saveVisibility(settings) {
        this.columnVisibility = settings;
        this.saveToStorage();
    }

    getStats() {
        return {
            total: this.members.length,
            active: this.members.filter(m => m.active).length,
            paid: this.members.filter(m => m.status === 'Payé').length,
            unpaid: this.members.filter(m => m.status === 'Non payé').length,
            partial: this.members.filter(m => m.status === 'A moitié payé').length
        };
    }
}

class UIManager {
    constructor(app) {
        this.app = app;
        this.elements = {
            dropZone: document.getElementById('dropZone'),
            fileInput: document.getElementById('fileInput'),
            tableContainer: document.getElementById('tableContainer'),
            tableHeader: document.querySelector('.data-table thead tr'),
            tableBody: document.getElementById('tableBody'),
            searchInput: document.getElementById('searchInput'),
            totalMembers: document.getElementById('totalMembers'),
            activeMembers: document.getElementById('activeMembers'),
            filterPayment: document.getElementById('filterPayment'),
            exportBtn: document.getElementById('exportBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            tarifsBtn: document.getElementById('tarifsBtn')
        };

        this.columnsDefs = [
            { key: 'hasFiche', label: 'Fiche', type: 'bool' }, // Was Active, now Fiche
            { key: 'name', label: 'Nom Prénom', type: 'text' },
            { key: 'courses', label: 'Cours', type: 'text' },
            { key: 'status', label: 'Statut', type: 'status' },
            { key: 'pricingCheck', label: 'Verif. Prix', type: 'verif' },
            { key: 'nbHours', label: 'Nb H', type: 'text' },
            { key: 'reduction', label: 'Réduc', type: 'text' },
            { key: 'amountDue', label: 'Doit Payer', type: 'smart_money' },
            { key: 'paymentType', label: 'Type', type: 'text' },
            { key: 'paid1', label: 'Payé 1', type: 'smart_money' },
            { key: 'date1', label: 'Date 1', type: 'date' },
            { key: 'paid2', label: 'Payé 2', type: 'smart_money' },
            { key: 'date2', label: 'Date 2', type: 'date' },
            { key: 'telStudent', label: 'Tél Élève', type: 'text' },
            { key: 'parentsName', label: 'Responsable', type: 'text' },
            { key: 'telParents', label: 'Tél Parents', type: 'text' },
            { key: 'mailStudent', label: 'Mail Élève', type: 'text' },
            { key: 'mailParents', label: 'Mail Parents', type: 'text' },
            { key: 'address', label: 'Adresse', type: 'text' },
            { key: 'cp', label: 'CP', type: 'text' },
            { key: 'city', label: 'Ville', type: 'text' },
            { key: 'dob', label: 'Naissance', type: 'date' },
            { key: 'pob', label: 'Lieu Nais.', type: 'text' },
            { key: 'other', label: 'Autre', type: 'text' },
            { key: 'sex', label: 'Sexe', type: 'text' },
        ];

        this.bindEvents();
        this.utils = {
            openModal: (id) => {
                const modal = document.getElementById(id);
                if (modal) modal.classList.remove('hidden');
            },
            closeModal: (id) => {
                const modal = document.getElementById(id);
                if (modal) modal.classList.add('hidden');
            }
        };
    }

    bindEvents() {
        // ... (Events remain similar) ... 
        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.app.handleFileUpload(e.target.files[0]);
        });

        this.elements.searchInput.addEventListener('input', () => this.renderTable(this.app.currentData));
        this.elements.filterPayment.addEventListener('change', () => this.renderTable(this.app.currentData));

        this.elements.exportBtn.addEventListener('click', () => {
            if (this.app.currentData.length > 0) this.app.exportData();
            else Swal.fire('Info', 'Aucune donnée à exporter', 'warning');
        });

        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.addEventListener('click', () => this.openSettingsModal());
        }

        if (this.elements.tarifsBtn) {
            this.elements.tarifsBtn.addEventListener('click', () => {
                this.renderTarifs();
                this.utils.openModal('tarifsModal');
            });
        }

        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-modal') || e.target.classList.contains('close-modal-btn')) {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.utils.closeModal(modal.id);
                }
            }
            if (e.target.classList.contains('modal')) {
                this.utils.closeModal(e.target.id);
            }
        });

        document.getElementById('editForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.app.saveEdit();
        });

        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            this.saveSettings();
        });

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.elements.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        this.elements.dropZone.addEventListener('dragover', () => this.elements.dropZone.classList.add('drag-over'));
        this.elements.dropZone.addEventListener('dragleave', () => this.elements.dropZone.classList.remove('drag-over'));
        this.elements.dropZone.addEventListener('drop', (e) => {
            this.elements.dropZone.classList.remove('drag-over');
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) this.app.handleFileUpload(files[0]);
        });
    }

    showLoading() {
        Swal.fire({
            title: 'Chargement...',
            text: 'Traitement en cours',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
    }

    hideLoading() {
        Swal.close();
    }

    updateStats(stats) {
        this.elements.totalMembers.textContent = stats.total;
        this.elements.activeMembers.textContent = stats.active;
    }

    renderTable(data) {
        const searchQuery = this.elements.searchInput.value.toLowerCase();
        const filterPayment = this.elements.filterPayment.value;
        const visibility = this.app.dataManager.columnVisibility;

        this.elements.dropZone.classList.add('hidden');
        this.elements.tableContainer.classList.remove('hidden');

        this.elements.tableHeader.innerHTML = '';

        this.columnsDefs.forEach(col => {
            if (visibility[col.key] !== false) {
                const th = document.createElement('th');
                th.textContent = col.label;
                this.elements.tableHeader.appendChild(th);
            }
        });
        const thAction = document.createElement('th');
        thAction.textContent = 'Actions';
        this.elements.tableHeader.appendChild(thAction);

        const filtered = data.filter(m => {
            const matchesSearch = (m.name || "").toLowerCase().includes(searchQuery) ||
                (m.courses || "").toLowerCase().includes(searchQuery);

            let matchesFilter = true;
            if (filterPayment === 'paid') matchesFilter = m.status === 'Payé';
            if (filterPayment === 'unpaid') matchesFilter = m.status === 'Non payé';
            if (filterPayment === 'partial') matchesFilter = m.status === 'A moitié payé';
            if (filterPayment === 'na') matchesFilter = m.status === 'N/A';

            return matchesSearch && matchesFilter;
        });

        // Use member.active for sorting active vs inactive
        filtered.sort((a, b) => (a.active === b.active) ? 0 : a.active ? -1 : 1);

        this.elements.tableBody.innerHTML = '';
        const fragment = document.createDocumentFragment();

        filtered.forEach(member => {
            const tr = document.createElement('tr');
            // Dim Row if Inactive
            if (!member.active) tr.classList.add('row-inactive');

            this.columnsDefs.forEach(col => {
                if (visibility[col.key] !== false) {
                    const td = document.createElement('td');
                    td.innerHTML = this.formatCell(member, col);
                    tr.appendChild(td);
                }
            });

            const tdActions = document.createElement('td');
            tdActions.style.whiteSpace = 'nowrap';
            // Switch toggles Active/Inactive status, NOT Fiche status
            tdActions.innerHTML = `
                <button class="btn btn-secondary btn-sm" onclick="app.openEdit(${member.id})">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="app.toggleActive(${member.id})">
                    <i class="fa-solid ${member.active ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                </button>
            `;
            tr.appendChild(tdActions);
            fragment.appendChild(tr);
        });

        this.elements.tableBody.appendChild(fragment);

        if (filtered.length === 0) {
            const colSpan = this.columnsDefs.filter(c => visibility[c.key] !== false).length + 1;
            this.elements.tableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding: 2rem;">Aucun membre trouvé</td></tr>`;
        }
    }

    formatCell(member, col) {
        let val = member[col.key];

        let details = null;
        if (col.key === 'amountDue') details = member.amountDueDetails;
        if (col.key === 'paid1') details = member.paid1Details;
        if (col.key === 'paid2') details = member.paid2Details;

        if (col.key === 'hasFiche') {
            // This is now "Fiche Rentrée" (Column 0)
            // Should verify if true/false
            return `<span class="status-dot ${val ? 'status-active' : 'status-inactive'}"></span>`;
        }
        if (col.key === 'status') {
            let cls = 'status-na';
            if (val === 'Payé') cls = 'status-paid';
            if (val === 'Non payé') cls = 'status-unpaid';
            if (val === 'A moitié payé') cls = 'status-partial';
            if (val === 'N/A') return `<span style="color: var(--text-muted); font-size: 0.9em;">N/A</span>`;
            return `<span class="${cls}" style="font-weight: 600;">${val}</span>`;
        }
        if (col.type === 'verif') {
            const check = val;
            if (!check) return '';
            if (check.status === 'unknown') return '<span style="color:var(--text-muted)">?</span>';
            if (check.status === 'ok') return '<span style="color:var(--success); font-weight:bold;"><i class="fa-solid fa-check"></i> OK</span>';
            if (check.status === 'over') return `<span style="color:var(--info); font-weight:bold;">${check.msg}</span>`;
            if (check.status === 'under') return `<span style="color:var(--danger); font-weight:bold;">${check.msg}</span>`;
            return '';
        }
        if (col.type === 'smart_money') {
            if (details) {
                if (details.text) return `<span title="${details.raw}">${details.text}</span>`;
                if (details.isComment) {
                    return `<span>${parseFloat(details.val).toFixed(2)} € <i class="fa-solid fa-comment-dots" style="color:var(--info)" title="${details.raw}"></i></span>`;
                }
                if (details.val === 0) return '<span style="color: var(--text-muted)">-</span>';
                return `${parseFloat(details.val).toFixed(2)} €`;
            }
            if (val === 0 || val === '0') return '<span style="color: var(--text-muted)">-</span>';
            return `${parseFloat(val).toFixed(2)} €`;
        }
        if (col.type === 'money') {
            if (val === 0 || val === '0') return '<span style="color: var(--text-muted)">-</span>';
            return `${parseFloat(val).toFixed(2)} €`;
        }
        if (col.type === 'date') {
            return formatDate(val);
        }

        return val || '';
    }

    openSettingsModal() {
        // ... (Remains same)
        const container = document.getElementById('settingsColumnsList');
        container.innerHTML = '';
        const visibility = this.app.dataManager.columnVisibility;

        this.columnsDefs.forEach(col => {
            const div = document.createElement('div');
            div.className = 'checkbox-item';

            const isChecked = visibility[col.key] !== false;

            div.innerHTML = `
                <label class="custom-checkbox">
                    <input type="checkbox" id="col_${col.key}" ${isChecked ? 'checked' : ''}>
                    <span class="checkmark"></span>
                    ${col.label}
                </label>
            `;
            container.appendChild(div);
        });

        this.utils.openModal('settingsModal');
    }

    renderTarifs() {
        const tbody = document.querySelector('#tarifsTable tbody');
        tbody.innerHTML = '';
        CONFIG.PRICING.forEach(row => {
            const tr = document.createElement('tr');
            row.forEach(cell => {
                const td = document.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    saveSettings() {
        const newSettings = {};
        this.columnsDefs.forEach(col => {
            const cb = document.getElementById(`col_${col.key}`);
            newSettings[col.key] = cb.checked;
        });

        this.app.dataManager.saveVisibility(newSettings);
        this.utils.closeModal('settingsModal');
        this.renderTable(this.app.currentData);
    }

    fillEditForm(member) {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = (val === undefined || val === null) ? '' : val;
        };
        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        const toInputDate = (d) => {
            if (!d) return '';
            let dateObj;
            if (d instanceof Date) dateObj = d;
            else dateObj = new Date(d);
            if (isNaN(dateObj.getTime())) return '';
            return dateObj.toISOString().split('T')[0];
        };

        setVal('editId', member.id);
        setVal('editName', member.name);

        // Edit Fiche
        setCheck('editActive', member.hasFiche);
        // TODO: We might need a separate checkbox for "Est Actif" in the edit form if user wants to change it there too

        setVal('editCourses', member.courses);
        setVal('editNbHours', member.nbHours);
        setVal('editReduction', member.reduction);
        setVal('editAmountDue', member.amountDue);
        setVal('editPaymentType', member.paymentType);
        setVal('editPaid1', member.paid1);
        setVal('editDate1', toInputDate(member.date1));
        setVal('editPaid2', member.paid2);
        setVal('editDate2', toInputDate(member.date2));

        setVal('editTelStudent', member.telStudent);
        setVal('editParentsName', member.parentsName);
        setVal('editTelParents', member.telParents);
        setVal('editMailStudent', member.mailStudent);
        setVal('editMailParents', member.mailParents);
        setVal('editAddress', member.address);
        setVal('editCP', member.cp);
        setVal('editCity', member.city);
        setVal('editDOB', toInputDate(member.dob));
        setVal('editPOB', member.pob);
        setVal('editOther', member.other);
        setVal('editSex', member.sex);
    }
}

class App {
    constructor() {
        this.dataManager = new DataManager();
        this.uiManager = new UIManager(this);
        setTimeout(() => this.init(), 100);
    }

    async init() {
        if (this.dataManager.loadFromStorage()) {
            console.log("Restored from storage");
            this.uiManager.updateStats(this.dataManager.getStats());
            this.uiManager.renderTable(this.dataManager.members);
        }
    }

    get currentData() {
        return this.dataManager.members;
    }

    async handleFileUpload(file) {
        this.uiManager.showLoading();
        try {
            await this.dataManager.parseExcel(file);
            this.uiManager.updateStats(this.dataManager.getStats());
            this.uiManager.renderTable(this.dataManager.members);
            this.uiManager.hideLoading();
            Swal.fire({ icon: 'success', title: 'Fichier chargé', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
        } catch (error) {
            console.error(error);
            this.uiManager.hideLoading();
            Swal.fire('Erreur', 'Impossible de lire le fichier.', 'error');
        }
    }

    openEdit(id) {
        const member = this.dataManager.members.find(m => m.id === id);
        if (!member) return;
        this.uiManager.fillEditForm(member);
        this.uiManager.utils.openModal('editModal');
    }

    saveEdit() {
        const id = parseInt(document.getElementById('editId').value);
        const member = this.dataManager.members.find(m => m.id === id);
        if (!member) return;

        const raw = this.dataManager.rawData[member.id];
        const C = CONFIG.COLS;

        const getVal = (id) => document.getElementById(id).value;
        const getNum = (id) => {
            const v = document.getElementById(id).value;
            // Allow commas
            return parseFloat(v.replace(',', '.')) || 0;
        };

        // Save "Fiche Rentrée" status
        const hasFiche = document.getElementById('editActive').checked;
        raw[C.FICHE] = hasFiche;

        raw[C.NAME] = getVal('editName');
        raw[C.COURSES] = getVal('editCourses');
        raw[C.NB_HOURS] = getVal('editNbHours');
        raw[C.REDUCTION] = getVal('editReduction');
        raw[C.AMOUNT_DUE] = getNum('editAmountDue');
        raw[C.PAYMENT_TYPE] = getVal('editPaymentType');
        raw[C.PAID_1] = getNum('editPaid1');
        raw[C.DATE_1] = getVal('editDate1');
        raw[C.PAID_2] = getNum('editPaid2');
        raw[C.DATE_2] = getVal('editDate2');

        raw[C.TEL_STUDENT] = getVal('editTelStudent');
        raw[C.PARENTS_NAME] = getVal('editParentsName');
        raw[C.TEL_PARENTS] = getVal('editTelParents');
        raw[C.MAIL_STUDENT] = getVal('editMailStudent');
        raw[C.MAIL_PARENTS] = getVal('editMailParents');
        raw[C.ADDRESS] = getVal('editAddress');
        raw[C.CP] = getVal('editCP');
        raw[C.CITY] = getVal('editCity');
        raw[C.DOB] = getVal('editDOB');
        raw[C.POB] = getVal('editPOB');
        raw[C.OTHER] = getVal('editOther');
        raw[C.SEX] = getVal('editSex');

        const newMember = this.dataManager.mapRowToMember(raw, id);
        const idx = this.dataManager.members.findIndex(m => m.id === id);
        this.dataManager.members[idx] = newMember;

        this.dataManager.saveToStorage();

        this.uiManager.utils.closeModal('editModal');
        this.uiManager.updateStats(this.dataManager.getStats());
        this.uiManager.renderTable(this.dataManager.members);

        Swal.fire({ icon: 'success', title: 'Sauvegardé', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
    }

    toggleActive(id) {
        const member = this.dataManager.members.find(m => m.id === id);
        if (member) {
            // Toggle Logic
            member.active = !member.active;

            // Persist in virtual column
            this.dataManager.rawData[member.id][CONFIG.COLS.ACTIVE_STATE] = member.active;

            this.dataManager.saveToStorage();
            this.uiManager.renderTable(this.dataManager.members);
            this.uiManager.updateStats(this.dataManager.getStats());
        }
    }

    exportData() {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(this.dataManager.rawData);
        XLSX.utils.book_append_sheet(wb, ws, "Inscriptions");
        const date = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `SF_Inscriptions_v2_${date}.xlsx`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
