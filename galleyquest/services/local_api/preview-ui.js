/* Preview-only integration. The live index.html and its handlers stay untouched. */
(() => {
  'use strict';
  let edit = null;
  let busy = false;
  const originalAdd = addIngRow;
  addIngRow = function (ingredient) {
    originalAdd(ingredient);
    document.querySelector('#ing-rows .ing-row:last-child').dataset.ingredientId = ingredient?.id || '';
  };
  const originalOpen = openRecipeModal;
  openRecipeModal = function (recipe) {
    if (busy) return;
    edit = {recipeId:recipe?.id || crypto.randomUUID(), expectedRecipe:recipe?._revision ?? null,
      expectedIngredients:Object.fromEntries((recipe?.ingredients || []).map(i=>[i.id,i._revision])),
      fingerprint:null, requestId:null};
    originalOpen(recipe);
    document.getElementById('local-recipe-error').textContent = '';
  };
  const saveButton = document.getElementById('recipe-modal-save');
  const errorBox = document.createElement('p');
  errorBox.id = 'local-recipe-error'; errorBox.setAttribute('role','alert');
  errorBox.style.color = '#9f1239';
  saveButton.parentElement.before(errorBox);
  saveButton.addEventListener('click', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (busy || !edit) return;
    const value = id => document.getElementById(id).value;
    const cuisine = value('f-recipe-cuisine');
    const body = value('f-recipe-notes').split('\n').filter(l=>!/^\s*Cuisine\s*:/i.test(l)).join('\n').trim();
    const recipe = {name:value('f-recipe-name').trim(),theme:value('f-recipe-theme') || null,
      instructions:value('f-recipe-instructions').trim() || null,
      notes:((cuisine?'Cuisine: '+cuisine+'\n':'')+body).trim() || null};
    if (!recipe.name) { errorBox.textContent='Name is required.'; return; }
    const ingredients = [...document.querySelectorAll('#ing-rows .ing-row')].map(row=>({
      id:row.dataset.ingredientId || null,
      ingredient_name:row.querySelector('.ing-name').value.trim(),
      quantity:row.querySelector('.ing-qty').value.trim() || null,
      stock_item_id:row.querySelector('.ing-stock').value || null
    })).filter(i=>i.ingredient_name);
    const payload = {recipe_id:edit.recipeId,recipe,ingredients,
      expected_recipe:edit.expectedRecipe,expected_ingredients:edit.expectedIngredients};
    const fingerprint = JSON.stringify(payload);
    if (fingerprint!==edit.fingerprint) {
      edit.fingerprint=fingerprint; edit.requestId=crypto.randomUUID();
    }
    payload.request_id=edit.requestId;
    busy=true; saveButton.disabled=true; saveButton.textContent='Saving…'; errorBox.textContent='';
    try {
      const response=await fetch('/api/v1/commands/save-recipe',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
      const result=await response.json();
      if (!response.ok) throw Error(result.error || 'Save failed');
      closeModal('recipe-modal');
      await loadRecipes();
      setStatus('recipe-status','Saved recipe and ingredients together.');
    } catch(error) {
      errorBox.textContent=error.message+' Your form is retained. If the response was lost, retry unchanged to avoid duplication.';
    } finally { busy=false; saveButton.disabled=false; saveButton.textContent='Save'; }
  },true);
  // Keep the active editor stable until the single command settles.
  document.getElementById('recipe-modal-cancel').addEventListener('click',event=>{
    if(busy) { event.preventDefault(); event.stopImmediatePropagation(); }
  },true);

  const showOriginal = showAIHandoff;
  showAIHandoff = async function (_prompt,kind,statusId) {
    const prompt = 'GALLEYQUEST LOCAL PREVIEW: TEST ONLY.\n'+
      'This is a '+(kind==='train'?'training-panel':kind==='restock'?'pickup-panel':'shopping-panel')+' acceptance check, not a live workflow.\n'+
      'The isolated preview is '+location.origin+'/ and is accessible only on this computer.\n'+
      'Do not open production Atlas, retailer carts, or order history. Do not place orders, reserve pickup times, reconcile receipts, change stock, or install or update saved skills.\n'+
      'No shopping or reconciliation skill is invoked. Discuss the preview interface only; request separate authorization for any real workflow.';
    if (!await showOriginal(prompt,kind,statusId)) return false;
    document.getElementById('ai-handoff-title').textContent='PREVIEW ONLY: '+(kind==='train'?'Train AI':kind==='restock'?'After Pickup':'Shop with AI');
    document.getElementById('ai-handoff-help').textContent='Test-only copy. Assistant launch shortcuts are disabled in this preview.';
    document.querySelector('#claude-command-box p').textContent='This preview does not launch an assistant or prepare a real order. Copy only verifies the test instructions.';
    setStatus('ai-handoff-status','Preview copy only. No live action is authorized.');
    setStatus(statusId,'Test-only handoff ready. No live action is authorized.');
    return true;
  };
  for (const id of ['ai-use-claude','ai-use-chatgpt']) {
    const link=document.getElementById(id);
    link.removeAttribute('href'); link.removeAttribute('target');
    link.setAttribute('aria-disabled','true'); link.style.opacity='.45';
    link.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();},true);
  }
  window.copyAIHandoff=()=> {
    if (!canCopyAIHandoff()) {
      setStatus('ai-handoff-status','No verified test handoff is ready. Reopen to retry.',true);
      return Promise.resolve(false);
    }
    return copyText(document.getElementById('claude-command-text').value).then(
    ()=>setStatus('ai-handoff-status','Copied test-only instructions. No live action is authorized.'),
    ()=>setStatus('ai-handoff-status','Copy unavailable. Select the test instructions manually.',true)
    );
  };
})();
