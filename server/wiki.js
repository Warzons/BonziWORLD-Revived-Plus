const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'wiki.json');
let data = [];

// load settings (used for openaiApiKey fallback)
let settings = {};
try {
    settings = require('./settings.json');
} catch (e) {
    settings = {};
}

// articles will have shape {id,title,category,content,date,author,versions:[...]} 

function load() {
    try {
        data = fs.readJsonSync(DATA_FILE);
        if (!Array.isArray(data)) data = [];
    } catch (e) {
        // file might not exist yet
        data = [];
        save();
    }
}

function save() {
    try {
        fs.writeJsonSync(DATA_FILE, data);
    } catch (e) {
        console.error("Failed to save wiki data", e);
    }
}

function list() {
    return data;
}

function search(term) {
    const lower = term.toLowerCase();
    return data.filter(a => a.title.toLowerCase().includes(lower) || a.content.toLowerCase().includes(lower));
}

function byAuthor(name) {
    const lower = name.toLowerCase();
    return data.filter(a => a.author && a.author.toLowerCase().includes(lower));
}

// trending: most recent edits first
function trending(limit = 20) {
    return [...data].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,limit);
}

function get(id) {
    return data.find(a => a.id === id);
}

function create(article) {
    const next = data.length ? Math.max(...data.map(a => a.id)) + 1 : 1;
    const entry = {
        id: next,
        title: article.title || '',
        category: article.category || '',
        content: article.content || '',
        author: article.author || 'anonymous',
        guid: article.guid || null, // store owner's guid
        date: new Date().toISOString(),
        versions: [], // history of edits
        views: 0,
        comments: []
    };
    data.push(entry);
    save();
    return entry;
}

function update(id, article) {
    const idx = data.findIndex(a => a.id === id);
    if (idx === -1) return null;
    // Only allow update if guid matches
    if (article.guid && data[idx].guid && article.guid !== data[idx].guid) {
        return null;
    }
    // push previous state into versions
    const old = {...data[idx]};
    delete old.versions;
    data[idx].versions.push(old);
    data[idx] = {
        ...data[idx],
        title: article.title !== undefined ? article.title : data[idx].title,
        category: article.category !== undefined ? article.category : data[idx].category,
        content: article.content !== undefined ? article.content : data[idx].content,
        author: article.author || data[idx].author,
        date: new Date().toISOString()
    };
    save();
    return data[idx];
}

function incrementViews(id) {
    const idx = data.findIndex(a => a.id === id);
    if (idx === -1) return null;
    data[idx].views = (data[idx].views || 0) + 1;
    save();
    return data[idx].views;
}

function addComment(id, comment) {
    const idx = data.findIndex(a => a.id === id);
    if (idx === -1) return null;
    const cnext = data[idx].comments && data[idx].comments.length ? Math.max(...data[idx].comments.map(c=>c.id)) + 1 : 1;
    const entry = {
        id: cnext,
        author: comment.author || 'anonymous',
        content: comment.content || '',
        date: new Date().toISOString(),
        replies: []
    };
    data[idx].comments = data[idx].comments || [];
    data[idx].comments.push(entry);
    save();
    return entry;
}

function addReply(id, commentId, reply) {
    const idx = data.findIndex(a => a.id === id);
    if (idx === -1) return null;
    const comments = data[idx].comments || [];
    const cidx = comments.findIndex(c => c.id === commentId);
    if (cidx === -1) return null;
    const rnext = comments[cidx].replies && comments[cidx].replies.length ? Math.max(...comments[cidx].replies.map(r=>r.id)) + 1 : 1;
    const entry = {
        id: rnext,
        author: reply.author || 'anonymous',
        content: reply.content || '',
        date: new Date().toISOString()
    };
    comments[cidx].replies = comments[cidx].replies || [];
    comments[cidx].replies.push(entry);
    save();
    return entry;
}

function remove(id) {
    data = data.filter(a => a.id !== id);
    save();
    // Optionally, could enforce guid check here if needed
}

// moderation using external AI service if configured, otherwise fallback
async function moderate(text) {
    if (typeof text !== 'string') return true;
    // prefer environment variable only for OpenAI key
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
        try {
            const fetch = require('node-fetch');
            const resp = await fetch('https://api.openai.com/v1/moderations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({ model: 'omni-moderation-latest', input: text })
            });
            const data = await resp.json();
            if (data && data.results && data.results[0] && data.results[0].flagged) {
                return false;
            }
            return true;
        } catch (e) {
            console.error('moderation API error', e);
            // fallback to naive
        }
    }
    // simple keyword blacklist
    const banned = ['vandal', 'spam', 'fuck', 'shit', 'bitch'];
    const lower = text.toLowerCase();
    return !banned.some(w => lower.includes(w));
}

module.exports = {
    load,
    list,
    get,
    create,
    update,
    remove,
    incrementViews,
    addComment,
    addReply,
    moderate
};
