const FILTER_KEY = 'localFilterList';
const USER_KEY = 'userFilterList';
const PUBLIC_KEY = 'publicFilterList';
const EXCLUDED_KEY = 'excludedIds';
const DATA_VERSION_KEY = 'publicDataVersion';
const NAME_CACHE_KEY = 'ownerNameCache';
const SOURCE_KEY = 'publicSource';
const IMPORTED_LIST_KEY = 'importedPublicList';
const IMPORTED_VERSION_KEY = 'importedPublicVersion';
const MENU_ID = 'slopBlockFilterContextMenuItem';
const DATA_PATH = 'data/data.json';

function parseIds(raw) {
  return String(raw || '')
    .split(';')
    .map(function (item) { return item.trim(); })
    .filter(function (item) { return item.length > 0; });
}

// 读取包内的公共清单（data.json 是静态实现；远程拉取可在这里扩展）
function loadBuiltinData() {
  return fetch(chrome.runtime.getURL(DATA_PATH), { cache: 'no-store' })
    .then(function (response) { return response.json(); })
    .then(function (data) {
      const bili = (data && data.bili) || {};
      const block = Array.isArray(bili.block) ? bili.block : [];
      const unblock = Array.isArray(bili.unblock) ? bili.unblock : [];
      const unblockSet = new Set(unblock.map(String));
      const ids = [];
      block.map(String).forEach(function (id) {
        if (!unblockSet.has(id) && ids.indexOf(id) === -1) ids.push(id);
      });
      return {
        ids: ids,
        version: bili.version == null ? '' : String(bili.version)
      };
    })
    .catch(function (error) {
      console.warn('[slopBlock] 读取内置清单失败:', error && error.message);
      return null;
    });
}

// 合并规则：
// 最终清单 = (公共清单 − excludedIds) ∪ 用户自己添加的集合
// - excludedIds 只记录“从公共清单里移除”的 ID，不影响用户本地添加的 ID
// - 公共来源（内置 data.json / 用户在设置页导入）升级新增的 ID 会自动加入
// - 用户在弹窗里移除公共 ID 后，升级/刷新也不会再出现
function applyPublicData(data, result, callback) {
  const oldPublic = parseIds(result[PUBLIC_KEY]);
  const localIds = parseIds(result[FILTER_KEY]);
  const excluded = new Set(parseIds(result[EXCLUDED_KEY]));

  // 迁移：老版本没有 userFilterList，用当前列表减去旧公共清单推断用户自定义项
  const hasUserKey = Object.prototype.hasOwnProperty.call(result, USER_KEY);
  const userIds = hasUserKey
    ? parseIds(result[USER_KEY])
    : localIds.filter(function (id) {
        return oldPublic.indexOf(id) === -1 && !excluded.has(id);
      });

  const seen = new Set();
  const merged = [];
  data.ids.forEach(function (id) {
    if (excluded.has(id) || seen.has(id)) return;
    seen.add(id);
    merged.push(id);
  });
  userIds.forEach(function (id) {
    if (seen.has(id)) return;
    seen.add(id);
    merged.push(id);
  });

  const updates = {};
  const nextLocal = merged.join(';');
  const nextPublic = data.ids.join(';');
  if ((result[FILTER_KEY] || '') !== nextLocal) updates[FILTER_KEY] = nextLocal;
  if ((result[PUBLIC_KEY] || '') !== nextPublic) updates[PUBLIC_KEY] = nextPublic;
  if (!hasUserKey || result[USER_KEY] !== userIds.join(';')) updates[USER_KEY] = userIds.join(';');
  if ((result[DATA_VERSION_KEY] || '') !== data.version) updates[DATA_VERSION_KEY] = data.version;

  if (Object.keys(updates).length === 0) {
    if (callback) callback(false);
    return;
  }

  chrome.storage.local.set(updates, function () {
    if (chrome.runtime.lastError) {
      console.error('[slopBlock] 同步公共清单失败:', chrome.runtime.lastError.message);
    } else {
      console.log('[slopBlock] 公共清单已同步，版本:', data.version);
    }
    if (callback) callback(true);
  });
}

function syncPublicList(callback) {
  const keys = [FILTER_KEY, PUBLIC_KEY, USER_KEY, EXCLUDED_KEY, DATA_VERSION_KEY,
    SOURCE_KEY, IMPORTED_LIST_KEY, IMPORTED_VERSION_KEY];

  chrome.storage.local.get(keys, function (result) {
    if (result[SOURCE_KEY] === 'imported') {
      const ids = parseIds(result[IMPORTED_LIST_KEY]);
      const version = 'imported:' + String(result[IMPORTED_VERSION_KEY] || '');
      applyPublicData({ ids: ids, version: version }, result, callback);
      return;
    }

    loadBuiltinData().then(function (data) {
      if (!data) {
        if (callback) callback(false);
        return;
      }
      applyPublicData(data, result, callback);
    });
  });
}

// 从 space.bilibili.com/123456?xxx 中提取 UP 主 ID
function extractOwnerId(url) {
  if (!url) return '';
  const match = String(url).match(/space\.bilibili\.com\/(\d+)/);
  return match ? match[1] : '';
}

// 卡片整体通常被视频链接包裹，右键 UP 名拿到的也是 /video/BVxxx，
// 所以需要根据 bvid 反查该视频的 UP 主 mid。
function extractBvid(url) {
  const match = String(url || '').match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i);
  return match ? match[1] : '';
}

function fetchOwnerByBvid(bvid) {
  return fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid), {
    credentials: 'include'
  })
    .then(function (response) { return response.json(); })
    .then(function (json) {
      if (json && json.code === 0 && json.data && json.data.owner && json.data.owner.mid) {
        return {
          id: String(json.data.owner.mid),
          name: String(json.data.owner.name || '')
        };
      }
      return null;
    })
    .catch(function (error) {
      console.warn('[slopBlock] 查询视频UP主失败:', bvid, error && error.message);
      return null;
    });
}

// 追加自定义屏蔽 ID，同时从 excludedIds 里移除（用户重新添加表示撤销之前的移除）
function addOwnerToFilter(ownerId, ownerName) {
  chrome.storage.local.get([FILTER_KEY, PUBLIC_KEY, USER_KEY, EXCLUDED_KEY, DATA_VERSION_KEY, NAME_CACHE_KEY], function (result) {
    const list = parseIds(result[FILTER_KEY]);
    const userIds = parseIds(result[USER_KEY]);
    const cache = result[NAME_CACHE_KEY] || {};
    const excluded = parseIds(result[EXCLUDED_KEY]);

    const updates = {};
    if (ownerName && cache[ownerId] !== ownerName) {
      cache[ownerId] = ownerName;
      updates[NAME_CACHE_KEY] = cache;
    }

    if (list.indexOf(ownerId) === -1) {
      list.push(ownerId);
      updates[FILTER_KEY] = list.join(';');
    }
    if (userIds.indexOf(ownerId) === -1) {
      userIds.push(ownerId);
      updates[USER_KEY] = userIds.join(';');
    }

    const nextExcluded = excluded.filter(function (id) { return id !== ownerId; });
    if (nextExcluded.length !== excluded.length) updates[EXCLUDED_KEY] = nextExcluded.join(';');

    if (Object.keys(updates).length === 0) {
      console.log('[slopBlock] 该UP主已在屏蔽列表中:', ownerId);
      return;
    }

    chrome.storage.local.set(updates, function () {
      if (chrome.runtime.lastError) {
        console.error('[slopBlock] 写入屏蔽列表失败:', chrome.runtime.lastError.message);
      } else {
        console.log('[slopBlock] 已添加屏蔽UP主:', ownerId, ownerName || '');
      }
    });
  });
}

// 已存在时 create 只报 duplicate id：直接更新标题，
// 不用 removeAll，避免丢掉正在唤醒 SW 的那次点击。
function ensureContextMenu() {
  const options = {
    id: MENU_ID,
    title: '屏蔽此UP主',
    contexts: ['link'],
    documentUrlPatterns: ['*://*.bilibili.com/*']
  };
  chrome.contextMenus.create(options, function () {
    const error = chrome.runtime.lastError;
    if (!error) return;
    if (/duplicate/i.test(error.message)) {
      chrome.contextMenus.update(MENU_ID, {
        title: options.title,
        contexts: options.contexts,
        documentUrlPatterns: options.documentUrlPatterns
      }, function () {
        void chrome.runtime.lastError;
      });
    } else {
      console.error('[slopBlock] 创建右键菜单失败:', error.message);
    }
  });
}

chrome.runtime.onInstalled.addListener(function () {
  syncPublicList(function () {
    chrome.contextMenus.removeAll(ensureContextMenu);
  });
});
chrome.runtime.onStartup.addListener(function () {
  syncPublicList();
  ensureContextMenu();
});
syncPublicList();
ensureContextMenu();

// 监听器必须在顶层：MV3 服务工作进程休眠重启后，回调里注册的监听器会丢失
chrome.contextMenus.onClicked.addListener(function (info) {
  console.log('[slopBlock] 右键菜单点击:', info.menuItemId, info.linkUrl);
  if (info.menuItemId !== MENU_ID) return;

  const directId = extractOwnerId(info.linkUrl);
  if (directId) {
    addOwnerToFilter(directId);
    return;
  }

  const bvid = extractBvid(info.linkUrl);
  if (!bvid) {
    console.warn('[slopBlock] 既不是UP主主页也不是视频链接:', info.linkUrl);
    return;
  }

  fetchOwnerByBvid(bvid).then(function (owner) {
    if (!owner || !owner.id) {
      console.warn('[slopBlock] 无法从视频解析出UP主:', bvid);
      return;
    }
    console.log('[slopBlock] 视频', bvid, '的UP主:', owner.id, owner.name);
    addOwnerToFilter(owner.id, owner.name);
  });
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request) return false;

  if (request.action === 'getFilterList') {
    chrome.storage.local.get(FILTER_KEY, function (result) {
      sendResponse({ localFilterList: result[FILTER_KEY] });
    });
    return true;
  }

  if (request.action === 'syncPublicList') {
    syncPublicList(function (changed) {
      sendResponse({ changed: changed });
    });
    return true;
  }

  return false;
});
