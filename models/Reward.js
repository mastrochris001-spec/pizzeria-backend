const mongoose = require('mongoose');

const rewardSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    descrizione: { type: String, default: '' },
    puntiRichiesti: { type: Number, required: true, min: 1 },
    foto: { type: String, default: 'premio_default.png' },
    tipo: { 
        type: String, 
        enum: ['pizza', 'bibita', 'dolce', 'sconto', 'altro'],
        default: 'altro'
    },
    attivo: { type: Boolean, default: true },
    ordine: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Reward', rewardSchema);
