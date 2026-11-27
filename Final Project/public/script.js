let products = [];
let sales = [];
let salesChart = null;
let categoryChart = null;

const peso = amount => "₱" + Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error || "Something went wrong.");
    return data;
}

function showLoginError(message) {
    document.getElementById("loginError").textContent = message;
}

async function refreshData() {
    [products, sales] = await Promise.all([
        api("/api/products"),
        api("/api/sales")
    ]);
    renderProducts();
    renderHistory();
    updateDashboard();
    renderReports();
}

document.getElementById("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    showLoginError("");
    try {
        await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("username").value,
                password: document.getElementById("password").value
            })
        });
        document.getElementById("loginPage").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
        await refreshData();
    } catch (error) {
        showLoginError(error.message);
    }
});

async function logout() {
    try { await api("/api/logout", { method: "POST", body: "{}" }); } catch (error) {}
    document.getElementById("mainApp").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("hidden");
    document.getElementById("loginForm").reset();
    showLoginError("");
}

function showPage(page, element) {
    document.querySelectorAll(".page").forEach(section => section.classList.add("hidden"));
    document.getElementById(page).classList.remove("hidden");
    document.querySelectorAll(".sidebar nav a").forEach(link => link.classList.remove("active"));
    if (element) element.classList.add("active");

    const titles = {
        dashboard: "Dashboard",
        products: "Product Management",
        sales: "Record Sales",
        history: "Sales History",
        reports: "Revenue Reports"
    };
    document.getElementById("pageTitle").textContent = titles[page] || "Dashboard";

    if (page === "dashboard") updateDashboard();
    if (page === "products") renderProducts();
    if (page === "sales") renderSaleOptions();
    if (page === "history") renderHistory();
    if (page === "reports") renderReports();
}

function renderProducts() {
    const table = document.getElementById("productTable");
    table.innerHTML = products.map(p => `
        <tr>
            <td>${escapeHTML(p.name)}</td>
            <td>${escapeHTML(p.category)}</td>
            <td>${peso(p.price)}</td>
            <td>${p.stock}</td>
            <td>
                <button onclick="editProduct(${p.id})">Edit</button>
                <button class="delete" onclick="deleteProduct(${p.id})">Delete</button>
            </td>
        </tr>
    `).join("");
    document.getElementById("totalProducts").textContent = products.length;
    renderSaleOptions();
}

async function addProduct() {
    const name = prompt("Enter product name:");
    if (!name || !name.trim()) return;
    const category = prompt("Enter category:");
    if (!category || !category.trim()) return;
    const price = Number(prompt("Enter product price:"));
    const stock = Number(prompt("Enter stock quantity:"));
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        alert("Please enter a valid price and stock.");
        return;
    }
    try {
        await api("/api/products", {
            method: "POST",
            body: JSON.stringify({ name, category, price, stock })
        });
        await refreshData();
    } catch (error) { alert(error.message); }
}

async function editProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;
    const name = prompt("Product name:", product.name);
    if (!name || !name.trim()) return;
    const category = prompt("Category:", product.category);
    if (!category || !category.trim()) return;
    const price = Number(prompt("Price:", product.price));
    const stock = Number(prompt("Stock:", product.stock));
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        alert("Invalid price or stock.");
        return;
    }
    try {
        await api(`/api/products/${id}`, {
            method: "PUT",
            body: JSON.stringify({ name, category, price, stock })
        });
        await refreshData();
    } catch (error) { alert(error.message); }
}

async function deleteProduct(id) {
    if (!confirm("Delete this product?")) return;
    try {
        await api(`/api/products/${id}`, { method: "DELETE" });
        await refreshData();
    } catch (error) { alert(error.message); }
}

function renderSaleOptions() {
    const select = document.getElementById("saleProduct");
    select.innerHTML = products.filter(p => p.stock > 0).map(p => `
        <option value="${p.id}">${escapeHTML(p.name)} - ${peso(p.price)} (Stock: ${p.stock})</option>
    `).join("");
    updateSaleTotal();
}

function updateSaleTotal() {
    const id = Number(document.getElementById("saleProduct").value);
    const quantity = Number(document.getElementById("saleQuantity").value);
    const product = products.find(p => p.id === id);
    document.getElementById("saleTotal").textContent =
        "Total: " + peso(product && quantity > 0 ? product.price * quantity : 0);
}

document.getElementById("saleProduct").addEventListener("change", updateSaleTotal);
document.getElementById("saleQuantity").addEventListener("input", updateSaleTotal);

document.getElementById("salesForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const customer = document.getElementById("customerName").value.trim();
    const productId = Number(document.getElementById("saleProduct").value);
    const quantity = Number(document.getElementById("saleQuantity").value);
    const payment = document.getElementById("paymentMethod").value;

    try {
        await api("/api/sales", {
            method: "POST",
            body: JSON.stringify({ customer, productId, quantity, payment })
        });
        alert("Sale recorded successfully!");
        this.reset();
        document.getElementById("saleQuantity").value = 1;
        await refreshData();
    } catch (error) { alert(error.message); }
});

function renderHistory() {
    const search = document.getElementById("searchSales").value.toLowerCase();
    const filtered = sales.filter(s =>
        s.customer.toLowerCase().includes(search) ||
        s.product_name.toLowerCase().includes(search) ||
        s.transaction_code.toLowerCase().includes(search)
    );
    document.getElementById("historyTable").innerHTML = filtered.map(s => `
        <tr>
            <td>${escapeHTML(s.transaction_code)}</td>
            <td>${new Date(s.sale_date).toLocaleString()}</td>
            <td>${escapeHTML(s.customer)}</td>
            <td>${escapeHTML(s.product_name)}</td>
            <td>${s.quantity}</td>
            <td>${peso(s.total)}</td>
            <td>${escapeHTML(s.payment)}</td>
            <td><button class="delete" onclick="deleteSale(${s.id})">Delete</button></td>
        </tr>
    `).join("");
}

async function deleteSale(id) {
    if (!confirm("Delete this sales transaction? The sold quantity will be returned to product stock.")) return;
    try {
        await api(`/api/sales/${id}`, { method: "DELETE" });
        await refreshData();
    } catch (error) { alert(error.message); }
}

function filterSales(period) {
    const now = new Date();
    return sales.filter(s => {
        const date = new Date(s.sale_date);
        if (period === "day") return date.toDateString() === now.toDateString();
        if (period === "week") {
            const start = new Date(now);
            start.setDate(now.getDate() - 6);
            start.setHours(0, 0, 0, 0);
            return date >= start && date <= now;
        }
        if (period === "month") {
            return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
        }
        return true;
    });
}

function updateDashboard() {
    const period = document.getElementById("salesPeriod").value;
    const filtered = filterSales(period);
    const revenue = filtered.reduce((sum, s) => sum + s.total, 0);
    document.getElementById("totalRevenue").textContent = peso(revenue);
    document.getElementById("totalTransactions").textContent = filtered.length;
    document.getElementById("averageTransaction").textContent =
        peso(filtered.length ? revenue / filtered.length : 0);
    document.getElementById("totalProducts").textContent = products.length;
    renderBestSelling(filtered);
    renderCharts(filtered);
}

function renderBestSelling(data) {
    const summary = {};
    data.forEach(s => {
        if (!summary[s.product_name]) summary[s.product_name] = { quantity: 0, revenue: 0 };
        summary[s.product_name].quantity += s.quantity;
        summary[s.product_name].revenue += s.total;
    });
    const sorted = Object.entries(summary).sort((a, b) => b[1].quantity - a[1].quantity);
    document.getElementById("bestSellingTable").innerHTML = sorted.slice(0, 5).map(([name, value]) => `
        <tr><td>${escapeHTML(name)}</td><td>${value.quantity}</td><td>${peso(value.revenue)}</td></tr>
    `).join("");
}

function renderCharts(data) {
    const daily = {};
    const dayTime = {};

    data.forEach(s => {
        const d = new Date(s.sale_date);
        const date = d.toLocaleDateString();
        daily[date] = (daily[date] || 0) + s.total;
        dayTime[date] = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    });

    const sortedDates = Object.keys(daily).sort((a, b) => dayTime[a] - dayTime[b]);
    const sortedTotals = sortedDates.map(date => daily[date]);

    if (salesChart) salesChart.destroy();
    salesChart = new Chart(document.getElementById("salesChart"), {
        type: "line",
        data: {
            labels: sortedDates,
            datasets: [{
                label: "Sales Revenue",
                data: sortedTotals,
                borderColor: "#2563eb",
                backgroundColor: "rgba(37,99,235,0.15)",
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });

    const categories = {};
    data.forEach(s => categories[s.category] = (categories[s.category] || 0) + s.total);
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(document.getElementById("categoryChart"), {
        type: "doughnut",
        data: {
            labels: Object.keys(categories),
            datasets: [{
                data: Object.values(categories),
                backgroundColor: ["#2563eb", "#16a34a", "#f59e0b", "#9333ea", "#ef4444"]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderReports() {
    const total = data => data.reduce((sum, s) => sum + s.total, 0);
    document.getElementById("dailyRevenue").textContent = peso(total(filterSales("day")));
    document.getElementById("weeklyRevenue").textContent = peso(total(filterSales("week")));
    document.getElementById("monthlyRevenue").textContent = peso(total(filterSales("month")));
    document.getElementById("reportTable").innerHTML = [...sales].map(s => `
        <tr>
            <td>${escapeHTML(s.transaction_code)}</td>
            <td>${new Date(s.sale_date).toLocaleDateString()}</td>
            <td>${escapeHTML(s.customer)}</td>
            <td>${peso(s.total)}</td>
        </tr>
    `).join("");
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
}

async function checkExistingSession() {
    try {
        const session = await api("/api/session");
        if (session.authenticated) {
            document.getElementById("loginPage").classList.add("hidden");
            document.getElementById("mainApp").classList.remove("hidden");
            await refreshData();
        }
    } catch (error) {
        console.error(error);
    }
}

checkExistingSession();
