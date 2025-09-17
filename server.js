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

// Função para criptografar
function simpleEncrypt(text) {
  return Buffer.from(text).toString('base64').split('').reverse().join('');
}

// Função para descriptografar
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

// Verificar autenticação
function checkAuth(token) {
  return token === "authenticated_admin_token";
}

// Migrar dados do JSON para o Supabase
async function migrateDataToSupabase() {
  try {
    console.log('Iniciando migração de dados para o Supabase...');
    
    // Dados padrão para migração inicial
    const defaultProducts = [
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
    
    const defaultCategories = [
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

    // Verificar se já existem produtos
    const { data: existingProducts, error: productsError } = await supabase
      .from('products')
      .select('id')
      .limit(1);

    if (productsError) throw productsError;

    // Se não existem produtos, inserir os padrões
    if (!existingProducts || existingProducts.length === 0) {
      console.log('Inserindo produtos padrão...');
      
      for (const product of defaultProducts) {
        const { error } = await supabase
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

        if (error) throw error;
      }

      console.log('Produtos inseridos com sucesso!');
    }

    // Verificar se já existem categorias
    const { data: existingCategories, error: categoriesError } = await supabase
      .from('categories')
      .select('id')
      .limit(1);

    if (categoriesError) throw categoriesError;

    // Se não existem categorias, inserir as padrões
    if (!existingCategories || existingCategories.length === 0) {
      console.log('Inserindo categorias padrão...');
      
      for (const category of defaultCategories) {
        const { error } = await supabase
          .from('categories')
          .insert([{
            id: category.id,
            name: category.name,
            description: category.description
          }]);

        if (error) throw error;
      }

      console.log('Categorias inseridas com sucesso!');
    }

    console.log('Migração concluída com sucesso!');
  } catch (error) {
    console.error('Erro durante a migração:', error);
  }
}

// Endpoints da API

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
      .neq('id', 0); // Delete all records

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
      .neq('id', ''); // Delete all records

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

// Autenticação
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const { data: credentials, error } = await supabase
      .from('admin_credentials')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !credentials) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Verificar credenciais (simplificado - em produção usar hash)
    if (password === credentials.password) {
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

// Endpoint para migração manual
app.post("/api/migrate", async (req, res) => {
  try {
    await migrateDataToSupabase();
    res.json({ success: true, message: "Migração concluída com sucesso!" });
  } catch (error) {
    console.error("Erro na migração:", error);
    res.status(500).json({ error: "Erro durante a migração" });
  }
});

// Inicializar servidor e migração
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log('Iniciando migração de dados...');
  await migrateDataToSupabase();
});