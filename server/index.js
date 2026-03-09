// ========================================================================
// Server init
// ========================================================================
// Debug: Log uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', (err) => {
	console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Filesystem reading functions
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');

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

// load users for wiki authentication (simple JSON store)
const USERS_FILE = path.join(__dirname, 'users.json');
let users = [];
function loadUsers() {
	try {
		users = fs.readJsonSync(USERS_FILE);
		if (!Array.isArray(users)) users = [];
		// migrate plaintext passwords to bcrypt hashes
		let migrated = false;
		users = users.map(u => {
			if (!u || !u.pass) return u;
			const pass = u.pass;
			if (typeof pass === 'string' && pass.startsWith('$2')) return u; // already hashed
			const hash = bcrypt.hashSync(pass, 10);
			migrated = true;
			return { user: u.user, pass: hash };
		});
		if (migrated) {
			try { fs.writeJsonSync(USERS_FILE, users); } catch (e) { console.error('Failed to write migrated users', e); }
		}
	} catch (e) {
		users = [];
		try { fs.writeJsonSync(USERS_FILE, users); } catch (e) {}
	}
}
function saveUsers() {
	try { fs.writeJsonSync(USERS_FILE, users); } catch (e) { console.error('Failed to save users', e); }
}
loadUsers();

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

// Serve extensionless wiki routes (e.g. /wiki/show -> /build/www/wiki/show.html)
app.use((req, res, next) => {
	try {
		// Serve /wiki/:id/edit as /build/www/wiki/edit.html for all article IDs
		const editMatch = req.path.match(/^\/wiki\/(\d+)\/edit$/);
		if (editMatch) {
			const editFile = path.join(__dirname, '..', 'build', 'www', 'wiki', 'edit.html');
			if (fs.existsSync(editFile)) return res.sendFile(editFile);
		}
		if (!req.path.startsWith('/wiki')) return next();
		// map /wiki or /wiki/ to /wiki/index.html
		const rel = req.path === '/wiki' ? '/wiki/index' : req.path;
		const candidate = path.join(__dirname, '..', 'build', 'www', rel + '.html');
		if (fs.existsSync(candidate)) return res.sendFile(candidate);
		const candidateIndex = path.join(__dirname, '..', 'build', 'www', req.path, 'index.html');
		if (fs.existsSync(candidateIndex)) return res.sendFile(candidateIndex);
	} catch (e) {
		// ignore and continue to next
	}
	return next();
});

function ensureAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'authentication required' });
}

// login/logout simple handlers (username/password from settings)
app.post('/login', (req, res) => {
	const { user, pass, next } = req.body;
	// check settings auth
	if (settings.auth && user === settings.auth.user && pass === settings.auth.pass) {
		req.session.user = user;
		return res.json({ ok: true, next: next || '/wiki/show' });
	}
	// check users.json (bcrypt compare)
	const u = users.find(x => x.user === user);
	if (u && u.pass && bcrypt.compareSync(pass, u.pass)) {
		req.session.user = user;
		return res.json({ ok: true, next: next || '/wiki/show' });
	}
	res.status(403).json({ error: 'invalid credentials' });
});

// signup endpoint: adds a simple user to users.json (password hashed)
app.post('/signup', (req, res) => {
	const { user, pass, next } = req.body;
	if (!user || !pass) return res.status(400).json({ error: 'user and pass required' });
	if (settings.auth && user === settings.auth.user) return res.status(400).json({ error: 'username unavailable' });
	if (users.find(u => u.user === user)) return res.status(400).json({ error: 'username exists' });
	const hash = bcrypt.hashSync(pass, 10);
	users.push({ user, pass: hash });
	saveUsers();
	req.session.user = user;
	res.json({ ok: true, next: next || '/wiki/show' });
});
app.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// return current user session info
app.get('/api/me', (req, res) => {
	res.json({ user: req.session && req.session.user ? req.session.user : null });
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

// return single article
app.get('/api/wiki/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const art = Wiki.get(id);
	if (!art) return res.status(404).json({ error: 'article not found' });
	res.json(art);
});

// increment view count (public) — treat missing article as no-op (204)
app.post('/api/wiki/:id/view', (req, res) => {
	const id = parseInt(req.params.id);
	const v = Wiki.incrementViews(id);
	if (v === null) return res.status(204).end();
	io.emit('wiki:view', { id, views: v });
	res.json({ ok: true, views: v });
});

// add comment
app.post('/api/wiki/:id/comment', ensureAuth, (req, res) => {
	const id = parseInt(req.params.id);
	const { content } = req.body;
	if (!content) return res.status(400).json({ error: 'content required' });
	const comment = Wiki.addComment(id, { author: req.session.user, content });
	if (!comment) return res.status(404).json({ error: 'article not found' });
	io.emit('wiki:comment', { id, comment });
	res.json(comment);
});

// add reply to comment
app.post('/api/wiki/:id/comment/:cid/reply', ensureAuth, (req, res) => {
	const id = parseInt(req.params.id);
	const cid = parseInt(req.params.cid);
	const { content } = req.body;
	if (!content) return res.status(400).json({ error: 'content required' });
	const reply = Wiki.addReply(id, cid, { author: req.session.user, content });
	if (!reply) return res.status(404).json({ error: 'article or comment not found' });
	io.emit('wiki:reply', { id, commentId: cid, reply });
	res.json(reply);
});

// create a new article
app.post('/api/wiki', ensureAuth, async (req, res) => {
	const { title, category, content } = req.body;
	const guid = req.session.user; // use session user as guid
	if (!(await Wiki.moderate(title)) || !(await Wiki.moderate(content))) {
		return res.status(400).json({ error: 'Content failed moderation' });
	}
	const article = Wiki.create({ title, category, content, author: req.session.user, guid });
	io.emit('wiki:update', article);
	res.json(article);
});

// update existing article
app.put('/api/wiki/:id', ensureAuth, async (req, res) => {
	const id = parseInt(req.params.id);
	const guid = req.session.user;
	if (!(await Wiki.moderate(req.body.title)) || !(await Wiki.moderate(req.body.content))) {
		return res.status(400).json({ error: 'Content failed moderation' });
	}
	let art = Wiki.get(id);
	// Allow update if the article author matches session user OR guid matches
	if (art && (art.author === req.session.user || (art.guid && art.guid === guid))) {
		art = Wiki.update(id, { ...req.body, author: req.session.user, guid });
		io.emit('wiki:update', art);
		return res.json(art);
	}
	return res.status(403).json({ error: 'You are not the owner of this article.' });
});

// delete article
app.delete('/api/wiki/:id', ensureAuth, (req, res) => {
	const id = parseInt(req.params.id);
	const guid = req.session.user;
	const art = Wiki.get(id);
	if (!art) return res.status(404).json({ error: 'article not found' });
	// Allow delete if author matches or guid matches
	if (art.author === req.session.user || (art.guid && art.guid === guid)) {
		Wiki.remove(id);
		io.emit('wiki:update', { id });
		return res.status(204).end();
	}
	return res.status(403).json({ error: 'You are not the owner of this article.' });
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
// In-memory article lock system
const articleLocks = {};
// Lock timeout in ms (e.g., 5 minutes)
const LOCK_TIMEOUT = 5 * 60 * 1000;

// Lock an article for a user
app.post('/api/wiki/:id/lock', ensureAuth, (req, res) => {
	const id = parseInt(req.params.id);
	const user = req.session.user;
	const now = Date.now();
	// If locked by someone else and not expired
	if (articleLocks[id] && articleLocks[id].user !== user && (now - articleLocks[id].time < LOCK_TIMEOUT)) {
		return res.status(423).json({ error: 'Article is currently being edited by another user.' });
	}
	// Lock or refresh lock
	articleLocks[id] = { user, time: now };
	res.json({ ok: true });
});

// Unlock an article (on save, cancel, or navigation away)
app.post('/api/wiki/:id/unlock', ensureAuth, (req, res) => {
	const id = parseInt(req.params.id);
	const user = req.session.user;
	if (articleLocks[id] && articleLocks[id].user === user) {
		delete articleLocks[id];
	}
	res.json({ ok: true });
});

// Check lock status
app.get('/api/wiki/:id/lock', ensureAuth, (req, res) => {
	const id = parseInt(req.params.id);
	const user = req.session.user;
	const now = Date.now();
	if (articleLocks[id] && articleLocks[id].user !== user && (now - articleLocks[id].time < LOCK_TIMEOUT)) {
		return res.status(423).json({ error: 'Article is currently being edited by another user.' });
	}
	res.json({ ok: true });
});
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
