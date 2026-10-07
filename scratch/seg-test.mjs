import fs from "node:fs";
const key = fs.readFileSync(".env.local","utf8").match(/GEMINI_API_KEY=(.*)/)[1].trim();
const PARTS = ["hot water tap","cold water tap","drip tray","cabinet door","indicator lights","water bottle","condenser coils","compressor","data plate","wiring diagram","power cord","drain plug"];
const img = fs.readFileSync(process.argv[3] || "scratch/SELA_water_cooler_in_office.jpg").toString("base64");
const model = process.argv[2] || "gemini-2.5-flash";
const prompt = `You are labeling parts of a water cooler / water dispenser for an AR overlay.
Give segmentation masks for every part from this list that is clearly visible: ${PARTS.join(", ")}.
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask as a base64 PNG (data:image/png;base64,...) in key "mask", and the text label in the key "label". Use ONLY labels from the list, each at most once. Skip parts that are not visible.`;
const body = {
  contents:[{parts:[{inline_data:{mime_type:"image/jpeg",data:img}},{text:prompt}]}],
  generationConfig:{thinkingConfig: model.startsWith("gemini-3") ? {thinkingLevel: process.env.TL||"low"} : {thinkingBudget:0}}
};
const t0=Date.now();
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify(body)});
const j = await r.json();
const ms=Date.now()-t0;
if(!j.candidates){console.log(model, ms+"ms", JSON.stringify(j).slice(0,400)); process.exit(0);}
const text=j.candidates[0].content.parts.map(p=>p.text||"").join("");
let items=[]; try{const s=text.indexOf("[");const e=text.lastIndexOf("]");items=JSON.parse(text.slice(s,e+1));}catch(e){console.log(model, ms+"ms PARSE FAIL", text.slice(0,300)); process.exit(0);}
console.log(model, ms+"ms", items.length+" parts:", items.map(i=>`${i.label}${i.mask?"(mask "+(i.mask.length)+"b)":"(NO MASK)"} box=${JSON.stringify(i.box_2d)}`).join(" | "));
fs.writeFileSync(`scratch/out-${model}.json`, JSON.stringify(items));
