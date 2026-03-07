// ========================================================================
// Server init
// ========================================================================

// Filesystem reading functions
const fs = require('fs-extra');

// Load settings
try {
	stats = fs.lstatSync('settings.json');
} catch (e) {
	// If settings do not yet exist
	if (e.code == "ENOENT") {
		try {
			fs.copySync(
				'settings.example.json',
				'settings.json'
			);
			console.log("Created new settings file.");
		} catch(e) {
			console.error("Error copying settings.example.json to settings.json:", e);
			throw "Could not create new settings file.";
		}
	// Else, there was a misc error (permissions?)
	} else {
		console.error("Error reading settings.json:", e);
		throw "Could not read 'settings.json'.";
	}
}

// Load settings into memory
const settings = require("./settings.json");

try {
	global.settings = require("./settings.json");
} catch (err) {
	console.error("Failed to load settings.json:", err);
	process.exit(1);
}
// Use global.settings everywhere instead of redeclaring
// Setup basic express server
const path = require('path');

// Maintenance Configs
// Options: true and false
updating = false;

if (updating == true) {
	var express = require('express');
	var app = express();
	exports.app = app;
	if (settings.express.serveStatic) {
		const servePath = path.join(__dirname, '..', 'build', 'maintenance', 'themes', 'win_7');
		console.log('Serving maintenance static from', servePath);
		app.use(express.static(servePath));
	}
	var server = require('http').createServer(app);
} else {
	var express = require('express');
	var app = express();
	// enable JSON body parsing for API endpoints (wiki, etc)
	app.use(express.json());
	if (settings.express.serveStatic) {
		const servePath = path.join(__dirname, '..', 'build', 'www');
		console.log('Serving web static from', servePath);
		app.use(express.static(servePath));
	}
	var server = require('http').createServer(app);
};
// Shutdown Configs
// Options: true and false
/* offline = false;

if (offline == true) {
var express = require('express');
var app = express();
if (settings.express.serveStatic)
	app.use(express.static('../build/shutdown/themes/win_7'));
var server = require('http').createServer(app);
} else {
var express = require('express');
var app = express();
if (settings.express.serveStatic)
	app.use(express.static('../build/www'));
var server = require('http').createServer(app);
}; */

// Init socket.io
var io = require('socket.io')(server);
var port = 3505;
// Port is now hardcoded to 3505
exports.io = io;

// Init sanitize-html
var sanitize = require('sanitize-html');

// Init winston loggers (hi there)
const Log = require('./log.js');
Log.init();
const log = Log.log;

// Load ban list
const Ban = require('./ban.js');
Ban.init();
// Start actually listening
try {
	server.listen(port, function () {
		console.log(
			" Welcome to BonziWORLD!\n",
			"Time to meme!\n",
			"----------------------\n",
			"Server listening at port " + port
		);
	});
	app.use(express.static(__dirname + '/public'));
} catch (err) {
	console.error("Server failed to start:", err);
	if (err.code) console.error("Error code:", err.code);
	if (err.errno) console.error("Error errno:", err.errno);
	if (err.syscall) console.error("Error syscall:", err.syscall);
	if (err.stack) console.error("Error stack:", err.stack);
	process.exit(1);
}

// --------- wiki backend API ------------------------------------------------
try {
	const Wiki = require('./wiki');
	Wiki.load();
	global.Wiki = Wiki;
} catch (err) {
	console.error("Error loading Wiki module:", err);
	process.exit(1);
}

try {
	const session = require('express-session');
	app.use(session({
		secret: settings.sessionSecret || 'secret',
		resave: false,
		saveUninitialized: true
	}));
} catch (err) {
	console.error("Error loading session middleware:", err);
	process.exit(1);
}

function ensureAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'authentication required' });
}

// login/logout simple handlers (username/password from settings)
app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === settings.auth.user && pass === settings.auth.pass) {
        req.session.user = user;
        res.json({ ok: true });
    } else {
        res.status(403).json({ error: 'invalid credentials' });
    }
});
app.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/wiki with optional filters
app.get('/api/wiki', (req, res) => {
    const { search, author, trending } = req.query;
    let list = Wiki.list();
    if (search) list = Wiki.search(search);
    if (author) list = Wiki.byAuthor(author);
    if (trending) list = Wiki.trending();
    res.json(list);
});

// create a new article
app.post('/api/wiki', ensureAuth, async (req, res) => {
    const { title, category, content } = req.body;
    if (!(await Wiki.moderate(title)) || !(await Wiki.moderate(content))) {
        return res.status(400).json({ error: 'Content failed moderation' });
    }
    const article = Wiki.create({ title, category, content, author: req.session.user });
    io.emit('wiki:update', article);
    res.json(article);
});

// update existing article
app.put('/api/wiki/:id', ensureAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!(await Wiki.moderate(req.body.title)) || !(await Wiki.moderate(req.body.content))) {
        return res.status(400).json({ error: 'Content failed moderation' });
    }
    const art = Wiki.update(id, { ...req.body, author: req.session.user });
    if (!art) return res.status(404).end();
    io.emit('wiki:update', art);
    res.json(art);
});

// delete article
app.delete('/api/wiki/:id', ensureAuth, (req, res) => {
    const id = parseInt(req.params.id);
    Wiki.remove(id);
    io.emit('wiki:update', { id });
    res.status(204).end();
});

// Health check endpoint for hosting platforms
try {
	app.get('/health', function (req, res) {
		res.status(200).send('OK');
	});
} catch (err) {
	console.error("Error loading health endpoint:", err);
	process.exit(1);
}

// ========================================================================
// Banning functions
// ========================================================================

// ========================================================================
// Helper functions
// ========================================================================

try {
	const Utils = require("./utils.js");
	global.Utils = Utils;
} catch (err) {
	console.error("Error loading Utils module:", err);
	process.exit(1);
}

// ========================================================================
// The Beef(TM)
// ========================================================================

const Meat = require("./meat.js");
try {
	const Meat = require("./meat.js");
	Meat.beat();
	global.Meat = Meat;
} catch (err) {
	console.error("Error loading Meat module or calling beat():", err);
	process.exit(1);
}

// Console commands
const Console = require('./console.js');
try {
	const Console = require('./console.js');
	Console.listen();
	global.Console = Console;
} catch (err) {
	console.error("Error loading Console module or calling listen():", err);
	process.exit(1);
}

// ========================================================================
// BOTS -- DO NOT USE
// ========================================================================

// require('./cosmicbot.js');
// twats will use this for posting black people twerking
// require('./boombot.js');
