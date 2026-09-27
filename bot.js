import { products } from "./products.js";

const TOKEN = Deno.env.get("TELEGRAM_TOKEN");
const SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
if (!TOKEN || !SECRET) throw new Error("TELEGRAM_TOKEN ve TELEGRAM_WEBHOOK_SECRET gerekli");
const API = `https://api.telegram.org/bot${TOKEN}/`;
const normalize = (v) => String(v ?? "").toLocaleLowerCase("tr-TR")
  .replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
  .replace(/ö/g,"o").replace(/ç/g,"c").replace(/\bplot\b/g,"pilot")
  .replace(/\bpro a\b/g,"proa").replace(/\bnc neo\b/g,"nc trek neo")
  .replace(/\bbalon\b/g,"balloon").replace(/\btel\b/g,"wire").trim();
const entries=products.map((p,i)=>({...p,i,n:normalize(p.name),g:normalize(p.group),r:normalize(p.ref)}));
const families=[
  ["XIENCE PROA","xience proa"],["XIENCE PROS","xience pros"],
  ["XIENCE SIERRA","xience sierra"],["XIENCE ALPINE","xience alpine"],
  ["MINI TREK","mini trek"],["NC TREK NEO","nc trek neo"],["NC TREK","nc trek"],
  ["TREK","trek"],["ARMADA","armada"],["VIATRAC","viatrac"],
  ["PILOT 50","pilot 50"],["PILOT","pilot"],["BMW","balance middleweight"],
  ["SUPERA","supera"],["AMPLATZER","amplatzer"]
];
function family(p) {
  for(const [label,key] of families) if(p.n.includes(key)) return label;
  return p.n.split(/\s+/).slice(0,2).join(" ").toUpperCase();
}
const byFamily=new Map();
for(const p of entries){const f=family(p);byFamily.set(f,[...(byFamily.get(f)||[]),p]);}
async function api(method,body) {
 const res=await fetch(API+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const data=await res.json();if(!data.ok) throw new Error(method+": "+data.description);return data.result;
}
const buttons=(items)=>({inline_keyboard:items.map(x=>[x])});
const send=(chat_id,text,reply_markup)=>api("sendMessage",{chat_id,text,reply_markup,link_preview_options:{is_disabled:true}});
function size(q){return q.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,3})\b/i);}
function rank(q,p){
 const s=normalize(q),compact=s.replace(/\s+/g,"");
 if(p.ubb===s.replace(/\D/g,""))return 10000;
 if(p.r===s || p.r.replace(/[^a-z0-9]/g,"")===compact.replace(/[^a-z0-9]/g,""))return 9000;
 if(normalize(p.sut).split(" / ").includes(s))return 8000;
 let score=0;
 const terms=s.split(/\s+/).filter(Boolean);
 const dims=size(s);const needle=dims&&`${Number(dims[1].replace(",","."))}x${Number(dims[2])}`;
 const pd=p.n.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:mm)?\s*[x×]\s*(\d{1,3})\s*(?:mm)?/);
 const productSize=pd&&`${Number(pd[1].replace(",","."))}x${Number(pd[2])}`;
 if(needle && productSize!==needle)return -1;
 if(needle)score+=100;
 const length=s.match(/\b(190|300|145|150|135|80)\s*cm\b/);
 if(length && !p.n.includes(length[1]+" cm") && !p.n.includes(length[1]+"cm"))return -1;
 if(length)score+=60;
 for(const t of terms){
  if(["mm","cm","x","wire","stent","balloon","urun","ubb","sut","kodu"].includes(t))continue;
  if(dims && t.includes("x"))continue;
  if(/^\d+$/.test(t) && !new RegExp(`(^|\\D)${t}(\\D|$)`).test(p.n))return -1;
  if(p.n.includes(t))score+=t.length>=4?24:8;
  else if(p.r.includes(t))score+=18;
  else if(t.length>=4 && p.g.includes(t))score+=4;
  else if(/\d/.test(t) && !(dims && (t===dims[1]||t===dims[2])) && !(length && t===length[1]))return -1;
  else if(t.length>=4)return -1;
 }
 return score;
}
function list(chat,items,title,offset=0){
 const subset=items.slice(offset,offset+8);
 const menu=subset.map(p=>({text:`${family(p)} · ${p.name.replace(/.*?(\d+(?:[.,]\d+)?\s*(?:mm)?\s*[x×]\s*\d+\s*mm).*/i,"$1").slice(0,35)} · ${p.ref}`.slice(0,64),callback_data:`i:${p.i}`}));
 if(items.length>offset+8 && title.startsWith("Aile:"))menu.push({text:"➡️ Devam",callback_data:`f:${encodeURIComponent(title.slice(5))}:${offset+8}`});
 return send(chat,`${title}\n${items.length} kayıt bulundu. Ayrıntı için ürüne dokun.`,buttons(menu));
}
function search(chat,q){
 const query=normalize(q).replace(/\bubb\b/g,"").trim();
 if(!query)return send(chat,"Ürün adı, ölçü, UBB veya referans yaz. Örn: Pilot 50, 2.5x18 PROA.");
 if(["balloon","stent","wire","kilavuz wire"].includes(query)){
  const names=query==="balloon"?["MINI TREK","TREK","NC TREK","NC TREK NEO","ARMADA","VIATRAC"]:
    query==="stent"?["XIENCE PROA","XIENCE PROS","XIENCE SIERRA","XIENCE ALPINE","SUPERA"]:
    ["PILOT 50","PILOT","BMW"];
  return send(chat,"Hangi ürün ailesi?",buttons(names.filter(n=>byFamily.has(n)).map(n=>({text:`${n} (${byFamily.get(n).length})`,callback_data:`f:${encodeURIComponent(n)}:0`}))));
 }
 const sut=query.match(/\b(?:kr|kv|gr)\s*\d{3,5}\b/);
 const effective=sut?sut[0].replace(/\s+/g,""):query;
 const scored=entries.map(p=>({p,score:rank(effective,p)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 if(!scored.length)return send(chat,"Bu ifadeyle güvenilir eşleşme bulamadım. Aile adı, tam ölçü, UBB veya referans yaz.");
 const top=scored[0].score;
 const result=scored.filter(x=>x.score>=Math.max(top-35,1)).slice(0,40).map(x=>x.p);
 return list(chat,result,`Arama: ${q}`);
}
export default async function(req){
 if(req.method==="GET")return new Response("ÖZGATA ürün kataloğu botu çalışıyor.");
 if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
 if(req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==SECRET)return new Response("Forbidden",{status:403});
 try{
  const update=await req.json();const cb=update.callback_query;
  if(cb){
   await api("answerCallbackQuery",{callback_query_id:cb.id});
   const chat=cb.message?.chat?.id;const data=String(cb.data||"");
   if(!chat)return new Response("OK");
   if(data.startsWith("i:")){
    const p=entries[Number(data.slice(2))];
    if(p)await send(chat,`📦 ${p.name}\nAile: ${family(p)}\nUBB: ${p.ubb}\nReferans: ${p.ref}\nSUT: ${p.sut||"Listede belirtilmemiş"}\nKaynak: ${p.source}\n\nBu katalog stok miktarı göstermez.`);
   }else if(data.startsWith("f:")){
    const match=data.match(/^f:(.*):(\d+)$/);if(match){const name=decodeURIComponent(match[1]);const items=byFamily.get(name)||[];await list(chat,items,`Aile:${name}`,Number(match[2]));}
   }
  }else if(update.message?.chat?.id){
   const chat=update.message.chat.id;const text=String(update.message.text||"").trim();
   if(text==="/start"||text==="/yardim")await send(chat,"Merhaba! Ürün adı, ölçü, UBB, katalog referansı ya da SUT kodu yaz.\nÖrnek: balon · stent · Pilot 50 · 2.5x18 PROA · 1010480-HJ · KR1088\nKayıtlar yüklediğin Abbott ve St. Jude listelerinden gelir. Stok bilgisi içermez.");
   else if(text)await search(chat,text);
   else await send(chat,"Şimdilik metin araması yapıyorum. Ürün adı veya ölçü yaz.");
  }
  return new Response("OK");
 }catch(err){console.error(err);return new Response("Error",{status:500});}
}
