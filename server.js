require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const path = require('path'); // AGGIUNTO: Modulo per gestire i percorsi dei file
const seedPizze = require('./seed');

const User = require('./models/User'); 
const Inventory = require('./models/Inventory'); 

const esauritiSchema = new mongoose.Schema({ nome: { type: String, required: true, unique: true } });
const IngredienteEsaurito = mongoose.model('IngredienteEsaurito', esauritiSchema);

const authRoutes = require('./routes/authRoutes');
const pizzaRoutes = require('./routes/pizzaRoutes');
const orderRoutes = require('./routes/orderRoutes');

const app = express();

app.use(cors());

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://cdn-icons-png.flaticon.com", "https://nominatim.openstreetmap.org"],
            connectSrc: ["'self'", "http://127.0.0.1:3000", "http://localhost:3000"]
        }
    }
}));

app.use(express.json());

app.use((req, res, next) => {
    const sanitize = (obj) => {
        if (obj instanceof Object) {
            for (const key in obj) {
                if (key.startsWith('$') || key.includes('.')) {
                    delete obj[key];
                } else {
                    sanitize(obj[key]);
                }
            }
        }
    };
    sanitize(req.body);
    sanitize(req.params);
    next();
});

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Troppe richieste, riprova piu tardi."
});
app.use('/api/', limiter);

app.use(express.static('frontend')); 
app.use('/immagini', express.static(path.join(__dirname, 'immagini'))); // Cerca le immagini nella cartella principale
app.use('/immagini', express.static(path.join(__dirname, 'frontend', 'immagini'))); // Cerca le immagini dentro frontend

const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'Pizzeria API',
            version: '1.0.0',
            description: 'API per il progetto Pizzeria Sole',
        },
        servers: [{ url: process.env.SERVER_URL || 'http://localhost:3000' }]
    },
    apis: ['./routes/*.js'],
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.get('/api/riders/logistica', async (req, res) => {
    try {
        const riders = await User.find({ role: 'rider' }).select('nome cognome email isOnline _id');
        res.status(200).json(riders);
    } catch (err) {
        res.status(500).json({ message: "Errore caricamento logistica" });
    }
});

app.patch('/api/riders/:id/stato-online', async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, { isOnline: req.body.isOnline });
        res.status(200).json({ message: "Stato rider aggiornato" });
    } catch (err) {
        res.status(500).json({ message: "Errore stato rider" });
    }
});

app.get('/api/riders', async (req, res) => {
    try {
        const riders = await User.find({ role: 'rider' }).select('nome cognome _id isOnline');
        res.status(200).json(riders);
    } catch (err) {
        res.status(500).json({ message: "Errore lista rider" });
    }
});

app.get('/api/inventory/:data', async (req, res) => {
    try {
        let inv = await Inventory.findOne({ data: req.params.data });
        if (!inv) {
            inv = await Inventory.create({ 
                data: req.params.data, 
                integrale: 0, 
                glutenFree: 0,
                cannoli: 0,
                arancini: 0 
            });
        }
        res.json(inv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/inventory/:data', async (req, res) => {
    try {
        const { integrale, glutenFree, cannoli, arancini } = req.body;
        const inv = await Inventory.findOneAndUpdate(
            { data: req.params.data },
            { integrale, glutenFree, cannoli, arancini },
            { new: true, upsert: true }
        );
        res.json(inv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/ordini/:id/modifica', async (req, res) => {
    try {
        const Order = require('./models/Order');
        const { pizze, totale, tipoOrdine, indirizzoConsegna, metodoPagamento } = req.body;
        const updatedOrder = await Order.findByIdAndUpdate(
            req.params.id, 
            { pizze, totale, tipoOrdine, indirizzoConsegna, metodoPagamento }, 
            { new: true }
        );
        res.json(updatedOrder);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ingredienti-esauriti', async (req, res) => {
    try {
        const list = await IngredienteEsaurito.find();
        res.json(list.map(i => i.nome));
    } catch(e) { res.status(500).json([]); }
});

app.post('/api/ingredienti-esauriti', async (req, res) => {
    try {
        await IngredienteEsaurito.findOneAndUpdate({ nome: req.body.nome }, { nome: req.body.nome }, { upsert: true });
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/ingredienti-esauriti/:nome', async (req, res) => {
    try {
        await IngredienteEsaurito.findOneAndDelete({ nome: req.params.nome });
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message}); }
});

let statoLocaleAperto = true;

app.get('/api/impostazioni/stato-locale', (req, res) => {
    res.status(200).json({ aperto: statoLocaleAperto });
});

app.patch('/api/impostazioni/stato-locale', (req, res) => {
    try {
        const { aperto } = req.body;
        if (aperto !== undefined) {
            statoLocaleAperto = aperto;
        }
        res.status(200).json({ success: true, aperto: statoLocaleAperto });
    } catch (e) {
        res.status(500).json({ error: "Errore cambio stato locale" });
    }
});

app.get('/api/ordini/storico-personale', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ message: "Non autorizzato" });
        }
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'chiave_temporanea');
        
        const Order = require('./models/Order');
        const ordini = await Order.find({ cliente: decoded.id })
            .populate('pizze.pizza')
            .sort({ _id: -1 });
            
        res.json(ordini);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use('/api/auth', authRoutes); 
app.use('/api/pizze', pizzaRoutes);
app.use('/api/ordini', orderRoutes);

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pizzeria_db';

mongoose.connect(MONGO_URI)
.then(async () => {
    console.log("Forno acceso: MongoDB Connesso!");
    await seedPizze(); 
}).catch(err => console.error("Errore DB:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n SERVER RUNNING ON PORT ${PORT}`);
    console.log(`HUB STAFF: http://localhost:${PORT}/hub-staff.html\n`);
});
