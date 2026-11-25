const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "bizsight.json");
const sessions = new Map();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const initialData = {
    users: [{
        id: 1,
        username: "admin",
        passwordHash: crypto.scryptSync("admin123", "bizsight-demo-salt", 64).toString("hex")
    }],
    products: [
        { id: 1, name: "Rice 5kg", category: "Grocery", price: 280, stock: 50 },
        { id: 2, name: "Cooking Oil", category: "Grocery", price: 120, stock: 40 },
        { id: 3, name: "Soft Drinks", category: "Beverages", price: 45, stock: 60 },
        { id: 4, name: "Laundry Soap", category: "Household", price: 35, stock: 30 },
        { id: 5, name: "Instant Noodles", category: "Grocery", price: 18, stock: 100 }
    ],
    sales: [],
    nextProductId: 6,
    nextSaleId: 1
};

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        saveDatabase(initialData);
        return structuredClone(initialData);
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        return {
            users: Array.isArray(data.users) ? data.users : initialData.users,
            products: Array.isArray(data.products) ? data.products : [],
            sales: Array.isArray(data.sales) ? data.sales : [],
            nextProductId: Number(data.nextProductId) || 1,
            nextSaleId: Number(data.nextSaleId) || 1
        };
    } catch (error) {
        console.error("Database file could not be read:", error.message);
        process.exit(1);
    }
}

let db = loadDatabase();

function saveDatabase(data = db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, status, data, extraHeaders = {}) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders
    });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 1_000_000) {
                reject(new Error("Request body is too large."));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!body) return resolve({});
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error("Invalid JSON request.")); }
        });
        req.on("error", reject);
    });
}

function parseCookies(req) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach(part => {
        const index = part.indexOf("=");
        if (index > -1) {
            const key = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            cookies[key] = decodeURIComponent(value);
        }
    });
    return cookies;
}

function getSession(req) {
    const token = parseCookies(req).bizsight_session;
    return token ? sessions.get(token) : null;
}

function requireLogin(req, res) {
    if (!getSession(req)) {
        sendJson(res, 401, { error: "Please log in first." });
        return false;
    }
    return true;
}

function safeEqual(a, b) {
    const first = Buffer.from(String(a));
    const second = Buffer.from(String(b));
    return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function serveStatic(req, res, pathname) {
    const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
    const filePath = path.resolve(ROOT, "." + requestedPath);

    if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("File not found");
        }

        const ext = path.extname(filePath).toLowerCase();
        const types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml"
        };

        res.writeHead(200, {
            "Content-Type": types[ext] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff"
        });
        res.end(content);
    });
}

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const method = req.method;

    if (method === "POST" && pathname === "/api/login") {
        const body = await readBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const user = db.users.find(item => item.username === username);

        if (!user) return sendJson(res, 401, { error: "Invalid username or password." });

        const attemptedHash = crypto.scryptSync(password, "bizsight-demo-salt", 64).toString("hex");
        if (!safeEqual(attemptedHash, user.passwordHash)) {
            return sendJson(res, 401, { error: "Invalid username or password." });
        }

        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, { id: user.id, username: user.username });
        return sendJson(res, 200, {
            message: "Login successful.",
            user: { id: user.id, username: user.username }
        }, {
            "Set-Cookie": `bizsight_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
        });
    }

    if (method === "GET" && pathname === "/api/session") {
        const session = getSession(req);
        return sendJson(res, 200, { authenticated: Boolean(session), user: session || null });
    }

    if (method === "POST" && pathname === "/api/logout") {
        const token = parseCookies(req).bizsight_session;
        if (token) sessions.delete(token);
        return sendJson(res, 200, { message: "Logged out." }, {
            "Set-Cookie": "bizsight_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
        });
    }

    if (pathname.startsWith("/api/") && !requireLogin(req, res)) return;

    if (method === "GET" && pathname === "/api/products") {
        return sendJson(res, 200, db.products);
    }

    if (method === "POST" && pathname === "/api/products") {
        const body = await readBody(req);
        const name = String(body.name || "").trim();
        const category = String(body.category || "").trim();
        const price = Number(body.price);
        const stock = Number(body.stock);

        if (!name || !category || !Number.isFinite(price) || price <= 0 ||
            !Number.isInteger(stock) || stock < 0) {
            return sendJson(res, 400, { error: "Enter a product name, category, valid price, and non-negative whole-number stock." });
        }

        const product = { id: db.nextProductId++, name, category, price, stock };
        db.products.push(product);
        saveDatabase();
        return sendJson(res, 201, product);
    }

    const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
    if (productMatch && method === "PUT") {
        const id = Number(productMatch[1]);
        const body = await readBody(req);
        const product = db.products.find(item => item.id === id);
        if (!product) return sendJson(res, 404, { error: "Product not found." });

        const name = String(body.name || "").trim();
        const category = String(body.category || "").trim();
        const price = Number(body.price);
        const stock = Number(body.stock);

        if (!name || !category || !Number.isFinite(price) || price <= 0 ||
            !Number.isInteger(stock) || stock < 0) {
            return sendJson(res, 400, { error: "Invalid product information." });
        }

        Object.assign(product, { name, category, price, stock });
        saveDatabase();
        return sendJson(res, 200, product);
    }

    if (productMatch && method === "DELETE") {
        const id = Number(productMatch[1]);
        if (db.sales.some(sale => sale.productId === id)) {
            return sendJson(res, 409, { error: "This product has sales records and cannot be deleted." });
        }
        const index = db.products.findIndex(item => item.id === id);
        if (index === -1) return sendJson(res, 404, { error: "Product not found." });
        db.products.splice(index, 1);
        saveDatabase();
        return sendJson(res, 200, { message: "Product deleted." });
    }

    if (method === "GET" && pathname === "/api/sales") {
        return sendJson(res, 200, [...db.sales].sort((a, b) => b.id - a.id));
    }

    if (method === "POST" && pathname === "/api/sales") {
        const body = await readBody(req);
        const customer = String(body.customer || "").trim();
        const productId = Number(body.productId);
        const quantity = Number(body.quantity);
        const payment = String(body.payment || "");
        const allowedPayments = ["Cash", "GCash", "Credit Card", "Bank Transfer"];

        if (!customer || !Number.isInteger(productId) || !Number.isInteger(quantity) ||
            quantity < 1 || !allowedPayments.includes(payment)) {
            return sendJson(res, 400, { error: "Please provide valid sale details." });
        }

        const product = db.products.find(item => item.id === productId);
        if (!product) return sendJson(res, 404, { error: "Product not found." });
        if (product.stock < quantity) return sendJson(res, 409, { error: "Insufficient product stock." });

        const total = Number((product.price * quantity).toFixed(2));
        const sale = {
            id: db.nextSaleId++,
            transaction_code: "BS-" + String(db.nextSaleId - 1).padStart(7, "0"),
            sale_date: new Date().toISOString(),
            customer,
            productId: product.id,
            product_name: product.name,
            category: product.category,
            quantity,
            unit_price: product.price,
            total,
            payment
        };

        product.stock -= quantity;
        db.sales.push(sale);
        saveDatabase();
        return sendJson(res, 201, sale);
    }

    const saleMatch = pathname.match(/^\/api\/sales\/(\d+)$/);
    if (saleMatch && method === "DELETE") {
        const id = Number(saleMatch[1]);
        const index = db.sales.findIndex(item => item.id === id);
        if (index === -1) return sendJson(res, 404, { error: "Sale transaction not found." });

        const sale = db.sales[index];
        const product = db.products.find(item => item.id === sale.productId);
        if (product) product.stock += sale.quantity;
        db.sales.splice(index, 1);
        saveDatabase();
        return sendJson(res, 200, { message: "Sale deleted and product stock restored." });
    }

    if (method === "GET" && pathname === "/api/analytics") {
        return sendJson(res, 200, {
            sales: db.sales,
            totalProducts: db.products.length
        });
    }

    if (pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: "API route not found." });
    }

    return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(error => {
        console.error(error);
        if (!res.headersSent) sendJson(res, 500, { error: "Internal server error." });
        else res.end();
    });
});

server.listen(PORT, () => {
    console.log(`BizSight is running at http://localhost:${PORT}`);
});
