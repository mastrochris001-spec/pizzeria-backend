const mongoose = require('mongoose');

const rewardSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    descrizione: { type: String, default: '' },
    puntiRichiesti: { type: Number, required: true, min: 1 },
    categoria: {
        type: String,
        enum: ['pizze classiche', 'pizze speciali', 'pizze maxi', 'calzoni', 'focacce ripiene', 'panozzi', 'hamburger', 'stuzzicherie', 'dolci', 'bibite'],
        default: 'pizze classiche'
    },
    prodottoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pizza',
        default: null
    },
    foto: { type: String, default: 'premio_default.png' },
    attivo: { type: Boolean, default: true },
    ordine: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Reward', rewardSchema);
