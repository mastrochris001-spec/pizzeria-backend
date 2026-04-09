const express = require('express');
const router = express.Router();
const Pizza = require('../models/Pizza');

/**
 * @route GET /api/pizze
 * @desc Visualizza tutto il menu della pizzeria
 */
router.get('/', async (req, res) => {
    try {
        
        const menu = await Pizza.find().sort({ categoria: 1 });
        res.status(200).json(menu);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route POST /api/pizze
 * @desc Aggiungi una nuova pizza al menu (Solo Pizzaiolo)
 */
router.post('/', async (req, res) => {
    try {
     
        const { nome, prezzo, ingredienti, categoria, foto } = req.body;
        
        const nuovaPizza = new Pizza({ 
            nome, 
            prezzo, 
            ingredienti, 
            categoria: categoria || 'pizze classiche', 
            foto: foto || '1.png' 
        });

        await nuovaPizza.save();
        res.status(201).json(nuovaPizza);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * @route DELETE /api/pizze/{id}
 * @desc Elimina una pizza dal menu
 */
router.delete('/:id', async (req, res) => {
    try {
        const pizzaEliminata = await Pizza.findByIdAndDelete(req.params.id);
        
        if (!pizzaEliminata) {
            return res.status(404).json({ message: "Pizza non trovata" });
        }
        
        res.status(200).json({ message: "Pizza rimossa dal menu con successo" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;