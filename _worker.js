// _worker.js (v1.3 - Stable Backend)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const db = env.DB;
    const bucket = env.BUCKET;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      // [GET] List Books
      if (url.pathname === '/api/books' && request.method === 'GET') {
        const { results } = await db.prepare(`
          SELECT id, name, word_count, total_chapters, total_paragraphs, 
                 progress_gidx, current_chapter_title, import_time, sort_order
          FROM books ORDER BY sort_order DESC, import_time DESC
        `).all();
        return Response.json(results, { headers: corsHeaders });
      }

      // [POST] Create Book (FormData)
      if (url.pathname === '/api/books' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        const metadataStr = formData.get('metadata');

        if (!file || !metadataStr) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        if (file.size > 15 * 1024 * 1024) return new Response(JSON.stringify({ error: 'File too large (15MB Max)' }), { status: 413, headers: corsHeaders });

        const metadata = JSON.parse(metadataStr);
        const bookId = metadata.id || crypto.randomUUID();
        const r2_key = `txt/${bookId}.txt`;

        await bucket.put(r2_key, file);
        
        await db.prepare(`
          INSERT INTO books (id, name, r2_key, word_count, total_chapters, total_paragraphs, ch_map, current_chapter_title, import_time, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(bookId, metadata.name, r2_key, metadata.wordCount, metadata.totalChapters, metadata.totalParagraphs, metadata.chMap, metadata.firstChapterTitle, Date.now(), Date.now()).run();
        
        return Response.json({ success: true, id: bookId }, { headers: corsHeaders });
      }

      // [GET] Book Detail
      const bookMatch = url.pathname.match(/^\/api\/books\/([^\/]+)$/);
      if (bookMatch && request.method === 'GET') {
        const id = decodeURIComponent(bookMatch[1]);
        const book = await db.prepare(`SELECT id, name, r2_key, word_count, total_chapters, total_paragraphs, progress_gidx, ch_map, current_chapter_title FROM books WHERE id = ?`).bind(id).first();
        if (!book) return new Response('Not found', { status: 404, headers: corsHeaders });
        return Response.json(book, { headers: corsHeaders });
      }
      
      // [DELETE] Book
      if (bookMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(bookMatch[1]);
        const book = await db.prepare('SELECT r2_key FROM books WHERE id = ?').bind(id).first();
        if (book) { await bucket.delete(book.r2_key); await db.prepare('DELETE FROM books WHERE id = ?').bind(id).run(); }
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // [GET] Book Content (Raw TXT)
      const contentMatch = url.pathname.match(/^\/api\/books\/([^\/]+)\/content$/);
      if (contentMatch && request.method === 'GET') {
        const id = decodeURIComponent(contentMatch[1]);
        const book = await db.prepare('SELECT r2_key FROM books WHERE id = ?').bind(id).first();
        if (!book) return new Response('Not found', { status: 404, headers: corsHeaders });
        const obj = await bucket.get(book.r2_key);
        return obj ? new Response(obj.body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders } }) : new Response('Not Found', { status: 404, headers: corsHeaders });
      }

      // [PUT] Update Progress
      const progressMatch = url.pathname.match(/^\/api\/books\/([^\/]+)\/progress$/);
      if (progressMatch && request.method === 'PUT') {
        const id = decodeURIComponent(progressMatch[1]);
        const data = await request.json();
        await db.prepare(`UPDATE books SET progress_gidx = ?, current_chapter_title = ? WHERE id = ?`).bind(data.progressGidx, data.currentChapterTitle, id).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // [PUT] Pin Book
      const pinMatch = url.pathname.match(/^\/api\/books\/([^\/]+)\/pin$/);
      if (pinMatch && request.method === 'PUT') {
        const id = decodeURIComponent(pinMatch[1]);
        await db.prepare(`UPDATE books SET sort_order = ? WHERE id = ?`).bind(Date.now(), id).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      return new Response('API Not Found', { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
  }
};
