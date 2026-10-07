(() => {
  'use strict';

  const definitions = Object.freeze([
    { key: 'hideSports', group: 'Topics', label: 'Sports' },
    { key: 'hideAI', group: 'Topics', label: 'AI & programming' },
    { key: 'hideBlockchain', group: 'Topics', label: 'Blockchain & crypto' },
    { key: 'hideNews', group: 'Topics', label: 'News & public affairs' },
    { key: 'hideEntertainment', group: 'Topics', label: 'Entertainment & music' },
    { key: 'hideVideos', group: 'Formats', label: 'Videos' },
    { key: 'hidePhotos', group: 'Formats', label: 'Photos' },
    { key: 'hideTextOnly', group: 'Formats', label: 'Text-only posts' },
    { key: 'hideReels', group: 'Formats', label: 'Reels' },
    { key: 'hideGroups', group: 'Sources', label: 'Group posts' },
    { key: 'hideSuggested', group: 'Sources', label: 'Suggested for you' }
  ].map(Object.freeze));
  const defaults = Object.freeze(Object.fromEntries(definitions.map(({ key }) => [key, false])));
  const patterns = {
    hideSports: /\b(sports?|tennis|golf|football|soccer|basketball|badminton|volleyball|djokovic|racket|racquet|jeeno)\b|กีฬา|เทนนิส|กอล์ฟ|ฟุตบอล|แบดมินตัน|วอลเลย์บอล|จีโน่/iu,
    hideAI: /\b(ai|artificial intelligence|programming|coding|vibe coding|postgres(?:ql)?|javascript|typescript|python|software development|vector search|llm|chatgpt|claude|hermes agent)\b|ปัญญาประดิษฐ์|เขียนโปรแกรม|เขียนโค้ด|เอไอ|ไวบ์โค้ด/iu,
    hideBlockchain: /\b(blockchain|crypto(?:currency)?|bitcoin|ethereum|web3|defi|stablecoin|tokenized|agent wallets?)\b|บล็อกเชน|คริปโต|บิตคอยน์|อีเธอเรียม/iu,
    hideNews: /\b(breaking news|public affairs|elections?|parliament|politics|political|flood(?:ing|s)?|government policy)\b|ข่าวด่วน|การเมือง|เลือกตั้ง|รัฐสภา|น้ำท่วม|ถกไม่เถียง|โหนกระแส/iu,
    hideEntertainment: /\b(music|musician|singer|concert|comedy|comedian|funny|humou?r|entertainment|movie|cinema)\b|เพลง|ดนตรี|นักร้อง|คอนเสิร์ต|ตลก|บันเทิง|ภาพยนตร์/iu
  };
  const excluded = 'script, style, template, button, [role="button"], [role="dialog"], [data-testid*="comment"], [aria-label^="Comment"], [aria-label^="ความคิดเห็น"], [hidden], [aria-hidden="true"]';

  function rendered(element, root) {
    if (element.closest(excluded)) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
      if (node === root) break;
    }
    return true;
  }

  function textOf(element, root) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement && rendered(node.parentElement, root)) parts.push(node.textContent);
    }
    // NFKC expands Thai sara am; recompose it to match ordinary Thai labels.
    return parts.join(' ').normalize('NFKC').replace(/\u0e4d\u0e32/g, '\u0e33').replace(/[\u200b-\u200f\ufeff]/g, '');
  }

  function classify(post) {
    const matches = [];
    const bodies = Array.from(post.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]'));
    const headings = Array.from(post.querySelectorAll('h2, h3, h4, [role="heading"]'));
    const text = (bodies.length ? [...headings, ...bodies] : [post]).map(node => textOf(node, post)).join(' ');
    for (const [key, pattern] of Object.entries(patterns)) if (pattern.test(text)) matches.push(key);

    const bodyTop = bodies.find(node => rendered(node, post))?.getBoundingClientRect().top ?? Infinity;
    const isHeader = node => rendered(node, post) && !node.closest('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]') && node.getBoundingClientRect().top < bodyTop;
    const links = Array.from(post.querySelectorAll('a[href]')).filter(node => rendered(node, post));
    const reels = headings.some(node => /^(reels|คลิป reels|รีลส์)$/iu.test(textOf(node, post).trim())) || links.some(node => /\/reel\//i.test(node.getAttribute('href')));
    const video = reels || Array.from(post.querySelectorAll('video, [role="video"], [data-testid="video-player"], [aria-label]')).some(node => rendered(node, post) && (node.matches('video, [role="video"], [data-testid="video-player"]') || /^(video player|เครื่องเล่นวิดีโอ)/iu.test(node.getAttribute('aria-label') || ''))) || links.some(node => /\/(?:videos|watch)\//i.test(node.getAttribute('href')));
    const photo = Array.from(post.querySelectorAll('img')).some(node => {
      if (!rendered(node, post) || node.closest('h2, h3, h4, [role="heading"]')) return false;
      const alt = node.getAttribute('alt') || '';
      if (/profile picture|avatar|reaction|รูปโปรไฟล์|รูปประจำตัว/iu.test(alt)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 100 && rect.height >= 80;
    });
    if (reels) matches.push('hideReels');
    if (video) matches.push('hideVideos');
    if (photo && !video) matches.push('hidePhotos');
    if (!video && !photo && bodies.some(node => textOf(node, post).trim())) matches.push('hideTextOnly');
    if (links.some(node => isHeader(node) && /\/(?:groups)\/[^/?#]+/i.test(node.getAttribute('href')))) matches.push('hideGroups');
    if (Array.from(post.querySelectorAll('span, h2, h3, h4, [role="heading"]')).some(node => isHeader(node) && /^(suggested for you|แนะนำสำหรับคุณ|แนะนำให้คุณ)$/iu.test(textOf(node, post).trim()))) matches.push('hideSuggested');
    return matches;
  }

  globalThis.FbContentFilters = Object.freeze({ definitions, defaults, classify, active: settings => definitions.some(({ key }) => settings[key] === true) });
})();
