const mongoose = require('mongoose');

const pizzeriaSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    partitaIva: { type: String, required: true, unique: true },
    indirizzo: { type: String, required: true },
    telefono: { type: String, required: true },
    
  
    proprietario: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    
    menu: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Pizza' 
    }],

    email: { type: String }, 
    
    isAperta: { type: Boolean, default: true },
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Pizzeria', pizzeriaSchema);