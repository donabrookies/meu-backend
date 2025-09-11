import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;

// Função para buscar dados do JSONBin
async function getData() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { "X-Master-Key": API_KEY }
    });
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
    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Erro ao salvar dados:", error);
    throw error;
  }
}

// Endpoint para obter produtos
app.get("/api/products", async (req, res) => {
  try {
    const data = await getData();
    res.json({ products: data.products || [] });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

// Endpoint para obter categorias
app.get("/api/categories", async (req, res) => {
  try {
    const data = await getData();
    res.json({ categories: data.categories || [] });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

// Endpoint para salvar produtos
app.post("/api/products", async (req, res) => {
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

// Endpoint para salvar categorias
app.post("/api/categories", async (req, res) => {
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

// Endpoint de autenticação (simplificado para desenvolvimento)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Autenticação básica para desenvolvimento
    // Em produção, use um sistema de autenticação adequado
    if (username === "admin" && password === "admin123") {
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
    // Verificação simplificada para desenvolvimento
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

// Endpoint padrão para health check
app.get("/", (req, res) => {
  res.json({ message: "Backend Urban Z está funcionando!", status: "OK" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));