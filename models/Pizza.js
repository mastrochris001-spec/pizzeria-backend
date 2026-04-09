const mongoose = require('mongoose');

const pizzaSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    
    
    categoria: { type: String, required: true }, 
    
    prezzo: { type: Number, required: true },
    ingredienti: [{ type: String }],
    foto: { type: String },
    
  
    isCommon: { type: Boolean, default: true },
    
    pizzeriaCustom: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Pizzeria',
        default: null
    }
});

module.exports = mongoose.model('Pizza', pizzaSchema);