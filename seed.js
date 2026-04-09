const fs = require('fs');
const Pizza = require('./models/Pizza');

async function seedPizze() {
    try {
       
        const count = await Pizza.countDocuments({ isCommon: true });
        if (count > 0) {
            console.log("Ingredienti pronti: Le pizze base sono già nel database.");
            return;
        }

    
        const data = fs.readFileSync('pizza.json', 'utf8');
        const pizze = JSON.parse(data);

        
        await Pizza.insertMany(pizze.map(p => ({
            ...p,
            isCommon: true
        })));

        console.log("Setup iniziale completato: Pizze caricate con successo dal file JSON!");
    } catch (error) {
        console.error("Errore durante il caricamento delle pizze:", error);
    }
}


module.exports = seedPizze;
