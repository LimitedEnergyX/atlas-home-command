/* Local-preview assistant. The server owns proposals and applies stock changes.
 * Conversation is kept in page memory only. No model content becomes HTML.
 */
(() => {
  'use strict';
  if (document.getElementById('galley-assistant')) return;

  const host = document.createElement('div');
  host.id = 'galley-assistant';
  host.innerHTML = `
    <button type="button" class="gqa-launcher" aria-label="Open GalleyQuest assistant" aria-expanded="false" aria-controls="gqa-panel">
      <img src="/docs/Images/app-icon.png" alt="" width="56" height="56">
      <span class="gqa-launcher-fallback" aria-hidden="true">🤖</span>
    </button>
    <section id="gqa-panel" class="gqa-panel" role="dialog" aria-modal="false" aria-labelledby="gqa-title" hidden>
      <header class="gqa-header">
        <div><h2 id="gqa-title">GalleyQuest assistant</h2><span class="gqa-badge">Local AI · Preview</span></div>
        <button type="button" class="gqa-close" aria-label="Close GalleyQuest assistant">×</button>
      </header>
      <p class="gqa-boundary">Kitchen help on this computer. Stock changes need your review. No house controls or purchases.</p>
      <div class="gqa-conversation" role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions text"></div>
      <div class="gqa-examples" aria-label="Example questions">
        <button type="button">What can you help with?</button>
        <button type="button">We have 1/2 gallon of milk left</button>
      </div>
      <div class="gqa-status" role="status" aria-live="polite"></div>
      <div class="gqa-error" role="alert" hidden></div>
      <form class="gqa-form">
        <label class="gqa-sr-only" for="gqa-message">Message GalleyQuest assistant</label>
        <textarea id="gqa-message" rows="2" maxlength="2000" placeholder="Tell me what changed in the kitchen…"></textarea>
        <button type="submit" class="gqa-send">Send</button>
      </form>
      <p class="gqa-footnote">Chat stays in this page and clears when you reload. AI can make mistakes.</p>
    </section>`;
  document.body.append(host);

  const get = selector => host.querySelector(selector);
  const launcher = get('.gqa-launcher');
  const panel = get('.gqa-panel');
  const conversation = get('.gqa-conversation');
  const input = get('textarea');
  const form = get('form');
  const send = get('.gqa-send');
  const status = get('.gqa-status');
  const errorBox = get('.gqa-error');
  const examples = [...host.querySelectorAll('.gqa-examples button')];
  let busy = false;
  let pending = null;
  let history = [];

  const icon = get('img');
  icon.addEventListener('error', () => {
    icon.hidden = true;
    get('.gqa-launcher-fallback').style.display = 'block';
  });

  function scrollToLatest() {
    conversation.scrollTop = conversation.scrollHeight;
  }

  function bubble(role, text) {
    const element = document.createElement('div');
    element.className = 'gqa-bubble gqa-' + role;
    const label = document.createElement('span');
    label.className = 'gqa-speaker';
    label.textContent = role === 'user' ? 'You' : 'GalleyQuest';
    const content = document.createElement('p');
    content.textContent = text;
    element.append(label, content);
    conversation.append(element);
    scrollToLatest();
    return element;
  }

  function setError(message = '') {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function controls() {
    const blocked = busy || Boolean(pending);
    input.disabled = blocked;
    send.disabled = blocked;
    send.textContent = busy ? 'Working…' : 'Send';
    examples.forEach(button => { button.disabled = blocked; });
    form.setAttribute('aria-busy', String(busy));
    if (pending) {
      pending.apply.disabled = busy;
      pending.discard.disabled = busy;
    }
  }

  async function post(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload), signal: controller.signal
      });
      let result;
      try { result = await response.json(); }
      catch (_) { throw Error('The local service returned an unreadable response.'); }
      if (!response.ok) throw Error(typeof result.error === 'string' ? result.error : 'The local service could not complete this request.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('The local service took too long to respond.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function validProposal(proposal) {
    return proposal && typeof proposal.id === 'string' && proposal.id.length > 0 &&
      Array.isArray(proposal.changes) && proposal.changes.length > 0 &&
      proposal.changes.every(change => change &&
        ['name', 'action', 'before', 'after'].every(key => typeof change[key] === 'string'));
  }

  async function refreshStock() {
    // Use existing application loaders when available, without inventing records.
    if (typeof loadStock === 'function') await loadStock();
    if (typeof renderStock === 'function') renderStock();
    document.dispatchEvent(new CustomEvent('galleyquest:stock-changed', {detail: {source: 'local-assistant'}}));
  }

  function showProposal(proposal) {
    const card = document.createElement('section');
    card.className = 'gqa-proposal';
    card.setAttribute('aria-label', 'Review proposed stock changes');
    const heading = document.createElement('h3');
    heading.textContent = 'Review stock changes';
    const help = document.createElement('p');
    help.textContent = 'Nothing has been applied. Check each amount before continuing.';
    card.append(heading, help);
    for (const change of proposal.changes) {
      const row = document.createElement('div');
      row.className = 'gqa-change';
      const name = document.createElement('strong');
      name.textContent = change.name;
      const action = document.createElement('span');
      action.className = 'gqa-change-action';
      action.textContent = change.action;
      const before = document.createElement('p');
      before.textContent = 'Before: ' + change.before;
      const after = document.createElement('p');
      after.textContent = 'After: ' + change.after;
      row.append(name, action, before, after);
      card.append(row);
    }
    const actions = document.createElement('div');
    actions.className = 'gqa-proposal-actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'gqa-apply';
    apply.textContent = 'Apply stock changes';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.textContent = 'Discard';
    actions.append(apply, discard);
    card.append(actions);
    conversation.append(card);
    const current = {id: proposal.id, card, apply, discard, actions};
    pending = current;
    status.textContent = 'Apply or discard this proposal before sending another message.';
    apply.addEventListener('click', async () => {
      if (busy || pending !== current) return;
      busy = true;
      controls();
      setError();
      status.textContent = 'Applying the reviewed stock changes…';
      try {
        const result = await post('/api/v1/chat/apply', {proposal_id: current.id});
        if (result.applied !== true || !Array.isArray(result.items)) throw Error('The service did not confirm that stock changes were applied.');
        pending = null;
        current.actions.replaceChildren();
        const done = document.createElement('p');
        done.className = 'gqa-proposal-result';
        done.textContent = 'Applied';
        current.actions.append(done);
        const names = result.items.map(item => item && typeof item.name === 'string' ? item.name : '').filter(Boolean);
        bubble('assistant', names.length ? 'Stock changes saved: ' + names.join(', ') + '.' : 'The reviewed stock changes were saved.');
        try {
          await refreshStock();
          status.textContent = 'Stock changes saved and inventory refreshed.';
        } catch (_) {
          status.textContent = 'Stock changes saved.';
          setError('The changes were saved, but the inventory view could not refresh. Reload the page to view the saved values.');
        }
      } catch (error) {
        status.textContent = 'Your reviewed proposal is retained.';
        setError(error.message + ' Retry Apply stock changes to confirm this same proposal.');
      } finally {
        busy = false;
        controls();
        scrollToLatest();
        if (!panel.hidden) (pending ? current.apply : input).focus();
      }
    });
    discard.addEventListener('click', () => {
      if (busy || pending !== current) return;
      pending = null;
      current.actions.replaceChildren();
      const discarded = document.createElement('p');
      discarded.className = 'gqa-proposal-result';
      discarded.textContent = 'Discarded. No changes applied.';
      current.actions.append(discarded);
      setError();
      status.textContent = 'Proposal discarded. You can send another message.';
      controls();
      input.focus();
    });
    scrollToLatest();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (busy || pending || !message) return;
    busy = true;
    controls();
    setError();
    status.textContent = 'The local model is thinking. Your message is retained until it replies.';
    try {
      const result = await post('/api/v1/chat', {message, history: history.slice(-8)});
      if (typeof result.reply !== 'string') throw Error('The local model did not return a readable reply.');
      if (result.proposal !== null && result.proposal !== undefined && !validProposal(result.proposal)) throw Error('The service returned a proposal that cannot be safely reviewed. No changes were applied.');
      bubble('user', message);
      bubble('assistant', result.reply);
      history.push({role: 'user', content: message}, {role: 'assistant', content: result.reply});
      history = history.slice(-8);
      input.value = '';
      get('.gqa-examples').hidden = true;
      if (Array.isArray(result.warnings)) {
        for (const warning of result.warnings) {
          if (typeof warning === 'string' && warning) {
            const notice = bubble('assistant', warning);
            notice.classList.add('gqa-warning');
          }
        }
      }
      status.textContent = typeof result.model === 'string' && result.model ? 'Reply from local model: ' + result.model : 'Local reply received.';
      if (result.proposal) showProposal(result.proposal);
    } catch (error) {
      status.textContent = 'Your message is retained. No stock changes were applied by this request.';
      setError(error.message + ' You can retry Send.');
    } finally {
      busy = false;
      controls();
      if (!panel.hidden) (pending ? pending.apply : input).focus();
    }
  });

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }
  launcher.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    scrollToLatest();
    (busy ? get('.gqa-close') : pending ? pending.apply : input).focus();
  });
  get('.gqa-close').addEventListener('click', close);
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(); }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  examples.forEach(button => button.addEventListener('click', () => {
    if (busy || pending) return;
    input.value = button.textContent;
    input.focus();
  }));
  bubble('assistant', 'How can I assist?');
})();
