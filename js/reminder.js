/**
 * Reminder Manager
 * Handles generation of payment reminder messages.
 */
class ReminderManager {
    constructor() {
        this.currentMember = null;
        this.templates = {
            casual: (m) => `Salut ${m.firstName} ! 👋\nPetite relance concernant ton inscription Street Family. Il reste un solde de ${m.balance}€ à régler.\nTu peux faire ça quand tu as un moment ? Merci !`,

            formal: (m) => `Bonjour ${m.firstName},\nSauf erreur de notre part, le paiement pour l'inscription Street Family n'a pas encore été finalisé.\nMontant restant : ${m.balance}€.\nMerci de régulariser la situation dès que possible.\nCordialement,\nL'équipe Street Family.`,

            urgent: (m) => `URGENT - Paiement Street Family\n\nBonjour ${m.firstName},\nNous n'avons toujours pas reçu le paiement de ${m.balance}€.\nC'est le dernier rappel avant suspension de l'inscription.\nMerci de régler cela aujourd'hui.`,

            fun: (m) => `Hé ${m.firstName} ! 🕺\nTa place est bien au chaud chez Street Family, mais ton paiement s'est perdu en route !\nIl reste ${m.balance}€ à régler pour que tout soit carré.\nMerci d'avance !`
        };
    }

    openModal(member) {
        this.currentMember = member;
        const modal = document.getElementById('reminderModal');
        const preview = document.getElementById('reminderPreview');

        // Default to casual
        this.updatePreview('casual');

        modal.classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('reminderModal').classList.add('hidden');
        this.currentMember = null;
    }

    updatePreview(style) {
        if (!this.currentMember) return;

        const template = this.templates[style];
        if (template) {
            const nameParts = this.currentMember.name.split(' ');
            // Format is "Nom Prénom" so first name is the LAST word
            const firstName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
            const balance = (this.currentMember.remaining || 0).toFixed(2);

            const msg = template({
                firstName: firstName,
                name: this.currentMember.name,
                balance: balance
            });

            document.getElementById('reminderPreview').value = msg;
        }
    }

    copyToClipboard() {
        const preview = document.getElementById('reminderPreview');
        preview.select();
        document.execCommand('copy'); // Fallback for older browsers, or use navigator.clipboard

        // Show feedback
        const btn = document.getElementById('copyReminderBtn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copié !';
        setTimeout(() => btn.innerHTML = originalText, 2000);
    }
}

window.reminderManager = new ReminderManager();
