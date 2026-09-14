const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const schemaCategorie = new mongoose.Schema({
    categorieDisattivate: { type: [String], default: [] }
});
const ImpostazioniCategorie = mongoose.models.ImpostazioniCategorie || mongoose.model('ImpostazioniCategorie', schemaCategorie);

const authStaff = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Token mancante' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'chiave_temporanea');
        if (!['gestore', 'staff', 'pizzaiolo'].includes(decoded.role)) {
            return res.status(403).json({ error: 'Non autorizzato' });
        }
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token non valido' });
    }
};

// Lettura pubblica: serve al menu per nascondere le categorie spente
router.get('/stato', async (req, res) => {
    try {
        let doc = await ImpostazioniCategorie.findOne();
        if (!doc) doc = await ImpostazioniCategorie.create({ categorieDisattivate: [] });
        res.json({ categorieDisattivate: doc.categorieDisattivate });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Scrittura protetta: solo staff
router.patch('/stato', authStaff, async (req, res) => {
    try {
        const { categorieDisattivate } = req.body;
        if (!Array.isArray(categorieDisattivate)) {
            return res.status(400).json({ error: 'Formato non valido' });
        }
        const doc = await ImpostazioniCategorie.findOneAndUpdate(
            {},
            { categorieDisattivate },
            { upsert: true, new: true }
        );
        res.json({ categorieDisattivate: doc.categorieDisattivate });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
