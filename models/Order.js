const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    cliente: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },

    nomeClienteCustom: { 
        type: String, 
        default: "" 
    },
    
    telefonoCliente: {
        type: String,
        required: true
    },

    pizze: [
        {
            pizza: { 
                type: mongoose.Schema.Types.ObjectId, 
                ref: 'Pizza',
                required: true
            },
            quantita: { 
                type: Number, 
                default: 1 
            },
            note: { 
                type: String, 
                default: "" 
            }
        }
    ],
    
    totale: { 
        type: Number, 
        required: true 
    },

    puntiGuadagnati: {
        type: Number,
        default: 0
    },

    tipoOrdine: {
        type: String,
        enum: ['tavolo', 'asporto', 'consegna'],
        default: 'asporto'
    },

    orario: { 
        type: String, 
        required: true 
    },

    caricoSlot: { 
        type: Number, 
        required: true 
    },

    metodoPagamento: {
        type: String,
        enum: ['contanti', 'pos'],
        default: 'contanti'
    },

    pagato: { type: Boolean, default: false },

    prontoForno: { type: Boolean, default: false },
    prontoCompositore: { type: Boolean, default: false },

    // --- NUOVO: giorno di consegna/ritiro (YYYY-MM-DD) per ordini futuri ---
    dataConsegna: {
        type: String,
        default: ''
    },

    indirizzoConsegna: {
        type: String,
        default: ""
    },

    citofono: {
        type: String,
        default: ""
    },

    noteConsegna: {
        type: String,
        default: ""
    },

    riderAssegnato: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        default: null 
    },
    
    stato: { 
        type: String, 
        enum: ['in attesa', 'in preparazione', 'pronto', 'in consegna', 'consegnato', 'eliminato'], 
        default: 'in attesa' 
    },
    
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Order', OrderSchema);
