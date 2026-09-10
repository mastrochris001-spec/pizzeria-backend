const express = require('express');
const router = express.Router();
const Reward = require('../models/Reward');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Token mancante' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'chiave_temporanea');
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token non valido' });
    }
};

router.get('/', authMiddleware, async (req, res) => {
    try {
        const rewards = await Reward.find({ attivo: true }).sort({ ordine: 1, puntiRichiesti: 1 });
        res.json(rewards);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/tutti', authMiddleware, async (req, res) => {
    try {
        if (!['gestore', 'staff', 'pizzaiolo'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Non autorizzato' });
        }
        const rewards = await Reward.find().sort({ ordine: 1, puntiRichiesti: 1 });
        res.json(rewards);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/miei-punti', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        res.json({ punti: user.punti || 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    try {
        if (!['gestore', 'staff', 'pizzaiolo'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Solo lo staff può creare premi' });
        }
        const { nome, descrizione, puntiRichiesti, foto, tipo, attivo } = req.body;
        if (!nome || !puntiRichiesti || puntiRichiesti < 1) {
            return res.status(400).json({ error: 'Nome e punti richiesti sono obbligatori' });
        }
        const reward = new Reward({
            nome, descrizione, puntiRichiesti, 
            foto: foto || 'premio_default.png',
            tipo: tipo || 'altro',
            attivo: attivo !== false
        });
        await reward.save();
        res.status(201).json(reward);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.patch('/:id', authMiddleware, async (req, res) => {
    try {
        if (!['gestore', 'staff', 'pizzaiolo'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Solo lo staff può modificare premi' });
        }
        const updated = await Reward.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'Premio non trovato' });
        res.json(updated);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        if (!['gestore', 'staff', 'pizzaiolo'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Solo lo staff può eliminare premi' });
        }
        const deleted = await Reward.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Premio non trovato' });
        res.json({ message: 'Premio eliminato' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/verifica', authMiddleware, async (req, res) => {
    try {
        const { rewardId } = req.body;
        const user = await User.findById(req.user.id);
        const reward = await Reward.findById(rewardId);
        
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        if (!reward || !reward.attivo) return res.status(404).json({ error: 'Premio non disponibile' });
        
        const puntiUtente = user.punti || 0;
        const puoRiscattare = puntiUtente >= reward.puntiRichiesti;
        
        res.json({
            puoRiscattare,
            puntiUtente,
            puntiRichiesti: reward.puntiRichiesti,
            puntiRimanenti: puoRiscattare ? puntiUtente - reward.puntiRichiesti : puntiUtente
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
