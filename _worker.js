// _worker.js (v1.2)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 静态文件托管
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    
    const path = url.pathname;
    const db = env.DB;
    const bucket = env.BUCKET;
    
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
          SELECT id, name, word_count, total_chapters, total_paragraphs, 
                 progress_gidx, current_chapter_title, import_time, sort_order
          FROM books 
          ORDER BY sort_order DESC, import_time DESC
        `).all();
        return Response.json(results, { headers: corsHeaders });
      }

      // [POST] 导入新书 (v1.2 修改：接收 FormData)
      if (path === '/api/books' && request.method === 'POST') {
        const formData = await request.formData();
        
        const file = formData.get('file');
        const metadataStr = formData.get('metadata');
        
        if (!file || !metadataStr) {
          return new Response(JSON.stringify({ error: 'Missing file or metadata' }), { 
            status: 400, 
            headers: { 'Content-Type': 'application/json', ...corsHeaders } 
          });
        }

        // 文件大小限制检查 (例如 10MB)
        if (file.size > 10 * 1024 * 1024) {
             return new Response(JSON.stringify({ error: 'File too large (Max 10MB)' }), { 
                status: 413, 
                headers: { 'Content-Type': 'application/json', ...corsHeaders } 
            });
        }

        const metadata = JSON.parse(metadataStr);
        // 前端会生成 ID，这里直接使用
        const bookId = metadata.id || crypto.randomUUID(); 
        const r2_key = `txt/${bookId}.txt`;
        
        // 1. 直接将文件流存入 R2 (Worker 不解析，只搬运)
        await bucket.put(r2_key, file);
        
        // 2. 将元数据存入 D1
        await db.prepare(`
          INSERT INTO books (
            id, name, r2_key, word_count, total_chapters, total_paragraphs, 
            ch_map, current_chapter_title, import_time, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            bookId, 
            metadata.name, 
            r2_key, 
            metadata.wordCount, 
            metadata.totalChapters, 
            metadata.totalParagraphs,
            metadata.chMap,
            metadata.firstChapterTitle || '开始阅读',
            Date.now(), // import_time
            Date.now()  // sort_order (默认置顶时间)
        ).run();
        
        return Response.json({ success: true, id: bookId }, { headers: corsHeaders });
      }

      // [GET] 获取书籍详情
      const bookMatch = path.match(/^\/api\/books\/([^\/]+)$/);
      if (bookMatch && request.method === 'GET') {
        const id = decodeURIComponent(bookMatch[1]);
        const book = await db.prepare(`
            SELECT id, name, r2_key, word_count, total_chapters, total_paragraphs, 
                   progress_gidx, ch_map, current_chapter_title
            FROM books WHERE id = ?
          `).bind(id).first();
        if (!book) return new Response('Not found', { status: 404, headers: corsHeaders });
        return Response.json(book, { headers: corsHeaders });
      }
      
      // [DELETE] 删除书籍
      if (bookMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(bookMatch[1]);
        const book = await db.prepare('SELECT r2_key FROM books WHERE id = ?').bind(id).first();
        if (!book) return new Response(JSON.stringify({ error: 'Book not found' }), { status: 404, headers: corsHeaders });
        
        await bucket.delete(book.r2_key);
        await db.prepare('DELETE FROM books WHERE id = ?').bind(id).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // [GET] 获取书籍原始 TXT 内容
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
      const progressMatch = path.match(/^\/api\/books\/([^\/]+)\/progress$/);
      if (progressMatch && request.method === 'PUT') {
        const id = decodeURIComponent(progressMatch[1]);
        const data = await request.json();
        
        await db.prepare(`
          UPDATE books 
          SET progress_gidx = ?, current_chapter_title = ? 
          WHERE id = ?
        `).bind(data.progressGidx, data.currentChapterTitle, id).run();
        
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // [PUT] 置顶书籍
      const pinMatch = path.match(/^\/api\/books\/([^\/]+)\/pin$/);
      if (pinMatch && request.method === 'PUT') {
        const id = decodeURIComponent(pinMatch[1]);
        const now = Date.now();
        await db.prepare(`UPDATE books SET sort_order = ? WHERE id = ?`).bind(now, id).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      return new Response('API Not Found', { status: 404, headers: corsHeaders });
      
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }
  }
};
