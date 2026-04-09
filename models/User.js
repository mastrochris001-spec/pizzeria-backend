const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    nome: { type: String, required: true },
    cognome: { type: String },
    
    role: { 
        type: String, 
        enum: ['cliente', 'pizzaiolo', 'rider', 'compositore', 'staff', 'gestore'],
        required: true 
    },

    isOnline: { 
        type: Boolean, 
        default: false 
    },

 
    isApprovato: { 
        type: mongoose.Schema.Types.Mixed, 
        default: function() {
        
            return this.role === 'cliente' ? true : false;
        }
    },

    indirizzo: { type: String }, 
    telefono: { type: String },
    
    metodoPagamento: { 
        type: String, 
        enum: ['carta_credito', 'prepagata', 'contanti', 'pos'], 
        default: 'contanti' 
    },
    
    preferenze: [String]
}, { timestamps: true }); 

module.exports = mongoose.model('User', userSchema);