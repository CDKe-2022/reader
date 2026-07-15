// _worker.js 3.0
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 静态文件托管（2.0: 添加 no-cache 头避免 CDN 缓存旧版）
    if (!url.pathname.startsWith('/api/')) {
      // favicon.ico 重定向到 GitHub 上的图标
      if (url.pathname === '/favicon.ico') {
        return Response.redirect('https://raw.githubusercontent.com/CDKe-2022/reader/refs/heads/main/icon-192.png', 301);
      }
      const assetResponse = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(assetResponse.headers);
      // HTML 文件不缓存，确保用户始终拿到最新版
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
        newHeaders.set('Cache-Control', 'public, max-age=86400');
      }
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: newHeaders
      });
    }
    
    const path = url.pathname;
    const db = env.DB;
    const bucket = env.BUCKET;
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Book-Id',
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

      // [POST] 上传书籍文件 (v1.5: raw body streaming, 不用 FormData 避免 CPU 超限)
      if (path === '/api/books' && request.method === 'POST') {
        const bookId = request.headers.get('X-Book-Id');
        if (!bookId) {
          return new Response(JSON.stringify({ error: 'Missing X-Book-Id header' }), { 
            status: 400, 
            headers: { 'Content-Type': 'application/json', ...corsHeaders } 
          });
        }

        // 文件大小限制检查 (50MB，Cloudflare Free 计划上限 100MB)
        const contentLength = parseInt(request.headers.get('Content-Length') || '0');
        if (contentLength > 50 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'File too large (Max 50MB)' }), { 
            status: 413, 
            headers: { 'Content-Type': 'application/json', ...corsHeaders } 
          });
        }

        const r2_key = `txt/${bookId}.txt`;
        // 直接将请求体流式存入 R2，不做任何解析
        await bucket.put(r2_key, request.body);
        
        return Response.json({ success: true, id: bookId }, { headers: corsHeaders });
      }

      // [POST] 保存书籍元数据 (与文件上传分离，避免 FormData CPU 超限)
      if (path === '/api/books/meta' && request.method === 'POST') {
        const metadata = await request.json();
        const bookId = metadata.id || crypto.randomUUID();
        const r2_key = `txt/${bookId}.txt`;
        
        // 检查是否已存在记录（文件已上传但元数据未保存）
        const existing = await db.prepare('SELECT id FROM books WHERE id = ?').bind(bookId).first();
        
        if (existing) {
          // 更新已有记录
          await db.prepare(`
            UPDATE books SET
              name = ?, word_count = ?, total_chapters = ?, total_paragraphs = ?,
              ch_map = ?, current_chapter_title = ?, import_time = ?, sort_order = ?
            WHERE id = ?
          `).bind(
            metadata.name, metadata.wordCount, metadata.totalChapters, metadata.totalParagraphs,
            metadata.chMap, metadata.firstChapterTitle || '开始阅读',
            Date.now(), Date.now(), bookId
          ).run();
        } else {
          // 新增记录
          await db.prepare(`
            INSERT INTO books (
              id, name, r2_key, word_count, total_chapters, total_paragraphs, 
              ch_map, current_chapter_title, import_time, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            bookId, metadata.name, r2_key, 
            metadata.wordCount, metadata.totalChapters, metadata.totalParagraphs,
            metadata.chMap, metadata.firstChapterTitle || '开始阅读',
            Date.now(), Date.now()
          ).run();
        }
        
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
