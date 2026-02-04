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

    // Handle slash as 0/Empty
    if (val.toString().trim() === '/') return res;

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

    // Handle "Je dois..." type comments (no numbers or very complex)
    // If it starts with non-digit and has no obvious math, treat as text
    if (/^[a-zA-Z]/.test(str) && !/\d/.test(str)) {
        res.text = str;
        res.isComment = true;
        return res;
    }

    // Explicit Math with "="
    if (str.includes('=')) {
        const parts = str.split('=');
        const resultStr = parts[parts.length - 1];
        res.val = parseFloat(resultStr.replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
        return res;
    }

    // Try Math Evaluation (Clean € and spaces)
    if (/^[\d\s€\.\,\+\-\*\/\(\)]+$/.test(str)) {
        const eqn = str.replace(/,/g, '.').replace(/€/g, '');
        try {
            // Safety check: only allow digits and math operators
            if (/^[\d\.\+\-\*\/\(\)\s]+$/.test(eqn)) {
                res.val = Function('"use strict";return (' + eqn + ')')();
                return res;
            }
        } catch (e) { }
    }

    const nums = str.match(/(\d+[.,]?\d*)/g);

    // Handle "90 en liquide" -> Extract 90
    if (nums && nums.length === 1 && /[a-zA-Z]/.test(str)) {
        res.val = parseFloat(nums[0].replace(',', '.'));
        res.isComment = true; // Mark as having comment
        return res;
    }

    // Handle Sum of multiple numbers in text
    if (nums && nums.length > 1 && /[a-zA-Z]/.test(str)) {
        let total = 0;
        nums.forEach(n => {
            total += parseFloat(n.replace(',', '.'));
        });
        res.val = total;
        res.isComment = true;
        return res;
    }

    // Fallback text check
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

    // Phone Formatter
    formatPhoneNumber(val) {
        if (!val) return "";
        let str = val.toString().trim();
        if (str === "" || str === "/" || str === "-" || str === "@") return "";

        // Clean .00 suffix typical in Excel imports
        if (str.endsWith('.00')) str = str.substring(0, str.length - 3);

        // Split multiple numbers
        // Fix: Strings with newlines should split. Strings with spaces around / should split.
        // \n, \r, " - ", " / ", " ou ", " et "
        const parts = str.split(/[\n\r]|\s+\/\s+|\s+ou\s+|\s+et\s+|\s+-\s+| - /i);

        const formatSingle = (raw) => {
            let clean = raw.replace(/[^\d+]/g, '');

            if (!clean) return "";

            // 0032 -> +32
            if (clean.startsWith('0032')) clean = '+32' + clean.substring(4);

            // 32... (without +) -> +32... (only if length suggests it, 32 + 9 digits = 11 digits)
            if (clean.startsWith('32') && clean.length === 11) clean = '+' + clean;

            // 33... (France) -> +33...
            if (clean.startsWith('33') && clean.length === 11) clean = '+' + clean;

            // 04... -> +32 4...
            if (clean.startsWith('0')) clean = '+32' + clean.substring(1);

            // Case: "498728675" (missing leading 0, 9 digits starting with 4)
            if (!clean.startsWith('+') && clean.length === 9 && clean.startsWith('4')) {
                clean = '+32' + clean;
            }

            // Case: "4475..." (Mistyped 0475 as 4475? Or valid UK +44 75?)
            // "4475 954362" (10 digits).
            if (!clean.startsWith('+') && clean.length === 10 && clean.startsWith('447')) {
                clean = '+32' + clean.substring(1); // Treat leading 4 as 0 -> +32 475...
            }

            if (clean.startsWith('+32')) {
                let rest = clean.substring(3);
                if (rest.length === 9) {
                    return `+32 ${rest.substring(0, 3)} ${rest.substring(3, 5)} ${rest.substring(5, 7)} ${rest.substring(7, 9)}`;
                }
                if (rest.length === 8) {
                    return `+32 ${rest.substring(0, 2)} ${rest.substring(2, 4)} ${rest.substring(4, 6)} ${rest.substring(6, 8)}`;
                }
            }

            // French Format: +33 6 XX XX XX XX
            if (clean.startsWith('+33')) {
                let rest = clean.substring(3);
                // Mobile/Standard is 9 digits after +33
                if (rest.length === 9) {
                    // +33 6 08 56 70 46
                    return `+33 ${rest.substring(0, 1)} ${rest.substring(1, 3)} ${rest.substring(3, 5)} ${rest.substring(5, 7)} ${rest.substring(7, 9)}`;
                }
            }

            return clean;
        };

        return parts.map(p => formatSingle(p)).filter(Boolean).join(' / ');
    }

    mapRowToMember(row, index) {
        const C = CONFIG.COLS;
        const getStr = (idx) => {
            const val = (row[idx] || "").toString().trim();
            if (val === '/' || val === '-') return '';
            return val;
        };

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

            telStudent: this.formatPhoneNumber(getStr(C.TEL_STUDENT)),
            parentsName: getStr(C.PARENTS_NAME),
            telParents: this.formatPhoneNumber(getStr(C.TEL_PARENTS)),
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
        member.remaining = member.amountDue - member.amountPaid;
        member.status = this.calculateStatus(member);
        member.pricingCheck = this.verifyPrice(member);

        return member;
    }

    calculateTotalPaid(member) {
        let validPaid = 0;
        // Fix: Count payment even if date is missing (e.g. "90 en liquide" with empty date)
        if (member.paid1) validPaid += member.paid1;
        if (member.paid2) validPaid += member.paid2;
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

        // Handle "Carte" Exception
        const red = (member.reduction || "").toString().toLowerCase();
        if (red.includes('carte')) {
            const targetPrice = member.amountDue;
            const paid = member.amountPaid;
            const diff = paid - targetPrice;

            if (Math.abs(diff) < 1) return { status: 'ok', diff: 0, target: targetPrice, msg: 'Carte' };
            if (diff > 0) return { status: 'over', diff: diff, target: targetPrice, msg: `+${diff.toFixed(2)}€` };
            return { status: 'under', diff: diff, target: targetPrice, msg: `${diff.toFixed(2)}€` };
        }

        let hoursKey = member.nbHours;
        if (!isNaN(parseFloat(hoursKey))) hoursKey = parseFloat(hoursKey);

        if (String(hoursKey).toLowerCase().includes("forfait")) hoursKey = "FA";

        const row = CONFIG.PRICING.find(r => r[0] == hoursKey);
        if (!row) return { status: 'unknown', diff: 0, target: 0, msg: 'Heures?' };

        const isSemestre = member.paymentType.toLowerCase().includes("semestre");

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
            if (this.app && this.app.currentData.length > 0) {
                this.app.uiManager.openExportModal();
            } else {
                Swal.fire('Info', 'Aucune donnée à exporter', 'warning');
            }
        });

        // Event Delegation for Table Actions (Click)
        this.elements.tableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            const id = parseInt(btn.dataset.id);
            if (isNaN(id)) return;

            if (btn.classList.contains('action-reminder')) {
                this.app.openReminder(id);
            }
            if (btn.classList.contains('action-edit')) {
                this.app.openEdit(id);
            }
            if (btn.classList.contains('action-toggle')) {
                this.app.toggleActive(id);
            }
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

        // Double Click to Inline Edit
        this.elements.tableBody.addEventListener('dblclick', (e) => {
            const td = e.target.closest('td');
            if (!td) return;

            // Skip action column or cells without data-key
            if (!td.dataset.key || !td.dataset.id) return;

            const key = td.dataset.key;
            // Prevent editing of virtual/complex columns if needed
            if (key === 'pricingCheck' || key === 'status' || key === 'hasFiche') return;

            this.app.handleInlineEdit(td);
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
                    td.dataset.id = member.id; // Member ID
                    td.dataset.key = col.key;  // Column Key
                    td.innerHTML = this.formatCell(member, col);
                    tr.appendChild(td);
                }
            });

            const tdActions = document.createElement('td');
            tdActions.style.whiteSpace = 'nowrap';
            // Switch toggles Active/Inactive status, NOT Fiche status
            tdActions.innerHTML = `
                <button class="btn btn-secondary btn-sm action-reminder" data-id="${member.id}" title="Envoyer un rappel">
                    <i class="fa-solid fa-comments-dollar pointer-events-none"></i>
                </button>
                <button class="btn btn-secondary btn-sm action-edit" data-id="${member.id}" title="Éditer">
                    <i class="fa-solid fa-pen pointer-events-none"></i>
                </button>
                <button class="btn btn-secondary btn-sm action-toggle" data-id="${member.id}" title="Activer/Désactiver">
                    <i class="fa-solid ${member.active ? 'fa-toggle-on' : 'fa-toggle-off'} pointer-events-none"></i>
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
                    const iconColor = details.val === 0 ? 'var(--text-muted)' : 'var(--info)';
                    const valDisplay = details.val === 0 ? '' : `${parseFloat(details.val).toFixed(2)} € `;
                    return `<span>${valDisplay}<i class="fa-solid fa-comment-dots" style="color:${iconColor}; margin-left:5px;" title="${details.raw}"></i></span>`;
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

    openExportModal() {
        this.utils.openModal('exportModal');
    }

    closeExportModal() {
        this.utils.closeModal('exportModal');
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

    openReminder(id) {
        const member = this.dataManager.members.find(m => m.id === id);
        if (member) {
            if (window.reminderManager) {
                window.reminderManager.openModal(member);
            } else {
                console.error("ReminderManager not found");
                Swal.fire('Erreur', 'Module de rappel introuvable.', 'error');
            }
        }
    }

    processExport() {
        this.uiManager.closeExportModal();
        this.uiManager.showLoading();

        setTimeout(() => {
            try {
                const useFormattedPhone = document.getElementById('exportFormattedPhone').checked;
                const useStatus = document.getElementById('exportColStatus').checked;
                const useBalance = document.getElementById('exportColBalance').checked;

                // Clone raw data to avoid mutating original
                // We need a deep clone if we modify values, or just map.
                const exportData = this.dataManager.rawData.map(row => [...row]); // Shallow clone of rows is enough if primitive

                // Headers are usually row 0 ? No, rawData is data only probably? 
                // Wait, SheetJS typically imports headers as row 0 if using sheet_to_json with header:1
                // Assuming row 0 is headers.
                const headers = exportData[0];

                // Add extra headers
                if (useStatus) headers.push('Statut');
                if (useBalance) headers.push('Solde Restant');

                // Process Data Rows (start at 1)
                for (let i = 1; i < exportData.length; i++) {
                    const row = exportData[i];

                    // Standardize Phones logic
                    if (useFormattedPhone) {
                        const C = CONFIG.COLS;
                        if (row[C.TEL_STUDENT]) row[C.TEL_STUDENT] = this.formatPhoneNumber(row[C.TEL_STUDENT]);
                        if (row[C.TEL_PARENTS]) row[C.TEL_PARENTS] = this.formatPhoneNumber(row[C.TEL_PARENTS]);
                    }

                    // Extra Columns logic
                    // We need to re-calculate member status for this row
                    // Conveniently, we can map row to member object logic
                    // But mapRowToMember depends on 'this.dataManager.rawData' potentially? 
                    // No, it handles row. But verifyPrice and calculateTotalPaid need the specific row logic.
                    // The App instance has 'this.dataManager.members' which matches the *current* state (edited).
                    // Best way: Use the 'member' object we already have in memory!
                    // Problem: dataManager.members might be filtered/sorted? No, it holds all.
                    // But rawData index match? 'id' maps to index in rawData usually? 
                    // Let's rely on member ID which matches row index in our simplified model (id = index).

                    const member = this.dataManager.members.find(m => m.id === i); // i corresponds to row index for id
                    if (member) {
                        if (useStatus) row.push(member.status);
                        if (useBalance) row.push(Number(member.remaining).toFixed(2) + ' €');
                    } else {
                        // Header row or invalid
                        if (useStatus) row.push('');
                        if (useBalance) row.push('');
                    }
                }

                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_sheet(exportData);
                XLSX.utils.book_append_sheet(wb, ws, "Inscriptions");
                const date = new Date().toISOString().slice(0, 10);
                XLSX.writeFile(wb, `SF_Inscriptions_Export_${date}.xlsx`);

                this.uiManager.hideLoading();
                Swal.fire({ icon: 'success', title: 'Export réussi', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });

            } catch (e) {
                console.error(e);
                this.uiManager.hideLoading();
                Swal.fire('Erreur', "L'export a échoué: " + e.message, 'error');
            }
        }, 100);
    }

    handleInlineEdit(td) {
        const id = parseInt(td.dataset.id);
        const key = td.dataset.key;
        const member = this.dataManager.members.find(m => m.id === id);
        if (!member) return;

        let val = member[key];

        // Handle special objects (Smart Money)
        if (key === 'amountDue' || key === 'paid1' || key === 'paid2') {
            if (member[key + 'Details']) val = member[key + 'Details'].raw;
        }

        const width = td.offsetWidth;

        // Sanitize value for attribute
        const safeVal = (val !== undefined && val !== null) ? String(val).replace(/"/g, '&quot;') : '';

        // Preserve current text alignment if needed, but usually inherits
        td.innerHTML = `<input type="text" class="inline-edit-input" value="${safeVal}">`;
        const input = td.querySelector('input');
        input.focus();

        const save = () => {
            const newVal = input.value;
            const C = CONFIG.COLS;

            // Map keys
            const keyMap = {
                'name': C.NAME,
                'courses': C.COURSES,
                'nbHours': C.NB_HOURS,
                'reduction': C.REDUCTION,
                'amountDue': C.AMOUNT_DUE,
                'paymentType': C.PAYMENT_TYPE,
                'paid1': C.PAID_1,
                'date1': C.DATE_1,
                'paid2': C.PAID_2,
                'date2': C.DATE_2,
                'telStudent': C.TEL_STUDENT,
                'parentsName': C.PARENTS_NAME,
                'telParents': C.TEL_PARENTS,
                'mailStudent': C.MAIL_STUDENT,
                'mailParents': C.MAIL_PARENTS,
                'address': C.ADDRESS,
                'cp': C.CP,
                'city': C.CITY,
                'dob': C.DOB,
                'pob': C.POB,
                'other': C.OTHER,
                'sex': C.SEX
            };

            const colIdx = keyMap[key];

            if (colIdx !== undefined) {
                this.dataManager.rawData[id][colIdx] = newVal;
                const newMember = this.dataManager.mapRowToMember(this.dataManager.rawData[id], id);
                const memIdx = this.dataManager.members.findIndex(m => m.id === id);
                this.dataManager.members[memIdx] = newMember;

                this.dataManager.saveToStorage();
                this.uiManager.renderTable(this.dataManager.members);
                this.uiManager.updateStats(this.dataManager.getStats());
            } else {
                this.uiManager.renderTable(this.dataManager.members);
            }
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    }


}

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.app = new App();
        console.log("SF Manager App initialized");
    } catch (e) {
        alert("Erreur critique au démarrage : " + e.message);
        console.error(e);
    }
});

window.onerror = function (msg, url, lineNo, columnNo, error) {
    alert(`Erreur JS: ${msg}\nLigne: ${lineNo}`);
    return false;
};