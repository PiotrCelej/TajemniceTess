const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const sessionLabels = { planned: "Planowana", active: "W toku", done: "Zakończona" };
const threadLabels = { open: "Otwarty", active: "W toku", closed: "Zamknięty" };
const sceneLabels = { pending: "Do rozegrania", done: "Ukończona", skipped: "Pominięta" };
const defaultCurrent = "S2-EL";

let entries = {};
let state;
let loaded = false;
const summaryHash = "#podsumowanie";
let view = location.hash === summaryHash ? "summary" : "progress";
let selected = defaultCurrent;
let planSession = "2";
let sessions = initialSessions;
let threads = initialThreads;
let allScenes = sessions.flatMap(session => session.scenes);
let player = false;
let redrawOnBlur = false;
let legacyProgress = readLegacy();

const navs = [
  ["progress", "◉", "Postęp kampanii"],
  ["summary", "▤", "Podsumowanie"],
  ["plan", "◈", "Plan sesji"],
  ["locations", "⌖", "Lokacje"],
  ["npcs", "♙", "Postacie"],
  ["puzzles", "◇", "Zagadki"],
  ["monsters", "⚔", "Bestiariusz"],
  ["notes", "▤", "Notatki prowadzącego"]
];

function sceneStatus(id) {
  return entries["scene:" + id] ?? (id === "EL" ? "done" : "pending");
}

function sessionStatus(session) {
  return entries["session:" + session.id] ?? session.status;
}

function threadStatus(thread) {
  return entries["thread:" + thread.id] ?? thread.status;
}

function updateState(nextEntries) {
  entries = nextEntries;
  const customSessions = Object.entries(entries).filter(([key, value]) => key.startsWith("session-meta:") && value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, title]) => ({ id: key.slice(13), title, status: "planned", scenes: [] }));
  const customScenes = Object.entries(entries).filter(([key, value]) => key.startsWith("scene-meta:") && value)
    .sort(([a], [b]) => a.localeCompare(b));
  sessions = [...initialSessions, ...customSessions].map(session => ({
    ...session,
    scenes: [...session.scenes, ...customScenes.filter(([, scene]) => scene.session === session.id)
      .map(([key, scene]) => ({
        id: key.slice(11), title: scene.title, place: scene.place || "Lokacja do ustalenia",
        act: "Sceny dodane", time: "", tags: "", custom: true, steps: [], tests: []
      }))]
  }));
  threads = [...initialThreads, ...Object.entries(entries).filter(([key, value]) => key.startsWith("thread-meta:") && value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, thread]) => ({ ...thread, id: key.slice(12), status: "open" }))];
  allScenes = sessions.flatMap(session => session.scenes);
  state = {
    current: allScenes.some(scene => scene.id === entries.current) ? entries.current : defaultCurrent,
    done: allScenes.filter(scene => sceneStatus(scene.id) === "done").map(scene => scene.id),
    skipped: allScenes.filter(scene => sceneStatus(scene.id) === "skipped").map(scene => scene.id),
    notes: Object.fromEntries(Object.entries(entries).filter(([key]) => key.startsWith("note:"))
      .map(([key, value]) => [key.slice(5), value])),
    hp: [entries["hp:0"] ?? 6, entries["hp:1"] ?? 6],
    solved: puzzles.filter(puzzle => entries["puzzle:" + puzzle.id]).map(puzzle => puzzle.id)
  };
}

const sync = createProgressStore({
  onData(nextEntries) {
    updateState(nextEntries);
    if (!loaded) {
      selected = state.current;
      planSession = sessionFor(selected).id;
    }
    loaded = true;
    $("#export").disabled = false;
    $("#import-button").disabled = false;
    $("#mode").disabled = false;
    if ($("#main").contains(document.activeElement) && document.activeElement.matches("textarea, input, select")) {
      redrawOnBlur = true;
    } else {
      render();
    }
  },
  onStatus(message, retry) {
    $("#saveinfo").textContent = message;
    $("#retry").hidden = !retry;
    $(".sync-state").classList.toggle("sync-error", retry);
    if (!loaded && retry) $("#main").innerHTML = '<div class="panel empty">Nie udało się wczytać kampanii. <button data-retry>Spróbuj ponownie</button></div>';
  }
});

function save(changes, delay = 0) {
  updateState({ ...entries, ...changes });
  sync.stage(changes, delay);
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  toastTimer = setTimeout(() => $("#toast").style.display = "none", 4500);
}

function sessionFor(id) {
  return sessions.find(session => session.scenes.some(scene => scene.id === id)) ?? sessions[1];
}

function sessionNumber(session) {
  return String(sessions.indexOf(session) + 1).padStart(2, "0");
}

function addForm(kind, label, inputLabel, extra = "") {
  return '<details class="add-item"><summary>' + label + '</summary><form data-add="' + kind +
    '"><label>' + inputLabel + '<input name="title" maxlength="100" required></label>' + extra +
    '<button class="primary" type="submit">' + label + '</button></form></details>';
}

function go(nextView, id) {
  view = nextView;
  if (nextView === "summary" && location.hash !== summaryHash) {
    history.replaceState(null, "", summaryHash);
  } else if (nextView !== "summary" && location.hash === summaryHash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (id) selected = id;
  $("#search").value = "";
  $("#results").hidden = true;
  render();
  window.scrollTo(0, 0);
}

function openScene(id) {
  if (player && id !== state.current) return;
  if (id !== state.current) save({ current: id });
  planSession = sessionFor(id).id;
  go("scene", id);
}

function finish(id) {
  save({ ["scene:" + id]: sceneStatus(id) === "done" ? "pending" : "done" });
  render();
}

function statusSelect(attribute, id, label, labels, current) {
  return '<select ' + attribute + '="' + id + '" aria-label="' + esc(label) + '">' +
    Object.entries(labels).map(([key, text]) =>
      '<option value="' + key + '"' + (key === current ? " selected" : "") + '>' + text + '</option>'
    ).join("") + '</select>';
}

function progressBar(done, total) {
  return '<progress value="' + done + '" max="' + total + '" aria-label="Ukończone sceny"></progress>';
}

function noteField(key, label, placeholder) {
  return '<textarea data-note="' + key + '" aria-label="' + esc(label) +
    '" maxlength="8000" placeholder="' + esc(placeholder) + '">' + esc(state.notes[key] || "") + '</textarea>';
}

function renderProgress() {
  const current = allScenes.find(scene => scene.id === state.current);
  const currentSession = sessionFor(current.id);
  const closed = threads.filter(thread => threadStatus(thread) === "closed").length;
  const completed = sessions.filter(session => sessionStatus(session) === "done").length;
  const cards = sessions.map(session => {
    const done = session.scenes.filter(scene => sceneStatus(scene.id) === "done").length;
    const skipped = session.scenes.filter(scene => sceneStatus(scene.id) === "skipped").length;
    return '<article class="panel session-card"><div class="card-meta"><span class="eyebrow">Sesja ' +
      sessionNumber(session) + '</span>' +
      statusSelect("data-session-status", session.id, "Status sesji " + sessionNumber(session), sessionLabels, sessionStatus(session)) +
      '</div><h3>' + esc(session.title) + '</h3>' + progressBar(done, session.scenes.length) +
      '<p class="muted">' + done + ' z ' + session.scenes.length + ' scen oznaczonych jako ukończone' +
      (skipped ? ' · ' + skipped + ' pominiętych' : '') +
      '</p><button data-plan="' + session.id + '">Otwórz plan sesji →</button></article>';
  }).join("");

  const threadCards = threads.map(thread =>
    '<article class="thread-row"><div>' +
    (thread.place ? '<span class="eyebrow">' + esc(thread.place) + '</span>' : '') +
    '<h3>' + esc(thread.title) + '</h3>' + (thread.text ? '<p>' + esc(thread.text) + '</p>' : '') +
    (thread.scene ? '<button class="link" data-scene="' + thread.scene + '">Powiązana scena →</button>' : '') +
    '</div>' + statusSelect("data-thread-status", thread.id, "Status wątku: " + thread.title,
      threadLabels, threadStatus(thread)) + '</article>'
  ).join("");

  return '<section class="hero progress-hero"><div class="hero-art" aria-hidden="true"></div>' +
    '<span class="eyebrow">TAJEMNICE TESS · PIEŚŃ PODKORZENIA</span><h1>Rudna Brama</h1>' +
    '<p>Postęp przygody Kaela i Mossa.</p><div class="resume">' +
    '<div><small>BIEŻĄCA SCENA</small><strong>' + esc(current.title) + '</strong>' +
    '<span>Sesja ' + sessionNumber(currentSession) + ' · ' + esc(current.place) + '</span></div>' +
    '<button class="primary" data-scene="' + current.id + '">Wznów przygodę →</button></div></section>' +
    (legacyProgress ? '<section class="panel legacy"><div><h3>Masz zapis w tej przeglądarce</h3>' +
      '<p>Przenieś go do kampanii, żeby widzieć go także na innych urządzeniach. Pola już zapisane na serwerze zachowają swoją wartość.</p></div>' +
      '<button id="migrate-local" class="primary">Przenieś zapis</button></section>' : '') +
    '<div class="stats overview-stats"><div class="stat"><b>' + completed + '/' + sessions.length + '</b><span>zakończone sesje</span></div>' +
    '<div class="stat"><b>' + (threads.length - closed) + '</b><span>wątki otwarte lub w toku</span></div>' +
    '<div class="stat"><b>3</b><span>poziom drużyny po sesji 01</span></div></div>' +
    '<div class="dashboard-grid"><div><section aria-labelledby="session-heading"><div class="section-head">' +
    '<h2 id="session-heading">Sesje</h2></div><div class="grid session-grid">' + cards +
    '</div>' + addForm("session", "Dodaj sesję", "Tytuł sesji") + '</section><section class="panel threads"><div class="section-head"><h2>Wątki kampanii</h2></div>' +
    threadCards + addForm("thread", "Dodaj wątek", "Nazwa wątku", '<label>Opis <textarea name="text" maxlength="400"></textarea></label>') + '</section></div><div><section class="panel recap"><span class="eyebrow">STAN PO SESJI 01</span>' +
    '<h2>Podsumowanie kampanii</h2><ul>' +
    campaignSummary.highlights.map(item => '<li>' + esc(item) + '</li>').join("") +
    '</ul><button data-nav="summary">Otwórz pełne podsumowanie →</button></section>' +
    '<section class="panel"><h2>Kronika kampanii</h2>' +
    noteField("global", "Kronika kampanii", "Decyzje drużyny, konsekwencje i sprawy do zapamiętania…") +
    '</section></div></div>';
}

function renderCampaignSummary() {
  const sections = campaignSummary.sections;
  const index = sections.map(section =>
    `<button data-summary-section="${section.id}">${esc(section.title)}</button>`
  ).join("");

  const cards = sections.map(section => {
    const entries = section.entries.map(([heading, description]) =>
      `<dt>${esc(heading)}</dt><dd>${esc(description)}</dd>`
    ).join("");
    const sceneLinks = (section.scenes || []).map(([id, label]) =>
      `<button data-reference-scene="${id}">${esc(label)} →</button>`
    );
    const navLinks = (section.nav || []).map(([id, label]) =>
      `<button data-nav="${id}">${esc(label)} →</button>`
    );
    const links = sceneLinks.concat(navLinks);
    return `<section class="panel summary-section" id="summary-${section.id}" aria-labelledby="heading-${section.id}" tabindex="-1">
      <h2 id="heading-${section.id}">${esc(section.title)}</h2>
      <dl>${entries}</dl>
      ${links.length ? '<div class="summary-links">' + links.join("") + '</div>' : ""}
    </section>`;
  }).join("");

  const materials = campaignSummary.materials.map(([label, id]) =>
    `<li><a href="https://chatgpt.com/library?file_id=${id}&amp;account_id=personal" target="_blank" rel="noopener">${esc(label)}</a></li>`
  ).join("");

  return title("TAJEMNICE TESS · DLA PROWADZĄCEGO", "Podsumowanie kampanii",
    "Stan po pierwszej sesji, plan drugiej i ustalenia do prowadzenia.") +
    `<div class="summary-index" role="group" aria-label="Przejdź do części podsumowania">${index}</div>
    <div class="summary-grid">${cards}</div>
    <section class="panel summary-materials"><h2>Materiały kampanii</h2>
      <p class="muted">Karty, mapy i charakterystyki do otwarcia w osobnej karcie.</p>
      <ul>${materials}</ul>
    </section>`;
}

function renderPlan() {
  const session = sessions.find(item => item.id === planSession) ?? sessionFor(state.current);
  planSession = session.id;
  const list = session.scenes;
  const done = list.filter(scene => sceneStatus(scene.id) === "done").length;
  const skipped = list.filter(scene => sceneStatus(scene.id) === "skipped").length;
  return title("TAJEMNICE TESS", "Plan sesji") + '<div class="tabs session-tabs">' +
    sessions.map(item => '<button data-plan="' + item.id + '" aria-pressed="' + (item.id === session.id) +
      '">Sesja ' + sessionNumber(item) + ' · ' + esc(item.title) + '</button>').join("") +
    '</div><div class="layout"><section class="panel"><div class="section-head"><h2>' + esc(session.title) +
    '</h2></div>' + (session.id === "2" ? '<p class="muted">Roboczy plan drugiej sesji. Kolejność scen dopasuj do decyzji graczy.</p>' :
      session.id === "1" ? '<p class="muted">Plan pierwszej sesji. Oznaczenia scen można uzupełnić po rozegraniu.</p>' : '') +
    list.map((scene, i) => (i === 0 || list[i - 1].act !== scene.act ?
      '<p class="eyebrow">' + scene.act + '</p>' : '') + row(scene, i)).join("") +
    (list.length ? '' : '<p class="muted">Dodaj pierwszą scenę tej sesji.</p>') +
    addForm("scene", "Dodaj scenę", "Tytuł sceny", '<label>Lokacja <input name="place" maxlength="100"></label>') +
    '</section><div class="side"><section class="panel"><h3>Postęp sesji</h3>' +
    statusSelect("data-session-status", session.id, "Status sesji " + sessionNumber(session), sessionLabels, sessionStatus(session)) +
    progressBar(done, list.length) + '<p class="muted">' + done + ' ukończonych · ' + skipped +
    ' pominiętych</p></section><section class="panel"><h3>Notatki z sesji</h3>' +
    noteField("session-" + session.id, "Notatki z sesji " + sessionNumber(session), "Przebieg, decyzje i przygotowania…") +
    '</section></div></div>';
}

function title(k,t,d=''){return `<div class="eyebrow">${k}</div><h1>${t}</h1>${d?`<p class="muted">${d}</p>`:''}`}
function row(s,i){return `<div class="scene-row ${s.id===state.current?'current':''}">${!player?`<input class="check" type="checkbox" aria-label="Ukończono: ${esc(s.title)}" data-done="${s.id}" ${state.done.includes(s.id)?'checked':''}>`:''}<button data-scene="${s.id}"><span class="number">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(s.title)}</strong><small>${esc(s.place)} ${s.optional?'· opcjonalnie':''}</small></div><span class="row-arrow">${state.skipped.includes(s.id)?'Pominięta':s.time} →</span></button></div>`}
function puzzle(p){return `<article class="panel ${!player?'secret':''}"><span class="eyebrow">${p.id} · POMIESZCZENIE ${p.scene}</span><h3>${p.title}</h3><p>${p.visible}</p>${!player?`<details><summary>Rozwiązanie i działanie mechanizmu</summary><p>${p.solution}</p><p class="muted">${p.alternatives}</p></details><details><summary>Podpowiedzi dla graczy</summary><ol>${p.hints.map(h=>`<li>${h}</li>`).join('')}</ol></details><div class="actions"><button data-solved="${p.id}">${state.solved.includes(p.id)?'✓ Rozwiązana':'Oznacz jako rozwiązaną'}</button><button data-scene="${p.scene}">Przejdź do sceny →</button></div>`:''}</article>`}
function render(){
document.body.classList.toggle("player",player);
$('#nav').innerHTML=navs.filter(n=>!player||['plan','locations'].includes(n[0])).map(n=>`<button data-nav="${n[0]}" class="${view===n[0]||view==='scene'&&n[0]==='plan'?'active':''}">${n[1]} &nbsp; ${n[2]}</button>`).join('');
$('#mode').textContent=player?'Wróć do MG':'Widok graczy';$('#search').disabled=player;$('#search').placeholder=player?'Wyszukiwanie ukryte w widoku graczy':'Szukaj NPC, lokacji, zagadki…';
let html='';const s=allScenes.find(s=>s.id===selected)||allScenes[0];
if(player && !['plan','scene','locations'].includes(view))view='scene';
if (view === "progress") html = renderProgress();
if (view === "summary") html = renderCampaignSummary();
if (view === "plan") {
  html = player ? title("TAJEMNICE TESS", "Rudna Brama", "Pieśń Podkorzenia") +
    `<div class="panel"><h2>${esc(s.title)}</h2><p>${s.desc||''}</p><button class="primary" data-scene="${s.id}">Otwórz aktualną scenę →</button></div>` : renderPlan();
}
if(view==='scene'){const session=sessionFor(s.id), list=session.scenes, i=list.indexOf(s);html=title(`SESJA ${sessionNumber(session)} · SCENA ${String(i+1).padStart(2,'0')} / ${list.length} · ${esc(s.place)}`,esc(s.title))+(!player?`<div class="chips">${s.time?`<span class="chip">${s.time}</span>`:""}<span class="chip">${s.optional?'Opcjonalna':'Główna ścieżka'}</span><span class="chip">${sceneLabels[sceneStatus(s.id)]}</span></div>`:'')+`<div class="actions" ${player?"hidden":""}><button data-plan="${session.id}">Do planu sesji</button><button data-scene="${list[Math.max(0,i-1)].id}" ${i===0?'disabled':''}>← Poprzednia</button><button data-scene="${list[Math.min(list.length-1,i+1)].id}" ${i===list.length-1?'disabled':''}>Następna →</button>${!player?`<button class="primary" data-finish="${s.id}">${state.done.includes(s.id)?'↺ Oznacz jako nieukończoną':'✓ Ukończ scenę'}</button>${(s.optional||session.id!=="1")?`<button data-skip="${s.id}">${state.skipped.includes(s.id)?'Przywróć scenę':'Pomiń scenę'}</button>`:''}`:''}</div>${s.desc?`<div class="panel"><span class="eyebrow">LOKACJA</span><p>${s.desc}</p></div>`:""}${s.text?`<div class="panel"><span class="eyebrow">DO PRZECZYTANIA NA GŁOS</span>${s.newText&&!player?'<small>Nowa propozycja tekstu na podstawie ustaleń</small>':''}<blockquote class="quote">${s.text}</blockquote></div>`:""}`;
if(!player)html+= (s.custom ? "" : `<div class="grid"><section class="panel secret"><span class="secret-label">TYLKO DLA MG</span><h3>Poprowadź scenę</h3><ol>${s.steps.map(t=>`<li>${t}</li>`).join('')}</ol></section><section class="panel secret"><span class="secret-label">TYLKO DLA MG</span><h3>Testy dla graczy</h3>${s.tests.length?s.tests.map(t=>`<div class="test"><span class="dc">ST ${t[1]}</span><b>${t[0]}</b><p>${t[2]}</p></div>`).join(''):'<p class="muted">Brak obowiązkowych testów. Podaj kluczowe informacje przez działanie i rozmowę.</p>'}</section></div><div class="panel secret" style="margin-top:20px"><span class="secret-label">NACISK NARRACYJNY</span><p>${s.note}</p></div>`) + `${s.puzzle?puzzle(puzzles.find(p=>p.id===s.puzzle)):''}${s.id==='05'?'<button data-nav="monsters">⚔ Otwórz statystyki i licznik PŻ</button>':''}<div class="panel"><h3>Notatki z tej sceny</h3>${noteField(s.id, "Notatki z tej sceny", "Decyzje graczy, odkryte tropy, konsekwencje…")}</div>`;
}
if(view==='locations')html=title('ATLAS KAMPANII','Lokacje','Szybki powrót do powiązanej sceny.')+(player?`<div class="panel"><h3>${esc(s.place)}</h3><p>${s.desc||""}</p></div>`:`<h2>Podziemia</h2><div class="grid">${scenes.filter(x=>x.act==='Podziemia').map(x=>`<article class="panel"><span class="eyebrow">${x.place}</span><h3>${x.title}</h3><p class="muted">${x.desc}</p><button data-scene="${x.id}">Otwórz scenę →</button></article>`).join('')}</div><h2 style="margin-top:30px">Miasteczko</h2><div class="grid">${town.map(t=>`<article class="panel"><h3>${t[0]}</h3><p class="muted">${t[1]}</p><button data-scene="${t[2]}">Powiązana scena →</button></article>`).join('')}</div>`);
if(view==='npcs')html=title('OSOBY I POWIĄZANIA','Postacie kampanii','NPC, ich motywacje i miejsca spotkań.')+`<div class="grid">${npcs.map(n=>`<article class="panel secret"><span class="eyebrow">${n[2]}</span><h3>${n[0]}</h3><p>${n[1]}</p><p class="muted">${n[3]}</p><button data-scene="${n[4]}">Powiązana scena →</button></article>`).join('')}</div>`;
if(view==='puzzles')html=title('TRZY MECHANIZMY · JEDNA SIEĆ','Zagadki','Rozwiązania i podpowiedzi otwieraj wtedy, kiedy ich potrzebujesz.')+puzzles.map(puzzle).join('');
if(view==='monsters')html=title('SPOTKANIE OPCJONALNE · 05','Kryształowe Pełzacze','Dwie małe bestie. Parametry autorskiego spotkania z kart kampanii.')+`<div class="stats"><div class="stat"><b>12</b><span>klasa pancerza</span></div><div class="stat"><b>6</b><span>PŻ na osobnika</span></div><div class="stat"><b>+1</b><span>inicjatywa</span></div><div class="stat"><b>25</b><span>stóp szybkości</span></div></div><div class="grid"><article class="panel"><h3>Statystyki</h3><div class="ability">${[['STR','8 (−1)'],['DEX','12 (+1)'],['CON','10 (+0)'],['INT','2 (−4)'],['WIS','10 (+0)'],['CHA','4 (−3)']].map(x=>`<div><b>${x[0]}</b>${x[1]}</div>`).join('')}</div><p><b>Ugryzienie.</b> Atak wręcz +3, zasięg 5 stóp, jeden cel. Trafienie: 1k4 + 1 obrażeń kłutych. Jeden atak w turze.</p><p class="muted">Widzenie w ciemności 30 stóp · Pasywna Spostrzegawczość 10 · Rzuty obronne według cech.</p></article><article class="panel"><h3>Śledzenie spotkania</h3>${[0,1].map(i=>`<div class="hp"><label for="hp${i}">Pełzacz ${i?'B':'A'}</label><button data-hp="${i}" data-delta="-1" aria-label="Odejmij PŻ Pełzaczowi ${i?'B':'A'}">−</button><input id="hp${i}" type="number" min="0" max="6" value="${state.hp[i]}" data-hpinput="${i}"><button data-hp="${i}" data-delta="1" aria-label="Dodaj PŻ Pełzaczowi ${i?'B':'A'}">+</button><span>/ 6</span></div>`).join('')}<button id="reset-hp">Przywróć PŻ obu</button></article></div><div class="panel" style="margin-top:20px"><h3>Zachowanie i wycofanie</h3><ul><li>Najpierw ostrzeżenie: uniesione głowy i chrobot. Potem inicjatywa.</li><li>Podążają ku najbliższemu odsłoniętemu światłu; w ciemności bronią się przed napastnikiem.</li><li>Po zasłonięciu światła, jeśli nikt ich nie atakuje, wycofują się na swojej najbliższej turze.</li><li>Przy 2 PŻ lub mniej również wycofują się, jeśli mają drogę.</li><li>Nie ścigają poza progiem D i nie atakują nieprzytomnych postaci.</li></ul><button data-scene="05">Wróć do sceny 05 →</button></div>`;
if(view==='notes')html=title('ZA EKRANEM MISTRZA GRY','Nacisk narracyjny','Osobne wskazówki do prowadzenia i twoja kronika sesji.')+`<div class="panel secret"><h3>Aktualne ustalenia</h3><ul><li>Gramy według D&D 5e 2014. Nagłówek „2024” w starszym PDF jest nieaktualny.</li><li>Klapa jest w 06. Aktywacja przedmiotów w 07 wygasza iluzję; wcześniej można ją dostrzec testem ST 15.</li><li>Odczyt mapy to nie otwarcie pieczęci.</li><li>Wejście do pierwszego węzła znajduje się pod Szybem Północnym.</li><li>Sesja kończy się u Eliry. Plan zejścia i budowa artefaktu przygotowują kolejną sesję.</li></ul></div><div class="panel"><h3>Kronika kampanii</h3>${noteField("global", "Kronika kampanii", "Zapisz decyzje, konsekwencje i wątki na następne spotkanie…")}</div><div class="grid">${allScenes.filter(x=>x.note||state.notes[x.id]).map(x=>`<article class="panel"><span class="eyebrow">${esc(x.place)}</span><h3>${esc(x.title)}</h3><p>${x.note||""}</p>${state.notes[x.id]?`<p class="muted">Twoje notatki: ${esc(state.notes[x.id])}</p>`:''}<button data-scene="${x.id}">Do sceny →</button></article>`).join('')}</div><details class="panel"><summary>Podstawa materiału i uzupełnienia</summary><p>Karty „Tajemnice_Tess_Sesja_1_Karty_MG.pdf”, zestawienie NPC, mapa Rudnej Bramy oraz późniejsze ustalenia kampanii. Teksty narracyjne scen miejskich opracowano na potrzeby panelu. Brakujące progi testów miejskich pozostawiono do decyzji MG.</p><p>W 06 występuje rozbieżność: wcześniejszy opis mapy mówi o sześciu filarach, PDF o siedmiu kolumnach. Nie zmieniono ustalonej sekwencji tonów.</p><p>Widok graczy ukrywa informacje w interfejsie na wspólnym ekranie. Nie jest osobnym kontem ani zabezpieczeniem kodu strony.</p></details>`;
$('#main').innerHTML=(player?'<div class="player-banner">Widok graczy</div>':'')+html;
}
function backupDefaults() {
  return {
    current: defaultCurrent,
    "hp:0": 6,
    "hp:1": 6,
    "note:global": "",
    ...Object.fromEntries(allScenes.flatMap(scene => [
      ["scene:" + scene.id, scene.id === "EL" ? "done" : "pending"],
      ["note:" + scene.id, ""]
    ])),
    ...Object.fromEntries(sessions.flatMap(session => [
      ["session:" + session.id, session.status],
      ["note:session-" + session.id, ""]
    ])),
    ...Object.fromEntries(threads.map(thread => ["thread:" + thread.id, thread.status])),
    ...Object.fromEntries(puzzles.map(puzzle => ["puzzle:" + puzzle.id, false]))
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLegacy(old) {
  if (!isRecord(old) || !Array.isArray(old.done) || !Array.isArray(old.skipped) ||
      !Array.isArray(old.solved) || !isRecord(old.notes)) throw new Error();
  const result = {};
  if (scenes.some(scene => scene.id === old.current)) result.current = old.current;
  for (const scene of scenes) {
    if (old.done.includes(scene.id)) result["scene:" + scene.id] = "done";
    else if (old.skipped.includes(scene.id)) result["scene:" + scene.id] = "skipped";
  }
  for (const puzzle of puzzles) {
    if (old.solved.includes(puzzle.id)) result["puzzle:" + puzzle.id] = true;
  }
  for (const id of ["global", ...scenes.map(scene => scene.id)]) {
    if (typeof old.notes[id] === "string" && old.notes[id]) result["note:" + id] = old.notes[id].slice(0, 8000);
  }
  [0, 1].forEach(i => {
    const hp = old.hp?.[i];
    if (Number.isFinite(hp) && hp >= 0 && hp <= 6 && hp !== 6) result["hp:" + i] = Math.round(hp);
  });
  return result;
}

function readLegacy() {
  try {
    if (localStorage.getItem("rudna-v1-transferred")) return null;
    const existing = parseLegacy(JSON.parse(localStorage.getItem("rudna-v1") || "null"));
    return Object.keys(existing).length ? existing : null;
  } catch {
    return null;
  }
}

function parseBackup(data) {
  if (data?.format !== "rudna-brama-v2" || !isRecord(data.entries)) throw new Error();
  const result = backupDefaults();
  if (!validProgressEntry("current", data.entries.current)) throw new Error();
  for (const [key, value] of Object.entries(entries)) {
    if (key.includes("-meta:") && value !== null) result[key] = null;
  }
  for (const [key, value] of Object.entries(data.entries)) {
    if (!validProgressEntry(key, value)) throw new Error();
    result[key] = value;
  }
  return result;
}

document.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const data = button.dataset;
  if (Object.hasOwn(data, "retry")) sync.retry();
  if (!loaded) return;
  if (data.nav) go(data.nav, player ? state.current : undefined);
  if (data.plan && !player) {
    planSession = data.plan;
    go("plan");
  }
  if (data.scene) openScene(data.scene);
  if (player) return;
  if (data.referenceScene) go("scene", data.referenceScene);
  if (data.summarySection) {
    const section = document.getElementById("summary-" + data.summarySection);
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start" });
  }
  if (data.finish) finish(data.finish);
  if (data.skip) {
    save({ ["scene:" + data.skip]: sceneStatus(data.skip) === "skipped" ? "pending" : "skipped" });
    render();
  }
  if (data.solved) {
    save({ ["puzzle:" + data.solved]: !state.solved.includes(data.solved) });
    render();
  }
  if (data.hp !== undefined) {
    const i = Number(data.hp);
    save({ ["hp:" + i]: Math.max(0, Math.min(6, state.hp[i] + Number(data.delta))) });
    render();
  }
  if (button.id === "reset-hp") {
    save({ "hp:0": 6, "hp:1": 6 });
    render();
  }
  if (button.id === "migrate-local" && legacyProgress) {
    button.disabled = true;
    try {
      await sync.merge(legacyProgress);
      legacyProgress = null;
      try { localStorage.setItem("rudna-v1-transferred", "1"); } catch {}
      render();
      toast("Przeniesiono postęp i notatki na serwer.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }
});

document.addEventListener("submit", event => {
  const form = event.target;
  const kind = form.dataset.add;
  if (!kind) return;
  event.preventDefault();
  if (!loaded || player) return;
  const fields = new FormData(form);
  const title = fields.get("title").trim();
  if (!title) {
    form.querySelector("[name=title]").focus();
    return;
  }
  const id = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8);
  if (kind === "session") {
    save({ ["session-meta:" + id]: title });
    planSession = id;
    go("plan");
  }
  if (kind === "scene") {
    const sceneId = "U-" + id.toUpperCase();
    const place = fields.get("place").trim();
    save({ ["scene-meta:" + sceneId]: { title, place, session: planSession } });
    openScene(sceneId);
  }
  if (kind === "thread") {
    save({ ["thread-meta:" + id]: { title, text: fields.get("text").trim() } });
    render();
  }
});

document.addEventListener("change", event => {
  if (!loaded || player) return;
  const input = event.target;
  const data = input.dataset;
  if (data.done) finish(data.done);
  if (data.hpinput !== undefined) {
    const value = input.value === "" ? 6 : Number(input.value);
    save({ ["hp:" + data.hpinput]: Math.max(0, Math.min(6, Math.round(value))) });
    render();
  }
  if (data.sessionStatus) {
    save({ ["session:" + data.sessionStatus]: input.value });
    render();
  }
  if (data.threadStatus) {
    save({ ["thread:" + data.threadStatus]: input.value });
    render();
  }
});

document.addEventListener("input", event => {
  const input = event.target;
  if (!loaded || player || !input.dataset.note) return;
  save({ ["note:" + input.dataset.note]: input.value }, 450);
});

document.addEventListener("focusout", () => {
  if (!redrawOnBlur) return;
  setTimeout(() => {
    if ($("#main").contains(document.activeElement) && document.activeElement.matches("textarea, input, select")) return;
    redrawOnBlur = false;
    render();
  }, 0);
});

$("#retry").onclick = () => sync.retry();
$("#mode").onclick = () => {
  player = !player;
  go(player ? "scene" : "progress", state.current);
};

const norm = text => text.toLocaleLowerCase("pl").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
$("#search").oninput = event => {
  const query = norm(event.target.value.trim());
  const results = $("#results");
  results.hidden = !query || player;
  if (results.hidden) return;
  const matches = [];
  allScenes.forEach(scene => {
    if (norm([scene.title, scene.place, scene.tags, ...scene.steps].join(" ")).includes(query)) {
      matches.push({ label: scene.title, kind: "Scena · " + scene.place, id: scene.id });
    }
  });
  npcs.forEach(npc => {
    if (norm(npc.join(" ")).includes(query)) matches.push({ label: npc[0], kind: "NPC · " + npc[2], id: npc[4] });
  });
  puzzles.forEach(puzzle => {
    if (norm([puzzle.id, puzzle.title, puzzle.solution].join(" ")).includes(query)) {
      matches.push({ label: puzzle.id + " · " + puzzle.title, kind: "Zagadka · pomieszczenie " + puzzle.scene, id: puzzle.scene });
    }
  });
  town.forEach(place => {
    if (norm(place.join(" ")).includes(query)) matches.push({ label: place[0], kind: "Lokacja", id: place[2] });
  });
  results.innerHTML = matches.length ? matches.map(match =>
    '<button data-scene="' + match.id + '">' + esc(match.label) + '<small>' + esc(match.kind) + '</small></button>'
  ).join("") : '<p>Brak wyników. Spróbuj imienia, numeru pomieszczenia lub nazwy zagadki.</p>';
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    $("#results").hidden = true;
    $("#search").blur();
  }
  if (event.key === "/" && loaded && !player && !document.activeElement.matches("input, textarea, select")) {
    event.preventDefault();
    $("#search").focus();
  }
});

$("#export").onclick = () => {
  const current = { ...backupDefaults(), ...entries };
  const blob = new Blob([JSON.stringify({ format: "rudna-brama-v2", entries: current }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "rudna-brama-zapis.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast("Wyeksportowano postęp i notatki.");
};

$("#import-button").onclick = () => $("#import").click();
$("#import").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("Plik zapisu jest za duży.");
    const data = JSON.parse(await file.text());
    if (data.format === "rudna-brama-v1") {
      const legacy = parseLegacy(data.state);
      if (!confirm("Dodać starszy zapis do pól, które jeszcze nie zostały zapisane na serwerze?")) return;
      await sync.merge(legacy);
      toast("Przeniesiono starszy zapis.");
      return;
    }
    const incoming = parseBackup(data);
    if (!confirm("Zastąpić bieżący postęp i notatki danymi z kopii?")) return;
    save(incoming);
    selected = state.current;
    planSession = sessionFor(selected).id;
    go("progress");
  } catch (error) {
    toast(error instanceof SyntaxError || !error.message ? "Nieprawidłowy plik zapisu." : error.message);
  } finally {
    event.target.value = "";
  }
};

sync.refresh();
