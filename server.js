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

// Cache
let cache = {
  products: null,
  productsTimestamp: 0
};

const CACHE_DURATION = 2 * 60 * 1000; // 2 minutos

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

// Normalizar produtos - VERSÃO CORRIGIDA
function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  
  return products.map((product, index) => {
    // Garantir que temos um ID
    const id = product.id || index + 1;
    
    // Garantir que colors seja um array válido
    let colors = [];
    
    if (product.colors && Array.isArray(product.colors)) {
      colors = product.colors.map(color => ({
        name: color.name || 'Padrão',
        image: color.image || 'https://via.placeholder.com/400x300',
        sizes: Array.isArray(color.sizes) ? color.sizes.map(size => ({
          name: String(size.name || 'M'),
          stock: parseInt(size.stock) || 0
        })) : [
          { name: 'P', stock: 0 },
          { name: 'M', stock: 0 },
          { name: 'G', stock: 0 },
          { name: 'GG', stock: 0 }
        ]
      }));
    } else {
      // Estrutura padrão se não houver cores
      colors = [{
        name: 'Padrão',
        image: product.image || 'https://via.placeholder.com/400x300',
        sizes: [
          { name: 'P', stock: 0 },
          { name: 'M', stock: 0 },
          { name: 'G', stock: 0 },
          { name: 'GG', stock: 0 }
        ]
      }];
    }
    
    return {
      id: id,
      title: product.title || 'Produto sem nome',
      category: product.category || 'camisa',
      price: parseFloat(product.price) || 0,
      description: product.description || 'Sem descrição',
      status: product.status || 'active',
      colors: colors
    };
  });
}

// Verificar autenticação
function checkAuth(token) {
  return token === "authenticated_admin_token";
}

// Limpar cache
function clearCache() {
  cache = {
    products: null,
    productsTimestamp: 0
  };
  console.log('🔄 Cache de produtos limpo');
}

// ENDPOINTS DA API

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

    const encryptedPassword = simpleEncrypt(password);
    
    if (encryptedPassword === credentials.encrypted_password || password === credentials.password) {
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

// Buscar produtos
app.get("/api/products", async (req, res) => {
  try {
    // Cache headers para velocidade
    res.set({
      'Cache-Control': 'public, max-age=120',
      'X-Content-Type-Options': 'nosniff'
    });

    // Verificar cache em memória
    const now = Date.now();
    if (cache.products && (now - cache.productsTimestamp) < CACHE_DURATION) {
      console.log('📦 Retornando produtos do cache');
      return res.json({ products: cache.products });
    }

    console.log('🔄 Buscando produtos do Supabase...');
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('id');

    if (error) {
      console.error("Erro Supabase produtos:", error.message);
      return res.json({ products: [] });
    }

    console.log(`✅ ${products?.length || 0} produtos encontrados`);
    const normalizedProducts = normalizeProducts(products || []);

    // Atualizar cache
    cache.products = normalizedProducts;
    cache.productsTimestamp = now;

    res.json({ products: normalizedProducts });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.json({ products: [] });
  }
});

// Buscar categorias
app.get("/api/categories", async (req, res) => {
  try {
    console.log('🔄 Buscando categorias do banco...');
    
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('name');

    if (error) {
      console.error("❌ Erro ao buscar categorias:", error.message);
      return res.json({ categories: [] });
    }

    let normalizedCategories = [];
    
    if (categories && categories.length > 0) {
      normalizedCategories = normalizeCategories(categories);
      console.log(`✅ ${normalizedCategories.length} categorias carregadas do banco`);
    } else {
      console.log('ℹ️ Nenhuma categoria encontrada no banco');
      normalizedCategories = [];
    }

    res.json({ categories: normalizedCategories });
  } catch (error) {
    console.error("❌ Erro ao buscar categorias:", error);
    res.json({ categories: [] });
  }
});

// Salvar produtos - VERSÃO CORRIGIDA
app.post("/api/products", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    const { products } = req.body;
    console.log(`💾 Recebendo ${products?.length || 0} produtos para salvar...`);
    
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: "Dados de produtos inválidos" });
    }

    // Normalizar os produtos antes de salvar
    const normalizedProducts = normalizeProducts(products);
    console.log(`✅ ${normalizedProducts.length} produtos normalizados`);

    // Deletar todos os produtos existentes
    console.log('🗑️  Limpando produtos antigos...');
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .neq('id', 0);

    if (deleteError && !deleteError.message.includes('No rows found')) {
      console.error('❌ Erro ao deletar produtos:', deleteError);
      // Continuar mesmo se não houver produtos para deletar
    }

    // Inserir os novos produtos (em batches se for muito grande)
    if (normalizedProducts.length > 0) {
      console.log(`📤 Inserindo ${normalizedProducts.length} produtos...`);
      
      // Preparar dados para inserção
      const productsToInsert = normalizedProducts.map(product => ({
        title: product.title,
        category: product.category,
        price: product.price,
        description: product.description,
        status: product.status,
        colors: product.colors
      }));

      const { data, error: insertError } = await supabase
        .from('products')
        .insert(productsToInsert)
        .select();

      if (insertError) {
        console.error('❌ Erro ao inserir produtos:', insertError);
        
        // Tentar inserir um por um para debug
        console.log('🔄 Tentando inserir produtos individualmente para debug...');
        const errors = [];
        const successful = [];
        
        for (const product of productsToInsert) {
          try {
            const { error: singleError } = await supabase
              .from('products')
              .insert(product);
            
            if (singleError) {
              errors.push({ product: product.title, error: singleError.message });
              console.error(`❌ Erro ao inserir ${product.title}:`, singleError.message);
            } else {
              successful.push(product.title);
            }
          } catch (singleError) {
            errors.push({ product: product.title, error: singleError.message });
          }
        }
        
        if (errors.length > 0) {
          throw new Error(`Falha ao inserir alguns produtos: ${JSON.stringify(errors)}`);
        }
        
        console.log(`✅ ${successful.length} produtos inseridos individualmente`);
      } else {
        console.log(`✅ ${data?.length || 0} produtos inseridos com sucesso`);
      }
    }

    // Limpar cache após alterações
    clearCache();

    console.log('🎉 Produtos salvos com sucesso!');
    res.json({ 
      success: true, 
      message: `${normalizedProducts.length} produtos salvos`,
      products: normalizedProducts 
    });
  } catch (error) {
    console.error("❌ Erro ao salvar produtos:", error);
    res.status(500).json({ 
      error: "Erro ao salvar produtos: " + error.message,
      details: error.message 
    });
  }
});

// Adicionar categoria individual
app.post("/api/categories/add", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    const { category } = req.body;
    
    if (!category || !category.id || !category.name) {
      return res.status(400).json({ error: "Dados da categoria inválidos" });
    }

    console.log(`➕ Adicionando categoria: ${category.name} (ID: ${category.id})`);

    const { data, error } = await supabase
      .from('categories')
      .upsert([{
        id: category.id,
        name: category.name,
        description: category.description || `Categoria de ${category.name}`
      }], {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Erro ao adicionar categoria:', error);
      throw error;
    }

    console.log('✅ Categoria adicionada com sucesso:', category.name);
    res.json({ 
      success: true, 
      message: `Categoria "${category.name}" adicionada`,
      category: category 
    });
  } catch (error) {
    console.error("❌ Erro ao adicionar categoria:", error);
    res.status(500).json({ error: "Erro ao adicionar categoria: " + error.message });
  }
});

// Excluir categoria individual
app.delete("/api/categories/:categoryId", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !checkAuth(authHeader.replace("Bearer ", ""))) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    
    const { categoryId } = req.params;
    console.log(`🗑️ Tentando excluir categoria: ${categoryId}`);
    
    // Primeiro verificar se a categoria existe
    const { data: category, error: fetchError } = await supabase
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .single();

    if (fetchError || !category) {
      console.log('❌ Categoria não encontrada:', categoryId);
      return res.status(404).json({ error: "Categoria não encontrada" });
    }

    console.log('✅ Categoria encontrada:', category.name);

    // Verificar se há produtos usando esta categoria
    const { data: productsInCategory, error: productsError } = await supabase
      .from('products')
      .select('id, title')
      .eq('category', categoryId);

    if (productsError) {
      console.error('❌ Erro ao verificar produtos:', productsError);
      throw productsError;
    }

    // Se há produtos, mover para a primeira categoria disponível
    if (productsInCategory && productsInCategory.length > 0) {
      console.log(`🔄 Movendo ${productsInCategory.length} produtos da categoria...`);
      
      // Buscar outra categoria para mover os produtos
      const { data: otherCategories } = await supabase
        .from('categories')
        .select('id')
        .neq('id', categoryId)
        .limit(1);

      if (otherCategories && otherCategories.length > 0) {
        const newCategoryId = otherCategories[0].id;
        const { error: updateError } = await supabase
          .from('products')
          .update({ category: newCategoryId })
          .eq('category', categoryId);

        if (updateError) {
          console.error('❌ Erro ao mover produtos:', updateError);
          throw updateError;
        }
        console.log(`✅ ${productsInCategory.length} produtos movidos para categoria: ${newCategoryId}`);
      } else {
        console.log('⚠️ Nenhuma outra categoria encontrada, produtos não movidos');
      }
    }

    // Agora deletar a categoria
    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (deleteError) {
      console.error('❌ Erro ao excluir categoria:', deleteError);
      throw deleteError;
    }

    console.log('✅ Categoria excluída com sucesso:', categoryId);
    res.json({ 
      success: true, 
      message: `Categoria "${category.name}" excluída` 
    });
  } catch (error) {
    console.error("❌ Erro ao excluir categoria:", error);
    res.status(500).json({ error: "Erro ao excluir categoria: " + error.message });
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
    console.log(`💾 Salvando ${categories?.length || 0} categorias...`);
    
    const normalizedCategories = normalizeCategories(categories);

    if (normalizedCategories.length === 0) {
      return res.status(400).json({ error: "Nenhuma categoria fornecida" });
    }

    // Deletar categorias que não estão na nova lista
    const categoryIds = normalizedCategories.map(cat => cat.id);
    
    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .not('id', 'in', `(${categoryIds.map(id => `'${id}'`).join(',')})`);

    if (deleteError && !deleteError.message.includes('No rows found')) {
      console.error('❌ Erro ao deletar categorias antigas:', deleteError);
      throw deleteError;
    }

    // Inserir/atualizar as categorias
    const categoriesToUpsert = normalizedCategories.map(category => ({
      id: category.id,
      name: category.name,
      description: category.description
    }));

    const { error: upsertError } = await supabase
      .from('categories')
      .upsert(categoriesToUpsert, { 
        onConflict: 'id'
      });

    if (upsertError) {
      console.error('❌ Erro ao salvar categorias:', upsertError);
      throw upsertError;
    }

    console.log('✅ Categorias salvas com sucesso!');
    res.json({ 
      success: true, 
      message: `${normalizedCategories.length} categorias salvas`,
      categories: normalizedCategories 
    });
  } catch (error) {
    console.error("❌ Erro ao salvar categorias:", error);
    res.status(500).json({ error: "Erro ao salvar categorias: " + error.message });
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
    message: "🚀 Backend Urban Z v2.0 está funcionando!", 
    status: "OK",
    version: "2.0.0",
    features: ["Produtos com cores", "Categorias", "Autenticação"]
  });
});

// Endpoint para limpar cache manualmente
app.post("/api/cache/clear", (req, res) => {
  clearCache();
  res.json({ success: true, message: "Cache de produtos limpo com sucesso" });
});

// Endpoint para ver estrutura da tabela (debug)
app.get("/api/debug/tables", async (req, res) => {
  try {
    // Verificar estrutura da tabela products
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .limit(1);
    
    // Verificar estrutura da tabela categories
    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('*')
      .limit(1);
    
    res.json({ 
      products_structure: productsError ? productsError.message : 'OK',
      categories_structure: categoriesError ? categoriesError.message : 'OK',
      sample_product: products && products.length > 0 ? {
        columns: Object.keys(products[0]),
        has_colors: 'colors' in products[0]
      } : null
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Inicializar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Servidor Urban Z v2.0 rodando em http://localhost:${PORT}`);
  console.log(`📦 Sistema de produtos e categorias pronto!`);
  console.log(`🔧 Para verificar a estrutura, acesse: http://localhost:${PORT}/api/debug/tables`);
});