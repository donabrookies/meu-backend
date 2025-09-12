import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;

// Função para criptografar (mesma lógica do frontend)
function simpleEncrypt(text) {
  return Buffer.from(text).toString('base64').split('').reverse().join('');
}

// Função para descriptografar (mesma lógica do frontend)
function simpleDecrypt(encrypted) {
  return Buffer.from(encrypted.split('').reverse().join(''), 'base64').toString('utf8');
}

// Credenciais de administrador (em produção, use variáveis de ambiente)
const ADMIN_CREDENTIALS = {
  username: simpleEncrypt('admin'),
  password: simpleEncrypt('admin123')
};

// Middleware para verificar autenticação
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  if (token && token === "dev-token-admin") {
    next();
  } else {
    res.status(401).json({ error: "Acesso não autorizado" });
  }
}

// Função para buscar dados do JSONBin
async function getData() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { "X-Master-Key": API_KEY }
    });
    
    if (!response.ok) {
      throw new Error(`Erro ao buscar dados: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.record || { products: [], categories: [] };
  } catch (error) {
    console.error("Erro ao buscar dados:", error);
    return { products: [], categories: [] };
  }
}

// Função para salvar dados no JSONBin
async function saveData(data) {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY,
        "X-Bin-Versioning": "false"
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Erro ao salvar dados: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Erro ao salvar dados:", error);
    throw error;
  }
}

// Endpoint de autenticação
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Verificar credenciais usando a mesma lógica de criptografia do frontend
    if (simpleEncrypt(username) === ADMIN_CREDENTIALS.username && 
        simpleEncrypt(password) === ADMIN_CREDENTIALS.password) {
      res.json({ 
        success: true, 
        token: "dev-token-admin", 
        user: { username: "admin" } 
      });
    } else {
      res.status(401).json({ error: "Credenciais inválidas" });
    }
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Erro no processo de login" });
  }
});

// Endpoint para verificar autenticação
app.get("/api/auth/verify", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    
    if (token === "dev-token-admin") {
      res.json({ valid: true, user: { username: "admin" } });
    } else {
      res.json({ valid: false });
    }
  } catch (error) {
    console.error("Erro ao verificar autenticação:", error);
    res.status(500).json({ error: "Erro ao verificar autenticação" });
  }
});

// Endpoints protegidos (requerem autenticação)
app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const data = await getData();
    res.json({ products: data.products || [] });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

app.get("/api/categories", requireAuth, async (req, res) => {
  try {
    const data = await getData();
    res.json({ categories: data.categories || [] });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

app.post("/api/products", requireAuth, async (req, res) => {
  try {
    const { products } = req.body;
    const data = await getData();
    data.products = products;
    await saveData(data);
    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar produtos:", error);
    res.status(500).json({ error: "Erro ao salvar produtos" });
  }
});

app.post("/api/categories", requireAuth, async (req, res) => {
  try {
    const { categories } = req.body;
    const data = await getData();
    data.categories = categories;
    await saveData(data);
    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar categorias:", error);
    res.status(500).json({ error: "Erro ao salvar categorias" });
  }
});

// Endpoints públicos para a loja
app.get("/api/store/products", async (req, res) => {
  try {
    const data = await getData();
    // Retornar apenas produtos ativos para a loja
    const activeProducts = (data.products || []).filter(product => product.status === 'active');
    res.json({ products: activeProducts });
  } catch (error) {
    console.error("Erro ao buscar produtos da loja:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

app.get("/api/store/categories", async (req, res) => {
  try {
    const data = await getData();
    res.json({ categories: data.categories || [] });
  } catch (error) {
    console.error("Erro ao buscar categorias da loja:", error);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

// Endpoint padrão para health check
app.get("/", (req, res) => {
  res.json({ 
    message: "Backend Urban Z está funcionando!", 
    status: "OK",
    endpoints: {
      login: "POST /api/auth/login",
      products: "GET /api/products (requer auth)",
      storeProducts: "GET /api/store/products (público)"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));