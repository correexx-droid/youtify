/**
 * The page a Jam host serves to browsers (lib/jam.ts): guests without YoutiFy open http://<host>:4190 and get
 * the same controls as in the app. Plain HTML/JS, no outside files, so it works in any phone browser.
 */
export const JAM_GUEST_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YoutiFy Jam</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.4 system-ui,sans-serif;background:#120a1f;color:#f3eefc}
main{max-width:560px;margin:0 auto;padding:16px}h1{font-size:20px;margin:4px 0 12px}h1 b{color:#b18cff}
.card{background:#1e1430;border:1px solid #33264d;border-radius:16px;padding:12px;margin-bottom:12px}
.row{display:flex;align-items:center;gap:10px}.grow{flex:1;min-width:0}.t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a{color:#b9acd0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}img{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#33264d}
.big img{width:64px;height:64px}button{background:#33264d;color:#f3eefc;border:0;border-radius:999px;padding:8px 12px;font:inherit;cursor:pointer}
button.p{background:#8b5cf6;color:#fff;font-weight:600}input{width:100%;background:#120a1f;color:#f3eefc;border:1px solid #33264d;border-radius:12px;padding:10px;font:inherit}
ul{list-style:none;margin:0;padding:0}li{padding:6px 0;border-top:1px solid #2a1f3f}li:first-child{border-top:0}.s{font-size:13px;color:#b9acd0}
.ctl{display:flex;gap:8px;justify-content:center;margin-top:10px}.err{color:#ff8fa3}.hide{display:none}
</style></head><body><main>
<h1><b>YoutiFy</b> Jam</h1>
<div id="login" class="card">
 <p id="l1"></p><input id="name" maxlength="30" autocomplete="nickname"><p></p><input id="pin" inputmode="numeric" maxlength="4"><p></p>
 <button class="p" id="go"></button> <span id="lerr" class="err"></span>
</div>
<div id="app" class="hide">
 <div class="card big"><div class="row"><img id="cimg" alt=""><div class="grow"><div class="t" id="ct">–</div><div class="a" id="ca"></div></div></div>
  <div class="ctl"><button id="prev">⏮</button><button class="p" id="tog">⏯</button><button id="next">⏭</button></div>
  <p class="s" id="info"></p></div>
 <div class="card"><div class="row"><input id="q"><button class="p" id="find">🔍</button></div><ul id="res"></ul></div>
 <div class="card"><b id="qh"></b><ul id="list"></ul></div>
 <p class="err" id="err"></p>
</div>
<script>
const de=(navigator.language||"").startsWith("de");
const T=de?{l1:"Dein Name und die PIN, die beim Gastgeber angezeigt wird:",name:"Dein Name",pin:"PIN",go:"Beitreten",bad:"Falsche PIN",down:"Gastgeber nicht erreichbar",q:"Song suchen",queue:"Als Nächstes",empty:"Die Warteschlange ist leer.",add:"+ Warteschlange",nx:"Als Nächstes",guests:n=>n+" Gäste verbunden",rm:"Entfernen"}
:{l1:"Your name and the PIN shown on the host:",name:"Your name",pin:"PIN",go:"Join",bad:"Wrong PIN",down:"Host not reachable",q:"Search a song",queue:"Up next",empty:"The queue is empty.",add:"+ Queue",nx:"Play next",guests:n=>n+" guests connected",rm:"Remove"};
const $=id=>document.getElementById(id);
$("l1").textContent=T.l1;$("name").placeholder=T.name;$("pin").placeholder=T.pin;$("go").textContent=T.go;$("q").placeholder=T.q;$("qh").textContent=T.queue;
let gid=localStorage.getItem("jamGuest");if(!gid){gid=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem("jamGuest",gid)}
const p=new URLSearchParams(location.search);$("pin").value=p.get("pin")||"";$("name").value=localStorage.getItem("jamName")||"";
let me=null,timer=null;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
async function get(path){const q=new URLSearchParams({pin:me.pin,guest:gid,name:me.name});const r=await fetch(path+(path.includes("?")?"&":"?")+q);return r}
async function cmd(c){try{const r=await fetch("/jam/cmd",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...c,pin:me.pin,guest:gid,name:me.name})});if(r.ok)draw(await r.json())}catch(e){$("err").textContent=T.down}}
function draw(s){$("err").textContent="";const c=s.current;$("ct").textContent=c?c.title:"–";$("ca").textContent=c?c.artist:"";$("cimg").src=c?c.thumb:"";
$("info").textContent=s.host+" · "+T.guests(s.guests)+(c?" · "+fmt(s.position)+" / "+fmt(s.duration):"");
const l=$("list");l.innerHTML=s.queue.length?"":"<li class=s>"+T.empty+"</li>";
s.queue.forEach((q,n)=>{const li=document.createElement("li");li.innerHTML='<div class=row><img src="'+esc(q.track.thumb)+'" alt=""><div class=grow><div class=t>'+esc(q.track.title)+'</div><div class=a>'+esc(q.track.artist)+'</div></div><button data-u>▲</button><button data-d>▼</button><button data-x title="'+T.rm+'">✕</button></div>';
const first=s.queue[0]?s.queue[0].i:0,last=s.queue.length?s.queue[s.queue.length-1].i:0;
li.querySelector("[data-u]").onclick=()=>q.i>first&&cmd({op:"move",i:q.i,id:q.track.id,to:q.i-1});
li.querySelector("[data-d]").onclick=()=>q.i<last&&cmd({op:"move",i:q.i,id:q.track.id,to:q.i+1});
li.querySelector("[data-x]").onclick=()=>cmd({op:"remove",i:q.i,id:q.track.id});l.appendChild(li)})}
async function tick(){try{const r=await get("/jam/state");if(r.status===403){stop(T.bad);return}draw(await r.json())}catch(e){$("err").textContent=T.down}}
function stop(msg){clearInterval(timer);$("app").classList.add("hide");$("login").classList.remove("hide");$("lerr").textContent=msg}
$("go").onclick=async()=>{me={name:$("name").value.trim().slice(0,30),pin:$("pin").value.trim()};localStorage.setItem("jamName",me.name);
try{const r=await get("/jam/state");if(r.status!==200){$("lerr").textContent=T.bad;return}draw(await r.json())}catch(e){$("lerr").textContent=T.down;return}
$("login").classList.add("hide");$("app").classList.remove("hide");timer=setInterval(tick,2000)};
$("prev").onclick=()=>cmd({op:"prev"});$("tog").onclick=()=>cmd({op:"toggle"});$("next").onclick=()=>cmd({op:"next"});
async function find(){const q=$("q").value.trim();if(!q)return;const r=await get("/jam/search?q="+encodeURIComponent(q));const list=r.ok?await r.json():[];const ul=$("res");ul.innerHTML="";
list.forEach(t=>{const li=document.createElement("li");li.innerHTML='<div class=row><img src="'+esc(t.thumb)+'" alt=""><div class=grow><div class=t>'+esc(t.title)+'</div><div class=a>'+esc(t.artist)+(t.duration?" · "+fmt(t.duration):"")+'</div></div><button data-n>'+T.nx+'</button><button class=p data-a>'+T.add+'</button></div>';
li.querySelector("[data-a]").onclick=()=>{cmd({op:"add",track:t});li.remove()};li.querySelector("[data-n]").onclick=()=>{cmd({op:"playNext",track:t});li.remove()};ul.appendChild(li)})}
$("find").onclick=find;$("q").onkeydown=e=>{if(e.key==="Enter")find()};
if(p.get("pin")&&$("name").value)$("go").click();
</script></main></body></html>`;
