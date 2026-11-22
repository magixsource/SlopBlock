const FILTER_KEY = 'localFilterList';
// 首页/搜索页的卡片 + 视频播放页侧栏的推荐卡片
const CARD_SELECTORS = '.bili-video-card, .video-page-card-small';
const HIDDEN_ATTR = 'data-slopblock-hidden';
const PLACEHOLDER_ATTR = 'data-slopblock-placeholder';

// 卡片 -> 占位提示，以及当前被我们隐藏的卡片
const placeholderByCard = new WeakMap();
const hiddenCards = new Set();

function parseFilterList(raw) {
  return String(raw || '')
    .split(';')
    .map(function (item) { return item.trim(); })
    .filter(function (item) { return item.length > 0; });
}

function ownerIdFromHref(href) {
  const match = String(href || '').match(/space\.bilibili\.com\/(\d+)/);
  return match ? match[1] : '';
}

const NAME_CACHE_KEY = 'ownerNameCache';
const NAME_API = 'https://api.vc.bilibili.com/account/v1/user/cards?uids=';

function readNameCache(callback) {
  try {
    chrome.storage.local.get(NAME_CACHE_KEY, function (result) {
      callback(result[NAME_CACHE_KEY] || {});
    });
  } catch (error) {
    contextInvalid = true;
    callback({});
  }
}

// 分批查询 UP 主昵称（每批最多 20 个），结果缓存到 storage
function fetchOwnerNames(ids, callback) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));

  const names = {};
  let index = 0;

  function nextChunk() {
    if (index >= chunks.length) {
      callback(names);
      return;
    }
    const chunk = chunks[index++];
    fetch(NAME_API + chunk.join(','), { credentials: 'include' })
      .then(function (response) { return response.json(); })
      .then(function (json) {
        if (json && json.code === 0 && Array.isArray(json.data)) {
          json.data.forEach(function (user) {
            if (user && user.mid && user.name) names[String(user.mid)] = String(user.name);
          });
        }
      })
      .catch(function () {})
      .then(function () {
        setTimeout(nextChunk, 300);
      });
  }

  nextChunk();
}

function createPlaceholder(card, ownerId) {
  const box = document.createElement('div');
  box.setAttribute(PLACEHOLDER_ATTR, '1');
  box.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:10',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:6px', 'padding:12px', 'box-sizing:border-box',
    'border-radius:6px', 'background:#f1f2f3', 'color:#9499a0',
    'font-size:13px', 'line-height:1.5', 'text-align:center', 'user-select:none'
  ].join(';');

  // 侧栏推荐卡片很矮，用紧凑版
  const compact = card.getBoundingClientRect().height < 140;
  if (compact) {
    box.style.gap = '2px';
    box.style.fontSize = '12px';
    box.style.padding = '6px';
  }

  const title = document.createElement('div');
  title.textContent = '已屏蔽该UP主的视频';
  title.style.cssText = 'color:#9499a0;font-weight:400';

  const sub = document.createElement('div');
  sub.textContent = 'UP主 ID ' + ownerId;
  sub.style.cssText = 'color:#c0c4cc;font-size:12px';

  // 遮罩自身也要吃掉点击，避免点空白处跳到视频页
  box.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
  });

  box.appendChild(title);
  box.appendChild(sub);

  card.appendChild(box);
  placeholderByCard.set(card, box);
}

function hideCard(card, ownerId) {
  if (!card.hasAttribute(HIDDEN_ATTR)) {
    card.setAttribute(HIDDEN_ATTR, '1');
    card.dataset.slopblockPosition = card.style.position || '';
    card.dataset.slopblockDisplay = card.style.display || '';
  }
  // 旧版本内容脚本可能已经把卡片设成 display:none，遮罩会被一起藏掉，
  // 看起来就是一个空白洞，所以这里强制恢复可见并把定位改成 relative。
  if (card.style.display === 'none') {
    if (!card.dataset.slopblockDisplay) card.dataset.slopblockDisplay = '';
    card.style.display = '';
  }
  if (card.style.position !== 'relative') card.style.position = 'relative';
  hiddenCards.add(card);

  const placeholder = placeholderByCard.get(card);
  if (!placeholder || !placeholder.isConnected) {
    createPlaceholder(card, ownerId);
  }
}

function showCard(card) {
  const placeholder = placeholderByCard.get(card);
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  placeholderByCard.delete(card);
  card.style.position = card.dataset.slopblockPosition || '';
  if (card.dataset.slopblockDisplay !== undefined) card.style.display = card.dataset.slopblockDisplay;
  delete card.dataset.slopblockPosition;
  delete card.dataset.slopblockDisplay;
  card.removeAttribute(HIDDEN_ATTR);
}

// 用占位卡片替换被屏蔽的卡片；列表变化时同步撤销
function applyFilterList(blockList) {
  const blocked = parseFilterList(blockList);
  const blockedSet = new Set(blocked);
  const blockedCards = new Set();

  // 清掉上一版内容脚本残留的隐藏状态（reload 扩展但没刷新页面时会出现
  // 只有 display:none、没有遮罩的空白卡片）
  document.querySelectorAll('[' + HIDDEN_ATTR + ']').forEach(function (card) {
    if (!hiddenCards.has(card)) showCard(card);
  });

  document.querySelectorAll('a[href*="space.bilibili.com/"]').forEach(function (link) {
    if (link.classList.contains('disable-hover')) return;
    const ownerId = ownerIdFromHref(link.getAttribute('href'));
    if (!ownerId || !blockedSet.has(ownerId)) return;

    const card = link.closest(CARD_SELECTORS);
    if (!card) return;

    blockedCards.add(card);
    hideCard(card, ownerId);
  });

  // 不再需要隐藏的卡片（取消了屏蔽，或卡片已被页面移除）
  hiddenCards.forEach(function (card) {
    if (!blockedCards.has(card) || !card.isConnected) {
      if (card.isConnected) {
        showCard(card);
      } else {
        const placeholder = placeholderByCard.get(card);
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        placeholderByCard.delete(card);
      }
      hiddenCards.delete(card);
    }
  });
}

function applyStoredFilter() {
  if (contextInvalid) return;
  try {
    chrome.storage.local.get(FILTER_KEY, function (result) {
      applyFilterList(result[FILTER_KEY]);
    });
  } catch (error) {
    // 扩展被 reload/更新后，旧页面里的内容脚本会失效，安静退出即可
    contextInvalid = true;
  }
}

// 页面是 SPA，卡片会在路由切换和滚动加载时不断插入，所以持续观察 DOM
let applyTimer = null;
let contextInvalid = false;
function scheduleApply() {
  if (applyTimer) return;
  applyTimer = setTimeout(function () {
    applyTimer = null;
    applyStoredFilter();
  }, 250);
}

function startObserver() {
  const target = document.body || document.documentElement;
  if (!target) return;
  // 只观察节点变化：隐藏卡片只改 style，不会反过来触发自己
  new MutationObserver(scheduleApply).observe(target, { childList: true, subtree: true });

  // 无限滚动懒加载时兜底再应用一次（已节流到 250ms）
  window.addEventListener('scroll', scheduleApply, { passive: true });
  document.addEventListener('visibilitychange', scheduleApply);
}

// 列表变化（弹窗、右键菜单、任何地方写入）都立即生效，无需刷新页面
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === 'local' && changes[FILTER_KEY]) {
    applyFilterList(changes[FILTER_KEY].newValue);
  }
});

// 兼容旧消息名：filterVideos 与 updateFilterList 都执行同一套过滤
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request) return false;
  if (request.action === 'applyStoredFilter' || request.action === 'updateFilterList' || request.action === 'filterVideos') {
    applyStoredFilter();
  } else if (request.action === 'getFilterList') {
    chrome.storage.local.get(FILTER_KEY, function (result) {
      sendResponse({ localFilterList: result[FILTER_KEY] });
    });
    return true;
  } else if (request.action === 'resolveOwnerNames') {
    const ids = Array.isArray(request.ids) ? request.ids.map(String) : [];
    readNameCache(function (cache) {
      const names = {};
      const missing = [];
      ids.forEach(function (id) {
        if (cache[id]) names[id] = cache[id];
        else if (missing.indexOf(id) === -1) missing.push(id);
      });
      if (missing.length === 0) {
        sendResponse({ names: names });
        return;
      }
      fetchOwnerNames(missing, function (fetched) {
        Object.keys(fetched).forEach(function (id) {
          names[id] = fetched[id];
          cache[id] = fetched[id];
        });
        if (Object.keys(fetched).length > 0) {
          try {
            chrome.storage.local.set({ [NAME_CACHE_KEY]: cache });
          } catch (error) {
            contextInvalid = true;
          }
        }
        sendResponse({ names: names });
      });
    });
    return true;
  }
  return false;
});

// 初始化：先让后台把公共清单（data.json）合并进最终列表，再应用过滤。
// 合并在后台统一做，多标签页打开时结果也是一致的。
startObserver();
chrome.runtime.sendMessage({ action: 'syncPublicList' }, function () {
  // 消息失败（后台未就绪）也没关系，storage 里已经有上次合并好的列表
  void chrome.runtime.lastError;
  applyStoredFilter();
});
