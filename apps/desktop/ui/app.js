/** Koda Desktop — local-first Codex-style command center UI */

const $ = (id) => document.getElementById(id);

const state = {
  session: null,
  threads: [],
  activeThreadId: null,
  pendingApprovals: new Map(),
  diffs: [],
  planSteps: [],
  planActive: 0,
  context: {},
  metrics: null,
  sending: false,
};

const panels = ['plan', 'diff', 'context', 'metrics', 'approvals'];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.session.token}`,
  };
}

function switchTab(name) {
  document.querySelectorAll('.panel-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  panels.forEach((p) => {
    const el = $(`panel-${p.charAt(0).toUpperCase() + p.slice(1)}`) || $(`panel${p.charAt(0).toUpperCase() + p.slice(1)}`);
  });
  document.querySelectorAll('.panel-content').forEach((el) => {
    el.classList.toggle('active', el.id === `panel${capitalize(name)}`);
  });
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    if (tab.dataset.tab === name) tab.classList.add('active');
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Fix panel IDs - plan, diff, context, metrics, approvals -> panelPlan etc.
function showPanel(name) {
  document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  ['Plan', 'Diff', 'Context', 'Metrics', 'Approvals'].forEach((p) => {
    const el = $(`panel${p}`);
    if (el) el.classList.toggle('active', p.toLowerCase() === name);
  });
}

function logTerminal(line, cls = '') {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.textContent = line;
  $('terminalLog').appendChild(el);
  $('terminalLog').scrollTop = $('terminalLog').scrollHeight;
}

function toggleTerminal(force) {
  const open = force !== undefined ? force : !$('terminalPanel').classList.contains('open');
  $('terminalPanel').classList.toggle('open', open);
}

function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'bubble-user';
  el.textContent = text;
  $('messages').appendChild(el);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function appendToolCard(kind, detail, durationMs) {
  const card = document.createElement('div');
  card.className = 'tool-card';
  const dur = durationMs ? `<span class="tool-duration">${durationMs}ms</span>` : '';
  card.innerHTML = `
    <div class="tool-card-header">
      <span class="tool-label ${kind}">${kind}</span>
      <span>${escapeHtml(detail)}</span>
      ${dur}
    </div>`;
  $('messages').appendChild(card);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPlan(steps, activeStep = 0) {
  state.planSteps = steps;
  state.planActive = activeStep;
  if (!steps.length) return;
  $('panelPlan').innerHTML = steps.map((step, i) => {
    const cls = i < activeStep ? 'done' : i === activeStep ? 'active' : '';
    return `<div class="plan-step ${cls}"><div class="plan-step-num">${i + 1}</div><div>${escapeHtml(step)}</div></div>`;
  }).join('');
  showPanel('plan');
}

function renderDiff(payload) {
  state.diffs.push(payload);
  if ($('panelDiff').querySelector('.panel-empty')) $('panelDiff').innerHTML = '';
  const preview = (payload.newContent || '').split('\n').slice(0, 12)
    .map((l) => `<div class="diff-add">+ ${escapeHtml(l)}</div>`).join('');
  const block = document.createElement('div');
  block.className = 'diff-file';
  block.innerHTML = `
    <div class="diff-file-name">
      <span>${escapeHtml(payload.filePath)}</span>
      <span class="diff-stats"><span class="add">+${payload.added || 0}</span> <span class="del">-${payload.removed || 0}</span></span>
    </div>
    <div class="diff-lines">${preview}</div>`;
  $('panelDiff').appendChild(block);
  showPanel('diff');
}

function renderContext(payload) {
  state.context = payload;
  $('panelContext').innerHTML = `
    <div class="section-label">Repository</div>
    <div class="metric-grid">
      <div class="metric-cell"><div class="label">Files</div><div class="value">${payload.fileCount ?? '—'}</div></div>
      <div class="metric-cell"><div class="label">Symbols</div><div class="value">${payload.symbolCount ?? '—'}</div></div>
      <div class="metric-cell"><div class="label">Chunks</div><div class="value">${payload.chunkCount ?? '—'}</div></div>
      <div class="metric-cell highlight"><div class="label">Est. tokens</div><div class="value">${(payload.tokens || 0).toLocaleString()}</div></div>
    </div>
    <div class="section-label">Retrieved paths</div>
    ${(payload.files || []).length
      ? payload.files.map((f) => `<div class="context-file">${escapeHtml(f)}</div>`).join('')
      : '<div class="panel-empty" style="padding:8px;">No files retrieved yet.</div>'}
    <div class="section-label">Tool references</div>
    <div class="context-file">${payload.refs ?? 0} reference-first results</div>`;
  showPanel('context');
}

function renderMetrics(payload) {
  const m = payload.metrics || {};
  const refPct = Math.round((m.refRate || 0) * 100);
  const kei = payload.kei || 0;
  $('panelMetrics').innerHTML = `
    <div class="metric-grid">
      <div class="metric-cell highlight"><div class="label">Ref rate</div><div class="value">${refPct}%</div></div>
      <div class="metric-cell highlight"><div class="label">KEI</div><div class="value">${kei > 0 ? kei : '—'}</div></div>
      <div class="metric-cell"><div class="label">Tokens</div><div class="value">${(m.tokens || 0).toLocaleString()}</div></div>
      <div class="metric-cell"><div class="label">Tools</div><div class="value">${m.tools || 0}</div></div>
      <div class="metric-cell"><div class="label">Prompt</div><div class="value">${(m.promptTokens || 0).toLocaleString()}</div></div>
      <div class="metric-cell"><div class="label">Completion</div><div class="value">${(m.completionTokens || 0).toLocaleString()}</div></div>
    </div>
    <div class="section-label">Provider</div>
    <div class="context-file">${escapeHtml(payload.provider || state.session?.provider || 'local')} · ${escapeHtml(payload.model || state.session?.model || '')}</div>
    <div class="section-label">Route</div>
    <div class="context-file">${escapeHtml(m.route || 'simple')}</div>`;
  showPanel('metrics');
}

function updateApprovalBadge() {
  const n = state.pendingApprovals.size;
  const tab = document.querySelector('.panel-tab[data-tab="approvals"]');
  if (!tab) return;
  const existing = tab.querySelector('.badge-count');
  if (existing) existing.remove();
  if (n > 0) {
    tab.insertAdjacentHTML('beforeend', `<span class="badge-count">${n}</span>`);
  }
}

function renderApproval(approval) {
  state.pendingApprovals.set(approval.id, approval);
  if ($('panelApprovals').querySelector('.panel-empty')) $('panelApprovals').innerHTML = '';
  const card = document.createElement('div');
  card.className = 'approval-card';
  card.id = `approval-${approval.id}`;
  card.innerHTML = `
    <div><strong>WRITE</strong> · ${escapeHtml(approval.target)}</div>
    <div style="color:var(--muted);font-size:11px;margin-top:4px;">
      <span class="add">+${approval.added || 0}</span> <span class="del">-${approval.removed || 0}</span> lines
    </div>
    <div class="actions">
      <button class="btn success" data-approve="${approval.id}">Approve</button>
      <button class="btn danger" data-reject="${approval.id}">Reject</button>
    </div>`;
  $('panelApprovals').appendChild(card);
  card.querySelector('[data-approve]').onclick = () => resolveApproval(approval.id, true);
  card.querySelector('[data-reject]').onclick = () => resolveApproval(approval.id, false);
  updateApprovalBadge();
  showPanel('approvals');
}

async function resolveApproval(id, approved) {
  await fetch(`${state.session.serverUrl}/api/approvals/${id}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: approved ? 'approve' : 'reject' }),
  });
}

function markApprovalResolved(id, approved) {
  state.pendingApprovals.delete(id);
  const card = $(`approval-${id}`);
  if (card) {
    card.classList.add('resolved');
    card.querySelector('.actions').innerHTML = `<span style="color:var(--muted);font-size:11px;">${approved ? 'Approved' : 'Rejected'}</span>`;
  }
  updateApprovalBadge();
}

function appendError(message, suggestion) {
  const el = document.createElement('div');
  el.className = 'error-banner';
  el.innerHTML = `<strong>Error</strong><br>${escapeHtml(message)}`;
  if (message.includes('401')) {
    el.innerHTML += '<br><br>Run <code style="color:var(--accent)">koda login</code> in your project folder.';
  }
  if (suggestion) el.innerHTML += `<br><span style="color:var(--muted)">${escapeHtml(suggestion)}</span>`;
  $('messages').appendChild(el);
  logTerminal(message, 'line-err');
}

function renderThreadList() {
  $('threadList').innerHTML = state.threads.map((t) => `
    <button class="thread-item ${t.id === state.activeThreadId ? 'active' : ''}" data-id="${t.id}">
      <div class="title">${escapeHtml(t.title)}</div>
      <div class="sub">Local · ${new Date(t.updatedAt).toLocaleTimeString()}</div>
    </button>`).join('');
  $('threadList').querySelectorAll('.thread-item').forEach((btn) => {
    btn.onclick = () => selectThread(btn.dataset.id);
  });
}

function clearWorkspace() {
  $('messages').innerHTML = '';
  $('terminalLog').innerHTML = '';
  state.diffs = [];
  state.pendingApprovals.clear();
  updateApprovalBadge();
  ['Plan', 'Diff', 'Context', 'Metrics', 'Approvals'].forEach((p) => {
    const el = $(`panel${p}`);
    if (el) el.innerHTML = `<div class="panel-empty">${p} panel</div>`;
  });
  $('panelPlan').innerHTML = '<div class="panel-empty">Agent plan will appear here.</div>';
  $('panelDiff').innerHTML = '<div class="panel-empty">File changes will appear here.</div>';
  $('panelContext').innerHTML = '<div class="panel-empty">Repository intelligence shown here.</div>';
  $('panelMetrics').innerHTML = '<div class="panel-empty">Session metrics after each turn.</div>';
  $('panelApprovals').innerHTML = '<div class="panel-empty">Pending approvals appear here.</div>';
}

async function loadThreads() {
  if (!state.session) return;
  const res = await fetch(`${state.session.serverUrl}/api/threads`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  state.threads = data.threads || [];
  if (!state.activeThreadId && state.threads.length) {
    state.activeThreadId = state.threads[0].id;
  }
  renderThreadList();
}

async function createThread(title = 'New thread') {
  const res = await fetch(`${state.session.serverUrl}/api/threads`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) return;
  const data = await res.json();
  state.threads.unshift(data.thread);
  state.activeThreadId = data.thread.id;
  $('threadTitle').textContent = data.thread.title;
  clearWorkspace();
  renderThreadList();
}

function selectThread(id) {
  state.activeThreadId = id;
  const t = state.threads.find((x) => x.id === id);
  if (t) $('threadTitle').textContent = t.title;
  clearWorkspace();
  renderThreadList();
}

async function handleSseEvent(event, payload) {
  switch (event) {
    case 'thread':
      state.activeThreadId = payload.threadId;
      await loadThreads();
      break;
    case 'tool':
      appendToolCard(payload.kind || 'INFO', payload.detail || '', payload.durationMs);
      break;
    case 'terminal':
      logTerminal(payload.line || '');
      break;
    case 'plan':
      renderPlan(payload.steps || [], payload.activeStep ?? 0);
      break;
    case 'context':
      renderContext(payload);
      break;
    case 'diff':
      renderDiff(payload);
      break;
    case 'approval':
      renderApproval(payload.approval);
      break;
    case 'approval_resolved':
      markApprovalResolved(payload.id, payload.approved);
      break;
    case 'error':
      appendError(payload.message, payload.suggestion);
      break;
    case 'done':
      renderMetrics(payload);
      break;
    default:
      break;
  }
}

async function sendChat(message) {
  if (!state.session || state.sending) return;
  state.sending = true;
  $('sendBtn').disabled = true;

  appendUserMessage(message);

  const thinking = document.createElement('div');
  thinking.className = 'thinking';
  thinking.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span> Koda is working…';
  $('messages').appendChild(thinking);

  const assistantEl = document.createElement('div');
  assistantEl.className = 'bubble-assistant';
  let buffer = '';
  let assistantStarted = false;

  try {
    const res = await fetch(`${state.session.serverUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        message,
        threadId: state.activeThreadId,
        autoApprove: false,
      }),
    });

    if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const chunks = pending.split('\n\n');
      pending = chunks.pop() || '';

      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        const payload = JSON.parse(data);

        if (event === 'token') {
          if (!assistantStarted) {
            thinking.remove();
            $('messages').appendChild(assistantEl);
            assistantStarted = true;
          }
          buffer += payload.text || '';
          assistantEl.textContent = buffer;
          $('messages').scrollTop = $('messages').scrollHeight;
        } else if (event === 'thinking') {
          // keep spinner
        } else {
          await handleSseEvent(event, payload);
        }
      }
    }
  } catch (err) {
    thinking.remove();
    appendError(err.message);
  } finally {
    state.sending = false;
    $('sendBtn').disabled = false;
    await loadThreads();
  }
}

function refreshTitleMeta() {
  if (!state.session) return;
  const configured = state.session.hasConfig !== false;
  $('titleMeta').innerHTML = '';
  const name = document.createElement('span');
  name.textContent = state.session.repoName;
  $('titleMeta').appendChild(name);
  $('titleMeta').appendChild(document.createTextNode(` · ${state.session.branch || 'unknown'} · ${state.session.model || 'model'} `));
  const pill = document.createElement('span');
  pill.id = 'configPill';
  pill.className = 'config-pill ' + (configured ? 'ok' : 'warn');
  pill.textContent = configured ? 'AI connected' : 'AI not configured';
  $('titleMeta').appendChild(pill);
}

function onSessionReady(next) {
  state.session = next;
  $('welcomeScreen').classList.add('hidden');
  $('workspace').classList.remove('hidden');
  $('terminalToggle').classList.remove('hidden');
  $('settingsBtn').classList.remove('hidden');
  $('projectInfo').innerHTML = `${escapeHtml(next.repoPath)}<br>Index: ${next.indexStatus || 'unknown'} · ${next.fileCount ?? '?'} files`;

  refreshTitleMeta();

  clearWorkspace();
  loadThreads().then(() => {
    if (!state.threads.length) createThread('New thread');
  });

  if (next.hasConfig === false) {
    window.KodaSetup.open(next, { required: true });
  }
}

window.addEventListener('koda-config-saved', (e) => {
  if (!state.session) return;
  state.session.hasConfig = true;
  state.session.model = e.detail.model;
  state.session.provider = e.detail.provider;
  refreshTitleMeta();
});

function bindUi() {
  $('openFolderBtn').onclick = () => window.kodaDesktop.openProject();
  $('welcomeOpenBtn').onclick = () => window.kodaDesktop.openProject();
  $('newThreadBtn').onclick = () => createThread('New thread');
  $('settingsBtn').onclick = () => {
    if (state.session) window.KodaSetup.open(state.session, { required: false });
  };
  $('terminalToggle').onclick = () => toggleTerminal();
  $('terminalClose').onclick = () => toggleTerminal(false);
  $('sendBtn').onclick = () => {
    const text = $('input').value.trim();
    if (!text) return;
    $('input').value = '';
    sendChat(text);
  };
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('sendBtn').click(); }
  });
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.onclick = () => showPanel(tab.dataset.tab);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'j') { e.preventDefault(); toggleTerminal(); }
  });
  window.kodaDesktop.onSessionLoading(() => {
    $('loading').classList.remove('hidden');
    $('welcomeError').classList.add('hidden');
  });
  window.kodaDesktop.onSessionError((msg) => {
    $('loading').classList.add('hidden');
    $('welcomeError').textContent = msg;
    $('welcomeError').classList.remove('hidden');
  });
  window.kodaDesktop.onSessionReady(onSessionReady);
  window.kodaDesktop.requestInitialProject();
}

bindUi();
