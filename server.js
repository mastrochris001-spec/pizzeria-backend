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
    consegnePerRider: { type: Number, default: 1 },
    slotDisabilitati: { type: [String], default: [] }
});
const SettingsSlot = mongoose.models.SettingsSlot || mongoose.model('SettingsSlot', settingsSlotSchema);

// --- MODELLO RUBRICA CLIENTI ---
const rubricaSchema = new mongoose.Schema({
    nome: String,
    telefono: { type: String, index: true },
    indirizzo: { type: String, default: '' },
    citofono: { type: String, default: '' },
    ultimaOrdinazione: { type: Date, default: Date.now }
}, { timestamps: true });
const RubricaCliente = mongoose.models.RubricaCliente || mongoose.model('RubricaCliente', rubricaSchema);

const esauritiSchema = new mongoose.Schema({ nome: { type: String, required: true, unique: true } });
const IngredienteEsaurito = mongoose.models.IngredienteEsaurito || mongoose.model('IngredienteEsaurito', esauritiSchema);

const authRoutes = require('./routes/authRoutes');
const pizzaRoutes = require('./routes/pizzaRoutes');
const orderRoutes = require('./routes/orderRoutes');

const app = express();
app.set('trust proxy', 1);

// --- Logger ---
app.use((req, res, next) => {
    console.log(`[VERCEL LOG] ${req.method} ${req.url}`);
    next();
});

// --- CONNESSIONE MONGODB CON CACHE (obbligatoria per Vercel serverless) ---
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pizzeria_db';

// Cache globale: evita che ogni cold start apra una connessione nuova
let cached = global.mongoose;
if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
    // Se c'è già una connessione attiva, RIUSALA (non aprirne una nuova)
    if (cached.conn && cached.conn.connection && cached.conn.connection.readyState === 1) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 15000,
            connectTimeoutMS: 10000,
            maxPoolSize: 10,           // max 10 connessioni per istanza Vercel (invece di 100 default)
            minPoolSize: 1,            // tiene almeno 1 connessione viva
            maxIdleTimeMS: 30000,      // chiude le connessioni inutilizzate dopo 30 sec
            tls: true,
            tlsAllowInvalidCertificates: true,  // evita errori SSL su serverless
        };
        cached.promise = mongoose.connect(MONGO_URI, opts).then((m) => {
            console.log("[DB] Connesso a MongoDB");
            return m;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null; // permette di riprovare al prossimo tentativo
        console.error("[DB] Errore connessione MongoDB:", e.message);
        throw e;
    }
    return cached.conn;
}

// --- CORS ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// --- OPTIONS immediato ---
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// --- Middleware: connetti al DB per ogni richiesta (con cache) ---
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

app.use(express.json({ limit: '10mb' }));

// --- Sanitizzazione input ---
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
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Troppe richieste, riprova piu tardi."
});
app.use('/api/', limiter);

app.get('/', (req, res) => {
    res.status(200).send("Backend Pizzeria Sole Online!");
});

// --- Endpoint ping per test connessione ---
app.get('/api/ping', async (req, res) => {
    try {
        const state = mongoose.connection.readyState;
        const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
        res.json({ 
            ok: state === 1, 
            dbState: states[state] || 'unknown',
            time: new Date()
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// --- Swagger ---
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
try {
    const swaggerDocs = swaggerJsDoc(swaggerOptions);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
} catch (e) {
    console.log("Swagger non disponibile:", e.message);
}

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

// --- Stato Locale ---
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

// --- Rotte Impostazioni Slot ---
app.get('/api/impostazioni/slot', async (req, res) => {
    try {
        let settings = await SettingsSlot.findOne();
        if (!settings) { settings = await SettingsSlot.create({}); }
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/impostazioni/slot', async (req, res) => {
    try {
        const { durataSlot, limiteForno, consegnePerRider, slotDisabilitati } = req.body;
        let settings = await SettingsSlot.findOne();
        if (!settings) { settings = await SettingsSlot.create({}); }
        
        if (durataSlot !== undefined) settings.durataSlot = durataSlot;
        if (limiteForno !== undefined) settings.limiteForno = limiteForno;
        if (consegnePerRider !== undefined) settings.consegnePerRider = consegnePerRider;
        if (slotDisabilitati !== undefined) settings.slotDisabilitati = slotDisabilitati;
        
        await settings.save();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Ricerca clienti (registrati + rubrica) ---
app.get('/api/clienti/ricerca', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json([]);
        jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'chiave_temporanea');

        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json([]);
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        const registrati = await User.find({
            $or: [{ nome: regex }, { telefono: regex }, { email: regex }]
        }).select('nome telefono email indirizzo').limit(8);

        const rubrica = await RubricaCliente.find({
            $or: [{ nome: regex }, { telefono: regex }]
        }).sort({ updatedAt: -1 }).limit(8);

        const norm = t => String(t || '').replace(/\D/g, '');

        // Arricchisci registrati con dati rubrica (citofono, indirizzo completo)
        const risultati = registrati.map(u => {
            const recRub = rubrica.find(r => norm(r.telefono) === norm(u.telefono) && norm(r.telefono) !== '');
            return {
                nome: u.nome || '',
                telefono: u.telefono || '',
                indirizzo: (recRub && recRub.indirizzo) ? recRub.indirizzo : (u.indirizzo || ''),
                citofono: (recRub && recRub.citofono) ? recRub.citofono : '',
                tipo: 'registrato'
            };
        });

        // Aggiungi clienti solo-rubrica (non duplicati)
        rubrica.forEach(r => {
            const dup = risultati.some(x => norm(x.telefono) === norm(r.telefono) && norm(r.telefono) !== '');
            if (!dup) {
                risultati.push({
                    nome: r.nome || '', telefono: r.telefono || '',
                    indirizzo: r.indirizzo || '', citofono: r.citofono || '', tipo: 'rubrica'
                });
            }
        });

        res.json(risultati);
    } catch (e) {
        res.status(401).json([]);
    }
});

// --- Storico ordini personale ---
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

// --- Forza inserimento pizze ---
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

// --- Gestore errori globale ---
app.use((err, req, res, next) => {
    console.error("[ERRORE GENERALE]", err.message);
    res.status(500).json({ error: err.message });
});

// --- Avvio server locale (solo in dev) ---
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n SERVER RUNNING ON PORT ${PORT}`);
        console.log(`HUB STAFF: http://localhost:${PORT}/hub-staff.html\n`);
    });
}

// Export per Vercel
module.exports = app;
