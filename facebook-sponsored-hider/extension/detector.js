(() => {
  "use strict";

  const POST_SELECTOR = '[data-fb-sponsored-hider-data], [data-virtualized], [data-pagelet^="FeedUnit_"], [role="article"]';
  const BODY_SELECTOR = '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]';
  const EXCLUDED_SELECTOR = `${BODY_SELECTOR}, [role="dialog"], [data-testid*="comment"], [aria-label="Comment"]`;
  const normalize = (text) => String(text || "").normalize("NFKC")
    .replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "").toLowerCase();
  const LABELS = new Set(["Sponsored", "Ad", "ผู้สนับสนุน", "ได้รับการสนับสนุน", "โฆษณา"].map(normalize));
  const SIDEBAR_LABELS = new Set(["Sponsored", "ผู้สนับสนุน", "ได้รับการสนับสนุน", "โฆษณา"].map(normalize));

  function isVisible(element) {
    if (!element.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || style.display === "none" || style.visibility === "hidden" ||
          style.visibility === "collapse" || Number(style.opacity) === 0 || style.contentVisibility === "hidden") return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Sorting visible text fragments by geometry also handles CSS-reordered label letters.
  function visibleText(element) {
    const fragments = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || !isVisible(text.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      fragments.push({ text: text.textContent, top: rect.top, left: rect.left, index: fragments.length });
      if (fragments.length > 64) return "";
    }
    fragments.sort((a, b) => Math.abs(a.top - b.top) > 5 ? a.top - b.top : a.left - b.left || a.index - b.index);
    return fragments.map((fragment) => fragment.text).join("");
  }

  function isTopLevelPost(post) {
    return !!post.closest('[role="feed"], [role="main"]') &&
      !post.parentElement?.closest(POST_SELECTOR) && !post.closest(EXCLUDED_SELECTOR);
  }

  function topPost(element) {
    let post = element.closest(POST_SELECTOR);
    if (!post) return null;
    let parent;
    while ((parent = post.parentElement?.closest(POST_SELECTOR))) post = parent;
    return isTopLevelPost(post) ? post : null;
  }

  function belongsToHeader(label, post) {
    if (label.closest(`${EXCLUDED_SELECTOR}, h1, h2, h3, h4, [role="heading"]`)) return false;
    // A FeedUnit wrapper may contain one article. Ignore labels in further nested articles.
    const article = label.closest('[role="article"]');
    if (article && article !== post && article.parentElement?.closest('[role="article"]')) return false;
    const nested = label.closest('[data-virtualized], [data-pagelet^="FeedUnit_"]');
    if (nested && nested !== post &&
        !post.matches('[data-pagelet^="FeedUnit_"], [data-fb-sponsored-hider-data]')) return false;
    const rect = label.getBoundingClientRect();
    const postRect = post.getBoundingClientRect();
    if (rect.top < postRect.top - 2 || rect.bottom > postRect.top + 180) return false;
    const body = post.querySelector(BODY_SELECTOR);
    return !body || rect.bottom <= body.getBoundingClientRect().top + 2;
  }

  function isSponsored(post) {
    if (!isTopLevelPost(post)) return false;
    if (post.matches('[data-fb-sponsored-hider-data="ad"]') ||
        post.querySelector('[data-fb-sponsored-hider-data="ad"]')) return true;
    const candidates = post.querySelectorAll('a, [role="link"], [aria-label], [aria-labelledby], [title]');
    for (const label of candidates) {
      if (!belongsToHeader(label, post) || !isVisible(label)) continue;
      const referencedLabel = (label.getAttribute("aria-labelledby") || "").split(/\s+/)
        .filter(Boolean).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (LABELS.has(normalize(referencedLabel)) || LABELS.has(normalize(label.getAttribute("aria-label"))) ||
          LABELS.has(normalize(label.getAttribute("title"))) ||
          ((label.matches('a, [role="link"]')) && LABELS.has(normalize(visibleText(label))))) return true;
    }
    return false;
  }

  function hasOrdinaryMetadata(post) {
    if (post.matches('[data-fb-sponsored-hider-data="ordinary"]') ||
        post.querySelector('[data-fb-sponsored-hider-data="ordinary"]')) return true;
    // Positive ordinary metadata releases posts. An unresolved reference is not
    // proof that a post is ordinary, regardless of how long it has been loading.
    const englishTime = /^(?:(?:about )?(?:\d+|an?|one) (?:second|minute|hour|day|week|month|year)s? ago|just now|yesterday(?: at .+)?|\d+\s*[smhdwy]|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?: at .+)?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) \d{1,2}(?:,? \d{4})?(?: at .+)?|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)$/i;
    const thaiTime = /^(?:\d+\s*(?:วินาที|นาที|ชั่วโมง|วัน|สัปดาห์|เดือน|ปี)(?:ที่แล้ว)?|เมื่อวาน(?:นี้)?|เมื่อสักครู่)$/;
    for (const label of post.querySelectorAll('a, [role="link"], span[aria-label], span[aria-labelledby], time')) {
      if (!belongsToHeader(label, post) || !isVisible(label)) continue;
      const reference = (label.getAttribute("aria-labelledby") || "").split(/\s+/)
        .filter(Boolean).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      const text = (reference || label.getAttribute("aria-label") || visibleText(label))
        .replace(/[\u200b-\u200f\u2060-\u2069]/g, "").trim();
      if (englishTime.test(text) || thaiTime.test(text) || (label.matches('time[datetime]') && text)) return true;
    }
    return false;
  }

  function isNonPostUnit(post) {
    // Feed carousels are not individual posts and have no timestamp to await.
    if (!post.matches('[data-virtualized], [data-pagelet^="FeedUnit_"]') || post.querySelector(BODY_SELECTOR)) return false;
    if (post.querySelector('h4, [role="heading"][aria-level="4"]')) return false;
    return !!post.querySelector('[role="table"], [role="grid"]') &&
      Array.from(post.querySelectorAll('h3, [role="heading"][aria-level="3"]'))
        .some((heading) => /^(reels|stories|คลิปreels|เรื่องราว)$/i.test(normalize(heading.textContent)));
  }

  function isVirtualPlaceholder(post) {
    return post.matches('[data-virtualized="true"]') &&
      Array.from(post.children).every((child) => child.hidden || !child.textContent.trim());
  }

  function collapseTarget(post) {
    let slot = post;
    // Facebook puts reserved height/margins on neutral wrappers around units.
    // Never cross a sibling or a main/feed boundary to hide neighboring posts.
    for (let depth = 0; depth < 5; depth++) {
      const parent = slot.parentElement;
      if (!parent || parent.matches('body, main, aside, [role="main"], [role="feed"], [role="complementary"]')) break;
      const children = Array.from(parent.children).filter(child => !child.matches('script, style, template'));
      if (children.length !== 1 || children[0] !== slot ||
          Array.from(parent.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) break;
      slot = parent;
    }
    return slot;
  }

  function sponsoredSections() {
    const sections = new Set();
    for (const heading of document.querySelectorAll('h3, [role="heading"][aria-level="3"]')) {
      if (heading.closest(`${POST_SELECTOR}, ${EXCLUDED_SELECTOR}`) ||
          !SIDEBAR_LABELS.has(normalize(heading.textContent))) continue;
      // Stop before adjoining sections such as Birthdays or Contacts are included.
      let section = heading.parentElement;
      for (let depth = 0; section && depth < 16; depth++, section = section.parentElement) {
        if (section.matches('body, [role="main"], [role="complementary"]') ||
            section.querySelectorAll('h3, [role="heading"][aria-level="3"]').length > 1) break;
        const adLink = Array.from(section.querySelectorAll('a[href]')).some((link) => {
          try { return new URL(link.href).hostname === "l.facebook.com"; } catch { return false; }
        });
        if (adLink || section.querySelector('[aria-label*="sponsored content"]')) {
          if (isVisible(heading)) sections.add(section);
          break;
        }
      }
    }
    return sections;
  }

  globalThis.FbSponsoredDetector = Object.freeze({ POST_SELECTOR, isSponsored, hasOrdinaryMetadata, isNonPostUnit, isVirtualPlaceholder, collapseTarget, isTopLevelPost, topPost, sponsoredSections });
})();
