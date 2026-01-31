/**
 * Street Family Manager - Core Logic
 */

class DataManager {
    constructor() {
        this.rawData = []; // The original array of arrays (to preserve structure for export)
        this.members = []; // Cleaned object model for the UI
        this.workbook = null;
        this.headerRowIndex = 1; // Based on analysis
    }

    async parseExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    this.workbook = XLSX.read(data, { type: 'array', cellDates: true });

                    let sheetName = "";
                    // Try to find "Inscription" in sheet names, else take 2nd, else 1st
                    const inscriptionSheet = this.workbook.SheetNames.find(s => s.toLowerCase().includes("inscription"));
                    if (inscriptionSheet) {
                        sheetName = inscriptionSheet;
                    } else {
                        sheetName = this.workbook.SheetNames[1] || this.workbook.SheetNames[0];
                    }

                    const worksheet = this.workbook.Sheets[sheetName];

                    // Get data as Array of Arrays
                    this.rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    // Parse into Members Objects
                    this.processData();

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
        // Start from row AFTER header
        // Header is at index 1 -> Data starts at index 2

        for (let i = this.headerRowIndex + 1; i < this.rawData.length; i++) {
            const row = this.rawData[i];

            // Skip empty rows
            if (!row || row.length === 0 || !row[1]) continue;

            // Mapping based on "sample_data.csv" analysis
            const member = {
                id: i, // Keep track of original row index
                active: row[0] === true || row[0] === "True" || row[0] === 1,
                name: row[1] || "",
                courses: row[2] || "",
                amountDue: this.parseCurrency(row[5]),
                paymentType: row[6] || "", // Semestre/Année
                amountPaid: this.parseCurrency(row[7]) + this.parseCurrency(row[9]),
                phone: row[11] || row[13] || "", // Fallback to parent phone
                email: row[14] || row[15] || "",

                // Keep raw reference for editing
                raw: row
            };

            // Payment Status Logic
            if (member.amountPaid >= member.amountDue && member.amountDue > 0) {
                member.paymentStatus = 'paid';
            } else if (member.amountPaid > 0) {
                member.paymentStatus = 'partial';
            } else {
                member.paymentStatus = 'unpaid';
            }

            this.members.push(member);
        }
    }

    parseCurrency(val) {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        // Clean string "140 €" -> 140
        const cleaned = val.toString().replace(/[^\d.,]/g, "").replace(',', '.');
        return parseFloat(cleaned) || 0;
    }

    getStats() {
        return {
            total: this.members.length,
            active: this.members.filter(m => m.active).length,
            paid: this.members.filter(m => m.paymentStatus === 'paid').length,
            unpaid: this.members.filter(m => m.paymentStatus === 'unpaid').length
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
            tableBody: document.getElementById('tableBody'),
            searchInput: document.getElementById('searchInput'),
            totalMembers: document.getElementById('totalMembers'),
            activeMembers: document.getElementById('activeMembers'),
            filterPayment: document.getElementById('filterPayment'),
            exportBtn: document.getElementById('exportBtn')
        };

        this.bindEvents();

        this.utils = {
            openModal: () => document.getElementById('editModal').classList.remove('hidden'),
            closeModal: () => document.getElementById('editModal').classList.add('hidden')
        };
    }

    bindEvents() {
        // File Loading
        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.app.handleFileUpload(e.target.files[0]);
        });

        // Search
        this.elements.searchInput.addEventListener('input', (e) => {
            this.renderTable(this.app.currentData);
        });

        // Filter
        this.elements.filterPayment.addEventListener('change', (e) => {
            this.renderTable(this.app.currentData);
        });

        // Export
        this.elements.exportBtn.addEventListener('click', () => {
            if (this.app.currentData.length > 0) this.app.exportData();
            else Swal.fire('Erreur', 'Aucune donnée à exporter', 'warning');
        });

        // Modal Controls
        document.querySelector('.close-modal').addEventListener('click', () => this.utils.closeModal());
        document.querySelector('.close-modal-btn').addEventListener('click', () => this.utils.closeModal());

        // Edit Form Submit
        document.getElementById('editForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.app.saveEdit();
        });

        // Drag and Drop
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
            text: 'Analyse du fichier en cours',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
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
        const searchQuery = this.elements.searchInput.value;
        const filterPayment = this.elements.filterPayment.value;

        this.elements.dropZone.classList.add('hidden');
        this.elements.tableContainer.classList.remove('hidden');
        this.elements.tableBody.innerHTML = '';

        // Filter Data
        const filtered = data.filter(m => {
            const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                m.courses.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesFilter = filterPayment === 'all' || m.paymentStatus === filterPayment;

            return matchesSearch && matchesFilter;
        });

        // Sort: Active first
        filtered.sort((a, b) => (a.active === b.active) ? 0 : a.active ? -1 : 1);

        filtered.forEach(member => {
            const tr = document.createElement('tr');
            if (!member.active) tr.classList.add('row-inactive');

            // Status Badges
            let payBadgeClass = 'status-unpaid';
            let payText = 'Non Payé';
            if (member.paymentStatus === 'paid') { payBadgeClass = 'status-active'; payText = 'Payé'; }
            else if (member.paymentStatus === 'partial') { payBadgeClass = 'status-warning'; payText = 'Partiel'; }

            tr.innerHTML = `
                <td>
                    <span class="status-dot ${member.active ? 'status-active' : 'status-inactive'}"></span>
                </td>
                <td>
                    <strong>${member.name}</strong>
                    <div style="font-size: 0.8rem; color: var(--text-muted)">${member.email}</div>
                </td>
                <td>${member.courses}</td>
                <td>${member.amountDue} €</td>
                <td>
                    <span class="${payBadgeClass}" style="font-weight: 600;">${payText}</span><br>
                    <small>${member.amountPaid} € reçus</small>
                </td>
                <td>${member.phone}</td>
                <td>
                    <button class="btn btn-secondary" onclick="app.openEdit(${member.id})">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-secondary" onclick="app.toggleActive(${member.id})">
                        <i class="fa-solid ${member.active ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    </button>
                </td>
            `;
            this.elements.tableBody.appendChild(tr);
        });

        if (filtered.length === 0) {
            this.elements.tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem;">Aucun membre trouvé</td></tr>`;
        }
    }
}

class App {
    constructor() {
        this.dataManager = new DataManager();
        this.uiManager = new UIManager(this);
    }

    get currentData() {
        return this.dataManager.members;
    }

    async handleFileUpload(file) {
        this.uiManager.showLoading();
        try {
            await this.dataManager.parseExcel(file);
            console.log("File Parsed");

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

        // Fill form
        document.getElementById('editId').value = member.id;
        document.getElementById('editName').value = member.name;
        document.getElementById('editCourses').value = member.courses;
        document.getElementById('editPaymentType').value = member.paymentType;
        document.getElementById('editAmountDue').value = member.amountDue;

        // Raw values logic for payments (Column 7 & 9)
        // member.raw[7] is Payment 1, member.raw[9] is Payment 2
        document.getElementById('editAmountPaid1').value = this.dataManager.parseCurrency(member.raw[7]);
        document.getElementById('editAmountPaid2').value = this.dataManager.parseCurrency(member.raw[9]);

        document.getElementById('editPhone').value = member.phone;
        document.getElementById('editEmail').value = member.email;

        this.uiManager.utils.openModal();
    }

    saveEdit() {
        const id = parseInt(document.getElementById('editId').value);
        const member = this.dataManager.members.find(m => m.id === id);
        if (!member) return;

        // Update Raw Data (Critical for Export)
        // 1: Name, 2: Course, 5: Due, 6: Type, 7: Paid1, 9: Paid2, 11/13: Phone, 14/15: Email

        const raw = this.dataManager.rawData[member.id];

        raw[1] = document.getElementById('editName').value;
        raw[2] = document.getElementById('editCourses').value;
        raw[6] = document.getElementById('editPaymentType').value;
        raw[5] = parseFloat(document.getElementById('editAmountDue').value) || 0;

        const p1 = parseFloat(document.getElementById('editAmountPaid1').value) || 0;
        const p2 = parseFloat(document.getElementById('editAmountPaid2').value) || 0;
        raw[7] = p1;
        raw[9] = p2;

        // Smart Phone/Email Update
        const phone = document.getElementById('editPhone').value;
        if (member.phone === raw[13]) raw[13] = phone; else raw[11] = phone;

        const email = document.getElementById('editEmail').value;
        if (member.email === raw[15]) raw[15] = email; else raw[14] = email;

        // Update Object Model
        member.name = raw[1];
        member.courses = raw[2];
        member.paymentType = raw[6];
        member.amountDue = raw[5];
        member.amountPaid = p1 + p2;
        member.phone = phone;
        member.email = email;
        // member.raw is is passed by ref so it updates automatically

        // Update Status
        if (member.amountPaid >= member.amountDue && member.amountDue > 0) member.paymentStatus = 'paid';
        else if (member.amountPaid > 0) member.paymentStatus = 'partial';
        else member.paymentStatus = 'unpaid';

        this.uiManager.utils.closeModal();
        this.uiManager.updateStats(this.dataManager.getStats());
        this.uiManager.renderTable(this.dataManager.members);

        Swal.fire({ icon: 'success', title: 'Modifications enregistrées', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
    }

    toggleActive(id) {
        const member = this.dataManager.members.find(m => m.id === id);
        if (member) {
            member.active = !member.active;
            // Update raw data (Column 0: True/False)
            this.dataManager.rawData[member.id][0] = member.active;

            // Re-render
            this.uiManager.updateStats(this.dataManager.getStats());
            this.uiManager.renderTable(this.dataManager.members);
        }
    }

    exportData() {
        // Create a new workbook from "this.dataManager.rawData"
        const ws = XLSX.utils.aoa_to_sheet(this.dataManager.rawData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inscriptions");

        // Generate filename with date
        const date = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `SF_Inscriptions_Updated_${date}.xlsx`);
    }
}

// Start App
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
