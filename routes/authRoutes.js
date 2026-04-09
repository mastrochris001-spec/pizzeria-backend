const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.post('/register', async (req, res) => {
    try {
        const { email, password, role, nome, cognome } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email gia in uso" });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({ 
            email, 
            password: hashedPassword, 
            role: role ? role.toLowerCase().trim() : 'cliente', 
            nome, 
            cognome
        });
        
        await newUser.save();
        
        let message = "Registrazione completata!";
        if (newUser.role !== 'cliente') {
            message = "Registrazione effettuata. Il tuo account staff e in attesa di approvazione.";
        }

        res.status(201).json({ message });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "Utente non trovato" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Password errata" });

        if (user.role !== 'cliente') {
            const approvato = (user.isApprovato === true || user.isApprovato === "true");
            if (!approvato) {
                return res.status(403).json({ 
                    message: "Accesso negato. L'account deve essere attivato dal gestore." 
                });
            }
        }

        const ruolo = user.role.toLowerCase().trim();
        let durataSessione = '2h';
        
        if (['pizzaiolo', 'staff', 'gestore', 'rider'].includes(ruolo)) {
            durataSessione = '24h';
        }

        const token = jwt.sign(
            { id: user._id, role: user.role }, 
            process.env.JWT_SECRET || 'chiave_temporanea', 
            { expiresIn: durataSessione } 
        );

        const rispostaModificata = {
            token: token,
            utenteId: user._id.toString(),
            role: ruolo,
            nome: user.nome,
            email: user.email
        };

        console.log(`LOGIN EFFETTUATO: ${user.email} [${user.role}] - Sessione: ${durataSessione}`);
        
        res.status(200).json(rispostaModificata);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Errore interno del server" });
    }
});

module.exports = router;