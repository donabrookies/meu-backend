import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

// Configuração de CORS
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// Sistema de sessão simplificado
const sessions = new Map();

// Middleware de sessão
app.use((req, res, next) => {
  const sessionId = req.headers.authorization || req.query.sessionid;
  
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    // Verificar se a sessão expirou
    if (session.expires > Date.now()) {
      req.session = session.data;
    } else {
      sessions.delete(sessionId);
      req.session = {};
    }
  } else {
    req.session = {};
  }
  
  req.saveSession = (data, expiresIn = 24 * 60 * 60 * 1000) => {
    const newSessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(newSessionId, {
      data: data,
      expires: Date.now() + expiresIn
    });
    return newSessionId;
  };
  
  next();
});

// Limpar sessões expiradas periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expires <= now) {
      sessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000); // A cada hora

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;

// Middleware para verificar autenticação
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated && req.session.user) {
    next();
  } else {
    res.status(401).json({ error: "Acesso não autorizado" });
  }
};

// Função para criar hash de senha (simplificada)
function simpleHash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
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
    return data.record || { products: [], categories: [], admin: {} };
  } catch (error) {
    console.error("Erro ao buscar dados:", error);
    return { products: [], categories: [], admin: {} };
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

// Inicializar dados de administrador se não existirem
async function initializeAdmin() {
  try {
    const data = await getData();
    
    if (!data.admin) {
      data.admin = {
        credentials: {
          username: "admin",
          passwordHash: simpleHash("admin123") // Senha padrão
        }
      };
      await saveData(data);
      console.log("Credenciais de administrador inicializadas");
      console.log("Usuário: admin");
      console.log("Senha: admin123");
    }
    
    return data;
  } catch (error) {
    console.error("Erro ao inicializar admin:", error);
  }
}

// Endpoints de autenticação
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    }
    
    const data = await getData();
    
    if (!data.admin || !data.admin.credentials) {
      await initializeAdmin();
      return res.status(500).json({ error: "Sistema não configurado. Tente novamente." });
    }
    
    // Verificar credenciais
    const isValidUsername = username === data.admin.credentials.username;
    const isValidPassword = simpleHash(password) === data.admin.credentials.passwordHash;
    
    if (isValidUsername && isValidPassword) {
      // Criar sessão
      const sessionId = req.saveSession({
        authenticated: true,
        user: { username }
      });
      
      res.json({ 
        success: true, 
        message: "Login realizado com sucesso",
        user: { username },
        sessionId: sessionId
      });
    } else {
      res.status(401).json({ error: "Credenciais inválidas" });
    }
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Erro no processo de login" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sessionId = req.headers.authorization;
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.json({ success: true, message: "Logout realizado com sucesso" });
});

app.get("/api/auth/check", (req, res) => {
  if (req.session && req.session.authenticated) {
    res.json({ 
      authenticated: true, 
      user: req.session.user 
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias" });
    }
    
    const data = await getData();
    
    // Verificar senha atual
    const isValidPassword = simpleHash(currentPassword) === data.admin.credentials.passwordHash;
    
    if (!isValidPassword) {
      return res.status(401).json({ error: "Senha atual incorreta" });
    }
    
    // Atualizar senha
    data.admin.credentials.passwordHash = simpleHash(newPassword);
    await saveData(data);
    
    res.json({ success: true, message: "Senha alterada com sucesso" });
  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    res.status(500).json({ error: "Erro ao alterar senha" });
  }
});

// Endpoints protegidos para dados
app.get("/api/admin/data", requireAuth, async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    res.status(500).json({ error: "Erro ao carregar dados" });
  }
});

app.post("/api/admin/save-data", requireAuth, async (req, res) => {
  try {
    const dataToSave = req.body;
    const result = await saveData(dataToSave);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Erro ao salvar dados:", error);
    res.status(500).json({ error: "Erro ao salvar dados" });
  }
});

// Endpoints públicos para a loja
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

// Endpoint padrão para health check
app.get("/", (req, res) => {
  res.json({ 
    message: "Backend Urban Z está funcionando!", 
    status: "OK",
    endpoints: {
      login: "POST /api/auth/login",
      logout: "POST /api/auth/logout",
      checkAuth: "GET /api/auth/check",
      products: "GET /api/products",
      categories: "GET /api/categories"
    }
  });
});

// Inicializar admin ao iniciar o servidor
initializeAdmin().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
});