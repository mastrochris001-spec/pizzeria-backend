const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
    data: { type: String, required: true, unique: true }, 
    integrale: { type: Number, default: 0 },
    glutenFree: { type: Number, default: 0 },
    cannoli: { type: Number, default: 0 },   
    arancini: { type: Number, default: 0 }   
});

module.exports = mongoose.model('Inventory', InventorySchema);