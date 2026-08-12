const mongoose = require('mongoose');
const settingsSchema = new mongoose.Schema({
    isLocaleAperto: { type: Boolean, default: true }
});
module.exports = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
