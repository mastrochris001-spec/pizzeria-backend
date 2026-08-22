const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Inventory = require('../models/Inventory');
const Pizza = require('../models/Pizza');

// --- MODELLO IMPOSTAZIONI SLOT (condiviso con server.js) ---
const settingsSlotSchema = new mongoose.Schema({
    durataSlot: { type: Number, default: 15 },
    limiteForno: { type: Number, default: 18 },
    slotDisabilitati: { type: [String], default: [] }
});
const SettingsSlot = mongoose.models.SettingsSlot || mongoose.model('SettingsSlot', settingsSlotSchema);

// --- UTILITY SCORTE ---
function chiaveDataOggi() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const getPezziEsatti = (testo) => {
    if (/\b12\b/.test(testo)) return 12;
    if (/\b6\b/.test(testo)) return 6;
    if (/\b2\b/.test(testo)) return 2;
    return 1;
};

// Calcola quante scorte limitate consuma un ordine (stessa logica del menu)
async function calcolaConsumoScorte(pizze) {
    const consumo = { integrale: 0, glutenFree: 0, cannoli: 0, arancini: 0 };
    if (!Array.isArray(pizze)) return consumo;
    for (const p of pizze) {
        let nomePizza = '';
        try {
            const idPizza = p.pizza && p.pizza._id ? p.pizza._id : p.pizza;
            const pz = await Pizza.findById(idPizza);
            if (pz) nomePizza = pz.nome || '';
        } catch (e) {}
        const qta = p.quantita || 1;
        const testo = (String(p.note || '') + ' ' + nomePizza).toLowerCase();
        if (testo.includes('integrale')) consumo.integrale += qta;
        if (testo.includes('gluten')) consumo.glutenFree += qta;
        if (testo.includes('cannol')) consumo.cannoli += qta * getPezziEsatti(testo);
        if (testo.includes('arancin')) consumo.arancini += qta * getPezziEsatti(testo);
    }
    return consumo;
}

// segno = -1 scala le scorte, +1 le ripristina
async function aggiornaScorte(consumo, segno) {
    try {
        if (!consumo.integrale && !consumo.glutenFree && !consumo.cannoli && !consumo.arancini) return;
        const inv = await Inventory.findOne({ data: chiaveDataOggi() });
        if (!inv) return;
        inv.integrale = Math.max(0, (inv.integrale || 0) + segno * consumo.integrale);
        inv.glutenFree = Math.max(0, (inv.glutenFree || 0) + segno * consumo.glutenFree);
        inv.cannoli = Math.max(0, (inv.cannoli || 0) + segno * consumo.cannoli);
        inv.arancini = Math.max(0, (inv.arancini || 0) + segno * consumo.arancini);
        await inv.save();
        console.log(`[SCORTE] ${segno < 0 ? 'Scalate' : 'Ripristinate'}:`, consumo);
    } catch (e) {
        console.error("Errore aggiornamento scorte:", e.message);
    }
}

router.get('/disponibilita', async (req, res) => {
    try {
        const { orario } = req.query;
        if (!orario) return res.status(400).json({ error: "Orario mancante" });

        const oggi = new Date();
        oggi.setHours(0, 0, 0, 0);

        const ordiniSlot = await Order.find({
            orario: orario,
            createdAt: { $gte: oggi },
            stato: { $ne: 'eliminato' }
        });

        let totaleCarico = 0;
        ordiniSlot.forEach(o => totaleCarico += (o.caricoSlot || 0));

        const riderOnline = await User.find({ role: 'rider', isOnline: true });
        const numeroConsegneInQuestoSlot = ordiniSlot.filter(o => o.tipoOrdine === 'consegna').length;
        
        const riderDisponibili = (riderOnline.length * 3) > numeroConsegneInQuestoSlot;

        res.status(200).json({ 
            totalePizze: totaleCarico,
            riderDisponibili: riderDisponibili,
            numeroRiderOnline: riderOnline.length
        });
    } catch (error) {
        res.status(500).json({ error: "Errore nel calcolo della disponibilita" });
    }
});

router.post('/', async (req, res) => {
    try {
        const { cliente, pizze, orario, caricoSlot, tipoOrdine } = req.body;

        if (!cliente || !pizze || !orario || !caricoSlot) {
            return res.status(400).json({ error: "Dati ordine incompleti" });
        }

        // --- Legge limite forno e slot disabilitati dal database ---
        let LIMITE = 18;
        let slotDisabilitati = [];
        try {
            const imp = await SettingsSlot.findOne();
            if (imp) {
                LIMITE = parseInt(imp.limiteForno) || 18;
                slotDisabilitati = Array.isArray(imp.slotDisabilitati) ? imp.slotDisabilitati : [];
            }
        } catch (e) {
            console.error("Errore lettura impostazioni slot:", e.message);
        }

        if (slotDisabilitati.includes(orario)) {
            return res.status(400).json({ 
                message: `Lo slot delle ${orario} non e' piu' disponibile. Scegli un altro orario.` 
            });
        }

        const oggi = new Date();
        oggi.setHours(0, 0, 0, 0);

        const ordiniEsistenti = await Order.find({
            orario: orario,
            createdAt: { $gte: oggi },
            stato: { $ne: 'eliminato' }
        });

        let occupati = 0;
        ordiniEsistenti.forEach(o => occupati += (o.caricoSlot || 0));
        
        if (occupati + caricoSlot > LIMITE) {
            return res.status(400).json({ 
                message: `Lo slot delle ${orario} e pieno. Posti rimasti: ${Math.max(0, LIMITE - occupati)}` 
            });
        }

        const datiNuovoOrdine = { ...req.body };

        if (tipoOrdine === 'consegna') {
            const ridersOnline = await User.find({ role: 'rider', isOnline: true });
            const consegneQuestoOrario = ordiniEsistenti.filter(o => o.tipoOrdine === 'consegna').length;

            if (consegneQuestoOrario >= (ridersOnline.length * 3)) {
                return res.status(400).json({ 
                    message: `Tutti i rider sono occupati per le ${orario}. Scegli l'Asporto o cambia orario.` 
                });
            }

            let riderSelezionato = ridersOnline[0]._id;
            let minimoCarico = 9999;

            for (const rider of ridersOnline) {
                const ordiniInCorso = await Order.countDocuments({
                    riderAssegnato: rider._id,
                    stato: { $in: ['in attesa', 'in preparazione', 'pronto', 'in consegna'] },
                    createdAt: { $gte: oggi }
                });

                if (ordiniInCorso < minimoCarico) {
                    minimoCarico = ordiniInCorso;
                    riderSelezionato = rider._id;
                }
            }

            datiNuovoOrdine.riderAssegnato = riderSelezionato;
        }
      
        const nuovoOrdine = new Order(datiNuovoOrdine);
        const ordineSalvato = await nuovoOrdine.save();

        // --- NUOVO: scala automaticamente le scorte limitate (integrali, gluten, cannoli, arancini) ---
        const consumo = await calcolaConsumoScorte(pizze);
        await aggiornaScorte(consumo, -1);
        
        res.status(201).json(ordineSalvato);
        
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/attivi', async (req, res) => {
    try {
        const { data } = req.query;
        let dataInizio = new Date();
        dataInizio.setHours(0, 0, 0, 0);
        let dataFine = new Date();
        dataFine.setHours(23, 59, 59, 999);

        if (data) {
            dataInizio = new Date(data);
            dataInizio.setHours(0, 0, 0, 0);
            dataFine = new Date(data);
            dataFine.setHours(23, 59, 59, 999);
        }

        const ordini = await Order.find({
            createdAt: { $gte: dataInizio, $lte: dataFine },
            stato: { $in: ['in attesa', 'in preparazione', 'pronto', 'in consegna', 'consegnato'] } 
        })
        .populate({ path: 'pizze.pizza', model: 'Pizza' })
        .populate('cliente', 'nome email')
        .sort({ orario: 1 }); 

        res.status(200).json(ordini);
    } catch (error) {
        res.status(500).json({ error: "Errore recupero ordini" });
    }
});

router.get('/', async (req, res) => {
    try {
        const ordini = await Order.find({})
            .populate('cliente', 'nome email indirizzo telefono')
            .populate({
                path: 'pizze.pizza',
                select: 'nome categoria prezzo'
            })
            .sort({ createdAt: -1 });
            
        res.status(200).json(ordini);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/:id/stato', async (req, res) => {
    try {
        const { stato, pagato } = req.body;
        const updateData = {};
        
        if (stato !== undefined) updateData.stato = stato;
        if (pagato !== undefined) updateData.pagato = pagato;

        const ordineAggiornato = await Order.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!ordineAggiornato) {
            return res.status(404).json({ error: "Ordine non trovato" });
        }

        res.status(200).json(ordineAggiornato);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.patch('/:id/assegna', async (req, res) => {
    try {
        const { riderId } = req.body;
        const updated = await Order.findByIdAndUpdate(
            req.params.id, 
            { 
                riderAssegnato: riderId, 
                stato: riderId ? 'in consegna' : 'pronto' 
            }, 
            { new: true }
        );
        
        if (!updated) return res.status(404).json({ error: "Ordine non trovato" });
        res.status(200).json(updated);
    } catch (err) {
        res.status(500).json({ error: "Errore assegnazione rider" });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await Order.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Ordine non trovato" });

        // --- NUOVO: ripristina le scorte se l'ordine viene eliminato ---
        const consumo = await calcolaConsumoScorte(deleted.pizze);
        await aggiornaScorte(consumo, +1);

        res.status(200).json({ message: "Ordine eliminato" });
    } catch (err) {
        res.status(500).json({ message: "Errore eliminazione" });
    }
});

module.exports = router;
