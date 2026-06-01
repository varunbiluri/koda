/** In-app AI provider setup — replaces terminal `koda login` for desktop */

const setupState = {
  provider: null,
  models: [],
  required: false,
  session: null,
};

function $(id) { return document.getElementById(id); }

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${setupState.session.token}`,
  };
}

function showSetupError(msg) {
  const el = $('setupError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearSetupError() {
  $('setupError').classList.add('hidden');
}

function showStep(name) {
  $('setupStepProviders').classList.toggle('hidden', name !== 'providers');
  $('setupStepForm').classList.toggle('hidden', name !== 'form');
  $('setupStepDone').classList.toggle('hidden', name !== 'done');
}

function field(name, label, type = 'text', placeholder = '') {
  return `<div class="setup-field">
    <label class="field-label">${label}</label>
    <input class="setup-input" data-field="${name}" type="${type}" placeholder="${placeholder}" />
  </div>`;
}

function renderProviderForm(provider) {
  setupState.provider = provider;
  setupState.models = [];
  $('setupModelRow').classList.add('hidden');
  $('setupSave').disabled = true;

  const fields = $('setupFields');
  if (provider === 'azure') {
    fields.innerHTML =
      field('endpoint', 'Azure endpoint', 'url', 'https://your-resource.openai.azure.com') +
      field('apiKey', 'API key', 'password', '••••••••');
  } else if (provider === 'openai') {
    fields.innerHTML =
      field('apiKey', 'OpenAI API key', 'password', 'sk-…') +
      field('endpoint', 'Endpoint (optional)', 'url', 'https://api.openai.com/v1');
  } else if (provider === 'anthropic') {
    fields.innerHTML =
      field('apiKey', 'Anthropic API key', 'password', 'sk-ant-…') +
      field('endpoint', 'Endpoint (optional)', 'url', 'https://api.anthropic.com');
  } else if (provider === 'ollama') {
    fields.innerHTML = field('endpoint', 'Ollama endpoint', 'url', 'http://127.0.0.1:11434');
  }
  showStep('form');
  clearSetupError();
}

function getField(name) {
  const el = document.querySelector(`[data-field="${name}"]`);
  return el ? el.value.trim() : '';
}

function populateModels(models) {
  setupState.models = models;
  const sel = $('setupModelSelect');
  sel.innerHTML = models.map((m) => `<option value="${m.id}">${m.name || m.id}</option>`).join('');
  $('setupModelRow').classList.remove('hidden');
  $('setupSave').disabled = models.length === 0;
}

async function loadModels() {
  clearSetupError();
  $('setupLoadModels').disabled = true;
  $('setupLoadModels').textContent = 'Loading…';

  try {
    const p = setupState.provider;
    let res;

    if (p === 'azure') {
      res = await fetch(`${setupState.session.serverUrl}/api/config/azure/deployments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ endpoint: getField('endpoint'), apiKey: getField('apiKey') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load deployments');
      populateModels(data.deployments.map((d) => ({ id: d.id, name: `${d.id} (${d.model})` })));
    } else if (p === 'openai') {
      res = await fetch(`${setupState.session.serverUrl}/api/config/openai/models`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ apiKey: getField('apiKey'), endpoint: getField('endpoint') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load models');
      populateModels(data.models);
    } else if (p === 'anthropic') {
      res = await fetch(`${setupState.session.serverUrl}/api/config/anthropic/models`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ apiKey: getField('apiKey'), endpoint: getField('endpoint') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load models');
      populateModels(data.models);
    } else if (p === 'ollama') {
      res = await fetch(`${setupState.session.serverUrl}/api/config/ollama/models`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ endpoint: getField('endpoint') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load models');
      populateModels(data.models);
    }
  } catch (err) {
    showSetupError(err.message);
  } finally {
    $('setupLoadModels').disabled = false;
    $('setupLoadModels').textContent = 'Load models';
  }
}

async function saveConfig() {
  clearSetupError();
  $('setupSave').disabled = true;
  $('setupSave').textContent = 'Testing…';

  const model = $('setupModelSelect').value || getField('model');
  const payload = {
    provider: setupState.provider,
    model,
    endpoint: getField('endpoint'),
    apiKey: getField('apiKey'),
  };

  try {
    const res = await fetch(`${setupState.session.serverUrl}/api/config`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Configuration failed');

    $('setupDoneMsg').textContent = `${data.config.provider} · ${data.config.model}`;
    showStep('done');
    window.dispatchEvent(new CustomEvent('koda-config-saved', { detail: data.config }));
  } catch (err) {
    showSetupError(err.message);
  } finally {
    $('setupSave').disabled = setupState.models.length === 0;
    $('setupSave').textContent = 'Save & test';
  }
}

function openSetup(session, { required = false } = {}) {
  setupState.session = session;
  setupState.required = required;
  setupState.provider = null;
  $('setupOverlay').classList.remove('hidden');
  $('setupClose').classList.toggle('hidden', required);
  showStep('providers');
  clearSetupError();
}

function closeSetup() {
  if (setupState.required) return;
  $('setupOverlay').classList.add('hidden');
}

function bindSetup() {
  document.querySelectorAll('.provider-card').forEach((card) => {
    card.onclick = () => renderProviderForm(card.dataset.provider);
  });
  $('setupBack').onclick = () => showStep('providers');
  $('setupLoadModels').onclick = loadModels;
  $('setupSave').onclick = saveConfig;
  $('setupClose').onclick = closeSetup;
  $('setupDoneBtn').onclick = () => {
    setupState.required = false;
    closeSetup();
    $('setupOverlay').classList.add('hidden');
  };
}

bindSetup();

window.KodaSetup = { open: openSetup, close: closeSetup };
