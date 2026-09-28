/* Local reviewed snapshot. Calendar writes remain in Google, never browser memory. */
(() => {
  const zone = "America/Chicago";
  const todayKey = () => new Intl.DateTimeFormat("en-CA", {timeZone: zone, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
  const dayKey = value => new Intl.DateTimeFormat("en-CA", {timeZone:zone, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date(value));
  const el = (tag, text, cls) => Object.assign(document.createElement(tag), {textContent: text || "", className: cls || ""});
  let month = todayKey().slice(0, 7), selected = null, payload = null, loading = false;
  function render() {
    const [year, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const weekday = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
    const events = (payload?.events || []).filter(e => e.status !== "canceled");
    const onDay = day => events.filter(e => dayKey(e.start) <= day && dayKey(new Date(new Date(e.end).getTime() - 1)) >= day);
    document.getElementById("calendar-month").textContent = new Date(Date.UTC(year, m - 1, 15)).toLocaleDateString("en-US", {timeZone:"UTC", month:"long", year:"numeric"});
    const grid = document.getElementById("calendar-grid");
    grid.replaceChildren(...["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>el("span",d,"calendar-weekday")));
    for(let n=0;n<weekday;n++) grid.append(el("span", "", "calendar-blank"));
    for(let d=1;d<=days;d++) {
      const key = `${month}-${String(d).padStart(2,"0")}`, items = onDay(key);
      const b = el("button", "", `calendar-day${key===todayKey()?" is-today":""}${key===selected?" is-selected":""}`);
      b.type="button"; b.setAttribute("aria-label", `${key}, ${items.length} event${items.length===1?"":"s"}`);
      b.setAttribute("aria-pressed", String(selected===key));
      b.append(el("strong",String(d)),el("small",items.length?`${items.length} event${items.length===1?"":"s"}`:""));
      b.addEventListener("click",()=>{selected=selected===key?null:key;render();}); grid.append(b);
    }
    document.getElementById("calendar-agenda-title").textContent = selected ? `Schedule: ${selected}` : "Month Agenda";
    const list = selected ? onDay(selected) : events.filter(e=>dayKey(e.start).slice(0,7)<=month && dayKey(new Date(new Date(e.end).getTime()-1)).slice(0,7)>=month);
    const agenda = document.getElementById("calendar-agenda");
    agenda.replaceChildren(...list.map(e=>{
      const card=el("article","","calendar-event");
      const reference = /^Date reference/i.test(e.note);
      const time = reference
        ? `${new Date(e.start).toLocaleDateString("en-US",{timeZone:zone,month:"short",day:"numeric"})} · Date Reference, Not An Appointment Time`
        : new Date(e.start).toLocaleString("en-US",{timeZone:zone,month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
      card.append(el("h3",e.title),el("p",time),el("p",e.location),el("p",e.note,"independence-note"));
      if(e.url) {const a=el("a","Open In Google Calendar");a.href=e.url;a.target="_blank";a.rel="noopener";card.append(a);} return card;
    }));
    if(!list.length) agenda.append(el("p","No entries in this saved view. This is not confirmation that the source calendar is empty.","empty-state"));
  }
  async function load() {
    if(loading) return; loading=true;
    const status=document.getElementById("calendar-source-status");
    try {
      const response=await fetch("/v1/calendar",{cache:"no-store"});
      if(!response.ok) throw new Error(); payload=await response.json();
      status.textContent=payload.status==="snapshot" ? `Saved ${new Date(payload.reviewed_at).toLocaleString("en-US",{timeZone:zone,timeZoneName:"short"})}. ${payload.stale?"Needs Refresh. ":""}Coverage: ${payload.coverage_start} to ${payload.coverage_end}. Times shown in Central Time. ${payload.detail}` : payload.detail;
      render();
    } catch {status.textContent="Calendar unavailable. Check Google Calendar; no all-clear is implied.";} finally {loading=false;}
  }
  document.getElementById("calendar-previous").addEventListener("click",()=>move(-1));
  document.getElementById("calendar-next").addEventListener("click",()=>move(1));
  function move(delta) { const [y,m]=month.split("-").map(Number);month=new Date(Date.UTC(y,m-1+delta,15)).toISOString().slice(0,7);selected=null;render(); }
  document.getElementById("calendar-today").addEventListener("click",()=>{month=todayKey().slice(0,7);selected=todayKey();render();});
  window.AtlasCalendar={load};
})();
