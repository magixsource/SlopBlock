const FILTER_KEY = 'localFilterList';
const USER_KEY = 'userFilterList';
const PUBLIC_KEY = 'publicFilterList';
const EXCLUDED_KEY = 'excludedIds';
const NAME_CACHE_KEY = 'ownerNameCache';
const PAGE_SIZE = 10;

let ownerNames = {};
let currentList = [];
let currentPage = 1;
let nameRequested = false;

function parseFilterList(raw) {
  return String(raw || '')
    .split(';')
    .map(function (item) { return item.trim(); })
    .filter(function (item) { return item.length > 0; });
}

function showToast(message, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#ffebee' : '#e8f5e9';
  toast.style.color = isError ? '#c62828' : '#2e7d32';
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function () {
    toast.classList.remove('show');
  }, 2500);
}

function initialOf(name) {
  const text = String(name || '').trim();
  return text ? text.charAt(0).toUpperCase() : '?';
}

function render() {
  const count = document.getElementById('count');
  count.textContent = '共屏蔽 ' + currentList.length + ' 位UP主';

  const totalPages = Math.max(1, Math.ceil(currentList.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const list = document.getElementById('list');
  list.innerHTML = '';

  if (currentList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '还没有屏蔽任何 UP 主<div class="sub">在视频卡片上右键即可添加</div>';
    list.appendChild(empty);
  } else {
    const start = (currentPage - 1) * PAGE_SIZE;
    currentList.slice(start, start + PAGE_SIZE).forEach(function (id) {
      list.appendChild(createRow(id));
    });
  }

  const pager = document.getElementById('pager');
  pager.hidden = totalPages <= 1;
  document.getElementById('pageInfo').textContent = currentPage + ' / ' + totalPages;
  document.getElementById('prevPage').disabled = currentPage <= 1;
  document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

function createRow(id) {
  const name = ownerNames[id] || '';

  const item = document.createElement('div');
  item.className = 'item';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = initialOf(name);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'name' + (name ? '' : ' unknown');
  nameEl.textContent = name || '昵称未知';

  const idEl = document.createElement('span');
  idEl.className = 'id';
  idEl.textContent = 'ID ' + id;

  meta.appendChild(nameEl);
  meta.appendChild(idEl);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove';
  removeBtn.textContent = '移除';
  removeBtn.title = '取消屏蔽 ' + (name || id);
  removeBtn.addEventListener('click', function () {
    removeFilter(id);
  });

  item.appendChild(avatar);
  item.appendChild(meta);
  item.appendChild(removeBtn);

  return item;
}

// 通过当前 B 站标签页的内容脚本补全昵称（能带上登录态，也不受 CORS 限制）
function requestOwnerNames() {
  if (nameRequested || currentList.length === 0) return;
  nameRequested = true;

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const tab = tabs && tabs[0];
    if (!tab || tab.id === undefined) return;
    chrome.tabs.sendMessage(tab.id, { action: 'resolveOwnerNames', ids: currentList }, function (response) {
      if (chrome.runtime.lastError || !response || !response.names) return;
      applyNames(response.names);
    });
  });
}

function applyNames(map) {
  let changed = false;
  Object.keys(map).forEach(function (id) {
    if (ownerNames[id] !== map[id]) {
      ownerNames[id] = map[id];
      changed = true;
    }
  });
  if (changed) render();
}

function load() {
  chrome.storage.local.get([FILTER_KEY, NAME_CACHE_KEY], function (result) {
    ownerNames = result[NAME_CACHE_KEY] || {};
    currentList = parseFilterList(result[FILTER_KEY]);
    render();
    requestOwnerNames();
  });
}

function removeFilter(id) {
  chrome.storage.local.get([FILTER_KEY, PUBLIC_KEY, USER_KEY, EXCLUDED_KEY], function (result) {
    const list = parseFilterList(result[FILTER_KEY]);
    if (list.indexOf(id) === -1) return;

    const publicIds = parseFilterList(result[PUBLIC_KEY]);
    const userIds = parseFilterList(result[USER_KEY]);
    const excluded = parseFilterList(result[EXCLUDED_KEY]);

    // 公共清单里的 ID：记入墓碑，升级/刷新后也不再出现；
    // 用户自己添加的 ID：只从用户集合里删掉，不写墓碑，
    // 否则这个 ID 以后即使出现在公共清单里也会被误屏蔽掉。
    const isPublic = publicIds.indexOf(id) !== -1;
    if (isPublic && excluded.indexOf(id) === -1) excluded.push(id);

    const nextUser = userIds.filter(function (item) { return item !== id; });
    const next = list.filter(function (item) { return item !== id; });

    chrome.storage.local.set({
      [FILTER_KEY]: next.join(';'),
      [USER_KEY]: nextUser.join(';'),
      [EXCLUDED_KEY]: excluded.join(';')
    }, function () {
      if (chrome.runtime.lastError) {
        showToast('保存失败: ' + chrome.runtime.lastError.message, true);
        return;
      }
      showToast('已移除 ' + (ownerNames[id] || id), false);
      notifyActiveTab();
    });
  });
}

// 内容脚本本身监听 storage 变化，这里再发一次消息作为兜底
function notifyActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const tab = tabs && tabs[0];
    if (!tab || tab.id === undefined) return;
    chrome.tabs.sendMessage(tab.id, { action: 'applyStoredFilter' }, function () {
      void chrome.runtime.lastError;
    });
  });
}

// 页面里右键添加、或其他地方改动后，弹窗保持同步
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace !== 'local') return;

  if (changes[NAME_CACHE_KEY]) {
    ownerNames = changes[NAME_CACHE_KEY].newValue || {};
    // 缓存更新后可能还有没查到的 ID，允许再请求一次
    nameRequested = false;
    requestOwnerNames();
    render();
  }
  if (changes[FILTER_KEY]) {
    currentList = parseFilterList(changes[FILTER_KEY].newValue);
    render();
    requestOwnerNames();
  }
});

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('openSettings').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('prevPage').addEventListener('click', function () {
    if (currentPage <= 1) return;
    currentPage--;
    render();
    document.getElementById('list').scrollTop = 0;
  });
  document.getElementById('nextPage').addEventListener('click', function () {
    const totalPages = Math.max(1, Math.ceil(currentList.length / PAGE_SIZE));
    if (currentPage >= totalPages) return;
    currentPage++;
    render();
    document.getElementById('list').scrollTop = 0;
  });
  load();
});
