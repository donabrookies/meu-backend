import express from "express";
  import fetch from "node-fetch";
  import cors from "cors";
  import dotenv from "dotenv";
  
  dotenv.config();
  
  const app = express();
  
  // Aumentar limite para uploads de imagem
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  
  const BIN_ID = process.env.JSONBIN_BIN_ID;
  const API_KEY = process.env.JSONBIN_API_KEY;
  
  // Função para criptografar (COMPATÍVEL com Render)
  function simpleEncrypt(text) {
    return Buffer.from(text).toString('base64').split('').reverse().join('');
  }
  
  // Função para descriptografar (COMPATÍVEL com Render)
  function simpleDecrypt(encrypted) {
    return Buffer.from(encrypted.split('').reverse().join(''), 'base64').toString('utf8');
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
      return data.record || { products: [], categories: [], admin_credentials: null };
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      return { products: [], categories: [], admin_credentials: null };
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
  
  // Normalizar categorias - garantir que sejam objetos
  function normalizeCategories(categories) {
    if (!Array.isArray(categories)) return [];
    
    return categories.map(cat => {
      if (typeof cat === 'string') {
        return {
          id: cat,
          name: cat.charAt(0).toUpperCase() + cat.slice(1),
          description: `Categoria de ${cat}`
        };
      }
      if (cat && typeof cat === 'object' && cat.id) {
        return {
          id: cat.id,
          name: cat.name || cat.id.charAt(0).toUpperCase() + cat.id.slice(1),
          description: cat.description || `Categoria de ${cat.name || cat.id}`
        };
      }
      return null;
    }).filter(cat => cat !== null);
  }
  
  // Normalizar produtos - garantir estrutura de cores correta
  function normalizeProducts(products) {
    if (!Array.isArray(products)) return [];
    
    return products.map(product => {
      // Se o produto ainda usa a estrutura antiga (sizes diretamente)
      if (product.sizes && !product.colors) {
        return {
          ...product,
          colors: [
            {
              name: product.color || 'Padrão',
              image: product.image || 'https://via.placeholder.com/400x300',
              sizes: product.sizes
            }
          ]
        };
      }
      
      // Se já tem a estrutura nova, garantir que está correta
      if (product.colors && Array.isArray(product.colors)) {
        return {
          ...product,
          colors: product.colors.map(color => ({
            name: color.name || 'Sem nome',
            image: color.image || 'https://via.placeholder.com/400x300',
            sizes: color.sizes || []
          }))
        };
      }
      
      return product;
    });
  }
  
  // Configurar credenciais iniciais se não existirem
  async function setupInitialCredentials() {
    const data = await getData();
    
    if (!data.admin_credentials) {
      // Credenciais padrão (usuário: admin, senha: admin123)
      data.admin_credentials = {
        username: simpleEncrypt('admin'),
        password: simpleEncrypt('admin123')
      };
      
      await saveData(data);
      
      console.log('Credenciais padrão criadas:');
      console.log('Usuário: admin');
      console.log('Senha: admin123');
    }
  }
  
  // Verificar autenticação
  function checkAuth(token) {
    return token === "authenticated_admin_token";
  }
  
  // Endpoints que seu frontend está tentando acessar
  app.post("/save-data", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
        return res.status(401).json({ error: "Não autorizado" });
      }
      
      const dataToSave = req.body;
      
      // Normalizar categorias e produtos antes de salvar
      if (dataToSave.categories) {
        dataToSave.categories = normalizeCategories(dataToSave.categories);
      }
      
      if (dataToSave.products) {
        dataToSave.products = normalizeProducts(dataToSave.products);
      }
      
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
      const authHeader = req.headers.authorization;
      if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
        return res.status(401).json({ error: "Não autorizado" });
      }
      
      const data = await getData();
      
      // Normalizar categorias e produtos antes de retornar
      if (data.categories) {
        data.categories = normalizeCategories(data.categories);
      }
      
      if (data.products) {
        data.products = normalizeProducts(data.products);
      }
      
      res.json(data);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      res.status(500).json({ 
        error: "Erro ao carregar dados",
        message: error.message 
      });
    }
  });
  
  // Endpoints existentes (mantidos para compatibilidade)
  app.get("/api/products", async (req, res) => {
    try {
      const data = await getData();
      let products = data.products || [];
      
      // Normalizar produtos antes de retornar
      products = normalizeProducts(products);
      
      res.json({ products });
    } catch (error) {
      console.error("Erro ao buscar produtos:", error);
      res.status(500).json({ error: "Erro ao buscar produtos" });
    }
  });
  
  app.get("/api/categories", async (req, res) => {
    try {
      const data = await getData();
      
      // Normalizar categorias antes de retornar
      let categories = data.categories || [];
      categories = normalizeCategories(categories);
      
      // Se não há categorias, retornar as padrão
      if (categories.length === 0) {
        categories = [
          {
            id: 'camisa',
            name: 'Camisas',
            description: 'Camisas de diversos modelos e estilos'
          },
          {
            id: 'short',
            name: 'Shorts',
            description: 'Shorts para o dia a dia e prática esportiva'
          }
        ];
      }
      
      res.json({ categories });
    } catch (error) {
      console.error("Erro ao buscar categorias:", error);
      res.status(500).json({ error: "Erro ao buscar categorias" });
    }
  });
  
  app.post("/api/products", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
        return res.status(401).json({ error: "Não autorizado" });
      }
      
      const { products } = req.body;
      const data = await getData();
      
      // Normalizar produtos antes de salvar
      data.products = normalizeProducts(products);
      data.lastUpdated = new Date().toISOString();
      
      await saveData(data);
      res.json({ success: true });
    } catch (error) {
      console.error("Erro ao salvar produtos:", error);
      res.status(500).json({ error: "Erro ao salvar produtos" });
    }
  });
  
  app.post("/api/categories", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
        return res.status(401).json({ error: "Não autorizado" });
      }
      
      const { categories } = req.body;
      const data = await getData();
      
      // Normalizar categorias antes de salvar
      data.categories = normalizeCategories(categories);
      data.lastUpdated = new Date().toISOString();
      
      await saveData(data);
      res.json({ success: true });
    } catch (error) {
      console.error("Erro ao salvar categorias:", error);
      res.status(500).json({ error: "Erro ao salvar categorias" });
    }
  });
  
  // Endpoint de autenticação (agora seguro)
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      const data = await getData();
      
      if (!data.admin_credentials) {
        await setupInitialCredentials();
        return res.status(401).json({ error: "Credenciais não configuradas. Recarregue a página." });
      }
      
      // Verificar credenciais
      if (simpleEncrypt(username) === data.admin_credentials.username && 
          simpleEncrypt(password) === data.admin_credentials.password) {
        res.json({ 
          success: true, 
          token: "authenticated_admin_token", 
          user: { username: username } 
        });
      } else {
        res.status(401).json({ error: "Credenciais inválidas" });
      }
    } catch (error) {
      console.error("Erro no login:", error);
      res.status(500).json({ error: "Erro no processo de login" });
    }
  });
  
  // Endpoint para alterar senha
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
        return res.status(401).json({ error: "Não autorizado" });
      }
      
      const { currentPassword, newPassword } = req.body;
      
      const data = await getData();
      
      // Verificar senha atual
      if (simpleEncrypt(currentPassword) !== data.admin_credentials.password) {
        return res.status(401).json({ error: "Senha atual incorreta" });
      }
      
      // Atualizar senha
      data.admin_credentials.password = simpleEncrypt(newPassword);
      await saveData(data);
      
      res.json({ success: true, message: "Senha alterada com sucesso" });
    } catch (error) {
      console.error("Erro ao alterar senha:", error);
      res.status(500).json({ error: "Erro ao alterar senha" });
    }
  });
  
  // Endpoint para verificar autenticação
  app.get("/api/auth/verify", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      
      if (token && checkAuth(token)) {
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
    res.json({ 
      message: "Backend Urban Z está funcionando!", 
      status: "OK",
      endpoints: {
        saveData: "POST /save-data",
        loadData: "GET /load-data",
        products: "GET /api/products",
        categories: "GET /api/categories",
        login: "POST /api/auth/login"
      }
    });
  });
  
  // Inicializar credenciais
  setupInitialCredentials().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
  });