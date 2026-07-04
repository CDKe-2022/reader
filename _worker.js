// _worker.js (放在项目根目录)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 如果不是 API 请求，直接交给 Pages 托管静态文件 (你的 index.html)
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    
    // 2. 处理 API 请求
    const path = url.pathname;
    const db = env.DB;         // 对应 D1
    const bucket = env.BUCKET; // 对应 R2
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // [GET] 获取书架列表
      if (path === '/api/books' && request.method === 'GET') {
        const { results } = await db.prepare(`
          SELECT id, name, r2_key, word_count, total_chapters, progress_gidx, scroll_top, import_time, ch_map 
          FROM books ORDER BY import_time DESC
        `).all();
        return Response.json(results, { headers: corsHeaders });
      }

      // [POST] 导入新书 (文本存 R2，元数据存 D1)
      if (path === '/api/books' && request.method === 'POST') {
        const data = await request.json();
        
        // 安全防御：限制文件大小 (10MB)，防止 Worker 内存溢出和 R2 费用失控
        if (data.content && data.content.length > 10 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'File content too large (Max 10MB)' }), { 
            status: 413, 
            headers: { 'Content-Type': 'application/json', ...corsHeaders } 
          });
        }

        // 1. 将原始 TXT 存入 R2
        await bucket.put(data.r2_key, data.content);
        
        // 2. 将元数据存入 D1
        await db.prepare(`
          INSERT INTO books (id, name, r2_key, word_count, total_chapters, ch_map, import_time) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(data.id, data.name, data.r2_key, data.wordCount, data.totalChapters, data.chMap, Date.now()).run();
        
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // [GET] 获取书籍原始 TXT 内容 (从 R2 读取)
      // 修复：将 (.+) 改为 ([^\/]+) 防止 ID 中包含斜杠导致路由错乱
      const contentMatch = path.match(/^\/api\/books\/([^\/]+)\/content$/);
      if (contentMatch && request.method === 'GET') {
        const id = decodeURIComponent(contentMatch[1]);
        const book = await db.prepare('SELECT r2_key FROM books WHERE id = ?').bind(id).first();
        if (!book) return new Response('Not found', { status: 404 });
        
        const obj = await bucket.get(book.r2_key);
        if (!obj) return new Response('File not found in R2', { status: 404 });
        
        return new Response(obj.body, { 
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders } 
        });
      }

      // [PUT] 更新阅读进度
      // 修复：将 (.+) 改为 ([^\/]+)
      const progressMatch = path.match(/^\/api\/books\/([^\/]+)\/progress$/);
      if (progressMatch && request.method === 'PUT') {
        const id = decodeURIComponent(progressMatch[1]);
        const data = await request.json();
        await db.prepare(`UPDATE books SET progress_gidx = ?, scroll_top = ? WHERE id = ?`)
          .bind(data.progressGidx, data.scrollTop, id).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // [GET] 获取单本书元数据 / [DELETE] 删除书籍
      const bookMatch = path.match(/^\/api\/books\/([^\/]+)$/);
      if (bookMatch) {
        const id = decodeURIComponent(bookMatch[1]);
        
        if (request.method === 'GET') {
          const book = await db.prepare(`
            SELECT id, name, r2_key, word_count, total_chapters, progress_gidx, scroll_top, import_time, ch_map 
            FROM books WHERE id = ?
          `).bind(id).first();
          if (!book) return new Response('Not found', { status: 404, headers: corsHeaders });
          return Response.json(book, { headers: corsHeaders });
        }
        
        if (request.method === 'DELETE') {
          const book = await db.prepare('SELECT r2_key FROM books WHERE id = ?').bind(id).first();
          
          // 修复：如果书不存在，返回 404 而不是 200
          if (!book) {
            return new Response(JSON.stringify({ error: 'Book not found' }), { 
              status: 404, 
              headers: { 'Content-Type': 'application/json', ...corsHeaders } 
            });
          }
          
          await bucket.delete(book.r2_key); // 删除 R2 中的文件
          await db.prepare('DELETE FROM books WHERE id = ?').bind(id).run(); // 删除 D1 记录
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      return new Response('API Not Found', { status: 404, headers: corsHeaders });
      
    } catch (err) {
      // 修复：补充 Content-Type 响应头
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }
  }
};
