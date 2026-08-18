require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const path = require('path');
const seedPizze = require('./seed');

const User = require('./models/User'); 
const Inventory = require('./models/Inventory'); 

// --- MODELLO IMPOSTAZIONI SLOT ---
const settingsSlotSchema = new mongoose.Schema({
    durataSlot: { type: Number, default: 15 },
    limiteForno: { type: Number, default: 18 },
    slotDisabilitati: { type: [String], default: [] }
});
const SettingsSlot = mongoose.models.SettingsSlot || mongoose.model('SettingsSlot', settingsSlotSchema);

const esauritiSchema = new mongoose.Schema({ nome: { type: String, required: true, unique: true } });
const IngredienteEsaurito = mongoose.models.IngredienteEsaurito || mongoose.model('IngredienteEsaurito', esauritiSchema);

const authRoutes = require('./routes/authRoutes');
const pizzaRoutes = require('./routes/pizzaRoutes');
const orderRoutes = require('./routes/orderRoutes');

const app = express();
app.set('trust proxy', 1);

// --- Logger: traccia le richieste nei Log di Vercel ---
app.use((req, res, next) => {
    console.log(`[VERCEL LOG] ${req.method} ${req.url}`);
    next();
});

// --- Connessione MongoDB (ottimizzata per Vercel/serverless) ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pizzeria_db';
let isConnected = false;

const connectDB = async () => {
    if (isConnected && mongoose.connection.readyState === 1) return;
    try {
        const db = await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000
        });
        isConnected = db.connections[0].readyState === 1;
        console.log("[DB] Connesso a MongoDB");
    } catch (err) {
        console.error("[DB] Errore connessione MongoDB:", err.message);
        throw err;
    }
};

// --- 1) CORS PRIMA di tutto (così anche gli errori hanno gli header giusti) ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// --- 2) Risposta immediata alle richieste OPTIONS (preflight) senza toccare il DB ---
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// --- 3) POI la connessione al database ---
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).json({ error: "Errore connessione al database: " + err.message });
    }
});

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.json());

// --- Sanitizzazione input (sicurezza) ---
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
    if (req.body) sanitize(req.body);
    if (req.params) sanitize(req.params);
    next();
});

// --- Rate limiter ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Troppe richieste, riprova piu tardi."
});
app.use('/api/', limiter);

// File statici disattivati: il frontend è su Hostinger, Vercel gestisce solo le API
// app.use(express.static('frontend')); 
// app.use('/immagini', express.static(path.join(__dirname, 'immagini')));
// app.use('/immagini', express.static(path.join(__dirname, 'frontend', 'immagini')));

app.get('/', (req, res) => {
    res.status(200).send("Backend Pizzeria Sole Online!");
});

// --- Swagger (documentazione API) ---
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

// --- Rotte Riders ---
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

// --- Rotte Inventory ---
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

// --- Modifica ordine ---
app.patch('/api/ordini/:id/modifica', async (req, res) => {
    try {
        const Order = require('./models/Order');
        const { 
            pizze, totale, tipoOrdine, indirizzoConsegna, 
            metodoPagamento, orario, caricoSlot, noteConsegna, citofono
        } = req.body;
        
        const datiDaAggiornare = {};
        if (pizze) datiDaAggiornare.pizze = pizze;
        if (totale !== undefined) datiDaAggiornare.totale = totale;
        if (tipoOrdine) datiDaAggiornare.tipoOrdine = tipoOrdine;
        if (indirizzoConsegna !== undefined) datiDaAggiornare.indirizzoConsegna = indirizzoConsegna;
        if (metodoPagamento) datiDaAggiornare.metodoPagamento = metodoPagamento;
        if (orario) datiDaAggiornare.orario = orario;
        if (caricoSlot !== undefined) datiDaAggiornare.caricoSlot = caricoSlot;
        if (noteConsegna !== undefined) datiDaAggiornare.noteConsegna = noteConsegna;
        if (citofono !== undefined) datiDaAggiornare.citofono = citofono;

        const updatedOrder = await Order.findByIdAndUpdate(
            req.params.id, 
            { $set: datiDaAggiornare }, 
            { new: true }
        );

        if (!updatedOrder) {
            return res.status(404).json({ message: "Ordine non trovato" });
        }

        res.json(updatedOrder);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Rotte Ingredienti Esauriti ---
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

// --- Stato Locale salvato nel Database (compatibile con Vercel serverless) ---
const settingsSchema = new mongoose.Schema({
    isLocaleAperto: { type: Boolean, default: true }
});
const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

app.get('/api/impostazioni/stato-locale', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({ isLocaleAperto: true });
        res.status(200).json({ aperto: settings.isLocaleAperto });
    } catch (e) {
        res.status(500).json({ error: "Errore DB stato locale" });
    }
});

app.patch('/api/impostazioni/stato-locale', async (req, res) => {
    try {
        const { aperto } = req.body;
        if (aperto !== undefined) {
            await Settings.findOneAndUpdate({}, { isLocaleAperto: aperto }, { upsert: true, new: true });
        }
        res.status(200).json({ success: true, aperto: aperto });
    } catch (e) {
        res.status(500).json({ error: "Errore cambio stato locale" });
    }
});

// --- ROTTE IMPOSTAZIONI SLOT (NUOVE) ---
app.get('/api/impostazioni/slot', async (req, res) => {
    try {
        let settings = await SettingsSlot.findOne();
        if (!settings) { settings = await SettingsSlot.create({}); }
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/impostazioni/slot', async (req, res) => {
    try {
        const { durataSlot, limiteForno, slotDisabilitati } = req.body;
        let settings = await SettingsSlot.findOne();
        if (!settings) { settings = await SettingsSlot.create({}); }
        
        if (durataSlot !== undefined) settings.durataSlot = durataSlot;
        if (limiteForno !== undefined) settings.limiteForno = limiteForno;
        if (slotDisabilitati !== undefined) settings.slotDisabilitati = slotDisabilitati;
        
        await settings.save();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Storico ordini personale (con JWT) ---
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

// --- Forza inserimento pizze (seed) ---
app.get('/api/forza-inserimento', async (req, res) => {
    try {
        await seedPizze();
        res.send("<h1>Pizze inserite con successo nel database!</h1><p>Torna al sito e aggiorna la pagina.</p>");
    } catch (error) {
        res.send("<h1>Errore:</h1><p>" + error.message + "</p>");
    }
});

// --- Rotte principali ---
app.use('/api/auth', authRoutes); 
app.use('/api/pizze', pizzaRoutes);
app.use('/api/ordini', orderRoutes);

// --- Gestore errori globale (restituisce JSON invece di HTML) ---
app.use((err, req, res, next) => {
    console.error("[ERRORE GENERALE]", err.message);
    res.status(500).json({ error: err.message });
});

// --- Avvio server (solo in locale, su Vercel non serve) ---
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n SERVER RUNNING ON PORT ${PORT}`);
        console.log(`HUB STAFF: http://localhost:${PORT}/hub-staff.html\n`);
    });
}

module.exports = app;
