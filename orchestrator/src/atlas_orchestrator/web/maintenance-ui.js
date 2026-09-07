"use strict";
(() => {
  let inFlight = null;
  let snapshot = null;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const labels = {overdue:"Overdue",due_soon:"Due within 30 days",scheduled:"Scheduled",completed:"Completed"};
  const record = item => `<article class="maintenance-record" data-state="${escape(item.state)}"><div><strong>${escape(item.equipment)} · ${escape(item.task)}</strong><span>${labels[item.state] || "Scheduled"} · ${escape(item.due_date)}</span>${item.notes ? `<p>${escape(item.notes)}</p>` : ""}${item.completed_at ? `<small>Completed ${escape(item.completed_at.slice(0,10))}</small>` : ""}</div>${item.completed_at ? "" : `<button class="text-button" type="button" data-maintenance-complete="${escape(item.id)}">Mark Complete</button>`}</article>`;
  async function request(path, body) {
    const response = await fetch(path, {method:body?"POST":"GET",headers:{Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "Service records are unavailable");
      error.rejected = response.status >= 400 && response.status < 500;
      throw error;
    }
    return data;
  }
  function load(force = false) {
    if (inFlight) return force === true ? inFlight.then(() => load()) : inFlight;
    inFlight = readRecords().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function readRecords() {
    const status=document.getElementById("maintenance-status");
    try {
      const data=await request("/v1/maintenance");
      if (!Array.isArray(data.records) || data.status!=="healthy") throw new Error("Service records are unavailable");
      snapshot=data;
      document.getElementById("maintenance-summary").innerHTML=[["Overdue",data.summary.overdue],["Due Soon",data.summary.due_soon],["Completed",data.summary.completed]].map(([title,value])=>`<article class="metric-card"><span>${title}</span><strong>${escape(value)}</strong><small>${title==="Due Soon"?"Next 30 days":"Recorded tasks"}</small></article>`).join("");
      document.getElementById("maintenance-records").innerHTML=data.records.filter(item=>!item.completed_at).map(record).join("") || '<p class="empty-state">No scheduled tasks. Add a service task using a known date or manufacturer recommendation.</p>';
      document.getElementById("maintenance-completed").innerHTML=data.records.filter(item=>item.completed_at).sort((a,b)=>b.completed_at.localeCompare(a.completed_at)).map(record).join("") || '<p class="empty-state">No completed service recorded.</p>';
      status.textContent="";
    } catch (error) {
      snapshot=null;
      status.textContent=`Unable to refresh records. ${error.message}. Previously displayed records may be outdated.`;
    }
  }
  document.getElementById("maintenance-refresh").addEventListener("click",load);
  document.getElementById("maintenance-form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('button[type="submit"]'), status=document.getElementById("maintenance-form-status");
    if(button.disabled)return;
    button.disabled=true;
    try {await request("/v1/maintenance",Object.fromEntries(new FormData(form)));form.reset();status.textContent="Task saved.";await load(true);}
    catch(error){status.textContent=error.rejected ? `Task rejected. ${error.message}` : `Save could not be confirmed. Refresh and check the schedule before retrying. ${error.message}`;}
    finally{button.disabled=false;}
  });
  document.getElementById("maintenance-records").addEventListener("click",async event=>{
    const button=event.target.closest("[data-maintenance-complete]");
    if(!button||button.disabled)return;
    button.disabled=true;
    try{await request("/v1/maintenance/complete",{id:button.dataset.maintenanceComplete});await load(true);}
    catch(error){document.getElementById("maintenance-status").textContent=`Completion could not be confirmed. Refresh to check the record. ${error.message}`;button.disabled=false;}
  });
  window.AtlasMaintenance={load,get snapshot(){return snapshot;}};
})();
