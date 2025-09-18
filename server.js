import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Configurações aprimoradas
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Master-Key']
}));

// Aumentar limites significativamente
app.use(express.json({ 
  limit: '100mb',  // Aumentado para 100MB
  parameterLimit: 100000,
  extended: true
}));
app.use(express.urlencoded({ 
  limit: '100mb', 
  extended: true, 
  parameterLimit: 100000 
}));

// Timeout estendido para requisições
app.use((req, res, next) => {
  req.setTimeout(180000); // 3 minutos
  res.setTimeout(180000);
  next();
});

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;

if (!BIN_ID || !API_KEY) {
  console.error('❌ Variáveis de ambiente JSONBIN_BIN_ID e JSONBIN_API_KEY são obrigatórias!');
  process.exit(1);
}

console.log('🔑 Configurado com BIN ID:', BIN_ID.substring(0, 8) + '...');

// Função para criptografar (COMPATÍVEL com Render e Browser)
function simpleEncrypt(text) {
  try {
    return Buffer.from(text).toString('base64').split('').reverse().join('');
  } catch (error) {
    console.error('Erro ao criptografar:', error);
    return '';
  }
}

// Função para descriptografar (COMPATÍVEL com Render e Browser)
function simpleDecrypt(encrypted) {
  try {
    return Buffer.from(encrypted.split('').reverse().join(''), 'base64').toString('utf8');
  } catch (error) {
    console.error('Erro ao descriptografar:', error);
    return '';
  }
}

// Cache com TTL mais longo para reduzir requisições
let dataCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000; // 60 segundos

// Função para buscar dados do JSONBin com retry melhorado
async function getData(useCache = true) {
  // Usar cache se disponível e não expirado
  if (useCache && dataCache && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
    console.log('📋 Usando dados do cache');
    return dataCache;
  }

  const maxRetries = 5; // Aumentado para 5 tentativas
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📡 Buscando dados do JSONBin (tentativa ${attempt}/${maxRetries})...`);
      
      const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
        headers: { 
          "X-Master-Key": API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000 // 30 segundos timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const result = data.record || { products: [], categories: [], admin_credentials: null };
      
      // Normalizar dados antes de cachear
      result.products = normalizeProducts(result.products || []);
      result.categories = normalizeCategories(result.categories || []);
      
      // Atualizar cache
      dataCache = result;
      cacheTimestamp = Date.now();
      
      console.log('✅ Dados carregados:', { 
        products: result.products.length, 
        categories: result.categories.length,
        hasCredentials: !!result.admin_credentials,
        size: JSON.stringify(result).length + ' bytes'
      });
      
      return result;
      
    } catch (error) {
      console.error(`❌ Erro na tentativa ${attempt}:`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.min(attempt * 3000, 15000); // Max 15s delay
        console.log(`⏳ Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('💥 Todas as tentativas falharam, usando dados padrão');
  
  const defaultData = { 
    products: getDefaultProducts(), 
    categories: getDefaultCategories(), 
    admin_credentials: null 
  };
  
  // Cachear dados padrão
  dataCache = defaultData;
  cacheTimestamp = Date.now();
  
  return defaultData;
}

// Função para salvar dados no JSONBin com retry melhorado
async function saveData(data) {
  const maxRetries = 5; // Aumentado para 5 tentativas
  let lastError = null;

  // Validar dados antes de salvar
  if (!data || typeof data !== 'object') {
    throw new Error('Dados inválidos para salvar');
  }

  // Normalizar dados antes de salvar
  const normalizedData = {
    ...data,
    products: normalizeProducts(data.products || []),
    categories: normalizeCategories(data.categories || []),
    lastUpdated: new Date().toISOString(),
    version: "2.0"
  };

  // Verificar tamanho dos dados
  const dataSize = JSON.stringify(normalizedData).length;
  console.log(`📊 Preparando para salvar: ${dataSize} bytes`);

  if (dataSize > 50 * 1024 * 1024) { // 50MB limite
    throw new Error('Dados muito grandes (>50MB). Reduza o número de produtos ou tamanho das imagens.');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`💾 Salvando dados (tentativa ${attempt}/${maxRetries})...`);
      console.log('📊 Dados a salvar:', {
        products: normalizedData.products.length,
        categories: normalizedData.categories.length,
        size: dataSize + ' bytes'
      });
      
      const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": API_KEY,
          "X-Bin-Versioning": "false"
        },
        body: JSON.stringify(normalizedData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json();
      
      // Atualizar cache com dados salvos
      dataCache = normalizedData;
      cacheTimestamp = Date.now();
      
      console.log('✅ Dados salvos com sucesso');
      return result;
      
    } catch (error) {
      console.error(`❌ Erro ao salvar (tentativa ${attempt}):`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.min(attempt * 2000, 10000); // Max 10s delay
        console.log(`⏳ Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Normalizar categorias - garantir que sejam objetos
function normalizeCategories(categories) {
  if (!Array.isArray(categories)) return getDefaultCategories();
  
  const normalized = categories.map(cat => {
    if (typeof cat === 'string') {
      return {
        id: cat.toLowerCase().replace(/[^a-z0-9]/g, ''),
        name: cat.charAt(0).toUpperCase() + cat.slice(1),
        description: `Categoria de ${cat}`
      };
    }
    if (cat && typeof cat === 'object' && cat.id) {
      return {
        id: cat.id.toLowerCase().replace(/[^a-z0-9]/g, ''),
        name: cat.name || cat.id.charAt(0).toUpperCase() + cat.id.slice(1),
        description: cat.description || `Categoria de ${cat.name || cat.id}`
      };
    }
    return null;
  }).filter(cat => cat !== null && cat.id);
  
  return normalized.length > 0 ? normalized : getDefaultCategories();
}

// Normalizar produtos - garantir estrutura de cores correta
function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  
  return products.map(product => {
    if (!product || typeof product !== 'object') return null;
    
    // Se o produto ainda usa a estrutura antiga (sizes diretamente)
    if (product.sizes && !product.colors) {
      return {
        id: product.id || 1,
        title: product.title || 'Produto sem nome',
        category: product.category || 'geral',
        price: parseFloat(product.price) || 0,
        description: product.description || 'Sem descrição',
        status: product.status || 'active',
        colors: [
          {
            name: product.color || 'Padrão',
            image: product.image || 'https://via.placeholder.com/400x300',
            sizes: Array.isArray(product.sizes) ? product.sizes.map(size => ({
              name: size.name || 'M',
              stock: parseInt(size.stock) || 0
            })) : []
          }
        ]
      };
    }
    
    // Se já tem a estrutura nova, garantir que está correta
    const normalizedProduct = {
      id: product.id || 1,
      title: product.title || 'Produto sem nome',
      category: product.category || 'geral',
      price: parseFloat(product.price) || 0,
      description: product.description || 'Sem descrição',
      status: product.status || 'active',
      colors: []
    };
    
    if (product.colors && Array.isArray(product.colors)) {
      normalizedProduct.colors = product.colors.map(color => ({
        name: color.name || 'Sem nome',
        image: color.image || 'https://via.placeholder.com/400x300',
        sizes: Array.isArray(color.sizes) ? color.sizes.map(size => ({
          name: size.name || 'M',
          stock: parseInt(size.stock) || 0
        })) : []
      })).filter(color => color.name && color.image);
    }
    
    // Se não há cores válidas, adicionar uma cor padrão
    if (normalizedProduct.colors.length === 0) {
      normalizedProduct.colors = [{
        name: 'Padrão',
        image: 'https://via.placeholder.com/400x300',
        sizes: [
          { name: 'P', stock: 0 },
          { name: 'M', stock: 0 },
          { name: 'G', stock: 0 },
          { name: 'GG', stock: 0 }
        ]
      }];
    }
    
    return normalizedProduct;
  }).filter(product => product !== null);
}

// Dados padrão
function getDefaultCategories() {
  return [
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

function getDefaultProducts() {
  return [
    {
      id: 1,
      title: "Camiseta Básica Algodão",
      category: "camisa",
      price: 59.9,
      description: "Camiseta 100% algodão, caimento regular. Conforto para o dia a dia.",
      colors: [
        {
          name: "Branco",
          image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=800&q=80",
          sizes: [
            { name: "P", stock: 5 },
            { name: "M", stock: 8 },
            { name: "G", stock: 3 },
            { name: "GG", stock: 2 }
          ]
        }
      ],
      status: "active"
    }
  ];
}

// Configurar credenciais iniciais se não existirem
async function setupInitialCredentials() {
  try {
    const data = await getData(false); // Não usar cache
    
    if (!data.admin_credentials) {
      console.log('🔐 Configurando credenciais padrão...');
      
      // Credenciais padrão (usuário: admin, senha: admin123)
      data.admin_credentials = {
        username: simpleEncrypt('admin'),
        password: simpleEncrypt('admin123')
      };
      
      await saveData(data);
      
      console.log('✅ Credenciais padrão criadas:');
      console.log('👤 Usuário: admin');
      console.log('🔑 Senha: admin123');
    } else {
      console.log('✅ Credenciais já configuradas');
    }
  } catch (error) {
    console.error('❌ Erro ao configurar credenciais:', error);
  }
}

// Verificar autenticação
function checkAuth(token) {
  return token === "authenticated_admin_token";
}

// Middleware de validação melhorado
function validateProductData(products) {
  if (!Array.isArray(products)) {
    throw new Error('Products deve ser um array');
  }
  
  if (products.length === 0) {
    throw new Error('Array de produtos não pode estar vazio');
  }
  
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    
    if (!product || typeof product !== 'object') {
      throw new Error(`Produto ${i + 1} é inválido`);
    }
    
    if (!product.title || typeof product.title !== 'string' || product.title.trim().length === 0) {
      throw new Error(`Produto ${i + 1} deve ter um título válido`);
    }
    
    if (!product.category || typeof product.category !== 'string') {
      throw new Error(`Produto ${i + 1} deve ter uma categoria válida`);
    }
    
    if (!product.price || isNaN(parseFloat(product.price)) || parseFloat(product.price) <= 0) {
      throw new Error(`Produto ${i + 1} deve ter um preço válido`);
    }
    
    if (!Array.isArray(product.colors) || product.colors.length === 0) {
      throw new Error(`Produto ${i + 1} deve ter pelo menos uma cor`);
    }
    
    for (let j = 0; j < product.colors.length; j++) {
      const color = product.colors[j];
      
      if (!color.name || typeof color.name !== 'string') {
        throw new Error(`Cor ${j + 1} do produto ${i + 1} deve ter um nome válido`);
      }
      
      if (!color.image || typeof color.image !== 'string') {
        throw new Error(`Cor ${j + 1} do produto ${i + 1} deve ter uma imagem válida`);
      }
      
      // Verificar se a imagem base64 não é muito grande
      if (color.image.startsWith('data:') && color.image.length > 500 * 1024) { // 500KB
        console.warn(`⚠️ Imagem da cor ${color.name} do produto ${product.title} é muito grande (${Math.round(color.image.length/1024)}KB)`);
      }
    }
  }
}

// Middleware de log de requisições melhorado
app.use((req, res, next) => {
  const start = Date.now();
  const contentLength = req.get('content-length') || 0;
  console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()} - ${contentLength} bytes`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusIcon = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
    console.log(`📤 ${statusIcon} ${req.method} ${req.path} - ${status} - ${duration}ms`);
  });
  
  next();
});

// ENDPOINTS PRINCIPAIS

// Endpoint de health check aprimorado
app.get("/", (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    message: "🚀 Backend Urban Z está funcionando!", 
    status: "OK",
    timestamp: new Date().toISOString(),
    version: "2.1",
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    },
    cache: {
      active: !!dataCache,
      age: dataCache ? Math.round((Date.now() - cacheTimestamp) / 1000) + 's' : 'N/A'
    },
    endpoints: {
      health: "GET /",
      products: "GET /api/products",
      categories: "GET /api/categories",
      login: "POST /api/auth/login",
      saveProducts: "POST /api/products",
      saveCategories: "POST /api/categories"
    }
  });
});

// Endpoint para produtos com paginação
app.get("/api/products", async (req, res) => {
  try {
    const { page = 1, limit = 1000 } = req.query;
    const data = await getData();
    
    const products = data.products || [];
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedProducts = products.slice(startIndex, endIndex);
    
    res.json({ 
      products: paginatedProducts,
      pagination: {
        current: parseInt(page),
        limit: parseInt(limit),
        total: products.length,
        pages: Math.ceil(products.length / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erro ao buscar produtos:", error);
    res.status(500).json({ 
      error: "Erro interno do servidor",
      message: error.message,
      products: getDefaultProducts() // Fallback
    });
  }
});

// Endpoint para categorias
app.get("/api/categories", async (req, res) => {
  try {
    const data = await getData();
    const categories = data.categories && data.categories.length > 0 
      ? data.categories 
      : getDefaultCategories();
    
    res.json({ 
      categories: categories,
      total: categories.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erro ao buscar categorias:", error);
    res.status(500).json({ 
      error: "Erro interno do servidor",
      message: error.message,
      categories: getDefaultCategories() // Fallback
    });
  }
});

// Salvar produtos com validação e processamento por lotes
app.post("/api/products", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    const { products } = req.body;
    
    if (!products) {
      return res.status(400).json({ error: "Produtos são obrigatórios" });
    }
    
    console.log(`📊 Recebendo ${products.length} produtos para salvar...`);
    
    // Validar dados
    validateProductData(products);
    
    const data = await getData(false); // Não usar cache para operações de escrita
    
    // Normalizar produtos antes de salvar
    data.products = normalizeProducts(products);
    
    // Verificar se há produtos duplicados
    const ids = data.products.map(p => p.id);
    const uniqueIds = [...new Set(ids)];
    if (ids.length !== uniqueIds.length) {
      return res.status(400).json({ error: "Produtos com IDs duplicados encontrados" });
    }
    
    // Verificar tamanho total dos dados
    const dataSize = JSON.stringify(data).length;
    console.log(`📏 Tamanho total dos dados: ${Math.round(dataSize / 1024)}KB`);
    
    if (dataSize > 45 * 1024 * 1024) { // 45MB limite de segurança
      return res.status(413).json({ 
        error: "Dados muito grandes", 
        message: "Dados excedem 45MB. Reduza o número de produtos ou tamanho das imagens.",
        size: Math.round(dataSize / 1024 / 1024) + 'MB'
      });
    }
    
    await saveData(data);
    
    res.json({ 
      success: true, 
      saved: data.products.length,
      message: "Produtos salvos com sucesso",
      size: Math.round(dataSize / 1024) + 'KB'
    });
    
  } catch (error) {
    console.error("❌ Erro ao salvar produtos:", error);
    
    let statusCode = 500;
    let message = error.message;
    
    if (error.message.includes('413') || error.message.includes('too large') || error.message.includes('muito grandes')) {
      statusCode = 413;
      message = "Dados muito grandes. Reduza o tamanho das imagens ou número de produtos.";
    } else if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      statusCode = 408;
      message = "Timeout na operação. Tente novamente ou reduza a quantidade de dados.";
    } else if (error.message.includes('502') || error.message.includes('503')) {
      statusCode = 503;
      message = "Servidor temporariamente indisponível. Tente novamente em alguns minutos.";
    } else if (error.message.includes('deve ter') || error.message.includes('inválido')) {
      statusCode = 400;
      message = error.message;
    }
    
    res.status(statusCode).json({ 
      success: false, 
      error: "Erro ao salvar produtos",
      message: message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Salvar categorias
app.post("/api/categories", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    const { categories } = req.body;
    
    if (!Array.isArray(categories)) {
      return res.status(400).json({ error: "Categorias devem ser um array" });
    }
    
    const data = await getData(false); // Não usar cache
    
    // Normalizar categorias antes de salvar
    data.categories = normalizeCategories(categories);
    
    await saveData(data);
    
    res.json({ 
      success: true, 
      saved: data.categories.length,
      message: "Categorias salvas com sucesso" 
    });
    
  } catch (error) {
    console.error("❌ Erro ao salvar categorias:", error);
    res.status(500).json({ 
      success: false, 
      error: "Erro ao salvar categorias",
      message: error.message 
    });
  }
});

// Endpoint de autenticação seguro
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username e password são obrigatórios" });
    }
    
    const data = await getData(false); // Não usar cache para login
    
    if (!data.admin_credentials) {
      await setupInitialCredentials();
      return res.status(503).json({ error: "Credenciais não configuradas. Tente novamente em alguns segundos." });
    }
    
    // Verificar credenciais
    const storedUsername = simpleDecrypt(data.admin_credentials.username);
    const storedPassword = simpleDecrypt(data.admin_credentials.password);
    
    if (username === storedUsername && password === storedPassword) {
      res.json({ 
        success: true, 
        token: "authenticated_admin_token", 
        user: { 
          username: username,
          loginTime: new Date().toISOString()
        }
      });
      console.log('✅ Login bem-sucedido para:', username);
    } else {
      console.log('❌ Tentativa de login inválida para:', username);
      res.status(401).json({ error: "Credenciais inválidas" });
    }
  } catch (error) {
    console.error("❌ Erro no login:", error);
    res.status(500).json({ error: "Erro interno do servidor no processo de login" });
  }
});

// Endpoint para verificar autenticação
app.get("/api/auth/verify", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    
    if (token && checkAuth(token)) {
      res.json({ 
        valid: true, 
        user: { username: "admin" },
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({ valid: false });
    }
  } catch (error) {
    console.error("❌ Erro ao verificar autenticação:", error);
    res.status(500).json({ error: "Erro ao verificar autenticação" });
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
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias" });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Nova senha deve ter pelo menos 6 caracteres" });
    }
    
    const data = await getData(false);
    
    // Verificar senha atual
    const storedPassword = simpleDecrypt(data.admin_credentials.password);
    if (currentPassword !== storedPassword) {
      return res.status(401).json({ error: "Senha atual incorreta" });
    }
    
    // Atualizar senha
    data.admin_credentials.password = simpleEncrypt(newPassword);
    await saveData(data);
    
    console.log('🔑 Senha alterada com sucesso');
    res.json({ success: true, message: "Senha alterada com sucesso" });
    
  } catch (error) {
    console.error("❌ Erro ao alterar senha:", error);
    res.status(500).json({ error: "Erro interno do servidor ao alterar senha" });
  }
});

// Endpoint para limpar cache (apenas para debug)
app.post("/api/cache/clear", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    dataCache = null;
    cacheTimestamp = 0;
    
    console.log('🗑️ Cache limpo');
    res.json({ success: true, message: "Cache limpo com sucesso" });
    
  } catch (error) {
    console.error("❌ Erro ao limpar cache:", error);
    res.status(500).json({ error: "Erro ao limpar cache" });
  }
});

// Middleware para lidar com rotas não encontradas
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint não encontrado",
    message: `A rota ${req.method} ${req.path} não existe`,
    availableEndpoints: [
      "GET /",
      "GET /api/products",
      "GET /api/categories",
      "POST /api/auth/login",
      "GET /api/auth/verify",
      "POST /api/products",
      "POST /api/categories"
    ]
  });
});

// Middleware global de tratamento de erros
app.use((err, req, res, next) => {
  console.error('💥 Erro não capturado:', err);
  
  let statusCode = 500;
  let message = "Erro interno do servidor";
  
  // Tratar erros específicos
  if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = "Dados muito grandes. Reduza o tamanho das imagens.";
  } else if (err.name === 'TimeoutError') {
    statusCode = 408;
    message = "Timeout na requisição.";
  }
  
  res.status(statusCode).json({
    error: message,
    message: process.env.NODE_ENV === 'development' ? err.message : message,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido, encerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido, encerrando servidor...');
  process.exit(0);
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('🚀 Iniciando servidor...');
    console.log('🔧 NODE_ENV:', process.env.NODE_ENV || 'development');
    
    await setupInitialCredentials();
    
    // Pré-carregar cache
    console.log('📋 Pré-carregando cache...');
    await getData(false);
    
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
      console.log('📡 Endpoints disponíveis:');
      console.log(`   GET  http://localhost:${PORT}/`);
      console.log(`   GET  http://localhost:${PORT}/api/products`);
      console.log(`   GET  http://localhost:${PORT}/api/categories`);
      console.log(`   POST http://localhost:${PORT}/api/auth/login`);
      console.log('🎯 Servidor pronto para receber requisições!');
      console.log('💾 Limites: 100MB request, 180s timeout');
    });
    
  } catch (error) {
    console.error('💥 Erro fatal ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();