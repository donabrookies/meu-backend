import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken"; // Adicione esta dependência

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "seu_jwt_secreto_aqui"; // Adicione esta linha

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

// Middleware para verificar autenticação
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso necessário' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
}

// Endpoints que seu frontend está tentando acessar
app.post("/save-data", authenticateToken, async (req, res) => {
  try {
    const dataToSave = req.body;
    const result = await saveData(dataToSave);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Erro ao salvar dados:", error);
    res.status(500).json({ 
      success: false, 
      error: "Erro ao salvar dados",
      message: error.message 
    });
  }
});

app.get("/load-data", async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    res.status(500).json({ 
      error: "Erro ao carregar dados",
      message: error.message 
    });
  }
});

// Seus endpoints existentes (mantidos para compatibilidade)
app.get("/api/products", async (req, res) => {
  try {
    const data = await getData();
    res.json({ products: data.products || [] });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const data = await getData();
    res.json({ categories: data.categories || [] });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

app.post("/api/products", authenticateToken, async (req, res) => {
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

app.post("/api/categories", authenticateToken, async (req, res) => {
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

// Endpoint de autenticação (agora com JWT)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Autenticação básica para desenvolvimento
    if (username === "admin" && password === "admin123") {
      // Criar token JWT
      const token = jwt.sign(
        { username: username, id: 1 }, 
        JWT_SECRET, 
        { expiresIn: '15m' } // Token expira em 15 minutos
      );
      
      res.json({ 
        success: true, 
        token: token, 
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
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.json({ valid: false });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.json({ valid: false });
      }
      res.json({ valid: true, user: user });
    });
  } catch (error) {
    console.error("Erro ao verificar autenticação:", error);
    res.status(500).json({ error: "Erro ao verificar autenticação" });
  }
});

// Endpoint padrão para health check
app.get("/", (req, res) => {
  res.json({ 
    message: "Backend Urban Z está funcionando!", 
    status: "OK",
    endpoints: {
      saveData: "POST /save-data",
      loadData: "GET /load-data",
      products: "GET /api/products",
      categories: "GET /api/categories"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));