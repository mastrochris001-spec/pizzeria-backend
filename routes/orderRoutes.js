const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User'); 

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

        const oggi = new Date();
        oggi.setHours(0, 0, 0, 0);

        const ordiniEsistenti = await Order.find({
            orario: orario,
            createdAt: { $gte: oggi },
            stato: { $ne: 'eliminato' }
        });

        let occupati = 0;
        ordiniEsistenti.forEach(o => occupati += (o.caricoSlot || 0));
        const LIMITE = 18;
        
        if (occupati + caricoSlot > LIMITE) {
            return res.status(400).json({ 
                message: `Lo slot delle ${orario} e pieno. Posti rimasti: ${LIMITE - occupati}` 
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
        res.status(200).json({ message: "Ordine eliminato" });
    } catch (err) {
        res.status(500).json({ message: "Errore eliminazione" });
    }
});

module.exports = router;