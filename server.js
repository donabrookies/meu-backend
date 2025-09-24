import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Função para criptografar (COMPATÍVEL com o frontend)
function simpleEncrypt(text) {
  return Buffer.from(text).toString('base64').split('').reverse().join('');
}

// Função para descriptografar (COMPATÍVEL com o frontend)
function simpleDecrypt(encrypted) {
  return Buffer.from(encrypted.split('').reverse().join(''), 'base64').toString('utf8');
}

// Normalizar categorias
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

// Normalizar produtos
function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  
  return products.map(product => {
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

// Verificar autenticação
function checkAuth(token) {
  return token === "authenticated_admin_token";
}

// Migrar dados para o Supabase
async function migrateDataToSupabase() {
  try {
    console.log('Iniciando migração de dados para o Supabase...');
    
    // Configurar credenciais admin com criptografia
    const adminPassword = 'admin123';
    const encryptedPassword = simpleEncrypt(adminPassword);
    
    const { data: existingCreds, error: credsError } = await supabase
      .from('admin_credentials')
      .select('id')
      .limit(1);

    if (!existingCreds || existingCreds.length === 0) {
      const { error } = await supabase
        .from('admin_credentials')
        .insert([{
          username: 'admin',
          password: adminPassword,
          encrypted_password: encryptedPassword
        }]);

      if (error) throw error;
      console.log('Credenciais admin configuradas!');
    }

    console.log('Migração concluída com sucesso!');
  } catch (error) {
    console.error('Erro durante a migração:', error);
  }
}

// ENDPOINTS DA API

// Autenticação (CORRIGIDO)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('Tentativa de login:', username);

    const { data: credentials, error } = await supabase
      .from('admin_credentials')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !credentials) {
      console.log('Usuário não encontrado');
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Verificar com senha criptografada
    const encryptedPassword = simpleEncrypt(password);
    
    if (encryptedPassword === credentials.encrypted_password) {
      res.json({ 
        success: true, 
        token: "authenticated_admin_token", 
        user: { username: username } 
      });
    } else {
      // Fallback para senha em texto puro
      if (password === credentials.password) {
        res.json({ 
          success: true, 
          token: "authenticated_admin_token", 
          user: { username: username } 
        });
      } else {
        console.log('Senha incorreta');
        res.status(401).json({ error: "Credenciais inválidas" });
      }
    }
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Erro no processo de login" });
  }
});

// Buscar produtos
app.get("/api/products", async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('id');

    if (error) throw error;

    const normalizedProducts = normalizeProducts(products || []);
    res.json({ products: normalizedProducts });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

// Buscar categorias
app.get("/api/categories", async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('id');

    if (error) throw error;

    let normalizedCategories = normalizeCategories(categories || []);
    
    if (normalizedCategories.length === 0) {
      normalizedCategories = [
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
    
    res.json({ categories: normalizedCategories });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

// Salvar produtos
app.post("/api/products", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    const { products } = req.body;
    const normalizedProducts = normalizeProducts(products);

    // Deletar todos os produtos existentes
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .neq('id', 0);

    if (deleteError) throw deleteError;

    // Inserir os novos produtos
    for (const product of normalizedProducts) {
      const { error: insertError } = await supabase
        .from('products')
        .insert([{
          id: product.id,
          title: product.title,
          category: product.category,
          price: product.price,
          description: product.description,
          status: product.status,
          colors: product.colors
        }]);

      if (insertError) throw insertError;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar produtos:", error);
    res.status(500).json({ error: "Erro ao salvar produtos" });
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
    const normalizedCategories = normalizeCategories(categories);

    // Deletar todas as categorias existentes
    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .neq('id', '');

    if (deleteError) throw deleteError;

    // Inserir as novas categorias
    for (const category of normalizedCategories) {
      const { error: insertError } = await supabase
        .from('categories')
        .insert([{
          id: category.id,
          name: category.name,
          description: category.description
        }]);

      if (insertError) throw insertError;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar categorias:", error);
    res.status(500).json({ error: "Erro ao salvar categorias" });
  }
});

// Verificar autenticação
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

// Health check
app.get("/", (req, res) => {
  res.json({ 
    message: "Backend Urban Z com Supabase está funcionando!", 
    status: "OK",
    database: "Supabase",
    endpoints: {
      products: "GET /api/products",
      categories: "GET /api/categories",
      login: "POST /api/auth/login"
    }
  });
});

// Inicializar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  await migrateDataToSupabase();
});