const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Inventory = require('../models/Inventory');
const Pizza = require('../models/Pizza');

const rubricaSchema = new mongoose.Schema({
    nome: String,
    telefono: { type: String, index: true },
    indirizzo: { type: String, default: '' },
    citofono: { type: String, default: '' },
    ultimaOrdinazione: { type: Date, default: Date.now }
}, { timestamps: true });
const RubricaCliente = mongoose.models.RubricaCliente || mongoose.model('RubricaCliente', rubricaSchema);

const settingsSlotSchema = new mongoose.Schema({
    durataSlot: { type: Number, default: 15 },
    limiteForno: { type: Number, default: 18 },
    consegnePerRider: { type: Number, default: 1 },
    slotDisabilitati: { type: [String], default: [] }
});
const SettingsSlot = mongoose.models.SettingsSlot || mongoose.model('SettingsSlot', settingsSlotSchema);

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
        let LIMITE = 18;
        let slotDisabilitati = [];
        try {
            const imp = await SettingsSlot.findOne();
            if (imp) {
                LIMITE = parseInt(imp.limiteForno) || 18;
                slotDisabilitati = Array.isArray(imp.slotDisabilitati) ? imp.slotDisabilitati : [];
            }
        } catch (e) {}
        if (slotDisabilitati.includes(orario)) {
            return res.status(400).json({
                message: `Lo slot delle ${orario} non e' piu' disponibile. Scegli un altro orario.`
            });
        }
        const oggi = new Date();
        oggi.setHours(0, 0, 0, 0);
        const oggiFine = new Date();
        oggiFine.setHours(23, 59, 59, 999);
        const dataOrdine = req.body.dataConsegna || chiaveDataOggi();
        let ordiniEsistenti;
        if (dataOrdine === chiaveDataOggi()) {
            ordiniEsistenti = await Order.find({
                orario: orario,
                stato: { $ne: 'eliminato' },
                $or: [
                    { dataConsegna: dataOrdine },
                    { $and: [
                        { $or: [ { dataConsegna: { $exists: false } }, { dataConsegna: '' }, { dataConsegna: null } ] },
                        { createdAt: { $gte: oggi, $lte: oggiFine } }
                    ]}
                ]
            });
        } else {
            ordiniEsistenti = await Order.find({
                orario: orario,
                dataConsegna: dataOrdine,
                stato: { $ne: 'eliminato' }
            });
        }
        let occupati = 0;
        ordiniEsistenti.forEach(o => occupati += (o.caricoSlot || 0));
        if (occupati + caricoSlot > LIMITE) {
            return res.status(400).json({
                message: `Lo slot delle ${orario} e pieno. Posti rimasti: ${Math.max(0, LIMITE - occupati)}`
            });
        }
        const datiNuovoOrdine = { ...req.body };
        datiNuovoOrdine.dataConsegna = dataOrdine;
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
        
        // --- SALVATAGGIO RUBRICA (tutti i clienti) ---
        try {
            const telRub = String(req.body.telefonoCliente || '').trim();
            const nomeRub = String(req.body.nomeClienteCustom || '').trim();
            if (telRub && nomeRub) {
                const datiRubrica = {
                    nome: nomeRub,
                    telefono: telRub,
                    ultimaOrdinazione: new Date()
                };
                if (req.body.indirizzoConsegna && req.body.indirizzoConsegna !== 'Asporto') {
                    datiRubrica.indirizzo = req.body.indirizzoConsegna;
                }
                if (req.body.citofono) datiRubrica.citofono = req.body.citofono;
                await RubricaCliente.findOneAndUpdate({ telefono: telRub }, datiRubrica, { upsert: true });
            }
        } catch (e) {
            console.error("Errore salvataggio rubrica:", e.message);
        }
        
        // --- AGGIORNA DATI SOLO PER CLIENTI (mai per staff/pizzaiolo/rider) ---
        try {
            if (cliente) {
                const utenteRegistrato = await User.findById(cliente);
                
                if (utenteRegistrato && utenteRegistrato.role === 'cliente') {
                    const updateUserData = {};
                    if (req.body.nomeClienteCustom && req.body.nomeClienteCustom.trim()) {
                        updateUserData.nome = req.body.nomeClienteCustom.trim();
                    }
                    if (req.body.telefonoCliente && req.body.telefonoCliente.trim()) {
                        updateUserData.telefono = req.body.telefonoCliente.trim();
                    }
                    if (req.body.indirizzoConsegna && req.body.indirizzoConsegna !== 'Asporto') {
                        updateUserData.indirizzo = req.body.indirizzoConsegna;
                    }
                    if (req.body.citofono) {
                        updateUserData.citofono = req.body.citofono;
                    }
                    if (Object.keys(updateUserData).length > 0) {
                        await User.findByIdAndUpdate(cliente, updateUserData);
                        console.log(`[USER] Dati cliente aggiornati: ${updateUserData.nome}`);
                    }
                } else if (utenteRegistrato) {
                    console.log(`[USER] Account ${utenteRegistrato.role}: profilo NON modificato (dati cliente solo in rubrica)`);
                }
            }
        } catch (e) {
            console.error("Errore aggiornamento User:", e.message);
        }
        
        const consumo = await calcolaConsumoScorte(pizze);
        await aggiornaScorte(consumo, -1);
        res.status(201).json(ordineSalvato);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.patch('/:id/stazione', async (req, res) => {
    try {
        const { stazione, pronto } = req.body;
        const ordine = await Order.findById(req.params.id);
        if (!ordine) return res.status(404).json({ error: "Ordine non trovato" });
        if (stazione === 'forno') ordine.prontoForno = !!pronto;
        else if (stazione === 'compositore') ordine.prontoCompositore = !!pronto;
        else return res.status(400).json({ error: "Stazione non valida" });
        if (ordine.prontoForno && ordine.prontoCompositore) {
            ordine.stato = 'pronto';
        } else if (ordine.stato === 'pronto') {
            ordine.stato = 'in preparazione';
        }
        await ordine.save();
        res.json(ordine);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/attivi', async (req, res) => {
    try {
        const { data } = req.query;
        const d = data || chiaveDataOggi();
        const oggiStart = new Date(); oggiStart.setHours(0,0,0,0);
        const oggiEnd = new Date(); oggiEnd.setHours(23,59,59,999);
        let dateCondition;
        if (d === chiaveDataOggi()) {
            dateCondition = { $or: [
                { dataConsegna: d },
                { $and: [
                    { $or: [ { dataConsegna: { $exists: false } }, { dataConsegna: '' }, { dataConsegna: null } ] },
                    { createdAt: { $gte: oggiStart, $lte: oggiEnd } }
                ]}
            ]};
        } else {
            dateCondition = { dataConsegna: d };
        }
        const ordini = await Order.find({
            ...dateCondition,
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
        const { stato, pagato, metodoPagamento } = req.body;
        const updateData = {};
        if (stato !== undefined) updateData.stato = stato;
        if (pagato !== undefined) updateData.pagato = pagato;
        if (metodoPagamento !== undefined) updateData.metodoPagamento = metodoPagamento;
        if (stato === 'in attesa' || stato === 'in preparazione') {
            updateData.prontoForno = false;
            updateData.prontoCompositore = false;
        }
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
        const consumo = await calcolaConsumoScorte(deleted.pizze);
        await aggiornaScorte(consumo, +1);
        res.status(200).json({ message: "Ordine eliminato" });
    } catch (err) {
        res.status(500).json({ message: "Errore eliminazione" });
    }
});

router.get('/fix-pagato', async (req, res) => {
    try {
        const r = await Order.updateMany(
            { stato: { $in: ['in attesa', 'in preparazione', 'pronto', 'in consegna'] }, metodoPagamento: 'contanti' },
            { $set: { pagato: false } }
        );
        res.json({ modificati: r.modifiedCount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
