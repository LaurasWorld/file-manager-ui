// Import necessary modules
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = 3000;

// Configuration
// Specify the base directory for files
const BASE_DIRECTORY = process.env.BASE_DIRECTORY || '/Users/laura-michelle-lea/development/file-manager-ui/files'; // Default to /home/shared if not set
const SHARED_FILES = {}; // Object to track shared files (key: filename, value: share ID)
const USERS_FILE = path.join(__dirname, 'users.json'); // File to store user data

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));
app.use(express.static('public'));

// Helper function: Load users from file
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

// Helper function: Save users to file
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Authentication Middleware
function isAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.redirect('/login');
}

// Helper function: Get sorted file list
function getSortedFileList(directoryPath) {
    return new Promise((resolve, reject) => {
        fs.readdir(directoryPath, { withFileTypes: true }, (err, files) => {
            if (err) {
                return reject(err);
            }
            const directories = files.filter(file => file.isDirectory()).map(file => ({
                name: file.name,
                type: 'directory'
            }));
            const fileList = files.filter(file => !file.isDirectory()).map(file => ({
                name: file.name,
                type: 'file'
            }));
            resolve([...directories, ...fileList]);
        });
    });
}

// Routes
// Login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.username === username);

    if (user && await bcrypt.compare(password, user.passwordHash)) {
        req.session.isAuthenticated = true;
        return res.redirect('/');
    }
    res.send('Login failed');
});

// Register new user (for admin usage)
app.post('/register', isAuthenticated, async (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();

    if (users.find(u => u.username === username)) {
        return res.status(400).send('User already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    users.push({ username, passwordHash });
    saveUsers(users);

    res.send('User registered successfully');
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Protected route to view files
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const dir = req.query.dir ? path.join(BASE_DIRECTORY, req.query.dir) : BASE_DIRECTORY;
        const query = req.query.q;
        const relativeDir = req.query.dir || '';

        let fileList = await getSortedFileList(dir);

        if (query) {
            fileList = fileList.filter(file => file.name.toLowerCase().includes(query.toLowerCase()));
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>File Manager</title>
                <link rel="stylesheet" href="/style.css">
            </head>
            <body>
                <h1>File Manager</h1>
                <form method="get" action="/">
                    <input type="hidden" name="dir" value="${relativeDir}">
                    <input type="text" name="q" placeholder="Search files..." value="${query || ''}">
                    <button type="submit">Search</button>
                </form>
                <a href="/logout">Logout</a>
                <ul>
                    ${relativeDir ? `<li><a href="/?dir=${encodeURIComponent(path.dirname(relativeDir))}">⬅️ Back</a></li>` : ''}
                    ${fileList.map(f => `<li>${f.type === 'file' ? '📄' : '📁'} <a href="${f.type === 'file' ? `/view/${encodeURIComponent(path.join(relativeDir, f.name))}` : `/?dir=${encodeURIComponent(path.join(relativeDir, f.name))}`}">${f.name}</a> ${f.type === 'file' ? `<a href="/share/${encodeURIComponent(path.join(relativeDir, f.name))}">Share</a>` : ''}</li>`).join('')}
                </ul>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Unable to read directory');
    }
});

// View a file in the browser
app.get('/view/:filename', isAuthenticated, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(BASE_DIRECTORY, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    const ext = path.extname(filename).toLowerCase();
    const browserViewableExtensions = ['.md', '.pdf', '.html', '.txt', '.png', '.jpg', '.jpeg', '.gif'];

    if (browserViewableExtensions.includes(ext)) {
        return res.sendFile(filePath);
    }

    res.send('This file cannot be viewed in the browser.');
});

// Share a file
app.get('/share/:filename', isAuthenticated, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(BASE_DIRECTORY, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    const shareId = Date.now().toString();
    SHARED_FILES[shareId] = filePath;

    res.send(`File shared! Access it at: <a href="/shared/${shareId}">/shared/${shareId}</a>`);
});

// Access shared files
app.get('/shared/:id', (req, res) => {
    const shareId = req.params.id;
    const filePath = SHARED_FILES[shareId];

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).send('File not found or not shared');
    }

    const ext = path.extname(filePath).toLowerCase();
    const browserViewableExtensions = ['.md', '.pdf', '.html', '.txt', '.png', '.jpg', '.jpeg', '.gif'];

    if (browserViewableExtensions.includes(ext)) {
        return res.sendFile(filePath);
    }

    res.send('This file cannot be viewed in the browser.');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving files from: ${BASE_DIRECTORY}`);
});
