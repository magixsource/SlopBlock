const FILTER_KEY = 'localFilterList';
const USER_KEY = 'userFilterList';
const PUBLIC_KEY = 'publicFilterList';
const EXCLUDED_KEY = 'excludedIds';
const DATA_VERSION_KEY = 'publicDataVersion';
const SOURCE_KEY = 'publicSource';
const IMPORTED_LIST_KEY = 'importedPublicList';
const IMPORTED_VERSION_KEY = 'importedPublicVersion';

function parseIds(raw) {
  return String(raw || '')
    .split(';')
    .map(function (item) { return item.trim(); })
    .filter(function (item) { return item.length > 0; });
}

function parseImported(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { error: '内容为空' };

  if (trimmed.charAt(0) === '{') {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch (error) {
      return { error: 'JSON 解析失败：' + error.message };
    }
    const bili = json.bili || json;
    const block = Array.isArray(bili.block) ? bili.block : [];
    const unblock = (Array.isArray(bili.unblock) ? bili.unblock : []).map(String);
    const ids = [];
    block.map(String).forEach(function (id) {
      if (/^\d+$/.test(id) && unblock.indexOf(id) === -1 && ids.indexOf(id) === -1) ids.push(id);
    });
    return {
      ids: ids,
      version: bili.version == null ? '' : String(bili.version)
    };
  }

  const ids = trimmed.split(/[;；,，\s]+/).map(function (item) { return item.trim(); })
    .filter(function (item) { return /^\d+$/.test(item); });
  return { ids: Array.from(new Set(ids)) };
}

function showStatus(message, ok) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'status ' + (ok ? 'ok' : 'err');
}

function refresh() {
  const keys = [SOURCE_KEY, IMPORTED_LIST_KEY, IMPORTED_VERSION_KEY, PUBLIC_KEY, DATA_VERSION_KEY];
  chrome.storage.local.get(keys, function (result) {
    const imported = result[SOURCE_KEY] === 'imported';
    document.getElementById('source').textContent = imported ? '导入的清单' : '内置 data.json';
    document.getElementById('count').textContent = String(parseIds(result[PUBLIC_KEY]).length);
    document.getElementById('version').textContent = String(result[DATA_VERSION_KEY] || '-');

    document.getElementById('listText').value = imported ? (result[IMPORTED_LIST_KEY] || '') : '';
    document.getElementById('versionText').value = imported ? (result[IMPORTED_VERSION_KEY] || '') : '';
  });
}

function applyAndReport(message) {
  chrome.runtime.sendMessage({ action: 'syncPublicList' }, function () {
    void chrome.runtime.lastError;
    showStatus(message, true);
    refresh();
  });
}

document.addEventListener('DOMContentLoaded', function () {
  refresh();

  document.getElementById('saveBtn').addEventListener('click', function () {
    const parsed = parseImported(document.getElementById('listText').value);
    if (parsed.error) {
      showStatus(parsed.error, false);
      return;
    }
    if (parsed.ids.length === 0) {
      showStatus('没有解析到有效的 UP 主 ID', false);
      return;
    }

    const version = document.getElementById('versionText').value.trim()
      || parsed.version
      || String(Date.now());

    chrome.storage.local.set({
      [SOURCE_KEY]: 'imported',
      [IMPORTED_LIST_KEY]: parsed.ids.join(';'),
      [IMPORTED_VERSION_KEY]: version
    }, function () {
      if (chrome.runtime.lastError) {
        showStatus('保存失败：' + chrome.runtime.lastError.message, false);
        return;
      }
      applyAndReport('已导入 ' + parsed.ids.length + ' 个 ID 并应用');
    });
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    chrome.storage.local.set({ [SOURCE_KEY]: 'builtin' }, function () {
      applyAndReport('已恢复使用内置 data.json');
    });
  });

  document.getElementById('exportBtn').addEventListener('click', function () {
    chrome.storage.local.get([PUBLIC_KEY, DATA_VERSION_KEY], function (result) {
      document.getElementById('listText').value = String(result[PUBLIC_KEY] || '');
      document.getElementById('versionText').value = String(result[DATA_VERSION_KEY] || '');
      showStatus('已把当前公共清单填入编辑框，可复制后分享', true);
    });
  });

  const fileInput = document.getElementById('fileInput');
  document.getElementById('fileBtn').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      document.getElementById('listText').value = String(reader.result || '');
      showStatus('文件已载入，检查后点“保存并应用”', true);
    };
    reader.onerror = function () {
      showStatus('读取文件失败', false);
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
});
